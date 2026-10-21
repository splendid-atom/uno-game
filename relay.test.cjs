const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.crypto ||= require('node:crypto').webcrypto;
const { createRelayServer } = require('./relay-server.cjs');
const { createPeerClass } = require('./relay.js');
const { Room } = require('./network.js');
const until = async fn => {
  const end = Date.now() + 8000;
  while (!fn()) { if (Date.now() > end) throw Error('Timed out'); await new Promise(r => setTimeout(r, 10)); }
};
async function setup(t) {
  const server = createRelayServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => server.shutdown());
  return `http://127.0.0.1:${server.address().port}/relay`;
}
test('HTTPS relay protocol joins four players without WebRTC and preserves private hands and host authority', async t => {
  const endpoint = await setup(t), Peer = createPeerClass(endpoint), clients = [];
  function client() {
    const data = {};
    data.room = new Room({ onLobby: value => data.lobby = value, onState: value => data.state = value, onClosed: value => data.closed = value }, Peer);
    clients.push(data); return data;
  }
  t.after(() => clients.forEach(c => c.room.dispose()));
  const host = client(); host.room.host('流量房主');
  await until(() => host.lobby);
  const guests = [client(), client(), client()];
  guests.forEach((g, i) => g.room.join('玩家' + i, host.room.code));
  await until(() => guests.every(g => g.lobby?.players.length === 4));
  host.room.startGame();
  await until(() => guests.every(g => g.state));
  for (const g of guests) {
    assert.equal(g.state.hand.length, 7);
    assert.equal(g.state.deck, undefined);
    assert.equal(g.state.hands, undefined);
    assert.deepEqual(g.state.hand, host.room.engine.hands[g.state.self]);
  }
  const revision = host.room.engine.revision;
  guests[0].room.action({ ...host.room.engine.botAction(), actor: 0 });
  await guests[0].room.peer.queue;
  assert.equal(host.room.engine.revision, revision, 'guest cannot act for host');
  host.room.action(host.room.engine.botAction());
  await until(() => guests.every(g => g.state.revision > revision));
  guests[0].room.dispose();
  await until(() => host.room.engine.players[1].bot || host.room.engine.players[2].bot || host.room.engine.players[3].bot);
  host.room.dispose();
  await until(() => guests.slice(1).every(g => g.closed));
});
test('relay rejects forged sessions, cross-room messages and foreign origins; replays unacknowledged events', async t => {
  const endpoint = await setup(t);
  const request = async (route, data, token, origin) => {
    const r = await fetch(endpoint + route, { method: data === undefined ? 'GET' : 'POST', headers: {
      ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(origin ? { Origin: origin } : {}), 'Content-Type': 'application/json',
    }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { status: r.status, data: r.status === 204 ? null : await r.json() };
  };
  assert.equal((await request('/session', {}, null, 'https://evil.example')).status, 403);
  const host = (await request('/session', { id: 'uno-party-v2-ABCDEFGH' })).data;
  assert.equal((await request('/session', { id: host.id })).status, 409);
  const guest = (await request('/session', {})).data;
  const stranger = (await request('/session', {})).data;
  const connection = crypto.randomUUID();
  assert.equal((await request('/command', { type: 'connect', target: host.id, connection }, guest.token)).status, 200);
  assert.equal((await request('/command', { type: 'send', connection, data: { attack: true } }, stranger.token)).status, 404);
  assert.equal((await request('/events', undefined, 'fake')).status, 401);
  const first = await request('/events?after=0', undefined, host.token);
  const retry = await request('/events?after=0', undefined, host.token);
  assert.deepEqual(first.data.events, retry.data.events);
  assert.equal(first.data.events[0].peer, guest.id);
  assert.equal((await request('/events?after=999999', undefined, host.token)).status, 400);
  assert.equal((await request('/command', { type: 'send', connection, data: 'x'.repeat(70000) }, guest.token)).status, 413);
});
