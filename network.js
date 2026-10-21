(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./engine.js') : root.UnoEngine);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UnoRoom = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Engine) {
  'use strict';
  const PROTOCOL = 2;
  const PREFIX = 'uno-party-v2-';
  const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;
  const TIMING = { signal: 30000, transport: 60000, hello: 15000, heartbeat: 90000 };
  function normalizeCode(value) {
    let text = String(value || '').normalize('NFKC').trim();
    try { text = new URL(text).searchParams.get('room') || text; } catch {}
    return text.replace(/[\s\u200b-\u200d\ufeff-]/g, '').toUpperCase();
  }
  const cleanName = name => String(name || '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, 12) || '牌友';
  const botNames = ['小橘', '阿蓝', '小紫'];
  class Room {
    constructor(callbacks = {}, PeerClass = null) {
      this.callbacks = callbacks;
      this.PeerClass = PeerClass;
      this.mode = null;
      this.code = '';
      this.players = [];
      this.connections = new Map();
      this.fillBots = true;
      this.closed = false;
      this.engine = null;
      this.peer = null;
      this.hostConnection = null;
      this.timer = null;
      this.timerKey = null;
      this.round = 0;
      this.lastSeen = Date.now();
      this.timers = new Set();
      this.joined = false;
      this.connectAttempts = 0;
      this.stage = 'idle';
    }
    emit(event, value) { if (!this.closed) this.callbacks[event]?.(value); }
    later(fn, ms) {
      const timer = setTimeout(() => { this.timers.delete(timer); if (!this.closed) fn(); }, ms);
      this.timers.add(timer);
      return timer;
    }
    cancel(timer) { clearTimeout(timer); this.timers.delete(timer); }
    solo(name) {
      this.mode = 'solo';
      this.players = [{ id: 'host', name: cleanName(name), bot: false }];
      this.startGame();
    }
    host(name) {
      this.mode = 'host';
      this.players = [{ id: 'host', name: cleanName(name), bot: false }];
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const bytes = new Uint8Array(8);
      globalThis.crypto.getRandomValues(bytes);
      this.code = Array.from(bytes, n => chars[n % chars.length]).join('');
      this.openPeer(PREFIX + this.code);
    }
    join(name, code) {
      code = normalizeCode(code);
      if (!CODE_PATTERN.test(code)) { this.emit('onError', '请输入 8 位房间码'); return; }
      this.mode = 'guest'; this.name = cleanName(name); this.code = code;
      this.openPeer();
    }
    joinTimeout(stage, delay, message) {
      this.stage = stage;
      this.cancel(this.connectTimeout);
      this.connectTimeout = this.later(() => {
        if (this.mode === 'guest' && this.hostConnection && !this.joined) this.retryJoin(this.hostConnection, message);
        else this.fail(message);
      }, delay);
    }
    openPeer(id) {
      if (!this.PeerClass) { this.fail('联机组件没有加载成功，请重试'); return; }
      this.emit('onStatus', '正在连接房间服务…');
      try { this.peer = new this.PeerClass(id, { secure: true, debug: 0 }); }
      catch { this.fail('浏览器无法建立联机连接，请使用新版 Chrome、Edge 或 Safari'); return; }
      this.joinTimeout('signal', TIMING.signal, '连接房间服务超时，请检查网络后重试。[SIGNAL_TIMEOUT]');
      this.peer.on('open', () => {
        if (this.closed) return;
        if (this.mode === 'host') {
          this.cancel(this.connectTimeout);
          this.stage = 'ready';
          this.emit('onStatus', '房间已连接');
          this.publish();
        } else if (!this.hostConnection) {
          this.connectToHost();
        } else this.emit('onStatus', '连接已恢复');
      });
      this.peer.on('connection', conn => {
        if (this.closed || this.mode !== 'host') { conn.close(); return; }
        this.acceptConnection(conn);
      });
      this.peer.on('disconnected', () => {
        this.emit('onStatus', '房间服务重连中…');
        this.later(() => {
          if (this.peer && !this.peer.destroyed && this.peer.disconnected) {
            try { this.peer.reconnect(); } catch { this.emit('onError', '房间服务暂时不可用，已建立的对局可继续'); }
          }
        }, 1500);
      });
      this.peer.on('close', () => { if (!this.closed) this.fail('房间连接已结束，请重新开桌'); });
      this.peer.on('error', error => {
        if (this.closed) return;
        const errors = {
          'peer-unavailable': '找不到这个房间，请检查房间码并确认房主仍在线。',
          'unavailable-id': '房间码被占用，请重新创建房间。',
          'browser-incompatible': '浏览器不支持联机，请使用新版 Chrome、Edge 或 Safari。',
          'network': '无法连接房间服务，请检查网络后重试。',
          'server-error': '房间服务暂时不可用，请稍后重试。',
          'webrtc': '无法与玩家建立连接，请尝试更换网络。',
        };
        if (this.mode === 'guest' && !this.joined && this.hostConnection && !this.peer.destroyed && ['peer-unavailable', 'webrtc'].includes(error.type)) {
          this.retryJoin(this.hostConnection, `${errors[error.type]} [${error.type}]`);
          return;
        }
        if (this.mode === 'host' && !this.peer.destroyed && ['webrtc', 'peer-unavailable'].includes(error.type)) {
          this.emit('onError', '一位玩家连接失败，房间仍然开放，可以重新加入。');
          return;
        }
        if ((this.engine || this.joined || (this.mode === 'host' && this.stage === 'ready')) && !this.peer.destroyed && ['network', 'disconnected', 'webrtc'].includes(error.type)) {
          this.emit('onError', '连接不稳定，已建立的对局会尽量保持');
        } else this.fail(errors[error.type] || '联机连接失败，请重试或更换网络。');
      });
      this.heartbeat();
    }
    send(conn, data) {
      if (!conn?.open) return false;
      try { conn.send(data); return true; } catch { return false; }
    }
    reject(conn, reason) {
      this.send(conn, { type: 'reject', reason });
      this.later(() => conn.close(), 200);
    }
    acceptConnection(conn) {
      const previous = this.connections.get(conn.peer);
      if (previous && !previous.joined) {
        this.connections.delete(conn.peer);
        previous.conn.close();
      }
      if (this.connections.size >= 8 || this.connections.has(conn.peer)) {
        conn.on('open', () => this.reject(conn, '房间连接已满，请稍后重试'));
        conn.on('error', () => {});
        return;
      }
      const entry = { conn, joined: false, lastSeen: Date.now(), messages: 0, window: Date.now() };
      this.connections.set(conn.peer, entry);
      const expire = () => { if (!entry.joined && this.connections.get(conn.peer) === entry) { this.connections.delete(conn.peer); conn.close(); } };
      // ICE negotiation can take tens of seconds on mobile networks. The hello
      // deadline starts only after the actual data channel opens.
      let timeout = this.later(expire, TIMING.transport);
      const opened = () => {
        if (this.closed) { conn.close(); return; }
        this.cancel(timeout);
        if (!entry.joined) timeout = this.later(expire, TIMING.hello);
      };
      conn.on('open', opened);
      if (conn.open) opened();
      conn.on('data', data => {
        if (this.closed || this.connections.get(conn.peer) !== entry || !data || typeof data !== 'object') return;
        entry.lastSeen = Date.now();
        if (Date.now() - entry.window > 1000) { entry.window = Date.now(); entry.messages = 0; }
        if (++entry.messages > 30) return;
        if (data.type === 'ping') { this.send(conn, { type: 'pong' }); return; }
        if (data.type === 'pong') return;
        if (data.type === 'hello' && !entry.joined) {
          this.cancel(timeout);
          if (data.protocol !== PROTOCOL) { this.reject(conn, '版本不同，请双方刷新网页后重试'); return; }
          if (this.engine) { this.reject(conn, '对局已经开始，请等房主返回房间后再加入'); return; }
          if (this.players.length >= 4) { this.reject(conn, '房间已满（最多 4 人）'); return; }
          entry.joined = true;
          this.players.push({ id: conn.peer, name: cleanName(data.name), bot: false });
          this.publish();
        } else if (data.type === 'action' && entry.joined && this.engine) {
          // A remote client cannot choose its actor/seat or update the game state.
          const seat = this.engine.players.findIndex(p => p.id === conn.peer);
          if (seat < 0 || this.engine.players[seat].bot) return;
          const result = this.engine.act(seat, data.action);
          if (!result.ok) this.send(conn, { type: 'action-error', reason: result.error });
          else { this.publish(); this.schedule(); }
        }
      });
      conn.on('close', () => { this.cancel(timeout); this.drop(conn.peer, entry); });
      conn.on('error', () => { this.cancel(timeout); this.drop(conn.peer, entry); conn.close(); });
    }
    connectToHost() {
      if (this.closed || this.hostConnection) return;
      this.cancel(this.retryTimer);
      this.connectAttempts++;
      this.emit('onStatus', `正在连接房主（第 ${this.connectAttempts} 次）…`);
      const conn = this.peer.connect(PREFIX + this.code, { reliable: true, serialization: 'json' });
      this.hostConnection = conn;
      this.joinTimeout('transport', TIMING.transport, '无法与房主建立通道。请双方保持页面打开，尝试同一 Wi-Fi 或更换网络。[ICE_TIMEOUT]');
      conn.on('open', () => {
        if (this.closed || this.hostConnection !== conn) { conn.close(); return; }
        this.lastSeen = Date.now();
        this.emit('onStatus', '通道已连接，正在入座…');
        this.joinTimeout('hello', TIMING.hello, '房主尚未确认加入。请让房主切回游戏页面后重试。[JOIN_TIMEOUT]');
        this.send(conn, { type: 'hello', name: this.name, protocol: PROTOCOL });
      });
      conn.on('data', data => {
        if (this.closed || this.hostConnection !== conn || !data || typeof data !== 'object') return;
        this.lastSeen = Date.now();
        if (data.type === 'ping') { this.send(conn, { type: 'pong' }); return; }
        if (data.type === 'reject' || data.type === 'closed') { this.fail(String(data.reason || '房主已关闭房间')); return; }
        if (data.type === 'action-error') { this.emit('onError', String(data.reason)); return; }
        if (data.type === 'lobby') {
          this.cancel(this.connectTimeout);
          this.joined = true; this.stage = 'ready';
          this.emit('onStatus', '房间已连接');
          this.lastView = null;
          this.emit('onLobby', { ...data.lobby, isHost: false, selfId: this.peer.id });
        }
        if (data.type === 'state' && data.state && Array.isArray(data.state.hand)) {
          const view = data.state;
          if (this.lastView?.id === view.id && this.lastView.revision >= view.revision) return;
          this.lastView = view;
          this.emit('onState', view);
        }
      });
      conn.on('close', () => {
        if (this.closed || this.hostConnection !== conn) return;
        if (!this.joined) this.retryJoin(conn, '房间连接中断，请让房主保持页面打开并重新加入。[JOIN_CLOSED]');
        else this.fail('房主已离开或连接中断，本房间已结束。可以重新加入或开桌。');
      });
      conn.on('error', () => {
        if (this.closed || this.hostConnection !== conn) return;
        if (!this.joined) this.retryJoin(conn, '与房主建立通道失败，请更换网络后重试。[CHANNEL_ERROR]');
        else this.fail('与房主的连接失败，请更换网络后重试。');
      });
    }
    retryJoin(conn, message) {
      if (this.closed || this.hostConnection !== conn) return;
      this.cancel(this.connectTimeout);
      this.hostConnection = null;
      conn.close();
      if (this.connectAttempts >= 2) { this.fail(message); return; }
      this.stage = 'retry';
      this.emit('onStatus', '首次连接没有成功，正在重新连接…');
      this.retryTimer = this.later(() => this.connectToHost(), 1500);
    }
    resume() {
      if (this.closed || this.mode === 'solo') return;
      this.lastSeen = Date.now();
      for (const entry of this.connections.values()) {
        entry.lastSeen = Date.now();
        this.send(entry.conn, { type: 'ping' });
      }
      if (this.hostConnection?.open) this.send(this.hostConnection, { type: 'ping' });
      if (this.peer?.disconnected && !this.peer.destroyed) {
        try { this.peer.reconnect(); } catch {}
      }
    }
    heartbeat() {
      this.later(() => {
        if (this.mode === 'host') {
          for (const [id, entry] of this.connections) {
            if (!entry.joined) continue;
            if (Date.now() - entry.lastSeen > TIMING.heartbeat) { this.drop(id, entry); entry.conn.close(); }
            else this.send(entry.conn, { type: 'ping' });
          }
        } else if (this.hostConnection?.open) {
          if (Date.now() - this.lastSeen > TIMING.heartbeat) { this.fail('与房主的连接超时，请重新加入房间'); return; }
          this.send(this.hostConnection, { type: 'ping' });
        }
        this.heartbeat();
      }, 6000);
    }
    drop(id, entry) {
      if (this.closed || this.connections.get(id) !== entry) return;
      this.connections.delete(id);
      this.players = this.players.filter(p => p.id !== id);
      if (this.engine && entry.joined) {
        const seat = this.engine.players.findIndex(p => p.id === id);
        if (seat >= 0) this.engine.replaceWithBot(seat);
        this.schedule();
      }
      if (entry.joined) this.publish();
    }
    setFillBots(value) {
      if (this.mode !== 'host' || this.engine) return;
      this.fillBots = !!value; this.publish();
    }
    startGame() {
      if (this.closed || this.mode === 'guest' || (this.engine && this.engine.phase !== 'over')) return;
      if (this.mode === 'host' && this.players.length < 2) { this.emit('onError', '至少需要一位好友加入；也可以返回大厅玩单人模式'); return; }
      const players = this.players.map(p => ({ ...p }));
      if (this.fillBots || this.mode === 'solo') {
        let n = 0;
        while (players.length < 4) { players.push({ id: `bot-${n}`, name: botNames[n], bot: true }); n++; }
      }
      this.cancel(this.timer); this.timerKey = null;
      this.engine = new Engine.Game(players, { round: ++this.round });
      this.publish(); this.schedule();
    }
    backToLobby() {
      if (this.mode !== 'host' || this.engine?.phase !== 'over') return;
      this.cancel(this.timer); this.timerKey = null; this.engine = null;
      this.publish();
    }
    action(action) {
      if (this.closed) return;
      if (this.mode === 'guest') {
        if (!this.send(this.hostConnection, { type: 'action', action })) this.emit('onError', '尚未连上房主，请稍后重试');
      } else if (this.engine) {
        const result = this.engine.act(0, action);
        if (!result.ok) this.emit('onError', result.error);
        else { this.publish(); this.schedule(); }
      }
    }
    publish() {
      if (this.closed) return;
      if (this.engine) {
        this.emit('onState', this.engine.view(0));
        for (const [id, entry] of this.connections) {
          if (!entry.joined) continue;
          const seat = this.engine.players.findIndex(p => p.id === id);
          if (seat >= 0) this.send(entry.conn, { type: 'state', state: this.engine.view(seat) });
        }
      } else {
        const lobby = { code: this.code, players: this.players.map(p => ({ ...p })), fillBots: this.fillBots };
        this.emit('onLobby', { ...lobby, isHost: true, selfId: 'host' });
        for (const entry of this.connections.values()) if (entry.joined) this.send(entry.conn, { type: 'lobby', lobby });
      }
    }
    schedule() {
      const game = this.engine;
      if (!game || this.closed) return;
      const key = `${game.id}:${game.turn}:${game.phase}:${game.drawn}:${game.players[game.current].bot}`;
      if (key === this.timerKey) return;
      this.cancel(this.timer); this.timerKey = key;
      const delay = game.phase === 'settling' ? (game.unoDue === null ? 900 : 3500) :
        game.phase === 'turn' && game.players[game.current].bot ? 1000 : null;
      if (delay === null) return;
      this.timer = this.later(() => {
        this.timerKey = null;
        if (game !== this.engine) return;
        if (game.phase === 'settling') game.advance();
        else game.act(game.current, game.botAction());
        this.publish(); this.schedule();
      }, delay);
    }
    fail(reason) {
      if (this.closed) return;
      const callback = this.callbacks.onClosed;
      this.dispose();
      callback?.(reason);
    }
    dispose() {
      if (this.closed) return;
      if (this.mode === 'host') for (const entry of this.connections.values()) this.send(entry.conn, { type: 'closed', reason: '房主已关闭房间' });
      this.closed = true;
      for (const timer of this.timers) clearTimeout(timer);
      this.timers.clear();
      for (const entry of this.connections.values()) entry.conn.close();
      this.connections.clear();
      this.hostConnection?.close();
      this.peer?.destroy();
    }
  }
  return { Room, cleanName, normalizeCode, CODE_PATTERN, TIMING };
});
