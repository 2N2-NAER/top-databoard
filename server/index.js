import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');

function normalizeRow(row) {
  if (!row) {
    return { state: null, version: 0, updatedAt: '' };
  }
  return {
    state: row.state || null,
    version: Number(row.version) || 0,
    updatedAt: row.created_at ? new Date(row.created_at).toISOString() : ''
  };
}

function sendError(res, status, code, message) {
  res.status(status).json({ code, message });
}

export function createApp(pool) {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: process.env.JSON_LIMIT || '25mb' }));

  app.get('/api/health', async (_req, res, next) => {
    try {
      await pool.query('select 1');
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/records', async (_req, res, next) => {
    try {
      const { rows } = await pool.query(`
        select version, state, created_at
        from dashboard_state_revisions
        order by version desc
        limit 1
      `);
      res.set('Cache-Control', 'no-store');
      res.json(normalizeRow(rows[0]));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/records', async (req, res, next) => {
    const state = req.body?.state;
    const baseVersion = Number(req.body?.baseVersion ?? 0);

    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      return sendError(res, 400, 'INVALID_STATE', 'state 必须是 JSON 对象');
    }
    if (!Number.isInteger(baseVersion) || baseVersion < 0) {
      return sendError(res, 400, 'INVALID_BASE_VERSION', 'baseVersion 必须是非负整数');
    }

    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(2026072101)');

      const latest = await client.query(`
        select coalesce(max(version), 0)::bigint as version
        from dashboard_state_revisions
      `);
      const currentVersion = Number(latest.rows[0]?.version || 0);

      if (currentVersion !== baseVersion) {
        await client.query('rollback');
        return sendError(
          res,
          409,
          'VERSION_CONFLICT',
          `云端版本已更新，请刷新后重试。当前版本：${currentVersion}，你的基础版本：${baseVersion}`
        );
      }

      const nextVersion = currentVersion + 1;
      const inserted = await client.query(
        `
          insert into dashboard_state_revisions (version, base_version, state, created_by)
          values ($1, $2, $3::jsonb, $4)
          returning version, state, created_at
        `,
        [nextVersion, baseVersion, JSON.stringify(state), req.ip || 'unknown']
      );

      await client.query('commit');
      res.status(201).json(normalizeRow(inserted.rows[0]));
    } catch (error) {
      await client.query('rollback').catch(() => {});
      next(error);
    } finally {
      client.release();
    }
  });

  app.use(express.static(publicDir, {
    extensions: ['html'],
    etag: true,
    maxAge: '5m'
  }));

  app.get('*', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.use((error, _req, res, _next) => {
    console.error(error);
    sendError(res, 500, 'INTERNAL_ERROR', '服务端异常，请稍后重试');
  });

  return app;
}

export function createPoolFromEnv() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  return new Pool({
    connectionString: databaseUrl,
    max: Number(process.env.PG_POOL_SIZE || 10)
  });
}

if (process.argv[1] === __filename) {
  const port = Number(process.env.PORT || 8080);
  const pool = createPoolFromEnv();
  const app = createApp(pool);

  app.listen(port, '0.0.0.0', () => {
    console.log(`top-databoard intranet server listening on ${port}`);
  });
}
