(() => {
  const $ = id => document.getElementById(id);
  const KEY = 'quiz-admin-pass';
  let password = sessionStorage.getItem(KEY) || '';
  let quizzesList = [];
  let currentQuizId = '';
  let currentQuizTitle = '';
  let questions = [];
  let dirty = false;

  const headers = () => ({ 'Content-Type': 'application/json', 'x-admin-password': password });

  async function api(method, url, body) {
    const res = await fetch(url, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Erro'), { status: res.status });
    return data;
  }

  async function enter(pass) {
    password = pass;
    try {
      quizzesList = await api('GET', '/api/quizzes');
      sessionStorage.setItem(KEY, password);
      $('gate').classList.add('hidden');
      $('editor').classList.remove('hidden');

      if (quizzesList.length) {
        currentQuizId = quizzesList[0].id;
        await selectQuiz(currentQuizId);
      }
    } catch (e) {
      sessionStorage.removeItem(KEY);
      $('gate').classList.remove('hidden');
      $('editor').classList.add('hidden');
      if (pass) { const el = $('gate-error'); el.textContent = 'Senha incorreta.'; el.classList.remove('hidden'); }
    }
  }

  async function selectQuiz(quizId) {
    if (dirty && !confirm('Você tem alterações não salvas nesta prova. Deseja descartar as alterações e trocar de prova?')) {
      if ($('quiz-select')) $('quiz-select').value = currentQuizId;
      return;
    }
    currentQuizId = quizId;
    const data = await api('GET', `/api/quizzes/${quizId}`);
    currentQuizTitle = data.title || '';
    questions = data.questions || [];
    dirty = false;
    renderQuizzesBar();
    render();
  }

  function updateActionButtonsState() {
    const sBtn = $('btn-save');
    const rBtn = $('btn-reset');
    if (sBtn) sBtn.disabled = !dirty;
    if (rBtn) rBtn.disabled = !dirty;
  }

  function renderQuizzesBar() {
    const wrap = $('admin-quiz-dd-wrap');
    if (wrap) {
      const options = quizzesList.map(q => ({ label: `${q.title} (${q.count} Qs)`, value: q.id }));
      renderCustomDropdown({
        container: wrap,
        options,
        value: currentQuizId,
        onChange(newQuizId) {
          selectQuiz(newQuizId);
        }
      });
    }
    if ($('quiz-title-input')) $('quiz-title-input').value = currentQuizTitle;
    if ($('btn-del-quiz')) $('btn-del-quiz').style.display = quizzesList.length > 1 ? 'inline-flex' : 'none';
    updateActionButtonsState();
  }

  $('gate-form').addEventListener('submit', e => { e.preventDefault(); enter($('password').value); });

  if ($('quiz-select')) {
    $('quiz-select').addEventListener('change', e => {
      selectQuiz(e.target.value);
    });
  }

  if ($('quiz-title-input')) {
    $('quiz-title-input').addEventListener('input', e => {
      currentQuizTitle = e.target.value;
      markDirty();
    });
  }

  if ($('btn-new-quiz')) {
    $('btn-new-quiz').addEventListener('click', async () => {
      const title = prompt('Digite o nome da nova prova (ex.: Prova 2 - Turma B):', 'Nova Prova');
      if (!title || !title.trim()) return;
      try {
        const created = await api('POST', '/api/quizzes', { title: title.trim() });
        quizzesList = await api('GET', '/api/quizzes');
        toast('Nova prova criada com sucesso! 🎉', 'ok');
        await selectQuiz(created.id);
      } catch (e) { toast(e.message, 'err'); }
    });
  }

  if ($('btn-del-quiz')) {
    $('btn-del-quiz').addEventListener('click', async () => {
      if (quizzesList.length <= 1) return toast('Você precisa manter pelo menos uma prova cadastrada.', 'err');
      if (!confirm(`Tem certeza que deseja excluir a prova "${currentQuizTitle}"?`)) return;
      try {
        await api('DELETE', `/api/quizzes/${currentQuizId}`);
        quizzesList = await api('GET', '/api/quizzes');
        toast('Prova excluída.', 'ok');
        if (quizzesList.length) await selectQuiz(quizzesList[0].id);
      } catch (e) { toast(e.message, 'err'); }
    });
  }

  /* ---------- render ---------- */

  function render() {
    const list = $('list');
    if (!questions.length) {
      list.innerHTML = '<div class="card empty">Nenhuma pergunta nesta prova. Clique em "Adicionar Pergunta".</div>';
    } else {
      list.innerHTML = questions.map((q, i) => cardHtml(q, i)).join('');
    }
    const secs = questions.reduce((a, q) => a + (Number(q.time) || 20), 0);
    if ($('summary')) {
      $('summary').textContent = `${questions.length} perguntas · cerca de ${Math.ceil(secs / 60)} min de jogo`;
    }
    updateActionButtonsState();
  }

  function cardHtml(q, i) {
    const letters = ['A', 'B', 'C', 'D'];
    const opts = [0, 1, 2, 3].map(k => {
      const v = q.options[k] || '';
      return `<div class="opt-row opt-${k} ${q.correct === k ? 'is-correct' : ''}">
        <input class="radio" type="radio" name="c${i}" data-act="correct" data-i="${i}" data-k="${k}" ${q.correct === k ? 'checked' : ''} aria-label="Marcar opção ${letters[k]} como correta">
        ${shapeHtml(k)}
        <input type="text" maxlength="120" data-act="opt" data-i="${i}" data-k="${k}" value="${esc(v)}" placeholder="Opção ${letters[k]}${k > 1 ? ' (opcional)' : ''}">
        <span class="tag">CORRETA ✔</span>
      </div>`;
    }).join('');
    return `<article class="card q" id="q-${i}">
      <div class="q-head">
        <span class="q-num">Pergunta ${i + 1}</span>
        <div class="q-tools">
          <button class="mini" data-act="up" data-i="${i}" title="Mover para cima" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="mini" data-act="down" data-i="${i}" title="Mover para baixo" ${i === questions.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="mini" data-act="dup" data-i="${i}" title="Duplicar pergunta">⧉</button>
          <button class="mini del" data-act="del" data-i="${i}" title="Excluir pergunta">🗑</button>
        </div>
      </div>
      <label class="field-label" for="qt-${i}">ENUNCIADO DA PERGUNTA</label>
      <textarea id="qt-${i}" maxlength="300" data-act="text" data-i="${i}" rows="2" placeholder="Digite o enunciado da pergunta aqui...">${esc(q.text)}</textarea>
      <label class="field-label">ALTERNATIVAS (Marque a opção correta)</label>
      <div class="opts">${opts}</div>
      <div class="row2">
        <div>
          <label class="field-label" for="qs-${i}">TEMPO (SEGUNDOS)</label>
          <input id="qs-${i}" type="number" min="5" max="120" data-act="time" data-i="${i}" value="${q.time}">
        </div>
        <div>
          <label class="field-label" for="qe-${i}">EXPLICAÇÃO / DICA (Exibida após o tempo)</label>
          <input id="qe-${i}" type="text" maxlength="400" data-act="expl" data-i="${i}" value="${esc(q.explanation || '')}" placeholder="Ex.: Investir é aplicar dinheiro com expectativa de rendimento a longo prazo.">
        </div>
      </div>

      <!-- CARD DA SALA DE ESPERA (O que os alunos leem enquanto aguardam os demais) -->
      <div class="tip-card-box">
        <div class="tip-card-bar">
          <button type="button" class="btn-tip-toggle ${q.waitingTip ? 'active' : ''}" data-act="toggle-tip" data-i="${i}">
            <span class="btn-tip-icon">💡</span>
            <span class="btn-tip-title">Card da Sala de Espera (Dica do Aluno)</span>
            <span class="btn-tip-status" id="tip-status-${i}">${q.waitingTip ? 'Configurado ✔' : '+ Configurar'}</span>
          </button>
          <button type="button" class="btn-suggest-tip" data-act="suggest-tip" data-i="${i}" title="Preencher com uma dica financeira inteligente">🎲 Sugerir Dica</button>
        </div>
        <div class="tip-card-drawer ${q.waitingTip ? '' : 'collapsed'}" id="tip-drawer-${i}">
          <label class="field-label" for="qwt-${i}">TEXTO DO CARD DE ESPERA (Exibido para os alunos na tela pós-resposta)</label>
          <textarea id="qwt-${i}" maxlength="400" data-act="waitingTip" data-i="${i}" rows="2" placeholder="Ex.: Os juros compostos são considerados a 8ª maravilha do mundo: eles multiplicam seu dinheiro ao longo do tempo!">${esc(q.waitingTip || '')}</textarea>
          <div class="tip-preview-wrapper">
            <span class="tp-label">Prévia no celular do aluno:</span>
            <div class="tp-card">
              <span class="tp-icon">💡</span>
              <div class="tp-body">
                <strong>Dica do Investidor</strong>
                <p id="tip-preview-${i}">${esc(q.waitingTip || 'Adicione uma dica ou curiosidade para seus alunos lerem enquanto aguardam os outros jogadores responderem.')}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </article>`;
  }

  const FINANCIAL_TIPS = [
    "Os juros compostos são considerados a 8ª maravilha do mundo: eles multiplicam seu dinheiro ao longo do tempo!",
    "A regra básica da diversificação: nunca coloque todos os seus ovos na mesma cesta de investimentos.",
    "A reserva de emergência é o seu escudo financeiro — deve cobrir de 6 a 12 meses das suas despesas fixas.",
    "Inflação é a perda do poder de compra. Deixar dinheiro parado na conta corrente é perder dinheiro todo mês.",
    "No mercado financeiro, maior rentabilidade sempre traz maior risco. Desconfie de promessas de dinheiro fácil!",
    "O tempo é o melhor amigo do investidor: começar cedo com pouco vale mais do que começar tarde com muito.",
    "Investir não é apostar em cassino: é participar do crescimento de boas empresas e do país a longo prazo.",
    "Renda fixa traz segurança e liquidez, enquanto renda variável busca potencial de retorno no futuro.",
    "Pequenos cortes em gastos desnecessários hoje podem se transformar em um grande patrimônio amanhã.",
    "Conhecimento é o ativo mais valioso: quem estuda o mercado toma decisões muito mais seguras!"
  ];

  function markDirty() {
    dirty = true;
    updateActionButtonsState();
  }

  /* ---------- eventos ---------- */

  $('list').addEventListener('input', e => {
    const t = e.target, a = t.dataset.act, i = Number(t.dataset.i);
    if (!a) return;
    const q = questions[i];
    if (a === 'text') q.text = t.value;
    else if (a === 'opt') q.options[Number(t.dataset.k)] = t.value;
    else if (a === 'time') q.time = Number(t.value) || 20;
    else if (a === 'expl') q.explanation = t.value;
    else if (a === 'waitingTip') {
      q.waitingTip = t.value;
      const preview = $('tip-preview-' + i);
      if (preview) preview.textContent = t.value.trim() || 'Adicione uma dica ou curiosidade para seus alunos lerem enquanto aguardam os outros jogadores responderem.';
      const status = $('tip-status-' + i);
      if (status) status.textContent = t.value.trim() ? 'Configurado ✔' : '+ Configurar';
      const btn = t.closest('.tip-card-box')?.querySelector('.btn-tip-toggle');
      if (btn) btn.classList.toggle('active', !!t.value.trim());
    }
    markDirty();
  });

  $('list').addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.act === 'correct') {
      questions[Number(t.dataset.i)].correct = Number(t.dataset.k);
      markDirty();
      const card = $('q-' + t.dataset.i);
      card.querySelectorAll('.opt-row').forEach((r, k) => r.classList.toggle('is-correct', k === Number(t.dataset.k)));
    }
  });

  $('list').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const i = Number(b.dataset.i), a = b.dataset.act;
    if (a === 'up' && i > 0) [questions[i - 1], questions[i]] = [questions[i], questions[i - 1]];
    else if (a === 'down' && i < questions.length - 1) [questions[i + 1], questions[i]] = [questions[i], questions[i + 1]];
    else if (a === 'dup') questions.splice(i + 1, 0, JSON.parse(JSON.stringify(questions[i])));
    else if (a === 'del') { if (!confirm(`Excluir a pergunta ${i + 1}?`)) return; questions.splice(i, 1); }
    else if (a === 'toggle-tip') {
      const drawer = $('tip-drawer-' + i);
      if (drawer) drawer.classList.toggle('collapsed');
      return;
    }
    else if (a === 'suggest-tip') {
      const q = questions[i];
      const randomTip = FINANCIAL_TIPS[Math.floor(Math.random() * FINANCIAL_TIPS.length)];
      q.waitingTip = randomTip;
      const textarea = $('qwt-' + i);
      if (textarea) textarea.value = randomTip;
      const preview = $('tip-preview-' + i);
      if (preview) preview.textContent = randomTip;
      const status = $('tip-status-' + i);
      if (status) status.textContent = 'Configurado ✔';
      const toggleBtn = b.closest('.tip-card-bar')?.querySelector('.btn-tip-toggle');
      if (toggleBtn) toggleBtn.classList.add('active');
      const drawer = $('tip-drawer-' + i);
      if (drawer) drawer.classList.remove('collapsed');
      markDirty();
      return;
    }
    else return;
    dirty = true; render();
  });

  $('btn-add').addEventListener('click', () => {
    questions.push({ text: '', options: ['', '', '', ''], correct: 0, time: 20, explanation: '', waitingTip: '' });
    dirty = true; render();
    const el = $('qt-' + (questions.length - 1));
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus(); }
  });

  function collect() {
    return questions.map((q, n) => {
      const map = [];
      const options = [];
      q.options.forEach((o, k) => { if (String(o).trim()) { map[k] = options.length; options.push(String(o).trim()); } });
      if (!String(q.text).trim()) throw new Error(`Pergunta ${n + 1}: falta o enunciado.`);
      if (options.length < 2) throw new Error(`Pergunta ${n + 1}: preencha pelo menos 2 alternativas.`);
      if (map[q.correct] === undefined) throw new Error(`Pergunta ${n + 1}: a alternativa correta está em branco.`);
      return {
        text: q.text.trim(),
        options,
        correct: map[q.correct],
        time: Math.min(120, Math.max(5, Number(q.time) || 20)),
        explanation: (q.explanation || '').trim(),
        waitingTip: (q.waitingTip || '').trim()
      };
    });
  }

  $('btn-save').addEventListener('click', async () => {
    try {
      const payloadQuestions = collect();
      const updated = await api('PUT', `/api/quizzes/${currentQuizId}`, {
        title: currentQuizTitle || 'Sem título',
        questions: payloadQuestions
      });
      questions = updated.questions;
      currentQuizTitle = updated.title;
      quizzesList = await api('GET', '/api/quizzes');
      dirty = false;
      renderQuizzesBar();
      render();
      toast('Configurações salvas como novo padrão! ✅', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  });

  $('btn-reset').addEventListener('click', async () => {
    if (!confirm('Restaurar para as configurações salvas anteriormente nesta prova?')) return;
    try {
      const res = await api('POST', `/api/quizzes/${currentQuizId}/reset`);
      questions = res.questions;
      currentQuizTitle = res.title;
      dirty = false;
      renderQuizzesBar();
      render();
      toast('Restaurado para o padrão salvo anteriormente! ↺', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  });

  window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  if (password) enter(password); else setTimeout(() => $('password').focus(), 50);
})();
