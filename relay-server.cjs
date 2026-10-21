// HTTPS long polling: no inbound connection or UDP is required on a player's phone.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, randomBytes } = require('node:crypto');

function createRelayServer({ origins = ['https://splendid-atom.github.io'], ttl = 90000 } = {}) {
  const sessions = new Map(), tokens = new Map(), links = new Map(), rates = new Map();
  function reply(res, status, body) {
    if (!res.writableEnded && !res.destroyed) {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    }
  }
  function flush(s) {
    if (s.wait && s.events.length) {
      const res = s.wait; s.wait = null; clearTimeout(s.timer);
      reply(res, 200, { events: s.events });
    }
  }
  function emit(s, event) {
    if (!s || !tokens.has(s.token)) return;
    if (s.events.length >= 512) { remove(s); return; }
    s.events.push({ ...event, seq: ++s.seq }); flush(s);
  }
  function closeLink(id) {
    const link = links.get(id); if (!link) return;
    links.delete(id);
    for (const s of [link.a, link.b]) { s.links.delete(id); emit(s, { type: 'close', connection: id }); }
  }
  function remove(s) {
    if (!tokens.delete(s.token)) return;
    sessions.delete(s.id); clearTimeout(s.timer);
    if (s.wait) reply(s.wait, 410, { error: 'Session expired' });
    for (const id of [...s.links]) closeLink(id);
  }
  const publicFiles = new Set(['index.html', 'styles.css', 'engine.js', 'network.js', 'script.js', 'relay.js', 'vendor/peerjs-1.5.5.min.js']);
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/relay/')) {
      if (url.pathname === '/health') return reply(res, 200, { ok: true });
      if (url.pathname === '/config.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' });
        return res.end("window.UNO_RELAY_URL = location.origin + '/relay';\n");
      }
      const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (!['GET', 'HEAD'].includes(req.method) || !publicFiles.has(file)) return reply(res, 404, { error: 'Not found' });
      const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript' };
      res.writeHead(200, { 'Content-Type': (types[path.extname(file)] || 'text/plain') + '; charset=utf-8', 'Cache-Control': 'no-cache' });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(path.join(__dirname, file)).on('error', () => res.destroy()).pipe(res);
    }
    const origin = req.headers.origin;
    // Same-origin requests are allowed; cross-origin access is limited to configured sites.
    const ownOrigin = origin && (origin === `https://${req.headers.host}` || origin === `http://${req.headers.host}`);
    if (origin && !ownOrigin && !origins.includes(origin)) return reply(res, 403, { error: 'Origin not allowed' });
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    try {
      let body = {};
      if (req.method === 'POST') {
        let size = 0, chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 65536) { reply(res, 413, { error: 'Payload too large' }); return; }
          chunks.push(chunk);
        }
        body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('Invalid object');
      }
      if (url.pathname === '/relay/session' && req.method === 'POST') {
        const ip = req.socket.remoteAddress;
        let rate = rates.get(ip);
        if (!rate || Date.now() - rate.time > 60000) { rate = { time: Date.now(), count: 0 }; rates.set(ip, rate); }
        if (++rate.count > 120 || sessions.size >= 2000) return reply(res, 429, { error: 'Server busy' });
        if (body.id !== undefined && !/^uno-party-v2-[A-HJ-NP-Z2-9]{8}$/.test(body.id)) return reply(res, 400, { error: 'Invalid room ID' });
        const id = body.id || randomUUID();
        if (sessions.has(id)) return reply(res, 409, { error: 'Room already exists', type: 'unavailable-id' });
        const s = { id, token: randomBytes(32).toString('hex'), host: !!body.id, seen: Date.now(), seq: 0, events: [], links: new Set(), count: 0, window: Date.now() };
        sessions.set(id, s); tokens.set(s.token, s);
        return reply(res, 201, { id, token: s.token });
      }
      const s = tokens.get((req.headers.authorization || '').replace(/^Bearer /, ''));
      if (!s) return reply(res, 401, { error: 'Session expired' });
      s.seen = Date.now();
      if (Date.now() - s.window > 1000) { s.window = Date.now(); s.count = 0; }
      if (++s.count > 120) return reply(res, 429, { error: 'Too many requests' });
      if (url.pathname === '/relay/events' && req.method === 'GET') {
        const ack = Number(url.searchParams.get('after') || 0);
        if (!Number.isInteger(ack) || ack < 0 || ack > s.seq) return reply(res, 400, { error: 'Invalid cursor' });
        s.events = s.events.filter(event => event.seq > ack);
        if (s.wait) reply(s.wait, 409, { error: 'Concurrent poll' });
        clearTimeout(s.timer); s.wait = res;
        s.timer = setTimeout(() => { if (s.wait === res) { s.wait = null; reply(res, 200, { events: [] }); } }, 20000);
        res.on('close', () => { if (s.wait === res) { s.wait = null; clearTimeout(s.timer); } });
        return flush(s);
      }
      if (url.pathname !== '/relay/command' || req.method !== 'POST') return reply(res, 404, { error: 'Not found' });
      if (body.type === 'destroy') { remove(s); return reply(res, 200, {}); }
      if (body.type === 'connect') {
        const target = sessions.get(body.target);
        if (!target?.host || s.host) return reply(res, 404, { error: 'Room not found', type: 'peer-unavailable' });
        if (s.links.size >= 1 || target.links.size >= 8) return reply(res, 409, { error: 'Too many connections' });
        if (typeof body.connection !== 'string' || !/^[a-f0-9-]{36}$/.test(body.connection) || links.has(body.connection)) return reply(res, 400, { error: 'Invalid connection ID' });
        links.set(body.connection, { a: s, b: target }); s.links.add(body.connection); target.links.add(body.connection);
        emit(target, { type: 'connection', peer: s.id, connection: body.connection });
        emit(s, { type: 'open', connection: body.connection });
        return reply(res, 200, {});
      }
      const link = links.get(body.connection);
      if (!link || !s.links.has(body.connection)) return reply(res, 404, { error: 'Connection closed' });
      if (body.type === 'close') closeLink(body.connection);
      else if (body.type === 'send') emit(link.a === s ? link.b : link.a, { type: 'data', connection: body.connection, data: body.data });
      else return reply(res, 400, { error: 'Unknown command' });
      reply(res, 200, {});
    } catch { reply(res, 400, { error: 'Invalid request' }); }
  });
  const sweep = setInterval(() => {
    for (const s of sessions.values()) if (Date.now() - s.seen > ttl) remove(s);
    for (const [ip, rate] of rates) if (Date.now() - rate.time > 60000) rates.delete(ip);
  }, 10000);
  sweep.unref();
  server.on('close', () => { clearInterval(sweep); for (const s of [...sessions.values()]) remove(s); });
  server.shutdown = () => { for (const s of [...sessions.values()]) remove(s); server.close(); server.closeAllConnections(); };
  return server;
}
if (require.main === module) {
  const server = createRelayServer({ origins: (process.env.ALLOWED_ORIGINS || 'https://splendid-atom.github.io').split(',').map(x => x.trim()) });
  server.listen(Number(process.env.PORT) || 3000, '0.0.0.0', () => console.log('UNO HTTPS relay ready'));
  process.on('SIGTERM', () => server.shutdown());
}
module.exports = { createRelayServer };
