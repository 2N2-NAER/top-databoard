const {
  clearSessionCookie,
  getSession,
  safeEqual,
  setSessionCookie
} = require('./_auth');

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

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const session = getSession(req);
    sendJson(res, session ? 200 : 401, session ? { authenticated: true, username: session.username } : { authenticated: false });
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    return;
  }

  const payload = await readJson(req).catch(() => ({}));
  if (payload.action === 'logout') {
    clearSessionCookie(res);
    sendJson(res, 200, { authenticated: false });
    return;
  }

  const expectedUsername = process.env.DASHBOARD_USERNAME;
  const expectedPassword = process.env.DASHBOARD_PASSWORD;
  if (!expectedUsername || !expectedPassword) {
    sendJson(res, 500, { error: 'AUTH_NOT_CONFIGURED' });
    return;
  }

  const username = String(payload.username || '');
  const password = String(payload.password || '');
  if (!safeEqual(username, expectedUsername) || !safeEqual(password, expectedPassword)) {
    sendJson(res, 401, { error: 'INVALID_CREDENTIALS' });
    return;
  }

  setSessionCookie(res, username);
  sendJson(res, 200, { authenticated: true, username });
};
