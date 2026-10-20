const COLORS = { red: ['红色', '#ee554e'], yellow: ['黄色', '#f4c84e'], green: ['绿色', '#42bd78'], blue: ['蓝色', '#4d88e9'] };
const PLAYERS = ['你', '小紫', '桃桃', '阿蓝'];
const SYMBOLS = { skip: '⊘', reverse: '⇄', draw2: '+2', wild: '变色', wild4: '+4' };
const LABELS = { skip: '跳过', reverse: '反转', draw2: '+2', wild: '万能变色', wild4: '万能 +4' };
const $ = id => document.getElementById(id);
let game;
let nextId = 1;
let generation = 0;
let botTimer;

function makeDeck() {
  const deck = [];
  for (const color of Object.keys(COLORS)) {
    deck.push({ id: nextId++, color, value: '0' });
    for (const value of ['1','2','3','4','5','6','7','8','9','skip','reverse','draw2']) {
      for (let n = 0; n < 2; n++) deck.push({ id: nextId++, color, value });
    }
  }
  for (let n = 0; n < 4; n++) {
    deck.push({ id: nextId++, color: 'wild', value: 'wild' });
    deck.push({ id: nextId++, color: 'wild', value: 'wild4' });
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function startGame() {
  generation++;
  clearTimeout(botTimer);
  for (const id of ['resultDialog', 'colorDialog']) if ($(id).open) $(id).close();
  const round = game ? game.round + 1 : 1;
  game = { round, deck: makeDeck(), hands: [[], [], [], []], discard: [], current: 0, direction: 1, activeColor: null, phase: 'turn', drawnId: null, pendingWildId: null, unoPending: false, message: '轮到你了，选一张牌出手！' };
  for (let n = 0; n < 7; n++) for (const hand of game.hands) hand.push(game.deck.pop());
  const initialIndex = game.deck.findIndex(card => card.color !== 'wild' && /^\d$/.test(card.value));
  const [initial] = game.deck.splice(initialIndex, 1);
  game.discard.push(initial);
  game.activeColor = initial.color;
  render();
}

function refillDeck() {
  if (game.deck.length || game.discard.length < 2) return;
  const top = game.discard.pop();
  game.deck = game.discard;
  game.discard = [top];
  for (let i = game.deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [game.deck[i], game.deck[j]] = [game.deck[j], game.deck[i]];
  }
}

function drawCards(player, count) {
  const received = [];
  for (let i = 0; i < count; i++) {
    refillDeck();
    if (!game.deck.length) break;
    const card = game.deck.pop();
    game.hands[player].push(card);
    received.push(card);
  }
  return received;
}

function canPlay(card, player) {
  if (card.value === 'wild4') return !game.hands[player].some(other => other.id !== card.id && other.color === game.activeColor);
  if (card.color === 'wild') return true;
  const top = game.discard.at(-1);
  return card.color === game.activeColor || card.value === top.value;
}

function cardElement(card, clickable = false) {
  const el = document.createElement(clickable ? 'button' : 'div');
  const wild = card.color === 'wild';
  el.className = clickable ? 'card' : 'discard-card';
  if (wild) el.classList.add('wild');
  el.style.setProperty('--card-color', wild ? '#fff' : card.color === 'yellow' ? '#ba8016' : COLORS[card.color][1]);
  if (!wild) el.style.background = COLORS[card.color][1];
  const label = SYMBOLS[card.value] || card.value;
  el.innerHTML = `<span class="card-corner">${label}</span><span class="card-value">${label}</span><span class="card-corner bottom">${label}</span>`;
  el.setAttribute('aria-label', `${wild ? '' : COLORS[card.color][0]}${LABELS[card.value] || card.value}`);
  if (clickable) {
    const playable = game.phase === 'turn' && game.current === 0 && (!game.drawnId || game.drawnId === card.id) && canPlay(card, 0);
    el.disabled = !playable;
    if (game.drawnId === card.id) el.classList.add('drawn');
    el.addEventListener('click', () => chooseHumanCard(card.id));
  }
  return el;
}

function renderOpponent(index, color) {
  const node = $(`opponent${index}`);
  node.classList.toggle('active', game.current === index && game.phase !== 'over');
  const count = game.hands[index].length;
  node.innerHTML = `<span class="avatar avatar-${color}">${PLAYERS[index].slice(0, 1)}</span><span><strong>${PLAYERS[index]}</strong><small>${count} 张卡牌</small></span><span class="mini-cards"><i style="--r:-11deg"></i><i style="--r:5deg"></i><i style="--r:13deg"></i></span>`;
}

function render() {
  $('roundNumber').textContent = game.round;
  $('turnMessage').textContent = game.message;
  $('handCount').textContent = `${game.hands[0].length} 张卡牌`;
  renderOpponent(1, 'purple'); renderOpponent(2, 'pink'); renderOpponent(3, 'blue');
  $('discardPile').replaceChildren(cardElement(game.discard.at(-1)));
  $('activeColor').textContent = COLORS[game.activeColor][0];
  $('activeColor').style.setProperty('--active', COLORS[game.activeColor][1]);
  $('drawButton').disabled = game.current !== 0 || game.phase !== 'turn' || !!game.drawnId;
  $('unoButton').disabled = !game.unoPending || game.phase === 'over';
  $('passButton').hidden = !game.drawnId || game.phase !== 'turn';
  $('playHint').textContent = game.current === 0 ? game.drawnId ? '可打出新牌，也可选择不出' : '选择一张可出的牌' : '等待其他玩家出牌…';
  $('playerHand').replaceChildren(...game.hands[0].map(card => cardElement(card, true)));
}

function nextPlayer(steps = 1) {
  game.current = (game.current + game.direction * steps + 8) % 4;
  game.drawnId = null;
  game.phase = 'turn';
  game.message = game.current === 0 ? '轮到你了，选一张牌出手！' : `轮到 ${PLAYERS[game.current]} 出牌…`;
  render();
  if (game.current !== 0) scheduleBot();
}

function chooseHumanCard(id) {
  if (game.current !== 0 || game.phase !== 'turn') return;
  const card = game.hands[0].find(c => c.id === id);
  if (!card || (game.drawnId && game.drawnId !== id) || !canPlay(card, 0)) return;
  if (card.color === 'wild') {
    game.pendingWildId = id;
    game.phase = 'choosing';
    render();
    $('colorDialog').showModal();
    return;
  }
  playCard(0, id);
}

function preferredColor(hand) {
  const counts = Object.fromEntries(Object.keys(COLORS).map(color => [color, hand.filter(c => c.color === color).length]));
  return Object.keys(COLORS).sort((a, b) => counts[b] - counts[a])[0];
}

function playCard(player, id, selectedColor) {
  const hand = game.hands[player];
  const index = hand.findIndex(card => card.id === id);
  if (index < 0) return;
  const [card] = hand.splice(index, 1);
  game.discard.push(card);
  game.activeColor = selectedColor || card.color;
  game.drawnId = null;
  if (player === 0 && hand.length === 1) game.unoPending = true;
  if (!hand.length) {
    game.phase = 'over';
    game.message = player === 0 ? '恭喜！你赢得了这一局！' : `${PLAYERS[player]} 赢得了这一局！`;
    render();
    $('resultIcon').textContent = player === 0 ? '★' : '↻';
    $('resultTitle').textContent = player === 0 ? '漂亮，赢了！' : `${PLAYERS[player]} 获胜`;
    $('resultText').textContent = player === 0 ? '你率先出完了所有卡牌。再来一局？' : '这次差一点。整理手牌，再挑战一次吧！';
    $('resultDialog').showModal();
    return;
  }
  let steps = 1;
  if (card.value === 'reverse') game.direction *= -1;
  if (card.value === 'skip') steps = 2;
  if (card.value === 'draw2' || card.value === 'wild4') {
    const victim = (player + game.direction + 4) % 4;
    drawCards(victim, card.value === 'draw2' ? 2 : 4);
    steps = 2;
  }
  game.message = `${PLAYERS[player]} 打出了${LABELS[card.value] || card.value}${card.color === 'wild' ? `，指定${COLORS[game.activeColor][0]}` : ''}`;
  game.phase = 'waiting';
  render();
  const token = generation;
  botTimer = setTimeout(() => {
    if (token !== generation || game.phase === 'over') return;
    if (game.unoPending) {
      drawCards(0, 2);
      game.unoPending = false;
      game.message = '忘记喊 UNO！你被罚摸两张牌。';
    }
    nextPlayer(steps);
  }, player === 0 && game.unoPending ? 2600 : 950);
}

function scheduleBot() {
  const token = generation;
  botTimer = setTimeout(() => { if (token === generation && game.phase === 'turn' && game.current !== 0) botTurn(); }, 1150);
}

function botTurn() {
  const player = game.current;
  const options = game.hands[player].filter(card => canPlay(card, player));
  if (!options.length) {
    const [card] = drawCards(player, 1);
    if (card && canPlay(card, player)) options.push(card);
  }
  if (!options.length) {
    game.message = `${PLAYERS[player]} 摸了一张牌`;
    game.phase = 'waiting';
    render();
    botTimer = setTimeout(() => nextPlayer(), 850);
    return;
  }
  options.sort((a, b) => Number(a.color === 'wild') - Number(b.color === 'wild'));
  const card = options[0];
  const chosenColor = card.color === 'wild' ? preferredColor(game.hands[player].filter(c => c.id !== card.id)) : undefined;
  playCard(player, card.id, chosenColor);
}

$('drawButton').addEventListener('click', () => {
  if (game.current !== 0 || game.phase !== 'turn' || game.drawnId) return;
  const [card] = drawCards(0, 1);
  if (card && canPlay(card, 0)) {
    game.drawnId = card.id;
    game.message = '摸到可出的牌：打出它，或选择不出。';
    render();
  } else {
    game.message = card ? '没有可出的牌，轮到下一位。' : '牌堆已空，轮到下一位。';
    game.phase = 'waiting';
    render();
    botTimer = setTimeout(() => nextPlayer(), 900);
  }
});
$('passButton').addEventListener('click', () => { if (game.current === 0 && game.drawnId) nextPlayer(); });
$('unoButton').addEventListener('click', () => {
  if (!game.unoPending) return;
  game.unoPending = false;
  game.message = 'UNO！喊得漂亮。';
  render();
});
$('colorDialog').addEventListener('cancel', event => event.preventDefault());
document.querySelectorAll('[data-color]').forEach(button => button.addEventListener('click', () => {
  if (!game.pendingWildId) return;
  const id = game.pendingWildId;
  game.pendingWildId = null;
  $('colorDialog').close();
  playCard(0, id, button.dataset.color);
}));
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => {
  const id = button.dataset.close;
  if (id === 'colorDialog' && game?.phase === 'choosing') { game.phase = 'turn'; game.pendingWildId = null; render(); }
  $(id).close();
}));
$('rulesButton').addEventListener('click', () => $('rulesDialog').showModal());
$('newGameButton').addEventListener('click', startGame);
$('playAgainButton').addEventListener('click', startGame);
startGame();
