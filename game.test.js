const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadGame() {
  const elements = new Map();
  function element() {
    return {
      style: { setProperty() {} },
      classList: { add() {}, toggle() {} },
      addEventListener() {},
      setAttribute() {},
      replaceChildren() {},
      showModal() { this.open = true; },
      close() { this.open = false; },
    };
  }
  const document = {
    getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
    createElement: element,
    querySelectorAll() { return []; },
  };
  const context = vm.createContext({ document, setTimeout() { return 1; }, clearTimeout() {}, console });
  const code = fs.readFileSync('script.js', 'utf8');
  vm.runInContext(code + '\nglobalThis.api = { get game() { return game; }, makeDeck, canPlay, playCard, startGame };', context);
  return context.api;
}

test('deals a full deck and starts on a numbered card', () => {
  const { game } = loadGame();
  assert.equal(game.deck.length, 79);
  assert.deepEqual(Array.from(game.hands, hand => hand.length), [7, 7, 7, 7]);
  assert.match(game.discard[0].value, /^\d$/);
  assert.equal(game.current, 0);
});

test('wild +4 is legal only without a card of the active color', () => {
  const api = loadGame();
  const wild4 = { id: 1001, color: 'wild', value: 'wild4' };
  api.game.hands[0] = [wild4, { id: 1002, color: api.game.activeColor, value: '7' }];
  assert.equal(api.canPlay(wild4, 0), false);
  api.game.hands[0].pop();
  assert.equal(api.canPlay(wild4, 0), true);
});

test('+2 makes the next player draw two and skips their turn', () => {
  const api = loadGame();
  const color = api.game.activeColor;
  api.game.hands[0] = [{ id: 1001, color, value: 'draw2' }, { id: 1002, color, value: '5' }];
  const before = api.game.hands[1].length;
  api.playCard(0, 1001);
  assert.equal(api.game.hands[1].length, before + 2);
  assert.equal(api.game.phase, 'waiting');
  assert.equal(api.game.unoPending, true);
});
