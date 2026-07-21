import { createServer } from 'node:http';
import { createApp } from '../server/index.js';

class MemoryPool {
  constructor() {
    this.rows = [];
  }

  async query(sql) {
    if (/select 1/i.test(sql)) {
      return { rows: [{ '?column?': 1 }] };
    }
    if (/from dashboard_state_revisions/i.test(sql) && /order by version desc/i.test(sql)) {
      const latest = this.rows.at(-1);
      return { rows: latest ? [latest] : [] };
    }
    throw new Error(`Unexpected pool query: ${sql}`);
  }

  async connect() {
    return new MemoryClient(this);
  }
}

class MemoryClient {
  constructor(pool) {
    this.pool = pool;
  }

  async query(sql, params = []) {
    if (/^begin$/i.test(sql.trim()) || /^commit$/i.test(sql.trim()) || /^rollback$/i.test(sql.trim())) {
      return { rows: [] };
    }
    if (/pg_advisory_xact_lock/i.test(sql)) {
      return { rows: [] };
    }
    if (/coalesce\(max\(version\)/i.test(sql)) {
      return { rows: [{ version: this.pool.rows.at(-1)?.version || 0 }] };
    }
    if (/insert into dashboard_state_revisions/i.test(sql)) {
      const [version, baseVersion, stateJson, createdBy] = params;
      const row = {
        version,
        base_version: baseVersion,
        state: JSON.parse(stateJson),
        created_at: new Date().toISOString(),
        created_by: createdBy
      };
      this.pool.rows.push(row);
      return { rows: [row] };
    }
    throw new Error(`Unexpected client query: ${sql}`);
  }

  release() {}
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const payload = await response.json();
  return { status: response.status, payload };
}

const pool = new MemoryPool();
const app = createApp(pool);
const server = createServer(app);

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;

try {
  const empty = await request(baseUrl, '/api/records');
  if (empty.status !== 200 || empty.payload.version !== 0) {
    throw new Error(`Expected empty version 0, got ${empty.status} ${JSON.stringify(empty.payload)}`);
  }

  const saved = await request(baseUrl, '/api/records', {
    method: 'POST',
    body: JSON.stringify({ state: { review: { records: [] } }, baseVersion: 0 })
  });
  if (saved.status !== 201 || saved.payload.version !== 1) {
    throw new Error(`Expected save version 1, got ${saved.status} ${JSON.stringify(saved.payload)}`);
  }

  const conflict = await request(baseUrl, '/api/records', {
    method: 'POST',
    body: JSON.stringify({ state: { review: { records: [{ id: 'stale' }] } }, baseVersion: 0 })
  });
  if (conflict.status !== 409 || conflict.payload.code !== 'VERSION_CONFLICT') {
    throw new Error(`Expected 409 conflict, got ${conflict.status} ${JSON.stringify(conflict.payload)}`);
  }

  const latest = await request(baseUrl, '/api/records');
  if (latest.status !== 200 || latest.payload.version !== 1) {
    throw new Error(`Expected latest version 1, got ${latest.status} ${JSON.stringify(latest.payload)}`);
  }

  console.log('verify-api passed');
} finally {
  await new Promise(resolve => server.close(resolve));
}
