const express = require('express');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const { createRemoteJWKSet, jwtVerify } = require('jose');
const cors = require('cors');
const helmet = require('helmet');
const http = require('http');
const { WebSocketServer } = require('ws');

let wss;
const jwks = createRemoteJWKSet(new URL('/.well-known/jwks.json', process.env.SHOO_BASE_URL || 'https://shoo.dev'));

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL || '';
const APP_ORIGIN = process.env.APP_ORIGIN || 'https://microapps.work.gd';
const AUTH_BASE_URL = process.env.SHOO_BASE_URL || 'https://shoo.dev';
const AUTH_ISSUER = process.env.SHOO_ISSUER || AUTH_BASE_URL;
const PLANS_OWNER_ID = process.env.PLANS_OWNER_ID || '';
const USER_AGENT = 'Mozilla/5.0 (compatible; Microapps)';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cors({ origin: new URL(APP_ORIGIN).origin }));
app.use(helmet());

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.userId || req.ip || req.headers['x-forwarded-for'] || 'unknown';
  },
});

app.use(limiter);

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000,
  query_timeout: 15000,
});

pool.on('error', (err) => {
  console.error('unexpected pool error:', err);
});

async function initDb() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        completed BOOLEAN NOT NULL DEFAULT false,
        subtasks JSONB NOT NULL DEFAULT '[]',
        updated_at BIGINT NOT NULL DEFAULT 0,
        deleted BOOLEAN NOT NULL DEFAULT false,
        "order" INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (id, user_id)
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);');

    await client.query(`
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        folder_id TEXT,
        archived BOOLEAN NOT NULL DEFAULT false,
        subtasks JSONB NOT NULL DEFAULT '[]',
        updated_at BIGINT NOT NULL DEFAULT 0,
        deleted BOOLEAN NOT NULL DEFAULT false,
        "order" INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (id, user_id)
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes(user_id);');

    await client.query(`
      CREATE TABLE IF NOT EXISTS folders (
        id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        parent_id TEXT,
        "order" INTEGER NOT NULL DEFAULT 0,
        updated_at BIGINT NOT NULL DEFAULT 0,
        deleted BOOLEAN NOT NULL DEFAULT false,
        PRIMARY KEY (id, user_id)
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_folders_user_id ON folders(user_id);');

    await client.query(`
      CREATE TABLE IF NOT EXISTS habits (
        id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        interval_days INTEGER NOT NULL DEFAULT 1,
        last_completed_at BIGINT,
        completions JSONB NOT NULL DEFAULT '[]',
        paused BOOLEAN NOT NULL DEFAULT false,
        updated_at BIGINT NOT NULL DEFAULT 0,
        deleted BOOLEAN NOT NULL DEFAULT false,
        "order" INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (id, user_id)
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_habits_user_id ON habits(user_id);');

    await client.query(`
      CREATE TABLE IF NOT EXISTS shares (
        id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        size BIGINT NOT NULL DEFAULT 0,
        mime_type TEXT NOT NULL DEFAULT '',
        host TEXT NOT NULL DEFAULT '',
        external_id TEXT NOT NULL DEFAULT '',
        download_url TEXT NOT NULL DEFAULT '',
        archived BOOLEAN NOT NULL DEFAULT false,
        subtasks JSONB NOT NULL DEFAULT '[]',
        expires_at BIGINT,
        updated_at BIGINT NOT NULL DEFAULT 0,
        deleted BOOLEAN NOT NULL DEFAULT false,
        "order" INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (id, user_id)
      );
    `);
    await client.query('ALTER TABLE shares ADD COLUMN IF NOT EXISTS expires_at BIGINT;');
    await client.query('CREATE INDEX IF NOT EXISTS idx_shares_user_id ON shares(user_id);');

    await client.query(`
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        platform TEXT NOT NULL DEFAULT '',
        updated_at BIGINT NOT NULL DEFAULT 0,
        deleted BOOLEAN NOT NULL DEFAULT false,
        PRIMARY KEY (id, user_id)
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);');
    await client.query(`
      CREATE TABLE IF NOT EXISTS plans (
        id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        completed BOOLEAN NOT NULL DEFAULT false,
        subtasks JSONB NOT NULL DEFAULT '[]',
        updated_at BIGINT NOT NULL DEFAULT 0,
        deleted BOOLEAN NOT NULL DEFAULT false,
        "order" INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (id, user_id)
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_plans_user_id ON plans(user_id);');
  } finally {
    client.release();
  }
}

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }

  try {
    const audience = `origin:${new URL(APP_ORIGIN).origin}`;
    const { payload } = await jwtVerify(token, jwks, { issuer: AUTH_ISSUER, audience });

    if (typeof payload.pairwise_sub !== 'string') {
      return res.status(401).json({ error: 'Invalid token: missing identity' });
    }

    req.userId = payload.pairwise_sub;
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

const TASK_COLUMNS = 'id, user_id, title, description, completed, subtasks, updated_at, deleted, "order"';
const TASK_ORDER = 'ORDER BY "order" ASC, updated_at DESC';

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

const PROXY_MAX_BYTES = 50 * 1024 * 1024;

app.post('/upload/proxy', authMiddleware, async (req, res) => {
  if (!req.is('multipart/form-data') && !req.is('application/octet-stream')) {
    return res.status(415).json({ error: 'Unsupported content type' });
  }
  const host = Array.isArray(req.query.host) ? req.query.host[0] : (req.query.host || '');
  if (!['litterbox', 'catbox'].includes(host)) {
    return res.status(400).json({ error: 'Invalid host' });
  }
  const time = Array.isArray(req.query.time) ? req.query.time[0] : (req.query.time ? String(req.query.time) : null);
  const rawFilename = Array.isArray(req.query.filename) ? req.query.filename[0] : String(req.query.filename || 'file');
  const filename = rawFilename.replace(/[\x00-\x1f\x7f"\\\r\n<>]/g, '_').slice(0, 200) || 'file';
  const rawMime = Array.isArray(req.query.mimeType) ? req.query.mimeType[0] : String(req.query.mimeType || 'application/octet-stream');
  const mimeType = rawMime.replace(/[\r\n;]/g, '').slice(0, 100) || 'application/octet-stream';

  const rawContentLength = req.headers['content-length'];
  const contentLength = rawContentLength ? parseInt(rawContentLength, 10) : null;
  if (contentLength !== null && contentLength > PROXY_MAX_BYTES) {
    return res.status(413).json({ error: 'Request entity too large' });
  }

  let targetUrl, formFields;
  if (host === 'litterbox') {
    targetUrl = 'https://litterbox.catbox.moe/resources/internals/api.php';
    formFields = [{ name: 'reqtype', value: 'fileupload' }];
    if (time) formFields.push({ name: 'time', value: time });
  } else {
    targetUrl = 'https://catbox.moe/user/api.php';
    const userhash = Array.isArray(req.query.userhash) ? req.query.userhash[0] : (req.query.userhash || '').trim();
    if (!userhash) {
      return res.status(400).json({ error: 'Catbox userhash required' });
    }
    formFields = [
      { name: 'reqtype', value: 'fileupload' },
      { name: 'userhash', value: userhash },
    ];
  }

  let aborted = false;
  const onAbort = () => {
    if (aborted) return;
    aborted = true;
    if (!res.writableEnded) res.end();
  };
  req.on('aborted', onAbort);
  res.on('close', onAbort);

  const fileChunks = [];
  let totalBytes = 0;
  try {
    for await (const chunk of req) {
      if (aborted) break;
      totalBytes += chunk.length;
      if (totalBytes > PROXY_MAX_BYTES) {
        res.status(413).json({ error: 'Request entity too large' });
        aborted = true;
        req.destroy();
        return;
      }
      fileChunks.push(chunk);
    }
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to read body' });
    }
    req.off('aborted', onAbort);
    res.off('close', onAbort);
    return;
  }
  if (aborted) {
    req.off('aborted', onAbort);
    res.off('close', onAbort);
    return;
  }
  req.off('aborted', onAbort);
  res.off('close', onAbort);

  const fileBody = Buffer.concat(fileChunks);
  const formData = new FormData();
  for (const f of formFields) {
    formData.append(f.name, f.value);
  }
  formData.append('fileToUpload', new Blob([fileBody], { type: mimeType }), filename);

  try {
    const upstreamRes = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'User-Agent': USER_AGENT },
      body: formData,
      signal: AbortSignal.timeout(60000),
    });
    const text = await upstreamRes.text();
    if (!res.writableEnded) {
      res.status(upstreamRes.status).send(text);
    }
  } catch (err) {
    if (!res.headersSent) {
      res.status(502).json({ error: 'Upstream error: ' + err.message });
    }
  }
});

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    try { client.release(); } catch {}
  }
}

async function batchUpsert(client, table, columns, items, userId, extractValues) {
  const validItems = items.filter(i => i.id);
  if (validItems.length === 0) return;

  const valueParts = [];
  const params = [];
  let paramIdx = 1;

  for (const item of validItems) {
    const vals = extractValues(item);
    const phs = [`$${paramIdx++}`, `$${paramIdx++}`];
    vals.forEach(() => phs.push(`$${paramIdx++}`));
    valueParts.push(`(${phs.join(', ')})`);
    params.push(item.id, userId, ...vals);
  }

  const allCols = ['id', 'user_id', ...columns];
  const setClauses = columns.map(c =>
    c === 'updated_at'
      ? `updated_at = CASE WHEN EXCLUDED.updated_at > ${table}.updated_at THEN EXCLUDED.updated_at ELSE ${table}.updated_at END`
      : `${c} = EXCLUDED.${c}`
  ).join(', ');

  await client.query(
    `INSERT INTO ${table} (${allCols.join(', ')})
     VALUES ${valueParts.join(',\n')}
     ON CONFLICT (id, user_id) DO UPDATE SET
       ${setClauses}`,
    params,
  );
}

const cache = new Map();
const CACHE_TTL = 30000;

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) {
    return entry.data;
  }
  cache.delete(key);
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

async function readItems(tableName, columns, order, userId, key, whereExtra, offset, limit) {
  const where = whereExtra ? ` AND ${whereExtra}` : '';
  const lim = limit || 1000;
  const off = offset || 0;
  const [dataResult, countResult] = await Promise.all([
    pool.query(
      `SELECT ${columns} FROM ${tableName} WHERE user_id = $1${where} ${order} LIMIT $2 OFFSET $3`,
      [userId, lim, off],
    ),
    pool.query(
      `SELECT COUNT(*) FROM ${tableName} WHERE user_id = $1${where}`,
      [userId],
    ),
  ]);
  const total = parseInt(countResult.rows[0].count, 10);
  return { [key || tableName]: dataResult.rows, total };
}

app.get('/tasks', authMiddleware, async (req, res) => {
  try {
    const offset = Array.isArray(req.query.offset) ? req.query.offset[0] : req.query.offset;
    const limit = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
    res.json(await readItems('tasks', TASK_COLUMNS, TASK_ORDER, req.userId, 'tasks', null, parseInt(offset) || 0, parseInt(limit) || 1000));
  } catch (err) {
    console.error('failed to fetch tasks:', err.message);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

app.post('/tasks', authMiddleware, async (req, res) => {
  const incomingTasks = req.body.tasks;
  if (!Array.isArray(incomingTasks)) {
    return res.status(400).json({ error: 'Tasks must be an array' });
  }

  try {
    await withTransaction(async (client) => {
      await batchUpsert(client, 'tasks',
        ['title', 'description', 'completed', 'subtasks', 'updated_at', 'deleted', '"order"'],
        incomingTasks, req.userId,
        (t) => [t.title || '', t.description || '', t.completed || false, JSON.stringify(t.subtasks || []), t.updated_at || Date.now(), t.deleted || false, t.order ?? 0],
      );
    });
    res.json(await readItems('tasks', TASK_COLUMNS, TASK_ORDER, req.userId, 'tasks'));
  } catch (err) {
    console.error('failed to upsert tasks:', err.message);
    res.status(500).json({ error: 'Failed to upsert data' });
  }
});

const PLAN_COLUMNS = 'id, user_id, title, description, completed, subtasks, updated_at, deleted, "order"';
const PLAN_ORDER = 'ORDER BY "order" ASC, updated_at DESC';

app.get('/plans/public', async (req, res) => {
  try {
    const cached = getCached('plans_public');
    if (cached) return res.json(cached);

    const result = await readItems('plans', PLAN_COLUMNS, PLAN_ORDER, PLANS_OWNER_ID, 'plans', 'deleted = false');
    setCache('plans_public', result);
    res.json(result);
  } catch (err) {
    console.error('failed to fetch public plans:', err.message);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

app.get('/plans', authMiddleware, async (req, res) => {
  try {
    const offset = Array.isArray(req.query.offset) ? req.query.offset[0] : req.query.offset;
    const limit = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
    res.json(await readItems('plans', PLAN_COLUMNS, PLAN_ORDER, req.userId, 'plans', null, parseInt(offset) || 0, parseInt(limit) || 1000));
  } catch (err) {
    console.error('failed to fetch plans:', err.message);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

app.post('/plans', authMiddleware, async (req, res) => {
  const incomingPlans = req.body.plans;
  if (!Array.isArray(incomingPlans)) {
    return res.status(400).json({ error: 'Plans must be an array' });
  }
  if (req.userId !== PLANS_OWNER_ID) {
    return res.status(403).json({ error: 'Only the owner can edit plans' });
  }

  try {
    await withTransaction(async (client) => {
      await batchUpsert(client, 'plans',
        ['title', 'description', 'completed', 'subtasks', 'updated_at', 'deleted', '"order"'],
        incomingPlans, req.userId,
        (p) => [p.title || '', p.description || '', p.completed || false, JSON.stringify(p.subtasks || []), p.updated_at || Date.now(), p.deleted || false, p.order ?? 0],
      );
    });
    res.json(await readItems('plans', PLAN_COLUMNS, PLAN_ORDER, req.userId, 'plans'));
  } catch (err) {
    console.error('failed to upsert plans:', err.message);
    res.status(500).json({ error: 'Failed to upsert data' });
  }
});

const NOTE_COLUMNS = 'id, user_id, title, content, folder_id, archived, subtasks, updated_at, deleted, "order"';
const NOTE_ORDER = 'ORDER BY "order" ASC, updated_at DESC';
const FOLDER_COLUMNS = 'id, user_id, name, parent_id, "order", updated_at, deleted';
const FOLDER_ORDER = 'ORDER BY "order" ASC';

app.get('/notes', authMiddleware, async (req, res) => {
  try {
    const offset = Array.isArray(req.query.offset) ? req.query.offset[0] : req.query.offset;
    const limit = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
    const [notes, folders] = await Promise.all([
      readItems('notes', NOTE_COLUMNS, NOTE_ORDER, req.userId, 'notes', null, parseInt(offset) || 0, parseInt(limit) || 1000),
      readItems('folders', FOLDER_COLUMNS, FOLDER_ORDER, req.userId, 'folders', null, parseInt(offset) || 0, parseInt(limit) || 1000),
    ]);
    res.json({ notes: notes.notes, folders: folders.folders });
  } catch (err) {
    console.error('failed to fetch notes:', err.message);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

app.post('/notes', authMiddleware, async (req, res) => {
  const incomingNotes = req.body.notes;
  if (!Array.isArray(incomingNotes)) {
    return res.status(400).json({ error: 'Notes must be an array' });
  }

  try {
    await withTransaction(async (client) => {
      await batchUpsert(client, 'notes',
        ['title', 'content', 'folder_id', 'archived', 'subtasks', 'updated_at', 'deleted', '"order"'],
        incomingNotes, req.userId,
        (n) => [n.title || '', n.content || '', n.folder_id ?? null, n.archived || false, JSON.stringify(n.subtasks || []), n.updated_at || Date.now(), n.deleted || false, n.order ?? 0],
      );
      const folderItems = req.body.folders;
      if (Array.isArray(folderItems) && folderItems.length > 0) {
        await batchUpsert(client, 'folders',
          ['name', 'parent_id', '"order"', 'updated_at', 'deleted'],
          folderItems, req.userId,
          (f) => [f.name || '', f.parent_id ?? null, f.order ?? 0, f.updated_at || Date.now(), f.deleted || false],
        );
      }
    });
    const [notesResult, foldersResult] = await Promise.all([
      pool.query(`SELECT ${NOTE_COLUMNS} FROM notes WHERE user_id = $1 ${NOTE_ORDER} LIMIT 1000`, [req.userId]),
      pool.query(`SELECT ${FOLDER_COLUMNS} FROM folders WHERE user_id = $1 ${FOLDER_ORDER} LIMIT 1000`, [req.userId]),
    ]);
    res.json({ notes: notesResult.rows, folders: foldersResult.rows });
  } catch (err) {
    console.error('failed to upsert notes:', err.message);
    res.status(500).json({ error: 'Failed to upsert data' });
  }
});

app.post('/notes/folders', authMiddleware, async (req, res) => {
  const incomingFolders = req.body.folders;
  if (!Array.isArray(incomingFolders)) {
    return res.status(400).json({ error: 'Folders must be an array' });
  }

  try {
    await withTransaction(async (client) => {
      await batchUpsert(client, 'folders',
        ['name', 'parent_id', '"order"', 'updated_at', 'deleted'],
        incomingFolders, req.userId,
        (f) => [f.name || '', f.parent_id ?? null, f.order ?? 0, f.updated_at || Date.now(), f.deleted || false],
      );
    });
    const [foldersResult, notesResult] = await Promise.all([
      pool.query(`SELECT ${FOLDER_COLUMNS} FROM folders WHERE user_id = $1 ${FOLDER_ORDER} LIMIT 1000`, [req.userId]),
      pool.query(`SELECT ${NOTE_COLUMNS} FROM notes WHERE user_id = $1 ${NOTE_ORDER} LIMIT 1000`, [req.userId]),
    ]);
    res.json({ folders: foldersResult.rows, notes: notesResult.rows });
  } catch (err) {
    console.error('failed to upsert folders:', err.message);
    res.status(500).json({ error: 'Failed to upsert data' });
  }
});

const HABIT_COLUMNS = 'id, user_id, title, interval_days, last_completed_at, completions, paused, updated_at, deleted, "order"';
const HABIT_ORDER = 'ORDER BY "order" ASC, updated_at DESC';

app.get('/habits', authMiddleware, async (req, res) => {
  try {
    const offset = Array.isArray(req.query.offset) ? req.query.offset[0] : req.query.offset;
    const limit = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
    res.json(await readItems('habits', HABIT_COLUMNS, HABIT_ORDER, req.userId, 'habits', null, parseInt(offset) || 0, parseInt(limit) || 1000));
  } catch (err) {
    console.error('failed to fetch habits:', err.message);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

app.post('/habits', authMiddleware, async (req, res) => {
  const incomingHabits = req.body.habits;
  if (!Array.isArray(incomingHabits)) {
    return res.status(400).json({ error: 'Habits must be an array' });
  }

  try {
    await withTransaction(async (client) => {
      await batchUpsert(client, 'habits',
        ['title', 'interval_days', 'last_completed_at', 'completions', 'paused', 'updated_at', 'deleted', '"order"'],
        incomingHabits, req.userId,
        (h) => [h.title || '', h.interval_days || 1, h.last_completed_at ?? null, JSON.stringify(h.completions || []), h.paused || false, h.updated_at || Date.now(), h.deleted || false, h.order ?? 0],
      );
    });
    const result = await pool.query(
      `SELECT ${HABIT_COLUMNS} FROM habits WHERE user_id = $1 ${HABIT_ORDER} LIMIT 1000`,
      [req.userId],
    );
    res.json({ habits: result.rows });
  } catch (err) {
    console.error('failed to upsert habits:', err.message);
    res.status(500).json({ error: 'Failed to upsert data' });
  }
});

const SHARE_COLUMNS = 'id, user_id, name, size, mime_type, host, external_id, download_url, archived, expires_at, updated_at, deleted, "order"';
const SHARE_ORDER = 'ORDER BY "order" ASC, updated_at DESC';

app.get('/shares', authMiddleware, async (req, res) => {
  try {
    const offset = Array.isArray(req.query.offset) ? req.query.offset[0] : req.query.offset;
    const limit = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
    res.json(await readItems('shares', SHARE_COLUMNS, SHARE_ORDER, req.userId, 'shares', null, parseInt(offset) || 0, parseInt(limit) || 1000));
  } catch (err) {
    console.error('failed to fetch shares:', err.message);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

app.post('/shares', authMiddleware, async (req, res) => {
  const incomingShares = req.body.shares;
  if (!Array.isArray(incomingShares)) {
    return res.status(400).json({ error: 'Shares must be an array' });
  }

  try {
    await withTransaction(async (client) => {
      await batchUpsert(client, 'shares',
        ['name', 'size', 'mime_type', 'host', 'external_id', 'download_url', 'archived', 'expires_at', 'updated_at', 'deleted', '"order"'],
        incomingShares, req.userId,
        (s) => [s.name || '', Number(s.size) || 0, s.mime_type || '', s.host || '', s.external_id || '', s.download_url || '', s.archived || false, s.expires_at === null ? null : Number(s.expires_at), s.updated_at || Date.now(), s.deleted || false, s.order ?? 0],
      );
    });
    const result = await pool.query(
      `SELECT ${SHARE_COLUMNS} FROM shares WHERE user_id = $1 ${SHARE_ORDER} LIMIT 1000`,
      [req.userId],
    );
    res.json({ shares: result.rows });
  } catch (err) {
    console.error('failed to upsert shares:', err.message);
    res.status(500).json({ error: 'Failed to upsert data' });
  }
});

const DEVICE_COLUMNS = 'id, user_id, name, platform, updated_at, deleted';
const DEVICE_ORDER = 'ORDER BY name ASC, updated_at DESC';

app.get('/devices', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ${DEVICE_COLUMNS} FROM devices WHERE user_id = $1 AND deleted = false ${DEVICE_ORDER}`,
      [req.userId],
    );
    res.json({ devices: result.rows });
  } catch (err) {
    console.error('failed to fetch devices:', err.message);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

app.post('/devices', authMiddleware, async (req, res) => {
  const incoming = req.body.devices;
  if (!Array.isArray(incoming)) {
    return res.status(400).json({ error: 'Devices must be an array' });
  }

  try {
    await withTransaction(async (client) => {
      const toDelete = incoming.filter(d => d.deleted);
      if (toDelete.length > 0) {
        const params = [];
        const cases = [];
        let idx = 1;
        for (const d of toDelete) {
          cases.push(`($${idx}, $${idx + 1})`);
          params.push(d.id, req.userId);
          idx += 2;
        }
        await client.query(
          `UPDATE devices SET deleted = true, updated_at = $${idx}
           WHERE (id, user_id) IN (${cases.join(', ')})`,
          [...params, Date.now()],
        );
      }
      const toUpsert = incoming.filter(d => !d.deleted);
      if (toUpsert.length > 0) {
        await batchUpsert(client, 'devices',
          ['name', 'platform', 'updated_at', 'deleted'],
          toUpsert, req.userId,
          (d) => [d.name || '', d.platform || '', d.updated_at || Date.now()],
        );
      }
    });
    const result = await pool.query(
      `SELECT ${DEVICE_COLUMNS} FROM devices WHERE user_id = $1 AND deleted = false ${DEVICE_ORDER}`,
      [req.userId],
    );
    res.json({ devices: result.rows });
  } catch (err) {
    console.error('failed to upsert devices:', err.message);
    res.status(500).json({ error: 'Failed to upsert data' });
  }
});

const onlineDevices = new Map();

function getPublicIP(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || '';
}

function sanitizeDevice(d) {
  return {
    id: d.id,
    userId: d.userId || null,
    name: d.name || '',
    platform: d.platform || '',
    inGlobal: !!d.inGlobal,
    publicIp: d.publicIp || '',
    online: true,
  };
}

function broadcastDeviceList() {
  const list = Array.from(onlineDevices.values()).map(sanitizeDevice);
  const msg = JSON.stringify({ type: 'deviceList', devices: list });
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      try { client.send(msg); } catch {}
    }
  }
}

async function loadDeviceRecord(deviceId, userId) {
  if (!userId) return null;
  try {
    const result = await pool.query(
      `SELECT name, platform FROM devices WHERE id = $1 AND user_id = $2 AND deleted = false`,
      [deviceId, userId],
    );
    return result.rows[0] || null;
  } catch (err) {
    console.error('failed to load device record:', err.message);
    return null;
  }
}

async function saveDeviceRecord(deviceId, userId, name, platform) {
  if (!userId) return;
  try {
    const now = Date.now();
    await pool.query(
      `INSERT INTO devices (id, user_id, name, platform, updated_at, deleted)
       VALUES ($1, $2, $3, $4, $5, false)
       ON CONFLICT (id, user_id) DO UPDATE SET
         name = EXCLUDED.name,
         platform = EXCLUDED.platform,
         updated_at = CASE
           WHEN EXCLUDED.updated_at > devices.updated_at THEN EXCLUDED.updated_at
           ELSE devices.updated_at
         END,
         deleted = false`,
      [deviceId, userId, name, platform, now],
    );
  } catch (err) {
    console.error('failed to save device record:', err.message);
  }
}

function relayTo(deviceId, payload) {
  const target = onlineDevices.get(deviceId);
  if (target && target.ws.readyState === 1) {
    try { target.ws.send(JSON.stringify(payload)); } catch {}
  }
}

async function verifyWsToken(token) {
  if (!token) return null;
  try {
    const audience = `origin:${new URL(APP_ORIGIN).origin}`;
    const { payload } = await jwtVerify(token, jwks, { issuer: AUTH_ISSUER, audience });
    if (typeof payload.pairwise_sub !== 'string') return null;
    return payload.pairwise_sub;
  } catch {
    return null;
  }
}

let startAttempts = 0;
const MAX_START_RETRIES = parseInt(process.env.STARTUP_RETRIES) || 5;

async function start() {
  try {
    startAttempts = 0;
    await initDb();
    const server = http.createServer(app);
    server.timeout = 120000;
    server.keepAliveTimeout = 5000;
    wss = new WebSocketServer({ server, path: '/ws' });
    wss.on('connection', async (ws, req) => {
      const url = new URL(req.url, 'http://localhost');
      const token = url.searchParams.get('token');
      const authenticatedUserId = await verifyWsToken(token);

      const publicIp = getPublicIP(req);
      let session = null;
      ws.send(JSON.stringify({ type: 'welcome', publicIp, authenticated: !!authenticatedUserId }));

      ws.on('message', async (raw) => {
        try {
          let msg;
          try { msg = JSON.parse(raw.toString()); } catch { return; }
          if (!msg || typeof msg !== 'object') return;

          if (msg.type === 'hello') {
            if (!authenticatedUserId) {
              ws.send(JSON.stringify({ type: 'error', message: 'Authentication required' }));
              return;
            }
            if (session) {
              onlineDevices.delete(session.id);
            }
            let storedName = msg.name || '';
            let storedPlatform = msg.platform || '';
            const record = await loadDeviceRecord(msg.deviceId, authenticatedUserId);
            if (record) {
              storedName = record.name || storedName;
              storedPlatform = record.platform || storedPlatform;
            }
            session = {
              id: msg.deviceId,
              userId: authenticatedUserId,
              name: storedName,
              platform: storedPlatform,
              inGlobal: !!msg.inGlobal,
              publicIp,
              ws,
            };
            onlineDevices.set(session.id, session);
            saveDeviceRecord(session.id, session.userId, session.name, session.platform).catch((e) => {
              console.error('failed to save device record (background):', e.message);
            });
            broadcastDeviceList();
          } else if (msg.type === 'rename' && session) {
            session.name = msg.name || session.name;
            await saveDeviceRecord(session.id, session.userId, session.name, session.platform);
            broadcastDeviceList();
          } else if (msg.type === 'toggleGlobal' && session) {
            session.inGlobal = !!msg.inGlobal;
            broadcastDeviceList();
          } else if (msg.type === 'signal' && session && msg.to) {
            relayTo(msg.to, { type: 'signal', from: session.id, data: msg.data });
          } else if (msg.type === 'offer' && session && msg.to) {
            relayTo(msg.to, { type: 'offer', from: session.id, file: msg.file, data: msg.data });
          } else if (msg.type === 'answer' && session && msg.to) {
            relayTo(msg.to, { type: 'answer', from: session.id, accept: !!msg.accept, data: msg.data });
          } else if (msg.type === 'cancel' && session && msg.to) {
            relayTo(msg.to, { type: 'cancel', from: session.id });
          }
        } catch (err) {
          console.error('WS message handler error:', err);
        }
      });

      ws.on('close', () => {
        if (session) {
          onlineDevices.delete(session.id);
          broadcastDeviceList();
        }
      });

      ws.on('error', (err) => {
        console.error('WS connection error:', err);
      });
    });
    server.listen(PORT, '0.0.0.0');
  } catch (err) {
    startAttempts++;
    if (startAttempts > MAX_START_RETRIES) {
      console.error('server failed to start after ' + MAX_START_RETRIES + ' attempts, giving up');
      return;
    }
    const delay = Math.min(15000 * Math.pow(2, startAttempts - 1), 120000);
    console.error('server initialization failed, retrying in ' + (delay / 1000) + 's... (attempt ' + startAttempts + '/' + MAX_START_RETRIES + ')');
    setTimeout(start, delay);
  }
}

start();
