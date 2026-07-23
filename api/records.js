const { requireSession } = require('./_auth');

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  const dataSecret = process.env.DASHBOARD_DATA_SECRET;
  if (!url || !key || !dataSecret) {
    throw new Error('Supabase environment variables are not configured');
  }
  return {
    endpoint: `${url.replace(/\/$/, '')}/rest/v1/rpc`,
    key,
    dataSecret
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

async function supabaseRpc(functionName, body = {}) {
  const { endpoint, key, dataSecret } = getSupabaseConfig();
  const response = await fetch(`${endpoint}/${functionName}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      p_secret: dataSecret,
      ...body
    })
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

function toClientState(row) {
  return row ? {
    state: row.state || null,
    version: Number(row.version) || 0,
    updatedAt: row.created_at || ''
  } : null;
}

module.exports = async function handler(req, res) {
  if (!requireSession(req, res)) return;

  try {
    if (req.method === 'GET') {
      const rows = await supabaseRpc('dashboard_read_state');
      sendJson(res, 200, toClientState(rows?.[0]));
      return;
    }

    if (req.method === 'POST') {
      const payload = await readJson(req);
      const rows = await supabaseRpc('dashboard_save_state', {
        p_state: payload.state || {},
        p_base_version: Number(payload.baseVersion) || 0
      });
      const saved = toClientState(rows?.[0]);
      if (!saved) throw new Error('Supabase did not return saved state');
      sendJson(res, 200, saved);
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
