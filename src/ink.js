/* ===== Tinta (caneta do Surface) =====
   Coordenadas normalizadas pela largura: x,y em unidades de largura (0..1 em x).
   stroke = {c: cor, w: espessura relativa, hl: marca-texto, p: [x,y,pressão, ...]} */
function hexLum(c) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})/i.exec(c || ''); if (!m) return 0;
  const [r, g, b] = [m[1], m[2], m[3]].map(x => parseInt(x, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function inkColor(c, theme) { return theme === 'dark' && hexLum(c) < 0.15 ? '#f1f1f1' : c; }
function drawStroke(ctx, s, W, theme) {
  const p = s.p; if (!p || p.length < 3) return;
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = ctx.fillStyle = inkColor(s.c, theme);
  if (s.hl) {
    ctx.globalAlpha = 0.38; ctx.lineCap = 'square'; ctx.lineWidth = s.w * W; ctx.beginPath(); ctx.moveTo(p[0] * W, p[1] * W);
    if (p.length === 3) ctx.lineTo(p[0] * W + 0.5, p[1] * W); for (let i = 3; i < p.length; i += 3) ctx.lineTo(p[i] * W, p[i + 1] * W); ctx.stroke();
  } else if (p.length === 3) {
    ctx.beginPath(); ctx.arc(p[0] * W, p[1] * W, Math.max(0.6, s.w * W * (0.35 + 1.3 * p[2]) / 2), 0, 7); ctx.fill();
  } else {
    for (let i = 3; i < p.length; i += 3) segment(ctx, s, p[i - 3], p[i - 2], p[i - 1], p[i], p[i + 1], p[i + 2], W);
  }
  ctx.restore();
}
function segment(ctx, s, x0, y0, p0, x1, y1, p1, W) {
  ctx.lineWidth = Math.max(0.6, s.w * W * (0.35 + 1.3 * (p0 + p1) / 2));
  ctx.beginPath(); ctx.moveTo(x0 * W, y0 * W); ctx.lineTo(x1 * W, y1 * W); ctx.stroke();
}

class InkSurface {
  constructor(block, wrap, { readOnly = false, theme = null, onChange = null } = {}) {
    this.b = block; block.ink ||= { hr: 0.32, strokes: [] }; this.d = block.ink;
    this.wrap = wrap; this.readOnly = readOnly; this.theme = theme; this.onChange = onChange;
    this.canvas = el('canvas', { class: 'ink-canvas' }); wrap.append(this.canvas);
    this.ctx = this.canvas.getContext('2d'); this.W = 0;
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(wrap);
    if (!readOnly) this.bind();
  }
  destroy() { this.ro.disconnect(); }
  resize() {
    const w = this.wrap.clientWidth; if (!w) return;
    const dpr = window.devicePixelRatio || 1, hgt = Math.round(w * this.d.hr);
    this.W = w; this.canvas.style.width = w + 'px'; this.canvas.style.height = hgt + 'px';
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(hgt * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); this.redraw();
  }
  redraw() {
    this.ctx.clearRect(0, 0, this.W, this.W * this.d.hr);
    for (const s of this.d.strokes) drawStroke(this.ctx, s, this.W, this.theme);
    if (this.cur) drawStroke(this.ctx, this.cur, this.W, this.theme);
  }
  pt(e) {
    const r = this.canvas.getBoundingClientRect();
    const pr = e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5;
    return { x: (e.clientX - r.left) / this.W, y: (e.clientY - r.top) / this.W, pr };
  }
  bind() {
    const cv = this.canvas; cv.style.touchAction = 'none';
    cv.addEventListener('pointerdown', e => this.down(e));
    cv.addEventListener('pointermove', e => this.move(e));
    cv.addEventListener('pointerup', e => this.up(e));
    cv.addEventListener('pointercancel', e => this.up(e));
    cv.addEventListener('contextmenu', e => e.preventDefault());
  }
  down(e) {
    const ink = App.ink; App.lastInk = this;
    if (e.pointerType === 'touch' && !ink.finger) { this.panId = e.pointerId; this.panY = e.clientY; this.cap(e); return; }
    e.preventDefault(); this.cap(e);
    const erase = ink.tool === 'eraser' || (e.buttons & 32) || e.button === 5;
    const p = this.pt(e);
    if (erase) { this.mode = 'erase'; this.eraseAt(p); return; }
    this.mode = 'draw';
    const hl = ink.tool === 'marker';
    this.cur = { c: hl ? ink.hlColor : ink.color, w: (hl ? ink.size * 7 + 8 : ink.size) / 800, hl: hl ? 1 : 0, p: [p.x, p.y, p.pr] };
  }
  cap(e) { try { this.canvas.setPointerCapture(e.pointerId); } catch (_) { } }
  move(e) {
    if (this.panId === e.pointerId) { App.scroller.scrollTop -= (e.clientY - this.panY); this.panY = e.clientY; return; }
    if (!this.mode) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (evs.length ? evs : [e])) {
      const p = this.pt(ev);
      if (this.mode === 'erase') { this.eraseAt(p); continue; }
      const a = this.cur.p, n = a.length;
      if (Math.hypot(p.x - a[n - 3], p.y - a[n - 2]) * this.W < 0.7) continue;
      if (!this.cur.hl) { this.ctx.save(); this.ctx.lineCap = 'round'; this.ctx.strokeStyle = inkColor(this.cur.c, this.theme); segment(this.ctx, this.cur, a[n - 3], a[n - 2], a[n - 1], p.x, p.y, p.pr, this.W); this.ctx.restore(); }
      a.push(p.x, p.y, p.pr);
      if (this.cur.hl) this.redraw();
    }
    if (this.mode === 'draw') { const y = this.cur.p[this.cur.p.length - 2]; if (y > this.d.hr - 0.04) { this.d.hr += 0.12; this.resize(); } }
  }
  up(e) {
    if (this.panId === e.pointerId) { this.panId = null; return; }
    if (this.mode === 'draw' && this.cur) { this.d.strokes.push(this.cur); this.cur = null; this.redraw(); this.changed(); }
    else if (this.mode === 'erase' && this.erased) { this.erased = false; this.changed(); }
    this.mode = null;
  }
  eraseAt(p) {
    const r = 10 / this.W; const before = this.d.strokes.length;
    this.d.strokes = this.d.strokes.filter(s => { for (let i = 0; i < s.p.length; i += 3) if (Math.hypot(s.p[i] - p.x, s.p[i + 1] - p.y) < r + s.w / 2) return false; return true; });
    if (this.d.strokes.length !== before) { this.erased = true; this.redraw(); }
  }
  undo() { if (this.d.strokes.pop()) { this.redraw(); this.changed(); } }
  clear() { this.d.strokes = []; this.redraw(); this.changed(); }
  changed() { this.onChange && this.onChange(); }
}

/* Renderiza tinta como PNG (para exportação) */
function inkToDataURL(ink, width = 1200, bg = null) {
  const c = document.createElement('canvas'); c.width = width; c.height = Math.max(1, Math.round(width * ink.hr));
  const ctx = c.getContext('2d'); if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, c.width, c.height); }
  for (const s of ink.strokes) drawStroke(ctx, s, width, null);
  return c.toDataURL('image/png');
}
/* Remove espaço vazio abaixo do último traço (para leitura/exportação) */
function inkContentHR(ink) { let maxY = 0; for (const s of ink.strokes) for (let i = 1; i < s.p.length; i += 3) maxY = Math.max(maxY, s.p[i] + s.w); return Math.min(ink.hr, Math.max(0.06, maxY + 0.02)); }
