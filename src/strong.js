/* ===== Estudo de palavras: hebraico/grego com números de Strong =====
   Fontes (baixadas no aparelho na primeira vez e guardadas para uso offline):
   - Léxico de Strong (domínio público) — Open Scriptures: github.com/openscriptures/strongs
   - AT hebraico com Strong por palavra — Open Scriptures Hebrew Bible (WLC, CC BY 4.0): github.com/openscriptures/morphhb
   - NT grego — SBLGNT com morfologia MorphGNT (CC BY-SA): github.com/morphgnt/sblgnt  (Strong ligado pelo lema) */
const RAW = 'https://raw.githubusercontent.com/';
const STRONG_SRC = {
  lexG: RAW + 'openscriptures/strongs/master/greek/strongs-greek-dictionary.js',
  lexH: RAW + 'openscriptures/strongs/master/hebrew/strongs-hebrew-dictionary.js',
  hb: osis => RAW + `openscriptures/morphhb/master/wlc/${osis}.xml`,
  gnt: file => RAW + `morphgnt/sblgnt/master/${file}-morphgnt.txt`
};
const GNT_FILES = ['61-Mt', '62-Mk', '63-Lk', '64-Jn', '65-Ac', '66-Ro', '67-1Co', '68-2Co', '69-Ga', '70-Eph', '71-Php', '72-Col', '73-1Th', '74-2Th', '75-1Ti', '76-2Ti', '77-Tit', '78-Phm', '79-Heb', '80-Jas', '81-1Pe', '82-2Pe', '83-1Jn', '84-2Jn', '85-3Jn', '86-Jud', '87-Re'];
const greekKey = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ς/g, 'σ').replace(/[^Ͱ-Ͽἀ-῿]/g, '');

const Strong = {
  mem: {},
  async getText(url, onP) {
    const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status + ' em ' + url.split('/').slice(-1)[0]);
    return r.text();
  },
  /* ---------- léxico ---------- */
  async lexicon(lang) { // 'G' | 'H'
    const key = 'lex:' + lang; if (this.mem[key]) return this.mem[key];
    let d = await DB.get('kv', key);
    if (!d) {
      const t = await this.getText(lang === 'G' ? STRONG_SRC.lexG : STRONG_SRC.lexH);
      const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a < 0 || b < a) throw new Error('Léxico em formato inesperado');
      d = JSON.parse(t.slice(a, b + 1)); await DB.put('kv', key, d);
    }
    this.mem[key] = d;
    if (lang === 'G' && !this.mem.gIndex) { const idx = {}; for (const [k, v] of Object.entries(d)) { const n = greekKey(v.lemma); if (n && !idx[n]) idx[n] = k; } this.mem.gIndex = idx; }
    return d;
  },
  entry(num) { const lex = this.mem['lex:' + num[0]]; return lex ? (lex[num] || lex[num[0] + parseInt(num.slice(1), 10)]) : null; },
  /* ---------- textos originais (por livro) ---------- */
  async book(bookId, onP) {
    const key = 'orig:' + bookId; if (this.mem[key]) return this.mem[key];
    let d = await DB.get('kv', key);
    if (!d) {
      const b = BOOKS[bookId - 1];
      onP && onP(`Baixando ${bookId <= 39 ? 'hebraico' : 'grego'}: ${b.name}…`);
      d = bookId <= 39 ? this.parseHebrew(await this.getText(STRONG_SRC.hb(b.osis))) : this.parseGreek(await this.getText(STRONG_SRC.gnt(GNT_FILES[bookId - 40])));
      if (!Object.keys(d).length) throw new Error('Arquivo do texto original em formato inesperado');
      await DB.put('kv', key, d);
    }
    this.mem[key] = d; return d;
  },
  parseHebrew(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml'); const out = {};
    for (const v of doc.getElementsByTagNameNS('*', 'verse')) {
      const id = (v.getAttribute('osisID') || '').split('.'); if (id.length < 3) continue;
      const words = [];
      for (const w of v.getElementsByTagNameNS('*', 'w')) {
        const lemma = w.getAttribute('lemma') || '';
        const nums = lemma.split(/[\/\s]/).filter(x => /^\d/.test(x)).map(x => 'H' + parseInt(x, 10));
        words.push([w.textContent.replace(/\//g, ''), nums.join(' '), w.getAttribute('morph') || '']);
      }
      out[`${+id[1]}:${+id[2]}`] = words;
    }
    return out;
  },
  parseGreek(txt) {
    const out = {};
    for (const line of txt.split('\n')) {
      const f = line.trim().split(/\s+/); if (f.length < 7 || !/^\d{6}$/.test(f[0])) continue;
      const k = `${+f[0].slice(2, 4)}:${+f[0].slice(4, 6)}`;
      (out[k] ||= []).push([f[3], f[6], (f[1] + ' ' + f[2]).trim()]); // texto, lema, morfologia
    }
    return out;
  },
  /* Palavras de um versículo: [{orig, strong, lemma, translit, gloss, morph}] */
  async verse(bookId, ch, v, onP) {
    const lang = bookId <= 39 ? 'H' : 'G';
    await this.lexicon(lang); const bk = await this.book(bookId, onP);
    const raw = bk[`${ch}:${v}`]; if (!raw) return null;
    return raw.map(([orig, x, morph]) => {
      let strong = '';
      if (lang === 'H') strong = (x || '').split(' ').filter(Boolean).pop() || '';
      else { const I = this.mem.gIndex; strong = I[greekKey(x)] || I[greekKey(String(x).replace(/\([^)]*\)/g, ''))] || I[greekKey(String(x).replace(/[()]/g, ''))] || ''; } // ex.: οὕτω(ς)
      const e = strong ? this.entry(strong) : null;
      return { orig, strong, lemma: e?.lemma || (lang === 'G' ? x : ''), translit: e?.translit || e?.xlit || '', gloss: (e?.kjv_def || '').replace(/[.;].*$/, '').slice(0, 40), morph, lang };
    });
  }
};

/* ===== Painel de estudo ===== */
const StrongUI = {
  async open(ref) {
    const r = typeof ref === 'string' ? parseRef(ref) : ref;
    if (!r) return UI.toast('Referência não reconhecida');
    const v = r.ranges?.[0]?.[0] || 1;
    this.state = { book: r.book, ch: r.ch, v, sel: null, align: null };
    const body = el('div', { class: 'st' });
    this.m = UI.modal({ title: 'Estudo das palavras (Strong)', body, wide: true }); this.m.box.classList.add('xl');
    this.body = body; this.render();
  },
  go(d) {
    const s = this.state; let { book, ch, v } = s; v += d;
    const books = Bible.cache[Bible.current()];
    const maxV = books?.[book - 1]?.[ch - 1]?.length || 200;
    if (v < 1) { if (ch > 1) { ch--; v = books?.[book - 1]?.[ch - 1]?.length || 1; } else v = 1; }
    else if (v > maxV) { const maxC = books?.[book - 1]?.length || ch; if (ch < maxC) { ch++; v = 1; } else v = maxV; }
    Object.assign(s, { ch, v, sel: null, align: null }); this.render();
  },
  async render() {
    const s = this.state, B = this.body; B.innerHTML = '';
    const label = `${BOOKS[s.book - 1].name} ${s.ch}:${s.v}`;
    const status = el('p', { class: 'muted', text: 'Carregando…' });
    B.append(el('div', { class: 'st-head' },
      el('button', { class: 'btn sm', text: '‹', title: 'Versículo anterior', onclick: () => this.go(-1) }),
      el('h3', { text: label }),
      el('button', { class: 'btn sm', text: '›', title: 'Próximo versículo', onclick: () => this.go(1) })), status);
    // texto em português
    const pt = await Bible.lookup({ book: s.book, ch: s.ch, ranges: [[s.v, s.v]] });
    const ptBox = el('div', { class: 'st-pt' }); ptBox.textContent = pt.error ? '(Baixe uma Bíblia em português para ver o texto aqui.)' : pt.verses[0][1];
    let words = null, err = null;
    try { words = await Strong.verse(s.book, s.ch, s.v, msg => status.textContent = msg); } catch (e) { err = e; }
    status.remove();
    B.append(el('div', { class: 'st-sub muted small', text: pt.error ? '' : `${Bible.info(pt.version)?.short || ''}` }), ptBox);
    if (!words) {
      B.append(el('div', { class: 'on-log', text: err ? `Não consegui carregar o texto original: ${err.message}` : 'Versículo não encontrado no texto original (a numeração pode ser diferente — comum em Salmos).' }),
        el('p', { class: 'muted small', text: 'Verifique a internet na primeira vez (os dados ficam guardados depois). Você também pode pedir à IA uma análise, que será marcada como não verificada.' }),
        AI.has() ? el('button', { class: 'btn', text: '✦ Analisar as palavras originais com IA', onclick: () => this.aiInterlinear(label, ptBox.textContent) }) : null);
      return;
    }
    this.words = words;
    const lang = words[0]?.lang;
    // linha do original
    B.append(el('div', { class: 'st-orig ' + (lang === 'H' ? 'he' : 'gr'), dir: lang === 'H' ? 'rtl' : 'ltr', text: words.map(w => w.orig).join(' ') }));
    // palavras
    const grid = el('div', { class: 'st-grid', dir: lang === 'H' ? 'rtl' : 'ltr' });
    words.forEach((w, i) => grid.append(el('button', { class: 'st-w' + (s.sel === i ? ' on' : ''), 'data-i': i, onclick: () => { s.sel = i; this.detail(); $$('.st-w', grid).forEach(x => x.classList.toggle('on', +x.dataset.i === i)); this.highlight(i); } },
      el('span', { class: 'st-o ' + (lang === 'H' ? 'he' : 'gr'), text: w.orig }),
      el('span', { class: 'st-tr', text: w.translit }),
      el('span', { class: 'st-n', text: w.strong || '—' }),
      el('span', { class: 'st-g', text: w.gloss }))));
    B.append(el('h4', { text: 'Palavras do texto original' }), grid);
    // alinhamento com o português
    const alignBox = el('div', { class: 'st-align' });
    B.append(el('div', { class: 'row-btns', style: { marginTop: '10px', flexWrap: 'wrap' } },
      AI.has() ? el('button', { class: 'btn', text: '✦ Ligar cada palavra ao português (IA)', onclick: e => this.align(e.target, ptBox, pt) }) : el('button', { class: 'btn link', text: 'Configure a IA para ligar as palavras ao português', onclick: () => AI.settings(() => this.render()) })), alignBox);
    this.ptBox = ptBox;
    const cached = !pt.error && await DB.get('kv', `align:${pt.version}:${s.book}:${s.ch}:${s.v}`);
    if (cached) this.paintAlign(cached, ptBox);
    this.det = el('div', { class: 'st-det' }); B.append(this.det);
    if (s.sel != null) this.detail();
    B.append(el('p', { class: 'muted small st-cred', html: lang === 'H'
      ? 'Hebraico: Open Scriptures Hebrew Bible (WLC, CC BY 4.0). Léxico: Strong (domínio público).'
      : 'Grego: SBLGNT/MorphGNT. Número de Strong ligado pelo lema (pode haver casos ambíguos). Léxico: Strong (domínio público).' }));
  },
  detail() {
    const w = this.words[this.state.sel]; const d = this.det; d.innerHTML = '';
    const e = w.strong ? Strong.entry(w.strong) : null;
    d.append(el('div', { class: 'st-dh' }, el('span', { class: 'st-big ' + (w.lang === 'H' ? 'he' : 'gr'), text: e?.lemma || w.lemma || w.orig }),
      el('div', {}, el('b', { text: w.strong || 'sem número' }), el('div', { class: 'muted', text: [e?.translit || e?.xlit, e?.pron ? `(${e.pron})` : ''].filter(Boolean).join(' ') }), w.morph ? el('div', { class: 'muted small', text: 'Morfologia: ' + w.morph }) : null)));
    if (e) {
      if (e.strongs_def) d.append(el('p', {}, el('b', { text: 'Definição (Strong): ' }), e.strongs_def));
      if (e.kjv_def) d.append(el('p', {}, el('b', { text: 'Traduções na KJV: ' }), e.kjv_def));
      if (e.derivation) d.append(el('p', { class: 'muted small' }, el('b', { text: 'Origem: ' }), e.derivation));
    }
    const out = el('div', { class: 'st-ai' });
    d.append(AI.has() ? el('button', { class: 'btn primary', text: '✦ Explicar esta palavra em português', onclick: async ev => {
      ev.target.disabled = true; ev.target.textContent = 'Pensando…';
      const key = `wexp:${w.strong}:${this.state.book}:${this.state.ch}:${this.state.v}`;
      try {
        let t = await DB.get('kv', key);
        if (!t) {
          t = await AI.ask(AI.has('claude') ? 'claude' : 'gemini',
            'Você é professor de grego e hebraico bíblico. Explique em português do Brasil, de forma clara para um pastor preparar uma pregação: (1) significado básico do termo; (2) nuances e campo semântico; (3) o sentido NESTE versículo; (4) outras passagens importantes onde o termo aparece (só referências); (5) cuidado com interpretações exageradas, se houver. Use o léxico fornecido como base; não invente etimologias. Até 250 palavras, em tópicos curtos.',
            `Versículo: ${BOOKS[this.state.book - 1].name} ${this.state.ch}:${this.state.v}\nTexto em português: ${this.ptBox.textContent}\nPalavra original: ${w.orig} — lema ${e?.lemma || w.lemma} (${w.strong}), transliteração ${e?.translit || e?.xlit || ''}, morfologia ${w.morph}\nLéxico de Strong: ${e?.strongs_def || ''} | KJV: ${e?.kjv_def || ''} | Origem: ${e?.derivation || ''}`, { json: false, maxTokens: 1500 });
          await DB.put('kv', key, t);
        }
        out.innerHTML = ''; out.append(el('div', { class: 'st-exp', html: esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>') }));
      } catch (er) { UI.toast(er.message); }
      ev.target.remove();
    } }) : null, out);
  },
  async align(btn, ptBox, pt) {
    if (pt.error) return UI.toast('Baixe uma Bíblia em português primeiro');
    btn.disabled = true; btn.textContent = 'Ligando…';
    try {
      const list = this.words.map((w, i) => `${i}: ${w.orig} (${w.strong || '?'} — ${w.gloss})`).join('\n');
      const r = AI.parseJSON(await AI.ask(AI.has('claude') ? 'claude' : 'gemini',
        'Alinhe palavras de uma tradução portuguesa da Bíblia com as palavras do texto original. Responda SOMENTE JSON: {"pares":[{"pt":"trecho exato copiado do texto português (1 a 4 palavras)","idx":[índices das palavras originais]}]}. Use trechos que existam literalmente no texto português, na ordem em que aparecem. Palavras sem correspondência podem ficar de fora.',
        `Texto português: ${pt.verses[0][1]}\n\nPalavras originais (índice: palavra (Strong — sentido)):\n${list}`, { maxTokens: 2000 }));
      const data = { pares: (r.pares || []).filter(p => p.pt && Array.isArray(p.idx)) };
      await DB.put('kv', `align:${pt.version}:${this.state.book}:${this.state.ch}:${this.state.v}`, data);
      this.paintAlign(data, ptBox); btn.remove();
    } catch (e) { UI.toast(e.message); btn.disabled = false; btn.textContent = '✦ Ligar cada palavra ao português (IA)'; }
  },
  paintAlign(data, ptBox) {
    let text = ptBox.textContent, html = '', pos = 0;
    const lower = stripAccents(text.toLowerCase());
    for (const p of data.pares) {
      const i = lower.indexOf(stripAccents(p.pt.toLowerCase()), pos); if (i < 0) continue;
      html += esc(text.slice(pos, i)) + `<span class="st-link" data-idx="${p.idx.join(',')}" title="${esc(p.idx.map(k => this.words[k]?.strong).filter(Boolean).join(' '))}">${esc(text.slice(i, i + p.pt.length))}<sup>${esc(p.idx.map(k => this.words[k]?.strong).filter(Boolean).join(' '))}</sup></span>`;
      pos = i + p.pt.length;
    }
    html += esc(text.slice(pos)); ptBox.innerHTML = html;
    $$('.st-link', ptBox).forEach(s => s.onclick = () => { const k = +s.dataset.idx.split(',')[0]; this.state.sel = k; this.detail(); $$('.st-w').forEach(x => x.classList.toggle('on', +x.dataset.i === k)); this.highlight(k); });
    ptBox.classList.add('aligned');
  },
  highlight(i) { $$('.st-link').forEach(s => s.classList.toggle('on', s.dataset.idx.split(',').map(Number).includes(i))); },
  async aiInterlinear(label, ptText) {
    const d = el('div', { class: 'st-ai' }, el('p', { class: 'muted', text: 'Gerando análise com IA…' })); this.body.append(d);
    try {
      const r = AI.parseJSON(await AI.ask(AI.has('claude') ? 'claude' : 'gemini', 'Você é especialista em hebraico e grego bíblico. Para o versículo pedido, liste as palavras do texto original (hebraico massorético ou grego NA28/SBLGNT) em ordem. Responda SOMENTE JSON: {"palavras":[{"original":"","transliteracao":"","strong":"G1234 ou H1234","sentido":"em português"}]}. Se não tiver certeza de um número de Strong, deixe vazio.', `${label}\nTradução: ${ptText}`, { maxTokens: 3000 }));
      d.innerHTML = ''; d.append(el('p', { class: 'on-log', text: '⚠ Gerado por IA, não verificado contra o texto original. Confira antes de pregar.' }),
        el('div', { class: 'st-grid' }, (r.palavras || []).map(w => el('div', { class: 'st-w' }, el('span', { class: 'st-o', text: w.original }), el('span', { class: 'st-tr', text: w.transliteracao }), el('span', { class: 'st-n', text: w.strong || '—' }), el('span', { class: 'st-g', text: w.sentido })))));
    } catch (e) { d.innerHTML = ''; d.append(el('p', { class: 'on-log', text: e.message })); }
  }
};
