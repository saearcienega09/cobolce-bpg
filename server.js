const express = require('express');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated BIGINT NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS archivos (
        id TEXT PRIMARY KEY,
        nombre TEXT NOT NULL,
        datos TEXT NOT NULL,
        tamano INTEGER NOT NULL DEFAULT 0,
        creado BIGINT NOT NULL DEFAULT 0
      );
    `);
    console.log('Base de datos lista');
  } finally {
    client.release();
  }
}

app.use(express.json({ limit: '5mb' }));
app.use(express.static(__dirname));

/* --- KV Store --- */
app.get('/api/kv/:key', async (req, res) => {
  try {
    const r = await pool.query('SELECT value FROM kv WHERE key = $1', [req.params.key]);
    res.json(r.rows.length ? { value: r.rows[0].value } : null);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/kv/:key', async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO kv (key, value, updated) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated = $3`,
      [req.params.key, req.body.value, Date.now()]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/kv/:key', async (req, res) => {
  try {
    await pool.query('DELETE FROM kv WHERE key = $1', [req.params.key]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/lastmod', async (req, res) => {
  try {
    const r = await pool.query('SELECT MAX(updated) as lm FROM kv');
    res.json({ lm: parseInt(r.rows[0]?.lm) || 0 });
  } catch(e) { res.json({ lm: 0 }); }
});

/* --- Archivos --- */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

app.post('/api/archivos', upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
    const id = Math.random().toString(36).slice(2,9) + Date.now().toString(36);
    const datos = req.file.buffer.toString('base64');
    await pool.query(
      'INSERT INTO archivos (id, nombre, datos, tamano, creado) VALUES ($1, $2, $3, $4, $5)',
      [id, req.file.originalname, datos, req.file.size, Date.now()]
    );
    res.json({ id, nombre: req.file.originalname, tamano: req.file.size });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/archivos/:id', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM archivos WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'No encontrado' });
    const archivo = r.rows[0];
    const buffer = Buffer.from(archivo.datos, 'base64');
    res.setHeader('Content-Disposition', `attachment; filename="${archivo.nombre}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(buffer);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/archivos/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM archivos WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initDB().then(() => {
  app.listen(PORT, () => console.log(`COBOLCE BPG corriendo en puerto ${PORT}`));
}).catch(err => {
  console.error('Error iniciando:', err);
  process.exit(1);
});
