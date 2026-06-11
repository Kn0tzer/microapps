const express = require('express');
const { Pool } = require('pg');
const { createRemoteJWKSet, jwtVerify } = require('jose');
const cors = require('cors');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cors());

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const APP_ORIGIN = process.env.APP_ORIGIN || 'https://microapps.work.gd';
const SHOO_BASE_URL = process.env.SHOO_BASE_URL || 'https://shoo.dev';
const SHOO_ISSUER = process.env.SHOO_ISSUER || SHOO_BASE_URL;

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected pool error:', err);
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
    const msg = err instanceof Error ? err.message : 'Verification failed';
    return res.status(401).json({ error: `Unauthorized: ${msg}` });
  }
}

const TASK_COLUMNS = `id, user_id, title, description, completed, subtasks, updated_at, deleted, "order"`;
const TASK_ORDER = `ORDER BY "order" ASC, updated_at DESC`;

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.get('/tasks', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ${TASK_COLUMNS} FROM tasks WHERE user_id = $1 ${TASK_ORDER}`,
      [req.userId],
    );

    const completed = result.rows.filter(t => t.completed && !t.deleted);
    if (completed.length > 10) {
      const toDelete = completed.slice(10).map(t => t.id);
      await pool.query(
        `DELETE FROM tasks WHERE user_id = $1 AND id = ANY($2) AND completed = true`,
        [req.userId, toDelete],
      );
      result.rows = result.rows.filter(t => !toDelete.includes(t.id));
    }

    res.json({ tasks: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch tasks' });
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

    const result = await pool.query(
      `SELECT ${TASK_COLUMNS} FROM tasks WHERE user_id = $1 ${TASK_ORDER}`,
      [req.userId],
    );

    res.json({ tasks: result.rows });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to upsert tasks' });
  } finally {
    client.release();
  }
});

const NOTE_COLUMNS = `id, user_id, title, content, folder_id, archived, subtasks, updated_at, deleted, "order"`;
const NOTE_ORDER = `ORDER BY "order" ASC, updated_at DESC`;
const FOLDER_COLUMNS = `id, user_id, name, parent_id, "order", updated_at, deleted`;
const FOLDER_ORDER = `ORDER BY "order" ASC`;

app.get('/notes', authMiddleware, async (req, res) => {
  try {
    const notesResult = await pool.query(
      `SELECT ${NOTE_COLUMNS} FROM notes WHERE user_id = $1 ${NOTE_ORDER}`,
      [req.userId],
    );
    const foldersResult = await pool.query(
      `SELECT ${FOLDER_COLUMNS} FROM folders WHERE user_id = $1 ${FOLDER_ORDER}`,
      [req.userId],
    );
    res.json({ notes: notesResult.rows, folders: foldersResult.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch notes' });
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

    const result = await pool.query(
      `SELECT ${NOTE_COLUMNS} FROM notes WHERE user_id = $1 ${NOTE_ORDER}`,
      [req.userId],
    );
    res.json({ notes: result.rows });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to upsert notes' });
  } finally {
    client.release();
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

    const result = await pool.query(
      `SELECT ${FOLDER_COLUMNS} FROM folders WHERE user_id = $1 ${FOLDER_ORDER}`,
      [req.userId],
    );
    res.json({ folders: result.rows });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to upsert folders' });
  } finally {
    client.release();
  }
});

async function start() {
  try {
    await initDb();
    app.listen(PORT, '0.0.0.0');
  } catch (err) {
    process.exit(1);
  }
}

start();
