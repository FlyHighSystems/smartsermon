/* ===== Inteligência artificial: Claude (Anthropic) e Gemini (Google), direto do navegador =====
   As chaves ficam só neste aparelho (localStorage). Nada passa por servidor nosso. */
const AI = {
  cfg() {
    let c = {}; try { c = JSON.parse(localStorage.getItem('ss-ai') || '{}'); } catch (e) { }
    return { anthropicKey: c.anthropicKey || '', geminiKey: c.geminiKey || '', claudeModel: c.claudeModel || 'claude-sonnet-5-5', geminiModel: c.geminiModel || 'gemini-flash-latest', church: c.church ?? 'Igreja evangélica; cultos de domingo e células; público misto (membros e visitantes).', syncKeys: c.syncKeys !== false, at: c.at || 0, imageModel: c.imageModel || '', hordeKey: c.hordeKey || '', pollKey: c.pollKey || '' };
  },
  /* fromCloud: veio de outro aparelho (mantém o horário original e não reenvia) */
  save(c, { fromCloud = false } = {}) {
    c = { ...c, at: fromCloud ? (c.at || 0) : Date.now() };
    try { localStorage.setItem('ss-ai', JSON.stringify(c)); } catch (e) { }
    if (!fromCloud && typeof App !== 'undefined' && App.meta) App.saveMeta();
  },
  /* O que vai para a conta: com as chaves (padrão) ou só modelos e contexto */
  cloudPayload() {
    const c = this.cfg(); if (!c.at) return null;
    return c.syncKeys ? c : { ...c, anthropicKey: '', geminiKey: '', hordeKey: '', pollKey: '' };
  },
  fromCloud(r) {
    if (!r || !r.at || r.at <= this.cfg().at) return false;
    const loc = this.cfg();
    this.save(r.syncKeys === false ? { ...r, anthropicKey: loc.anthropicKey, geminiKey: loc.geminiKey, hordeKey: loc.hordeKey, pollKey: loc.pollKey } : r, { fromCloud: true });
    return true;
  },
  has(p) { const c = this.cfg(); return p === 'claude' ? !!c.anthropicKey : p === 'gemini' ? !!c.geminiKey : !!(c.anthropicKey || c.geminiKey); },
  async claude(system, user, { maxTokens = 6000 } = {}) {
    const c = this.cfg();
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': c.anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: c.claudeModel, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('Claude: ' + (j.error?.message || ('erro ' + r.status)));
    return (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  },
  /* Modelos reserva quando o escolhido está sobrecarregado (503), sem cota (429) ou não existe (404) */
  GEMINI_FALLBACK: ['gemini-flash-latest', 'gemini-flash-lite-latest'],
  wait: ms => new Promise(r => setTimeout(r, ms)),
  async gemini(system, user, { json = true, onRetry } = {}) {
    const c = this.cfg();
    const models = [...new Set([c.geminiModel, ...this.GEMINI_FALLBACK])];
    const body = JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], ...(json ? { generationConfig: { responseMimeType: 'application/json' } } : {}) });
    let lastErr = '';
    for (const model of models) {
      for (let attempt = 0; attempt < 3; attempt++) {
        let r, j = {};
        try {
          r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': c.geminiKey, 'content-type': 'application/json' }, body });
          j = await r.json().catch(() => ({}));
        } catch (e) { lastErr = 'sem conexão'; break; }
        if (r.ok) {
          this.lastGeminiModel = model;
          const parts = j.candidates?.[0]?.content?.parts || [];
          return parts.filter(p => !p.thought && p.text).map(p => p.text).join('');
        }
        lastErr = j.error?.message || ('erro ' + r.status);
        if (r.status === 401 || r.status === 403 || r.status === 400) throw new Error('Gemini: ' + lastErr); // chave/pedido: trocar de modelo não resolve
        if (r.status === 404) break;                                   // modelo não existe: vai para o próximo
        if (r.status === 503 || r.status === 500 || r.status === 429) {
          if (attempt < 2) { onRetry && onRetry(model, attempt + 1); await this.wait(attempt ? 5000 : 2000); continue; }
          break;                                                       // insistiu 3x: tenta o modelo reserva
        }
        throw new Error('Gemini: ' + lastErr);
      }
    }
    throw new Error('Gemini (todos os modelos ocupados ou indisponíveis — tente em alguns minutos): ' + lastErr);
  },
  ask(provider, system, user, opts) { return provider === 'gemini' ? this.gemini(system, user, opts) : this.claude(system, user, opts); },
  parseJSON(t) {
    if (!t) throw new Error('Resposta vazia');
    const s = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    try { return JSON.parse(s); } catch (e) { }
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1));
    throw new Error('A IA não devolveu JSON válido');
  },
  /* Ministração em texto simples, com rótulos dos blocos */
  sermonText(s) {
    const lines = [`# ${s.title}`]; if (s.passage) lines.push(`Texto-base: ${s.passage}`); if (s.duration) lines.push(`Duração planejada: ${s.duration} min`);
    let n = 0;
    for (const b of s.blocks) {
      const t = htmlToText(b.html || '').trim();
      if (b.type === 'point') lines.push(`\n## Ponto ${++n}: ${t}`);
      else if (b.type === 'verse') lines.push(`[Versículo ${b.ref || ''}${b.verLabel ? ' (' + b.verLabel + ')' : ''}] ${t}`);
      else if (b.type === 'ink') lines.push('[Desenho à mão]');
      else if (b.type === 'image') lines.push(`[Imagem]${b.alt ? ' ' + b.alt.slice(0, 400) : ''}`);
      else if (t) lines.push(b.type === 'text' ? t : `[${BLOCK_TYPES[b.type]?.label || 'Bloco'}] ${t}`);
    }
    return lines.join('\n');
  },
  settings(after) {
    const c = this.cfg();
    const ak = el('input', { class: 'inp', type: 'password', placeholder: 'sk-ant-…', value: c.anthropicKey, autocomplete: 'off' });
    const gk = el('input', { class: 'inp', type: 'password', placeholder: 'AQ.… ou AIza…', value: c.geminiKey, autocomplete: 'off' });
    /* Campo de chave com mostrar/ocultar e trocar (limpa e foca para colar a nova) */
    const keyRow = inp => el('div', { class: 'key-row', style: { display: 'flex', gap: '6px', alignItems: 'center' } }, inp,
      el('button', { class: 'btn sm', type: 'button', title: 'Mostrar/ocultar', text: '👁', onclick: () => { inp.type = inp.type === 'password' ? 'text' : 'password'; } }),
      el('button', { class: 'btn sm', type: 'button', title: 'Apagar e colar uma nova', text: 'Trocar', onclick: () => { inp.value = ''; inp.type = 'text'; inp.focus(); } }));
    ak.style.flex = gk.style.flex = '1';
    const cm = el('input', { class: 'inp', value: c.claudeModel }), gm = el('input', { class: 'inp', value: c.geminiModel }), im = el('input', { class: 'inp', value: c.imageModel, placeholder: 'automático (Nano Banana 2 → Nano Banana)' }), hk = el('input', { class: 'inp', type: 'password', value: c.hordeKey, placeholder: 'opcional — sem chave usa a anônima (fila mais lenta)', autocomplete: 'off' }), pk = el('input', { class: 'inp', type: 'password', value: c.pollKey, placeholder: 'opcional — pk_… (sem chave: ~1 imagem a cada 15 s)', autocomplete: 'off' });
    pk.style.flex = hk.style.flex = '1';
    const ch = el('textarea', { class: 'inp', rows: 2 }); ch.value = c.church;
    const sk = el('input', { type: 'checkbox', checked: c.syncKeys });
    const out = el('p', { class: 'small' });
    const val = () => ({ anthropicKey: ak.value.trim(), geminiKey: gk.value.trim(), claudeModel: cm.value.trim() || 'claude-sonnet-5-5', geminiModel: gm.value.trim() || 'gemini-flash-latest', church: ch.value.trim(), syncKeys: sk.checked, imageModel: im.value.trim(), hordeKey: hk.value.trim(), pollKey: pk.value.trim() });
    const body = el('div', { class: 'ai-set' },
      el('p', { class: 'muted', html: 'As chamadas vão direto daqui para a Anthropic e o Google. Cada análise custa centavos (cobrança na sua conta de cada serviço). Você pode usar só uma das duas.' }),
      el('label', { class: 'lbl', text: 'Chave da API do Claude (console.anthropic.com › API Keys)' }), keyRow(ak),
      el('label', { class: 'lbl', text: 'Chave da API do Gemini (aistudio.google.com › Get API key)' }), keyRow(gk),
      el('h4', { class: 'ai-sec', text: '🖼 Imagens do telão (opcionais — melhoram a fila e os limites)' }),
      el('label', { class: 'lbl', text: 'Chave do Pollinations (grátis em enter.pollinations.ai — use a publicável pk_…)' }), keyRow(pk),
      el('label', { class: 'lbl', text: 'Chave do AI Horde (grátis em aihorde.net/register — dá prioridade na fila)' }), keyRow(hk),
      el('details', {}, el('summary', { text: 'Modelos e contexto' }),
        el('label', { class: 'lbl', text: 'Modelo do Claude' }), cm,
        el('label', { class: 'lbl', text: 'Modelo do Gemini' }), gm,
        el('label', { class: 'lbl', text: 'Modelo de imagem do Gemini (fundos do telão)' }), im,
        el('label', { class: 'lbl', text: 'Contexto da sua igreja (ajuda a IA a calibrar a revisão)' }), ch),
      el('label', { class: 'lbl', style: { display: 'flex', gap: '8px', alignItems: 'center', fontWeight: 'normal' } }, sk,
        el('span', { html: 'Guardar as chaves na minha conta e usar em <b>todos os meus aparelhos</b> (precisa estar logado na nuvem). Desmarcado: ficam só neste aparelho.' })),
      out);
    UI.modal({ title: 'Inteligência artificial', body, wide: true, actions: [
      { label: 'Testar', onClick: async () => {
        this.save(val()); out.textContent = 'Testando…'; const res = [];
        if (this.has('claude')) try { await this.claude('Responda só: ok', 'teste', { maxTokens: 10 }); res.push('Claude ✓'); } catch (e) { res.push('Claude ✗ ' + e.message); }
        if (this.has('gemini')) try {
          await this.gemini('Responda só: ok', 'teste', { json: false, onRetry: (m, n) => { out.textContent = `Gemini ocupado (${m}) — tentando de novo (${n})…`; } });
          res.push('Gemini ✓' + (this.lastGeminiModel !== val().geminiModel ? ` (respondeu pelo reserva ${this.lastGeminiModel})` : ''));
        } catch (e) { res.push('Gemini ✗ ' + e.message); }
        out.textContent = res.join(' · ') || 'Informe pelo menos uma chave.'; return false;
      } },
      { label: 'Salvar', primary: true, onClick: () => { this.save(val()); UI.toast('Configuração de IA salva'); after && after(); } }] });
  }
};

/* ===== Checagem de referências (por código, sem IA) ===== */
async function checkReferences(s) {
  const out = [];
  const ver = Bible.current(); const books = ver ? await Bible.load(ver) : null;
  const words = t => new Set(stripAccents(t.toLowerCase()).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3));
  const seen = new Set();
  const check = async (raw, where, text) => {
    const r = parseRef(raw); if (!r) return;
    const key = refLabel(r) + '|' + where; if (seen.has(key)) return; seen.add(key);
    if (!books) { out.push({ ref: refLabel(r), where, status: 'skip', msg: 'Baixe uma Bíblia para conferir.' }); return; }
    const bk = books[r.book - 1];
    if (!bk) { out.push({ ref: refLabel(r), where, status: 'warn', msg: 'Livro não está nesta versão.' }); return; }
    if (r.ch > bk.length) { out.push({ ref: refLabel(r), where, status: 'error', msg: `${BOOKS[r.book - 1].name} tem só ${bk.length} capítulos.` }); return; }
    const max = bk[r.ch - 1].length;
    const bad = r.ranges.find(([a, z]) => a > max || z > max || a < 1 || z < a);
    if (bad) { out.push({ ref: refLabel(r), where, status: 'error', msg: `${BOOKS[r.book - 1].name} ${r.ch} tem só ${max} versículos.` }); return; }
    if (text && text.length > 25 && r.ranges.length) {
      const res = await Bible.lookup(r, ver); const a = words(text), b = words(res.verses.map(v => v[1]).join(' '));
      const inter = [...a].filter(w => b.has(w)).length; const sim = inter / Math.max(1, Math.min(a.size, b.size));
      if (sim < 0.3) { out.push({ ref: refLabel(r), where, status: 'warn', msg: `O texto citado não parece ser desta referência (semelhança ${Math.round(sim * 100)}% com a ${Bible.info(ver).short}). Confira — pode ser só outra tradução.` }); return; }
    }
    out.push({ ref: refLabel(r), where, status: 'ok', msg: 'Referência válida.' });
  };
  if (s.passage) for (const p of s.passage.split(/;/)) await check(p.trim(), 'Texto-base');
  let n = 0;
  for (const b of s.blocks) {
    if (b.type === 'point') n++;
    const where = n ? `Ponto ${n}` : 'Introdução';
    if (b.type === 'verse' && b.ref) await check(b.ref, where, htmlToText(b.html || '').replace(/\b\d{1,3}\b/g, ' '));
    const t = htmlToText(b.html || ''); REF_IN_TEXT.lastIndex = 0; let m;
    while ((m = REF_IN_TEXT.exec(t))) await check(m[0], where);
  }
  return out;
}

/* ===== Revisão do sermão ===== */
const REVIEW_CRITERIA = [
  ['texto', 'Fidelidade ao texto bíblico'], ['contexto', 'Contexto histórico e literário'], ['estrutura', 'Estrutura e progressão'],
  ['aplicacao', 'Aplicação prática'], ['ilustracoes', 'Ilustrações'], ['clareza', 'Clareza para o público'], ['conclusao', 'Conclusão e apelo']
];
const Review = {
  system() {
    return `Você é um revisor homilético experiente, com formação em exegese bíblica (hebraico e grego), teologia e comunicação. Você ajuda um pastor a MELHORAR o próprio sermão — você não reescreve o sermão por ele.
Contexto da igreja: ${AI.cfg().church}
Regras:
- Seja honesto e específico; aponte problemas reais (eisegese, texto fora de contexto, afirmações históricas duvidosas, saltos lógicos, aplicações vagas). Elogios só quando merecidos.
- Respeite a tradição evangélica do pastor; quando houver divergência teológica legítima entre tradições, diga isso em vez de tratar como erro.
- Nunca invente versículos nem citações. Cite referências, não textos longos.
- Escreva em português do Brasil.
Responda SOMENTE com JSON válido neste formato:
{"resumo":"2-3 frases sobre a mensagem central e a impressão geral",
 "criterios":[${REVIEW_CRITERIA.map(([id]) => `{"id":"${id}","nota":0,"comentario":"","sugestao":""}`).join(',')}],
 "pontos_fortes":["..."],
 "riscos":[{"trecho":"citação curta do sermão","problema":"...","sugestao":"..."}],
 "perguntas_ouvinte_cetico":["perguntas que um ouvinte crítico faria"],
 "melhorias_prioritarias":["as 3 mudanças que mais melhorariam o sermão"]}
Notas de 0 a 10.`;
  },
  async run(s, providers, onStep) {
    const text = AI.sermonText(s);
    const user = `Revise este sermão:\n\n${text}`;
    const tasks = providers.map(async p => {
      onStep && onStep(p, 'run');
      try { const r = AI.parseJSON(await AI.ask(p, this.system(), user)); onStep && onStep(p, 'ok'); return [p, { ok: true, data: r }]; }
      catch (e) { onStep && onStep(p, 'err'); return [p, { ok: false, error: e.message }]; }
    });
    const refs = await checkReferences(s);
    const results = Object.fromEntries(await Promise.all(tasks));
    const rev = { at: Date.now(), providers, refs, results, models: { claude: AI.cfg().claudeModel, gemini: AI.cfg().geminiModel } };
    (s.reviews ||= []).unshift(rev); s.reviews = s.reviews.slice(0, 10); App.touch(s);
    return rev;
  },
  open(s) {
    const body = el('div', { class: 'rv' });
    const m = UI.modal({ title: 'Revisão do sermão', body, wide: true });
    m.box.classList.add('xl');
    const start = () => {
      body.innerHTML = '';
      const cl = el('input', { type: 'checkbox', checked: AI.has('claude'), disabled: !AI.has('claude') });
      const gm = el('input', { type: 'checkbox', checked: AI.has('gemini'), disabled: !AI.has('gemini') });
      body.append(
        el('p', { text: 'A revisão olha fidelidade ao texto, contexto, estrutura, aplicação, ilustrações, clareza e conclusão. Com as duas IAs, você vê onde elas concordam — e principalmente onde DISCORDAM, que é onde vale pensar.' }),
        el('div', { class: 'row-btns', style: { flexWrap: 'wrap', alignItems: 'center' } },
          el('label', { class: 'on-check' }, cl, ' Claude'), el('label', { class: 'on-check' }, gm, ' Gemini'),
          el('button', { class: 'btn link', text: '⚙ Chaves e modelos', onclick: () => AI.settings(() => { m.close(); this.open(s); }) })),
        !AI.has() ? el('p', { class: 'on-log', text: 'Configure pelo menos uma chave (Claude ou Gemini) em ⚙ Chaves e modelos.' }) : null,
        el('p', { class: 'muted small', text: 'A checagem das referências bíblicas é feita pelo próprio app, sem IA, contra a Bíblia baixada.' }),
        el('div', { class: 'row-btns' },
          el('button', { class: 'btn primary', text: '✦ Revisar agora', onclick: async () => {
            const prov = [cl.checked && 'claude', gm.checked && 'gemini'].filter(Boolean);
            body.innerHTML = ''; const st = el('div', { class: 'rv-steps' });
            const line = (p, t) => { let e = st.querySelector(`[data-p="${p}"]`); if (!e) { e = el('div', { 'data-p': p }); st.append(e); } e.textContent = t; };
            body.append(el('p', { text: 'Analisando… (costuma levar de 20 a 60 segundos)' }), st);
            prov.forEach(p => line(p, `${p === 'claude' ? 'Claude' : 'Gemini'}: aguardando…`)); line('refs', 'Referências: conferindo…');
            const rev = await this.run(s, prov, (p, k) => line(p, `${p === 'claude' ? 'Claude' : 'Gemini'}: ${k === 'run' ? 'analisando…' : k === 'ok' ? 'pronto ✓' : 'erro ✗'}`));
            this.render(body, rev, s, start);
          } }),
          s.reviews?.length ? el('button', { class: 'btn', text: `Ver última revisão (${new Date(s.reviews[0].at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })})`, onclick: () => this.render(body, s.reviews[0], s, start) }) : null));
    };
    start();
  },
  render(body, rev, s, back) {
    body.innerHTML = '';
    const P = rev.providers, R = rev.results;
    const name = p => p === 'claude' ? 'Claude' : 'Gemini';
    body.append(el('div', { class: 'row-btns', style: { justifyContent: 'space-between' } },
      el('span', { class: 'muted small', text: `Revisão de ${new Date(rev.at).toLocaleString('pt-BR')}` }),
      el('button', { class: 'btn sm', text: '↻ Nova revisão', onclick: back })));
    for (const p of P) if (!R[p]?.ok) body.append(el('p', { class: 'on-log', text: `⚠ ${name(p)}: ${R[p]?.error || 'falhou'}` }));
    const ok = P.filter(p => R[p]?.ok);
    // Resumo
    for (const p of ok) if (R[p].data.resumo) body.append(el('div', { class: 'rv-sum' }, el('b', { text: name(p) + ': ' }), R[p].data.resumo));
    // Referências
    const refs = rev.refs || []; const probs = refs.filter(r => r.status !== 'ok');
    body.append(el('h4', { text: `Referências bíblicas (${refs.length} conferidas${probs.length ? ', ' + probs.length + ' para revisar' : ', todas certas'})` }));
    if (probs.length) body.append(el('ul', { class: 'rv-refs' }, probs.map(r => el('li', { class: 'rv-' + r.status }, el('b', { text: `${r.ref} ` }), el('span', { class: 'muted', text: `(${r.where}) ` }), r.msg))));
    // Critérios lado a lado
    if (ok.length) {
      const tbl = el('table', { class: 'rv-tbl' });
      tbl.append(el('tr', {}, el('th', { text: 'Critério' }), ...ok.map(p => el('th', { text: name(p) }))));
      for (const [id, label] of REVIEW_CRITERIA) {
        const cells = ok.map(p => (R[p].data.criterios || []).find(c => c.id === id) || {});
        const notas = cells.map(c => +c.nota).filter(n => !isNaN(n));
        const diverge = notas.length === 2 && Math.abs(notas[0] - notas[1]) >= 3;
        tbl.append(el('tr', { class: diverge ? 'rv-div' : '' },
          el('td', {}, el('b', { text: label }), diverge ? el('div', { class: 'rv-flag', text: '⚠ as IAs discordam — vale pensar aqui' }) : null),
          ...cells.map(c => el('td', {}, el('span', { class: 'rv-nota n' + Math.round((+c.nota || 0) / 2.5), text: c.nota ?? '–' }), el('div', { text: c.comentario || '' }), c.sugestao ? el('div', { class: 'rv-sug', text: '→ ' + c.sugestao }) : null))));
      }
      body.append(el('h4', { text: 'Avaliação por critério' }), tbl);
      const list = (key, title, fmt) => {
        const items = ok.flatMap(p => (R[p].data[key] || []).map(x => [p, x])); if (!items.length) return;
        body.append(el('h4', { text: title }), el('ul', { class: 'rv-list' }, items.map(([p, x]) => el('li', {}, el('span', { class: 'pill', text: name(p) }), ' ', fmt(x)))));
      };
      list('melhorias_prioritarias', 'O que mais melhoraria o sermão', x => x);
      list('riscos', 'Pontos de atenção', x => el('span', {}, x.trecho ? el('i', { text: `“${x.trecho}” — ` }) : null, x.problema || '', x.sugestao ? el('div', { class: 'rv-sug', text: '→ ' + x.sugestao }) : null));
      list('pontos_fortes', 'Pontos fortes', x => x);
      list('perguntas_ouvinte_cetico', 'Perguntas de um ouvinte crítico', x => x);
    }
    body.append(el('p', { class: 'muted small', text: 'IAs erram. Use como segunda opinião: a última palavra sobre a mensagem é sua (e do Espírito Santo).' }));
  }
};
