(() => {
  const $ = id => document.getElementById(id);
  const screens = ['login', 'lobby', 'ready', 'question', 'reveal', 'podium'];
  const KEY = 'quiz-host';

  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (_) {}

  let info = { lan: [], publicUrl: '' };
  let joinBase = location.origin;
  let state = null;
  let renderedKey = '';
  let lobbyIds = new Set();
  let timerRaf = 0, lastTickSec = -1;
  let readyTimer = null;
  let wantPassword = '';

  function populateQuizSelects(quizzes, activeId) {
    if (!Array.isArray(quizzes)) return;
    const wrap = $('header-quiz-wrap');
    if (wrap) {
      const options = quizzes.map(q => ({ label: `${q.title} (${q.count} Qs)`, value: q.id }));
      const currentId = activeId || (state && state.quizId) || (quizzes[0] && quizzes[0].id);
      renderCustomDropdown({
        container: wrap,
        options,
        value: currentId,
        onChange(newQuizId) {
          if (state && state.phase === 'lobby') {
            sock.send({ t: 'host:changeQuiz', quizId: newQuizId });
          }
        }
      });
    }
  }

  fetch('/api/info').then(r => r.json()).then(i => {
    info = i;
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    joinBase = i.publicUrl || (local && i.lan.length ? i.lan[0] : location.origin);
    if (i.quizzes) populateQuizSelects(i.quizzes);
    if (state) renderJoinInfo();
  }).catch(() => {});

  function show(name) {
    screens.forEach(s => {
      const el = $('h-' + s);
      if (el) el.classList.toggle('hidden', s !== name);
    });
    const header = document.querySelector('header.top');
    if (header) header.classList.toggle('hidden', name === 'login');
  }

  const sock = createSocket({
    onOpen() {
      $('conn').classList.add('hidden');
      if (saved) sock.send({ t: 'host:resume', pin: saved.pin, token: saved.token });
    },
    onClose() { if (saved) $('conn').classList.remove('hidden'); },
    onMessage: handle
  });

  function handle(m) {
    if (m.t === 'host:ready') {
      saved = { pin: m.pin, token: m.token };
      sessionStorage.setItem(KEY, JSON.stringify(saved));
      if (m.quizzes) populateQuizSelects(m.quizzes, m.quizId);
    } else if (m.t === 'error') {
      $('login-btn').disabled = false;
      if (m.code === 'no-game') { saved = null; sessionStorage.removeItem(KEY); state = null; show('login'); setHeader(null); }
      const el = $('login-error'); el.textContent = m.message; el.classList.remove('hidden');
    } else if (m.t === 'state') {
      render(m);
    }
  }

  $('login-form').addEventListener('submit', e => {
    e.preventDefault();
    sfx.unlock();
    $('login-error').classList.add('hidden');
    $('login-btn').disabled = true;
    const quizId = $('login-quiz-select') ? $('login-quiz-select').value : undefined;
    sock.send({ t: 'host:create', password: $('password').value, quizId });
    setTimeout(() => { $('login-btn').disabled = false; }, 1500);
  });

  const adminForm = $('admin-login-form');
  if (adminForm) {
    adminForm.addEventListener('submit', async e => {
      e.preventDefault();
      const pass = $('admin-password').value.trim();
      const errEl = $('admin-login-error');
      const btn = $('admin-login-btn');
      if (errEl) errEl.classList.add('hidden');
      if (btn) btn.disabled = true;

      try {
        const res = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pass })
        });
        if (res.ok) {
          sessionStorage.setItem('quiz-admin-pass', pass);
          window.location.href = '/admin';
        } else {
          if (errEl) {
            errEl.textContent = 'Senha incorreta para o editor.';
            errEl.classList.remove('hidden');
          }
          if (btn) btn.disabled = false;
        }
      } catch (_) {
        if (errEl) {
          errEl.textContent = 'Erro ao conectar ao servidor.';
          errEl.classList.remove('hidden');
        }
        if (btn) btn.disabled = false;
      }
    });
  }

  if ($('lobby-quiz-switch')) {
    $('lobby-quiz-switch').addEventListener('change', e => {
      if (state && state.phase === 'lobby') {
        sock.send({ t: 'host:changeQuiz', quizId: e.target.value });
      }
    });
  }

  const urlParams = new URLSearchParams(location.search);
  if (urlParams.get('autologin')) {
    setTimeout(() => {
      $('password').value = urlParams.get('autologin');
      sock.send({ t: 'host:create', password: $('password').value });
    }, 200);
  }

  /* ---------- cabeçalho / controles ---------- */

  function renderJoinInfo() {
    if (!state) return;
    const host = joinBase.replace(/^https?:\/\//, '');
    if ($('lobby-url')) $('lobby-url').textContent = host;
    if ($('lobby-pin')) $('lobby-pin').textContent = state.pin;
    if ($('header-pin')) $('header-pin').textContent = state.pin;
    if ($('jp-url')) $('jp-url').textContent = host;
    if ($('jp-pin')) $('jp-pin').textContent = state.pin;
    if ($('lobby-qr')) drawQr(`${joinBase}/?pin=${state.pin}`);
  }

  let lastQr = '';
  function drawQr(text) {
    if (text === lastQr) return;
    lastQr = text;
    const qr = qrcode(0, 'M');
    qr.addData(text); qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c},${r}h1v1h-1z`;
    if ($('lobby-qr')) $('lobby-qr').innerHTML = `<svg viewBox="-1 -1 ${n + 2} ${n + 2}" shape-rendering="crispEdges"><path d="${d}" fill="#0b1020"/></svg>`;
  }

  function setHeader(s) {
    const isLobby = s && s.phase === 'lobby';
    document.body.classList.toggle('quiz-active', !isLobby);

    if ($('header-quiz-wrap')) $('header-quiz-wrap').classList.toggle('hidden', !isLobby);
    if ($('header-pin-pill')) $('header-pin-pill').classList.toggle('hidden', !isLobby);
    $('joinpill').classList.toggle('hidden', isLobby || s.phase === 'podium');
    const pr = $('progress');
    const showP = s && ['ready', 'question', 'reveal'].includes(s.phase);
    pr.classList.toggle('hidden', !showP);
    if (showP) pr.textContent = `Pergunta ${s.qIndex + 1} / ${s.total} · ${s.players.length} jogadores`;
  }

  function setControls(s) {
    const c = $('controls'), btn = $('ctrl-btn');
    let label = '', disabled = false, cls = 'btn big';
    switch (s.phase) {
      case 'lobby': label = 'Começar quiz ▶'; disabled = s.players.length === 0; break;
      case 'question': c.classList.add('hidden'); return;
      case 'reveal': 
        if (s.reveal && s.reveal.isLast) { label = 'Ver pódio 🏆'; } 
        else { c.classList.add('hidden'); return; }
        break;
      case 'podium': 
        c.classList.add('hidden'); 
        btn.disabled = false; 
        return;
      default: c.classList.add('hidden'); return;
    }
    c.classList.remove('hidden');
    btn.textContent = label; btn.disabled = disabled; btn.className = cls;
  }

  function advance() {
    if (!state) return;
    sfx.unlock();
    const map = { lobby: 'host:start', question: 'host:skip', ready: 'host:skip', reveal: 'host:next', podium: 'host:restart' };
    const t = map[state.phase];
    if (t) sock.send({ t });
  }

  $('ctrl-btn').addEventListener('click', advance);
  const podiumRestartBtn = $('btn-podium-restart');
  if (podiumRestartBtn) {
    podiumRestartBtn.addEventListener('click', () => {
      sfx.unlock();
      sock.send({ t: 'host:restart' });
    });
  }
  document.addEventListener('keydown', e => {
    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
    if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); advance(); }
    else if (e.key === 'f' || e.key === 'F') toggleFull();
    else if (e.key === 'm' || e.key === 'M') toggleMute();
  });

  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {});
  }

  function updateSoundUI() {
    const isMuted = sfx.muted || sfx.volume === 0;
    const icon = $('sound-icon');
    const slider = $('vol-slider');
    const valText = $('vol-val');
    const curVol = isMuted ? 0 : sfx.volume;
    const pct = Math.round(curVol * 100);

    if (slider) {
      slider.value = curVol;
      const sliderW = 90, thumbW = 16;
      const centerPx = (pct / 100) * (sliderW - thumbW) + (thumbW / 2);
      const fillPct = Math.max(0, Math.min(100, (centerPx / sliderW) * 100)).toFixed(1);
      slider.style.background = `linear-gradient(90deg, #8a2be2 0%, #c084fc ${fillPct}%, rgba(255, 255, 255, 0.15) ${fillPct}%)`;
    }
    if (valText) {
      valText.textContent = `${pct}%`;
    }
    if (icon) {
      icon.innerHTML = isMuted
        ? '<path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73 4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>'
        : '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>';
    }
  }

  function toggleMute() {
    sfx.toggle();
    updateSoundUI();
  }

  if ($('btn-full')) $('btn-full').addEventListener('click', toggleFull);
  if ($('btn-mute')) $('btn-mute').addEventListener('click', toggleMute);
  const volSlider = $('vol-slider');
  if (volSlider) {
    volSlider.value = sfx.muted ? 0 : sfx.volume;
    volSlider.addEventListener('input', e => {
      const val = parseFloat(e.target.value);
      sfx.setVolume(val);
      updateSoundUI();
    });
  }

  const soundCtrl = $('sound-control');
  let soundTimer = null;
  if (soundCtrl) {
    soundCtrl.addEventListener('mouseenter', () => {
      clearTimeout(soundTimer);
      soundCtrl.classList.add('expanded');
    });
    soundCtrl.addEventListener('mouseleave', () => {
      clearTimeout(soundTimer);
      soundTimer = setTimeout(() => {
        soundCtrl.classList.remove('expanded');
      }, 150);
    });
  }

  updateSoundUI();

  /* ---------- render ---------- */

  function render(s) {
    const prev = state;
    state = s;
    if (s.quizzes) populateQuizSelects(s.quizzes, s.quizId);
    setHeader(s);
    setControls(s);
    renderJoinInfo();

    const key = `${s.phase}:${s.qIndex}`;
    const changed = key !== renderedKey;
    renderedKey = key;

    if (s.phase === 'lobby') { show('lobby'); renderLobby(s, prev); }
    else if (s.phase === 'ready') { if (changed) renderReady(s); }
    else if (s.phase === 'question') { if (changed) renderQuestion(s); updateAnswered(s); }
    else if (s.phase === 'reveal') { if (changed) renderReveal(s); }
    else if (s.phase === 'podium') { if (changed) renderPodium(s); }

    if (s.phase !== 'question') stopTimer();
    if (s.phase !== 'ready') {
      clearInterval(readyTimer);
      sfx.stopReadyCountdown();
    }
  }

  function renderLobby(s, prev) {
    if ($('lobby-count')) $('lobby-count').textContent = s.players.length;
    const box = $('lobby-players');
    const ids = new Set(s.players.map(p => p.id));
    // reinicia o conjunto se voltou do pódio (lobby novo)
    if (prev && prev.phase !== 'lobby') lobbyIds = new Set();
    let joinedNew = false;
    if (s.players.length === 0) {
      box.innerHTML = `
        <div class="empty-lobby">
          <h3 class="empty-title">Sala de Espera Aberta</h3>
          <p class="empty-subtitle">Os nomes dos alunos aparecerão neste quadro assim que entrarem na partida.</p>
        </div>`;
    } else {
      box.innerHTML = s.players.map(p => {
        const isNew = !lobbyIds.has(p.id);
        if (isNew) joinedNew = true;
        const initial = (p.name || '?').charAt(0).toUpperCase();
        return `<div class="pchip ${p.connected ? '' : 'off'}" ${isNew ? '' : 'style="animation:none"'}>
          <span class="p-avatar">${esc(initial)}</span>
          <span class="p-name">${esc(p.name)}</span>
          <span class="x" data-id="${p.id}" title="Remover">×</span>
        </div>`;
      }).join('');
    }
    if (ids.size > lobbyIds.size) sfx.join();
    lobbyIds = ids;
  }

  $('lobby-players').addEventListener('click', e => {
    const id = e.target.dataset && e.target.dataset.id;
    if (id) sock.send({ t: 'host:kick', id });
  });

  function renderReady(s) {
    show('ready');
    $('ready-count').textContent = `Pergunta ${s.qIndex + 1} de ${s.total}`;
    $('ready-q').textContent = s.question.text;
    
    // Contagem sonora de precisão milimétrica sem qualquer atraso
    sfx.scheduleReadyCountdown();

    const circle = $('ready-timer-circle');
    circle.textContent = '5';
    circle.classList.remove('pulse-anim');
    void circle.offsetWidth; // trigger reflow
    circle.classList.add('pulse-anim');
    
    clearInterval(readyTimer);
    const startMs = performance.now();
    let lastSec = 5;

    readyTimer = setInterval(() => {
      const elapsed = performance.now() - startMs;
      const sec = Math.max(1, 5 - Math.floor(elapsed / 1000));
      if (sec !== lastSec && sec >= 1) {
        lastSec = sec;
        circle.textContent = sec;
        circle.classList.remove('pulse-anim');
        void circle.offsetWidth;
        circle.classList.add('pulse-anim');
      }
      if (elapsed >= 5000) {
        clearInterval(readyTimer);
      }
    }, 50);
  }

  function optsHtml(q) {
    return q.options.map((t, i) => `<div class="opt opt-${i}" id="opt-${i}">${shapeHtml(i)}<span class="t">${esc(t)}</span></div>`).join('');
  }

  function renderQuestion(s) {
    show('question');
    $('q-text').textContent = s.question.text;
    $('q-opts').innerHTML = optsHtml(s.question);
    $('q-opts').classList.toggle('one-col', s.question.options.length < 3);
    startTimer(s.remaining, s.question.time);
  }

  function updateAnswered(s) {
    $('ans-count').textContent = `${s.answered}/${s.connected}`;
  }

  function startTimer(remaining, total) {
    stopTimer();
    lastTickSec = -1;
    const end = performance.now() + remaining;
    const ring = $('ring-fg'), num = $('ring-num'), wrap = ring.closest('.ring');
    const C = 2 * Math.PI * 44;
    const tick = now => {
      const left = Math.max(0, end - now);
      const sec = Math.ceil(left / 1000);
      const ratio = Math.min(1, left / (total * 1000));
      ring.style.strokeDashoffset = String(C * (1 - ratio));
      const color = `hsl(${ratio * 120}, 85%, 55%)`;
      ring.style.stroke = color;
      if (num) num.style.color = color;
      num.textContent = sec;
      wrap.classList.toggle('low', sec <= 5);
      if (sec <= 5 && sec > 0 && sec !== lastTickSec) {
        sfx.hurry(sec);
        lastTickSec = sec;
      }
      if (left > 0) timerRaf = requestAnimationFrame(tick);
    };
    timerRaf = requestAnimationFrame(tick);
  }
  function stopTimer() {
    cancelAnimationFrame(timerRaf);
    const ring = $('ring-fg'), num = $('ring-num');
    if (ring) ring.style.stroke = '';
    if (num) num.style.color = '';
  }

  function renderReveal(s) {
    show('reveal');
    const q = s.question, r = s.reveal;
    $('r-text').textContent = q.text;
    const max = Math.max(1, ...r.counts);
    const total = r.counts.reduce((a, b) => a + b, 0);
    $('r-opts').innerHTML = q.options.map((t, i) => {
      const cls = i === r.correct ? 'right' : 'wrong';
      return `<div class="opt opt-${i} ${cls}">${shapeHtml(i)}<span class="t">${esc(t)}</span><span class="num">${r.counts[i]}</span><span class="bar" style="width:${Math.round(r.counts[i] / max * 100)}%"></span></div>`;
    }).join('');
    $('r-expl').textContent = r.explanation || '';
    
    const boardList = r.board || [];
    $('r-board').innerHTML = boardList.map((p, i) => {
      const rank = i + 1;
      const rankCls = rank <= 3 ? `top-${rank}` : '';
      const isPositive = p.score > 0;
      return `<li class="${rankCls}" style="animation-delay:${Math.min(i * .04, .8)}s">
        <span class="pos-num">${rank}</span>
        <span class="nm">${esc(p.name)}</span>
        ${p.streak >= 3 ? `<span class="fire" title="${p.streak} acertos seguidos!">🔥</span>` : ''}
        <span class="sc ${isPositive ? 'has-points' : 'no-points'}">${isPositive ? '+' : ''}${p.score} <small>pts</small></span>
      </li>`;
    }).join('') || '<li><span class="nm">Sem jogadores</span></li>';

    sfx.reveal();
  }

  function renderPodium(s) {
    show('podium');
    const podEl = $('h-podium');
    if (podEl) {
      podEl.scrollTop = 0;
      podEl.classList.add('podium-animating');
    }

    const top = s.podium || [];
    const order = [1, 0, 2]; // 2º, 1º, 3º
    const medals = ['🥇', '🥈', '🥉'];
    const delay = [2.2, 1.2, .2];
    $('podium').innerHTML = order.filter(i => top[i]).map(i => {
      const p = top[i];
      return `<div class="pcol p${i + 1}"><div class="who" style="animation-delay:${delay[i] + .8}s"><span class="medal">${medals[i]}</span><span class="nm">${esc(p.name)}</span><span class="sc">${p.score} pts</span></div><div class="block" style="animation-delay:${delay[i]}s">${i + 1}</div></div>`;
    }).join('');

    const rest = top.slice(3);
    const restCard = $('podium-rest-card');
    const restList = $('podium-rest');

    if (restCard && restList) {
      if (rest.length === 0) {
        restCard.classList.add('hidden');
      } else {
        restCard.classList.remove('hidden');
        restList.innerHTML = rest.map((p, i) => {
          const rank = i + 4;
          return `
            <div class="rest-table-row" style="animation-delay:${Math.min(3.0 + i * 0.04, 4.4)}s">
              <span class="rth-pos"><b class="rank-badge">${rank}º</b></span>
              <span class="rth-name">${esc(p.name)}</span>
              <span class="rth-score"><b>${p.score}</b> <small>pts</small></span>
            </div>
          `;
        }).join('');
      }
    }

    sfx.victory();
    setTimeout(confetti, 2800);
    // Libera a rolagem da tela no momento exato em que a tabela aparece
    setTimeout(() => {
      if (podEl) podEl.classList.remove('podium-animating');
    }, 2800);
  }

  /* ---------- confete ---------- */
  function confetti() {
    const cv = $('confetti'), ctx = cv.getContext('2d');
    cv.width = innerWidth; cv.height = innerHeight;
    const colors = ['#2de2b0', '#8b6bff', '#ffc857', '#ff6b8b', '#4cc9f0'];
    const parts = Array.from({ length: 220 }, () => ({
      x: Math.random() * cv.width, y: -Math.random() * cv.height * .6, w: 8 + Math.random() * 8, h: 5 + Math.random() * 7,
      vx: -2 + Math.random() * 4, vy: 3 + Math.random() * 5, a: Math.random() * 6, va: -.2 + Math.random() * .4,
      c: colors[Math.floor(Math.random() * colors.length)]
    }));
    const t0 = performance.now();
    (function frame(now) {
      ctx.clearRect(0, 0, cv.width, cv.height);
      for (const p of parts) {
        p.x += p.vx; p.y += p.vy; p.a += p.va;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
      }
      if (now - t0 < 6000) requestAnimationFrame(frame); else ctx.clearRect(0, 0, cv.width, cv.height);
    })(t0);
  }

  show('login');
  setTimeout(() => $('password').focus(), 50);
})();
