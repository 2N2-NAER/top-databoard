import { kv } from '@vercel/kv';

const STORAGE_KEY = 'top-beauty-dashboard-state';

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');

  if (request.method === 'GET') {
    const state = await kv.get(STORAGE_KEY);
    return response.status(200).json({ state: state || null });
  }

  if (request.method === 'POST') {
    const state = request.body?.state;
    if (!state || typeof state !== 'object') {
      return response.status(400).json({ error: 'Invalid state' });
    }
    await kv.set(STORAGE_KEY, state);
    return response.status(200).json({ ok: true });
  }

  response.setHeader('Allow', 'GET, POST');
  return response.status(405).json({ error: 'Method not allowed' });
}
