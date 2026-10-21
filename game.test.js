const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, deck } = require('./engine.js');
const { Room } = require('./network.js');
const { EventEmitter } = require('node:events');
globalThis.crypto ||= require('node:crypto').webcrypto;
const players = n => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `玩家${i}`, bot: false }));
const act = (game, seat, command) => game.act(seat, { ...command, gameId: game.id, turn: game.turn });
const card = (id, color, value) => ({ id, color, value });
function fixture(n = 4) {
  const game = new Game(players(n));
  game.color = 'red'; game.discard = [card(1000, 'red', '7')];
  game.hands[0] = [card(1001, 'red', '3'), card(1002, 'blue', '2'), card(1003, 'green', '7')];
  return game;
}
test('108 unique cards; seven dealt each; numbered initial discard', () => {
  assert.equal(deck().length, 108); assert.equal(new Set(deck().map(c => c.id)).size, 108);
  for (const n of [2, 3, 4]) {
    const game = new Game(players(n));
    assert.equal(game.deck.length, 108 - 7 * n - 1);
    assert.ok(game.hands.every(hand => hand.length === 7));
    assert.match(game.discard[0].value, /^\d$/);
  }
});
test('rejects another seat, stale round, stale turn, illegal play and duplicate click', () => {
  const game = fixture(), before = JSON.stringify(game.view(0));
  assert.equal(act(game, 1, { type: 'play', cardId: 1001 }).ok, false);
  assert.equal(game.act(0, { type: 'draw', gameId: 'old', turn: game.turn }).ok, false);
  assert.equal(game.act(0, { type: 'draw', gameId: game.id, turn: -1 }).ok, false);
  assert.equal(act(game, 0, { type: 'play', cardId: 1002 }).ok, false);
  assert.equal(JSON.stringify(game.view(0)), before);
  assert.equal(act(game, 0, { type: 'play', cardId: 1001 }).ok, true);
  assert.equal(act(game, 0, { type: 'play', cardId: 1001 }).ok, false);
  assert.equal(game.hands[0].length, 2);
});
test('+4 legality and color validation', () => {
  const game = fixture(); game.hands[0].push(card(1004, 'wild', 'wild4'));
  assert.equal(act(game, 0, { type: 'play', cardId: 1004, color: 'blue' }).ok, false);
  game.hands[0] = [card(1004, 'wild', 'wild4'), card(1002, 'blue', '2')];
  assert.equal(act(game, 0, { type: 'play', cardId: 1004, color: 'purple' }).ok, false);
  assert.equal(act(game, 0, { type: 'play', cardId: 1004, color: 'green' }).ok, true);
  assert.equal(game.hands[1].length, 11);
  assert.equal(game.color, 'green'); game.advance(); assert.equal(game.current, 2);
});
test('reverse changes direction; two-player reverse returns to the actor', () => {
  for (const n of [2, 4]) {
    const game = fixture(n); game.hands[0][0].value = 'reverse';
    act(game, 0, { type: 'play', cardId: 1001 }); game.advance();
    assert.equal(game.direction, -1); assert.equal(game.current, n === 2 ? 0 : 3);
  }
});
test('drawn-card restriction, pass, and no second draw', () => {
  const game = fixture(); game.deck.push(card(2000, 'red', '9'));
  assert.equal(act(game, 0, { type: 'draw' }).ok, true);
  assert.deepEqual(game.view(0).legal, [2000]);
  assert.equal(act(game, 0, { type: 'draw' }).ok, false);
  assert.equal(act(game, 0, { type: 'play', cardId: 1001 }).ok, false);
  assert.equal(act(game, 0, { type: 'pass' }).ok, true);
  game.advance(); assert.equal(game.current, 1); assert.equal(game.drawn, null);
});
test('UNO is accepted only for the right player and missing it draws two', () => {
  for (const called of [true, false]) {
    const game = fixture(); game.hands[0].pop();
    act(game, 0, { type: 'play', cardId: 1001 });
    assert.equal(game.unoDue, 0);
    assert.equal(act(game, 1, { type: 'uno' }).ok, false);
    if (called) assert.equal(act(game, 0, { type: 'uno' }).ok, true);
    game.advance(); assert.equal(game.hands[0].length, called ? 1 : 3);
  }
});
test('last +2 applies its penalty and finishes the round', () => {
  const game = fixture();
  game.hands[0] = [card(1001, 'red', 'draw2')];
  act(game, 0, { type: 'play', cardId: 1001 });
  assert.equal(game.hands[1].length, 9); assert.equal(game.winner, 0); assert.equal(game.phase, 'over');
  assert.equal(act(game, 1, { type: 'draw' }).ok, false);
});
test('private view contains no deck or opponents hands and cannot mutate authority', () => {
  const game = fixture(), view = game.view(1);
  assert.equal(view.hands, undefined); assert.equal(view.deck, undefined);
  assert.ok(view.players.every(p => !('hand' in p) && !('id' in p)));
  const original = game.hands[1][0].value;
  view.hand[0].value = 'changed'; view.top.color = 'blue';
  assert.equal(game.hands[1][0].value, original); assert.equal(game.discard.at(-1).color, 'red');
});
test('reshuffle preserves top discard and selected color', () => {
  const game = fixture();
  game.deck = []; game.discard.push(card(2000, 'wild', 'wild')); game.color = 'green';
  const received = game.draw(1, 1);
  assert.equal(received[0].id, 1000); assert.equal(game.discard.length, 1);
  assert.equal(game.discard[0].id, 2000); assert.equal(game.color, 'green');
});
test('60 seeded complete games preserve every card and always reach a winner', () => {
  for (let seed = 1; seed <= 60; seed++) {
    let randomSeed = seed;
    const random = () => ((randomSeed = (randomSeed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const game = new Game(players(2 + seed % 3).map(p => ({ ...p, bot: true })), { random });
    let moves = 0;
    while (game.phase !== 'over' && moves++ < 4000) {
      if (game.phase === 'settling') game.advance();
      else assert.equal(game.act(game.current, game.botAction()).ok, true);
      const all = [...game.deck, ...game.discard, ...game.hands.flat()];
      assert.equal(all.length, 108); assert.equal(new Set(all.map(c => c.id)).size, 108);
    }
    assert.equal(game.phase, 'over', `seed ${seed}`);
    assert.equal(game.hands[game.winner].length, 0);
  }
});

// In-memory transport exercises the actual room protocol without claiming real WebRTC coverage.
class Wire extends EventEmitter {
  constructor(peer) { super(); this.peer = peer; this.open = false; this.sent = []; }
  send(data) {
    assert.equal(this.open, true);
    const packet = JSON.parse(JSON.stringify(data)); this.sent.push(packet);
    queueMicrotask(() => { if (this.other.open) this.other.emit('data', packet); });
  }
  close() {
    if (!this.open) return;
    this.open = false; this.other.open = false;
    queueMicrotask(() => { this.emit('close'); this.other.emit('close'); });
  }
}
class FakePeer extends EventEmitter {
  static registry = new Map();
  static counter = 0;
  constructor(id) {
    super(); this.id = id || `guest${++FakePeer.counter}`; this.connections = []; this.destroyed = false;
    FakePeer.registry.set(this.id, this);
    queueMicrotask(() => { if (!this.destroyed) this.emit('open', this.id); });
  }
  connect(id) {
    const target = FakePeer.registry.get(id), outgoing = new Wire(id);
    this.connections.push(outgoing);
    queueMicrotask(() => {
      if (!target) { this.emit('error', { type: 'peer-unavailable' }); return; }
      const incoming = new Wire(this.id); outgoing.other = incoming; incoming.other = outgoing;
      target.connections.push(incoming); target.emit('connection', incoming);
      outgoing.open = incoming.open = true; incoming.emit('open'); outgoing.emit('open');
    });
    return outgoing;
  }
  destroy() {
    this.destroyed = true; FakePeer.registry.delete(this.id);
    this.connections.forEach(c => c.close()); this.emit('close');
  }
  reconnect() { this.disconnected = false; this.emit('open', this.id); }
}
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
function client() {
  const state = { lobby: null, view: null, error: null, closed: null };
  const room = new Room({
    onLobby: value => { state.lobby = value; },
    onState: value => { state.view = value; },
    onError: value => { state.error = value; },
    onClosed: value => { state.closed = value; },
  }, FakePeer);
  return { room, state };
}
test('four connected clients receive private hands and cannot impersonate another seat', async t => {
  const clients = [client(), client(), client(), client()];
  t.after(() => clients.forEach(c => c.room.dispose()));
  const host = clients[0]; host.room.host('房主'); await flush();
  for (let i = 1; i < clients.length; i++) { clients[i].room.join(`好友${i}`, host.room.code); await flush(); }
  assert.equal(host.state.lobby.players.length, 4);
  host.room.startGame(); await flush();
  clients.forEach((c, i) => {
    assert.equal(c.state.view.self, i); assert.equal(c.state.view.hand.length, 7);
    assert.equal(c.state.view.id, host.state.view.id); assert.equal(c.state.view.deck, undefined);
  });
  assert.equal(new Set(clients.flatMap(c => c.state.view.hand.map(c => c.id))).size, 28);
  const before = host.room.engine.hands[0].length;
  clients[1].room.action({ ...host.room.engine.botAction(), seat: 0 }); await flush();
  assert.equal(host.room.engine.hands[0].length, before); assert.ok(clients[1].state.error);
  host.room.action(host.room.engine.botAction()); await flush();
  assert.equal(clients[1].state.view.revision, host.state.view.revision);
  assert.deepEqual(clients[1].state.view.top, host.state.view.top);
});
test('late join and full room are rejected; departing guest is replaced by a bot', async t => {
  const clients = Array.from({ length: 6 }, client);
  t.after(() => clients.forEach(c => c.room.dispose()));
  const host = clients[0]; host.room.host('房主'); await flush();
  for (let i = 1; i < 5; i++) { clients[i].room.join(`好友${i}`, host.room.code); await flush(); }
  assert.match(clients[4].state.closed, /已满/);
  host.room.startGame(); await flush();
  clients[5].room.join('迟到玩家', host.room.code); await flush();
  assert.match(clients[5].state.closed, /已经开始/);
  clients[1].room.dispose(); await flush();
  assert.equal(host.room.engine.players[1].bot, true);
  assert.equal(clients[2].state.view.players[1].bot, true);
});
test('two-player lobby option, return to lobby, rematch, and host shutdown synchronize', async t => {
  const host = client(), guest = client();
  t.after(() => { host.room.dispose(); guest.room.dispose(); });
  host.room.host('房主'); await flush();
  guest.room.join('牌友', host.room.code); await flush();
  host.room.setFillBots(false); await flush();
  assert.equal(guest.state.lobby.fillBots, false);
  host.room.startGame(); await flush();
  assert.equal(guest.state.view.players.length, 2);
  const firstRound = guest.state.view.id;
  host.room.engine.phase = 'over'; host.room.engine.winner = 0;
  host.room.backToLobby(); await flush();
  assert.equal(host.room.engine, null); assert.equal(guest.room.lastView, null);
  host.room.startGame(); await flush();
  assert.notEqual(guest.state.view.id, firstRound); assert.equal(guest.state.view.round, 2);
  host.room.dispose(); await flush(); assert.match(guest.state.closed, /房主/); assert.equal(guest.room.closed, true);
});
