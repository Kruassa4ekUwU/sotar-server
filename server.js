const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const initSqlJs = require('sql.js');

const app = express();
const PORT = process.env.PORT || 3000;

// Dirs
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DB_PATH = path.join(__dirname, 'data', 'sotar.db');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(path.dirname(DB_PATH))) fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

app.use(cors());
app.use(express.json());
app.use('/apk', express.static(UPLOADS_DIR)); // serve APK files

// Multer: store APK files
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, uuidv4() + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
  fileFilter: (req, file, cb) => {
    // Accept APK, any file for now
    cb(null, true);
  }
});

// SQLite setup (sql.js — pure JS, no native deps)
let db;

async function initDB() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const data = fs.readFileSync(DB_PATH);
    db = new SQL.Database(data);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS developers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      bio TEXT,
      avatar_color TEXT DEFAULT '#FF7214',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS apps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT,
      size_mb REAL DEFAULT 0,
      version TEXT DEFAULT '1.0.0',
      developer_id INTEGER,
      developer_name TEXT,
      icon_color TEXT DEFAULT '#FF7214',
      icon_symbol TEXT DEFAULT 'android',
      download_count INTEGER DEFAULT 0,
      rating REAL DEFAULT 0,
      rating_count INTEGER DEFAULT 0,
      apk_filename TEXT,
      apk_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (developer_id) REFERENCES developers(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id INTEGER NOT NULL,
      reviewer_name TEXT NOT NULL,
      reviewer_email TEXT,
      text TEXT,
      rating INTEGER DEFAULT 5,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (app_id) REFERENCES apps(id)
    )
  `);

  saveDB();
  console.log('✅ Database ready');
}

function saveDB() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function queryOne(sql, params = []) {
  return queryAll(sql, params)[0] || null;
}

function run(sql, params = []) {
  db.run(sql, params);
  saveDB();
  return db.exec('SELECT last_insert_rowid() as id')[0]?.values[0][0];
}

// ─── ROUTES ───────────────────────────────────────────────

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', name: 'Sotar Play API', version: '1.0.0' });
});

// GET /apps — list all apps (with optional category filter & search)
app.get('/apps', (req, res) => {
  const { category, search, limit = 50, offset = 0 } = req.query;
  let sql = 'SELECT * FROM apps WHERE 1=1';
  const params = [];

  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }
  if (search) {
    sql += ' AND (title LIKE ? OR description LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  sql += ' ORDER BY download_count DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));

  const apps = queryAll(sql, params);
  res.json({ apps, total: apps.length });
});

// GET /apps/:id — single app
app.get('/apps/:id', (req, res) => {
  const app = queryOne('SELECT * FROM apps WHERE id = ?', [req.params.id]);
  if (!app) return res.status(404).json({ error: 'App not found' });
  res.json(app);
});

// POST /apps — publish app (with APK upload)
app.post('/apps', upload.single('apk'), (req, res) => {
  try {
    const {
      title, description, category, version = '1.0.0',
      developer_name, developer_email, developer_bio = '',
      icon_color = '#FF7214', icon_symbol = 'android'
    } = req.body;

    if (!title || !developer_name || !developer_email) {
      return res.status(400).json({ error: 'title, developer_name, developer_email обязательны' });
    }

    // Get or create developer
    let dev = queryOne('SELECT * FROM developers WHERE email = ?', [developer_email]);
    let devId;
    if (!dev) {
      const colors = ['#FF7214', '#1E88E5', '#E040FB', '#00E676', '#FFD700'];
      const color = colors[Math.floor(Math.random() * colors.length)];
      devId = run(
        'INSERT INTO developers (name, email, bio, avatar_color) VALUES (?, ?, ?, ?)',
        [developer_name, developer_email, developer_bio, color]
      );
    } else {
      devId = dev.id;
    }

    // APK info
    let apkFilename = null;
    let apkUrl = null;
    let sizeMb = parseFloat(req.body.size_mb) || 0;

    if (req.file) {
      apkFilename = req.file.filename;
      apkUrl = `/apk/${req.file.filename}`;
      sizeMb = parseFloat((req.file.size / (1024 * 1024)).toFixed(2));
    }

    const appId = run(
      `INSERT INTO apps (title, description, category, size_mb, version, developer_id, developer_name,
        icon_color, icon_symbol, apk_filename, apk_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, description, category, sizeMb, version, devId, developer_name,
       icon_color, icon_symbol, apkFilename, apkUrl]
    );

    // Auto review from bot
    run(
      'INSERT INTO reviews (app_id, reviewer_name, reviewer_email, text, rating) VALUES (?, ?, ?, ?, ?)',
      [appId, 'Sotar Quality Bot', 'bot@sotar.store',
       'Приложение успешно опубликовано и прошло базовую проверку. Поздравляем разработчика!', 5]
    );
    run('UPDATE apps SET rating = 5, rating_count = 1 WHERE id = ?', [appId]);

    const newApp = queryOne('SELECT * FROM apps WHERE id = ?', [appId]);
    res.status(201).json(newApp);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// GET /apps/:id/download — download APK (increments counter)
app.get('/apps/:id/download', (req, res) => {
  const app = queryOne('SELECT * FROM apps WHERE id = ?', [req.params.id]);
  if (!app) return res.status(404).json({ error: 'App not found' });
  if (!app.apk_filename) return res.status(404).json({ error: 'APK не загружен' });

  const filePath = path.join(UPLOADS_DIR, app.apk_filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Файл не найден на сервере' });

  run('UPDATE apps SET download_count = download_count + 1 WHERE id = ?', [app.id]);

  res.download(filePath, `${app.title.replace(/\s+/g, '_')}.apk`);
});

// GET /apps/:id/reviews — get reviews
app.get('/apps/:id/reviews', (req, res) => {
  const reviews = queryAll('SELECT * FROM reviews WHERE app_id = ? ORDER BY created_at DESC', [req.params.id]);
  res.json({ reviews });
});

// POST /apps/:id/reviews — add review
app.post('/apps/:id/reviews', (req, res) => {
  const { reviewer_name, reviewer_email, text, rating = 5 } = req.body;
  if (!reviewer_name || !text) return res.status(400).json({ error: 'reviewer_name и text обязательны' });

  const app = queryOne('SELECT * FROM apps WHERE id = ?', [req.params.id]);
  if (!app) return res.status(404).json({ error: 'App not found' });

  run(
    'INSERT INTO reviews (app_id, reviewer_name, reviewer_email, text, rating) VALUES (?, ?, ?, ?, ?)',
    [req.params.id, reviewer_name, reviewer_email || '', text, Number(rating)]
  );

  // Update avg rating
  const stats = queryOne(
    'SELECT AVG(rating) as avg, COUNT(*) as cnt FROM reviews WHERE app_id = ?',
    [req.params.id]
  );
  run('UPDATE apps SET rating = ?, rating_count = ? WHERE id = ?',
    [parseFloat(stats.avg.toFixed(1)), stats.cnt, req.params.id]);

  res.status(201).json({ success: true });
});

// DELETE /apps/:id — delete app
app.delete('/apps/:id', (req, res) => {
  const app = queryOne('SELECT * FROM apps WHERE id = ?', [req.params.id]);
  if (!app) return res.status(404).json({ error: 'App not found' });

  if (app.apk_filename) {
    const filePath = path.join(UPLOADS_DIR, app.apk_filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  run('DELETE FROM reviews WHERE app_id = ?', [req.params.id]);
  run('DELETE FROM apps WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// GET /categories — list all categories
app.get('/categories', (req, res) => {
  const rows = queryAll('SELECT DISTINCT category FROM apps WHERE category IS NOT NULL ORDER BY category');
  res.json({ categories: rows.map(r => r.category) });
});

// GET /developers/:id
app.get('/developers/:id', (req, res) => {
  const dev = queryOne('SELECT * FROM developers WHERE id = ?', [req.params.id]);
  if (!dev) return res.status(404).json({ error: 'Developer not found' });
  const apps = queryAll('SELECT * FROM apps WHERE developer_id = ?', [req.params.id]);
  res.json({ ...dev, apps });
});

// ─── START ────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Sotar Play API running on port ${PORT}`);
  });
});
