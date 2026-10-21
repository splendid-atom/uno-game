/* UI stays local; UnoRoom supplies a private snapshot for the current player. */
'use strict';
const $ = id => document.getElementById(id);
const COLOR_HEX = { red: '#ec7465', yellow: '#e8c262', green: '#7ebf9d', blue: '#7c9cdb' };
const SYMBOLS = { skip: '⊘', reverse: '⇄', draw2: '+2', wild: '✦', wild4: '+4' };
const AVATARS = ['#e3f58a', '#e6ae91', '#b0a0d5', '#91b9cc'];
let session = null, view = null, screen = 'home', sorted = false, pendingWild = null;
let pendingMove = false, moveTimeout = null, soundOn = false, audioContext = null;
let toastTimer = null, connecting = false, operation = 0, lastResult = null, peerLoading = null;
let handSignature = '', logSignature = '';
try {
  $('nickname').value = localStorage.getItem('uno-nickname') || '快乐牌友';
  soundOn = localStorage.getItem('uno-sound') === 'true';
} catch {}
function showScreen(next) {
  screen = next;
  for (const name of ['home', 'lobby', 'game']) $(`${name}Screen`).hidden = name !== next;
}
function notify(message) {
  $('toast').textContent = message; $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5500);
}
function setBusy(value, message = '') {
  connecting = value;
  for (const id of ['hostButton', 'joinButton', 'soloButton']) $(id).disabled = value;
  $('homeStatus').textContent = message;
  $('homeScreen').setAttribute('aria-busy', String(value));
  $('cancelConnectButton').hidden = !value;
}
function closeDialogs() { document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()); pendingWild = null; }
function resetHome(message = '') {
  operation++;
  session?.dispose(); session = null; view = null;
  clearTimeout(moveTimeout); pendingMove = false;
  handSignature = ''; logSignature = ''; lastResult = null;
  closeDialogs(); showScreen('home'); setBusy(false);
  $('connectionBadge').innerHTML = '<i></i> 即刻开玩';
  if (message) { $('homeStatus').textContent = message; notify(message); }
}
function playerName() {
  const name = UnoRoom.cleanName($('nickname').value);
  $('nickname').value = name;
  try { localStorage.setItem('uno-nickname', name); } catch {}
  return name;
}
function updateSoundButton() {
  $('soundButton').setAttribute('aria-pressed', String(soundOn));
  $('soundButton').setAttribute('aria-label', soundOn ? '关闭音效' : '开启音效');
  $('soundButton').innerHTML = `♪ <span>音效${soundOn ? '开' : '关'}</span>`;
}
function prepareAudio() {
  if (!soundOn) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  } catch {}
}
function beep(winner = false) {
  if (!soundOn || !audioContext || audioContext.state !== 'running') return;
  try {
    const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(winner ? 660 : 480, audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(winner ? 880 : 640, audioContext.currentTime + .12);
    gain.gain.setValueAtTime(.045, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + .22);
    oscillator.connect(gain); gain.connect(audioContext.destination);
    oscillator.start(); oscillator.stop(audioContext.currentTime + .24);
  } catch {}
}
function ensurePeer() {
  if (window.Peer) return Promise.resolve(window.Peer);
  if (peerLoading) return peerLoading;
  peerLoading = (async () => {
    for (const src of ['vendor/peerjs-1.5.5.min.js', 'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js', 'https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js']) {
      try {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = src; script.async = true;
          const timer = setTimeout(() => { script.remove(); reject(new Error('timeout')); }, 15000);
          script.onload = () => { clearTimeout(timer); window.Peer ? resolve() : reject(new Error('missing Peer')); };
          script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('load error')); };
          document.head.appendChild(script);
        });
        return window.Peer;
      } catch {}
    }
    throw new Error('联机组件加载失败，请检查网络后重试。单人模式仍可游玩。');
  })().finally(() => { peerLoading = null; });
  return peerLoading;
}
function callbacks(token) {
  const active = fn => value => { if (token === operation) fn(value); };
  return {
    onLobby: active(renderLobby), onState: active(renderGame),
    onStatus: active(message => {
      $('connectionBadge').replaceChildren(document.createElement('i'), document.createTextNode(message));
      if (screen === 'home') $('homeStatus').textContent = message;
    }),
    onError: active(message => { pendingMove = false; clearTimeout(moveTimeout); if (view) renderHand(); notify(message); }),
    onClosed: active(message => resetHome(message)),
  };
}
async function begin(mode, code = '') {
  if (connecting) return;
  prepareAudio();
  const token = ++operation, name = playerName();
  session?.dispose(); session = null; view = null;
  handSignature = ''; logSignature = ''; lastResult = null; pendingMove = false;
  if (mode === 'solo') {
    session = new UnoRoom.Room(callbacks(token)); session.solo(name); return;
  }
  if (typeof window.RTCPeerConnection !== 'function') {
    resetHome('当前浏览器不支持联机。请复制网址，用系统 Safari、Chrome 或 Edge 打开。[WEBRTC_UNAVAILABLE]');
    return;
  }
  setBusy(true, mode === 'host' ? '正在为你开一张桌…' : '正在寻找朋友的房间…');
  try {
    const PeerClass = await ensurePeer();
    if (token !== operation) return;
    session = new UnoRoom.Room(callbacks(token), PeerClass);
    if (mode === 'host') session.host(name); else session.join(name, code);
  } catch (error) { if (token === operation) resetHome(error.message); }
}
function avatar(name, index) {
  const el = document.createElement('span');
  el.className = 'avatar'; el.style.setProperty('--avatar-bg', AVATARS[index % AVATARS.length]);
  el.textContent = Array.from(name)[0] || '友'; return el;
}
function renderLobby(lobby) {
  if (screen !== 'lobby') closeDialogs();
  showScreen('lobby'); setBusy(false); view = null;
  $('roomCode').textContent = lobby.code; $('lobbySeats').replaceChildren();
  for (let i = 0; i < 4; i++) {
    const player = lobby.players[i], seat = document.createElement('div');
    seat.className = `lobby-seat${player ? '' : ' empty'}`;
    const name = player ? player.name : '等待朋友';
    seat.append(avatar(player ? name : '+', i));
    const info = document.createElement('div'), label = document.createElement('strong'), detail = document.createElement('small');
    label.textContent = name;
    detail.textContent = player ? `${i === 0 ? '房主' : '已入座'}${player.id === lobby.selfId ? ' · 你' : ''}` : lobby.fillBots ? '开局时电脑补位' : '空座位';
    info.append(label, detail); seat.append(info); $('lobbySeats').append(seat);
  }
  $('fillBots').checked = lobby.fillBots; $('fillBots').disabled = !lobby.isHost;
  $('startGameButton').disabled = !lobby.isHost || lobby.players.length < 2;
  $('startGameButton').textContent = lobby.isHost ? lobby.players.length < 2 ? '等待好友加入…' : `开始游戏 · ${lobby.fillBots ? 4 : lobby.players.length} 人局 →` : '等待房主开始…';
  $('lobbyHint').textContent = lobby.isHost ? `已入座 ${lobby.players.length}/4 人，至少 2 人即可开局` : `已入座 ${lobby.players.length}/4 人，朋友到齐就出发`;
}
function cardElement(card, interactive = false) {
  const node = document.createElement(interactive ? 'button' : 'div');
  if (interactive) node.type = 'button';
  node.className = `playing-card${card.color === 'wild' ? ' wild' : ''}`;
  node.style.setProperty('--card-color', COLOR_HEX[card.color] || '#29322e');
  if (card.color === 'yellow') node.style.setProperty('--ink', '#b58b2e');
  const symbol = SYMBOLS[card.value] || card.value;
  for (const className of ['corner', 'value', 'corner bottom']) {
    const span = document.createElement('span'); span.className = className; span.textContent = symbol; node.append(span);
  }
  const label = `${UnoEngine.COLOR_NAMES[card.color] || '万能'} ${UnoEngine.VALUES[card.value] || card.value}`;
  node.setAttribute('aria-label', label); node.title = label;
  if (interactive) {
    const allowed = view.legal.includes(card.id) && !pendingMove;
    node.disabled = !allowed; node.classList.toggle('playable', allowed); node.classList.toggle('drawn', card.id === view.drawn);
    node.addEventListener('click', () => {
      if (!view.legal.includes(card.id) || pendingMove) return;
      prepareAudio();
      if (card.color === 'wild') {
        pendingWild = { cardId: card.id, gameId: view.id, turn: view.turn };
        $('colorDialog').showModal();
      } else sendAction({ type: 'play', cardId: card.id });
    });
  }
  return node;
}
function renderHand() {
  if (!view) return;
  const signature = JSON.stringify([view.id, view.hand, view.legal, view.drawn, pendingMove, sorted]);
  if (signature !== handSignature) {
    handSignature = signature;
    const cards = [...view.hand];
    if (sorted) {
      const order = ['red', 'yellow', 'green', 'blue', 'wild'];
      cards.sort((a, b) => order.indexOf(a.color) - order.indexOf(b.color) || a.value.localeCompare(b.value));
    }
    const scroll = $('handScroll').scrollLeft;
    $('playerHand').replaceChildren(...cards.map(card => cardElement(card, true)));
    $('handScroll').scrollLeft = scroll;
  }
  $('drawButton').disabled = $('drawPile').disabled = !view.canDraw || pendingMove;
  $('passButton').hidden = !view.canPass; $('passButton').disabled = pendingMove;
  $('unoButton').disabled = view.unoDue !== view.self;
  $('unoButton').setAttribute('aria-label', view.unoDue === view.self ? '立即喊 UNO，否则罚摸两张' : '剩一张牌时喊 UNO');
}
function renderGame(next) {
  const old = view;
  if (screen !== 'game') { closeDialogs(); showScreen('game'); }
  if (next.id !== old?.id) { closeDialogs(); lastResult = null; handSignature = ''; }
  view = next; setBusy(false);
  pendingMove = false; clearTimeout(moveTimeout);
  if (pendingWild && (view.id !== pendingWild.gameId || view.turn !== pendingWild.turn || !view.legal.includes(pendingWild.cardId))) {
    $('colorDialog').close(); pendingWild = null;
  }
  const ownTurn = view.current === view.self && view.phase === 'turn';
  if (ownTurn && (old?.turn !== view.turn || old?.id !== view.id)) beep();
  $('gameMode').textContent = session?.mode === 'solo' ? '单人练习' : `好友房 · ${session?.code || ''}`;
  $('roundNumber').textContent = view.round; $('gameInviteButton').hidden = session?.mode === 'solo';
  $('directionLabel').textContent = view.direction === 1 ? '↻ 顺时针' : '↺ 逆时针';
  $('tableDirection').textContent = view.direction === 1 ? '↻' : '↺';
  $('selfName').textContent = `${view.players[view.self].name} · 你`;
  $('selfAvatar').textContent = Array.from(view.players[view.self].name)[0];
  $('handCount').textContent = `${view.hand.length} 张手牌`; $('yourTurn').hidden = !ownTurn;
  const rivals = view.players.map((p, i) => ({ ...p, seat: i })).filter(p => p.seat !== view.self);
  rivals.sort((a, b) => ((a.seat - view.self + view.players.length) % view.players.length) - ((b.seat - view.self + view.players.length) % view.players.length));
  const positions = rivals.length === 1 ? ['top'] : rivals.length === 2 ? ['left', 'right'] : ['left', 'top', 'right'];
  $('opponents').replaceChildren();
  rivals.forEach((player, i) => {
    const node = document.createElement('div');
    node.className = `opponent pos-${positions[i]}${view.current === player.seat && view.phase !== 'over' ? ' active' : ''}${player.count === 1 ? ' one-card' : ''}`;
    node.append(avatar(player.name, player.seat));
    const info = document.createElement('div'), name = document.createElement('strong'), meta = document.createElement('small'), count = document.createElement('span');
    name.textContent = player.name; meta.textContent = player.bot ? '电脑玩家' : '好友在线';
    count.textContent = player.count; count.className = 'card-count'; count.setAttribute('aria-label', `${player.count} 张手牌`);
    info.append(name, meta); node.append(info, count); $('opponents').append(node);
  });
  $('discardPile').replaceChildren(cardElement(view.top));
  $('activeColor').style.setProperty('--active', COLOR_HEX[view.color]);
  $('activeColor').replaceChildren(document.createElement('i'), document.createTextNode(`当前${UnoEngine.COLOR_NAMES[view.color]}`));
  $('tableNotice').textContent = view.phase === 'over' ? view.message : view.unoDue !== null ? `${view.players[view.unoDue].name}，最后一张！记得喊 UNO!` : view.phase === 'settling' ? view.message : ownTurn ? '轮到你出牌了。打出你的好牌！' : `等待 ${view.players[view.current].name} 出牌…`;
  $('playHint').textContent = view.unoDue === view.self ? '快按 UNO! 还剩最后一张' : view.canPass ? '可打出新摸的牌，也可保留' : ownTurn ? view.legal.length ? '亮起的牌可以出，点击即可' : '没有可出的牌，摸一张吧' : view.phase === 'over' ? '本局结束' : '下一手，准备好了吗？';
  const nextLog = JSON.stringify(view.log);
  if (nextLog !== logSignature) {
    logSignature = nextLog;
    $('gameLog').replaceChildren(...view.log.slice(0, 5).map(message => { const li = document.createElement('li'); li.textContent = message; return li; }));
  }
  renderHand();
  if (view.phase === 'over' && lastResult !== view.id) showResult();
}
function sendAction(action) {
  if (!session || !view || (pendingMove && action.type !== 'uno')) return;
  const payload = { ...action, gameId: view.id, turn: view.turn };
  if (action.type !== 'uno') {
    pendingMove = true; renderHand(); clearTimeout(moveTimeout);
    moveTimeout = setTimeout(() => { if (pendingMove) { pendingMove = false; renderHand(); notify('还没有收到房主回应，请检查连接后重试'); } }, 6000);
  }
  session.action(payload);
}
function showResult() {
  lastResult = view.id;
  const won = view.winner === view.self;
  $('resultTitle').textContent = won ? '漂亮，这局你赢！' : `${view.players[view.winner].name} 赢了！`;
  $('resultDescription').textContent = won ? '所有手牌都出完了。再来一局，延续好运？' : '这一局很精彩。下一次，胜利也许就是你的。';
  const players = view.players.map((p, i) => ({ ...p, seat: i })).sort((a, b) => a.count - b.count);
  $('resultScores').replaceChildren(...players.map(player => {
    const row = document.createElement('div'); row.className = `score-row${player.seat === view.winner ? ' winner' : ''}`;
    const name = document.createElement('span'), count = document.createElement('span');
    name.textContent = `${player.seat === view.winner ? '✦ ' : ''}${player.name}${player.seat === view.self ? '（你）' : ''}`;
    count.textContent = `剩余 ${player.count} 张`; row.append(name, count); return row;
  }));
  $('rematchButton').disabled = session.mode === 'guest';
  $('rematchButton').textContent = session.mode === 'guest' ? '等待房主再开一局…' : '再来一局 →';
  $('returnLobbyButton').hidden = session.mode !== 'host';
  $('resultDialog').showModal(); if (won) beep(true);
}
async function copyInvite(codeOnly = false) {
  if (!session?.code) return;
  const url = new URL(location.href); url.hash = ''; url.search = ''; url.searchParams.set('room', session.code);
  const text = codeOnly ? session.code : url.href;
  try { await navigator.clipboard.writeText(text); notify(codeOnly ? '房间码已复制，发给朋友吧！' : '邀请链接已复制，发给朋友吧！'); }
  catch { $('copyFallback').value = text; $('copyDialog').showModal(); $('copyFallback').select(); }
}
function askLeave() {
  if (!session) return;
  $('leaveDescription').textContent = session.mode === 'host' ? '你是房主。离开后房间会结束，朋友也会返回大厅。' : session.mode === 'guest' ? '离开后你的座位会由电脑接管，本局无法重新入座。' : '当前对局进度不会保留。随时可以再开一局。';
  $('leaveDialog').showModal();
}
$('soloButton').addEventListener('click', () => begin('solo'));
$('hostButton').addEventListener('click', () => begin('host'));
$('joinForm').addEventListener('submit', event => {
  event.preventDefault();
  const code = UnoRoom.normalizeCode($('roomInput').value); $('roomInput').value = code;
  if (!UnoRoom.CODE_PATTERN.test(code)) { notify('请输入正确的 8 位房间码'); $('roomInput').focus(); return; }
  begin('guest', code);
});
$('roomInput').addEventListener('input', event => {
  if (!event.isComposing) $('roomInput').value = UnoRoom.normalizeCode($('roomInput').value);
});
$('cancelConnectButton').addEventListener('click', () => resetHome('已取消连接，可以重新开桌或加入。'));
$('nickname').addEventListener('change', playerName);
$('copyInviteButton').addEventListener('click', () => copyInvite());
$('copyCodeButton').addEventListener('click', () => copyInvite(true));
$('gameInviteButton').addEventListener('click', () => copyInvite());
$('startGameButton').addEventListener('click', () => { prepareAudio(); session?.startGame(); });
$('fillBots').addEventListener('change', event => session?.setFillBots(event.target.checked));
for (const id of ['drawButton', 'drawPile']) $(id).addEventListener('click', () => { if (view?.canDraw) sendAction({ type: 'draw' }); });
$('passButton').addEventListener('click', () => { if (view?.canPass) sendAction({ type: 'pass' }); });
$('unoButton').addEventListener('click', () => sendAction({ type: 'uno' }));
$('sortButton').addEventListener('click', () => { sorted = !sorted; $('sortButton').textContent = sorted ? '⇆ 恢复发牌顺序' : '⇆ 按颜色整理'; renderHand(); });
$('rulesButton').addEventListener('click', () => $('rulesDialog').showModal());
$('soundButton').addEventListener('click', () => {
  soundOn = !soundOn; updateSoundButton(); prepareAudio(); if (soundOn) beep();
  try { localStorage.setItem('uno-sound', String(soundOn)); } catch {}
});
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => {
  $(button.dataset.close).close(); if (button.dataset.close === 'colorDialog') pendingWild = null;
}));
$('colorDialog').addEventListener('cancel', () => { pendingWild = null; });
document.querySelectorAll('[data-color]').forEach(button => button.addEventListener('click', () => {
  const pending = pendingWild; pendingWild = null; $('colorDialog').close();
  if (!pending || !view || pending.gameId !== view.id || pending.turn !== view.turn) return;
  sendAction({ type: 'play', cardId: pending.cardId, color: button.dataset.color });
}));
for (const id of ['leaveLobbyButton', 'leaveGameButton', 'resultHomeButton']) $(id).addEventListener('click', askLeave);
$('confirmLeaveButton').addEventListener('click', () => resetHome());
$('rematchButton').addEventListener('click', () => { if (session?.mode !== 'guest') session?.startGame(); });
$('returnLobbyButton').addEventListener('click', () => session?.backToLobby());
$('resultDialog').addEventListener('cancel', event => event.preventDefault());
document.querySelector('.brand').addEventListener('click', event => { if (session || connecting) { event.preventDefault(); if (session) askLeave(); else resetHome(); } });
window.addEventListener('beforeunload', event => { if (session && session.mode !== 'solo' && !session.closed) { event.preventDefault(); event.returnValue = ''; } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') session?.resume(); });
window.addEventListener('online', () => session?.resume());
const roomFromLink = new URLSearchParams(location.search).get('room')?.toUpperCase();
if (roomFromLink && UnoRoom.CODE_PATTERN.test(roomFromLink)) {
  $('roomInput').value = roomFromLink;
  $('homeStatus').textContent = `朋友在房间 ${roomFromLink} 等你，填好昵称后点击箭头加入。`;
}
updateSoundButton();
