// Real authentication: phone + password, scrypt hashing, session tokens.
// Zero dependencies — node:crypto only.
// The phone number IS the identity: it's also the MoMo payout destination,
// which is why we use it instead of email. Google sign-in can be added later
// as an alternative front door that links to the same users table.
import crypto from 'node:crypto';
import { db } from './db.js';

const SESSION_DAYS = 30;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,unixepoch()+?)')
    .run(token, userId, SESSION_DAYS * 86400);
  return token;
}

export function getSessionUser(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > unixepoch()
  `).get(token);
  return row ?? null;
}

export function deleteSession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

// ---- signup / login ----

const PHONE_RE = /^2507[2389]\d{7}$/; // Rwandan mobile: 25072/3/8/9 + 7 digits

function makeHandle(name) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '').slice(0, 16) || 'user';
  let handle = base;
  while (db.prepare('SELECT 1 FROM users WHERE handle=?').get(handle)) {
    handle = `${base}.${crypto.randomInt(100, 9999)}`;
  }
  return handle;
}

const COLORS = ['#ff5c8a', '#22c55e', '#ffb13d', '#7c5cff', '#38bdf8', '#f472b6', '#a3e635', '#fb923c'];

export function signup({ name, phone, password }) {
  name = String(name ?? '').trim();
  phone = String(phone ?? '').replace(/[^\d]/g, '');
  if (phone.length === 10 && phone.startsWith('07')) phone = '250' + phone.slice(1);
  password = String(password ?? '');

  if (name.length < 2 || name.length > 40) throw httpErr(400, 'Name must be 2–40 characters');
  if (!PHONE_RE.test(phone)) throw httpErr(400, 'Enter a valid Rwandan mobile number (07XX XXX XXX)');
  if (password.length < 6) throw httpErr(400, 'Password must be at least 6 characters');
  if (db.prepare('SELECT 1 FROM users WHERE phone=?').get(phone)) {
    throw httpErr(409, 'An account with this number already exists — sign in instead');
  }

  const color = COLORS[crypto.randomInt(COLORS.length)];
  const info = db.prepare(`
    INSERT INTO users (name, handle, phone, role, color, bio, password_hash)
    VALUES (?,?,?,?,?,?,?)
  `).run(name, makeHandle(name), phone, 'creator', color, '', hashPassword(password));
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(Number(info.lastInsertRowid));
  return { user, token: createSession(user.id) };
}

// naive in-memory rate limit: 10 attempts / 15 min per phone
const attempts = new Map();
function throttle(phone) {
  const now = Date.now();
  const a = attempts.get(phone);
  if (a && now < a.resetAt && a.count >= 10) throw httpErr(429, 'Too many attempts — try again in a few minutes');
  if (!a || now >= a.resetAt) attempts.set(phone, { count: 1, resetAt: now + 15 * 60_000 });
  else a.count++;
}

export function login({ phone, password }) {
  phone = String(phone ?? '').replace(/[^\d]/g, '');
  if (phone.length === 10 && phone.startsWith('07')) phone = '250' + phone.slice(1);
  throttle(phone);
  const user = db.prepare('SELECT * FROM users WHERE phone=?').get(phone);
  if (!user || !user.password_hash) throw httpErr(401, 'Wrong number or password');
  if (!verifyPassword(String(password ?? ''), user.password_hash)) throw httpErr(401, 'Wrong number or password');
  attempts.delete(phone);
  return { user, token: createSession(user.id) };
}

export function publicUser(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, handle: u.handle, role: u.role, bio: u.bio, color: u.color, avatar: u.avatar ?? null };
}

function httpErr(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
