// Seed demo creators, videos, and products so the money loop is demoable
// immediately. Demo clips ship pre-rendered in seed-assets/ (so seeding works
// without ffmpeg); if missing, they are generated with ffmpeg using the exact
// production compression settings (H.264 baseline 480p, ~450 kbps cap).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { db } from '../server/db.js';
import { config } from '../server/config.js';
import { storageMode, putObject } from '../server/storage.js';

const videosDir = path.join(config.dataDir, 'videos');
fs.mkdirSync(videosDir, { recursive: true });

const users = [
  { name: 'Aline Uwase', handle: 'aline.dance', phone: '250788111111', role: 'creator', color: '#ff5c8a', bio: "Dancer from Kigali. Tips fund our crew's studio time." },
  { name: 'Eric Mugisha', handle: 'eric.farms', phone: '250788222222', role: 'creator', color: '#39c46f', bio: '60-second farming lessons in Kinyarwanda.' },
  { name: 'Diane Ingabire', handle: 'diane.designs', phone: '250788333333', role: 'creator', color: '#ffb13d', bio: 'I make kitenge bags and show how. Buy direct from my videos.' },
  { name: 'Happy (you)', handle: 'happy', phone: '250788999000', role: 'viewer', color: '#7c5cff', bio: 'Demo viewer account. Tip from here.' },
];

const videos = [
  // [creator handle, title, kind, lang, bg colour, label]
  ['aline.dance', 'Intore fusion - new routine', 'watch', 'rw', '0x1b1035', 'ALINE\\nDANCE'],
  ['aline.dance', 'Behind the scenes at rehearsal', 'watch', 'rw', '0x2d1045', 'REHEARSAL'],
  ['diane.designs', 'Kitenge tote bag - full make', 'watch', 'rw', '0x3a2410', 'KITENGE\\nBAG'],
  ['diane.designs', 'New colours just dropped', 'watch', 'rw', '0x40180f', 'NEW\\nCOLOURS'],
  ['eric.farms', 'Maize spacing - double your yield', 'learn', 'rw', '0x0f3320', 'MAIZE\\nSPACING'],
  ['eric.farms', 'Drip irrigation from bottles', 'learn', 'rw', '0x103428', 'DRIP\\nIRRIGATION'],
  ['diane.designs', 'Pricing your craft for profit', 'learn', 'en', '0x33240f', 'PRICING\\n101'],
];

const products = [
  ['diane.designs', 'Kitenge tote bag', 'Handmade in Kigali. As seen in my videos.', 8500],
  ['diane.designs', 'Kitenge laptop sleeve', 'Padded, fits 14 inch. Made to order.', 12000],
  ['eric.farms', 'Seed starter pack (maize + beans)', 'Certified seed, enough for 0.1 ha.', 6000],
];

function makeVideo(file, { color, label, seconds = 12 }) {
  const text = label.replace(/\\n/g, '\n');
  const args = [
    '-y',
    '-f', 'lavfi', '-i', `color=c=${color}:s=480x854:d=${seconds}:r=30`,
    '-f', 'lavfi', '-i', `sine=frequency=420:duration=${seconds}`,
    '-vf', `drawtext=text='${text}':fontcolor=white:fontsize=64:x=(w-text_w)/2:y=(h-text_h)/2:font=Sans,drawtext=text='hobe demo':fontcolor=0x888888:fontsize=28:x=(w-text_w)/2:y=h-120:font=Sans`,
    '-c:v', 'libx264', '-profile:v', 'baseline', '-level', '3.0',
    '-crf', '27', '-maxrate', '450k', '-bufsize', '900k', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '48k', '-ac', '1',
    '-movflags', '+faststart', '-shortest',
    file,
  ];
  const r = spawnSync('ffmpeg', args, { stdio: 'pipe' });
  if (r.status !== 0) {
    console.warn(`ffmpeg unavailable or failed for ${file} - skipping generation.`);
    return false;
  }
  return true;
}

const already = Number(db.prepare('SELECT COUNT(*) c FROM users').get().c);
if (already > 0) {
  console.log('Database already seeded - wiping and reseeding.');
  db.exec('DELETE FROM ledger; DELETE FROM orders; DELETE FROM transactions; DELETE FROM products; DELETE FROM videos; DELETE FROM users;');
}

const insUser = db.prepare('INSERT INTO users (name, handle, phone, role, color, bio) VALUES (?,?,?,?,?,?)');
const idByHandle = {};
for (const u of users) {
  idByHandle[u.handle] = Number(insUser.run(u.name, u.handle, u.phone, u.role, u.color, u.bio).lastInsertRowid);
}

const insVideo = db.prepare(`
  INSERT INTO videos (user_id, title, kind, lang, filename, duration_s, size_bytes, views, likes, created_at)
  VALUES (?,?,?,?,?,?,?,?,?,?)
`);
let i = 0;
for (const [handle, title, kind, lang, color, label] of videos) {
  i++;
  const filename = `demo${i}.mp4`;
  const fp = path.join(videosDir, filename);
  // Prefer the pre-rendered clip shipped in seed-assets/ (works without ffmpeg)
  const asset = path.join(config.root, 'seed-assets', filename);
  let ok = fs.existsSync(fp);
  if (!ok && fs.existsSync(asset)) { fs.copyFileSync(asset, fp); ok = true; }
  if (!ok) ok = makeVideo(fp, { color, label });
  const size = ok && fs.existsSync(fp) ? fs.statSync(fp).size : 0;
  const ageHours = (videos.length - i) * 5 + 2; // stagger ages so the feed ranking is visible
  insVideo.run(
    idByHandle[handle], title, kind, lang, filename, 12, size,
    Math.floor(Math.random() * 400) + 20, Math.floor(Math.random() * 60) + 3,
    Math.floor(Date.now() / 1000) - ageHours * 3600,
  );
}

const insProduct = db.prepare('INSERT INTO products (creator_id, title, description, price) VALUES (?,?,?,?)');
for (const [handle, title, desc, price] of products) {
  insProduct.run(idByHandle[handle], title, desc, price);
}

// In R2 mode the app serves video from the bucket, so push the demo clips up
// once at seed time. Otherwise the freshly deployed feed would show 404s.
if (storageMode === 'r2') {
  for (const f of fs.readdirSync(videosDir)) {
    if (!f.endsWith('.mp4')) continue;
    await putObject(`videos/${f}`, fs.readFileSync(path.join(videosDir, f)), 'video/mp4');
  }
  console.log('Uploaded demo clips to R2.');
}

console.log(`Seeded ${users.length} users, ${videos.length} videos, ${products.length} products.`);
console.log('Demo phone rules (simulator): ending 99 = payment fails, ending 77 = stays pending, anything else succeeds.');
