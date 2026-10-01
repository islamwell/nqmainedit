require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const sanitizeHtml = require('sanitize-html');
const slugify = require('slugify');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const db = require('./lib/db');
const { buildAll, readManifest } = require('./lib/build');

if (!process.env.SESSION_SECRET || !process.env.ADMIN_PASS_HASH) {
  console.error('ERROR: Please set SESSION_SECRET and ADMIN_PASS_HASH in your .env file.');
  process.exit(1);
}

const SITE_DIR = path.resolve(process.env.SITE_DIR || './site');
const BASE = process.env.LECTURES_BASE || 'lectures';
const AUDIO_DIR = path.join(SITE_DIR, 'audio');
fs.mkdirSync(AUDIO_DIR, { recursive: true });

const RESERVED = new Set([BASE, 'audio', 'admin', 'api', 'wp-content', 'wp-includes', 'wp-admin', 'courses', 'feed']);

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ---------- CORS for Bookmarklet (allows editing live nurulquran.com pages) ----------
const ALLOWED_ORIGINS = new Set([
  'https://nurulquran.com',
  'https://www.nurulquran.com',
  'https://fast.nurulquran.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// When serving cross-origin (bookmarklet), cookies need sameSite=none + secure=true.
// In local dev (COOKIE_SECURE=0) we use sameSite=lax so it still works on localhost.
const cookieSecure = process.env.COOKIE_SECURE === '1';

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: cookieSecure ? 'none' : 'lax',
    secure: cookieSecure,
    maxAge: 8 * 3600e3 // 8 hours
  },
}));

const rebuild = data => buildAll(data, { siteDir: SITE_DIR, base: BASE });

const makeSlug = s => slugify(String(s || ''), { lower: true, strict: true, trim: true }).slice(0, 80);

const h = fn => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Operation failed' });
  }
};

// ---------- Authentication ----------
const attempts = new Map();

app.post('/api/login', async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const a = attempts.get(ip) || { n: 0, t: Date.now() };

  if (a.n >= 5 && Date.now() - a.t < 15 * 60e3) {
    return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  }

  const { username, password } = req.body || {};
  const ok = username === process.env.ADMIN_USER && await bcrypt.compare(String(password || ''), process.env.ADMIN_PASS_HASH);

  if (!ok) {
    attempts.set(ip, { n: a.n + 1, t: Date.now() });
    return res.status(401).json({ error: 'Wrong username or password' });
  }

  attempts.delete(ip);
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Session creation failed' });
    req.session.user = username;
    res.json({ ok: true });
  });
});

app.use('/api', (req, res, next) => {
  if (req.session && req.session.user) return next();
  res.status(401).json({ error: 'Please sign in' });
});

app.get('/api/me', (req, res) => {
  res.json({
    user: req.session.user,
    siteUrl: process.env.SITE_URL || '',
    base: BASE,
    version: 'v1.0.3'
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ---------- Audio Library & Uploads ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const d = path.join(AUDIO_DIR, String(new Date().getFullYear()));
    fs.mkdirSync(d, { recursive: true });
    cb(null, d);
  },
  filename: (req, file, cb) => {
    const base = makeSlug(path.parse(file.originalname).name) || 'audio';
    cb(null, `${base}-${db.newId().slice(0, 4)}.mp3`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max per lecture
  fileFilter: (req, file, cb) => cb(null, /\.mp3$/i.test(file.originalname)),
});

function looksLikeMp3(file) {
  try {
    const b = Buffer.alloc(3);
    const fd = fs.openSync(file, 'r');
    fs.readSync(fd, b, 0, 3, 0);
    fs.closeSync(fd);
    return b.toString() === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0);
  } catch {
    return false;
  }
}

app.post('/api/audio', upload.single('file'), h(async (req, res) => {
  if (!req.file) throw new Error('Please choose an .mp3 file');
  if (!looksLikeMp3(req.file.path)) {
    try { fs.rmSync(req.file.path, { force: true }); } catch {}
    throw new Error('This file is not a valid MP3 audio file');
  }

  const rel = path.relative(SITE_DIR, req.file.path).split(path.sep).join('/');
  const data = db.load();
  const a = {
    id: db.newId(),
    title: String(req.body.title || path.parse(req.file.originalname).name),
    url: '/' + rel,
    file: rel,
    size: req.file.size,
    duration: Number(req.body.duration) || null,
    uploadedAt: new Date().toISOString(),
  };

  data.audio = data.audio || [];
  data.audio.unshift(a);
  db.save(data);
  res.json(a);
}));

app.delete('/api/audio/:id', h(async (req, res) => {
  const data = db.load();
  data.audio = data.audio || [];
  data.lectures = data.lectures || [];

  const a = data.audio.find(x => x.id === req.params.id);
  if (!a) throw new Error('Audio file not found');

  const used = data.lectures.filter(l => l.audioId === a.id);
  if (used.length) {
    throw new Error(`Used by ${used.length} lecture(s): "${used[0].title}". Remove it from lectures first.`);
  }

  if (a.file) {
    try {
      fs.rmSync(path.join(SITE_DIR, a.file), { force: true });
    } catch (err) {
      console.warn('Could not delete audio file from disk:', err.message);
    }
  }

  data.audio = data.audio.filter(x => x.id !== a.id);
  db.save(data);
  res.json({ ok: true });
}));

// ---------- Pages / Courses / Lectures Collections ----------
const SCHEMAS = {
  pages: { title: 'str', slug: 'str', description: 'str', content: 'html', published: 'bool' },
  courses: { title: 'str', slug: 'str', year: 'num', description: 'str', order: 'num', published: 'bool' },
  lectures: { title: 'str', slug: 'str', courseId: 'str', number: 'num', date: 'str', speaker: 'str', description: 'str', audioId: 'str', audioUrl: 'str', published: 'bool' },
};

const SANITIZE = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'u', 'span']),
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height'],
    '*': ['dir', 'class', 'style']
  },
};

function clean(col, body = {}) {
  const out = {};
  for (const [k, t] of Object.entries(SCHEMAS[col])) {
    if (!(k in body)) continue;
    const v = body[k];
    if (t === 'bool') {
      out[k] = !!v;
    } else if (t === 'num') {
      const n = Number(v);
      out[k] = v === '' || v == null || isNaN(n) ? null : n;
    } else if (t === 'html') {
      out[k] = sanitizeHtml(String(v || ''), SANITIZE);
    } else {
      out[k] = String(v ?? '').trim();
    }
  }
  return out;
}

function validate(col, item, data) {
  if (!item.title) throw new Error('Title is required');
  
  // Safe slug generation with fallback for non-Latin characters (Urdu/Arabic)
  const fallback = col === 'lectures' ? `lecture-${item.number ?? item.id}` : item.id;
  item.slug = makeSlug(item.slug || item.title) || fallback;

  const siblings = (data[col] || []).filter(x => x.id !== item.id && (col !== 'lectures' || x.courseId === item.courseId));
  if (siblings.some(x => x.slug === item.slug)) {
    throw new Error(`The web address "${item.slug}" is already in use. Please choose another.`);
  }

  if (col === 'pages') {
    if (RESERVED.has(item.slug)) {
      throw new Error(`"${item.slug}" is a reserved address. Please choose another.`);
    }
    const f = `${item.slug}/index.html`;
    if (fs.existsSync(path.join(SITE_DIR, f)) && !readManifest().includes(f)) {
      throw new Error(`A page from the static website already exists at /${item.slug}/. Choose another address.`);
    }
  }

  if (col === 'lectures') {
    if (!(data.courses || []).some(c => c.id === item.courseId)) {
      throw new Error('Please select a valid course for this lecture.');
    }
    if (item.audioUrl && !/^(https?:\/\/|\/)/i.test(item.audioUrl)) {
      throw new Error('Audio link must start with https:// or /');
    }
  }
}

const COLS = Object.keys(SCHEMAS);
const guard = (req, res, next) => (COLS.includes(req.params.col) ? next() : res.status(404).json({ error: 'Not found' }));

app.get('/api/:col', (req, res) => {
  const data = db.load();
  if (!(req.params.col in data)) return res.status(404).json({ error: 'Collection not found' });
  res.json(data[req.params.col]);
});

app.post('/api/:col', guard, h(async (req, res) => {
  const { col } = req.params;
  const data = db.load();
  data[col] = data[col] || [];
  
  const item = {
    id: db.newId(),
    createdAt: new Date().toISOString(),
    published: true,
    ...clean(col, req.body)
  };

  validate(col, item, data);
  data[col].push(item);
  db.save(data);
  const buildResult = rebuild(data);
  res.json({ item, ...buildResult });
}));

app.put('/api/:col/:id', guard, h(async (req, res) => {
  const { col, id } = req.params;
  const data = db.load();
  data[col] = data[col] || [];
  
  const i = data[col].findIndex(x => x.id === id);
  if (i < 0) throw new Error('Item not found');

  const item = {
    ...data[col][i],
    ...clean(col, req.body),
    id,
    updatedAt: new Date().toISOString()
  };

  validate(col, item, data);
  data[col][i] = item;
  db.save(data);
  const buildResult = rebuild(data);
  res.json({ item, ...buildResult });
}));

app.delete('/api/:col/:id', guard, h(async (req, res) => {
  const { col, id } = req.params;
  const data = db.load();
  data[col] = data[col] || [];
  data.lectures = data.lectures || [];

  if (col === 'courses') {
    const n = data.lectures.filter(l => l.courseId === id).length;
    if (n) throw new Error(`This course has ${n} lecture(s). Delete or move them first before deleting the course.`);
  }

  data[col] = data[col].filter(x => x.id !== id);
  db.save(data);
  const buildResult = rebuild(data);
  res.json({ ok: true, ...buildResult });
}));

// ---------- In-Page WYSIWYG Direct HTML Save ----------
app.post('/api/inpage/save', h(async (req, res) => {
  const { path: relPath, html } = req.body || {};
  if (!relPath || !html) throw new Error('Path and HTML content are required');

  const safeRelPath = path.normalize(relPath).replace(/^(\.\.[\/\\])+/, '');
  const targetFile = path.join(SITE_DIR, safeRelPath);

  // Safety: Prevent writing outside SITE_DIR
  if (!targetFile.startsWith(SITE_DIR)) {
    throw new Error('Invalid target path');
  }

  // Backup existing file if present
  if (fs.existsSync(targetFile)) {
    const backupDir = path.join(path.dirname(process.env.DATA_FILE || './data/db.json'), 'backups', 'pages');
    fs.mkdirSync(backupDir, { recursive: true });
    const backupName = `${safeRelPath.replace(/[\/\\]/g, '_')}-${Date.now()}.html`;
    try {
      fs.copyFileSync(targetFile, path.join(backupDir, backupName));
    } catch {}
  }

  // Write new content to disk
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  fs.writeFileSync(targetFile, html, 'utf8');

  // If this file matches a slug in db.pages, sync its content property as well
  const data = db.load();
  const slug = safeRelPath.replace(/\/index\.html$/, '').replace(/\.html$/, '');
  const page = (data.pages || []).find(p => p.slug === slug);
  if (page) {
    // Extract main or article content if found
    const match = html.match(/<article[\s\S]*?<\/article>/i) || html.match(/<main[\s\S]*?<\/main>/i);
    if (match) {
      page.content = match[0];
      db.save(data);
    }
  }

  res.json({ ok: true, file: safeRelPath });
}));

// ---------- Publish Action ----------
app.post('/api/publish', h(async (req, res) => {
  const r = rebuild(db.load());
  const deployCmd = process.env.DEPLOY_CMD;

  if (!deployCmd) {
    return res.json({ message: '✓ Static site rebuilt and ready. Changes are live.', ...r });
  }

  const deployCwd = path.resolve(process.env.DEPLOY_CWD || SITE_DIR);
  exec(deployCmd, { cwd: deployCwd, timeout: 10 * 60e3, maxBuffer: 10e6 }, (err, stdout, stderr) => {
    if (err) {
      console.error('Publish command error:', err, stderr);
      return res.status(500).json({
        error: 'Publish failed: ' + String(stderr || err.message).slice(-400)
      });
    }
    res.json({ message: '✓ Published to the live website', ...r });
  });
}));

// ---------- Static Serving & Routing ----------
app.use('/admin', express.static(path.join(__dirname, 'admin')));
app.use('/audio', express.static(AUDIO_DIR));

if (process.env.SERVE_SITE === '1') {
  app.use(express.static(SITE_DIR));
}

app.get('/', (req, res) => {
  if (process.env.SERVE_SITE === '1' && fs.existsSync(path.join(SITE_DIR, 'index.html'))) {
    return res.sendFile(path.join(SITE_DIR, 'index.html'));
  }
  res.redirect('/admin/');
});

// Generic error handler
app.use((err, req, res, next) => {
  console.error('Express error:', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
let server = null;
if (require.main === module) {
  server = app.listen(PORT, () => {
    console.log(`\n===========================================`);
    console.log(`NurulQuran Admin running at: http://localhost:${PORT}/admin/`);
    console.log(`Static site directory: ${SITE_DIR}`);
    console.log(`===========================================\n`);
  });
}

module.exports = { app, server };
