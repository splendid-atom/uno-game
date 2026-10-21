(function (root) {
  'use strict';
  class Events {
    constructor() { this.handlers = new Map(); }
    on(name, fn) { if (!this.handlers.has(name)) this.handlers.set(name, []); this.handlers.get(name).push(fn); return this; }
    emit(name, value) { for (const fn of this.handlers.get(name) || []) fn(value); }
  }
  class Connection extends Events {
    constructor(owner, peer, id) { super(); this.owner = owner; this.peer = peer; this.id = id; this.open = false; this.closed = false; }
    send(data) { if (!this.open) throw Error('Connection closed'); this.owner.command({ type: 'send', connection: this.id, data }); }
    finish() { if (this.closed) return; this.closed = true; this.open = false; this.owner.connections.delete(this.id); this.emit('close'); }
    close() { if (this.closed) return; this.finish(); this.owner.command({ type: 'close', connection: this.id }, true); }
  }
  function createPeerClass(endpoint, fetchImpl = root.fetch.bind(root)) {
    const url = new URL(endpoint, root.location?.href);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw Error('中转服务必须使用 HTTPS');
    const base = url.href.replace(/\/$/, '');
    return class RelayPeer extends Events {
      constructor(id) {
        super(); this.connections = new Map(); this.destroyed = false; this.disconnected = false; this.cursor = 0; this.queue = Promise.resolve();
        this.start(id);
      }
      async request(route, data, signal) {
        const response = await fetchImpl(base + route, {
          method: data === undefined ? 'GET' : 'POST', cache: 'no-store', signal,
          headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(this.token ? { Authorization: 'Bearer ' + this.token } : {}) },
          ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        });
        const body = await response.json();
        if (!response.ok) throw Object.assign(Error(body.error || '中转服务连接失败'), { type: body.type || 'network', status: response.status });
        return body;
      }
      async start(id) {
        try {
          const session = await this.request('/session', id ? { id } : {}, AbortSignal.timeout(25000));
          this.id = session.id; this.token = session.token;
          if (this.destroyed) { await this.request('/command', { type: 'destroy' }, AbortSignal.timeout(5000)).catch(() => {}); return; }
          this.emit('open', this.id); this.poll();
        } catch (error) { if (!this.destroyed) { this.emit('error', error); this.destroy(); } }
      }
      async poll() {
        let failures = 0;
        while (!this.destroyed) {
          try {
            this.pollController = new AbortController();
            const timeout = setTimeout(() => this.pollController?.abort(), 30000);
            let result;
            try { result = await this.request('/events?after=' + this.cursor, undefined, this.pollController.signal); }
            finally { clearTimeout(timeout); }
            if (this.destroyed) return;
            failures = 0;
            for (const event of result.events) {
              if (event.seq <= this.cursor) continue;
              let conn = this.connections.get(event.connection);
              if (event.type === 'connection') {
                conn = new Connection(this, event.peer, event.connection); this.connections.set(conn.id, conn);
                this.emit('connection', conn);
                if (!conn.closed) { conn.open = true; conn.emit('open'); }
              } else if (conn && !conn.closed) {
                if (event.type === 'open') { conn.open = true; conn.emit('open'); }
                else if (event.type === 'data') conn.emit('data', event.data);
                else if (event.type === 'close') conn.finish();
              }
              this.cursor = event.seq;
            }
          } catch (error) {
            if (this.destroyed) return;
            if (error.status === 401 || ++failures >= 3) { this.destroy(); this.emit('close'); return; }
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }
      command(data, ignoreError = false) {
        this.queue = this.queue.then(async () => {
          if (this.destroyed) return;
          try { await this.request('/command', data, AbortSignal.timeout(15000)); }
          catch (error) {
            if (ignoreError || this.destroyed) return;
            const conn = this.connections.get(data.connection);
            if (data.type === 'connect') { this.emit('error', error); conn?.finish(); }
            else { this.destroy(); this.emit('close'); }
          }
        });
      }
      connect(peer) {
        const conn = new Connection(this, peer, root.crypto.randomUUID());
        this.connections.set(conn.id, conn); this.command({ type: 'connect', target: peer, connection: conn.id }); return conn;
      }
      reconnect() { /* Polling reconnects automatically while the session is valid. */ }
      destroy() {
        if (this.destroyed) return;
        this.destroyed = true; this.pollController?.abort();
        for (const conn of [...this.connections.values()]) conn.finish();
        if (this.token) this.request('/command', { type: 'destroy' }, AbortSignal.timeout(5000)).catch(() => {});
      }
    };
  }
  root.UnoRelay = { createPeerClass };
  if (typeof module === 'object' && module.exports) module.exports = root.UnoRelay;
})(typeof globalThis === 'undefined' ? window : globalThis);
