// Comments: top-level comments, one level of replies (TikTok-style), and
// per-user comment likes. Replies are flattened to a single level: replying to
// a reply still attaches under the original top-level comment.

function shapeComment(db, c, viewerId) {
  const u = db.prepare('SELECT id, name, handle, color, avatar, verified FROM users WHERE id=?').get(c.user_id);
  const liked = viewerId ? !!db.prepare('SELECT 1 FROM comment_likes WHERE user_id=? AND comment_id=?').get(viewerId, c.id) : false;
  const reply_count = Number(db.prepare('SELECT COUNT(*) n FROM comments WHERE parent_id=? AND deleted=0').get(c.id).n);
  return {
    id: c.id, body: c.body, likes: Number(c.likes), liked, reply_count, created_at: c.created_at,
    parent_id: c.parent_id,
    user: u ? { id: u.id, name: u.name, handle: u.handle, color: u.color, avatar: u.avatar, verified: u.verified } : { name: 'Unknown' },
  };
}

export function commentCount(db, videoId) {
  return Number(db.prepare('SELECT COUNT(*) n FROM comments WHERE video_id=? AND deleted=0').get(videoId).n);
}

export function registerComments(app, deps) {
  const { db, sendJson, requireUser, currentUser } = deps;

  // Top-level comments for a video, hottest first.
  app.get('/api/videos/:id/comments', (req, res) => {
    const viewer = currentUser(req);
    const rows = db.prepare(
      'SELECT * FROM comments WHERE video_id=? AND parent_id IS NULL AND deleted=0 ORDER BY likes DESC, id DESC LIMIT 200'
    ).all(Number(req.params.id));
    sendJson(res, 200, rows.map((c) => shapeComment(db, c, viewer?.id)));
  });

  // Replies under a comment.
  app.get('/api/comments/:id/replies', (req, res) => {
    const viewer = currentUser(req);
    const rows = db.prepare('SELECT * FROM comments WHERE parent_id=? AND deleted=0 ORDER BY id ASC LIMIT 500').all(Number(req.params.id));
    sendJson(res, 200, rows.map((c) => shapeComment(db, c, viewer?.id)));
  });

  // Post a comment or a reply (parent_id optional).
  app.post('/api/videos/:id/comments', (req, res) => {
    const user = requireUser(req);
    const b = req.body ?? {};
    const body = String(b.body || '').trim().slice(0, 500);
    if (!body) return sendJson(res, 400, { error: 'Write something first' });
    const vid = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM videos WHERE id=? AND deleted=0').get(vid)) return sendJson(res, 404, { error: 'Video not found' });
    let parentId = b.parent_id ? Number(b.parent_id) : null;
    if (parentId) {
      const p = db.prepare('SELECT id, parent_id, video_id FROM comments WHERE id=? AND deleted=0').get(parentId);
      if (!p || Number(p.video_id) !== vid) parentId = null;
      else if (p.parent_id) parentId = p.parent_id; // flatten replies-to-replies onto the top-level
    }
    const info = db.prepare('INSERT INTO comments (video_id, user_id, parent_id, body) VALUES (?,?,?,?)').run(vid, user.id, parentId, body);
    const c = db.prepare('SELECT * FROM comments WHERE id=?').get(Number(info.lastInsertRowid));
    sendJson(res, 200, shapeComment(db, c, user.id));
  });

  // Like / unlike a comment (one per user).
  app.post('/api/comments/:id/like', (req, res) => {
    const user = requireUser(req);
    const cid = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM comments WHERE id=? AND deleted=0').get(cid)) return sendJson(res, 404, { error: 'Not found' });
    const exists = db.prepare('SELECT 1 FROM comment_likes WHERE user_id=? AND comment_id=?').get(user.id, cid);
    if (exists) {
      db.prepare('DELETE FROM comment_likes WHERE user_id=? AND comment_id=?').run(user.id, cid);
      db.prepare('UPDATE comments SET likes = MAX(0, likes - 1) WHERE id=?').run(cid);
    } else {
      db.prepare('INSERT INTO comment_likes (user_id, comment_id) VALUES (?, ?)').run(user.id, cid);
      db.prepare('UPDATE comments SET likes = likes + 1 WHERE id=?').run(cid);
    }
    const likes = Number(db.prepare('SELECT likes FROM comments WHERE id=?').get(cid)?.likes ?? 0);
    sendJson(res, 200, { liked: !exists, likes });
  });

  // Delete own comment (or any comment on your own video). Removes its replies too.
  app.post('/api/comments/:id/delete', (req, res) => {
    const user = requireUser(req);
    const c = db.prepare('SELECT c.*, v.user_id AS video_owner FROM comments c JOIN videos v ON v.id=c.video_id WHERE c.id=?').get(Number(req.params.id));
    if (!c) return sendJson(res, 404, { error: 'Not found' });
    if (Number(c.user_id) !== Number(user.id) && Number(c.video_owner) !== Number(user.id)) return sendJson(res, 403, { error: 'Not allowed' });
    db.prepare('UPDATE comments SET deleted=1 WHERE id=?').run(c.id);
    db.prepare('UPDATE comments SET deleted=1 WHERE parent_id=?').run(c.id);
    sendJson(res, 200, { ok: true });
  });
}
