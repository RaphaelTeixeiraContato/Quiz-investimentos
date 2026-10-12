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
    ws.onmessage = e => { try { onMessage(JSON.parse(e.data)); } catch (_) { } };
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
    close() { closedByUs = true; try { ws.close(); } catch (_) { } }
  };
}

/* Efeitos sonoros simples (WebAudio, sem arquivos) com controle de volume */
const sfx = (() => {
  let ctx = null;
  let muted = localStorage.getItem('quiz-muted') === '1';
  let volume = Number(localStorage.getItem('quiz-volume'));
  if (isNaN(volume) || volume < 0 || volume > 1) volume = 0.8;

  function ac() {
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { } }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(freq, start, dur, type = 'sine', baseVol = 0.15) {
    const c = ac(); if (!c || muted || volume <= 0) return;
    const finalVol = baseVol * volume;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq;
    const t = c.currentTime + start;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(finalVol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.05);
  }
  return {
    unlock() { ac(); },
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
    join() { tone(660, 0, .12, 'triangle'); tone(880, .08, .16, 'triangle'); },
    tick() { tone(1000, 0, .05, 'square', .05); },
    go() { tone(523, 0, .15, 'triangle'); tone(784, .12, .25, 'triangle'); },
    right() { tone(659, 0, .14, 'triangle'); tone(880, .12, .14, 'triangle'); tone(1175, .24, .3, 'triangle'); },
    wrong() { tone(220, 0, .25, 'sawtooth', .1); tone(165, .2, .35, 'sawtooth', .1); },
    end() { tone(392, 0, .2, 'triangle'); tone(523, .2, .2, 'triangle'); tone(659, .4, .2, 'triangle'); tone(784, .6, .5, 'triangle'); }
  };
})();

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
