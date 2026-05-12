const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const SUITS = [
  { id: 'hearts', name: 'Cuori', symbol: '♥' },
  { id: 'diamonds', name: 'Quadri', symbol: '♦' },
  { id: 'clubs', name: 'Fiori', symbol: '♣' },
  { id: 'spades', name: 'Picche', symbol: '♠' },
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
  { id: 0, name: 'Tu', team: 0 },
  { id: 1, name: 'Sinistra', team: 1 },
  { id: 2, name: 'Compagno', team: 0 },
  { id: 3, name: 'Destra', team: 1 },
];
const TEAM_NAMES = ['Noi', 'Loro'];
const rooms = new Map();

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

function minimumBid(currentBid, suit) {
  if (!currentBid) return 82;
  return currentBid.suit === suit ? currentBid.amount + 1 : currentBid.amount + 10;
}

function finalSpeech(hand, trump) {
  return hand.some((card) => card.rank === 'A' && card.suit !== trump) ? 'aspetto' : 'passo';
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
      if (present.has(rank)) run.push(rank);
      else {
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
  const hasKing = hand.some((card) => card.suit === trump && card.rank === 'K');
  const hasQueen = hand.some((card) => card.suit === trump && card.rank === 'Q');
  return hasKing && hasQueen
    ? [{ id: `belote-${trump}`, type: 'belote', value: 20, family: 'belote', strength: 0, label: `Belote/Rebelote a ${SUIT_BY_ID[trump].name}` }]
    : [];
}

function announcementsFor(hand, trump) {
  return [...rankRunAnnouncements(hand), ...squareAnnouncements(hand), ...beloteAnnouncement(hand, trump)];
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
    if (!current || item.strength > current.strength) groups.set(key, item);
    else if (current.strength === item.strength && current.team !== item.team) groups.set(key, { ...current, tied: true });
  }
  for (const item of groups.values()) {
    if (!item.tied) winners[item.team].push(item);
  }
  return winners;
}

function sumAnnouncements(items) {
  return items.reduce((sum, item) => sum + item.value, 0);
}

function maskGame(game, viewerId) {
  return {
    ...game,
    hands: game.hands.map((hand, playerId) => (playerId === viewerId ? hand : hand.map((card) => ({ id: card.id, hidden: true })))),
    handsAtStart: game.handsAtStart.map((hand, playerId) => (playerId === viewerId ? hand : hand.map((card) => ({ id: card.id, hidden: true })))),
  };
}

function roomPayload(room, token) {
  const playerId = room.players[token]?.seat ?? 0;
  return {
    room: room.code,
    token,
    playerId,
    seats: Object.fromEntries(Object.values(room.players).map((player) => [player.seat, { name: player.name }])),
    game: maskGame(room.game, playerId),
  };
}

function findFreeSeat(room, preferred) {
  const occupied = new Set(Object.values(room.players).map((player) => player.seat));
  if (!occupied.has(preferred)) return preferred;
  return PLAYERS.find((player) => !occupied.has(player.id))?.id;
}

function createRoom(name, preferredSeat) {
  const code = crypto.randomBytes(3).toString('hex').toUpperCase();
  const token = crypto.randomUUID();
  const room = { code, players: {}, game: newRound([0, 0], 0) };
  room.players[token] = { name: name || 'Giocatore', seat: findFreeSeat(room, preferredSeat ?? 0) ?? 0 };
  rooms.set(code, room);
  return roomPayload(room, token);
}

function joinRoom(code, token, name, preferredSeat) {
  const room = rooms.get(code);
  if (!room) throw new Error('room not found');
  if (token && room.players[token]) return roomPayload(room, token);
  const seat = findFreeSeat(room, preferredSeat ?? 0);
  if (seat === undefined) throw new Error('room full');
  const nextToken = crypto.randomUUID();
  room.players[nextToken] = { name: name || 'Giocatore', seat };
  return roomPayload(room, nextToken);
}

function applyAction(room, token, action) {
  const player = room.players[token];
  if (!player) throw new Error('invalid token');
  const game = room.game;
  const playerId = player.seat;
  if (action.type === 'changeSeat') {
    const occupied = new Set(Object.entries(room.players).filter(([other]) => other !== token).map(([, item]) => item.seat));
    if (!occupied.has(action.seat)) player.seat = action.seat;
    return;
  }
  if (action.type === 'newGame') {
    room.game = newRound([0, 0], 0);
    return;
  }
  if (action.type === 'nextRound' && game.phase === 'round-end') {
    room.game = newRound(game.scores, game.nextStarter);
    return;
  }
  if (action.type === 'bid' || action.type === 'pass') {
    if (game.phase !== 'bidding' || game.bidder !== playerId) throw new Error('not your bid');
    if (action.type === 'pass') {
      game.passCount += 1;
      game.bidHistory.push({ player: playerId, text: 'passo' });
    } else {
      const min = minimumBid(game.currentBid, action.suit);
      if (action.amount < min) throw new Error('bid too low');
      game.currentBid = { player: playerId, team: PLAYERS[playerId].team, suit: action.suit, amount: action.amount };
      game.passCount = 0;
      game.bidHistory.push({ player: playerId, text: `${action.amount} a ${SUIT_BY_ID[action.suit].name}` });
    }
    if (game.currentBid && game.passCount >= 3) {
      game.phase = 'speech';
      game.speechPlayer = game.currentBid.player;
      game.message = 'Giro assi: aspetto solo con almeno un asso non di atout.';
    } else if (!game.currentBid && game.passCount >= 4) {
      room.game = newRound(game.scores, game.nextStarter, 'Tutti hanno passato. Carte ridistribuite.');
    } else {
      game.bidder = nextPlayer(playerId);
      game.message = `Tocca a ${PLAYERS[game.bidder].name}.`;
    }
    return;
  }
  if (action.type === 'speech') {
    if (game.phase !== 'speech' || game.speechPlayer !== playerId) throw new Error('not your speech');
    game.finalSpeech.push({ player: playerId, text: finalSpeech(game.hands[playerId], game.currentBid.suit) });
    if (game.finalSpeech.length >= 4) {
      game.phase = 'playing';
      game.activePlayer = game.currentBid.player;
      game.trickLeader = game.currentBid.player;
      game.message = 'Prima mano: dichiara gli accusi con il tasto, altrimenti non valgono.';
    } else {
      game.speechPlayer = nextPlayer(playerId);
    }
    return;
  }
  if (action.type === 'declare') {
    if (game.declaredPlayers[playerId] || game.handNumber !== 1) return;
    const possible = announcementsFor(game.handsAtStart[playerId], game.currentBid?.suit);
    const selected = possible.filter((item) => action.ids.includes(item.id)).map((item) => ({ ...item, player: playerId, team: PLAYERS[playerId].team }));
    game.declaredAnnouncements[PLAYERS[playerId].team].push(...selected);
    game.declaredPlayers[playerId] = true;
    game.message = selected.length ? `${PLAYERS[playerId].name} ha dichiarato gli accusi.` : `${PLAYERS[playerId].name} non ha dichiarato accusi.`;
    return;
  }
  if (action.type === 'play') {
    if (game.phase !== 'playing' || game.pendingClear || game.activePlayer !== playerId) throw new Error('not your play');
    const card = game.hands[playerId].find((item) => item.id === action.cardId);
    if (!card) throw new Error('card not found');
    game.hands[playerId] = game.hands[playerId].filter((item) => item.id !== card.id);
    game.trick.push({ player: playerId, card });
    if (game.trick.length === 4) {
      const winner = chooseWinner(game.trick, game.currentBid.suit);
      const finished = game.hands.every((hand) => hand.length === 0);
      const points = game.trick.reduce((sum, play) => sum + cardPoints(play.card, game.currentBid.suit), 0) + (finished ? 10 : 0);
      const team = PLAYERS[winner.player].team;
      game.taken[team].push(...game.trick.map((play) => play.card));
      game.handPoints[team] += points;
      game.activePlayer = winner.player;
      game.pendingClear = true;
      game.message = `${PLAYERS[winner.player].name} prende la mano.`;
    } else {
      game.activePlayer = nextPlayer(playerId);
    }
    return;
  }
  if (action.type === 'clearTrick') {
    if (!game.pendingClear) throw new Error('no trick to clear');
    const finished = game.hands.every((hand) => hand.length === 0);
    game.trick = [];
    game.pendingClear = false;
    if (!finished) {
      game.handNumber += 1;
      return;
    }
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
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function sendJson(res, data) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function sendError(res, error) {
  res.writeHead(400, { 'Content-Type': 'text/plain' });
  res.end(error.message);
}

function serveStatic(req, res) {
  const urlPath = new URL(req.url, 'http://localhost').pathname;
  const filePath = path.join(__dirname, urlPath === '/' ? 'index.html' : urlPath);
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
    res.writeHead(200, { 'Content-Type': types[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/api/rooms') {
      const body = await readBody(req);
      sendJson(res, createRoom(body.name, Number(body.seat)));
      return;
    }
    const match = url.pathname.match(/^\/api\/rooms\/([A-F0-9]+)(?:\/(join|action))?$/);
    if (match) {
      const room = rooms.get(match[1]);
      if (req.method === 'POST' && match[2] === 'join') {
        const body = await readBody(req);
        sendJson(res, joinRoom(match[1], body.token, body.name, Number(body.seat)));
        return;
      }
      if (req.method === 'POST' && match[2] === 'action') {
        const body = await readBody(req);
        if (!room) throw new Error('room not found');
        applyAction(room, body.token, body.action);
        sendJson(res, roomPayload(room, body.token));
        return;
      }
      if (req.method === 'GET') {
        if (!room) throw new Error('room not found');
        sendJson(res, roomPayload(room, url.searchParams.get('token')));
        return;
      }
    }
    serveStatic(req, res);
  } catch (error) {
    sendError(res, error);
  }
});

function localUrls(port) {
  const urls = [`http://127.0.0.1:${port}`];
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal) {
        urls.push(`http://${address.address}:${port}`);
      }
    }
  }
  return urls;
}

const PORT = process.env.PORT || 4173;
server.listen(PORT, '0.0.0.0', () => {
  console.log('Belote online avviata.');
  console.log('Apri uno di questi indirizzi:');
  for (const url of localUrls(PORT)) console.log(`- ${url}`);
  console.log('Gli altri giocatori aprono lo stesso indirizzo di rete e inseriscono il codice stanza.');
});
