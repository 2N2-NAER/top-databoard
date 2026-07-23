const { requireSession } = require('./_auth');

const TABLE_NAME = 'dashboard_state_revisions';

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase environment variables are not configured');
  return {
    endpoint: `${url.replace(/\/$/, '')}/rest/v1/${TABLE_NAME}`,
    key
  };
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function isConflict(statusCode, payload) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
  return statusCode === 409 || /VERSION_CONFLICT|40001|conflict/i.test(text);
}

async function supabaseFetch(path, options = {}) {
  const { endpoint, key } = getSupabaseConfig();
  const response = await fetch(`${endpoint}${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(payload?.message || 'Supabase request failed');
    error.statusCode = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

module.exports = async function handler(req, res) {
  if (!requireSession(req, res)) return;

  try {
    if (req.method === 'GET') {
      const rows = await supabaseFetch('?select=version,state,created_at&order=version.desc&limit=1', {
        cache: 'no-store'
      });
      const latest = rows?.[0];
      sendJson(res, 200, latest ? {
        state: latest.state || null,
        version: Number(latest.version) || 0,
        updatedAt: latest.created_at || ''
      } : null);
      return;
    }

    if (req.method === 'POST') {
      const payload = await readJson(req);
      const rows = await supabaseFetch('?select=version,state,created_at', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Prefer: 'return=representation'
        },
        body: JSON.stringify({
          state: payload.state || {},
          base_version: Number(payload.baseVersion) || 0
        })
      });
      const saved = rows?.[0];
      if (!saved) throw new Error('Supabase did not return saved state');
      sendJson(res, 200, {
        state: saved.state,
        version: Number(saved.version) || 0,
        updatedAt: saved.created_at || ''
      });
      return;
    }

    res.setHeader('Allow', 'GET, POST');
    sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  } catch (error) {
    if (isConflict(error.statusCode, error.payload)) {
      sendJson(res, 409, { error: 'VERSION_CONFLICT' });
      return;
    }
    sendJson(res, error.statusCode || 500, { error: error.message || 'REQUEST_FAILED' });
  }
};
