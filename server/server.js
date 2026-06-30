const express = require('express');
const { Pool } = require('pg');
const { createRemoteJWKSet, jwtVerify } = require('jose');
const cors = require('cors');
const http = require('http');
const https = require('https');
const { WebSocketServer } = require('ws');

let wss;

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cors());

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const APP_ORIGIN = process.env.APP_ORIGIN || 'https://microapps.work.gd';
const SHOO_BASE_URL = process.env.SHOO_BASE_URL || 'https://shoo.dev';
const SHOO_ISSUER = process.env.SHOO_ISSUER || SHOO_BASE_URL;
const USER_AGENT = 'Mozilla/5.0 (compatible; Microapps)';

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000,
  query_timeout: 15000,
});

pool.on('error', (err) => {
  console.error('Unexpected pool error:', err);
  process.exit(1);
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
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);`);

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
    await client.query(`CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes(user_id);`);

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
    await client.query(`CREATE INDEX IF NOT EXISTS idx_folders_user_id ON folders(user_id);`);

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
    await client.query(`CREATE INDEX IF NOT EXISTS idx_habits_user_id ON habits(user_id);`);

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
    await client.query(`ALTER TABLE shares ADD COLUMN IF NOT EXISTS expires_at BIGINT;`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_shares_user_id ON shares(user_id);`);

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
    await client.query(`CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);`);
  } finally {
    client.release();
  }
}

const jwks = createRemoteJWKSet(new URL('/.well-known/jwks.json', SHOO_BASE_URL));

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }

  try {
    const audience = `origin:${new URL(APP_ORIGIN).origin}`;
    const { payload } = await jwtVerify(token, jwks, { issuer: SHOO_ISSUER, audience });

    if (typeof payload.pairwise_sub !== 'string') {
      return res.status(401).json({ error: 'Invalid token: missing identity' });
    }

    req.userId = payload.pairwise_sub;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

const TASK_COLUMNS = `id, user_id, title, description, completed, subtasks, updated_at, deleted, "order"`;
const TASK_ORDER = `ORDER BY "order" ASC, updated_at DESC`;

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.post('/upload/proxy', authMiddleware, async (req, res) => {
  const host = Array.isArray(req.query.host) ? req.query.host[0] : (req.query.host || '');
  const time = Array.isArray(req.query.time) ? req.query.time[0] : (req.query.time ? String(req.query.time) : null);
  const rawFilename = Array.isArray(req.query.filename) ? req.query.filename[0] : String(req.query.filename || 'file');
  const filename = rawFilename.replace(/[\x00-\x1f\x7f"\\\r\n<>]/g, '_').slice(0, 200) || 'file';
  const rawMime = Array.isArray(req.query.mimeType) ? req.query.mimeType[0] : String(req.query.mimeType || 'application/octet-stream');
  const mimeType = rawMime.replace(/[\r\n;]/g, '').slice(0, 100) || 'application/octet-stream';

  let targetUrl, formFields;
  if (host === 'litterbox') {
    targetUrl = 'https://litterbox.catbox.moe/resources/internals/api.php';
    formFields = [{ name: 'reqtype', value: 'fileupload' }];
    if (time) formFields.push({ name: 'time', value: time });
  } else if (host === 'catbox') {
    targetUrl = 'https://catbox.moe/user/api.php';
    const userhash = Array.isArray(req.query.userhash) ? req.query.userhash[0] : (req.query.userhash || '').trim();
    if (!userhash) {
      return res.status(400).json({ error: 'catbox userhash required' });
    }
    formFields = [
      { name: 'reqtype', value: 'fileupload' },
      { name: 'userhash', value: userhash },
    ];
  } else {
    return res.status(400).json({ error: 'invalid host' });
  }

  const boundary = '----MicroBoundary' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const CRLF = '\r\n';

  const headerParts = [];
  for (const f of formFields) {
    headerParts.push(Buffer.from('--' + boundary + CRLF + 'Content-Disposition: form-data; name="' + f.name + '"' + CRLF + CRLF + f.value + CRLF));
  }
  headerParts.push(Buffer.from('--' + boundary + CRLF + 'Content-Disposition: form-data; name="fileToUpload"; filename="' + filename + '"' + CRLF + 'Content-Type: ' + mimeType + CRLF + CRLF));
  const headerBuf = Buffer.concat(headerParts);
  const footerBuf = Buffer.from(CRLF + '--' + boundary + '--' + CRLF);

  let aborted = false;
  const onAbort = () => {
    if (aborted) return;
    aborted = true;
    try { if (!res.writableEnded) res.end(); } catch {}
  };
  req.on('aborted', onAbort);
  res.on('close', onAbort);

  const fileChunks = [];
  try {
    for await (const chunk of req) {
      if (aborted) break;
      fileChunks.push(chunk);
    }
  } catch (err) {
    console.error('[upload/proxy] read body error:', err.message);
    if (!res.headersSent) {
      try { res.status(500).json({ error: 'failed to read body' }); } catch {}
    }
    return;
  }
  if (aborted) return;

  const fileBody = Buffer.concat(fileChunks);
  const fullBody = Buffer.concat([headerBuf, fileBody, footerBuf]);

  const url = new URL(targetUrl);
  const opts = {
    method: 'POST',
    hostname: url.hostname,
    port: 443,
    path: url.pathname,
    headers: {
      'Content-Type': 'multipart/form-data; boundary=' + boundary,
      'Content-Length': fullBody.length,
      'User-Agent': USER_AGENT,
    },
  };

  const upstreamReq = https.request(opts, (upstreamRes) => {
    if (aborted) return;
    res.status(upstreamRes.statusCode || 502);
    if (upstreamRes.headers) {
      for (const [k, v] of Object.entries(upstreamRes.headers)) {
        const lk = k.toLowerCase();
        if (lk === 'transfer-encoding' || lk === 'content-encoding' || lk === 'connection') continue;
        try { res.setHeader(k, v); } catch {}
      }
    }
    let responseBody = '';
    upstreamRes.on('data', (c) => { responseBody += c.toString(); });
    upstreamRes.on('end', () => {
      if (!res.writableEnded) res.end(responseBody);
    });
    upstreamRes.on('error', (err) => {
      console.error('[upload/proxy] upstream response error:', err.message);
      if (!res.writableEnded) res.end();
    });
  });

  upstreamReq.on('error', (err) => {
    console.error('[upload/proxy] request error:', err.message);
    if (aborted) return;
    if (!res.headersSent) {
      try { res.status(502).json({ error: 'upstream error: ' + err.message }); } catch {}
    } else {
      try { res.end(); } catch {}
    }
  });

  try {
    upstreamReq.write(fullBody);
    upstreamReq.end();
  } catch (err) {
    console.error('[upload/proxy] write error:', err.message);
    if (!res.headersSent) {
      try { res.status(500).json({ error: 'write failed' }); } catch {}
    }
  }
});

app.get('/tasks', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ${TASK_COLUMNS} FROM tasks WHERE user_id = $1 ${TASK_ORDER} LIMIT 1000`,
      [req.userId],
    );
    res.json({ tasks: result.rows });
  } catch (err) {
    console.error('Failed to fetch tasks:', err.message);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

app.post('/tasks', authMiddleware, async (req, res) => {
  const incomingTasks = req.body.tasks;
  if (!Array.isArray(incomingTasks)) {
    return res.status(400).json({ error: 'tasks must be an array' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const task of incomingTasks) {
      if (!task.id) continue;
      await client.query(
        `INSERT INTO tasks (id, user_id, title, description, completed, subtasks, updated_at, deleted, "order")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id, user_id) DO UPDATE SET
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           completed = EXCLUDED.completed,
           subtasks = EXCLUDED.subtasks,
           updated_at = CASE
             WHEN EXCLUDED.updated_at > tasks.updated_at THEN EXCLUDED.updated_at
             ELSE tasks.updated_at
           END,
           deleted = EXCLUDED.deleted,
           "order" = EXCLUDED."order"`,
        [
          task.id,
          req.userId,
          task.title || '',
          task.description || '',
          task.completed || false,
          JSON.stringify(task.subtasks || []),
          task.updated_at || Date.now(),
          task.deleted || false,
          task.order ?? 0,
        ],
      );
    }
    await client.query('COMMIT');
    client.release();
    const result = await pool.query(
      `SELECT ${TASK_COLUMNS} FROM tasks WHERE user_id = $1 ${TASK_ORDER} LIMIT 1000`,
      [req.userId],
    );
    res.json({ tasks: result.rows });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    try { client.release(); } catch {}
    console.error('Failed to upsert tasks:', err.message);
    res.status(500).json({ error: 'Failed to upsert data' });
  }
});

const NOTE_COLUMNS = `id, user_id, title, content, folder_id, archived, subtasks, updated_at, deleted, "order"`;
const NOTE_ORDER = `ORDER BY "order" ASC, updated_at DESC`;
const FOLDER_COLUMNS = `id, user_id, name, parent_id, "order", updated_at, deleted`;
const FOLDER_ORDER = `ORDER BY "order" ASC`;

app.get('/notes', authMiddleware, async (req, res) => {
  try {
    const notesResult = await pool.query(
      `SELECT ${NOTE_COLUMNS} FROM notes WHERE user_id = $1 ${NOTE_ORDER} LIMIT 1000`,
      [req.userId],
    );
    const foldersResult = await pool.query(
      `SELECT ${FOLDER_COLUMNS} FROM folders WHERE user_id = $1 ${FOLDER_ORDER} LIMIT 1000`,
      [req.userId],
    );
    res.json({ notes: notesResult.rows, folders: foldersResult.rows });
  } catch (err) {
    console.error('Failed to fetch notes:', err.message);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

app.post('/notes', authMiddleware, async (req, res) => {
  const incomingNotes = req.body.notes;
  if (!Array.isArray(incomingNotes)) {
    return res.status(400).json({ error: 'notes must be an array' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const note of incomingNotes) {
      if (!note.id) continue;
      await client.query(
        `INSERT INTO notes (id, user_id, title, content, folder_id, archived, subtasks, updated_at, deleted, "order")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id, user_id) DO UPDATE SET
           title = EXCLUDED.title,
           content = EXCLUDED.content,
           folder_id = EXCLUDED.folder_id,
           archived = EXCLUDED.archived,
           subtasks = EXCLUDED.subtasks,
           updated_at = CASE
             WHEN EXCLUDED.updated_at > notes.updated_at THEN EXCLUDED.updated_at
             ELSE notes.updated_at
           END,
           deleted = EXCLUDED.deleted,
           "order" = EXCLUDED."order"`,
        [
          note.id,
          req.userId,
          note.title || '',
          note.content || '',
          note.folder_id || null,
          note.archived || false,
          JSON.stringify(note.subtasks || []),
          note.updated_at || Date.now(),
          note.deleted || false,
          note.order ?? 0,
        ],
      );
    }
    await client.query('COMMIT');
    client.release();
    const result = await pool.query(
      `SELECT ${NOTE_COLUMNS} FROM notes WHERE user_id = $1 ${NOTE_ORDER} LIMIT 1000`,
      [req.userId],
    );
    res.json({ notes: result.rows });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    try { client.release(); } catch {}
    console.error('Failed to upsert notes:', err.message);
    res.status(500).json({ error: 'Failed to upsert data' });
  }
});

app.post('/notes/folders', authMiddleware, async (req, res) => {
  const incomingFolders = req.body.folders;
  if (!Array.isArray(incomingFolders)) {
    return res.status(400).json({ error: 'folders must be an array' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const folder of incomingFolders) {
      if (!folder.id) continue;
      await client.query(
        `INSERT INTO folders (id, user_id, name, parent_id, "order", updated_at, deleted)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id, user_id) DO UPDATE SET
           name = EXCLUDED.name,
           parent_id = EXCLUDED.parent_id,
           "order" = EXCLUDED."order",
           updated_at = CASE
             WHEN EXCLUDED.updated_at > folders.updated_at THEN EXCLUDED.updated_at
             ELSE folders.updated_at
           END,
           deleted = EXCLUDED.deleted`,
        [
          folder.id,
          req.userId,
          folder.name || '',
          folder.parent_id || null,
          folder.order ?? 0,
          folder.updated_at || Date.now(),
          folder.deleted || false,
        ],
      );
    }
    await client.query('COMMIT');
    client.release();
    const result = await pool.query(
      `SELECT ${FOLDER_COLUMNS} FROM folders WHERE user_id = $1 ${FOLDER_ORDER} LIMIT 1000`,
      [req.userId],
    );
    res.json({ folders: result.rows });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    try { client.release(); } catch {}
    console.error('Failed to upsert folders:', err.message);
    res.status(500).json({ error: 'Failed to upsert data' });
  }
});

const HABIT_COLUMNS = `id, user_id, title, interval_days, last_completed_at, completions, paused, updated_at, deleted, "order"`;
const HABIT_ORDER = `ORDER BY "order" ASC, updated_at DESC`;

app.get('/habits', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ${HABIT_COLUMNS} FROM habits WHERE user_id = $1 ${HABIT_ORDER} LIMIT 1000`,
      [req.userId],
    );
    res.json({ habits: result.rows });
  } catch (err) {
    console.error('Failed to fetch habits:', err.message);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

app.post('/habits', authMiddleware, async (req, res) => {
  const incomingHabits = req.body.habits;
  if (!Array.isArray(incomingHabits)) {
    return res.status(400).json({ error: 'habits must be an array' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const habit of incomingHabits) {
      if (!habit.id) continue;
      await client.query(
        `INSERT INTO habits (id, user_id, title, interval_days, last_completed_at, completions, paused, updated_at, deleted, "order")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id, user_id) DO UPDATE SET
           title = EXCLUDED.title,
           interval_days = EXCLUDED.interval_days,
           last_completed_at = EXCLUDED.last_completed_at,
           completions = EXCLUDED.completions,
           paused = EXCLUDED.paused,
           updated_at = CASE
             WHEN EXCLUDED.updated_at > habits.updated_at THEN EXCLUDED.updated_at
             ELSE habits.updated_at
           END,
           deleted = EXCLUDED.deleted,
           "order" = EXCLUDED."order"`,
        [
          habit.id,
          req.userId,
          habit.title || '',
          habit.intervalDays || habit.interval_days || 1,
          habit.lastCompletedAt || habit.last_completed_at || null,
          JSON.stringify(habit.completions || []),
          habit.paused || false,
          habit.updated_at || Date.now(),
          habit.deleted || false,
          habit.order ?? 0,
        ],
      );
    }
    await client.query('COMMIT');
    client.release();
    const result = await pool.query(
      `SELECT ${HABIT_COLUMNS} FROM habits WHERE user_id = $1 ${HABIT_ORDER} LIMIT 1000`,
      [req.userId],
    );
    res.json({ habits: result.rows });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    try { client.release(); } catch {}
    console.error('Failed to upsert habits:', err.message);
    res.status(500).json({ error: 'Failed to upsert data' });
  }
});

const SHARE_COLUMNS = `id, user_id, name, size, mime_type, host, external_id, download_url, archived, expires_at, updated_at, deleted, "order"`;
const SHARE_ORDER = `ORDER BY updated_at DESC`;

app.get('/shares', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ${SHARE_COLUMNS} FROM shares WHERE user_id = $1 ${SHARE_ORDER} LIMIT 1000`,
      [req.userId],
    );
    res.json({ shares: result.rows });
  } catch (err) {
    console.error('Failed to fetch shares:', err.message);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

app.post('/shares', authMiddleware, async (req, res) => {
  const incomingShares = req.body.shares;
  if (!Array.isArray(incomingShares)) {
    return res.status(400).json({ error: 'shares must be an array' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const share of incomingShares) {
      if (!share.id) continue;

      if (share.deleted) {
        await client.query(
          `INSERT INTO shares (id, user_id, name, size, mime_type, host, external_id, download_url, archived, expires_at, updated_at, deleted, "order")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10, false, $11)
           ON CONFLICT (id, user_id) DO UPDATE SET
             archived = true,
             deleted = false,
             updated_at = CASE
               WHEN EXCLUDED.updated_at > shares.updated_at THEN EXCLUDED.updated_at
               ELSE shares.updated_at
             END`,
          [
            share.id,
            req.userId,
            share.name || '',
            Number(share.size) || 0,
            share.mime_type || '',
            share.host || '',
            share.external_id || '',
            share.download_url || '',
            share.expires_at == null ? null : Number(share.expires_at),
            share.updated_at || Date.now(),
            share.order ?? 0,
          ],
        );
        continue;
      }

      await client.query(
        `INSERT INTO shares (id, user_id, name, size, mime_type, host, external_id, download_url, archived, subtasks, expires_at, updated_at, deleted, "order")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (id, user_id) DO UPDATE SET
           name = EXCLUDED.name,
           size = EXCLUDED.size,
           mime_type = EXCLUDED.mime_type,
           host = EXCLUDED.host,
           external_id = EXCLUDED.external_id,
           download_url = EXCLUDED.download_url,
           archived = EXCLUDED.archived,
           subtasks = EXCLUDED.subtasks,
           expires_at = EXCLUDED.expires_at,
           updated_at = CASE
             WHEN EXCLUDED.updated_at > shares.updated_at THEN EXCLUDED.updated_at
             ELSE shares.updated_at
           END,
           deleted = EXCLUDED.deleted,
           "order" = EXCLUDED."order"`,
        [
          share.id,
          req.userId,
          share.name || '',
          Number(share.size) || 0,
          share.mime_type || '',
          share.host || '',
          share.external_id || '',
          share.download_url || '',
          share.archived || false,
          JSON.stringify(share.subtasks || []),
          share.expires_at == null ? null : Number(share.expires_at),
          share.updated_at || Date.now(),
          share.deleted || false,
          share.order ?? 0,
        ],
      );
    }
    await client.query('COMMIT');
    client.release();
    const result = await pool.query(
      `SELECT ${SHARE_COLUMNS} FROM shares WHERE user_id = $1 ${SHARE_ORDER} LIMIT 1000`,
      [req.userId],
    );
    res.json({ shares: result.rows });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    try { client.release(); } catch {}
    console.error('Failed to upsert shares:', err.message);
    res.status(500).json({ error: 'Failed to upsert data' });
  }
});

const DEVICE_COLUMNS = `id, user_id, name, platform, updated_at, deleted`;

app.get('/devices', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ${DEVICE_COLUMNS} FROM devices WHERE user_id = $1 AND deleted = false`,
      [req.userId],
    );
    res.json({ devices: result.rows });
  } catch (err) {
    console.error('Failed to fetch devices:', err.message);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

app.post('/devices', authMiddleware, async (req, res) => {
  const incoming = req.body.devices;
  if (!Array.isArray(incoming)) {
    return res.status(400).json({ error: 'devices must be an array' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const device of incoming) {
      if (!device.id) continue;
      if (device.deleted) {
        await client.query(
          `UPDATE devices SET deleted = true, updated_at = $1 WHERE id = $2 AND user_id = $3`,
          [device.updated_at || Date.now(), device.id, req.userId],
        );
        continue;
      }
      await client.query(
        `INSERT INTO devices (id, user_id, name, platform, updated_at, deleted)
         VALUES ($1, $2, $3, $4, $5, false)
         ON CONFLICT (id, user_id) DO UPDATE SET
           name = EXCLUDED.name,
           updated_at = CASE
             WHEN EXCLUDED.updated_at > devices.updated_at THEN EXCLUDED.updated_at
             ELSE devices.updated_at
           END,
           deleted = false`,
        [
          device.id,
          req.userId,
          device.name || '',
          device.platform || '',
          device.updated_at || Date.now(),
        ],
      );
    }
    await client.query('COMMIT');
    client.release();
    const result = await pool.query(
      `SELECT ${DEVICE_COLUMNS} FROM devices WHERE user_id = $1 AND deleted = false`,
      [req.userId],
    );
    res.json({ devices: result.rows });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    try { client.release(); } catch {}
    console.error('Failed to upsert devices:', err.message);
    res.status(500).json({ error: 'Failed to upsert data' });
  }
});

const onlineDevices = new Map();

function getPublicIp(req) {
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
    console.error('Failed to load device record:', err.message);
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
         updated_at = CASE
           WHEN EXCLUDED.updated_at > devices.updated_at THEN EXCLUDED.updated_at
           ELSE devices.updated_at
         END,
         deleted = false`,
      [deviceId, userId, name, platform, now],
    );
  } catch (err) {
    console.error('Failed to save device record:', err.message);
  }
}

async function start() {
  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    process.exit(1);
  });
  process.on('unhandledRejection', (err) => {
    console.error('Unhandled rejection:', err);
    process.exit(1);
  });

  try {
    await initDb();
    const server = http.createServer(app);
    server.timeout = 0;
    server.keepAliveTimeout = 0;
    // Client-side reconnect uses exponential backoff with max 30s cap
    wss = new WebSocketServer({ server, path: '/ws' });
    wss.on('connection', (ws, req) => {
      const publicIp = getPublicIp(req);
      let session = null;
      ws.send(JSON.stringify({ type: 'welcome', publicIp }));

      ws.on('message', async (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        if (!msg || typeof msg !== 'object') return;

        if (msg.type === 'hello') {
          if (session) {
            onlineDevices.delete(session.id);
          }
          let storedName = msg.name || '';
          let storedPlatform = msg.platform || '';
          if (msg.userId) {
            const record = await loadDeviceRecord(msg.deviceId, msg.userId);
            if (record) {
              storedName = record.name || storedName;
              storedPlatform = record.platform || storedPlatform;
            }
          }
          session = {
            id: msg.deviceId,
            userId: msg.userId || null,
            name: storedName,
            platform: storedPlatform,
            inGlobal: !!msg.inGlobal,
            publicIp,
            ws,
          };
          onlineDevices.set(session.id, session);
          if (session.userId) {
            saveDeviceRecord(session.id, session.userId, session.name, session.platform);
          }
          broadcastDeviceList();
        } else if (msg.type === 'rename' && session) {
          session.name = msg.name || session.name;
          if (session.userId) {
            await saveDeviceRecord(session.id, session.userId, session.name, session.platform);
          }
          broadcastDeviceList();
        } else if (msg.type === 'toggleGlobal' && session) {
          session.inGlobal = !!msg.inGlobal;
          broadcastDeviceList();
        } else if (msg.type === 'signal' && session && msg.to) {
          const target = onlineDevices.get(msg.to);
          if (target && target.ws.readyState === 1) {
            try {
              target.ws.send(JSON.stringify({ type: 'signal', from: session.id, data: msg.data }));
            } catch {}
          }
        } else if (msg.type === 'offer' && session && msg.to) {
          const target = onlineDevices.get(msg.to);
          if (target && target.ws.readyState === 1) {
            try {
              target.ws.send(JSON.stringify({
                type: 'offer',
                from: session.id,
                file: msg.file,
                data: msg.data,
              }));
            } catch {}
          }
        } else if (msg.type === 'answer' && session && msg.to) {
          const target = onlineDevices.get(msg.to);
          if (target && target.ws.readyState === 1) {
            try {
              target.ws.send(JSON.stringify({
                type: 'answer',
                from: session.id,
                accept: !!msg.accept,
                data: msg.data,
              }));
            } catch {}
          }
        } else if (msg.type === 'cancel' && session && msg.to) {
          const target = onlineDevices.get(msg.to);
          if (target && target.ws.readyState === 1) {
            try {
              target.ws.send(JSON.stringify({ type: 'cancel', from: session.id }));
            } catch {}
          }
        }
      });

      ws.on('close', () => {
        if (session) {
          onlineDevices.delete(session.id);
          broadcastDeviceList();
        }
      });

      ws.on('error', () => {});
    });
    server.listen(PORT, '0.0.0.0');
  } catch (err) {
    console.error('Failed to start:', err);
    process.exit(1);
  }
}

start();
