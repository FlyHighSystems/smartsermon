/* ===== Marcações nos blocos (como as "marcas" do OneNote) =====
   Cada bloco pode ter várias: b.marks = ['important', 'star', ...]. Atalhos Alt+1…9. */
const MARKS = [
  { id: 'important', label: 'Importante',            color: '#d13438', emoji: '❗', ch: '!',
    svg: '<path d="M12 6.2v7.6" stroke-width="3" stroke-linecap="round"/><circle cx="12" cy="18" r="1.9" fill="#fff" stroke="none"/>' },
  { id: 'star',      label: 'Especial',              color: '#e8a400', emoji: '⭐', ch: '★',
    svg: '<path d="M12 4.6l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L4.8 9.9l5-.7z" fill="#fff" stroke="#fff" stroke-width="1" stroke-linejoin="round"/>' },
  { id: 'question',  label: 'Perguntar à igreja',    color: '#0f6cbd', emoji: '❓', ch: '?',
    svg: '<path d="M8.9 9.3a3.2 3.2 0 1 1 4.6 2.9c-1 .5-1.5 1.2-1.5 2.3v.6" stroke-width="2.6" stroke-linecap="round" fill="none"/><circle cx="12" cy="18.4" r="1.7" fill="#fff" stroke="none"/>' },
  { id: 'pray',      label: 'Momento de oração',     color: '#7719aa', emoji: '🙏', ch: '✝',
    svg: '<path d="M12 4.5v15M7 9.5h10" stroke-width="2.8" stroke-linecap="round"/>' },
  { id: 'heart',     label: 'Apelo / ministração',   color: '#e3008c', emoji: '❤️', ch: '♥',
    svg: '<path d="M12 19s-6.8-4.2-6.8-9a3.7 3.7 0 0 1 6.8-2 3.7 3.7 0 0 1 6.8 2c0 4.8-6.8 9-6.8 9z" fill="#fff" stroke="none"/>' },
  { id: 'people',    label: 'Interação (vire para o lado, repita)', color: '#107c10', emoji: '👥', ch: '☺',
    svg: '<circle cx="9" cy="9" r="2.6" fill="#fff" stroke="none"/><circle cx="15.6" cy="10" r="2.2" fill="#fff" stroke="none"/><path d="M4.6 18.5c.6-3 2.3-4.6 4.4-4.6s3.8 1.6 4.4 4.6zM13.6 18.5c.3-1.6.9-2.8 1.9-3.4 1.9-.6 3.4.6 3.9 3.4z" fill="#fff" stroke="none"/>' },
  { id: 'idea',      label: 'Revelação / insight',   color: '#ca5010', emoji: '💡', ch: '✦',
    svg: '<path d="M12 4.4a5 5 0 0 0-3 9c.6.5 1 1.2 1 2h4c0-.8.4-1.5 1-2a5 5 0 0 0-3-9z" fill="#fff" stroke="none"/><path d="M10 17.6h4M10.6 19.8h2.8" stroke-width="1.7" stroke-linecap="round"/>' },
  { id: 'screen',    label: 'Mostrar no telão',      color: '#3a5f8f', emoji: '🖥️', ch: '▣',
    svg: '<rect x="4.6" y="5.6" width="14.8" height="9.6" rx="1.4" fill="none" stroke-width="2.2"/><path d="M12 15.4v3.2M8.6 19.2h6.8" stroke-width="2.2" stroke-linecap="round"/>' },
  { id: 'music',     label: 'Louvor / música',       color: '#4f52b2', emoji: '🎵', ch: '♪',
    svg: '<path d="M10 16.6V6.4l8-1.8v10" fill="none" stroke-width="2" stroke-linejoin="round"/><circle cx="8" cy="16.8" r="2.2" fill="#fff" stroke="none"/><circle cx="16" cy="14.8" r="2.2" fill="#fff" stroke="none"/>' },
  { id: 'pause',     label: 'Pausa / silêncio',      color: '#038387', emoji: '⏸️', ch: '‖',
    svg: '<path d="M9.4 7v10M14.6 7v10" stroke-width="3" stroke-linecap="round"/>' },
  { id: 'optional',  label: 'Opcional (se der tempo)', color: '#69707d', emoji: '⏱️', ch: '◷',
    svg: '<circle cx="12" cy="12.6" r="6.6" fill="none" stroke-width="2.2"/><path d="M12 9v4l2.6 1.6M10 4.4h4" stroke-width="2.2" stroke-linecap="round"/>' },
  { id: 'warning',   label: 'Cuidado (tema sensível)', color: '#b7791f', emoji: '⚠️', ch: '△',
    svg: '<path d="M12 5.2l7.4 13H4.6z" fill="none" stroke-width="2.2" stroke-linejoin="round"/><path d="M12 10v3.6" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="16.2" r="1.2" fill="#fff" stroke="none"/>' }
];
const Marks = {
  get: id => MARKS.find(m => m.id === id),
  svg(m, size = 22) {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><circle cx="12" cy="12" r="11.5" fill="${m.color}"/><g stroke="#fff" fill="none">${m.svg}</g></svg>`;
  },
  badge(m, size) { return el('span', { class: 'mk', title: m.label, 'data-mark': m.id, html: this.svg(m, size) }); },
  /* faixa de marcações de um bloco (editor e leitura) */
  strip(b, size, onClick) {
    if (!b.marks?.length) return null;
    const box = el('span', { class: 'mk-strip' });
    for (const id of b.marks) { const m = this.get(id); if (!m) continue; const x = this.badge(m, size); if (onClick) x.onclick = e => { e.stopPropagation(); onClick(e.currentTarget); }; box.append(x); }
    return box;
  },
  /* para exportações: insere as marcas no começo do elemento (PDF usa SVG; links e cópias usam texto colorido) */
  tag(node, b, plain = false) {
    if (!b.marks?.length || !node?.prepend) return node;
    const box = el('span', { class: 'mk-strip' });
    for (const id of b.marks) { const m = this.get(id); if (!m) continue;
      box.append(plain ? el('span', { class: 'mk-t mk-' + m.id, style: { display: 'inline-block', minWidth: '1.35em', textAlign: 'center', background: m.color, color: '#fff', borderRadius: '1em', fontWeight: '700', fontSize: '.8em', marginRight: '.3em', fontStyle: 'normal', padding: '0 .2em' }, title: m.label, text: m.ch }) : this.badge(m, 18)); }
    node.prepend(box, ' '); return node;
  },
  emoji(b) { return (b.marks || []).map(id => this.get(id)?.emoji).filter(Boolean).join('') ; },
  toggle(b, id) {
    b.marks = b.marks || []; const i = b.marks.indexOf(id);
    if (i >= 0) b.marks.splice(i, 1); else b.marks.push(id);
    if (!b.marks.length) delete b.marks;
    App.touch(); this.refresh(b);
  },
  refresh(b) {
    const w = $(`#blocks .block[data-id="${b.id}"]`); if (!w) return;
    w.querySelector(':scope > .mk-gutter')?.remove();
    const g = this.gutter(b); if (g) w.prepend(g);
    w.classList.toggle('has-marks', !!b.marks?.length);
  },
  gutter(b) {
    const s = this.strip(b, 22, anchor => this.menu(b, anchor)); if (!s) return null;
    s.classList.add('mk-gutter'); return s;
  },
  menu(b, anchor) {
    $('.mk-menu')?.remove();
    const box = el('div', { class: 'mk-menu', role: 'menu' });
    MARKS.forEach((m, i) => {
      const on = b.marks?.includes(m.id);
      box.append(el('button', { class: 'mk-item' + (on ? ' on' : ''), role: 'menuitemcheckbox', 'aria-checked': on ? 'true' : 'false', onclick: () => { this.toggle(b, m.id); box.remove(); } },
        this.badge(m, 24), el('span', { class: 'mk-l', text: m.label }), el('kbd', { text: i < 9 ? 'Alt+' + (i + 1) : '' }), el('span', { class: 'mk-ck', text: on ? '✓' : '' })));
    });
    if (b.marks?.length) box.append(el('button', { class: 'mk-item mk-clear', onclick: () => { delete b.marks; App.touch(); this.refresh(b); box.remove(); } }, el('span', { class: 'mk-l', text: 'Remover todas as marcações' })));
    document.body.append(box);
    const r = anchor.getBoundingClientRect(); const h = box.offsetHeight, w = box.offsetWidth;
    box.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) + 'px';
    box.style.top = (r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4) + 'px';
    setTimeout(() => { const off = e => { if (!box.contains(e.target)) { box.remove(); document.removeEventListener('pointerdown', off, true); } }; document.addEventListener('pointerdown', off, true); }, 0);
  },
  init() {
    document.addEventListener('keydown', e => {
      if (!e.altKey || e.ctrlKey || e.metaKey || !/^Digit[1-9]$/.test(e.code)) return;
      const id = App.focusId; const b = App.cur?.blocks.find(x => x.id === id); if (!b || !$('#editor')?.offsetParent) return;
      const m = MARKS[+e.code.slice(5) - 1]; if (!m) return;
      e.preventDefault(); this.toggle(b, m.id); UI.toast((b.marks?.includes(m.id) ? 'Marcado: ' : 'Desmarcado: ') + m.label);
    });
  }
};

/* ===== Imagem para o telão / redes: título da ministração em arte pronta ===== */
const SLIDE_STYLES = [
  { id: 'noite',   name: 'Noite',        bg: ['#1a0b2e', '#3d1466', '#7719aa'], fg: '#ffffff', sub: '#e2c8ff', accent: '#c58cff', glow: 'rgba(197,140,255,.35)' },
  { id: 'aurora',  name: 'Aurora',       bg: ['#3b0d2c', '#b8325c', '#f29a4b'], fg: '#ffffff', sub: '#ffe3cf', accent: '#ffd08a', glow: 'rgba(255,208,138,.35)' },
  { id: 'oceano',  name: 'Oceano',       bg: ['#03152b', '#0b4a74', '#11a3a3'], fg: '#ffffff', sub: '#c9f1ef', accent: '#7fe3d8', glow: 'rgba(127,227,216,.30)' },
  { id: 'brasa',   name: 'Brasa',        bg: ['#120806', '#4a1408', '#c2410c'], fg: '#fff6ec', sub: '#ffd2a8', accent: '#ff9b4a', glow: 'rgba(255,155,74,.35)' },
  { id: 'pedra',   name: 'Grafite',      bg: ['#0e0e10', '#1f2024', '#34363d'], fg: '#f5f5f5', sub: '#b9bcc6', accent: '#e8c46a', glow: 'rgba(232,196,106,.18)' },
  { id: 'papel',   name: 'Claro',        bg: ['#fbf8f3', '#f2ece2', '#e9e0d1'], fg: '#1c1a17', sub: '#6b5f4f', accent: '#7719aa', glow: 'rgba(119,25,170,.10)' },
  { id: 'foto',    name: 'Sua imagem',   bg: ['#000', '#000', '#000'],          fg: '#ffffff', sub: '#f0f0f0', accent: '#ffffff', glow: 'rgba(0,0,0,0)' }
];
const SLIDE_FORMATS = [['16:9', 1920, 1080, 'Telão 16:9'], ['4:3', 1440, 1080, 'Telão 4:3'], ['1:1', 1080, 1080, 'Feed 1:1'], ['9:16', 1080, 1920, 'Stories 9:16']];
const SLIDE_FONTS = [['moderna', 'Moderna', '"Segoe UI Variable Display","Segoe UI",system-ui,sans-serif', 700], ['classica', 'Clássica', 'Georgia,"Times New Roman",serif', 700], ['condensada', 'Condensada', 'Bahnschrift,"Arial Narrow","Roboto Condensed",sans-serif', 700]];

const Slide = {
  defaults(s) {
    let last = {}; try { last = JSON.parse(localStorage.getItem('ss-slide') || '{}'); } catch (e) { }
    return { style: last.style || 'noite', fmt: last.fmt || '16:9', font: last.font || 'moderna', align: last.align || 'center', footer: last.footer ?? '', upper: !!last.upper,
      title: s.title || '', sub: s.passage || '', kicker: last.kicker ?? 'Série / Tema', showKicker: !!last.showKicker, photo: null, dim: 0.55, ...(s.slide || {}) };
  },
  wrap(ctx, text, maxW) {
    const words = text.split(/\s+/).filter(Boolean); const lines = []; let line = '';
    for (const w of words) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width <= maxW || !line) line = t; else { lines.push(line); line = w; } }
    if (line) lines.push(line); return lines;
  },
  async draw(cv, o) {
    const F = SLIDE_FORMATS.find(f => f[0] === o.fmt) || SLIDE_FORMATS[0]; const W = F[1], H = F[2];
    cv.width = W; cv.height = H; const ctx = cv.getContext('2d');
    const st = SLIDE_STYLES.find(x => x.id === o.style) || SLIDE_STYLES[0];
    const font = SLIDE_FONTS.find(f => f[0] === o.font) || SLIDE_FONTS[0];
    const unit = Math.min(W, H) / 1080;
    /* fundo */
    if (st.id === 'foto' && o.photo) {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = o.photo; }).catch(() => null);
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      if (img) { const k = Math.max(W / img.width, H / img.height); const iw = img.width * k, ih = img.height * k; ctx.drawImage(img, (W - iw) / 2, (H - ih) / 2, iw, ih); }
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, `rgba(0,0,0,${o.dim * .7})`); g.addColorStop(.55, `rgba(0,0,0,${o.dim})`); g.addColorStop(1, `rgba(0,0,0,${Math.min(1, o.dim * 1.25)})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    } else {
      const g = ctx.createLinearGradient(0, H, W, 0); g.addColorStop(0, st.bg[0]); g.addColorStop(.55, st.bg[1]); g.addColorStop(1, st.bg[2]);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      /* luzes suaves */
      for (const [x, y, r] of [[.82, .18, .55], [.12, .92, .45]]) { const rg = ctx.createRadialGradient(W * x, H * y, 0, W * x, H * y, Math.max(W, H) * r); rg.addColorStop(0, st.glow); rg.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H); }
      /* raios de luz finos */
      ctx.save(); ctx.globalAlpha = st.id === 'papel' ? .05 : .07; ctx.strokeStyle = st.accent; ctx.lineWidth = 2 * unit;
      for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.moveTo(W * (0.55 + i * .06), -10); ctx.lineTo(W * (0.15 + i * .09), H + 10); ctx.stroke(); }
      ctx.restore();
      /* grão (textura) */
      const n = Math.round(W * H / 900); ctx.save(); ctx.globalAlpha = st.id === 'papel' ? .05 : .06;
      let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < n; i++) { ctx.fillStyle = rnd() > .5 ? '#fff' : '#000'; ctx.fillRect(rnd() * W, rnd() * H, 1.6 * unit, 1.6 * unit); }
      ctx.restore();
    }
    /* texto */
    const pad = (o.fmt === '9:16' ? 110 : 150) * unit; const maxW = W - pad * 2;
    const title = (o.upper ? o.title.toUpperCase() : o.title).trim() || 'Título da ministração';
    let size = (o.fmt === '9:16' ? 150 : o.fmt === '1:1' ? 128 : 140) * unit, lines;
    const maxLines = o.fmt === '9:16' ? 6 : 4;
    for (; size > 40 * unit; size -= 4 * unit) { ctx.font = `${font[3]} ${size}px ${font[2]}`; lines = this.wrap(ctx, title, maxW); if (lines.length <= maxLines && Math.max(...lines.map(l => ctx.measureText(l).width)) <= maxW) break; }
    const lh = size * 1.08; const subSize = Math.max(30 * unit, size * .36); const kickSize = Math.max(24 * unit, size * .22);
    const blockH = lines.length * lh + (o.sub ? subSize * 2.1 : 0) + (o.showKicker && o.kicker ? kickSize * 2.4 : 0);
    let y = (H - blockH) / 2 + (o.fmt === '9:16' ? -H * .03 : 0);
    const x = o.align === 'left' ? pad : W / 2; ctx.textAlign = o.align === 'left' ? 'left' : 'center'; ctx.textBaseline = 'top';
    const shadow = st.id === 'papel' ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,.35)';
    if (o.showKicker && o.kicker) {
      ctx.font = `600 ${kickSize}px ${SLIDE_FONTS[0][2]}`; ctx.fillStyle = st.accent;
      const k = o.kicker.toUpperCase().split('').join(String.fromCharCode(8202)); ctx.fillText(k, x, y); y += kickSize * 2.4;
    }
    ctx.font = `${font[3]} ${size}px ${font[2]}`; ctx.fillStyle = st.fg; ctx.shadowColor = shadow; ctx.shadowBlur = 24 * unit; ctx.shadowOffsetY = 4 * unit;
    for (const l of lines) { ctx.fillText(l, x, y); y += lh; }
    ctx.shadowColor = 'rgba(0,0,0,0)';
    if (o.sub) {
      y += subSize * .55;
      const lw = 90 * unit; ctx.fillStyle = st.accent; ctx.fillRect(o.align === 'left' ? x : x - lw / 2, y, lw, 5 * unit); y += subSize * .7;
      ctx.font = `500 ${subSize}px ${SLIDE_FONTS[0][2]}`; ctx.fillStyle = st.sub; ctx.fillText(o.sub, x, y);
    }
    if (o.footer) { ctx.font = `600 ${Math.max(22 * unit, 30 * unit)}px ${SLIDE_FONTS[0][2]}`; ctx.fillStyle = st.sub; ctx.globalAlpha = .85; ctx.textAlign = o.align === 'left' ? 'left' : 'center'; ctx.fillText(o.footer, x, H - pad * .62); ctx.globalAlpha = 1; }
    return cv;
  },
  blob(cv) { return new Promise(r => cv.toBlob(r, 'image/png')); },
  open(s) {
    const o = this.defaults(s);
    const cv = el('canvas', { class: 'sl-canvas' });
    const redraw = debounce(() => this.draw(cv, o), 60);
    const save = () => { const { photo, title, sub, ...keep } = o; try { localStorage.setItem('ss-slide', JSON.stringify({ style: o.style, fmt: o.fmt, font: o.font, align: o.align, footer: o.footer, upper: o.upper, kicker: o.kicker, showKicker: o.showKicker })); } catch (e) { }
      s.slide = { style: o.style, fmt: o.fmt, font: o.font, align: o.align, title: o.title, sub: o.sub, kicker: o.kicker, showKicker: o.showKicker, footer: o.footer, upper: o.upper, dim: o.dim }; App.touch(s); };
    const field = (label, key, ph) => { const i = el('input', { class: 'inp', value: o[key] || '', placeholder: ph || '' }); i.oninput = () => { o[key] = i.value; redraw(); }; return [el('label', { class: 'lbl', text: label }), i]; };
    const chips = (list, key, render) => { const box = el('div', { class: 'sl-chips' }); const paint = () => box.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === String(o[key])));
      for (const it of list) box.append(render(it, () => { o[key] = it.id ?? it[0]; paint(); redraw(); photoRow.hidden = o.style !== 'foto'; })); paint(); return box; };
    const styleChips = chips(SLIDE_STYLES, 'style', (st, pick) => el('button', { class: 'sl-sw', 'data-v': st.id, title: st.name, onclick: pick, style: { background: st.id === 'foto' ? 'repeating-linear-gradient(45deg,#444 0 6px,#666 6px 12px)' : `linear-gradient(135deg,${st.bg[0]},${st.bg[1]} 55%,${st.bg[2]})`, color: st.fg } }, el('span', { text: st.name })));
    const fmtChips = chips(SLIDE_FORMATS, 'fmt', (f, pick) => el('button', { class: 'chip', 'data-v': f[0], text: f[3], onclick: pick }));
    const fontChips = chips(SLIDE_FONTS, 'font', (f, pick) => el('button', { class: 'chip', 'data-v': f[0], text: f[1], onclick: pick, style: { fontFamily: f[2] } }));
    const alignChips = chips([['center', 'Centralizado'], ['left', 'À esquerda']], 'align', (a, pick) => el('button', { class: 'chip', 'data-v': a[0], text: a[1], onclick: pick }));
    /* imagem de fundo: arquivo ou imagens desta ministração */
    const thumbs = el('div', { class: 'sl-thumbs' });
    for (const b of s.blocks.filter(b => b.type === 'image' && b.src).slice(0, 8)) thumbs.append(el('img', { src: b.src, title: 'Usar esta imagem', onclick: () => { o.photo = b.src; redraw(); } }));
    const dim = el('input', { type: 'range', min: 0, max: 0.9, step: 0.05, value: o.dim }); dim.oninput = () => { o.dim = +dim.value; redraw(); };
    const photoRow = el('div', { class: 'sl-photo' },
      el('button', { class: 'btn sm', text: '📁 Escolher imagem…', onclick: async () => { const [f] = await pickFiles('image/*'); if (!f) return; o.photo = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); }); redraw(); } }),
      thumbs, el('label', { class: 'lbl', text: 'Escurecer a imagem (para o texto aparecer)' }), dim);
    photoRow.hidden = o.style !== 'foto';
    const upper = el('input', { type: 'checkbox', checked: o.upper }); upper.onchange = () => { o.upper = upper.checked; redraw(); };
    const kick = el('input', { type: 'checkbox', checked: o.showKicker }); kick.onchange = () => { o.showKicker = kick.checked; redraw(); };
    const [kl, ki] = field('Linha acima do título (série, tema, culto)', 'kicker', 'Ex.: Série Romanos');
    const body = el('div', { class: 'sl-wrap' },
      el('div', { class: 'sl-prev' }, cv),
      el('div', { class: 'sl-form' },
        ...field('Título', 'title'), ...field('Subtítulo (texto-base, data…)', 'sub', 'Ex.: Romanos 8:28'),
        el('label', { class: 'sl-ck' }, kick, ' Mostrar linha acima do título'), kl, ki,
        ...field('Rodapé (igreja, @instagram…)', 'footer', 'Ex.: SOW Church'),
        el('label', { class: 'lbl', text: 'Estilo' }), styleChips, photoRow,
        el('label', { class: 'lbl', text: 'Formato' }), fmtChips,
        el('label', { class: 'lbl', text: 'Letra' }), fontChips, alignChips,
        el('label', { class: 'sl-ck' }, upper, ' Título em MAIÚSCULAS')));
    const m = UI.modal({ title: 'Imagem para o telão', body, wide: true, onClose: save, actions: [
      { label: 'Copiar imagem', onClick: async () => { save(); await this.draw(cv, o); try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': this.blob(cv) })]); UI.toast('Imagem copiada — cole no ProPresenter, Holyrics, PowerPoint ou WhatsApp.'); } catch (e) { UI.toast('O navegador não deixou copiar. Use “Baixar PNG”.'); } return false; } },
      { label: 'Tela cheia', onClick: async () => { save(); await this.draw(cv, o); this.present(cv); return false; } },
      { label: 'Baixar PNG', primary: true, onClick: async () => { save(); await this.draw(cv, o); await saveFile(safeName(o.title || 'telao') + ` (${o.fmt.replace(':', 'x')}).png`, await this.blob(cv)); return false; } }] });
    this.draw(cv, o);
    return m;
  },
  /* mostra a arte ocupando a tela (arraste a janela para o projetor e toque para sair) */
  present(cv) {
    const url = cv.toDataURL('image/png');
    const ov = el('div', { class: 'sl-present', title: 'Toque ou Esc para sair' }, el('img', { src: url, alt: '' }));
    const close = () => { document.exitFullscreen?.().catch(() => { }); ov.remove(); document.removeEventListener('keydown', key); };
    const key = e => { if (e.key === 'Escape') close(); };
    ov.onclick = close; document.addEventListener('keydown', key); document.body.append(ov);
    ov.requestFullscreen?.().catch(() => { });
  }
};
