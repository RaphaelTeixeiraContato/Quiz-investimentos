/**
 * Quiz de Investimentos - servidor (HTTP + WebSocket), estilo Kahoot.
 *
 * Rotas:
 *   /        -> tela do aluno (celular)
 *   /host    -> tela do apresentador (telão)
 *   /admin   -> editor de perguntas
 *
 * Variáveis de ambiente:
 *   PORT            porta (padrão 3000)
 *   ADMIN_PASSWORD  senha do apresentador/editor (padrão "investir")
 *   PUBLIC_URL      URL pública (opcional) usada no QR Code
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 3000;
const HOST_PASSWORD = process.env.HOST_PASSWORD || 'becriar';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'beeditar';
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');

const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const QUIZZES_FILE = path.join(DATA_DIR, 'quizzes.json');
const DEFAULT_QUESTIONS_FILE = path.join(DATA_DIR, 'questions.default.json');

const READY_MS = 5000;       // contagem "prepare-se" antes de cada pergunta
const GRACE_MS = 700;        // tolerância de rede após o fim do tempo
const MAX_NAME = 16;

/* ------------------------------------------------------------------ */
/* Quizzes / Provas (persistência + validação)                        */
/* ------------------------------------------------------------------ */

function sanitizeQuestions(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 100) {
    throw new Error('Envie entre 1 e 100 perguntas.');
  }
  return input.map((q, i) => {
    const n = i + 1;
    const text = String(q && q.text || '').trim().slice(0, 300);
    if (!text) throw new Error(`Pergunta ${n}: texto vazio.`);
    const options = (Array.isArray(q.options) ? q.options : [])
      .map(o => String(o || '').trim().slice(0, 120))
      .filter(Boolean);
    if (options.length < 2 || options.length > 4) {
      throw new Error(`Pergunta ${n}: use de 2 a 4 alternativas preenchidas.`);
    }
    const correct = Number.parseInt(q.correct, 10);
    if (!(correct >= 0 && correct < options.length)) {
      throw new Error(`Pergunta ${n}: marque a alternativa correta.`);
    }
    let time = Number.parseInt(q.time, 10);
    if (!Number.isFinite(time)) time = 20;
    time = Math.min(120, Math.max(5, time));
    const explanation = String(q.explanation || '').trim().slice(0, 400);
    const waitingTip = String(q.waitingTip || q.tip || '').trim().slice(0, 400);
    return { text, options, correct, time, explanation, waitingTip };
  });
}

function loadQuizzes() {
  try {
    if (fs.existsSync(QUIZZES_FILE)) {
      const raw = JSON.parse(fs.readFileSync(QUIZZES_FILE, 'utf8'));
      if (Array.isArray(raw) && raw.length > 0) {
        return raw.map(qz => ({
          id: String(qz.id || 'quiz_1'),
          title: String(qz.title || 'Prova 1 - Turma A').trim(),
          questions: sanitizeQuestions(qz.questions || []),
          savedCheckpoint: Array.isArray(qz.savedCheckpoint) && qz.savedCheckpoint.length ? sanitizeQuestions(qz.savedCheckpoint) : sanitizeQuestions(qz.questions || [])
        }));
      }
    }
  } catch (e) {
    console.error('Erro ao carregar quizzes:', e.message);
  }
  let defaultQs = [];
  try {
    defaultQs = sanitizeQuestions(JSON.parse(fs.readFileSync(DEFAULT_QUESTIONS_FILE, 'utf8')));
  } catch (_) {
    defaultQs = [{ text: 'O que é investimento?', options: ['Aplicar dinheiro com expectativa de rendimento', 'Gastar tudo em consumo imediato'], correct: 0, time: 20, explanation: '' }];
  }
  const initial = [
    { id: 'quiz_1', title: 'Prova 1 - Turma A', questions: JSON.parse(JSON.stringify(defaultQs)), savedCheckpoint: JSON.parse(JSON.stringify(defaultQs)) },
    { id: 'quiz_2', title: 'Prova 2 - Turma B', questions: JSON.parse(JSON.stringify(defaultQs)), savedCheckpoint: JSON.parse(JSON.stringify(defaultQs)) }
  ];
  saveQuizzes(initial);
  return initial;
}

function saveQuizzes(list) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(QUIZZES_FILE, JSON.stringify(list, null, 2), 'utf8');
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp'
};

const ROUTES = { '/': 'index.html', '/player': 'player.html', '/host': 'host.html', '/admin': 'admin.html' };

function lanUrls() {
  const urls = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) urls.push(`http://${i.address}:${PORT}`);
    }
  }
  return urls;
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('Corpo muito grande')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (e) { reject(new Error('JSON inválido')); }
    });
    req.on('error', reject);
  });
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function isAuthed(req) {
  return safeEqual(req.headers['x-admin-password'] || '', ADMIN_PASSWORD);
}

async function handleApi(req, res, pathname) {
  try {
    if (pathname === '/api/info' && req.method === 'GET') {
      const quizzes = loadQuizzes().map(q => ({ id: q.id, title: q.title, count: q.questions.length }));
      return sendJson(res, 200, { lan: lanUrls(), publicUrl: PUBLIC_URL, port: PORT, quizzes });
    }
    if (pathname === '/api/auth' && req.method === 'POST') {
      const body = await readBody(req, 4096);
      return sendJson(res, safeEqual(body.password || '', ADMIN_PASSWORD) ? 200 : 401, {});
    }

    // Rotas de API protegidas
    if (!isAuthed(req)) return sendJson(res, 401, { error: 'Senha incorreta' });

    // Rota GET /api/quizzes e POST /api/quizzes (criar nova prova)
    if (pathname === '/api/quizzes' && req.method === 'GET') {
      const quizzes = loadQuizzes();
      return sendJson(res, 200, quizzes.map(q => ({ id: q.id, title: q.title, count: q.questions.length })));
    }

    if (pathname === '/api/quizzes' && req.method === 'POST') {
      const body = await readBody(req);
      const title = String(body.title || '').trim() || `Nova Prova ${Date.now().toString().slice(-4)}`;
      const quizzes = loadQuizzes();
      let defaultQs = [];
      try {
        defaultQs = sanitizeQuestions(JSON.parse(fs.readFileSync(DEFAULT_QUESTIONS_FILE, 'utf8')));
      } catch (_) {
        defaultQs = [{ text: 'Pergunta inicial da nova prova', options: ['Opção 1', 'Opção 2'], correct: 0, time: 20, explanation: '' }];
      }
      const newQuiz = {
        id: `quiz_${Date.now()}`,
        title,
        questions: JSON.parse(JSON.stringify(defaultQs)),
        savedCheckpoint: JSON.parse(JSON.stringify(defaultQs))
      };
      quizzes.push(newQuiz);
      saveQuizzes(quizzes);
      return sendJson(res, 200, { id: newQuiz.id, title: newQuiz.title, count: newQuiz.questions.length });
    }

    // Rota /api/quizzes/:id
    const match = pathname.match(/^\/api\/quizzes\/([a-zA-Z0-9_-]+)(\/(reset))?$/);
    if (match) {
      const quizId = match[1];
      const subAction = match[3];
      const quizzes = loadQuizzes();
      const idx = quizzes.findIndex(q => q.id === quizId);
      if (idx === -1) return sendJson(res, 404, { error: 'Prova não encontrada' });

      if (req.method === 'GET') {
        return sendJson(res, 200, quizzes[idx]);
      }
      if (req.method === 'PUT') {
        const body = await readBody(req);
        if (body.title) quizzes[idx].title = String(body.title).trim();
        if (body.questions) {
          const sanitized = sanitizeQuestions(body.questions);
          quizzes[idx].questions = sanitized;
          quizzes[idx].savedCheckpoint = JSON.parse(JSON.stringify(sanitized)); // salva como novo padrão
        }
        saveQuizzes(quizzes);
        return sendJson(res, 200, quizzes[idx]);
      }
      if (req.method === 'DELETE') {
        if (quizzes.length <= 1) return sendJson(res, 400, { error: 'Você precisa ter pelo menos uma prova cadastrada.' });
        quizzes.splice(idx, 1);
        saveQuizzes(quizzes);
        return sendJson(res, 200, { ok: true });
      }
      if (subAction === 'reset' && req.method === 'POST') {
        const qz = quizzes[idx];
        qz.questions = JSON.parse(JSON.stringify(qz.savedCheckpoint || qz.questions));
        saveQuizzes(quizzes);
        return sendJson(res, 200, qz);
      }
    }

    // Fallback legado para /api/questions
    if (pathname === '/api/questions' && req.method === 'GET') {
      const quizzes = loadQuizzes();
      return sendJson(res, 200, quizzes[0].questions);
    }
    if (pathname === '/api/questions' && req.method === 'PUT') {
      const body = await readBody(req);
      const quizzes = loadQuizzes();
      const sanitized = sanitizeQuestions(body);
      quizzes[0].questions = sanitized;
      quizzes[0].savedCheckpoint = JSON.parse(JSON.stringify(sanitized));
      saveQuizzes(quizzes);
      return sendJson(res, 200, sanitized);
    }
    if (pathname === '/api/questions/reset' && req.method === 'POST') {
      const quizzes = loadQuizzes();
      quizzes[0].questions = JSON.parse(JSON.stringify(quizzes[0].savedCheckpoint || quizzes[0].questions));
      saveQuizzes(quizzes);
      return sendJson(res, 200, quizzes[0].questions);
    }

    return sendJson(res, 404, { error: 'Não encontrado' });
  } catch (e) {
    return sendJson(res, 400, { error: e.message });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  if (pathname.startsWith('/api/')) return handleApi(req, res, pathname);

  const rel = ROUTES[pathname] || pathname.slice(1);
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Proibido'); }

  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Não encontrado'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
});

/* ------------------------------------------------------------------ */
/* Jogo                                                                */
/* ------------------------------------------------------------------ */

const games = new Map(); // pin -> game

function newPin() {
  let pin;
  do { pin = String(crypto.randomInt(100000, 1000000)); } while (games.has(pin));
  return pin;
}

function token() { return crypto.randomBytes(12).toString('hex'); }

function createGame(quizId) {
  const quizzes = loadQuizzes();
  const quiz = quizzes.find(q => q.id === quizId) || quizzes[0];
  const game = {
    pin: newPin(),
    hostToken: token(),
    quizId: quiz.id,
    quizTitle: quiz.title,
    questions: JSON.parse(JSON.stringify(quiz.questions)),
    phase: 'lobby',          // lobby | ready | question | reveal | podium
    qIndex: -1,
    players: new Map(),      // id -> player
    hostWs: null,
    qStart: 0,
    qEnd: 0,
    timer: null,
    reveal: null,
    lastActivity: Date.now()
  };
  games.set(game.pin, game);
  return game;
}

function resetScores(game) {
  for (const p of game.players.values()) {
    p.score = 0; p.streak = 0; p.answer = null; p.last = null; p.prevRank = null;
  }
}

function ranking(game) {
  return [...game.players.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function rankOf(game, player) {
  return ranking(game).findIndex(p => p === player) + 1;
}

function currentQuestion(game) { return game.questions[game.qIndex]; }

function remainingMs(game) {
  return game.phase === 'question' ? Math.max(0, game.qEnd - Date.now()) : 0;
}

function answeredCount(game) {
  let n = 0;
  for (const p of game.players.values()) if (p.answer) n++;
  return n;
}

function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function publicQuestion(q) {
  return {
    text: q.text,
    options: q.options,
    time: q.time,
    waitingTip: q.waitingTip || ''
  };
}

function hostState(game) {
  const q = game.qIndex >= 0 ? currentQuestion(game) : null;
  const connected = [...game.players.values()].filter(p => p.connected).length;
  const quizzes = loadQuizzes().map(q => ({ id: q.id, title: q.title, count: q.questions.length }));
  const state = {
    t: 'state', role: 'host', pin: game.pin, phase: game.phase,
    quizId: game.quizId, quizTitle: game.quizTitle, quizzes,
    total: game.questions.length, qIndex: game.qIndex,
    players: [...game.players.values()].map(p => ({ id: p.id, name: p.name, connected: p.connected })),
    connected,
    answered: answeredCount(game),
    remaining: remainingMs(game)
  };
  if (q && (game.phase === 'ready' || game.phase === 'question' || game.phase === 'reveal')) {
    state.question = publicQuestion(q);
  }
  if (game.phase === 'reveal' && game.reveal) state.reveal = game.reveal;
  if (game.phase === 'podium') {
    state.podium = ranking(game).map(p => ({ name: p.name, score: p.score }));
  }
  return state;
}

function playerState(game, p) {
  const connectedPlayers = [...game.players.values()].filter(pl => pl.connected);
  const state = {
    t: 'state', role: 'player', pin: game.pin, phase: game.phase,
    quizTitle: game.quizTitle,
    name: p.name, total: game.questions.length, qIndex: game.qIndex,
    score: p.score, streak: p.streak,
    totalPlayers: connectedPlayers.length || game.players.size,
    answeredCount: answeredCount(game)
  };
  if (game.phase === 'lobby') {
    state.players = Array.from(game.players.values()).map(pl => ({
      id: pl.id,
      name: pl.name,
      connected: pl.connected,
      isSelf: pl.id === p.id
    }));
  }
  const q = game.qIndex >= 0 ? currentQuestion(game) : null;
  if (game.phase === 'question') {
    state.question = publicQuestion(q);
    state.remaining = remainingMs(game);
    state.answered = p.answer ? p.answer.choice : null;
    state.answerMs = p.answer ? p.answer.ms : null;
  }
  if (game.phase === 'reveal' && p.last) {
    state.result = {
      correct: p.last.correct, points: p.last.points, answered: p.last.answered,
      choice: p.last.choice, correctIndex: q.correct, explanation: q.explanation,
      rank: rankOf(game, p), players: game.players.size,
      streak: p.streak,
      behind: p.last.behind
    };
    if (q) state.question = publicQuestion(q);
    state.answered = p.last.choice;
  }
  if (game.phase === 'podium') {
    state.result = { rank: rankOf(game, p), players: game.players.size };
  }
  return state;
}

function pushHost(game) { send(game.hostWs, hostState(game)); }
function pushPlayer(game, p) { send(p.ws, playerState(game, p)); }
function pushPlayers(game) { for (const p of game.players.values()) pushPlayer(game, p); }
function pushAll(game) { pushHost(game); pushPlayers(game); }

function clearTimer(game) {
  if (game.timer) { clearTimeout(game.timer); game.timer = null; }
  if (game.botTimers) {
    game.botTimers.forEach(t => clearTimeout(t));
    game.botTimers = [];
  }
}

function beginReady(game) {
  clearTimer(game);
  game.qIndex++;
  game.phase = 'ready';
  game.reveal = null;
  for (const p of game.players.values()) p.answer = null;
  pushAll(game);
  game.timer = setTimeout(() => beginQuestion(game), READY_MS);
}

function beginQuestion(game) {
  clearTimer(game);
  const q = currentQuestion(game);
  game.phase = 'question';
  game.qStart = Date.now();
  game.qEnd = game.qStart + q.time * 1000;
  pushAll(game);
  scheduleBotAnswers(game);
  game.timer = setTimeout(() => endQuestion(game), q.time * 1000 + GRACE_MS);
}

function endQuestion(game) {
  if (game.phase !== 'question') return;
  clearTimer(game);
  const q = currentQuestion(game);
  const limit = q.time * 1000;
  const counts = q.options.map(() => 0);
  const before = ranking(game);
  const prevScore = new Map(before.map(p => [p, p.score]));

  for (const p of game.players.values()) {
    const a = p.answer;
    if (a) counts[a.choice]++;
    if (a && a.choice === q.correct) {
      const ratio = Math.min(1, a.ms / limit);
      p.streak += 1;
      const streakBonus = Math.min(p.streak - 1, 5) * 100;
      const points = Math.round(1000 * (1 - ratio / 2)) + streakBonus;
      p.score += points;
      p.last = { correct: true, answered: true, choice: a.choice, points };
    } else {
      p.streak = 0;
      p.last = { correct: false, answered: !!a, choice: a ? a.choice : null, points: 0 };
    }
  }

  const after = ranking(game);
  after.forEach((p, i) => {
    const prev = before.indexOf(p) + 1;
    p.last.behind = i === 0 ? null : after[i - 1].score - p.score;
    p.last.moved = prev - (i + 1);
  });

  const roundBoard = [...game.players.values()]
    .sort((a, b) => {
      const ptsA = a.last ? a.last.points : 0;
      const ptsB = b.last ? b.last.points : 0;
      if (ptsB !== ptsA) return ptsB - ptsA;
      return (b.score || 0) - (a.score || 0);
    })
    .map(p => ({
      name: p.name,
      score: p.last ? p.last.points : 0,
      totalScore: p.score,
      gained: p.last ? p.last.points : 0,
      streak: p.streak
    }));

  game.reveal = {
    correct: q.correct,
    counts,
    explanation: q.explanation,
    isLast: game.qIndex >= game.questions.length - 1,
    board: roundBoard
  };
  game.phase = 'reveal';
  pushAll(game);
}

function showPodium(game) {
  clearTimer(game);
  game.phase = 'podium';
  pushAll(game);
}

function maybeEndEarly(game) {
  if (game.phase !== 'question') return;
  const active = [...game.players.values()].filter(p => p.connected);
  if (active.length && active.every(p => p.answer)) endQuestion(game);
}

/* ------------------------------------------------------------------ */
/* BOTS DE TESTE (Simulação de Alunos)                                */
/* ------------------------------------------------------------------ */

const BOT_NAMES = [
  'Sofia 🤖', 'Lucas 🤖', 'Julia 🤖', 'Matheus 🤖',
  'Bia 🤖', 'Gabriel 🤖', 'Larissa 🤖', 'Pedro 🤖',
  'Camila 🤖', 'Felipe 🤖', 'Isabella 🤖', 'Thiago 🤖',
  'Enzo 🤖', 'Valentina 🤖', 'Arthur 🤖', 'Helena 🤖'
];

function createBot(game) {
  let name = BOT_NAMES.find(n => ![...game.players.values()].some(p => p.name === n));
  if (!name) name = `Bot ${game.players.size + 1} 🤖`;
  const id = 'bot_' + crypto.randomBytes(3).toString('hex');
  const bot = {
    id,
    name,
    token: 'token_' + id,
    ws: null,
    isBot: true,
    connected: true,
    score: 0,
    streak: 0,
    answer: null,
    last: null,
    prevRank: null
  };
  game.players.set(id, bot);

  if (game.phase === 'question') {
    scheduleSingleBotAnswer(game, bot);
  }

  return bot;
}

function clearBots(game) {
  for (const [id, p] of game.players.entries()) {
    if (p.isBot) game.players.delete(id);
  }
  if (game.botTimers) {
    game.botTimers.forEach(t => clearTimeout(t));
    game.botTimers = [];
  }
}

function scheduleBotAnswers(game) {
  if (game.botTimers) {
    game.botTimers.forEach(t => clearTimeout(t));
    game.botTimers = [];
  }
  for (const p of game.players.values()) {
    if (p.isBot && p.connected) {
      scheduleSingleBotAnswer(game, p);
    }
  }
}

function scheduleSingleBotAnswer(game, bot) {
  const q = currentQuestion(game);
  if (!q) return;
  const totalMs = q.time * 1000;
  // Delay aleatório escalonado entre 3.5s e (tempo total - 2s)
  const minDelay = Math.min(3500, Math.max(1500, totalMs * 0.25));
  const maxDelay = Math.max(minDelay + 1000, totalMs - 2500);
  const delay = Math.round(minDelay + Math.random() * (maxDelay - minDelay));

  if (!game.botTimers) game.botTimers = [];
  const timer = setTimeout(() => {
    if (game.phase !== 'question' || bot.answer) return;
    let choice;
    if (Math.random() < 0.7) {
      choice = q.correct;
    } else {
      const wrong = [0, 1, 2, 3].slice(0, q.options.length).filter(i => i !== q.correct);
      choice = wrong.length ? wrong[Math.floor(Math.random() * wrong.length)] : 0;
    }
    const now = Date.now();
    bot.answer = { choice, ms: Math.max(0, now - game.qStart) };
    game.lastActivity = now;
    pushPlayers(game);
    pushHost(game);
    maybeEndEarly(game);
  }, delay);

  game.botTimers.push(timer);
}

/* ------------------------------------------------------------------ */
/* WebSocket                                                           */
/* ------------------------------------------------------------------ */

const wss = new WebSocketServer({ server, maxPayload: 4096 });

function cleanName(raw) {
  return String(raw || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

function attachHost(ws, game) {
  if (game.hostWs && game.hostWs !== ws) { try { game.hostWs.close(); } catch (_) { } }
  game.hostWs = ws;
  ws.ctx = { role: 'host', game };
  const quizzes = loadQuizzes().map(q => ({ id: q.id, title: q.title, count: q.questions.length }));
  send(ws, { t: 'host:ready', pin: game.pin, token: game.hostToken, total: game.questions.length, quizId: game.quizId, quizTitle: game.quizTitle, quizzes });
  pushHost(game);
}

function joinPlayer(ws, msg) {
  const game = games.get(String(msg.pin || '').trim());
  if (!game) return send(ws, { t: 'error', code: 'no-game', message: 'Senha da sala não encontrada. Confira a senha no telão.' });

  let player = null;
  if (msg.token) {
    for (const p of game.players.values()) if (p.token === msg.token) player = p;
  }

  if (player) {
    if (player.ws && player.ws !== ws) { try { player.ws.close(); } catch (_) { } }
    player.ws = ws; player.connected = true;
  } else {
    const name = cleanName(msg.name);
    if (!name) return send(ws, { t: 'error', code: 'bad-name', message: 'Digite um apelido.' });
    for (const p of game.players.values()) {
      if (p.name.toLowerCase() === name.toLowerCase()) {
        return send(ws, { t: 'error', code: 'name-taken', message: 'Esse apelido já está em uso. Escolha outro.' });
      }
    }
    player = {
      id: crypto.randomBytes(4).toString('hex'), name, token: token(), ws, connected: true,
      score: 0, streak: 0, answer: null, last: null
    };
    game.players.set(player.id, player);
  }

  ws.ctx = { role: 'player', game, player };
  game.lastActivity = Date.now();
  send(ws, { t: 'joined', token: player.token, pin: game.pin, name: player.name });
  pushPlayer(game, player);
  pushHost(game);
}

function handleHost(ws, msg) {
  const { game } = ws.ctx;
  game.lastActivity = Date.now();
  switch (msg.t) {
    case 'host:changeQuiz': {
      if (game.phase === 'lobby') {
        const quizzes = loadQuizzes();
        const found = quizzes.find(q => q.id === msg.quizId);
        if (found) {
          game.quizId = found.id;
          game.quizTitle = found.title;
          game.questions = JSON.parse(JSON.stringify(found.questions));
          pushAll(game);
        }
      }
      break;
    }
    case 'host:start':
      if (game.phase === 'lobby' && game.players.size > 0) beginReady(game);
      break;
    case 'host:skip':
      if (game.phase === 'question') endQuestion(game);
      else if (game.phase === 'ready') beginQuestion(game);
      break;
    case 'host:next':
      if (game.phase === 'reveal') {
        if (game.qIndex >= game.questions.length - 1) showPodium(game);
        else beginReady(game);
      }
      break;
    case 'host:restart':
      if (game.phase === 'podium') {
        clearTimer(game);
        game.phase = 'lobby'; game.qIndex = -1; game.reveal = null;
        resetScores(game);
        pushAll(game);
      }
      break;
    case 'host:kick': {
      const p = game.players.get(String(msg.id));
      if (p) {
        send(p.ws, { t: 'kicked' });
        try { p.ws && p.ws.close(); } catch (_) { }
        game.players.delete(p.id);
        pushHost(game);
        maybeEndEarly(game);
      }
      break;
    }
    case 'host:add-bot':
      createBot(game);
      pushHost(game);
      pushPlayers(game);
      break;
    case 'host:add-bots': {
      const count = Math.min(20, Math.max(1, Number(msg.count) || 1));
      for (let i = 0; i < count; i++) createBot(game);
      pushHost(game);
      pushPlayers(game);
      break;
    }
    case 'host:clear-bots':
      clearBots(game);
      pushHost(game);
      pushPlayers(game);
      maybeEndEarly(game);
      break;
  }
}

function handlePlayer(ws, msg) {
  const { game, player } = ws.ctx;
  if (!game || !player) return;

  if (msg.t === 'player:rename' && game.phase === 'lobby') {
    const newName = cleanName(msg.name);
    if (!newName) return send(ws, { t: 'error', code: 'bad-name', message: 'Digite um apelido.' });
    for (const other of game.players.values()) {
      if (other !== player && other.name.toLowerCase() === newName.toLowerCase()) {
        return send(ws, { t: 'error', code: 'name-taken', message: 'Esse apelido já está em uso. Escolha outro.' });
      }
    }
    player.name = newName;
    send(ws, { t: 'joined', token: player.token, pin: game.pin, name: player.name });
    pushAll(game);
    return;
  }

  if (msg.t === 'player:leave' && game.phase === 'lobby') {
    game.players.delete(player.id);
    send(ws, { t: 'kicked' });
    try { ws.close(); } catch (_) { }
    pushHost(game);
    return;
  }

  if (msg.t !== 'player:answer' || game.phase !== 'question' || player.answer) return;
  const now = Date.now();
  if (now > game.qEnd + GRACE_MS) return;
  const q = currentQuestion(game);
  const choice = Number.parseInt(msg.choice, 10);
  if (!(choice >= 0 && choice < q.options.length)) return;
  player.answer = { choice, ms: Math.max(0, now - game.qStart) };
  game.lastActivity = now;
  pushPlayers(game);
  pushHost(game);
  maybeEndEarly(game);
}

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.ctx = null;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
    if (!msg || typeof msg.t !== 'string') return;

    if (!ws.ctx) {
      if (msg.t === 'host:create') {
        if (!safeEqual(msg.password || '', HOST_PASSWORD)) {
          return send(ws, { t: 'error', code: 'bad-password', message: 'Senha incorreta para o apresentador.' });
        }
        return attachHost(ws, createGame());
      }
      if (msg.t === 'host:resume') {
        const game = games.get(String(msg.pin || ''));
        if (!game || !safeEqual(msg.token || '', game.hostToken)) {
          return send(ws, { t: 'error', code: 'no-game', message: 'Sessão expirada.' });
        }
        return attachHost(ws, game);
      }
      if (msg.t === 'player:join') return joinPlayer(ws, msg);
      return;
    }

    if (ws.ctx.role === 'host') handleHost(ws, msg);
    else handlePlayer(ws, msg);
  });

  ws.on('close', () => {
    const ctx = ws.ctx;
    if (!ctx) return;
    if (ctx.role === 'host') {
      if (ctx.game.hostWs === ws) ctx.game.hostWs = null;
    } else if (ctx.player.ws === ws) {
      ctx.player.connected = false;
      pushHost(ctx.game);
      if (ctx.game.phase === 'question') pushPlayers(ctx.game);
      maybeEndEarly(ctx.game);
    }
  });

  ws.on('error', () => { });
});

// detecta conexões mortas
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (_) { }
  }
}, 25000);

// remove jogos abandonados (8h sem atividade)
setInterval(() => {
  const limit = Date.now() - 8 * 3600 * 1000;
  for (const [pin, g] of games) {
    if (g.lastActivity < limit) { clearTimer(g); games.delete(pin); }
  }
}, 10 * 60 * 1000);

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  Quiz de Investimentos no ar!\n');
  console.log(`  Apresentador (telão):  http://localhost:${PORT}/host`);
  console.log(`  Editor de perguntas:   http://localhost:${PORT}/admin`);
  console.log(`  Alunos (mesma rede):   ${lanUrls().join('  |  ') || '(sem rede detectada)'}`);
  if (PUBLIC_URL) console.log(`  Link público:          ${PUBLIC_URL}`);
  console.log(`  Senha do apresentador: ${HOST_PASSWORD}`);
  console.log(`  Senha do editor:        ${ADMIN_PASSWORD}\n`);
});
