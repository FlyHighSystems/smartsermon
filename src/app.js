/* ===== Estado, navegação (cadernos/seções/páginas) e editor ===== */
const BLOCK_TYPES = {
  point: { label: 'Ponto', ph: 'Título do ponto' },
  text: { label: 'Texto', ph: 'Escreva aqui… (cole do OneNote, Word etc.)' },
  verse: { label: 'Versículo', ph: 'Texto do versículo' },
  illus: { label: 'Ilustração', ph: 'Conte a ilustração…' },
  app: { label: 'Aplicação', ph: 'Como isso se aplica à vida da igreja?' },
  quote: { label: 'Frase-chave', ph: 'A frase que a igreja deve levar para casa' },
  intro: { label: 'Introdução', ph: 'Como você vai abrir a mensagem? (gancho, história, pergunta)' },
  concl: { label: 'Conclusão', ph: 'Fechamento, apelo, oração final' },
  ink: { label: 'Desenho' },
  image: { label: 'Imagem' },
};
/* Blocos de destaque (com rótulo e cor). Inclui os tipos criados pelo usuário. */
const CALLOUTS = ['intro', 'illus', 'app', 'quote', 'concl'];
const CALLOUT_COLORS = { intro: '#4f6bed', illus: '#c25e00', app: '#107c10', quote: '#008575', concl: '#b4009e' };
const isCallout = t => CALLOUTS.includes(t) || String(t).startsWith('c_');
const blockColor = t => CALLOUT_COLORS[t] || (App.meta?.customTypes || []).find(c => c.id === t)?.color || '#8a8886';
const TEXT_TYPES = () => ['point', 'text', ...CALLOUTS, ...(App.meta?.customTypes || []).map(c => c.id)];
function registerCustomTypes() {
  for (const k of Object.keys(BLOCK_TYPES)) if (k.startsWith('c_')) delete BLOCK_TYPES[k];
  for (const c of App.meta.customTypes || []) BLOCK_TYPES[c.id] = { label: c.label, ph: c.ph || 'Escreva aqui…' };
}
const SECTION_COLORS = ['#7719aa', '#0f6cbd', '#c239b3', '#107c10', '#c25e00', '#008575', '#b4009e', '#4f6bed', '#986f0b', '#a4262c'];

const App = {
  meta: null, sermons: new Map(), cur: null, focusId: null, inkSurfaces: [], lastInk: null, scroller: null,
  ink: { tool: 'pen', color: '#1b1b1b', hlColor: '#ffd400', size: 2.2, finger: false },

  async init() {
    await DB.init();
    this.meta = (await DB.get('kv', 'meta')) || this.seedMeta();
    for (const s of await DB.all('sermons')) this.sermons.set(s.id, s);
    if (!this.sermons.size) { const w = welcomeSermon(this.meta.sections[0].id); this.sermons.set(w.id, w); await DB.put('sermons', w.id, w); this.meta.currentSermon = w.id; }
    await this.saveMeta();
    this.scroller = $('#editor');
    this.meta.customTypes ||= []; registerCustomTypes();
    Theme.init(); Ribbon.bind(); BiblePane.bind(); this.bindNav();
    await Bible.init();
    this.renderNav();
    await Cloud.init();
    const first = this.sermons.get(this.meta.currentSermon) || this.sectionSermons(this.meta.currentSec)[0] || [...this.sermons.values()][0];
    first ? this.open(first.id) : this.renderEditor();
    if (DB.volatile) UI.toast('Atenção: armazenamento local indisponível aqui. Faça backup (Exportar › Backup).');
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); this.flush(); UI.toast('Salvo'); }
      if (e.key === 'F5' && !Reader.active) { e.preventDefault(); Reader.open(this.cur); }
      const inText = e.target.closest && e.target.closest('[contenteditable], input, textarea, select');
      if (this.cur && !Reader.active && e.ctrlKey && e.altKey && (e.key === ']' || e.key === '[')) { e.preventDefault(); this.indentPage(this.cur.id, e.key === ']' ? 1 : -1); }
      if (this.cur && !Reader.active && !inText && e.altKey && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); this.movePage(this.cur.id, e.key === 'ArrowUp' ? -1 : 1); }
    });
    const saveAll = () => { this.flush(); DB.put('kv', 'meta', this.meta); };
    window.addEventListener('beforeunload', saveAll); window.addEventListener('pagehide', saveAll);
    document.addEventListener('visibilitychange', () => { if (document.hidden) saveAll(); });
  },
  seedMeta() {
    const nb = { id: uid(), name: 'Ministrações', color: '#7719aa' };
    const secs = ['Sermões', 'Estudos', 'Devocionais'].map((n, i) => ({ id: uid(), nb: nb.id, name: n, color: SECTION_COLORS[i] }));
    return { notebooks: [nb], sections: secs, currentNb: nb.id, currentSec: secs[0].id, currentSermon: null, bibleVersion: null, bibleNav: { book: 43, ch: 3 } };
  },
  saveMeta() {
    // marca mudança só quando muda algo que sincroniza (cadernos, seções, tipos, temas)
    try { const sig = JSON.stringify(Cloud.metaPayload()); if (this._metaSig && sig !== this._metaSig) { this.meta.metaUpdated = Date.now(); Cloud.schedule(); } this._metaSig = sig; } catch (e) { }
    this._saveMetaDb();
  },
  _saveMetaDb: debounce(function () { return DB.put('kv', 'meta', App.meta); }, 300),
  sectionSermons(secId) {
    const arr = [...this.sermons.values()].filter(s => s.sec === secId);
    const byDate = (a, b) => (b.date || '').localeCompare(a.date || '') || b.updated - a.updated;
    if (!arr.some(s => s.order != null)) return arr.sort(byDate);
    return arr.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || byDate(a, b));
  },
  /* ===== Ordem manual e subpáginas (como no OneNote) ===== */
  pageList(secId) { const l = this.sectionSermons(secId); this.normalizeLevels(l); return l; },
  normalizeLevels(l) { l.forEach((s, i) => { const max = i === 0 ? 0 : Math.min(2, (l[i - 1].level || 0) + 1); if ((s.level || 0) > max) s.level = max; }); },
  blockEnd(l, i) { let j = i; const lv = l[i].level || 0; while (j + 1 < l.length && (l[j + 1].level || 0) > lv) j++; return j; },
  saveOrder(l) { l.forEach((s, i) => { if (s.order !== i) { s.order = i; this.touch(s); } }); this.normalizeLevels(l); this.flush(); this.renderPages(); },
  movePage(id, dir) {
    const l = this.pageList(this.meta.currentSec); const i = l.findIndex(s => s.id === id); if (i < 0) return;
    const j = this.blockEnd(l, i), blk = l.slice(i, j + 1), lv = l[i].level || 0;
    if (dir < 0) {
      if (i === 0 || (l[i - 1].level || 0) < lv) return; // já é a primeira dentro do grupo
      let k = i - 1; while (k > 0 && (l[k].level || 0) > lv) k--;
      l.splice(i, blk.length); l.splice(k, 0, ...blk);
    } else {
      if (j + 1 >= l.length || (l[j + 1].level || 0) < lv) return; // já é a última dentro do grupo
      const e = this.blockEnd(l, j + 1);
      l.splice(i, blk.length); l.splice(e - blk.length + 1, 0, ...blk);
    }
    this.saveOrder(l);
  },
  indentPage(id, d) {
    const l = this.pageList(this.meta.currentSec); const i = l.findIndex(s => s.id === id); if (i < 0) return;
    if (d > 0 && i === 0) { UI.toast('A primeira página não pode ser subpágina'); return; }
    const j = this.blockEnd(l, i); const cur = l[i].level || 0;
    const nl = d > 0 ? Math.min(2, cur + 1, (l[i - 1].level || 0) + 1) : Math.max(0, cur - 1);
    if (nl === cur) { if (d > 0) UI.toast('Máximo de 2 níveis de subpágina'); return; }
    for (let k = i; k <= j; k++) { const v = Math.max(0, Math.min(2, (l[k].level || 0) + (nl - cur))); if ((l[k].level || 0) !== v) { l[k].level = v; this.touch(l[k]); } }
    this.saveOrder(l);
  },
  toggleCollapse(id) { const s = this.sermons.get(id); s.collapsed = !s.collapsed; this.touch(s); this.renderPages(); },
  dropPage(dragId, targetId, after) {
    const drag = this.sermons.get(dragId), target = this.sermons.get(targetId); if (!drag || !target || dragId === targetId) return;
    if (drag.sec !== target.sec) { drag.sec = target.sec; drag.level = 0; }
    const l = this.pageList(target.sec); const i = l.findIndex(s => s.id === dragId);
    const j = this.blockEnd(l, i); const blk = l.splice(i, j - i + 1);
    if (blk.some(b => b.id === targetId)) { l.splice(i, 0, ...blk); return; }
    let t = l.findIndex(s => s.id === targetId); if (after) t = this.blockEnd(l, t) + 1;
    const shift = (target.level || 0) - (blk[0].level || 0);
    blk.forEach(b => { b.level = Math.max(0, Math.min(2, (b.level || 0) + shift)); this.touch(b); });
    l.splice(t, 0, ...blk); this.saveOrder(l); this.renderNav();
  },
  pageMenu(s) {
    const m = UI.modal({ title: s.title || 'Página', body: el('div', { class: 'pm' },
      el('button', { class: 'on-item', onclick: () => { m.close(); this.movePage(s.id, -1); } }, el('b', { text: '↑ Subir' })),
      el('button', { class: 'on-item', onclick: () => { m.close(); this.movePage(s.id, 1); } }, el('b', { text: '↓ Descer' })),
      el('button', { class: 'on-item', onclick: () => { m.close(); this.indentPage(s.id, 1); } }, el('b', { text: '→ Tornar subpágina' }), el('span', { class: 'muted small', text: 'Fica recuada debaixo da página de cima' })),
      el('button', { class: 'on-item', onclick: () => { m.close(); this.indentPage(s.id, -1); } }, el('b', { text: '← Promover' }), el('span', { class: 'muted small', text: 'Volta um nível' })),
      el('button', { class: 'on-item', onclick: async () => { m.close(); const r = await SectionPicker.pick(`“${s.title}”`, true); if (r) this.moveSermons([s.id], r.sec, r.copy); } }, el('b', { text: '⇢ Mover / Copiar para outra seção' })),
      el('button', { class: 'on-item', onclick: () => { m.close(); this.open(s.id); this.deleteSermon(); } }, el('b', { class: 'danger-text', text: 'Excluir' }))) });
  },

  /* ---- persistência ---- */
  pending: new Set(),
  touch(s = this.cur) { if (!s) return; s.updated = Date.now(); this.pending.add(s.id); this._save(); if (s === this.cur) this._est(); Cloud.schedule(); },
  _est: debounce(() => App.updateEstimate(), 400),
  updateEstimate() {
    const E = $('#s-est'); if (!E || !this.cur) return; const e = Estimate.sermon(this.cur);
    const last = (this.cur.preached || []).slice(-1)[0];
    E.textContent = `≈ ${Estimate.fmt(e.minutes)} pregando`;
    E.title = `${e.words} palavras · estimativa ${Estimate.label(e)}` + (last ? `\nÚltima vez: ${last.minutes} min em ${new Date(last.date + 'T12:00').toLocaleDateString('pt-BR')}` : '');
  },
  _save: debounce(() => App.flush(), 600),
  flush() { for (const id of this.pending) { const s = this.sermons.get(id); if (s) DB.put('sermons', id, s); } this.pending.clear(); },

  /* ---- navegação ---- */
  bindNav() {
    $('#nb-select').onchange = e => { this.meta.currentNb = e.target.value; const sec = this.meta.sections.find(s => s.nb === e.target.value); this.meta.currentSec = sec?.id || null; this.saveMeta(); this.renderNav(); };
    $('#nb-add').onclick = () => {
      const m = UI.modal({ title: 'Novo caderno', body: el('div', { class: 'type-grid' },
        el('button', { class: 'on-item', onclick: () => { m.close(); newEmpty(); } }, el('b', { text: 'Caderno vazio' }), el('span', { class: 'muted small', text: 'Começar do zero' })),
        el('button', { class: 'on-item', onclick: () => { m.close(); Porter.notebookImport(); } }, el('b', { text: 'Importar caderno do OneNote' }), el('span', { class: 'muted small', text: 'Com as seções, a partir dos arquivos exportados' }))) });
    };
    const newEmpty = async () => { const n = await UI.ask('Novo caderno', '', 'Ex.: Conferência 2027'); if (!n) return; const nb = { id: uid(), name: n, color: SECTION_COLORS[this.meta.notebooks.length % 10] }; this.meta.notebooks.push(nb); const sec = { id: uid(), nb: nb.id, name: 'Geral', color: SECTION_COLORS[0] }; this.meta.sections.push(sec); this.meta.currentNb = nb.id; this.meta.currentSec = sec.id; this.saveMeta(); this.renderNav(); };
    $('#nb-menu').onclick = () => this.notebookMenu();
    $('#sec-add').onclick = async () => { const n = await UI.ask('Nova seção (série, tema, evento…)', ''); if (!n) return; const sec = { id: uid(), nb: this.meta.currentNb, name: n, color: SECTION_COLORS[this.meta.sections.length % 10] }; this.meta.sections.push(sec); this.meta.currentSec = sec.id; this.saveMeta(); this.renderNav(); };
    $('#page-add').onclick = () => this.newSermon();
    $('#page-import').onclick = () => Porter.importDialog();
    $('#page-search').oninput = () => this.renderPages();
    $('#page-select').onclick = () => { this.selMode = !this.selMode; this.sel = new Set(); this.renderPages(); };
    $('#toggle-nav').onclick = () => document.body.classList.toggle('nav-collapsed');
    $('#editor').addEventListener('pointerdown', () => { if (window.innerWidth < 980) document.body.classList.add('nav-collapsed'); });
    if (window.innerWidth < 980) document.body.classList.add('nav-collapsed');
  },
  async notebookMenu() {
    const nb = this.meta.notebooks.find(n => n.id === this.meta.currentNb); if (!nb) return;
    const m = UI.modal({ title: 'Caderno: ' + nb.name, body: '', actions: [
      { label: 'Renomear', onClick: async () => { const n = await UI.ask('Renomear caderno', nb.name); if (n) { nb.name = n; this.saveMeta(); this.renderNav(); } } },
      { label: 'Excluir caderno', danger: true, onClick: async () => {
        if (this.meta.notebooks.length < 2) { UI.toast('Mantenha pelo menos um caderno'); return; }
        if (!await UI.confirm('Excluir caderno', `Excluir “${nb.name}” e todas as suas ministrações?`)) return;
        const secIds = this.meta.sections.filter(s => s.nb === nb.id).map(s => s.id);
        for (const s of [...this.sermons.values()]) if (secIds.includes(s.sec)) { this.sermons.delete(s.id); DB.del('sermons', s.id); Cloud.tomb(s.id); }
        this.meta.deleted ||= {}; [nb.id, ...secIds].forEach(id => this.meta.deleted[id] = Date.now());
        this.meta.sections = this.meta.sections.filter(s => s.nb !== nb.id); this.meta.notebooks = this.meta.notebooks.filter(n => n.id !== nb.id);
        this.meta.currentNb = this.meta.notebooks[0].id; this.meta.currentSec = this.meta.sections.find(s => s.nb === this.meta.currentNb)?.id; this.saveMeta(); this.renderNav();
      } }] });
    m.body.innerHTML = '<p class="muted">O que deseja fazer com este caderno?</p>';
  },
  renderNav() {
    const m = this.meta;
    $('#nb-select').innerHTML = m.notebooks.map(n => `<option value="${n.id}" ${n.id === m.currentNb ? 'selected' : ''}>${esc(n.name)}</option>`).join('');
    const secs = m.sections.filter(s => s.nb === m.currentNb);
    if (!secs.some(s => s.id === m.currentSec)) m.currentSec = secs[0]?.id || null;
    const list = $('#sec-list'); list.innerHTML = '';
    for (const s of secs) {
      const count = this.sectionSermons(s.id).length;
      const row = el('div', { class: 'sec' + (s.id === m.currentSec ? ' active' : ''), style: { '--sc': s.color }, draggable: 'true', 'data-sid': s.id,
        ondragstart: e => { if (e.target !== row) return; e.dataTransfer.setData('text/x-section', s.id); e.dataTransfer.effectAllowed = 'move'; this._dragSec = s.id; }, ondragend: () => { this._dragSec = null; } },
        el('span', { class: 'sec-dot' }), el('span', { class: 'sec-name', text: s.name }), el('span', { class: 'sec-count', text: count }),
        el('button', { class: 'icon-btn sm', title: 'Opções da seção', text: '⋯', onclick: e => { e.stopPropagation(); this.sectionMenu(s); } }));
      row.onclick = () => { m.currentSec = s.id; this.saveMeta(); this.renderNav(); const first = this.sectionSermons(s.id)[0]; if (first) this.open(first.id); };
      bindContextMenu(row, () => this.sectionMenu(s));
      // soltar uma página arrastada aqui: move (segure Ctrl para copiar)
      row.addEventListener('dragover', e => {
        if (e.dataTransfer.types.includes('text/x-section')) { if (this._dragSec === s.id) return; e.preventDefault(); const r = row.getBoundingClientRect(); const after = e.clientY > r.top + r.height / 2; row.classList.toggle('drop-after', after); row.classList.toggle('drop-before', !after); return; }
        if (e.dataTransfer.types.includes('text/x-sermon')) { e.preventDefault(); e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move'; row.classList.add('drop'); } });
      row.addEventListener('dragleave', () => row.classList.remove('drop', 'drop-before', 'drop-after'));
      row.addEventListener('drop', e => { e.preventDefault(); const after = row.classList.contains('drop-after'); row.classList.remove('drop', 'drop-before', 'drop-after');
        const sid = e.dataTransfer.getData('text/x-section'); if (sid) { this.placeSection(sid, s.id, after); return; }
        const id = e.dataTransfer.getData('text/x-sermon'); if (!id) return; const ids = this.selMode && this.sel.has(id) ? [...this.sel] : [id]; this.moveSermons(ids, s.id, e.ctrlKey); });
      list.append(row);
    }
    const cs = m.sections.find(s => s.id === m.currentSec);
    $('#pages-title').textContent = cs ? cs.name : '';
    document.documentElement.style.setProperty('--sec-color', cs?.color || '#7719aa');
    this.renderPages();
  },
  /* ===== Ordem das seções ===== */
  moveSection(id, dir) {
    const A = this.meta.sections, i = A.findIndex(x => x.id === id); if (i < 0) return;
    const nb = A[i].nb; let j = i + dir; while (j >= 0 && j < A.length && A[j].nb !== nb) j += dir;
    if (j < 0 || j >= A.length) return;
    [A[i], A[j]] = [A[j], A[i]]; this.saveMeta(); this.renderNav();
  },
  placeSection(dragId, targetId, after) {
    const A = this.meta.sections; const i = A.findIndex(x => x.id === dragId); if (i < 0 || dragId === targetId) return;
    const [sec] = A.splice(i, 1); const t = A.find(x => x.id === targetId); sec.nb = t.nb;
    let k = A.indexOf(t) + (after ? 1 : 0); A.splice(k, 0, sec); this.saveMeta(); this.renderNav();
  },
  async sectionToNotebook(s) {
    const others = this.meta.notebooks.filter(n => n.id !== s.nb);
    if (!others.length) { UI.toast('Crie outro caderno primeiro'); return; }
    const m = UI.modal({ title: `Mover “${s.name}” para o caderno…`, body: el('div', { class: 'sp-list' }, others.map(n => el('button', { class: 'sp-sec', onclick: () => {
      const A = this.meta.sections; A.splice(A.indexOf(s), 1); s.nb = n.id; A.push(s); this.meta.currentNb = n.id; this.meta.currentSec = s.id; this.saveMeta(); this.renderNav(); m.close(); UI.toast(`Seção movida para “${n.name}”`);
    } }, el('span', { text: n.name })))) });
  },
  async sectionMenu(s) {
    const colors = el('div', { class: 'swatches' }, SECTION_COLORS.map(c => el('button', { class: 'swatch' + (c === s.color ? ' on' : ''), style: { background: c }, onclick: () => { s.color = c; this.saveMeta(); this.renderNav(); m.close(); } })));
    const m = UI.modal({ title: 'Seção: ' + s.name, body: el('div', {},
      el('div', { class: 'pm' },
        el('button', { class: 'on-item', onclick: () => { m.close(); this.moveSection(s.id, -1); } }, el('b', { text: '↑ Subir' })),
        el('button', { class: 'on-item', onclick: () => { m.close(); this.moveSection(s.id, 1); } }, el('b', { text: '↓ Descer' })),
        el('button', { class: 'on-item', onclick: () => { m.close(); this.sectionToNotebook(s); } }, el('b', { text: '⇢ Mover para outro caderno' }))),
      el('p', { class: 'muted', text: 'Cor da seção' }), colors), actions: [
      { label: 'Renomear', onClick: async () => { const n = await UI.ask('Renomear seção', s.name); if (n) { s.name = n; this.saveMeta(); this.renderNav(); } } },
      { label: 'Excluir', danger: true, onClick: async () => {
        const items = this.sectionSermons(s.id);
        if (!await UI.confirm('Excluir seção', `Excluir “${s.name}”${items.length ? ` e ${items.length} ministração(ões)` : ''}?`)) return;
        for (const it of items) { this.sermons.delete(it.id); DB.del('sermons', it.id); Cloud.tomb(it.id); }
        (this.meta.deleted ||= {})[s.id] = Date.now();
        this.meta.sections = this.meta.sections.filter(x => x.id !== s.id); this.saveMeta(); this.renderNav();
        if (this.cur && !this.sermons.has(this.cur.id)) { this.cur = null; this.renderEditor(); }
      } }] });
  },
  renderPages() {
    const q = stripAccents(($('#page-search').value || '').toLowerCase().trim());
    let items = q ? [...this.sermons.values()].filter(s => stripAccents((s.title + ' ' + s.passage + ' ' + s.blocks.map(b => (b.ref || '') + ' ' + htmlToText(b.html) + ' ' + (b.alt || '')).join(' ')).toLowerCase()).includes(q))
      : this.sectionSermons(this.meta.currentSec);
    const list = $('#page-list'); list.innerHTML = '';
    this.sel ||= new Set(); this.renderBulk();
    if (!items.length) list.append(el('p', { class: 'muted pad', text: q ? 'Nada encontrado.' : 'Nenhuma ministração nesta seção.' }));
    if (!q) { this.normalizeLevels(items); }
    const hidden = new Set(); { const stack = []; items.forEach((s, i) => { const lv = q ? 0 : (s.level || 0); while (stack.length && stack.at(-1).lv >= lv) stack.pop(); if (stack.some(x => x.collapsed)) hidden.add(s.id); stack.push({ lv, collapsed: !!s.collapsed }); }); }
    for (const [idx, s] of items.entries()) {
      if (!q && hidden.has(s.id)) continue;
      const lv = q ? 0 : (s.level || 0);
      const hasKids = !q && items[idx + 1] && (items[idx + 1].level || 0) > lv;
      const preview = s.passage || htmlToText(s.blocks.find(b => b.type === 'text')?.html || '').slice(0, 60);
      if (this.selMode) {
        const on = this.sel.has(s.id);
        list.append(el('label', { class: 'page sel-row' + (on ? ' active' : '') },
          el('input', { type: 'checkbox', checked: on, onchange: e => { e.target.checked ? this.sel.add(s.id) : this.sel.delete(s.id); this.renderBulk(); e.target.closest('.page').classList.toggle('active', e.target.checked); } }),
          el('span', {}, el('div', { class: 'page-title', text: s.title || 'Sem título' }), el('div', { class: 'page-sub', text: s.date ? new Date(s.date + 'T12:00').toLocaleDateString('pt-BR') : '' }))));
        continue;
      }
      const row = el('div', { class: `page lv${lv}` + (this.cur?.id === s.id ? ' active' : ''), 'data-id': s.id, draggable: 'true', onclick: () => this.open(s.id),
        ondragstart: e => { e.dataTransfer.setData('text/x-sermon', s.id); e.dataTransfer.effectAllowed = 'copyMove'; document.body.classList.add('dragging'); this._drag = s.id; },
        ondragend: () => { document.body.classList.remove('dragging'); this._drag = null; } },
        hasKids ? el('button', { class: 'pg-tog', title: s.collapsed ? 'Mostrar subpáginas' : 'Recolher subpáginas', text: s.collapsed ? '▸' : '▾', onclick: e => { e.stopPropagation(); this.toggleCollapse(s.id); } }) : el('span', { class: 'pg-tog sp' }),
        el('div', { class: 'pg-main' },
          el('div', { class: 'page-title', text: (s.title || 'Sem título') + (s.collapsed && hasKids ? ' …' : '') }),
          el('div', { class: 'page-sub', text: [s.date ? new Date(s.date + 'T12:00').toLocaleDateString('pt-BR') : '', preview].filter(Boolean).join(' · ') })),
        q ? null : el('button', { class: 'pg-menu icon-btn sm', title: 'Ordem, subpágina, mover…', text: '⋯', onclick: e => { e.stopPropagation(); this.pageMenu(s); } }));
      if (!q) {
        row.addEventListener('dragover', e => { if (!this._drag || this._drag === s.id) return; e.preventDefault(); const r = row.getBoundingClientRect(); const after = e.clientY > r.top + r.height / 2; row.classList.toggle('drop-after', after); row.classList.toggle('drop-before', !after); });
        row.addEventListener('dragleave', () => row.classList.remove('drop-after', 'drop-before'));
        row.addEventListener('drop', e => { e.preventDefault(); const after = row.classList.contains('drop-after'); row.classList.remove('drop-after', 'drop-before'); const id = e.dataTransfer.getData('text/x-sermon'); if (id) this.dropPage(id, s.id, after); });
      }
      if (!q) bindContextMenu(row, () => this.pageMenu(s));
      list.append(row);
    }
  },
  _bulk: null,
  renderBulk() {
    const bar = $('#page-bulk'); bar.hidden = !this.selMode; $('#page-select').classList.toggle('on', !!this.selMode); $('#page-select').textContent = this.selMode ? '✕ Concluir' : '☑ Selecionar páginas';
    if (!this.selMode) return;
    const n = this.sel.size; bar.innerHTML = '';
    const ids = () => [...this.sel];
    const all = el('button', { class: 'btn sm', text: 'Todas', onclick: () => { $$('#page-list .sel-row input').forEach(c => { if (!c.checked) { c.checked = true; c.dispatchEvent(new Event('change')); } }); } });
    const mv = el('button', { class: 'btn sm primary', text: 'Mover para…', disabled: !n, onclick: async () => { const sec = await SectionPicker.pick(`Mover ${n} página(s) para…`); if (sec) this.moveSermons(ids(), sec, false); } });
    const cp = el('button', { class: 'btn sm', text: 'Copiar para…', disabled: !n, onclick: async () => { const sec = await SectionPicker.pick(`Copiar ${n} página(s) para…`); if (sec) this.moveSermons(ids(), sec, true); } });
    const del = el('button', { class: 'btn sm danger-text', text: 'Excluir', disabled: !n, onclick: async () => {
      if (!await UI.confirm('Excluir páginas', `Excluir ${n} ministração(ões)?`)) return;
      for (const id of this.sel) { this.sermons.delete(id); DB.del('sermons', id); Cloud.tomb(id); }
      if (this.cur && !this.sermons.has(this.cur.id)) { this.cur = null; this.renderEditor(); }
      this.sel = new Set(); this.renderNav();
    } });
    bar.append(el('span', { class: 'small', text: n ? `${n} selecionada(s)` : 'Toque nas páginas' }), all, mv, cp, del);
  },
  /* Move ou copia ministrações para outra seção */
  moveSermons(ids, secId, copy) {
    const sec = this.meta.sections.find(x => x.id === secId); if (!sec) return;
    let last = null;
    for (const id of ids) {
      const s = this.sermons.get(id); if (!s) continue;
      if (copy) {
        const c = structuredClone(s); c.id = uid(); c.sec = secId; c.created = Date.now(); c.blocks.forEach(b => b.id = uid()); c.level = 0; delete c.collapsed; if (c.order != null) c.order = s.order + 0.5;
        delete c.preached; delete c.reviews; delete c.source; delete c.welcome;
        if (secId === s.sec) c.title += ' (cópia)';
        this.sermons.set(c.id, c); this.touch(c); last = c;
      } else if (s.sec !== secId) { s.sec = secId; s.level = 0; const l = this.sectionSermons(secId); if (l.some(x => x.order != null && x !== s)) s.order = 1e6 + Date.now() % 1e6; this.touch(s); last = s; }
    }
    this.flush(); this.sel = new Set();
    UI.toast(`${ids.length} página(s) ${copy ? 'copiada(s)' : 'movida(s)'} para “${sec.name}”`, { label: 'Abrir seção', fn: () => { this.meta.currentNb = sec.nb; this.meta.currentSec = sec.id; this.saveMeta(); this.renderNav(); const f = this.sectionSermons(sec.id)[0]; if (f) this.open(f.id); } });
    this.renderNav();
  },
  newSermon(data = {}) {
    if (!this.meta.currentSec) { UI.toast('Crie uma seção primeiro'); return; }
    const s = Object.assign(blankSermon(this.meta.currentSec), data);
    this.sermons.set(s.id, s);
    const l = this.sectionSermons(this.meta.currentSec);
    if (l.some(x => x.order != null)) { // ordem manual: entra logo abaixo da página aberta (e das subpáginas dela)
      const rest = l.filter(x => x !== s); let at = rest.length;
      const ci = this.cur ? rest.findIndex(x => x.id === this.cur.id) : -1; if (ci >= 0) { at = this.blockEnd(rest, ci) + 1; s.level = this.cur.level || 0; }
      rest.splice(at, 0, s); rest.forEach((x, i) => { if (x.order !== i) { x.order = i; if (x !== s) this.touch(x); } });
    }
    this.touch(s); this.flush();
    this.renderNav(); this.open(s.id);
    setTimeout(() => { const t = $('#s-title'); t && (t.focus(), t.select()); }, 50);
    return s;
  },
  open(id) {
    this.flush();
    const s = this.sermons.get(id); if (!s) return;
    this.cur = s; this.meta.currentSermon = id;
    const sec = this.meta.sections.find(x => x.id === s.sec);
    if (sec && sec.id !== this.meta.currentSec) { this.meta.currentSec = sec.id; this.meta.currentNb = sec.nb; this.renderNav(); }
    this.saveMeta();
    $$('#page-list .page').forEach(p => p.classList.toggle('active', p.dataset.id === id));
    this.renderEditor();
    if (window.innerWidth < 980) document.body.classList.add('nav-collapsed');
  },
  async deleteSermon() {
    const s = this.cur; if (!s) return;
    if (!await UI.confirm('Excluir ministração', `Excluir “${s.title}”?`)) return;
    this.sermons.delete(s.id); await DB.del('sermons', s.id); Cloud.tomb(s.id); this.cur = null;
    this.renderNav(); const n = this.sectionSermons(this.meta.currentSec)[0]; n ? this.open(n.id) : this.renderEditor();
  },
  duplicateSermon() {
    const s = structuredClone(this.cur); s.id = uid(); s.title += ' (cópia)'; s.created = Date.now(); s.blocks.forEach(b => b.id = uid());
    this.sermons.set(s.id, s); this.touch(s); this.flush(); this.renderNav(); this.open(s.id);
  },

  /* ---- editor ---- */
  renderEditor() {
    this.inkSurfaces.forEach(i => i.destroy()); this.inkSurfaces = [];
    const ed = $('#editor-inner'); ed.innerHTML = '';
    const s = this.cur;
    if (!s) { ed.append(el('div', { class: 'empty-state' }, el('h2', { text: 'Nenhuma ministração aberta' }), el('button', { class: 'btn primary', text: '+ Nova ministração', onclick: () => this.newSermon() }))); return; }
    const secOpts = this.meta.sections.map(x => { const nb = this.meta.notebooks.find(n => n.id === x.nb); return `<option value="${x.id}" ${x.id === s.sec ? 'selected' : ''}>${esc(nb?.name || '')} › ${esc(x.name)}</option>`; }).join('');
    const head = el('div', { class: 's-head' });
    head.innerHTML = `
      <input id="s-title" class="s-title" value="${esc(s.title)}" placeholder="Título da ministração">
      <div class="s-meta">
        <label>Data <input type="date" id="s-date" value="${esc(s.date || '')}"></label>
        <label>Texto-base <input id="s-passage" value="${esc(s.passage || '')}" placeholder="Ex.: Rm 8:28-39"></label>
        <label>Duração <input id="s-duration" type="number" min="0" max="240" value="${s.duration || ''}" style="width:4.2em"> min</label>
        <span class="s-est" id="s-est"></span>
        <label>Seção <select id="s-sec">${secOpts}</select></label>
        <span class="s-actions">
          <button class="btn sm ai-btn" id="s-review" title="Revisar com IA (Claude e Gemini) e conferir referências">✦ Revisar</button>
          <button class="btn sm" id="s-report" title="Pregações registradas e relatório pós-culto">📊 Pregações${(s.preached || []).length ? ' (' + s.preached.length + ')' : ''}</button>
          <button class="btn sm" id="s-share" title="Copiar para WhatsApp ou criar link de leitura">↗ Compartilhar</button>
          <button class="btn sm" id="s-move" title="Mover ou copiar para outra seção">⇢ Mover/Copiar</button>
          <button class="btn sm" id="s-dup" title="Duplicar">Duplicar</button>
          <button class="btn sm danger-text" id="s-del" title="Excluir">Excluir</button>
        </span>
      </div>`;
    ed.append(head);
    $('#s-title').oninput = e => { s.title = e.target.value; this.touch(); const p = $(`#page-list .page[data-id="${s.id}"] .page-title`); if (p) p.textContent = s.title || 'Sem título'; };
    $('#s-title').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); const f = $('#blocks .b-body'); f && f.focus(); } };
    $('#s-date').onchange = e => { s.date = e.target.value; this.touch(); this.renderPages(); };
    $('#s-passage').oninput = e => { s.passage = e.target.value; this.touch(); };
    $('#s-passage').onchange = async e => {
      const r = parseRef(e.target.value); if (!r || !Bible.current()) return;
      if (s.blocks.some(b => b.type === 'verse' && b.ref === refLabel(r))) return;
      UI.toast('Inserir o texto-base como versículo?', { label: 'Inserir', fn: async () => { const res = await Bible.lookup(r); if (!res.error) { this.insertBlock('verse', { ref: res.label, version: res.version, html: Bible.versesHTML(res.verses) }, -1); } } });
    };
    $('#s-duration').oninput = e => { s.duration = +e.target.value || 0; this.touch(); };
    $('#s-sec').onchange = e => { s.sec = e.target.value; const sec = this.meta.sections.find(x => x.id === s.sec); this.meta.currentSec = sec.id; this.meta.currentNb = sec.nb; this.touch(); this.saveMeta(); this.renderNav(); };
    $('#s-dup').onclick = () => this.duplicateSermon();
    $('#s-share').onclick = () => { this.flush(); Share.open(s); };
    $('#s-move').onclick = async () => {
      const r = await SectionPicker.pick(`“${s.title}”`, true); if (r) this.moveSermons([s.id], r.sec, r.copy);
    };
    $('#s-review').onclick = () => { this.flush(); Review.open(s); };
    $('#s-report').onclick = () => PostReport.open(s);
    $('#s-del').onclick = () => this.deleteSermon();
    ed.append(el('div', { id: 'blocks' }));
    this.updateEstimate();
    const add = el('div', { class: 'add-bar' }, el('span', { class: 'muted', text: 'Adicionar:' }),
      ...['point', 'intro', 'text', 'verse', 'illus', 'app', 'quote', 'concl', ...(this.meta.customTypes || []).map(c => c.id), 'ink', 'image'].map(t => el('button', { class: 'chip t-' + t, style: isCallout(t) ? { color: blockColor(t) } : null, text: '+ ' + BLOCK_TYPES[t].label, onclick: () => t === 'image' ? Ribbon.insertImage(true) : this.insertBlock(t, {}, Infinity) })),
      el('button', { class: 'chip', text: '⚙ Tipos…', title: 'Criar ou editar seus próprios tipos de bloco', onclick: () => TypeManager.open() }));
    ed.append(add);
    this.renderBlocks();
  },
  renderBlocks() {
    this.inkSurfaces.forEach(i => i.destroy()); this.inkSurfaces = [];
    const host = $('#blocks'); host.innerHTML = '';
    this.cur.blocks.forEach(b => host.append(this.blockEl(b)));
    this.numberPoints();
  },
  numberPoints() { let n = 0; $$('#blocks .block').forEach(e => { if (e.dataset.type === 'point') e.querySelector('.b-tag').textContent = 'Ponto ' + (++n); }); },
  blockIndex(id) { return this.cur.blocks.findIndex(b => b.id === id); },
  blockEl(b) {
    const T = BLOCK_TYPES[b.type] || BLOCK_TYPES.text;
    const wrap = el('div', { class: `block b-${b.type}${isCallout(b.type) ? ' b-callout' : ''}`, 'data-id': b.id, 'data-type': b.type, style: isCallout(b.type) ? { '--bc': blockColor(b.type) } : null });
    wrap.addEventListener('focusin', () => { this.focusId = b.id; $$('#blocks .block.focus').forEach(x => x.classList.remove('focus')); wrap.classList.add('focus'); });
    wrap.addEventListener('pointerdown', () => { this.focusId = b.id; });
    const tools = el('div', { class: 'b-tools' },
      el('button', { class: 'icon-btn sm', title: 'Mover para cima', text: '↑', onclick: () => this.moveBlock(b.id, -1) }),
      el('button', { class: 'icon-btn sm', title: 'Mover para baixo', text: '↓', onclick: () => this.moveBlock(b.id, 1) }),
      el('button', { class: 'icon-btn sm', title: 'Mudar tipo', text: '⇄', onclick: e => this.typeMenu(b, e.currentTarget) }),
      el('button', { class: 'icon-btn sm', title: 'Excluir bloco', text: '✕', onclick: () => this.removeBlock(b.id) }));
    wrap.append(el('div', { class: 'b-tag', text: T.label }), tools);
    if (b.type === 'ink') {
      const area = el('div', { class: 'ink-wrap' });
      const surf = new InkSurface(b, area, { onChange: () => this.touch(), theme: Theme.resolved() });
      this.inkSurfaces.push(surf);
      const grip = el('div', { class: 'ink-grip', title: 'Arraste para mudar a altura', text: '⋯' });
      grip.addEventListener('pointerdown', e => {
        e.preventDefault(); grip.setPointerCapture(e.pointerId); const y0 = e.clientY, h0 = b.ink.hr * surf.W;
        const mv = ev => { b.ink.hr = clamp((h0 + ev.clientY - y0) / surf.W, 0.08, 6); surf.resize(); };
        const upf = () => { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', upf); this.touch(); };
        grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', upf);
      });
      wrap.append(area, grip);
      return wrap;
    }
    if (b.type === 'image') {
      wrap.append(el('img', { class: 'b-img', src: b.src, alt: '' }));
      const cap = el('div', { class: 'b-body b-caption', contenteditable: 'true', 'data-ph': 'Legenda (opcional)', html: b.html || '' });
      this.bindEditable(cap, b); wrap.append(cap); return wrap;
    }
    if (b.type === 'verse') {
      const ref = el('input', { class: 'verse-ref', value: b.ref || '', placeholder: 'Referência — ex.: Jo 3:16-18' });
      const ver = el('select', { class: 'verse-version', title: 'Versão' }); this.fillVersionSelect(ver, b.version);
      const go = el('button', { class: 'btn sm', text: 'Buscar texto' });
      const fetchIt = async (silent) => {
        const res = await Bible.lookup(ref.value, ver.value || undefined);
        if (res.error) { if (silent !== true) UI.toast(res.error); return; }
        b.ref = res.label; b.version = res.version; b.html = Bible.versesHTML(res.verses);
        ref.value = b.ref; body.innerHTML = b.html; this.touch();
      };
      ref.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); fetchIt(); } };
      ref.oninput = () => { b.ref = ref.value; this.touch(); };
      ver.onchange = () => { b.version = ver.value; if (b.ref) fetchIt(); };
      go.onclick = () => fetchIt();
      const body = el('div', { class: 'b-body', contenteditable: 'true', 'data-ph': T.ph, html: b.html || '' });
      this.bindEditable(body, b);
      const study = el('button', { class: 'btn sm', text: '🔍', title: 'Estudo das palavras no original (Strong)', onclick: () => ref.value.trim() ? StrongUI.open(ref.value) : UI.toast('Informe a referência') });
      wrap.append(el('div', { class: 'verse-head' }, ref, b.verLabel && !b.version ? el('span', { class: 'pill', text: b.verLabel, title: 'Versão do texto colado' }) : null, ver, go, study), body);
      if (!b.html && b.ref && Bible.current()) setTimeout(() => fetchIt(true), 0);
      return wrap;
    }
    const body = el('div', { class: 'b-body', contenteditable: 'true', 'data-ph': T.ph, html: b.html || '' });
    this.bindEditable(body, b);
    if (b.type === 'point') body.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.insertBlock('text', {}, this.blockIndex(b.id) + 1); } });
    wrap.append(body);
    return wrap;
  },
  async fillMissingVerses() {
    for (const s of this.sermons.values()) {
      let changed = false;
      for (const b of s.blocks) if (b.type === 'verse' && b.ref && !b.html) { const r = await Bible.lookup(b.ref, Bible.has(b.version) ? b.version : undefined); if (!r.error) { b.html = Bible.versesHTML(r.verses); b.version = r.version; changed = true; } }
      if (changed) { this.touch(s); if (s === this.cur) this.renderBlocks(); }
    }
  },
  fillVersionSelect(sel, value) {
    sel.innerHTML = Bible.installed.map(v => `<option value="${v.id}">${esc(v.short)}</option>`).join('') || '<option value="">—</option>';
    sel.value = value && Bible.has(value) ? value : (Bible.current() || '');
  },
  bindEditable(body, b) {
    body.addEventListener('input', () => { b.html = body.innerHTML === '<br>' ? '' : body.innerHTML; this.touch(); });
    body.addEventListener('paste', e => {
      const html = e.clipboardData.getData('text/html');
      if (!html) return;
      e.preventDefault();
      document.execCommand('insertHTML', false, sanitizeHTML(html, b.type === 'point'));
    });
    body.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && !body.textContent.length && !body.querySelector('img') && this.cur.blocks.length > 1 && TEXT_TYPES().includes(b.type)) {
        e.preventDefault(); const i = this.blockIndex(b.id); this.removeBlock(b.id, true);
        const prev = $$('#blocks .block')[Math.max(0, i - 1)]?.querySelector('.b-body'); if (prev) { prev.focus(); placeCaretEnd(prev); }
      }
    });
  },
  insertBlock(type, data = {}, at) {
    if (!this.cur) return;
    const b = Object.assign({ id: uid(), type, html: '' }, data);
    if (type === 'ink' && !b.ink) b.ink = { hr: 0.32, strokes: [] };
    let i;
    if (at === Infinity) i = this.cur.blocks.length;
    else if (at === -1) i = 0;
    else if (typeof at === 'number') i = at;
    else { const f = this.focusId ? this.blockIndex(this.focusId) : -1; i = f >= 0 ? f + 1 : this.cur.blocks.length; }
    this.cur.blocks.splice(i, 0, b);
    const host = $('#blocks'); const node = this.blockEl(b);
    host.insertBefore(node, host.children[i] || null);
    this.numberPoints(); this.touch(); this.focusId = b.id;
    const f = node.querySelector(type === 'verse' && !b.ref ? '.verse-ref' : '.b-body');
    if (f && type !== 'ink') { f.focus(); if (f.isContentEditable) placeCaretEnd(f); }
    node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return b;
  },
  moveBlock(id, d) {
    const i = this.blockIndex(id), j = i + d; const arr = this.cur.blocks;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    const nodes = $$('#blocks .block'); const host = $('#blocks');
    if (d < 0) host.insertBefore(nodes[i], nodes[j]); else host.insertBefore(nodes[j], nodes[i]);
    this.numberPoints(); this.touch();
  },
  removeBlock(id, silent) {
    const i = this.blockIndex(id); if (i < 0) return;
    const [b] = this.cur.blocks.splice(i, 1);
    const node = $(`#blocks .block[data-id="${id}"]`); node && node.remove();
    const surf = this.inkSurfaces.find(s => s.b === b); if (surf) surf.destroy();
    this.numberPoints(); this.touch();
    if (!silent) UI.toast(`${BLOCK_TYPES[b.type].label} removido`, { label: 'Desfazer', fn: () => this.insertBlock(b.type, b, i) });
  },
  typeMenu(b, anchor) {
    const types = [...TEXT_TYPES(), 'verse'];
    if (!types.includes(b.type)) { UI.toast('Desenhos e imagens não mudam de tipo'); return; }
    const m = UI.modal({ title: 'Mudar tipo do bloco', body: el('div', { class: 'type-grid' }, types.map(t => el('button', { class: 'chip t-' + t + (t === b.type ? ' on' : ''), style: isCallout(t) ? { color: blockColor(t) } : null, text: BLOCK_TYPES[t].label, onclick: () => {
      this.convertBlock(b, t);
      const node = $(`#blocks .block[data-id="${b.id}"]`); node.replaceWith(this.blockEl(b)); this.numberPoints(); this.touch(); m.close();
    } }))) });
  },
  convertBlock(b, t) {
    if (t === b.type) return;
    const text = htmlToText(b.html);
    if (t === 'verse') {
      // "Jo 3:16 Porque Deus amou…" -> referência + texto
      const lines = text.split('\n'); const first = lines[0].trim();
      const m = first.match(/^(.{2,40}?\d{1,3}[:.]\d{1,3}(?:\s?[-–]\s?\d{1,3})?)(?:\s*\(([^)]{1,12})\))?\s*[-–:]?\s*(.*)$/);
      const r = m && parseRef(m[1]);
      if (r) { b.ref = refLabel(r); if (m[2]) b.verLabel = m[2]; const rest = [m[3], ...lines.slice(1)].filter(Boolean).join('\n'); b.html = esc(rest).replace(/\n/g, '<br>'); }
      else if (parseRef(first)) { b.ref = refLabel(parseRef(first)); b.html = esc(lines.slice(1).join('\n')).replace(/\n/g, '<br>'); }
      b.type = 'verse'; return;
    }
    if (b.type === 'verse') { // de versículo para texto: mantém a referência no começo
      b.html = (b.ref ? `<b>${esc(b.ref)}</b><br>` : '') + (b.html || ''); delete b.ref; delete b.version; delete b.verLabel;
    }
    if (t === 'point') b.html = esc(htmlToText(b.html).split('\n')[0]);
    b.type = t;
  },
};

/* Botão direito ou toque longo (dedo/caneta) abre um menu */
function bindContextMenu(node, open) {
  let t = null, x0 = 0, y0 = 0, fired = 0;
  const fire = () => { const now = Date.now(); if (now - fired < 700) return; fired = now; open(); };
  node.addEventListener('contextmenu', e => { e.preventDefault(); fire(); });
  node.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return; x0 = e.clientX; y0 = e.clientY; clearTimeout(t);
    t = setTimeout(() => { t = null; node.classList.add('pressed'); setTimeout(() => node.classList.remove('pressed'), 200); try { navigator.vibrate && navigator.vibrate(15); } catch (_) { } fire(); }, 550);
  });
  node.addEventListener('pointermove', e => { if (t && Math.hypot(e.clientX - x0, e.clientY - y0) > 10) { clearTimeout(t); t = null; } });
  ['pointerup', 'pointercancel', 'pointerleave', 'dragstart'].forEach(ev => node.addEventListener(ev, () => { clearTimeout(t); t = null; }));
  // depois do toque longo, ignora o "clique" que vem em seguida
  node.addEventListener('click', e => { if (Date.now() - fired < 700) { e.stopPropagation(); e.preventDefault(); } }, true);
}

function blankSermon(sec) {
  return { id: uid(), sec, title: 'Nova ministração', date: todayISO(), passage: '', duration: 40,
    blocks: [{ id: uid(), type: 'point', html: '' }, { id: uid(), type: 'text', html: '' }],
    settings: { fontSize: 34, mode: 'scroll', speed: 3 }, created: Date.now(), updated: Date.now() };
}
function welcomeSermon(sec) {
  const s = blankSermon(sec);
  s.title = 'Bem-vindo ao SmartSermon'; s.passage = 'Sl 119:105'; s.welcome = true;
  const B = (type, html, extra = {}) => ({ id: uid(), type, html, ...extra });
  s.blocks = [
    B('text', 'Este é um exemplo. Cada ministração é feita de <b>blocos</b>: pontos, textos, versículos, ilustrações, aplicações, frases-chave, desenhos e imagens. Use as setas ↑ ↓ de cada bloco para reorganizar.'),
    B('point', 'Escreva com a caneta'),
    B('text', 'Na guia <b>Desenhar</b> escolha cor e espessura. A caneta do Surface desenha; o dedo rola a página (ative “Desenhar com o dedo” se quiser). O botão-borracha da caneta apaga.'),
    B('ink', '', { ink: { hr: 0.22, strokes: [] } }),
    B('point', 'Busque e insira a Bíblia'),
    B('text', 'Clique em <b>Bíblia</b> no topo. Na primeira vez, baixe a Bíblia Livre — depois ela funciona offline. Digite “Jo 3:16” ou uma palavra, selecione os versículos e toque em <b>Inserir</b>.'),
    B('verse', '', { ref: 'Salmos 119:105', version: 'blivre' }),
    B('point', 'Pregue no modo leitura'),
    B('text', 'Toque em <b>▶ Pregar</b> (ou F5). <b>Rolagem</b>: o texto sobe sozinho; toque na tela para pausar e de novo para continuar. <b>Pontos</b>: toque à direita para avançar e à esquerda para voltar. Use a <b>pinça</b> com dois dedos para aumentar ou diminuir a letra.'),
    B('quote', 'A Palavra ilumina o caminho de quem prega e de quem ouve.'),
    B('app', 'Importe suas páginas do OneNote em <b>Importar</b> e exporte para PDF ou Word em <b>Exportar</b>. Referências como Rm 8:28 no meio do texto ficam tocáveis no modo leitura.'),
  ];
  return s;
}
function placeCaretEnd(node) { try { const r = document.createRange(); r.selectNodeContents(node); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } catch (e) { } }

/* ===== Sanitização de HTML colado/importado ===== */
function sanitizeHTML(html, inlineOnly = false) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const allowed = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'P', 'DIV', 'UL', 'OL', 'LI', 'SPAN', 'MARK', 'SUP', 'SUB', 'S']);
  const walk = node => {
    for (const c of [...node.childNodes]) {
      if (c.nodeType === 8) { c.remove(); continue; }
      if (c.nodeType !== 1) continue;
      if (['SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'XML', 'HEAD'].includes(c.tagName) || c.tagName.includes(':')) { c.remove(); continue; }
      walk(c);
      const st = c.getAttribute('style') || '';
      if (/font-weight:\s*(bold|[6-9]00)/i.test(st) && c.tagName === 'SPAN') { const b = document.createElement('b'); b.append(...c.childNodes); c.replaceWith(b); continue; }
      if (/font-style:\s*italic/i.test(st) && c.tagName === 'SPAN') { const b = document.createElement('i'); b.append(...c.childNodes); c.replaceWith(b); continue; }
      if (!allowed.has(c.tagName) || (inlineOnly && ['P', 'DIV', 'UL', 'OL', 'LI'].includes(c.tagName))) {
        const frag = document.createDocumentFragment(); frag.append(...c.childNodes);
        if (!inlineOnly && /^(H[1-6]|TR|TABLE|SECTION|ARTICLE|BLOCKQUOTE)$/.test(c.tagName)) { const d = document.createElement('div'); d.append(frag); c.replaceWith(d); } else c.replaceWith(frag);
        continue;
      }
      const keep = {};
      const color = st.match(/(?:^|;)\s*color:\s*([^;]+)/i), bg = st.match(/background(?:-color)?:\s*([^;]+)/i);
      [...c.attributes].forEach(a => c.removeAttribute(a.name));
      if (c.tagName === 'SPAN' || c.tagName === 'MARK') {
        if (color && !/windowtext|black|#000000|rgb\(0,\s*0,\s*0\)/i.test(color[1])) keep.color = color[1];
        if (bg && !/white|transparent|#fff|initial/i.test(bg[1])) keep['background-color'] = bg[1];
        const css = Object.entries(keep).map(([k, v]) => `${k}:${v.trim()}`).join(';'); if (css) c.setAttribute('style', css);
      }
      if (c.tagName === 'P') { const d = document.createElement('div'); d.append(...c.childNodes); c.replaceWith(d); }
    }
  };
  walk(doc.body);
  return doc.body.innerHTML.replace(/&nbsp;/g, ' ').replace(/(<div>\s*<\/div>)+/g, '').trim();
}

/* ===== Faixa de opções (ribbon) ===== */
/* ===== Escolher seção de destino (mover/copiar) ===== */
const SectionPicker = {
  pick(title, withMode = false) {
    return new Promise(res => {
      let done = false; const M = App.meta;
      const mode = el('div', { class: 'seg-toggle' });
      const bMove = el('button', { class: 'on', text: 'Mover' }), bCopy = el('button', { text: 'Copiar' });
      let copy = false; bMove.onclick = () => { copy = false; bMove.classList.add('on'); bCopy.classList.remove('on'); }; bCopy.onclick = () => { copy = true; bCopy.classList.add('on'); bMove.classList.remove('on'); };
      mode.append(bMove, bCopy);
      const finish = sec => { done = true; res(withMode ? { sec, copy } : sec); m.close(); };
      const list = el('div', { class: 'sp-list' });
      const nbs = [...M.notebooks].sort((a, b) => (b.id === M.currentNb) - (a.id === M.currentNb)); // caderno aberto primeiro
      for (const nb of nbs) {
        list.append(el('div', { class: 'sp-nb', text: nb.name + (nb.id === M.currentNb ? ' (aberto)' : '') }));
        for (const sc of M.sections.filter(x => x.nb === nb.id)) {
          const count = App.sectionSermons(sc.id).length;
          list.append(el('button', { class: 'sp-sec' + (sc.id === M.currentSec ? ' cur' : ''), style: { '--sc': sc.color }, onclick: () => finish(sc.id) }, el('span', { class: 'sec-dot' }), el('span', { text: sc.name }), el('span', { class: 'muted small', text: count })));
        }
        const inp = el('input', { class: 'inp sp-new', placeholder: `+ Nova seção em “${nb.name}”` });
        inp.onkeydown = e => { if (e.key === 'Enter' && inp.value.trim()) { const sc = { id: uid(), nb: nb.id, name: inp.value.trim(), color: SECTION_COLORS[M.sections.length % 10] }; M.sections.push(sc); App.saveMeta(); finish(sc.id); } };
        list.append(inp);
      }
      const m = UI.modal({ title, body: el('div', {}, withMode ? mode : null, el('p', { class: 'muted small', text: 'Escolha a seção (ou digite o nome de uma nova e tecle Enter):' }), list), onClose: () => { if (!done) res(null); } });
    });
  }
};

/* ===== Tipos de bloco do usuário ===== */
const TypeManager = {
  open() {
    const body = el('div', { class: 'tm' });
    const draw = () => {
      body.innerHTML = '';
      body.append(el('p', { class: 'muted', text: 'Crie tipos de bloco para a sua forma de pregar (ex.: Apelo, Oração, Testemunho, Declaração Profética). Eles aparecem em Inserir, ganham cor própria e saem no modo leitura, no PDF e no Word.' }));
      body.append(el('div', { class: 'tm-fixed' }, el('span', { class: 'muted small', text: 'Já incluídos: ' }), ...['point', 'intro', 'text', 'verse', 'illus', 'app', 'quote', 'concl', 'ink', 'image'].map(t => el('span', { class: 'pill', style: isCallout(t) ? { color: blockColor(t) } : null, text: BLOCK_TYPES[t].label }))));
      for (const c of App.meta.customTypes) {
        const name = el('input', { class: 'inp', value: c.label });
        name.onchange = () => { c.label = name.value.trim() || c.label; this.save(); };
        const colors = el('div', { class: 'swatches' }, SECTION_COLORS.map(col => el('button', { class: 'swatch' + (col === c.color ? ' on' : ''), style: { background: col }, onclick: () => { c.color = col; this.save(); draw(); } })));
        body.append(el('div', { class: 'tm-row', style: { '--bc': c.color } }, el('span', { class: 'tm-dot' }), name, colors,
          el('button', { class: 'icon-btn sm', title: 'Excluir tipo', text: '✕', onclick: async () => {
            const used = [...App.sermons.values()].reduce((n, s) => n + s.blocks.filter(b => b.type === c.id).length, 0);
            if (!await UI.confirm('Excluir tipo', used ? `${used} bloco(s) usam “${c.label}”. Eles virarão blocos de Texto.` : `Excluir “${c.label}”?`)) return;
            for (const s of App.sermons.values()) { let ch = false; s.blocks.forEach(b => { if (b.type === c.id) { b.type = 'text'; ch = true; } }); if (ch) App.touch(s); }
            (App.meta.deleted ||= {})[c.id] = Date.now(); App.meta.customTypes = App.meta.customTypes.filter(x => x !== c); this.save(); draw();
          } })));
      }
      const nn = el('input', { class: 'inp', placeholder: 'Nome do novo tipo — ex.: Apelo' });
      const add = () => { const v = nn.value.trim(); if (!v) return; App.meta.customTypes.push({ id: 'c_' + uid(), label: v, color: SECTION_COLORS[(App.meta.customTypes.length + 3) % 10] }); this.save(); draw(); };
      nn.onkeydown = e => { if (e.key === 'Enter') add(); };
      body.append(el('div', { class: 'tm-add' }, nn, el('button', { class: 'btn primary', text: 'Adicionar', onclick: add })));
    };
    draw();
    UI.modal({ title: 'Tipos de bloco', body, wide: true, onClose: () => { App.renderEditor(); Ribbon.renderCustom(); } });
  },
  save() { registerCustomTypes(); App.saveMeta(); }
};

const Ribbon = {
  bind() {
    $$('.rtab').forEach(t => t.onclick = () => { $$('.rtab').forEach(x => x.classList.toggle('on', x === t)); $$('.rpanel').forEach(p => p.hidden = p.dataset.panel !== t.dataset.tab); });
    // Não roubar o foco do texto ao tocar nos botões de formatação
    $$('.ribbon-body button, .ribbon-body .no-focus').forEach(b => b.addEventListener('pointerdown', e => { if (!b.matches('select,input')) e.preventDefault(); }));
    $$('[data-cmd]').forEach(b => b.onclick = () => { document.execCommand('styleWithCSS', false, b.dataset.css === '1'); document.execCommand(b.dataset.cmd, false, b.dataset.val || null); });
    $$('[data-insert]').forEach(b => b.onclick = () => b.dataset.insert === 'image' ? this.insertImage() : App.insertBlock(b.dataset.insert));
    $$('[data-color]').forEach(b => b.onclick = () => { document.execCommand('styleWithCSS', false, true); document.execCommand('foreColor', false, b.dataset.color); });
    $$('[data-hl]').forEach(b => b.onclick = () => { document.execCommand('styleWithCSS', false, true); document.execCommand('hiliteColor', false, b.dataset.hl); });
    // Desenho
    $$('[data-tool]').forEach(b => b.onclick = () => { App.ink.tool = b.dataset.tool; this.syncInk(); });
    $$('[data-pen]').forEach(b => b.onclick = () => { App.ink.color = b.dataset.pen; App.ink.tool = 'pen'; this.syncInk(); });
    $$('[data-mk]').forEach(b => b.onclick = () => { App.ink.hlColor = b.dataset.mk; App.ink.tool = 'marker'; this.syncInk(); });
    $$('[data-size]').forEach(b => b.onclick = () => { App.ink.size = +b.dataset.size; this.syncInk(); });
    $('#ink-finger').onchange = e => { App.ink.finger = e.target.checked; };
    $('#ink-undo').onclick = () => App.lastInk ? App.lastInk.undo() : UI.toast('Desenhe algo primeiro');
    $('#ink-clear').onclick = async () => { if (App.lastInk && await UI.confirm('Limpar desenho', 'Apagar todos os traços deste desenho?', 'Limpar')) App.lastInk.clear(); };
    $('#btn-bible').onclick = () => BiblePane.toggle();
    $('#btn-preach').onclick = () => App.cur && Reader.open(App.cur);
    $('#btn-import').onclick = () => Porter.importDialog();
    $('#btn-export').onclick = () => Porter.exportDialog();
    this.renderCustom();
    this.syncInk();
  },
  renderCustom() {
    const g = $('#rg-custom'); if (!g) return; g.innerHTML = '';
    for (const c of App.meta.customTypes || []) { const b = el('button', { class: 'rb', style: { color: c.color }, text: c.label, onclick: () => App.insertBlock(c.id) }); b.addEventListener('pointerdown', e => e.preventDefault()); g.append(b); }
    const m = el('button', { class: 'rb', text: '⚙ Tipos…', onclick: () => TypeManager.open() }); m.addEventListener('pointerdown', e => e.preventDefault()); g.append(m);
  },
  syncInk() {
    const k = App.ink;
    $$('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === k.tool));
    $$('[data-pen]').forEach(b => b.classList.toggle('on', k.tool === 'pen' && b.dataset.pen === k.color));
    $$('[data-mk]').forEach(b => b.classList.toggle('on', k.tool === 'marker' && b.dataset.mk === k.hlColor));
    $$('[data-size]').forEach(b => b.classList.toggle('on', +b.dataset.size === k.size));
    document.body.dataset.inktool = k.tool;
  },
  async insertImage(atEnd) {
    const [f] = await pickFiles('image/*'); if (!f) return;
    const src = await imageFileToDataURL(f);
    App.insertBlock('image', { src }, atEnd ? Infinity : undefined);
  }
};
function imageFileToDataURL(file, maxW = 1600) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => {
      const s = Math.min(1, maxW / img.naturalWidth); const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      res(c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.88));
    };
    img.onerror = rej; img.src = url;
  });
}
