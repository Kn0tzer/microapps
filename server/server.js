const express = require('express');
const { Pool } = require('pg');
const { createRemoteJWKSet, jwtVerify } = require('jose');
const cors = require('cors');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cors());

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const APP_ORIGIN = process.env.APP_ORIGIN || 'https://microtask.work.gd';
const SHOO_BASE_URL = process.env.SHOO_BASE_URL || 'https://shoo.dev';
const SHOO_ISSUER = process.env.SHOO_ISSUER || SHOO_BASE_URL;

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {});

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
        PRIMARY KEY (id, user_id)
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);`);
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

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.get('/tasks', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, user_id, title, description, completed, subtasks, updated_at, deleted
       FROM tasks WHERE user_id = $1 ORDER BY updated_at DESC`,
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
        `INSERT INTO tasks (id, user_id, title, description, completed, subtasks, updated_at, deleted)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id, user_id) DO UPDATE SET
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           completed = EXCLUDED.completed,
           subtasks = EXCLUDED.subtasks,
           updated_at = CASE
             WHEN EXCLUDED.updated_at > tasks.updated_at THEN EXCLUDED.updated_at
             ELSE tasks.updated_at
           END,
           deleted = EXCLUDED.deleted`,
        [
          task.id,
          req.userId,
          task.title || '',
          task.description || '',
          task.completed || false,
          JSON.stringify(task.subtasks || []),
          task.updated_at || Date.now(),
          task.deleted || false,
        ],
      );
    }

    await client.query('COMMIT');

    const result = await pool.query(
      `SELECT id, user_id, title, description, completed, subtasks, updated_at, deleted
       FROM tasks WHERE user_id = $1 ORDER BY updated_at DESC`,
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

app.delete('/tasks/:id', authMiddleware, async (req, res) => {
  try {
    await pool.query(
      `UPDATE tasks SET deleted = true, updated_at = $1 WHERE id = $2 AND user_id = $3`,
      [Date.now(), req.params.id, req.userId],
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

async function start() {
  try {
    await initDb();
    app.listen(PORT, '0.0.0.0', () => {});
  } catch (err) {
    process.exit(1);
  }
}

start();
