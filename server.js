require('dotenv').config();
const express   = require('express');
const { WebSocketServer } = require('ws');
const { createServer }    = require('http');
const path      = require('path');
const { randomUUID } = require('crypto');
const session   = require('express-session');
const passport  = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const admin     = require('firebase-admin');

// ── Firebase Setup ─────────────────────────────────────────────────────────

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
// Ensure private key newlines are real newlines (env vars can escape them)
if (serviceAccount.private_key) {
  serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
}
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ── Session Store (Firestore-backed) ───────────────────────────────────────

class FirestoreStore extends session.Store {
  constructor() {
    super();
    setInterval(async () => {
      const snap = await db.collection('sessions').where('exp', '<', Date.now()).get();
      if (snap.empty) return;
      const batch = db.batch();
      snap.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }, 60 * 60 * 1000).unref();
  }

  get(sid, cb) {
    db.collection('sessions').doc(sid).get()
      .then(doc => {
        if (!doc.exists || doc.data().exp < Date.now()) return cb(null, null);
        cb(null, JSON.parse(doc.data().sess));
      })
      .catch(e => cb(e));
  }

  set(sid, sess, cb) {
    const exp = sess.cookie?.expires
      ? new Date(sess.cookie.expires).getTime()
      : Date.now() + 30 * 24 * 60 * 60 * 1000;
    db.collection('sessions').doc(sid)
      .set({ sess: JSON.stringify(sess), exp })
      .then(() => cb?.(null))
      .catch(e => cb?.(e));
  }

  destroy(sid, cb) {
    db.collection('sessions').doc(sid).delete()
      .then(() => cb?.(null))
      .catch(e => cb?.(e));
  }
}

// ── Middleware ─────────────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: '4mb' }));

app.use(session({
  store: new FirestoreStore(),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me-in-env',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 },
}));

app.use(passport.initialize());
app.use(passport.session());

// ── Passport ───────────────────────────────────────────────────────────────

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

function isEmailAllowed(email) {
  if (!ALLOWED_EMAILS.length) return true;
  return ALLOWED_EMAILS.includes((email || '').toLowerCase());
}

const googleEnabled = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
if (googleEnabled) {
  passport.use(new GoogleStrategy({
    clientID:     process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL:  (process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`) + '/auth/google/callback',
  }, (_at, _rt, profile, done) => {
    const email = profile.emails?.[0]?.value;
    if (!isEmailAllowed(email)) return done(null, false);
    done(null, { id: profile.id, name: profile.displayName, email, photo: profile.photos?.[0]?.value });
  }));
}

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
      callbackURL:      process.env.APP_URL + '/auth/apple/callback',
      scope:            ['name', 'email'],
    }, (_at, _rt, _id, profile, done) => {
      const email = profile?.email;
      if (!isEmailAllowed(email)) return done(null, false);
      done(null, {
        id: profile.sub,
        name: [profile.name?.firstName, profile.name?.lastName].filter(Boolean).join(' ') || 'Apple User',
        email, photo: null,
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

// ── Public Routes ──────────────────────────────────────────────────────────

app.get('/login', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/auth/config', (_req, res) => res.json({ google: googleEnabled, apple: appleEnabled }));

app.get('/auth/google',
  (req, res, next) => { if (!googleEnabled) return res.redirect('/login?error=not_configured'); next(); },
  passport.authenticate('google', { scope: ['profile', 'email'] }),
);
app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login?error=denied' }),
  (_req, res) => res.redirect('/'),
);

if (appleEnabled) {
  app.get('/auth/apple', passport.authenticate('apple'));
  app.post('/auth/apple/callback',
    passport.authenticate('apple', { failureRedirect: '/login?error=denied' }),
    (_req, res) => res.redirect('/'),
  );
}

app.get('/auth/logout', (req, res) => req.logout(() => res.redirect('/login')));

// ── Protected Routes ───────────────────────────────────────────────────────

app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/me', (req, res) => res.json(req.user));

// ── Pages API ──────────────────────────────────────────────────────────────

app.get('/api/pages', async (req, res) => {
  try {
    const snap = await db.collection('pages').orderBy('created_at').get();
    res.json(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/pages', async (req, res) => {
  try {
    const { title = 'Untitled', emoji = '📄', parent_id = null } = req.body;
    const now = Date.now();

    const siblingsSnap = await db.collection('pages')
      .where('parent_id', '==', parent_id)
      .orderBy('position', 'desc')
      .limit(1)
      .get();
    const position = siblingsSnap.empty ? 0 : siblingsSnap.docs[0].data().position + 1;

    const id = randomUUID();
    const page = {
      title, emoji, cover: null, parent_id, position,
      created_at: now, updated_at: now,
      blocks: [{ id: randomUUID(), type: 'paragraph', content: '', checked: false, indent: 0 }],
    };
    await db.collection('pages').doc(id).set(page);
    const result = { id, ...page };
    broadcast({ type: 'page_created', page: result });
    res.status(201).json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/pages/:id', async (req, res) => {
  try {
    const { title, emoji, cover, parent_id, position } = req.body;
    const updates = { updated_at: Date.now() };
    if (title     !== undefined) updates.title     = title;
    if (emoji     !== undefined) updates.emoji     = emoji;
    if (cover     !== undefined) updates.cover     = cover;
    if (parent_id !== undefined) updates.parent_id = parent_id;
    if (position  !== undefined) updates.position  = position;

    const ref = db.collection('pages').doc(req.params.id);
    await ref.update(updates);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Not found' });
    const page = { id: doc.id, ...doc.data() };
    broadcast({ type: 'page_updated', page });
    res.json(page);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/pages/:id', async (req, res) => {
  try {
    await deletePageCascade(req.params.id);
    broadcast({ type: 'page_deleted', id: req.params.id });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

async function deletePageCascade(id) {
  const children = await db.collection('pages').where('parent_id', '==', id).get();
  await Promise.all(children.docs.map(c => deletePageCascade(c.id)));
  await db.collection('pages').doc(id).delete();
}

// ── Blocks API ─────────────────────────────────────────────────────────────

app.get('/api/pages/:id/blocks', async (req, res) => {
  try {
    const doc = await db.collection('pages').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Page not found' });
    res.json(doc.data().blocks || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/pages/:id/blocks', async (req, res) => {
  try {
    const { blocks = [], _clientId } = req.body;
    const ref = db.collection('pages').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Page not found' });
    await ref.update({ blocks, updated_at: Date.now() });
    broadcast({ type: 'blocks_updated', pageId: req.params.id, blocks }, _clientId);
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
});
