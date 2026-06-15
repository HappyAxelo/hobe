// Starter music library. The tracks shipped in seed-assets/tracks are synthesised
// (royalty-free) placeholders so the feature works end-to-end; replace them with
// properly licensed music before promoting the library.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { db } from './db.js';
import { storageMode, putObject } from './storage.js';
import { probeDuration } from './transcode.js';

const SEED_TRACKS = [
  { title: 'Kigali Sunrise', artist: 'Hobe Library (royalty-free)', file: 'track-sunrise.m4a' },
  { title: 'Mellow Evening', artist: 'Hobe Library (royalty-free)', file: 'track-mellow.m4a' },
  { title: 'City Pulse', artist: 'Hobe Library (royalty-free)', file: 'track-pulse.m4a' },
];

// Idempotent: only seeds when the tracks table is empty. Safe to call on boot.
export async function ensureTracks() {
  const tracksDir = path.join(config.dataDir, 'tracks');
  fs.mkdirSync(tracksDir, { recursive: true });
  if (Number(db.prepare('SELECT COUNT(*) c FROM tracks').get().c) > 0) return;
  const ins = db.prepare('INSERT INTO tracks (title, artist, filename, duration_s) VALUES (?,?,?,?)');
  let n = 0;
  for (const t of SEED_TRACKS) {
    const src = path.join(config.root, 'seed-assets', 'tracks', t.file);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(tracksDir, t.file);
    if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
    const duration = await probeDuration(dest);
    if (storageMode === 'r2') await putObject(`tracks/${t.file}`, fs.readFileSync(dest), 'audio/mp4');
    ins.run(t.title, t.artist, t.file, duration);
    n++;
  }
  if (n) console.log(`Seeded ${n} royalty-free starter tracks.`);
}
