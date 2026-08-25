/**
 * questlog sync — a Cloudflare Worker storing one JSON document per key.
 *
 * There are no accounts. The key in the URL is the only secret, so it must be
 * long and random (the app generates 32 characters). Anyone holding the link
 * holds the data.
 *
 * Routes:
 *   GET  /v1/doc/:key  -> 200 {version, updatedAt, doc} | 404
 *   PUT  /v1/doc/:key  <- {doc, baseVersion}
 *                      -> 200 {version, updatedAt} | 409 {error, version}
 *
 * Bind a KV namespace as QUESTLOG. A 409 is not an error the user needs to see:
 * the client re-reads, re-merges and retries, and merging is idempotent.
 */

const KEY_RE = /^[a-z0-9]{24,64}$/;
const MAX_BYTES = 2_000_000;

// Origins allowed to call this Worker. Add your own if you fork the app.
const ALLOWED_ORIGINS = [
  'https://callum-dev-x.github.io',
  'http://localhost:8123',
  'http://127.0.0.1:8123',
];

function corsHeaders(origin) {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'null',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(origin),
    },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return json({ error: 'origin not allowed' }, 403, origin);
    }

    const match = url.pathname.match(/^\/v1\/doc\/([^/]+)$/);
    if (!match) return json({ error: 'not found' }, 404, origin);

    const key = match[1];
    // Never log or echo the key — it is the credential.
    if (!KEY_RE.test(key)) return json({ error: 'invalid key' }, 400, origin);

    const storeKey = `doc:${key}`;

    if (request.method === 'GET') {
      const stored = await env.QUESTLOG.get(storeKey, { type: 'json' });
      if (!stored) return json({ error: 'not found' }, 404, origin);
      return json(stored, 200, origin);
    }

    if (request.method === 'PUT') {
      const length = Number(request.headers.get('Content-Length') || 0);
      if (length > MAX_BYTES) return json({ error: 'document too large' }, 413, origin);

      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'body was not valid JSON' }, 400, origin);
      }
      if (!body || typeof body.doc !== 'object' || body.doc === null) {
        return json({ error: 'no document supplied' }, 400, origin);
      }

      const existing = await env.QUESTLOG.get(storeKey, { type: 'json' });
      const currentVersion = existing ? Number(existing.version) || 0 : 0;
      const baseVersion = Number(body.baseVersion) || 0;
      if (existing && baseVersion !== currentVersion) {
        // Someone else wrote first. The client re-reads and merges.
        return json({ error: 'version conflict', version: currentVersion }, 409, origin);
      }

      const record = {
        version: currentVersion + 1,
        updatedAt: new Date().toISOString(),
        doc: body.doc,
      };
      const serialized = JSON.stringify(record);
      if (serialized.length > MAX_BYTES) return json({ error: 'document too large' }, 413, origin);

      await env.QUESTLOG.put(storeKey, serialized);
      return json({ version: record.version, updatedAt: record.updatedAt }, 200, origin);
    }

    return json({ error: 'method not allowed' }, 405, origin);
  },
};
