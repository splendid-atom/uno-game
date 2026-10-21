/* DOM contract smoke test. This does not measure browser layout or WebRTC. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const UnoEngine = require('./engine.js');
const UnoRoom = require('./network.js');
function loadUI() {
  class Element {
    constructor(tag = 'div') {
      this.tag = tag; this.children = []; this.listeners = {}; this.dataset = {};
      this.value = ''; this.scrollLeft = 0; this.open = false;
      this.style = { setProperty() {} }; this.classList = { toggle() {}, add() {} };
    }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this[name] = value; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    fire(type) { for (const fn of this.listeners[type] || []) fn({ target: this, preventDefault() {} }); }
    showModal() { this.open = true; }
    close() { this.open = false; }
    focus() {} select() {} remove() {}
  }
  const html = fs.readFileSync('index.html', 'utf8'), ids = new Map(), all = [];
  for (const match of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
    const element = new Element(match[1]), attrs = match[2];
    for (const attribute of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) {
      if (attribute[1] === 'id') {
        assert.ok(!ids.has(attribute[2]), `Duplicate DOM id ${attribute[2]}`);
        ids.set(attribute[2], element);
      } else if (attribute[1].startsWith('data-')) element.dataset[attribute[1].slice(5)] = attribute[2];
      else if (attribute[1] === 'class') element.className = attribute[2];
      else if (attribute[1] === 'value') element.value = attribute[2];
    }
    all.push(element);
  }
  const document = {
    getElementById: id => ids.get(id) || null,
    createElement: tag => new Element(tag),
    createTextNode: text => ({ textContent: text }),
    querySelector: selector => all.find(el => selector === '.brand' && el.className === 'brand'),
    querySelectorAll: selector => selector === 'dialog[open]' ? all.filter(el => el.tag === 'dialog' && el.open) :
      selector === '[data-close]' ? all.filter(el => el.dataset.close) :
        selector === '[data-color]' ? all.filter(el => el.dataset.color) : [],
    head: new Element('head'),
  };
  const context = vm.createContext({
    document, UnoEngine, UnoRoom, URL, URLSearchParams, console,
    setTimeout: () => 1, clearTimeout() {},
    localStorage: { getItem() { return null; }, setItem() {} },
    location: { href: 'https://example.test/uno-game/?room=ABCDEFGH', search: '?room=ABCDEFGH' },
    navigator: { clipboard: { async writeText() {} } },
    window: { addEventListener() {} },
  });
  vm.runInContext(fs.readFileSync('script.js', 'utf8') + '\nglobalThis.api = { begin, resetHome, get session() { return session; }, get view() { return view; } };', context);
  return { api: context.api, ids, all };
}
test('invite landing, solo game, sort, round result, rematch and exit are wired', async t => {
  const { api, ids } = loadUI();
  t.after(() => api.resetHome());
  assert.equal(ids.get('roomInput').value, 'ABCDEFGH');
  await api.begin('solo');
  assert.equal(ids.get('homeScreen').hidden, true);
  assert.equal(ids.get('gameScreen').hidden, false);
  assert.equal(ids.get('playerHand').children.length, 7);
  assert.equal(ids.get('opponents').children.length, 3);
  ids.get('sortButton').fire('click');
  assert.match(ids.get('sortButton').textContent, /恢复/);
  const initialId = api.view.id;
  api.session.engine.winner = 0; api.session.engine.phase = 'over'; api.session.publish();
  assert.equal(ids.get('resultDialog').open, true);
  ids.get('rematchButton').fire('click');
  assert.equal(ids.get('resultDialog').open, false);
  assert.notEqual(api.view.id, initialId);
  ids.get('leaveGameButton').fire('click');
  assert.equal(ids.get('leaveDialog').open, true);
  ids.get('confirmLeaveButton').fire('click');
  assert.equal(ids.get('homeScreen').hidden, false); assert.equal(api.session, null);
});
test('wild selection uses chosen color and closes its dialog', async t => {
  const { api, ids, all } = loadUI();
  t.after(() => api.resetHome());
  await api.begin('solo');
  const game = api.session.engine;
  game.hands[0] = [{ id: 999, color: 'wild', value: 'wild' }, { id: 998, color: 'red', value: '3' }];
  game.revision++; api.session.publish();
  ids.get('playerHand').children[0].fire('click');
  assert.equal(ids.get('colorDialog').open, true);
  all.find(el => el.dataset.color === 'blue').fire('click');
  assert.equal(game.color, 'blue'); assert.equal(ids.get('colorDialog').open, false);
  assert.equal(ids.get('unoButton').disabled, false);
  ids.get('unoButton').fire('click');
  assert.equal(game.unoDue, null);
});
