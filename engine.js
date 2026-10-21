/* The host owns this state. Only view(seat) is sent to other players. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UnoEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const COLORS = ['red', 'yellow', 'green', 'blue'];
  const COLOR_NAMES = { red: '红色', yellow: '黄色', green: '绿色', blue: '蓝色' };
  const VALUES = { skip: '跳过', reverse: '反转', draw2: '+2', wild: '变色', wild4: '+4' };
  function shuffle(cards, random = Math.random) {
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    return cards;
  }
  function deck() {
    const cards = [];
    const add = (color, value) => cards.push({ id: cards.length, color, value });
    for (const color of COLORS) {
      add(color, '0');
      for (const value of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'reverse', 'draw2']) {
        add(color, value); add(color, value);
      }
    }
    for (let n = 0; n < 4; n++) { add('wild', 'wild'); add('wild', 'wild4'); }
    return cards;
  }
  class Game {
    constructor(players, options = {}) {
      if (players.length < 2 || players.length > 4) throw new Error('需要 2–4 位玩家');
      this.players = players.map(p => ({ ...p }));
      this.random = options.random || Math.random;
      this.round = options.round || 1;
      this.id = options.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      this.deck = shuffle(deck(), this.random);
      this.hands = players.map(() => []);
      for (let n = 0; n < 7; n++) for (const hand of this.hands) hand.push(this.deck.pop());
      const first = this.deck.findIndex(c => /^\d$/.test(c.value));
      this.discard = [this.deck.splice(first, 1)[0]];
      this.color = this.discard[0].color;
      this.current = 0;
      this.direction = 1;
      this.phase = 'turn';
      this.turn = 1;
      this.revision = 1;
      this.drawn = null;
      this.unoDue = null;
      this.winner = null;
      this.next = null;
      this.log = [];
      this.note('新的一局开始了，祝你好运！');
    }
    note(text) { this.message = text; this.log.unshift(text); this.log = this.log.slice(0, 8); }
    offset(steps = 1) {
      return (this.current + this.direction * steps + this.players.length * 2) % this.players.length;
    }
    draw(seat, count) {
      const cards = [];
      for (let i = 0; i < count; i++) {
        if (!this.deck.length && this.discard.length > 1) {
          const top = this.discard.pop();
          this.deck = shuffle(this.discard, this.random);
          this.discard = [top];
        }
        if (!this.deck.length) break;
        const card = this.deck.pop();
        this.hands[seat].push(card); cards.push(card);
      }
      return cards;
    }
    playable(card, seat) {
      if (card.value === 'wild4') return !this.hands[seat].some(c => c.color === this.color);
      return card.color === 'wild' || card.color === this.color || card.value === this.discard.at(-1).value;
    }
    act(seat, action) {
      if (!action || typeof action !== 'object' || !this.players[seat]) return { ok: false, error: '无效操作' };
      if (action.gameId !== this.id) return { ok: false, error: '本局已更新，请重试' };
      if (action.type === 'uno') {
        if (this.phase !== 'settling' || this.unoDue !== seat) return { ok: false, error: '现在不需要喊 UNO' };
        this.unoDue = null;
        this.note(`${this.players[seat].name}：UNO！`);
        this.revision++;
        return { ok: true };
      }
      if (this.phase !== 'turn' || seat !== this.current || action.turn !== this.turn) {
        return { ok: false, error: '请等待你的回合' };
      }
      const hand = this.hands[seat];
      const name = this.players[seat].name;
      if (action.type === 'play') {
        const index = hand.findIndex(c => c.id === action.cardId);
        const card = hand[index];
        if (!card || (this.drawn !== null && card.id !== this.drawn) || !this.playable(card, seat)) {
          return { ok: false, error: '这张牌现在不能出' };
        }
        if (card.color === 'wild' && !COLORS.includes(action.color)) return { ok: false, error: '请选择颜色' };
        hand.splice(index, 1);
        this.discard.push(card);
        this.color = card.color === 'wild' ? action.color : card.color;
        let steps = 1;
        if (card.value === 'reverse') {
          this.direction *= -1;
          if (this.players.length === 2) steps = 2;
        }
        if (card.value === 'skip') steps = 2;
        let extra = '';
        if (card.value === 'draw2' || card.value === 'wild4') {
          const victim = this.offset();
          const count = this.draw(victim, card.value === 'draw2' ? 2 : 4).length;
          extra = `，${this.players[victim].name} 摸 ${count} 张并跳过`;
          steps = 2;
        }
        this.note(`${name} 打出${COLOR_NAMES[card.color] || ''} ${VALUES[card.value] || card.value}${card.color === 'wild' ? ` → ${COLOR_NAMES[this.color]}` : ''}${extra}`);
        this.drawn = null;
        if (!hand.length) {
          this.winner = seat; this.phase = 'over'; this.note(`${name} 出完了手牌，赢得本局！`);
        } else {
          if (hand.length === 1) {
            if (this.players[seat].bot) this.note(`${name}：UNO！`);
            else this.unoDue = seat;
          }
          this.next = this.offset(steps);
          this.phase = 'settling';
        }
      } else if (action.type === 'draw') {
        if (this.drawn !== null) return { ok: false, error: '本回合已经摸过牌' };
        const [card] = this.draw(seat, 1);
        this.note(card ? `${name} 摸了一张牌` : '牌堆暂时为空，跳过此回合');
        if (card && this.playable(card, seat)) this.drawn = card.id;
        else { this.phase = 'settling'; this.next = this.offset(); }
      } else if (action.type === 'pass') {
        if (this.drawn === null) return { ok: false, error: '请先出牌或摸牌' };
        this.note(`${name} 保留了摸到的牌`);
        this.phase = 'settling'; this.next = this.offset(); this.drawn = null;
      } else return { ok: false, error: '未知操作' };
      this.revision++;
      return { ok: true };
    }
    advance() {
      if (this.phase !== 'settling') return;
      if (this.unoDue !== null) {
        this.draw(this.unoDue, 2);
        this.note(`${this.players[this.unoDue].name} 忘记喊 UNO，罚摸两张`);
        this.unoDue = null;
      }
      this.current = this.next; this.next = null; this.drawn = null;
      this.phase = 'turn'; this.turn++; this.revision++;
    }
    botAction() {
      const seat = this.current;
      const cards = this.hands[seat].filter(c => (this.drawn === null || c.id === this.drawn) && this.playable(c, seat));
      cards.sort((a, b) => Number(a.color === 'wild') - Number(b.color === 'wild'));
      const card = cards[0];
      const counts = color => this.hands[seat].filter(c => c.color === color).length;
      const color = [...COLORS].sort((a, b) => counts(b) - counts(a))[0];
      return card ? { type: 'play', cardId: card.id, color, gameId: this.id, turn: this.turn } :
        { type: this.drawn === null ? 'draw' : 'pass', gameId: this.id, turn: this.turn };
    }
    replaceWithBot(seat) {
      if (!this.players[seat] || this.players[seat].bot) return;
      this.players[seat].bot = true;
      this.note(`${this.players[seat].name} 已离线，电脑接管`);
      if (this.unoDue === seat) this.unoDue = null;
      this.revision++;
    }
    view(seat) {
      const ownTurn = this.current === seat && this.phase === 'turn';
      return {
        id: this.id, revision: this.revision, round: this.round, turn: this.turn,
        phase: this.phase, current: this.current, self: seat, direction: this.direction,
        color: this.color, top: { ...this.discard.at(-1) }, drawn: ownTurn ? this.drawn : null,
        hand: this.hands[seat].map(c => ({ ...c })),
        players: this.players.map((p, i) => ({ name: p.name, bot: !!p.bot, count: this.hands[i].length })),
        legal: ownTurn ? this.hands[seat].filter(c => (this.drawn === null || c.id === this.drawn) && this.playable(c, seat)).map(c => c.id) : [],
        canDraw: ownTurn && this.drawn === null, canPass: ownTurn && this.drawn !== null,
        unoDue: this.unoDue, winner: this.winner, message: this.message, log: [...this.log],
      };
    }
  }
  return { Game, deck, COLORS, COLOR_NAMES, VALUES };
});
