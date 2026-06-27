// SQLite via node:sqlite (built into Node >= 22.5) — zero npm dependencies.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(path.join(config.dataDir, 'videos'), { recursive: true });
fs.mkdirSync(path.join(config.dataDir, 'avatars'), { recursive: true });

export const db = new DatabaseSync(path.join(config.dataDir, 'hobe.db'));
try { db.exec('PRAGMA journal_mode = WAL'); } catch { /* some filesystems cannot WAL */ }
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  handle TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  bio TEXT DEFAULT '',
  color TEXT DEFAULT '#7c5cff',
  password_hash TEXT,
  avatar TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'watch',
  lang TEXT DEFAULT 'rw',
  filename TEXT NOT NULL,
  duration_s REAL DEFAULT 0,
  size_bytes INTEGER DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ready',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  creator_id INTEGER NOT NULL REFERENCES users(id),
  video_id INTEGER REFERENCES videos(id),
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  price INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  amount INTEGER NOT NULL,
  payer_phone TEXT,
  payee_user_id INTEGER REFERENCES users(id),
  video_id INTEGER REFERENCES videos(id),
  product_id INTEGER REFERENCES products(id),
  provider TEXT NOT NULL,
  provider_ref TEXT,
  fail_reason TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY,
  txn_id INTEGER NOT NULL REFERENCES transactions(id),
  account TEXT NOT NULL,
  amount INTEGER NOT NULL,
  kind TEXT NOT NULL,
  memo TEXT DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_ledger_account ON ledger(account);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  buyer_user_id INTEGER REFERENCES users(id),
  buyer_phone TEXT NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_payment',
  txn_id INTEGER REFERENCES transactions(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY,
  video_id INTEGER NOT NULL REFERENCES videos(id),
  reporter_user_id INTEGER REFERENCES users(id),
  reason TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS reposts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  video_id INTEGER NOT NULL REFERENCES videos(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(user_id, video_id)
);
CREATE INDEX IF NOT EXISTS idx_reposts_user ON reposts(user_id);
CREATE INDEX IF NOT EXISTS idx_reposts_video ON reposts(video_id);

CREATE TABLE IF NOT EXISTS saves (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  video_id INTEGER NOT NULL REFERENCES videos(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(user_id, video_id)
);
CREATE INDEX IF NOT EXISTS idx_saves_user ON saves(user_id);

CREATE TABLE IF NOT EXISTS video_likes (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  video_id INTEGER NOT NULL REFERENCES videos(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(user_id, video_id)
);
CREATE INDEX IF NOT EXISTS idx_videolikes_user ON video_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_videolikes_video ON video_likes(video_id);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY,
  video_id INTEGER NOT NULL REFERENCES videos(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  parent_id INTEGER REFERENCES comments(id),
  body TEXT NOT NULL,
  likes INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_comments_video ON comments(video_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);

CREATE TABLE IF NOT EXISTS comment_likes (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  comment_id INTEGER NOT NULL REFERENCES comments(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(user_id, comment_id)
);
CREATE INDEX IF NOT EXISTS idx_commentlikes_user ON comment_likes(user_id);

CREATE TABLE IF NOT EXISTS follows (
  id INTEGER PRIMARY KEY,
  follower_id INTEGER NOT NULL REFERENCES users(id),
  creator_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(follower_id, creator_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_creator ON follows(creator_id);

CREATE TABLE IF NOT EXISTS tracks (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT DEFAULT '',
  filename TEXT NOT NULL,
  duration_s REAL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
`);

// ---- Ads platform ----
db.exec(`
CREATE TABLE IF NOT EXISTS advertisers (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  company_name TEXT NOT NULL,
  contact_name TEXT DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS ad_campaigns (
  id INTEGER PRIMARY KEY,
  advertiser_id INTEGER NOT NULL REFERENCES advertisers(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_review',
  cpm_rate_rwf INTEGER NOT NULL,
  budget_rwf INTEGER NOT NULL,
  spent_rwf INTEGER NOT NULL DEFAULT 0,
  paid INTEGER NOT NULL DEFAULT 0,
  starts_at INTEGER,
  ends_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON ad_campaigns(status);

CREATE TABLE IF NOT EXISTS ads (
  id INTEGER PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES ad_campaigns(id),
  kind TEXT NOT NULL DEFAULT 'video',
  filename TEXT,
  renditions TEXT,
  status TEXT NOT NULL DEFAULT 'processing',
  headline TEXT DEFAULT '',
  caption TEXT DEFAULT '',
  cta_label TEXT DEFAULT 'Learn more',
  cta_url TEXT DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_ads_campaign ON ads(campaign_id);

CREATE TABLE IF NOT EXISTS ad_events (
  id INTEGER PRIMARY KEY,
  ad_id INTEGER NOT NULL REFERENCES ads(id),
  campaign_id INTEGER NOT NULL REFERENCES ad_campaigns(id),
  type TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_adevents_ad ON ad_events(ad_id);
CREATE INDEX IF NOT EXISTS idx_adevents_campaign ON ad_events(campaign_id);
`);

// Migrations for databases created before these columns existed
// (e.g. the live Fly volume). Safe to re-run.
try { db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT'); } catch { /* exists */ }
try { db.exec('ALTER TABLE users ADD COLUMN avatar TEXT'); } catch { /* exists */ }
try { db.exec('ALTER TABLE videos ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0'); } catch { /* exists */ }
try { db.exec('ALTER TABLE users ADD COLUMN verified INTEGER NOT NULL DEFAULT 0'); } catch { /* exists */ }
try { db.exec('ALTER TABLE videos ADD COLUMN sound TEXT'); } catch { /* exists */ }
// Background transcoding: a freshly uploaded video is 'processing' until ffmpeg
// finishes, then becomes 'ready' (or 'failed'). Old rows default to 'ready'.
try { db.exec("ALTER TABLE videos ADD COLUMN status TEXT NOT NULL DEFAULT 'ready'"); } catch { /* exists */ }
// Any video left 'processing' was interrupted by a restart (e.g. Render
// spinning the instance down mid-encode). Its temp input is gone, so it can't
// finish — mark it failed so the owner can retry instead of waiting forever.
try { db.exec("UPDATE videos SET status='failed' WHERE status='processing'"); } catch { /* column may not exist on very old schema */ }
// Adaptive quality: a JSON array of available rendition labels e.g. ["480","720","1080"].
try { db.exec('ALTER TABLE videos ADD COLUMN renditions TEXT'); } catch { /* exists */ }
// Ad review access.
try { db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0'); } catch { /* exists */ }
// Record which user sent a tip, so the creator can see who tipped them.
try { db.exec('ALTER TABLE transactions ADD COLUMN payer_user_id INTEGER'); } catch { /* exists */ }

export function getBalance(account) {
  const row = db.prepare('SELECT COALESCE(SUM(amount),0) AS bal FROM ledger WHERE account = ?').get(account);
  return Number(row.bal);
}

// node:sqlite has no .transaction() helper, so: BEGIN/COMMIT wrapper.
export function transaction(fn) {
  return (...args) => {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };
}
