require('dotenv').config();
const express   = require('express');
const Database  = require('better-sqlite3');
const { WebSocketServer } = require('ws');
const { createServer }    = require('http');
const path      = require('path');
const { randomUUID } = require('crypto');
const session   = require('express-session');
const passport  = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const app = express();
const db  = new Database(path.join(__dirname, 'data.db'));

// ── Database Setup ─────────────────────────────────────────────────────────

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS pages (
    id         TEXT PRIMARY KEY,
    title      TEXT    NOT NULL DEFAULT 'Untitled',
    emoji      TEXT    NOT NULL DEFAULT '📄',
    cover      TEXT    DEFAULT NULL,
    parent_id  TEXT    REFERENCES pages(id) ON DELETE CASCADE,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS blocks (
    id         TEXT    PRIMARY KEY,
    page_id    TEXT    NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    type       TEXT    NOT NULL DEFAULT 'paragraph',
    content    TEXT    NOT NULL DEFAULT '',
    checked    INTEGER NOT NULL DEFAULT 0,
    indent     INTEGER NOT NULL DEFAULT 0,
    position   INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sid  TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    exp  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_pages_parent ON pages(parent_id);
  CREATE INDEX IF NOT EXISTS idx_blocks_page  ON blocks(page_id, position);
`);

// Migrate existing databases
try { db.exec(`ALTER TABLE pages ADD COLUMN cover TEXT DEFAULT NULL`); } catch {}

// ── Session Store (SQLite-backed, survives restarts) ───────────────────────

class SQLiteStore extends session.Store {
  constructor() {
    super();
    // Prune expired sessions hourly
    setInterval(() => {
      db.prepare('DELETE FROM sessions WHERE exp < ?').run(Date.now());
    }, 60 * 60 * 1000).unref();
  }
  get(sid, cb) {
    const row = db.prepare('SELECT sess FROM sessions WHERE sid = ? AND exp > ?').get(sid, Date.now());
    cb(null, row ? JSON.parse(row.sess) : null);
  }
  set(sid, sess, cb) {
    const exp = sess.cookie?.expires
      ? new Date(sess.cookie.expires).getTime()
      : Date.now() + 30 * 24 * 60 * 60 * 1000;
    db.prepare('INSERT OR REPLACE INTO sessions (sid, sess, exp) VALUES (?,?,?)').run(sid, JSON.stringify(sess), exp);
    cb?.(null);
  }
  destroy(sid, cb) {
    db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
    cb?.(null);
  }
}

// ── Middleware ─────────────────────────────────────────────────────────────

app.use(express.json({ limit: '4mb' }));

app.use(session({
  store: new SQLiteStore(),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me-in-env',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }, // 30 days
}));

app.use(passport.initialize());
app.use(passport.session());

// ── Passport ───────────────────────────────────────────────────────────────

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

function isEmailAllowed(email) {
  if (!ALLOWED_EMAILS.length) return true; // no whitelist = anyone with a Google account
  return ALLOWED_EMAILS.includes((email || '').toLowerCase());
}

// Google
const googleEnabled = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
if (googleEnabled) {
  passport.use(new GoogleStrategy({
    clientID:     process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL:  (process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`) + '/auth/google/callback',
  }, (_at, _rt, profile, done) => {
    const email = profile.emails?.[0]?.value;
    if (!isEmailAllowed(email)) return done(null, false);
    done(null, {
      id:    profile.id,
      name:  profile.displayName,
      email,
      photo: profile.photos?.[0]?.value,
    });
  }));
}

// Apple (requires HTTPS callback URL — see README)
let appleEnabled = false;
try {
  if (process.env.APPLE_CLIENT_ID && process.env.APPLE_TEAM_ID &&
      process.env.APPLE_KEY_ID    && process.env.APPLE_PRIVATE_KEY) {
    const AppleStrategy = require('passport-apple');
    passport.use(new AppleStrategy({
      clientID:         process.env.APPLE_CLIENT_ID,
      teamID:           process.env.APPLE_TEAM_ID,
      keyID:            process.env.APPLE_KEY_ID,
      privateKeyString: process.env.APPLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      callbackURL:      (process.env.APP_URL) + '/auth/apple/callback',
      scope:            ['name', 'email'],
    }, (_at, _rt, _id, profile, done) => {
      const email = profile?.email;
      if (!isEmailAllowed(email)) return done(null, false);
      done(null, {
        id:    profile.sub,
        name:  [profile.name?.firstName, profile.name?.lastName].filter(Boolean).join(' ') || 'Apple User',
        email,
        photo: null,
      });
    }));
    appleEnabled = true;
  }
} catch (err) {
  console.warn('Apple Sign In not configured:', err.message);
}

// ── Auth helpers ───────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
  res.redirect('/login');
}

// ── Public Routes (no auth required) ──────────────────────────────────────

app.get('/login', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Tells the login page which providers are configured
app.get('/auth/config', (_req, res) => {
  res.json({ google: googleEnabled, apple: appleEnabled });
});

// Google OAuth flow
app.get('/auth/google',
  (req, res, next) => {
    if (!googleEnabled) return res.redirect('/login?error=not_configured');
    next();
  },
  passport.authenticate('google', { scope: ['profile', 'email'] }),
);
app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login?error=denied' }),
  (_req, res) => res.redirect('/'),
);

// Apple OAuth flow
if (appleEnabled) {
  app.get('/auth/apple', passport.authenticate('apple'));
  app.post('/auth/apple/callback',
    passport.authenticate('apple', { failureRedirect: '/login?error=denied' }),
    (_req, res) => res.redirect('/'),
  );
}

// Logout
app.get('/auth/logout', (req, res) => {
  req.logout(() => res.redirect('/login'));
});

// ── Protected Routes ───────────────────────────────────────────────────────

app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public')));

// Expose logged-in user info to the frontend
app.get('/api/me', (req, res) => res.json(req.user));

// ── Pages API ──────────────────────────────────────────────────────────────

app.get('/api/pages', (req, res) => {
  try {
    res.json(db.prepare('SELECT * FROM pages ORDER BY parent_id NULLS FIRST, position, created_at').all());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/pages', (req, res) => {
  try {
    const { title = 'Untitled', emoji = '📄', parent_id = null } = req.body;
    const id = randomUUID();
    const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) AS mp FROM pages WHERE parent_id IS ?').get(parent_id);
    const position = (maxPos?.mp ?? -1) + 1;
    db.prepare('INSERT INTO pages (id, title, emoji, parent_id, position) VALUES (?,?,?,?,?)').run(id, title, emoji, parent_id, position);
    db.prepare('INSERT INTO blocks (id, page_id, type, content, position) VALUES (?,?,?,?,?)').run(randomUUID(), id, 'paragraph', '', 0);
    const page = db.prepare('SELECT * FROM pages WHERE id = ?').get(id);
    broadcast({ type: 'page_created', page });
    res.status(201).json(page);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/pages/:id', (req, res) => {
  try {
    const { title, emoji, cover, parent_id, position } = req.body;
    const sets = ['updated_at = unixepoch()'];
    const vals = [];
    if (title     !== undefined) { sets.push('title = ?');     vals.push(title); }
    if (emoji     !== undefined) { sets.push('emoji = ?');     vals.push(emoji); }
    if (cover     !== undefined) { sets.push('cover = ?');     vals.push(cover); }
    if (parent_id !== undefined) { sets.push('parent_id = ?'); vals.push(parent_id); }
    if (position  !== undefined) { sets.push('position = ?');  vals.push(position); }
    vals.push(req.params.id);
    db.prepare(`UPDATE pages SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    const page = db.prepare('SELECT * FROM pages WHERE id = ?').get(req.params.id);
    if (!page) return res.status(404).json({ error: 'Not found' });
    broadcast({ type: 'page_updated', page });
    res.json(page);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/pages/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM pages WHERE id = ?').run(req.params.id);
    broadcast({ type: 'page_deleted', id: req.params.id });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Blocks API ─────────────────────────────────────────────────────────────

app.get('/api/pages/:id/blocks', (req, res) => {
  try {
    res.json(db.prepare('SELECT * FROM blocks WHERE page_id = ? ORDER BY position').all(req.params.id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/pages/:id/blocks', (req, res) => {
  try {
    const { blocks = [] } = req.body;
    const pageId = req.params.id;
    const page = db.prepare('SELECT id FROM pages WHERE id = ?').get(pageId);
    if (!page) return res.status(404).json({ error: 'Page not found' });
    db.transaction(() => {
      db.prepare('DELETE FROM blocks WHERE page_id = ?').run(pageId);
      const ins = db.prepare('INSERT INTO blocks (id, page_id, type, content, checked, indent, position) VALUES (?,?,?,?,?,?,?)');
      blocks.forEach((b, i) => ins.run(b.id || randomUUID(), pageId, b.type || 'paragraph', b.content || '', b.checked ? 1 : 0, b.indent || 0, i));
    })();
    broadcast({ type: 'blocks_updated', pageId, blocks }, req.body._clientId);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── WebSocket ──────────────────────────────────────────────────────────────

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });
const clients = new Map();

function broadcast(data, excludeClientId = null) {
  const msg = JSON.stringify(data);
  for (const [ws, cid] of clients) {
    if (cid !== excludeClientId && ws.readyState === 1) ws.send(msg);
  }
}

wss.on('connection', ws => {
  const clientId = randomUUID();
  clients.set(ws, clientId);
  ws.send(JSON.stringify({ type: 'hello', clientId }));
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

// ── Start ──────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, '0.0.0.0', () => {
  const { networkInterfaces } = require('os');
  let localIp = 'localhost';
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) { localIp = iface.address; break; }
    }
  }
  console.log('\n✅  Our Notion is running!\n');
  console.log(`   💻  Local:   http://localhost:${PORT}`);
  console.log(`   📱  Phone:   http://${localIp}:${PORT}`);
  console.log(`\n   🔐  Auth:    Google ${googleEnabled ? '✓' : '✗ (not configured)'}  |  Apple ${appleEnabled ? '✓' : '✗ (not configured)'}\n`);
  if (!googleEnabled) {
    console.log('   ⚠️   Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env to enable login.\n');
  }
});
