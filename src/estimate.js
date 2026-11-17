/* ===== Estimativa de duração =====
   Base: palavras faladas ÷ ritmo (130 palavras/min por padrão) + tempo extra para desenhos/imagens.
   Calibração: cada pregação registrada ensina o seu ritmo real (minutos por palavra das SUAS notas),
   o que corrige automaticamente o fato de anotações em tópicos renderem muito mais tempo falado. */
const Estimate = {
  WPM: 130, EXTRA_VISUAL: 0.5,
  words(html) { const t = htmlToText(html); return t ? t.split(/\s+/).filter(Boolean).length : 0; },
  blockWords(b) { return b.type === 'ink' || b.type === 'image' ? 0 : this.words(b.html) + (b.type === 'verse' ? this.words(b.ref || '') : 0); },
  blockExtraMin(b) { return (b.type === 'ink' && b.ink?.strokes?.length) || b.type === 'image' ? this.EXTRA_VISUAL : 0; },
  samples() {
    const out = [];
    for (const s of App.sermons.values()) for (const p of (s.preached || [])) if (p.words > 30 && p.minutes >= 3) out.push({ k: p.minutes / p.words, t: p.at || 0 });
    return out.sort((a, b) => b.t - a.t).slice(0, 12);
  },
  /* minutos por palavra: mediana das pregações registradas; senão, padrão */
  rate() {
    const s = this.samples(); if (!s.length) return { k: 1 / this.WPM, n: 0 };
    const ks = s.map(x => x.k).sort((a, b) => a - b); const m = ks.length >> 1;
    return { k: ks.length % 2 ? ks[m] : (ks[m - 1] + ks[m]) / 2, n: ks.length };
  },
  ofBlocks(blocks, k) { let w = 0, extra = 0; for (const b of blocks) { w += this.blockWords(b); extra += this.blockExtraMin(b); } return { words: w, minutes: w * k + extra }; },
  sermon(s) { const r = this.rate(); const e = this.ofBlocks(s.blocks, r.k); return { ...e, calibrated: r.n, wpm: Math.round(1 / r.k) }; },
  fmt(min) { if (min < 1) return '< 1 min'; const m = Math.round(min); return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`; },
  label(e) { return e.calibrated ? `pelo seu ritmo real (${e.calibrated} pregação${e.calibrated > 1 ? 'ões' : ''} registrada${e.calibrated > 1 ? 's' : ''})` : `padrão de ${this.WPM} palavras/min — registre suas pregações para calibrar`; }
};
