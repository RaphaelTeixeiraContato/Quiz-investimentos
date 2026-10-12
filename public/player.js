(() => {
  const $ = id => document.getElementById(id);
  const screens = ['join', 'lobby', 'ready', 'question', 'answered', 'result', 'podium', 'kicked'];
  const LS = 'quiz-player';

  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(LS) || 'null'); } catch (_) {}

  const params = new URLSearchParams(location.search);
  const pinParam = (params.get('pin') || '').replace(/\D/g, '').slice(0, 6);
  if (saved && pinParam && saved.pin !== pinParam) saved = null; // outro jogo: não reaproveitar
  $('pin').value = pinParam || '';
  if (saved && saved.name) $('nick').value = saved.name;

  let joined = false;      // já entrou (para decidir se reconecta sozinho)
  let timerRaf = 0;
  let lastState = null;
  let currentQIndex = -1;
  let myChoiceIndex = null;

  const DEFAULT_TIPS = [
    "Os juros compostos são considerados a 8ª maravilha do mundo: eles multiplicam seu dinheiro ao longo do tempo!",
    "A regra básica da diversificação: nunca coloque todos os seus ovos na mesma cesta de investimentos.",
    "A reserva de emergência é o seu escudo financeiro — deve cobrir de 6 a 12 meses das suas despesas essenciais.",
    "Inflação é a perda silenciosa do poder de compra. Deixar dinheiro parado na conta corrente é perder dinheiro todo mês.",
    "No mercado financeiro, maior rentabilidade sempre traz maior risco. Desconfie de promessas de lucros fáceis!",
    "O tempo é o melhor amigo do investidor: começar cedo com pouco vale mais do que começar tarde com muito.",
    "Investir é colocar seu dinheiro para trabalhar por você enquanto você constrói seu patrimônio.",
    "Renda fixa traz estabilidade e segurança, enquanto renda variável busca potencial de crescimento a longo prazo.",
    "Pequenos cortes em gastos desnecessários hoje podem se transformar em um grande patrimônio amanhã.",
    "Conhecimento é o ativo mais valioso: quem estuda o mercado toma decisões muito mais seguras!"
  ];

  function getChoiceBadgeHtml(choiceIndex, question) {
    if (choiceIndex === null || choiceIndex === undefined || choiceIndex < 0) return '';
    const shape = shapeHtml(choiceIndex);
    const label = (question && question.options && question.options[choiceIndex]) 
      ? esc(question.options[choiceIndex]) 
      : `Opção ${['A', 'B', 'C', 'D'][choiceIndex] || ''}`;
    return `<div class="waiting-choice-badge choice-${choiceIndex}">${shape}<span>${label}</span></div>`;
  }

  function renderWaitingLounge(s) {
    const q = s.question || {};
    const total = s.totalPlayers || 1;
    const answered = Math.min(total, s.answeredCount || 1);
    const remaining = Math.max(0, total - answered);
    const pct = Math.min(100, Math.max(10, Math.round((answered / total) * 100)));

    const choiceBadge = $('waiting-choice-badge');
    const ch = (s.answered !== null && s.answered !== undefined) ? s.answered : myChoiceIndex;
    if (choiceBadge) choiceBadge.innerHTML = getChoiceBadgeHtml(ch, q);

    const countEl = $('waiting-players-count');
    if (countEl) countEl.textContent = `${answered} de ${total} responderam`;

    const barEl = $('waiting-bar-fill');
    if (barEl) barEl.style.width = pct + '%';

    const statusEl = $('waiting-status-msg');
    if (statusEl) {
      if (remaining === 0) {
        statusEl.textContent = '🎉 Todos os jogadores já responderam! Aguardando o telão...';
      } else if (remaining === 1) {
        statusEl.textContent = 'Falta apenas 1 jogador responder...';
      } else {
        statusEl.textContent = `Aguardando mais ${remaining} jogadores responderem...`;
      }
    }

    const tipEl = $('waiting-tip-text');
    if (tipEl) {
      const tipText = (q.waitingTip && q.waitingTip.trim()) 
        ? q.waitingTip.trim() 
        : DEFAULT_TIPS[(s.qIndex >= 0 ? s.qIndex : 0) % DEFAULT_TIPS.length];
      tipEl.textContent = tipText;
    }
  }

  function show(name) {
    screens.forEach(s => {
      const el = $('s-' + s);
      if (el) el.classList.toggle('hidden', s !== name);
    });
    // Esconde o HUD de pontos na sala de espera
    document.body.classList.toggle('has-hud', ['ready', 'question', 'answered', 'result', 'podium'].includes(name));
    if ($('hud')) $('hud').classList.toggle('hidden', !document.body.classList.contains('has-hud'));
    const isOut = name === 'join' || name === 'kicked';
    if ($('player-top')) $('player-top').classList.toggle('hidden', isOut);
    const toolsEl = document.querySelector('.tools');
    if (toolsEl) toolsEl.classList.toggle('hidden', isOut);
  }

  function setError(msg) {
    const el = $('join-error');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('hidden', !msg);
  }

  const sock = createSocket({
    onOpen() {
      $('conn').classList.add('hidden');
      if (saved && saved.token && saved.pin) {
        sock.send({ t: 'player:join', pin: saved.pin, token: saved.token, name: saved.name });
      }
    },
    onClose() { if (joined) $('conn').classList.remove('hidden'); },
    onMessage: handle
  });

  function handle(m) {
    if (m.t === 'joined') {
      joined = true;
      saved = { pin: m.pin, name: m.name, token: m.token };
      localStorage.setItem(LS, JSON.stringify(saved));
      $('hud-name').textContent = m.name;
      if ($('lobby-nick-input')) $('lobby-nick-input').value = m.name;
      if ($('lobby-nick-error')) $('lobby-nick-error').classList.add('hidden');
      history.replaceState(null, '', '/?pin=' + m.pin);
    } else if (m.t === 'error') {
      $('join-btn').disabled = false;
      if (m.code === 'no-game' && joined) { /* jogo acabou no servidor */ }
      if (m.code === 'no-game') { localStorage.removeItem(LS); saved = null; joined = false; show('join'); }
      if (m.code === 'bad-name' || m.code === 'name-taken') {
        const nickErr = $('lobby-nick-error');
        if (nickErr && !$('s-lobby').classList.contains('hidden')) {
          nickErr.textContent = m.message;
          nickErr.classList.remove('hidden');
          return;
        }
      }
      setError(m.message);
    } else if (m.t === 'kicked') {
      joined = false; saved = null; localStorage.removeItem(LS);
      show('kicked');
    } else if (m.t === 'state') {
      render(m);
    }
  }

  $('join-form').addEventListener('submit', e => {
    e.preventDefault();
    sfx.unlock();
    const pin = $('pin').value.replace(/\D/g, '');
    const name = $('nick').value.trim();
    if (pin.length !== 6) return setError('A senha da sala tem 6 números.');
    if (!name) return setError('Digite um apelido.');
    setError('');
    $('join-btn').disabled = true;
    // se já tinha token desse mesmo PIN, retoma; senão entra como novo
    const token = saved && saved.pin === pin ? saved.token : undefined;
    sock.send({ t: 'player:join', pin, name, token });
    setTimeout(() => { $('join-btn').disabled = false; }, 1500);
  });

  $('pin').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); });

  /* ---------- Controles de Áudio, Tela Cheia e Ações da Sala ---------- */

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
    if (valText) valText.textContent = `${pct}%`;
    if (icon) {
      icon.innerHTML = isMuted
        ? '<path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73 4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>'
        : '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>';
    }
  }

  function toggleMute() { sfx.toggle(); updateSoundUI(); }
  if ($('btn-full')) $('btn-full').addEventListener('click', toggleFull);
  if ($('btn-mute')) $('btn-mute').addEventListener('click', toggleMute);
  const volSlider = $('vol-slider');
  if (volSlider) {
    volSlider.value = sfx.muted ? 0 : sfx.volume;
    volSlider.addEventListener('input', e => {
      sfx.setVolume(parseFloat(e.target.value));
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

  const nickEditForm = $('nick-edit-form');
  if (nickEditForm) {
    nickEditForm.addEventListener('submit', e => {
      e.preventDefault();
      const input = $('lobby-nick-input');
      const errEl = $('lobby-nick-error');
      if (errEl) errEl.classList.add('hidden');
      const newName = input.value.trim();
      const cur = (saved && saved.name) || '';
      if (!newName) {
        if (errEl) { errEl.textContent = 'Digite um apelido.'; errEl.classList.remove('hidden'); }
        return;
      }
      if (newName !== cur) {
        sock.send({ t: 'player:rename', name: newName });
      }
    });
  }

  const leaveModal = $('leave-modal');
  const showLeaveModal = () => leaveModal.classList.remove('hidden');
  
  if ($('btn-leave-lobby')) $('btn-leave-lobby').addEventListener('click', showLeaveModal);
  if ($('btn-leave-anywhere')) $('btn-leave-anywhere').addEventListener('click', showLeaveModal);

  if ($('btn-cancel-leave')) {
    $('btn-cancel-leave').addEventListener('click', () => {
      leaveModal.classList.add('hidden');
    });
    $('btn-confirm-leave').addEventListener('click', () => {
      leaveModal.classList.add('hidden');
      sock.send({ t: 'player:leave' });
      joined = false; saved = null; localStorage.removeItem(LS);
      show('join');
    });
  }

  function cancelTimer() { cancelAnimationFrame(timerRaf); }

  let lastPlayerTickSec = -1;
  function runTimer(remaining, total) {
    cancelTimer();
    lastPlayerTickSec = -1;
    const bar = $('timer-bar');
    const end = performance.now() + remaining;
    const tick = now => {
      const left = Math.max(0, end - now);
      const sec = Math.ceil(left / 1000);
      const ratio = Math.min(1, left / (total * 1000));
      bar.style.transform = `scaleX(${ratio})`;
      bar.style.background = `hsl(${ratio * 120}, 75%, 65%)`;

      if (myChoiceIndex === null && sec <= 5 && sec > 0 && sec !== lastPlayerTickSec) {
        sfx.hurry(sec);
        lastPlayerTickSec = sec;
      }

      if (left > 0) timerRaf = requestAnimationFrame(tick);
    };
    timerRaf = requestAnimationFrame(tick);
  }

  function ordinal(n) { return n + 'º'; }

  function renderLobbyPlayers(s) {
    const countEl = $('player-lobby-count');
    const chipsEl = $('player-lobby-chips');
    const players = s.players || [];
    if (countEl) countEl.textContent = players.length;
    if (chipsEl) {
      if (players.length === 0) {
        chipsEl.innerHTML = '<div class="empty-lobby-text">Aguardando mais jogadores entrarem…</div>';
      } else {
        chipsEl.innerHTML = players.map(p => {
          const initial = (p.name || '?').charAt(0).toUpperCase();
          const isSelfCls = p.isSelf ? 'is-self' : '';
          return `<div class="pchip ${isSelfCls}">
            <span class="p-avatar">${esc(initial)}</span>
            <span class="p-name">${esc(p.name)}</span>
            ${p.isSelf ? '<span class="you-tag">(Você)</span>' : ''}
          </div>`;
        }).join('');
      }
    }
  }

  function render(s) {
    lastState = s;
    $('hud-name').textContent = s.name;
    $('hud-score').textContent = s.score + ' pts';
    document.body.classList.toggle('quiz-active', s.phase !== 'login' && s.phase !== 'lobby');

    if (s.phase === 'lobby') {
      cancelTimer();
      currentQIndex = -1;
      myChoiceIndex = null;
      const input = $('lobby-nick-input');
      if (input && document.activeElement !== input) {
        input.value = s.name;
      }
      renderLobbyPlayers(s);
      show('lobby');
    } else if (s.phase === 'ready') {
      cancelTimer();
      currentQIndex = -1;
      myChoiceIndex = null;
      show('ready');
      if (navigator.vibrate) navigator.vibrate(30);
    } else if (s.phase === 'question') {
      if (s.answered !== null) {
        myChoiceIndex = s.answered;
        cancelTimer();
        renderWaitingLounge(s);
        show('answered');
        return;
      }
      // Se ainda não respondeu e já está mostrando a questão atual, ignora atualizações para não resetar o timer
      if (currentQIndex === s.qIndex && !$('s-question').classList.contains('hidden')) {
        return;
      }
      currentQIndex = s.qIndex;
      myChoiceIndex = null;
      cancelTimer();
      const q = s.question;
      const box = $('answers');
      box.classList.toggle('one-col', q.options.length < 3);
      box.innerHTML = q.options.map((t, i) =>
        `<button class="ans opt-${i}" data-i="${i}" id="ans-${i}">${shapeHtml(i)}<span class="t">${esc(t)}</span></button>`
      ).join('');
      box.querySelectorAll('.ans').forEach(b => b.addEventListener('click', () => {
        const choice = Number(b.dataset.i);
        myChoiceIndex = choice;
        sfx.tap();
        sock.send({ t: 'player:answer', choice });
        if (navigator.vibrate) navigator.vibrate(40);
        cancelTimer();
        renderWaitingLounge({
          ...s,
          answered: choice,
          answeredCount: (s.answeredCount || 0) + 1
        });
        show('answered');
      }));
      show('question');
      runTimer(s.remaining, q.time);
    } else if (s.phase === 'reveal') {
      cancelTimer();
      renderResult(s);
    } else if (s.phase === 'podium') {
      cancelTimer();
      renderPodium(s);
    }
  }

  function renderResult(s) {
    const r = s.result;
    if (!r) { show('ready'); $('ready-count').textContent = 'Aguarde'; return; }
    
    const q = s.question || {};
    const choice = (r.choice !== null && r.choice !== undefined) ? r.choice : myChoiceIndex;
    
    const choiceBadge = $('result-choice-badge');
    if (choiceBadge) choiceBadge.innerHTML = getChoiceBadgeHtml(choice, q);

    const pill = $('result-status-pill');
    const icon = $('res-icon');
    const title = $('res-title');

    if (pill) {
      pill.classList.remove('done-pill', 'correct-pill', 'wrong-pill');
      if (r && r.answered) {
        if (r.correct) {
          pill.classList.add('correct-pill');
          if (icon) icon.textContent = '✅';
          if (title) title.textContent = 'Você marcou a alternativa certa!';
          sfx.right();
        } else {
          pill.classList.add('wrong-pill');
          if (icon) icon.textContent = '❌';
          if (title) title.textContent = 'Você marcou a alternativa errada!';
          sfx.wrong();
        }
      } else {
        pill.classList.add('wrong-pill');
        if (icon) icon.textContent = '⏱️';
        if (title) title.textContent = 'Tempo Esgotado! Você não respondeu.';
        sfx.wrong();
      }
    } else if (title) {
      title.textContent = (r && r.answered)
        ? (r.correct ? 'Você marcou a alternativa certa!' : 'Você marcou a alternativa errada!')
        : 'Tempo Esgotado!';
    }

    const tipEl = $('result-tip-text');
    if (tipEl) {
      const tipText = (q.waitingTip && q.waitingTip.trim()) 
        ? q.waitingTip.trim() 
        : DEFAULT_TIPS[(s.qIndex >= 0 ? s.qIndex : 0) % DEFAULT_TIPS.length];
      tipEl.textContent = tipText;
    }

    show('result');
    if (navigator.vibrate) navigator.vibrate(200);
  }

  function renderPodium(s) {
    const r = s.result || { rank: '-', players: 0 };
    const medal = { 1: '🥇', 2: '🥈', 3: '🥉' }[r.rank] || '🎖️';
    $('pod-emoji').textContent = medal;
    $('pod-title').textContent = r.rank <= 3 ? `Você ficou em ${ordinal(r.rank)} lugar!` : `Você terminou em ${ordinal(r.rank)}`;
    $('pod-score').textContent = s.score + ' pts';
    const sub = $('pod-sub');
    if (sub) sub.textContent = '';
    sfx.victory();
    show('podium');
  }

  show('join');
})();
