const SUITS = [
  { id: 'hearts', name: 'Cuori', symbol: '♥', color: 'red' },
  { id: 'diamonds', name: 'Quadri', symbol: '♦', color: 'red' },
  { id: 'clubs', name: 'Fiori', symbol: '♣', color: 'black' },
  { id: 'spades', name: 'Picche', symbol: '♠', color: 'black' },
];

const SUIT_BY_ID = Object.fromEntries(SUITS.map((suit) => [suit.id, suit]));
const RANKS = ['7', '8', '9', 'J', 'Q', 'K', '10', 'A'];
const TRUMP_POINTS = { J: 20, 9: 14, A: 11, 10: 10, K: 4, Q: 3, 8: 0, 7: 0 };
const PLAIN_POINTS = { A: 11, 10: 10, K: 4, Q: 3, J: 2, 9: 0, 8: 0, 7: 0 };
const TRUMP_POWER = { J: 80, 9: 70, A: 60, 10: 55, K: 50, Q: 45, 8: 40, 7: 35 };
const PLAIN_POWER = { A: 80, 10: 70, K: 60, Q: 50, J: 40, 9: 30, 8: 20, 7: 10 };
const ORDER_FOR_RUNS = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const ANNOUNCE_RANK_POWER = { 7: 1, 8: 2, 9: 3, 10: 4, J: 5, Q: 6, K: 7, A: 8 };
const PLAYERS = [
  { id: 0, name: 'Tu', team: 0, seat: 'south' },
  { id: 1, name: 'Sinistra', team: 1, seat: 'west' },
  { id: 2, name: 'Compagno', team: 0, seat: 'north' },
  { id: 3, name: 'Destra', team: 1, seat: 'east' },
];
const TEAM_NAMES = ['Noi', 'Loro'];
const PARTNER_ID = 2;
const ROOM_PARAM = new URLSearchParams(window.location.search).get('room');

let game = newRound([0, 0], 0);
let selectedSuit = 'hearts';
let selectedAmount = 82;
let selectedAnnouncements = new Set();
let online = {
  enabled: false,
  room: ROOM_PARAM,
  token: ROOM_PARAM ? localStorage.getItem(`belote-token-${ROOM_PARAM}`) : '',
  playerId: ROOM_PARAM ? Number(localStorage.getItem(`belote-seat-${ROOM_PARAM}`)) : 0,
  preferredSeat: Number(localStorage.getItem('belote-preferred-seat') || 0),
  seats: {},
  error: '',
};

function makeDeck() {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ id: `${rank}-${suit.id}`, rank, suit: suit.id })));
}

function shuffle(deck) {
  const copy = [...deck];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function deal() {
  const deck = shuffle(makeDeck());
  return PLAYERS.map((_, player) => deck.slice(player * 8, player * 8 + 8));
}

function nextPlayer(playerId) {
  return (playerId + 3) % 4;
}

function newRound(scores = [0, 0], starter = 0, message = 'Guarda le carte, scegli se aprire almeno a 82 e poi dichiara gli accusi alla prima mano.') {
  const hands = deal();
  return {
    phase: 'bidding',
    handNumber: 1,
    starter,
    nextStarter: nextPlayer(starter),
    hands,
    handsAtStart: hands.map((hand) => [...hand]),
    bidder: starter,
    currentBid: null,
    bidHistory: [],
    passCount: 0,
    finalSpeech: [],
    declaredPlayers: [false, false, false, false],
    declaredAnnouncements: [[], []],
    trick: [],
    trickLeader: starter,
    activePlayer: starter,
    taken: [[], []],
    handPoints: [0, 0],
    scores,
    lastTrickWinner: null,
    message,
    pendingClear: false,
    result: null,
  };
}

function sortHand(hand, trump) {
  return [...hand].sort((a, b) => {
    if (a.hidden || b.hidden) return 0;
    const suitDelta = SUITS.findIndex((s) => s.id === a.suit) - SUITS.findIndex((s) => s.id === b.suit);
    if (suitDelta !== 0) return suitDelta;
    const power = (card) => (card.suit === trump ? TRUMP_POWER[card.rank] : PLAIN_POWER[card.rank]);
    return power(b) - power(a);
  });
}

function cardPoints(card, trump) {
  return card.suit === trump ? TRUMP_POINTS[card.rank] : PLAIN_POINTS[card.rank];
}

function cardPower(card, trump, leadSuit) {
  const base = card.suit === trump ? TRUMP_POWER[card.rank] + 1000 : PLAIN_POWER[card.rank];
  return card.suit === leadSuit ? base + 200 : base;
}

function chooseWinner(trick, trump) {
  const leadSuit = trick[0].card.suit;
  return trick.reduce((winner, play) => (cardPower(play.card, trump, leadSuit) > cardPower(winner.card, trump, leadSuit) ? play : winner));
}

function legalCards(hand, trick, trump) {
  if (!trick.length) return hand;
  const leadSuit = trick[0].card.suit;
  const sameSuit = hand.filter((card) => card.suit === leadSuit);
  if (sameSuit.length) return sameSuit;
  const trumps = hand.filter((card) => card.suit === trump);
  return trumps.length ? trumps : hand;
}

function minimumBid(currentBid, suit) {
  if (!currentBid) return 82;
  return currentBid.suit === suit ? currentBid.amount + 1 : currentBid.amount + 10;
}

function currentPlayerId() {
  return online.enabled && Number.isInteger(online.playerId) ? online.playerId : 0;
}

function canControlPlayer(playerId) {
  return online.enabled ? playerId === online.playerId : playerId === 0;
}

function turnText(playerId) {
  return playerId === currentPlayerId() ? 'Tocca a te.' : `Tocca a ${PLAYERS[playerId].name}.`;
}

function evaluateSuit(hand, suit) {
  const cards = hand.filter((card) => card.suit === suit);
  return cards.reduce((sum, card) => sum + cardPoints(card, suit), 0) + cards.length * 3;
}

function bestBidFor(hand, currentBid) {
  const best = SUITS.map((suit) => ({ suit: suit.id, score: evaluateSuit(hand, suit.id) })).sort((a, b) => b.score - a.score)[0];
  const minimum = minimumBid(currentBid, best.suit);
  if (best.score < 44 && minimum > 92) return null;
  const amount = Math.max(minimum, 82 + Math.floor(best.score / 9) * 10);
  return amount <= 162 ? { suit: best.suit, amount: Math.min(162, amount) } : null;
}

function partnerSignal(hand, bid) {
  if (!bid) return null;
  const cards = hand.filter((card) => card.suit === bid.suit);
  const hasNineOrJack = cards.some((card) => card.rank === '9' || card.rank === 'J');
  if (cards.length >= 3) return hasNineOrJack ? 'alzo dieci' : 'alzo';
  if (cards.length === 2) return hasNineOrJack ? 'ancora dieci' : 'ancora';
  if (cards.length === 1 && hasNineOrJack) return 'da dieci';
  return 'passo';
}

function finalSpeech(hand, trump) {
  const aces = hand.filter((card) => card.rank === 'A');
  const hasNonTrumpAce = aces.some((card) => card.suit !== trump);
  return hasNonTrumpAce ? 'aspetto' : 'passo';
}

function runAnnouncement(run, suit) {
  const topRank = run[run.length - 1];
  return {
    id: `run-${suit}-${run.join('-')}`,
    type: 'run',
    value: run.length === 3 ? 20 : run.length === 4 ? 50 : 100,
    family: `run-${run.length >= 5 ? 5 : run.length}`,
    strength: ANNOUNCE_RANK_POWER[topRank],
    label: `${run.length === 3 ? 'Terza' : run.length === 4 ? 'Quarta' : 'Quinta'} ${run.join('-')} a ${SUIT_BY_ID[suit].name}`,
  };
}

function rankRunAnnouncements(hand) {
  const announcements = [];
  for (const suit of SUITS) {
    const present = new Set(hand.filter((card) => card.suit === suit.id).map((card) => card.rank));
    let run = [];
    for (const rank of ORDER_FOR_RUNS) {
      if (present.has(rank)) {
        run.push(rank);
      } else {
        if (run.length >= 3) announcements.push(runAnnouncement(run, suit.id));
        run = [];
      }
    }
    if (run.length >= 3) announcements.push(runAnnouncement(run, suit.id));
  }
  return announcements;
}

function squareAnnouncements(hand) {
  const announcements = [];
  for (const rank of ['J', '9', 'A', '10', 'K', 'Q']) {
    if (hand.filter((card) => card.rank === rank).length === 4) {
      announcements.push({
        id: `square-${rank}`,
        type: 'square',
        value: rank === 'J' ? 200 : rank === '9' ? 150 : 100,
        family: 'square',
        strength: ANNOUNCE_RANK_POWER[rank],
        label: `Quadrato di ${rank}`,
      });
    }
  }
  return announcements;
}

function beloteAnnouncement(hand, trump) {
  if (!trump) return [];
  const hasKing = hand.some((card) => card.suit === trump && card.rank === 'K');
  const hasQueen = hand.some((card) => card.suit === trump && card.rank === 'Q');
  return hasKing && hasQueen
    ? [{ id: `belote-${trump}`, type: 'belote', value: 20, family: 'belote', strength: 0, label: `Belote/Rebelote a ${SUIT_BY_ID[trump].name}` }]
    : [];
}

function announcementsFor(hand, trump) {
  return [...rankRunAnnouncements(hand), ...squareAnnouncements(hand), ...beloteAnnouncement(hand, trump)].sort((a, b) => b.value - a.value || b.strength - a.strength);
}

function sumAnnouncements(items) {
  return items.reduce((sum, item) => sum + item.value, 0);
}

function winningAnnouncements(declarations) {
  const winners = [[], []];
  const groups = new Map();
  for (const item of [...declarations[0], ...declarations[1]]) {
    if (item.type === 'belote') {
      winners[item.team].push(item);
      continue;
    }
    const key = `${item.family}-${item.value}`;
    const current = groups.get(key);
    if (!current || item.strength > current.strength) {
      groups.set(key, item);
    } else if (current.strength === item.strength && current.team !== item.team) {
      groups.set(key, { ...current, tied: true });
    }
  }
  for (const item of groups.values()) {
    if (!item.tied) winners[item.team].push(item);
  }
  return winners;
}

function chooseBotCard(legal, trick, trump) {
  if (!trick.length) return [...legal].sort((a, b) => cardPoints(b, trump) - cardPoints(a, trump))[0];
  return [...legal].sort((a, b) => cardPower(a, trump, trick[0].card.suit) - cardPower(b, trump, trick[0].card.suit))[0];
}

function declaredAnnouncementsFromSelection(playerId, ids) {
  const team = PLAYERS[playerId].team;
  const possible = announcementsFor(game.handsAtStart[playerId], game.currentBid?.suit);
  return possible.filter((item) => ids.includes(item.id)).map((item) => ({ ...item, player: playerId, team }));
}

function applyBid(playerId, action) {
  if (action.pass) {
    game.passCount += 1;
    game.bidHistory.push({ player: playerId, text: 'passo' });
  } else {
    game.currentBid = { player: playerId, team: PLAYERS[playerId].team, suit: action.suit, amount: action.amount };
    game.passCount = 0;
    game.bidHistory.push({ player: playerId, text: `${action.amount} a ${SUIT_BY_ID[action.suit].name}` });
  }
  if (game.currentBid && game.passCount >= 3) {
    startFinalSpeech();
    return;
  }
  if (!game.currentBid && game.passCount >= 4) {
    game = newRound(game.scores, game.nextStarter, 'Tutti hanno passato. Carte ridistribuite.');
    render();
    return;
  }
  game.bidder = nextPlayer(playerId);
  game.message = turnText(game.bidder);
  render();
  scheduleBots();
}

function pushBid(playerId, action) {
  if (online.enabled) {
    sendOnlineAction(action.pass ? { type: 'pass' } : { type: 'bid', suit: action.suit, amount: action.amount });
    return;
  }
  applyBid(playerId, action);
}

function startFinalSpeech() {
  game.phase = 'speech';
  game.speechPlayer = game.currentBid.player;
  game.finalSpeech = [];
  game.message = `${PLAYERS[game.currentBid.player].name} ha aperto a ${game.currentBid.amount} ${SUIT_BY_ID[game.currentBid.suit].name}. Giro parlato: aspetto solo con almeno un asso non di atout.`;
  render();
  scheduleBots();
}

function applySpeech(playerId, text) {
  game.finalSpeech.push({ player: playerId, text });
  if (game.finalSpeech.length >= 4) {
    startPlaying();
    return;
  }
  game.speechPlayer = nextPlayer(playerId);
  game.message = turnText(game.speechPlayer);
  render();
  scheduleBots();
}

function startPlaying() {
  game.phase = 'playing';
  game.activePlayer = game.currentBid.player;
  game.trickLeader = game.currentBid.player;
  game.message = `${PLAYERS[game.currentBid.player].name} ha aperto. Prima mano: dichiara gli accusi con il tasto, altrimenti non valgono.`;
  render();
  scheduleBots();
}

function runBiddingBots() {
  while (game.phase === 'bidding' && !canControlPlayer(game.bidder)) {
    const playerId = game.bidder;
    let bid = bestBidFor(game.hands[playerId], game.currentBid);
    const isPartnerAnswer = playerId === PARTNER_ID && game.currentBid?.player === 0 && game.currentBid.team === PLAYERS[playerId].team;
    if (isPartnerAnswer) {
      const signal = partnerSignal(game.hands[playerId], game.currentBid);
      game.bidHistory.push({ player: playerId, text: signal });
      bid = signal.includes('alzo') ? { suit: game.currentBid.suit, amount: game.currentBid.amount + (signal.includes('dieci') ? 10 : 1) } : null;
    }
    applyBid(playerId, bid ? { suit: bid.suit, amount: bid.amount } : { pass: true });
    if (game.phase !== 'bidding') return;
  }
}

function runSpeechBots() {
  while (game.phase === 'speech' && !canControlPlayer(game.speechPlayer)) {
    const playerId = game.speechPlayer;
    applySpeech(playerId, finalSpeech(game.hands[playerId], game.currentBid.suit));
    if (game.phase !== 'speech') return;
  }
}

function applyPlay(playerId, card) {
  game.hands[playerId] = game.hands[playerId].filter((item) => item.id !== card.id);
  game.trick.push({ player: playerId, card });
  if (game.trick.length === 4) {
    const winner = chooseWinner(game.trick, game.currentBid.suit);
    const finished = game.hands.every((hand) => hand.length === 0);
    const points = game.trick.reduce((sum, play) => sum + cardPoints(play.card, game.currentBid.suit), 0) + (finished ? 10 : 0);
    const team = PLAYERS[winner.player].team;
    game.taken[team].push(...game.trick.map((play) => play.card));
    game.handPoints[team] += points;
    game.lastTrickWinner = winner.player;
    game.activePlayer = winner.player;
    game.trickLeader = winner.player;
    game.pendingClear = true;
    game.message = `${PLAYERS[winner.player].name} prende la mano.`;
  } else {
    game.activePlayer = nextPlayer(playerId);
    game.message = turnText(game.activePlayer);
  }
  render();
  scheduleBots();
}

function playCard(playerId, card) {
  if (online.enabled) {
    sendOnlineAction({ type: 'play', cardId: card.id });
    return;
  }
  applyPlay(playerId, card);
}

function runPlayBot() {
  if (game.phase !== 'playing' || game.pendingClear || canControlPlayer(game.activePlayer)) return;
  const playerId = game.activePlayer;
  const legal = legalCards(game.hands[playerId], game.trick, game.currentBid.suit);
  applyPlay(playerId, chooseBotCard(legal, game.trick, game.currentBid.suit));
}

function declareSelectedAnnouncements() {
  if (online.enabled) {
    sendOnlineAction({ type: 'declare', ids: [...selectedAnnouncements] });
    return;
  }
  applyDeclare(currentPlayerId(), [...selectedAnnouncements]);
}

function skipAnnouncements() {
  if (online.enabled) {
    sendOnlineAction({ type: 'declare', ids: [] });
    return;
  }
  applyDeclare(currentPlayerId(), []);
}

function applyDeclare(playerId, ids) {
  if (game.declaredPlayers[playerId] || game.handNumber !== 1) return;
  const team = PLAYERS[playerId].team;
  game.declaredAnnouncements[team].push(...declaredAnnouncementsFromSelection(playerId, ids));
  game.declaredPlayers[playerId] = true;
  game.message = ids.length ? `${PLAYERS[playerId].name} ha dichiarato gli accusi.` : `${PLAYERS[playerId].name} non ha dichiarato accusi.`;
  selectedAnnouncements = new Set();
  render();
}

function clearTrickOrFinish() {
  if (online.enabled) {
    sendOnlineAction({ type: 'clearTrick' });
    return;
  }
  applyClearTrick();
}

function applyClearTrick() {
  if (!game.pendingClear) return;
  const finished = game.hands.every((hand) => hand.length === 0);
  game.trick = [];
  game.pendingClear = false;
  if (finished) {
    scoreRound();
  } else {
    game.handNumber += 1;
    game.message = turnText(game.activePlayer);
    render();
    scheduleBots();
  }
}

function scoreRound() {
  const declaringTeam = game.currentBid.team;
  const otherTeam = declaringTeam === 0 ? 1 : 0;
  const validDeclarations = winningAnnouncements(game.declaredAnnouncements);
  const announcePoints = validDeclarations.map(sumAnnouncements);
  const raw = [game.handPoints[0] + announcePoints[0], game.handPoints[1] + announcePoints[1]];
  const capotTeam = game.taken[0].length === 32 ? 0 : game.taken[1].length === 32 ? 1 : null;
  let awarded = [...raw];
  let text = `${TEAM_NAMES[declaringTeam]} ha dichiarato ${game.currentBid.amount} e ha fatto ${raw[declaringTeam]}.`;
  if (capotTeam !== null) {
    awarded = capotTeam === 0 ? [252, 0] : [0, 252];
    text = `${TEAM_NAMES[capotTeam]} fa cappotto: 252 punti.`;
  } else if (raw[declaringTeam] < game.currentBid.amount) {
    awarded = declaringTeam === 0 ? [0, 162] : [162, 0];
    text = `${TEAM_NAMES[declaringTeam]} va a bagno: 162 punti a ${TEAM_NAMES[otherTeam]}.`;
  }
  game.scores = [game.scores[0] + awarded[0], game.scores[1] + awarded[1]];
  game.phase = 'round-end';
  game.result = { raw, awarded, announcePoints, declarations: game.declaredAnnouncements, validDeclarations, text };
  game.message = text;
  render();
}

function scheduleBots() {
  if (online.enabled) return;
  window.clearTimeout(scheduleBots.timer);
  if (game.phase === 'bidding' && !canControlPlayer(game.bidder)) {
    scheduleBots.timer = window.setTimeout(runBiddingBots, 520);
  } else if (game.phase === 'speech' && !canControlPlayer(game.speechPlayer)) {
    scheduleBots.timer = window.setTimeout(runSpeechBots, 520);
  } else if (game.phase === 'playing' && !game.pendingClear && !canControlPlayer(game.activePlayer)) {
    scheduleBots.timer = window.setTimeout(runPlayBot, 650);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function cardHtml(card, trump) {
  if (card.hidden) return cardBackHtml();
  const suit = SUIT_BY_ID[card.suit];
  const face = card.rank === 'J' ? 'Fante' : card.rank === 'Q' ? 'Donna' : card.rank === 'K' ? 'Re' : null;
  const body = face ? faceCardHtml(card.rank, suit, face) : pipCardHtml(card.rank, suit);
  return `
    <div class="playing-card ${suit.color} ${trump === card.suit ? 'trump' : ''}">
      <div class="corner top"><strong>${card.rank}</strong><span>${suit.symbol}</span></div>
      <div class="card-body">${body}</div>
      <div class="corner bottom"><strong>${card.rank}</strong><span>${suit.symbol}</span></div>
    </div>`;
}

function pipCardHtml(rank, suit) {
  const count = Number(rank) || 1;
  return `<div class="pips pips-${Math.min(count, 10)}">${Array.from({ length: Math.min(count, 10) }, () => `<span>${suit.symbol}</span>`).join('')}</div>`;
}

function faceCardHtml(rank, suit, face) {
  const crown = rank === 'K' ? '♛' : rank === 'Q' ? '♕' : '♞';
  return `<div class="face-card"><div class="portrait"><span class="face-rank">${crown}</span><span class="face-symbol">${suit.symbol}</span></div><strong>${face}</strong></div>`;
}

function cardBackHtml() {
  return '<div class="playing-card back"><div class="back-pattern"></div></div>';
}

function playerName(playerId) {
  return online.seats?.[playerId]?.name || PLAYERS[playerId].name;
}

function playerZoneHtml(player, hand, options = {}) {
  const sorted = sortHand(hand, game.currentBid?.suit);
  const cards = sorted
    .map((card) => {
      const playable = options.human && options.playableIds?.has(card.id);
      const content = options.human || !options.compact ? cardHtml(card, game.currentBid?.suit) : cardBackHtml();
      return `<button class="card-button ${options.human ? 'human-card' : 'bot-card'} ${playable ? 'playable' : 'locked'}" data-card="${card.id}" title="${card.hidden ? 'Carta coperta' : `${card.rank} di ${SUIT_BY_ID[card.suit].name}`}">${content}</button>`;
    })
    .join('');
  return `
    <div class="player-zone ${player.seat} ${options.vertical ? 'vertical' : ''}">
      <div class="player-label"><span>${canControlPlayer(player.id) ? '✦' : '●'}</span><span>${playerName(player.id)}</span><small>${TEAM_NAMES[player.team]}</small></div>
      <div class="hand ${options.compact ? 'compact' : ''} ${options.vertical ? 'vertical-hand' : ''}">${cards}</div>
    </div>`;
}

function trickHtml() {
  const cards = game.trick
    .map(
      (play) => `
      <div class="played-card seat-${PLAYERS[play.player].seat}">
        <span>${playerName(play.player)}</span>
        ${cardHtml(play.card, game.currentBid?.suit)}
      </div>`,
    )
    .join('');
  return `
    <div class="trick-area ${game.pendingClear ? 'paused' : ''}">
      <div class="trick-center">${game.trick.length ? cards : '<div class="empty-trick">♛</div>'}</div>
      <div class="turn-indicator">${turnText(game.activePlayer)}</div>
    </div>`;
}

function onlinePanelHtml() {
  const seatLines = PLAYERS.map((player) => `<span>${player.name}: ${online.seats?.[player.id]?.name || 'libero'}</span>`).join('');
  const seatButtons = PLAYERS.map(
    (player) =>
      `<button class="seat-button ${online.preferredSeat === player.id ? 'active' : ''}" data-seat="${player.id}"><span>${player.name}</span><small>${TEAM_NAMES[player.team]}</small></button>`,
  ).join('');
  return `
    <div class="panel control-panel">
      <div class="panel-title"><span>⌁</span><span>Stanza online</span></div>
      <div class="seat-grid">${seatButtons}</div>
      ${
        online.enabled
          ? `<div class="room-code"><span>Codice</span><strong>${online.room}</strong></div>
             <div class="history">${seatLines}</div>`
          : `<div class="button-row"><button class="primary" id="createRoom"><span>＋</span>Crea stanza</button><button class="secondary" id="joinRoom"><span>→</span>Entra</button></div>
             <input id="roomCodeInput" class="share-input" placeholder="Codice stanza" value="${online.room || ''}" />`
      }
      ${online.error ? `<p class="muted">${escapeHtml(online.error)}</p>` : ''}
    </div>`;
}

function statusHtml() {
  const me = currentPlayerId();
  const humanAnnouncements = announcementsFor(game.hands[me] || [], game.currentBid?.suit);
  const partner = game.currentBid?.player === me ? partnerSignal(game.hands[PARTNER_ID], game.currentBid) : null;
  const declared = [...game.declaredAnnouncements[0], ...game.declaredAnnouncements[1]];
  return `
    <div class="panel">
      <div class="panel-title"><span>ⓘ</span><span>Stato</span></div>
      <p class="message">${escapeHtml(game.message)}</p>
      ${
        game.currentBid
          ? `<div class="bid-pill"><span>◎</span><span>${game.currentBid.amount} a ${SUIT_BY_ID[game.currentBid.suit].name}, aperta da ${playerName(game.currentBid.player)}</span></div>`
          : ''
      }
      ${partner ? `<div class="partner-signal"><span>◆</span><span>Risposta compagno: ${partner}</span></div>` : ''}
      <div class="mini-section">
        <h2>Accusi in mano</h2>
        ${
          humanAnnouncements.length
            ? `<ul class="plain-list">${humanAnnouncements.map((item) => `<li><span>${item.label}</span><strong>${item.value}</strong></li>`).join('')}</ul>`
            : '<p class="muted">Nessun accuso in mano.</p>'
        }
      </div>
      ${
        declared.length
          ? `<div class="mini-section"><h2>Accusi dichiarati</h2><div class="history">${declared
              .map((item) => `<span>${playerName(item.player)}: ${item.label} (${item.value})</span>`)
              .join('')}</div></div>`
          : ''
      }
      <div class="mini-section">
        <h2>Parlate</h2>
        <div class="history">${game.bidHistory
          .slice(-8)
          .map((item) => `<span>${playerName(item.player)}: ${item.text}</span>`)
          .join('')}</div>
      </div>
      ${
        game.finalSpeech.length
          ? `<div class="mini-section"><h2>Giro assi</h2><div class="history">${game.finalSpeech
              .map((item) => `<span>${playerName(item.player)}: ${item.text}</span>`)
              .join('')}</div></div>`
          : ''
      }
    </div>`;
}

function biddingPanelHtml() {
  const me = currentPlayerId();
  if (game.phase !== 'bidding' || game.bidder !== me) return '';
  const minimum = minimumBid(game.currentBid, selectedSuit);
  selectedAmount = Math.max(selectedAmount, minimum);
  return `
    <div class="panel control-panel">
      <div class="panel-title"><span>♔</span><span>La tua puntata</span></div>
      <div class="suit-grid">
        ${SUITS.map(
          (suit) => `<button class="suit-button ${selectedSuit === suit.id ? 'active' : ''}" data-suit="${suit.id}"><span>${suit.symbol}</span><span>${suit.name}</span></button>`,
        ).join('')}
      </div>
      <label class="range-row">
        <span>Base ${minimum}${game.currentBid && game.currentBid.suit !== selectedSuit ? ' (+10 cambio seme)' : ''}</span>
        <input id="bidAmount" min="${minimum}" max="162" step="1" type="number" value="${selectedAmount}" />
      </label>
      <div class="button-row">
        <button class="primary" id="makeBid"><span>↑</span>Apri/Rialza</button>
        <button class="secondary" id="passBid"><span>×</span>Passo</button>
      </div>
    </div>`;
}

function speechPanelHtml() {
  const me = currentPlayerId();
  if (game.phase !== 'speech' || game.speechPlayer !== me) return '';
  const speech = finalSpeech(game.hands[me], game.currentBid.suit);
  return `
    <div class="panel control-panel">
      <div class="panel-title"><span>A</span><span>Giro assi</span></div>
      <button class="primary full" id="saySpeech"><span>✓</span>Dico ${speech}</button>
    </div>`;
}

function declarePanelHtml() {
  const me = currentPlayerId();
  const options = announcementsFor(game.hands[me] || [], game.currentBid?.suit);
  if (game.phase !== 'playing' || game.handNumber !== 1 || game.declaredPlayers?.[me] || game.pendingClear || !canControlPlayer(me)) return '';
  return `
    <div class="panel control-panel">
      <div class="panel-title"><span>✦</span><span>Dichiara accusi</span></div>
      ${
        options.length
          ? `<div class="announce-options">${options
              .map(
                (item) =>
                  `<label class="check-row"><input type="checkbox" data-announce="${item.id}" ${selectedAnnouncements.has(item.id) ? 'checked' : ''} /><span>${item.label}</span><strong>${item.value}</strong></label>`,
              )
              .join('')}</div>`
          : '<p class="muted">Non hai accusi da dichiarare.</p>'
      }
      <div class="button-row">
        <button class="primary" id="declareAccusi"><span>✓</span>Dichiaro</button>
        <button class="secondary" id="skipAccusi"><span>×</span>Non dichiaro</button>
      </div>
    </div>`;
}

function playPanelHtml() {
  if (game.phase !== 'playing' && game.phase !== 'round-end') return '';
  return `
    <div class="panel control-panel">
      <div class="panel-title"><span>♠</span><span>Gioco</span></div>
      ${game.pendingClear ? '<button class="primary full" id="clearTrick"><span>✓</span>Ho visto la mano</button>' : ''}
      ${
        game.phase === 'round-end'
          ? `<p class="message">${game.result.text}</p>
             <div class="round-score"><span>Carte: ${game.result.raw[0]} / ${game.result.raw[1]}</span><span>Accusi validi: ${game.result.announcePoints[0]} / ${game.result.announcePoints[1]}</span><span>Assegnati: ${game.result.awarded[0]} / ${game.result.awarded[1]}</span></div>
             <button class="primary full" id="nextRound"><span>▶</span>Nuova mano</button>`
          : ''
      }
    </div>`;
}

function render() {
  const me = currentPlayerId();
  const legal = game.phase === 'playing' && game.activePlayer === me && !game.pendingClear ? legalCards(game.hands[me], game.trick, game.currentBid.suit) : [];
  const playableIds = new Set(legal.map((card) => card.id));
  document.querySelector('#root').innerHTML = `
    <main class="app-shell">
      <header class="topbar">
        <div><p class="eyebrow">Belote alla valdostana</p><h1>${online.enabled ? 'Stanza ' + online.room : 'Tavolo locale'}</h1></div>
        <div class="scoreboard">
          <div class="score"><span>Noi</span><strong>${game.scores[0]}</strong></div>
          <div class="score"><span>Loro</span><strong>${game.scores[1]}</strong></div>
        </div>
        <button class="icon-button" id="newGame" title="Nuova partita">↻</button>
      </header>
      <section class="game-layout">
        <aside class="side-panel">${onlinePanelHtml()}${statusHtml()}${biddingPanelHtml()}${speechPanelHtml()}${declarePanelHtml()}${playPanelHtml()}</aside>
        <section class="table" aria-label="Tavolo da gioco">
          ${playerZoneHtml(PLAYERS[2], game.hands[2], { compact: me !== 2, human: me === 2, playableIds })}
          <div class="middle-row">
            ${playerZoneHtml(PLAYERS[1], game.hands[1], { compact: me !== 1, vertical: true, human: me === 1, playableIds })}
            ${trickHtml()}
            ${playerZoneHtml(PLAYERS[3], game.hands[3], { compact: me !== 3, vertical: true, human: me === 3, playableIds })}
          </div>
          ${playerZoneHtml(PLAYERS[0], game.hands[0], { compact: me !== 0, human: me === 0, playableIds })}
        </section>
      </section>
    </main>`;
  bindEvents();
}

function resetLocalGame() {
  game = newRound([0, 0], 0);
  selectedSuit = 'hearts';
  selectedAmount = 82;
  selectedAnnouncements = new Set();
  render();
}

function bindEvents() {
  document.querySelector('#newGame')?.addEventListener('click', () => {
    if (online.enabled) sendOnlineAction({ type: 'newGame' });
    else resetLocalGame();
  });
  document.querySelector('#createRoom')?.addEventListener('click', createRoom);
  document.querySelector('#joinRoom')?.addEventListener('click', () => joinRoom(document.querySelector('#roomCodeInput')?.value.trim().toUpperCase()));
  document.querySelectorAll('.seat-button').forEach((button) => {
    button.addEventListener('click', () => {
      online.preferredSeat = Number(button.dataset.seat);
      localStorage.setItem('belote-preferred-seat', String(online.preferredSeat));
      if (online.enabled) sendOnlineAction({ type: 'changeSeat', seat: online.preferredSeat });
      else render();
    });
  });
  document.querySelectorAll('.suit-button').forEach((button) => {
    button.addEventListener('click', () => {
      selectedSuit = button.dataset.suit;
      selectedAmount = Math.max(selectedAmount, minimumBid(game.currentBid, selectedSuit));
      render();
    });
  });
  document.querySelector('#bidAmount')?.addEventListener('input', (event) => {
    selectedAmount = Number(event.target.value);
  });
  document.querySelector('#makeBid')?.addEventListener('click', () => {
    const minimum = minimumBid(game.currentBid, selectedSuit);
    selectedAmount = Math.max(Number(document.querySelector('#bidAmount')?.value ?? minimum), minimum);
    pushBid(currentPlayerId(), { suit: selectedSuit, amount: selectedAmount });
  });
  document.querySelector('#passBid')?.addEventListener('click', () => pushBid(currentPlayerId(), { pass: true }));
  document.querySelector('#saySpeech')?.addEventListener('click', () => {
    const speech = finalSpeech(game.hands[currentPlayerId()], game.currentBid.suit);
    if (online.enabled) sendOnlineAction({ type: 'speech', text: speech });
    else applySpeech(currentPlayerId(), speech);
  });
  document.querySelectorAll('[data-announce]').forEach((input) => {
    input.addEventListener('change', () => {
      if (input.checked) selectedAnnouncements.add(input.dataset.announce);
      else selectedAnnouncements.delete(input.dataset.announce);
    });
  });
  document.querySelector('#declareAccusi')?.addEventListener('click', declareSelectedAnnouncements);
  document.querySelector('#skipAccusi')?.addEventListener('click', skipAnnouncements);
  document.querySelector('#clearTrick')?.addEventListener('click', clearTrickOrFinish);
  document.querySelector('#nextRound')?.addEventListener('click', () => {
    if (online.enabled) sendOnlineAction({ type: 'nextRound' });
    else {
      game = newRound(game.scores, game.nextStarter);
      selectedSuit = 'hearts';
      selectedAmount = 82;
      selectedAnnouncements = new Set();
      render();
    }
  });
  document.querySelectorAll('.human-card.playable').forEach((button) => {
    button.addEventListener('click', () => {
      const me = currentPlayerId();
      if (game.phase !== 'playing' || game.pendingClear || game.activePlayer !== me) return;
      const card = game.hands[me].find((item) => item.id === button.dataset.card);
      if (card) playCard(me, card);
    });
  });
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function applyOnlinePayload(payload) {
  online.enabled = true;
  online.room = payload.room;
  online.token = payload.token || online.token;
  online.playerId = payload.playerId ?? online.playerId;
  online.seats = payload.seats || online.seats || {};
  if (online.token) localStorage.setItem(`belote-token-${online.room}`, online.token);
  if (Number.isInteger(online.playerId)) localStorage.setItem(`belote-seat-${online.room}`, String(online.playerId));
  game = payload.game;
  selectedAnnouncements = new Set();
  render();
}

async function createRoom() {
  try {
    applyOnlinePayload(await api('/api/rooms', { method: 'POST', body: { name: 'Giocatore', seat: online.preferredSeat } }));
  } catch (error) {
    online.error = 'Avvia server.js per creare stanze online.';
    render();
  }
}

async function joinRoom(room) {
  if (!room) return;
  try {
    applyOnlinePayload(await api(`/api/rooms/${room}/join`, { method: 'POST', body: { token: online.token, name: 'Giocatore', seat: online.preferredSeat } }));
  } catch (error) {
    online.error = 'Stanza non trovata o piena.';
    render();
  }
}

async function sendOnlineAction(action) {
  try {
    applyOnlinePayload(await api(`/api/rooms/${online.room}/action`, { method: 'POST', body: { token: online.token, action } }));
  } catch (error) {
    online.error = 'Azione non valida o stanza non raggiungibile.';
    render();
  }
}

async function pollRoom() {
  if (!online.enabled || !online.room || !online.token) return;
  try {
    applyOnlinePayload(await api(`/api/rooms/${online.room}?token=${encodeURIComponent(online.token)}`));
  } catch {
    online.error = 'Connessione stanza persa.';
    render();
  }
}

window.setInterval(pollRoom, 1200);
render();
