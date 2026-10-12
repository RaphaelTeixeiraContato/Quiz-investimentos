/* Utilidades compartilhadas: WebSocket com reconexão, formas, sons, toast */

const SHAPES = [
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 18 3 22 9 12 21 2 9 6 3"></polygon><line x1="11" y1="3" x2="8" y2="9"></line><line x1="13" y1="3" x2="16" y2="9"></line><line x1="2" y1="9" x2="22" y2="9"></line><line x1="12" y1="21" x2="8" y2="9"></line><line x1="12" y1="21" x2="16" y2="9"></line></svg>', // 💎 Diamante
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"></polyline><polyline points="16 7 22 7 22 13"></polyline></svg>', // 📈 Gráfico de Alta
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>', // 💲 Cifrão / Capital
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>' // 🛡️ Escudo / Reserva
];

function shapeHtml(i) { return `<span class="shape">${SHAPES[i] || ''}</span>`; }

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

/** Conexão WebSocket com reconexão automática (backoff até 4s). */
function createSocket({ onOpen, onMessage, onClose }) {
  let ws, tries = 0, closedByUs = false;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';

  function open() {
    ws = new WebSocket(`${proto}://${location.host}`);
    ws.onopen = () => { tries = 0; onOpen && onOpen(); };
    ws.onmessage = e => { try { onMessage(JSON.parse(e.data)); } catch (_) {} };
    ws.onclose = () => {
      onClose && onClose();
      if (closedByUs) return;
      tries++;
      setTimeout(open, Math.min(4000, 400 * tries));
    };
  }
  open();

  return {
    send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); },
    close() { closedByUs = true; try { ws.close(); } catch (_) {} }
  };
}

/* Efeitos sonoros robustos (WebAudio, sem arquivos externos) com controle de volume e suporte pleno a iOS/PC */
const sfx = (() => {
  let ctx = null;
  let muted = localStorage.getItem('quiz-muted') === '1';
  let volume = Number(localStorage.getItem('quiz-volume'));
  if (isNaN(volume) || volume < 0 || volume > 1) volume = 0.8;

  function ac() {
    if (!ctx) {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) ctx = new AudioCtx();
      } catch (_) {}
    }
    if (ctx && (ctx.state === 'suspended' || ctx.state === 'interrupted')) {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  let keepAliveNode = null;
  let activeOscs = [];

  function startKeepAlive(c) {
    if (keepAliveNode || !c) return;
    try {
      // Infrasom a 10Hz com ganho 0.00001 (inaudível) mantém o pipeline de áudio ativo no iOS Safari e PC
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = 10;
      gain.gain.value = 0.00001;
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(0);
      keepAliveNode = osc;
    } catch (_) {}
  }

  function tone(freq, start, dur, type = 'sine', baseVol = 0.22, endFreq = null) {
    const c = ac();
    if (!c || muted || volume <= 0) return;
    try {
      const finalVol = Math.max(0.001, baseVol * volume);
      const now = c.currentTime;
      const t = Math.max(now, now + (start || 0));
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (endFreq) {
        o.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t + dur);
      }
      g.gain.setValueAtTime(0, t);
      const attack = Math.min(0.015, dur * 0.2);
      g.gain.linearRampToValueAtTime(finalVol, t + attack);
      g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(g);
      g.connect(c.destination);
      o.start(t);
      o.stop(t + dur + 0.05);

      activeOscs.push(o);
      o.onended = () => {
        const idx = activeOscs.indexOf(o);
        if (idx !== -1) activeOscs.splice(idx, 1);
      };
    } catch (_) {}
  }

  function stopAll() {
    activeOscs.forEach(o => {
      try { o.stop(); o.disconnect(); } catch (_) {}
    });
    activeOscs = [];
  }

  return {
    unlock() {
      const c = ac();
      if (c) {
        try {
          if (c.state === 'suspended' || c.state === 'interrupted') c.resume().catch(() => {});
          const buf = c.createBuffer(1, 1, 22050);
          const src = c.createBufferSource();
          src.buffer = buf;
          src.connect(c.destination);
          src.start(0);
          startKeepAlive(c);
        } catch (_) {}
      }
    },
    get muted() { return muted; },
    get volume() { return volume; },
    setVolume(v) {
      volume = Math.max(0, Math.min(1, Number(v) || 0));
      localStorage.setItem('quiz-volume', String(volume));
      if (volume > 0 && muted) {
        muted = false;
        localStorage.setItem('quiz-muted', '0');
      }
      return volume;
    },
    toggle() {
      muted = !muted;
      localStorage.setItem('quiz-muted', muted ? '1' : '0');
      return muted;
    },
    // Boas-vindas ao entrar na sala (confirma que o som está funcionando no aparelho)
    welcome() {
      tone(523.25, 0, 0.12, 'triangle', 0.22);
      tone(659.25, 0.1, 0.12, 'triangle', 0.24);
      tone(783.99, 0.2, 0.28, 'sine', 0.28);
    },
    // Clique nítido e tátil de seleção de alternativa
    tap() {
      tone(520, 0, 0.07, 'sine', 0.28);
      tone(880, 0.03, 0.1, 'triangle', 0.24);
    },
    // Aluno entra na sala de espera (som para o telão do apresentador)
    join() {
      tone(587.33, 0, 0.18, 'triangle', 0.24);
      tone(880, 0.1, 0.35, 'sine', 0.28);
      tone(1760, 0.1, 0.2, 'sine', 0.08);
    },
    // Agenda com precisão absoluta de hardware do WebAudio a contagem regressiva 5, 4, 3, 2, 1
    scheduleReadyCountdown() {
      stopAll();
      const c = ac();
      if (!c || muted || volume <= 0) return;
      // 5: agora (com folga mínima de 0.02s)
      tone(523.25, 0.02, 0.12, 'triangle', 0.22);
      // 4: exatamente em 1s
      tone(523.25, 1.02, 0.12, 'triangle', 0.22);
      // 3: exatamente em 2s
      tone(523.25, 2.02, 0.12, 'triangle', 0.22);
      // 2: exatamente em 3s
      tone(523.25, 3.02, 0.12, 'triangle', 0.22);
      // 1: sinal de largada exatamente em 4s
      tone(880.00, 4.02, 0.28, 'triangle', 0.3);
      tone(1320.0, 4.06, 0.22, 'sine', 0.2);
    },
    stopReadyCountdown() {
      stopAll();
    },
    // Contagem isolada avulsa (se chamada manualmente)
    countdown(sec) {
      if (sec === 1 || sec <= 0) {
        tone(880, 0, 0.28, 'triangle', 0.3);
        tone(1320, 0.04, 0.22, 'sine', 0.2);
      } else {
        tone(523.25, 0, 0.12, 'triangle', 0.22);
      }
    },
    go() {
      tone(523.25, 0, 0.15, 'triangle', 0.22);
      tone(783.99, 0.1, 0.25, 'triangle', 0.24);
    },
    // Alerta de tempo acabando nos últimos 5 segundos de pergunta
    hurry(sec) {
      const s = Math.max(1, Math.min(5, Number(sec) || 1));
      const f = 640 + (5 - s) * 120;
      tone(f, 0, 0.07, 'square', 0.12);
      tone(f * 1.5, 0.01, 0.06, 'sine', 0.1);
    },
    tick() {
      this.hurry(3);
    },
    // Revelação da resposta no telão
    reveal() {
      tone(523.25, 0, 0.35, 'triangle', 0.2);
      tone(659.25, 0.02, 0.35, 'triangle', 0.2);
      tone(783.99, 0.04, 0.45, 'sine', 0.25);
      tone(1046.50, 0.06, 0.5, 'sine', 0.18);
    },
    // Acertou a questão
    right() {
      tone(523.25, 0, 0.12, 'triangle', 0.25);
      tone(659.25, 0.08, 0.12, 'triangle', 0.26);
      tone(783.99, 0.16, 0.16, 'triangle', 0.28);
      tone(1046.50, 0.24, 0.45, 'sine', 0.35);
      tone(2093.00, 0.24, 0.3, 'sine', 0.12);
    },
    // Errou a questão / Esgotou tempo
    wrong() {
      tone(260, 0, 0.2, 'sawtooth', 0.18, 200);
      tone(195, 0.18, 0.35, 'sawtooth', 0.2, 140);
    },
    // Fanfarra épica de vitória para o Pódio
    victory() {
      stopAll();
      tone(392.00, 0, 0.15, 'triangle', 0.24);
      tone(523.25, 0.15, 0.15, 'triangle', 0.26);
      tone(659.25, 0.30, 0.15, 'triangle', 0.28);
      tone(783.99, 0.45, 0.3, 'triangle', 0.32);
      tone(659.25, 0.75, 0.15, 'triangle', 0.26);
      tone(783.99, 0.90, 0.25, 'triangle', 0.32);
      // Acorde triunfal final
      tone(523.25, 1.15, 0.85, 'triangle', 0.28);
      tone(659.25, 1.15, 0.85, 'triangle', 0.28);
      tone(783.99, 1.15, 0.85, 'sine', 0.34);
      tone(1046.50, 1.15, 0.95, 'sine', 0.38);
    },
    end() {
      this.victory();
    }
  };
})();

// Desbloqueia AudioContext em navegadores mobile (iOS/Safari) e desktop no primeiro toque/clique
['click', 'touchstart', 'touchend', 'pointerdown', 'keydown', 'focusin'].forEach(evt => {
  window.addEventListener(evt, () => { sfx.unlock(); }, { capture: true, passive: true });
});


/** Componente de Dropdown Customizado Glassmorphism */
function renderCustomDropdown({ container, options, value, onChange }) {
  if (!container) return;
  const current = options.find(o => String(o.value) === String(value)) || options[0] || { label: 'Selecione', value: '' };
  container.innerHTML = `
    <div class="custom-dd">
      <button type="button" class="custom-dd-btn">
        <span class="custom-dd-label">${esc(current.label)}</span>
        <svg class="custom-dd-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
      </button>
      <div class="custom-dd-menu">
        ${options.map(o => `
          <div class="custom-dd-item ${String(o.value) === String(value) ? 'selected' : ''}" data-value="${esc(o.value)}">
            <span class="item-text">${esc(o.label)}</span>
            ${String(o.value) === String(value) ? '<span class="dd-check">✔</span>' : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `;
  const dd = container.querySelector('.custom-dd');
  const btn = container.querySelector('.custom-dd-btn');
  const menu = container.querySelector('.custom-dd-menu');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.custom-dd.open').forEach(el => { if (el !== dd) el.classList.remove('open'); });
    dd.classList.toggle('open');
  });

  menu.querySelectorAll('.custom-dd-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const val = item.dataset.value;
      dd.classList.remove('open');
      if (val !== value && onChange) onChange(val);
    });
  });

  document.addEventListener('click', (e) => {
    if (!dd.contains(e.target)) dd.classList.remove('open');
  });
}

// Sincroniza a posição da animação do fundo para não resetar no reload
document.addEventListener('DOMContentLoaded', () => {
  const bg = document.querySelector('.bg');
  if (bg) {
    let syncTime = localStorage.getItem('bgSyncTime');
    if (!syncTime) {
      syncTime = Date.now().toString();
      localStorage.setItem('bgSyncTime', syncTime);
    }
    const elapsedSecs = (Date.now() - parseInt(syncTime)) / 1000;
    const lights = bg.querySelectorAll('i');
    lights.forEach(light => {
      // Avança a animação em elapsedSecs, convertendo para negativo
      // Se a animação original já tiver delay (ex: 0.3s), mantemos, mas aqui é puro.
      light.style.animationDelay = `-${elapsedSecs}s`;
    });
  }
});
