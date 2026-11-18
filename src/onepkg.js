/* ===================================================================
   Importação de cadernos do OneNote no formato .onepkg
   .onepkg = arquivo CAB (compressão LZX ou MSZIP) com um .one por seção
   e o .onetoc2 (sumário do caderno). O .one segue o MS-ONESTORE.
   =================================================================== */

/* ---------- LZX (como no CAB) ---------- */
function lzxDecompress(input, outSize, windowBits) {
  const WSIZE = 1 << windowBits, win = new Uint8Array(WSIZE), out = new Uint8Array(outSize);
  const slots = { 15: 30, 16: 32, 17: 34, 18: 36, 19: 38, 20: 42, 21: 50 }[windowBits];
  const EXTRA = new Uint8Array(51), BASE = new Uint32Array(51);
  { let j = 0; for (let i = 0; i < 51; i++) { EXTRA[i] = i < 4 ? 0 : Math.min(17, (i - 2) >> 1); BASE[i] = j; j += 1 << EXTRA[i]; } }
  let ip = 0, bitbuf = 0, bitsLeft = 0;
  const ensure = n => { while (bitsLeft < n) { const w = ip + 1 < input.length ? input[ip] | (input[ip + 1] << 8) : ip < input.length ? input[ip] : 0; ip += 2; bitbuf = (bitbuf | (w << (16 - bitsLeft))) >>> 0; bitsLeft += 16; } };
  const peek = n => bitbuf >>> (32 - n);
  const drop = n => { bitbuf = (bitbuf << n) >>> 0; bitsLeft -= n; };
  const read = n => { if (!n) return 0; if (n > 16) { const hi = read(n - 16); return (hi << 16 | read(16)) >>> 0; } ensure(n); const v = peek(n); drop(n); return v; };
  /* tabela canônica de Huffman (bits MSB primeiro) */
  const makeTable = (lens, n) => {
    const max = Math.max(1, ...Array.from(lens.subarray(0, n))); const count = new Uint16Array(max + 1), next = new Uint32Array(max + 2);
    for (let i = 0; i < n; i++) count[lens[i]]++; count[0] = 0;
    for (let b = 1, code = 0; b <= max; b++) { code = (code + count[b - 1]) << 1; next[b] = code; }
    const TB = Math.min(max, 12), table = new Int32Array(1 << TB).fill(-1), long = new Map();
    for (let s = 0; s < n; s++) { const L = lens[s]; if (!L) continue; const c = next[L]++;
      if (L <= TB) { const sh = TB - L; for (let k = 0; k < 1 << sh; k++) table[(c << sh) | k] = (s << 5) | L; } else long.set(L + ':' + c, s); }
    return { TB, table, long, max };
  };
  const decode = t => {
    ensure(Math.min(32, Math.max(t.max, 16))); const e = t.table[peek(t.TB)];
    if (e >= 0) { drop(e & 31); return e >>> 5; }
    for (let L = t.TB + 1; L <= t.max; L++) { ensure(L); const s = t.long.get(L + ':' + peek(L)); if (s !== undefined) { drop(L); return s; } }
    throw new Error('LZX: código inválido');
  };
  const MAIN_N = 256 + slots * 8;
  const mainLen = new Uint8Array(MAIN_N), lenLen = new Uint8Array(249), alLen = new Uint8Array(8);
  const readLens = (lens, first, last) => {
    const pl = new Uint8Array(20); for (let i = 0; i < 20; i++) pl[i] = read(4);
    const pt = makeTable(pl, 20);
    for (let x = first; x < last;) {
      const z = decode(pt);
      if (z === 17) { let y = read(4) + 4; while (y-- && x < last) lens[x++] = 0; }
      else if (z === 18) { let y = read(5) + 20; while (y-- && x < last) lens[x++] = 0; }
      else if (z === 19) { let y = read(1) + 4; const z2 = decode(pt); const v = (lens[x] + 17 - z2) % 17; while (y-- && x < last) lens[x++] = v; }
      else { lens[x] = (lens[x] + 17 - z) % 17; x++; }
    }
  };
  let R0 = 1, R1 = 1, R2 = 1, wpos = 0, op = 0, intel = false, intelSize = 0, header = false, frameNo = 0;
  let blockType = 0, blockRemain = 0, blockOdd = 0, mainT = null, lenT = null, alT = null;
  const FRAME = 32768;
  const put = b => { win[wpos] = b; wpos = (wpos + 1) & (WSIZE - 1); if (op < outSize) out[op] = b; op++; };
  while (op < outSize) {
    if (!header) { intel = read(1) === 1; if (intel) intelSize = (read(16) << 16 | read(16)) >>> 0; header = true; }
    const frameStart = frameNo * FRAME, frameEnd = Math.min(outSize, ++frameNo * FRAME);
    while (op < frameEnd) {
      if (blockRemain === 0) {
        blockType = read(3); blockRemain = (read(16) << 8 | read(8)) >>> 0; blockOdd = blockRemain & 1;
        if (blockType === 2) { for (let i = 0; i < 8; i++) alLen[i] = read(3); alT = makeTable(alLen, 8); }
        if (blockType === 1 || blockType === 2) {
          readLens(mainLen, 0, 256); readLens(mainLen, 256, MAIN_N); mainT = makeTable(mainLen, MAIN_N);
          readLens(lenLen, 0, 249); lenT = makeTable(lenLen, 249);
        } else if (blockType === 3) {
          ensure(16); if (bitsLeft > 16) ip -= 2; bitsLeft = 0; bitbuf = 0;
          const r32 = () => { const v = (input[ip] | input[ip + 1] << 8 | input[ip + 2] << 16 | input[ip + 3] << 24) >>> 0; ip += 4; return v; };
          R0 = r32(); R1 = r32(); R2 = r32();
        } else throw new Error('LZX: tipo de bloco inválido ' + blockType);
      }
      let n = Math.min(blockRemain, frameEnd - op);
      if (blockType === 3) {
        for (let i = 0; i < n; i++) put(input[ip++]);
        blockRemain -= n;
        if (blockRemain === 0 && blockOdd) ip++;
        continue;
      }
      while (n > 0) {
        const m = decode(mainT);
        if (m < 256) { put(m); n--; blockRemain--; continue; }
        const mm = m - 256; let len = mm & 7; if (len === 7) len += decode(lenT); len += 2;
        const slot = mm >> 3; let off;
        if (slot === 0) off = R0;
        else if (slot === 1) { off = R1; R1 = R0; R0 = off; }
        else if (slot === 2) { off = R2; R2 = R0; R0 = off; }
        else {
          const eb = EXTRA[slot]; off = BASE[slot] - 2;
          if (blockType === 2) {
            if (eb > 3) { off += read(eb - 3) << 3; off += decode(alT); }
            else if (eb === 3) off += decode(alT);
            else if (eb > 0) off += read(eb);
            else off = 1;
          } else off += read(eb);
          R2 = R1; R1 = R0; R0 = off;
        }
        for (let k = 0; k < len; k++) put(win[(wpos - off) & (WSIZE - 1)]);
        n -= len; blockRemain -= len;
      }
      if (blockRemain < 0) throw new Error('LZX: bloco ultrapassado');
    }
    /* tradução E8 (código Intel) — raramente ligada em arquivos do OneNote */
    if (intel && frameEnd - frameStart > 10 && frameStart < 0x40000000) {
      for (let i = frameStart; i < frameEnd - 10; i++) if (out[i] === 0xE8) {
        const abs = (out[i + 1] | out[i + 2] << 8 | out[i + 3] << 16 | out[i + 4] << 24) | 0; const cur = i;
        if (abs >= -cur && abs < intelSize) { const rel = abs >= 0 ? abs - cur : abs + intelSize; out[i + 1] = rel & 255; out[i + 2] = rel >> 8 & 255; out[i + 3] = rel >> 16 & 255; out[i + 4] = rel >>> 24 & 255; }
        i += 4;
      }
    }
    /* fim do quadro: realinha em 16 bits */
    if (bitsLeft & 15) drop(bitsLeft & 15);
  }
  return out;
}

/* ---------- CAB ---------- */
async function cabExtract(buf) {
  const d = buf instanceof Uint8Array ? buf : new Uint8Array(buf); const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  if (String.fromCharCode(d[0], d[1], d[2], d[3]) !== 'MSCF') throw new Error('Não é um pacote do OneNote (.onepkg) válido.');
  const coffFiles = v.getUint32(16, true), nFolders = v.getUint16(26, true), nFiles = v.getUint16(28, true), flags = v.getUint16(30, true);
  let p = 36, cbFolderRes = 0, cbDataRes = 0;
  if (flags & 4) { const cbRes = v.getUint16(p, true); cbFolderRes = d[p + 2]; cbDataRes = d[p + 3]; p += 4 + cbRes; }
  if (flags & 1) { while (d[p++]); while (d[p++]); } if (flags & 2) { while (d[p++]); while (d[p++]); }
  const folders = [];
  for (let i = 0; i < nFolders; i++) { folders.push({ off: v.getUint32(p, true), n: v.getUint16(p + 4, true), type: v.getUint16(p + 6, true) }); p += 8 + cbFolderRes; }
  const files = []; p = coffFiles;
  for (let i = 0; i < nFiles; i++) {
    const size = v.getUint32(p, true), off = v.getUint32(p + 4, true), folder = v.getUint16(p + 8, true), attr = v.getUint16(p + 14, true); p += 16;
    let e = p; while (d[e]) e++; const raw = d.subarray(p, e); p = e + 1;
    let name; try { name = new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch (e) { name = new TextDecoder('windows-1252').decode(raw); }
    files.push({ name: name.replace(/\\/g, '/'), size, off, folder });
  }
  const outs = [];
  for (const f of folders) {
    let q = f.off; const chunks = []; let total = 0, totalOut = 0;
    for (let i = 0; i < f.n; i++) { const cb = v.getUint16(q + 4, true), ucb = v.getUint16(q + 6, true); q += 8 + cbDataRes; chunks.push({ data: d.subarray(q, q + cb), ucb }); q += cb; total += cb; totalOut += ucb; }
    const kind = f.type & 0xf; let out;
    if (kind === 0) { out = new Uint8Array(totalOut); let o = 0; for (const c of chunks) { out.set(c.data, o); o += c.data.length; } }
    else if (kind === 3) { const all = new Uint8Array(total); let o = 0; for (const c of chunks) { all.set(c.data, o); o += c.data.length; } out = lzxDecompress(all, totalOut, (f.type >> 8) & 0x1f); }
    else if (kind === 1) { out = await mszipDecompress(chunks, totalOut); }
    else throw new Error('Compressão do pacote não suportada (' + kind + ').');
    outs.push(out);
  }
  return files.map(f => ({ name: f.name, data: outs[f.folder].subarray(f.off, f.off + f.size) }));
}
/* MSZIP: cada bloco é deflate com o dicionário do bloco anterior — usamos um inflate próprio */
async function mszipDecompress(chunks, total) {
  const out = new Uint8Array(total); let o = 0;
  for (const c of chunks) { if (c.data[0] !== 0x43 || c.data[1] !== 0x4B) throw new Error('MSZIP inválido'); o = inflateInto(c.data.subarray(2), out, o); }
  return out;
}
function inflateInto(src, out, op) {
  let sp = 0, bb = 0, bc = 0;
  const bits = n => { while (bc < n) { bb |= src[sp++] << bc; bc += 8; } const v = bb & ((1 << n) - 1); bb >>>= n; bc -= n; return v; };
  const build = lens => { const max = Math.max(...lens); const cnt = new Uint16Array(max + 1); lens.forEach(l => cnt[l]++); cnt[0] = 0; const offs = new Uint16Array(max + 2); for (let i = 1; i <= max; i++) offs[i + 1] = offs[i] + cnt[i]; const sym = new Uint16Array(lens.length); lens.forEach((l, s) => { if (l) sym[offs[l]++] = s; }); return { cnt, sym, max }; };
  const dec = h => { let code = 0, first = 0, idx = 0; for (let l = 1; l <= h.max; l++) { code |= bits(1); const c = h.cnt[l]; if (code - first < c) return h.sym[idx + code - first]; idx += c; first = (first + c) << 1; code <<= 1; } throw new Error('inflate'); };
  const LB = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258], LE = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DB = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577], DE = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  let last;
  do {
    last = bits(1); const t = bits(2);
    if (t === 0) { bb = 0; bc = 0; const len = src[sp] | src[sp + 1] << 8; sp += 4; out.set(src.subarray(sp, sp + len), op); op += len; sp += len; continue; }
    let lt, dt;
    if (t === 1) { const l = new Array(288).fill(8, 0, 144).fill(9, 144, 256).fill(7, 256, 280).fill(8, 280, 288); lt = build(l); dt = build(new Array(30).fill(5)); }
    else { const hl = bits(5) + 257, hd = bits(5) + 1, hc = bits(4) + 4; const ord = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]; const cl = new Array(19).fill(0); for (let i = 0; i < hc; i++) cl[ord[i]] = bits(3); const ch = build(cl);
      const L = []; while (L.length < hl + hd) { const s = dec(ch); if (s < 16) L.push(s); else if (s === 16) { const p = L[L.length - 1]; for (let r = bits(2) + 3; r--;) L.push(p); } else if (s === 17) for (let r = bits(3) + 3; r--;) L.push(0); else for (let r = bits(7) + 11; r--;) L.push(0); }
      lt = build(L.slice(0, hl)); dt = build(L.slice(hl)); }
    for (;;) { const s = dec(lt); if (s < 256) out[op++] = s; else if (s === 256) break; else { const li = s - 257, len = LB[li] + bits(LE[li]); const di = dec(dt), dist = DB[di] + bits(DE[di]); for (let k = 0; k < len; k++, op++) out[op] = out[op - dist]; } }
  } while (!last);
  return op;
}

/* ---------- MS-ONESTORE (.one / .onetoc2) ---------- */
const OneStore = (() => {
  const hex = (b, i) => b[i].toString(16).padStart(2, '0');
  const guidStr = (d, p) => { const g = i => hex(d, p + i); return `{${g(3)}${g(2)}${g(1)}${g(0)}-${g(5)}${g(4)}-${g(7)}${g(6)}-${g(8)}${g(9)}-${g(10)}${g(11)}${g(12)}${g(13)}${g(14)}${g(15)}}`.toUpperCase(); };
  const NIL = '{00000000-0000-0000-0000-000000000000}';
  const P = { // propriedades (sem o bit de valor booleano)
    ElementChildNodes: 0x24001C1F, ContentChildNodes: 0x24001C20, StructureElementChildNodes: 0x24001D5F, ChildGraphSpaceElementNodes: 0x2C001D63,
    MetaDataObjectsAboveGraphSpace: 0x24003442, CachedTitleString: 0x1C001CF3, CachedTitleStringFromPage: 0x1C001D3C, PageLevel: 0x14001DFF,
    RichEditTextUnicode: 0x1C001C22, TextExtendedAscii: 0x1C003498, TextRunIndex: 0x1C001E12, TextRunFormatting: 0x24001E13, ParagraphStyle: 0x2400342C, ParagraphStyleId: 0x1C00342D,
    Bold: 0x08001C04, Italic: 0x08001C05, Underline: 0x08001C06, Strike: 0x08001C07, Superscript: 0x08001C08, Subscript: 0x08001C09, FontColor: 0x14001C0C, Highlight: 0x14001C0D, Hyperlink: 0x08001E14,
    ListNodes: 0x24001C26, NumberListFormat: 0x1C001C1A, PictureContainer: 0x20001C3F, CreationTimeStamp: 0x14001D09, LastModifiedTime: 0x14001D7A, TopologyCreationTimeStamp: 0x18001C65,
    ImageAltText: 0x1C001C9F, EmbeddedFileName: 0x1C001D9C, IsTitleText: 0x08001C88
  };
  const J = { SectionNode: 0x00060007, PageSeriesNode: 0x00060008, PageNode: 0x0006000B, OutlineNode: 0x0006000C, OutlineElementNode: 0x0006000D, RichTextOENode: 0x0006000E, ImageNode: 0x00060011,
    NumberListNode: 0x00060012, OutlineGroup: 0x00060019, TableNode: 0x00060022, TableRowNode: 0x00060023, TableCellNode: 0x00060024, TitleNode: 0x0006002C, PageMetaData: 0x00020030,
    PageManifestNode: 0x00060037, EmbeddedFileNode: 0x00060035, InkNode: 0x00060047 };

  function parse(buf) {
    const d = buf, v = new DataView(d.buffer, d.byteOffset, d.byteLength);
    const u32 = p => v.getUint32(p, true), u16 = p => v.getUint16(p, true), u64 = p => v.getUint32(p, true) + v.getUint32(p + 4, true) * 4294967296;
    const eg = p => { const g = guidStr(d, p), n = u32(p + 16); return g === NIL && !n ? null : g + ':' + n; };
    /* log de transações: quantos nós de cada lista estão confirmados */
    const committed = new Map();
    { let stp = u64(160), cb = u32(168), left = u32(96);
      while (stp && cb && left > 0) { const n = Math.floor((cb - 12) / 8);
        for (let i = 0; i < n && left > 0; i++) { const id = u32(stp + i * 8), sw = u32(stp + i * 8 + 4); if (id === 1) left--; else if (id) committed.set(id, sw); }
        const nx = stp + n * 8; stp = u64(nx); cb = u32(nx + 8); } }
    /* lista de nós (com fragmentos) */
    const readList = (stp, cb) => {
      const nodes = []; let listId = null, max = Infinity, guard = 0;
      while (stp && cb && guard++ < 100000) {
        if (u32(stp) !== 0xF5F7F4C4 || u32(stp + 4) !== 0xA4567AB1) break;
        if (listId === null) { listId = u32(stp + 8); max = committed.get(listId) ?? Infinity; }
        let p = stp + 16; const end = stp + cb - 20;
        while (p + 4 <= end && nodes.length < max) {
          const h = u32(p), id = h & 0x3FF, size = (h >>> 10) & 0x1FFF, stpF = (h >>> 23) & 3, cbF = (h >>> 25) & 3, base = (h >>> 27) & 0xF;
          if (!id || id === 0xFF || size < 4) break;
          const node = { id, p, end: p + size, base };
          let q = p + 4;
          if (base === 1 || base === 2) {
            let rs, rc; if (stpF === 0) { rs = u64(q); q += 8; } else if (stpF === 1) { rs = u32(q); q += 4; } else if (stpF === 2) { rs = u16(q) * 8; q += 2; } else { rs = u32(q) * 8; q += 4; }
            if (cbF === 0) { rc = u32(q); q += 4; } else if (cbF === 1) { rc = u64(q); q += 8; } else if (cbF === 2) { rc = d[q] * 8; q += 1; } else { rc = u16(q) * 8; q += 2; }
            node.ref = { stp: rs, cb: rc };
          }
          node.q = q; nodes.push(node); p += size;
        }
        const nx = stp + cb - 20; stp = u64(nx); cb = u32(nx + 8);
        if (nodes.length >= max) break;
      }
      return nodes;
    };
    const sub = n => n.ref && n.ref.stp && n.ref.stp !== 0xFFFFFFFFFFFFFFFF ? readList(n.ref.stp, n.ref.cb) : [];

    /* armazém de arquivos (imagens) */
    const files = new Map();
    { const stp = u64(172), cb = u32(180);
      for (const n of readList(stp, cb)) if (n.id === 0x090) for (const f of sub(n)) if (f.id === 0x094) {
        const g = guidStr(d, f.q); const o = f.ref.stp; const len = u64(o + 16); files.set(g, d.subarray(o + 36, o + 36 + len)); } }

    /* lê um ObjectSpaceObjectPropSet */
    const readPropSet = (stp, table) => {
      let p = stp; const stream = () => { const h = u32(p); p += 4; const n = h & 0xFFFFFF, ext = (h >>> 30) & 1, osidAbsent = h >>> 31; const ids = []; for (let i = 0; i < n; i++) { const c = u32(p); p += 4; ids.push(c ? (table.get(c >>> 8) || '?') + ':' + (c & 0xFF) : null); } return { ids, osidAbsent, ext }; };
      const oids = stream(); let osids = { ids: [] }, ctx = { ids: [] };
      if (!oids.osidAbsent) { osids = stream(); if (osids.ext) ctx = stream(); }
      const oi = { i: 0 }, si = { i: 0 }, ci = { i: 0 };
      const readSet = () => {
        const n = u16(p); p += 2; const ids = []; for (let i = 0; i < n; i++) { ids.push(u32(p)); p += 4; }
        const props = new Map();
        for (const raw of ids) {
          const type = (raw >>> 26) & 0x1F, key = raw & 0x7FFFFFFF; let val = null;
          switch (type) {
            case 1: val = true; break; case 2: val = !!(raw >>> 31); break;
            case 3: val = d[p]; p += 1; break; case 4: val = u16(p); p += 2; break; case 5: val = u32(p); p += 4; break; case 6: val = d.subarray(p, p + 8); p += 8; break;
            case 7: { const cb = u32(p); p += 4; val = d.subarray(p, p + cb); p += cb; break; }
            case 8: val = oids.ids[oi.i++]; break;
            case 9: { const c = u32(p); p += 4; val = oids.ids.slice(oi.i, oi.i + c); oi.i += c; break; }
            case 10: val = osids.ids[si.i++]; break;
            case 11: { const c = u32(p); p += 4; val = osids.ids.slice(si.i, si.i + c); si.i += c; break; }
            case 12: val = ctx.ids[ci.i++]; break;
            case 13: { const c = u32(p); p += 4; val = ctx.ids.slice(ci.i, ci.i + c); ci.i += c; break; }
            case 16: { const c = u32(p); p += 4; if (c) p += 4; val = []; for (let i = 0; i < c; i++) val.push(readSet()); break; }
            case 17: val = readSet(); break;
            default: val = null;
          }
          props.set(key, val);
        }
        return props;
      };
      return readSet();
    };

    /* espaços de objetos (seção e cada página) */
    const spaces = new Map(); let rootSpace = null;
    const root = readList(u64(172), u32(180));
    for (const n of root) {
      if (n.id === 0x004) rootSpace = eg(n.q);
      if (n.id !== 0x008) continue;
      const gosid = eg(n.q); const osm = sub(n);
      const rml = [...osm].reverse().find(x => x.id === 0x010); if (!rml) continue;
      const revs = new Map(); const roles = new Map(); let cur = null, last = null;
      for (const r of sub(rml)) {
        if (r.id === 0x01B || r.id === 0x01E || r.id === 0x01F) {
          const rid = eg(r.q), dep = eg(r.q + 20); const role = r.id === 0x01B ? u32(r.q + 48) : u32(r.q + 40);
          const ctxId = r.id === 0x01F ? eg(r.q + 46) : null;
          cur = { rid, dep, table: new Map(), objs: new Map(), roots: new Map() }; revs.set(rid, cur); if (!ctxId) { last = rid; if (role === 1) roles.set('def', rid); }
        } else if (!cur) continue;
        else if (r.id === 0x024) cur.table.set(u32(r.q), guidStr(d, r.q + 4));
        else if (r.id === 0x025 || r.id === 0x026) { const dp = revs.get(cur.dep); if (dp) { if (r.id === 0x025) cur.table.set(u32(r.q + 4), dp.table.get(u32(r.q))); else { const fs = u32(r.q), c = u32(r.q + 4), ts = u32(r.q + 8); for (let i = 0; i < c; i++) cur.table.set(ts + i, dp.table.get(fs + i)); } } }
        else if (r.id === 0x05A) cur.roots.set(u32(r.q + 20), eg(r.q));
        else if (r.id === 0x059) { const c = u32(r.q); cur.roots.set(u32(r.q + 4), (cur.table.get(c >>> 8) || '?') + ':' + (c & 0xFF)); }
        else if (r.id === 0x05C || r.id === 0x05D) { const role = u32(r.q + 20); const ctxId = r.id === 0x05D ? eg(r.q + 24) : null; if (role === 1 && !ctxId) roles.set('def', eg(r.q)); }
        else if (r.id === 0x0B0) {
          const table = new Map();
          for (const o of sub(r)) {
            if (o.id === 0x024) table.set(u32(o.q), guidStr(d, o.q + 4));
            else if (o.id === 0x0A4 || o.id === 0x0A5 || o.id === 0x0C4 || o.id === 0x0C5) { const c = u32(o.q); const oid = (table.get(c >>> 8) || '?') + ':' + (c & 0xFF); cur.objs.set(oid, { jcid: u32(o.q + 4), ref: o.ref, table }); }
            else if (o.id === 0x072 || o.id === 0x073) { const c = u32(o.q); const oid = (table.get(c >>> 8) || '?') + ':' + (c & 0xFF); let q = o.q + 8 + (o.id === 0x072 ? 1 : 4); const cch = u32(q); q += 4; const s = new TextDecoder('utf-16le').decode(d.subarray(q, q + cch * 2)); cur.objs.set(oid, { jcid: u32(o.q + 4), file: s }); }
          }
        }
        else if (r.id === 0x02D || r.id === 0x02E) { const c = u32(r.q); const oid = (cur.table.get(c >>> 8) || '?') + ':' + (c & 0xFF); const w = u16(r.q + 4) | (u16(r.q + 6) << 16); cur.objs.set(oid, { jcid: 0x00060000 | (w & 0x3FF), ref: r.ref, table: cur.table, old: true }); }
      }
      /* revisão atual com herança das dependentes */
      const resolve = (rid, seen = new Set()) => { const r = revs.get(rid); if (!r || seen.has(rid)) return { objs: new Map(), roots: new Map() }; seen.add(rid); const base = resolve(r.dep, seen); return { objs: new Map([...base.objs, ...r.objs]), roots: new Map([...base.roots, ...r.roots]) }; };
      const st = resolve(roles.get('def') || last);
      st.revs = revs; st.cur = roles.get('def') || last;
      spaces.set(gosid, st);
    }
    const cache = new Map();
    const obj = (space, oid) => {
      if (!oid) return null; const k = oid; const o = space.objs.get(oid); if (!o) return null;
      if (!o.props && o.ref) { try { o.props = readPropSet(o.ref.stp, o.table); } catch (e) { o.props = new Map(); o.err = e; } }
      return o;
    };
    return { spaces, rootSpace, obj, files, P, J };
  }
  return { parse, P, J };
})();

/* ---------- .one → páginas em HTML ---------- */
const OneNoteImport = {
  td: new TextDecoder('utf-16le'), ta: new TextDecoder('windows-1252'),
  str(v) { return v instanceof Uint8Array ? this.td.decode(v).replace(/\0+$/, '') : ''; },
  time32(t) { if (!t) return null; const d = new Date(Date.UTC(1980, 0, 1) + t * 1000); return isNaN(d) ? null : d; },
  color(c, text = false) {
    if (c == null || c === 0xFFFFFFFF || (c >>> 24) === 0xFF) return null; const r = c & 255, g = c >> 8 & 255, b = c >> 16 & 255;
    /* letra branca/clarinha (comum em cabeçalhos de tabela coloridos) some no editor: descarta */
    if (text && (0.299 * r + 0.587 * g + 0.114 * b) > 200) return null;
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
  },
  mime(b) { if (b[0] === 0x89 && b[1] === 0x50) return 'image/png'; if (b[0] === 0xFF && b[1] === 0xD8) return 'image/jpeg'; if (b[0] === 0x47 && b[1] === 0x49) return 'image/gif'; if (b[0] === 0x42 && b[1] === 0x4D) return 'image/bmp'; return null; },
  b64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); },
  /* uma seção (.one) */
  section(buf) {
    const R = OneStore.parse(buf), { P, J } = OneStore; const self = this;
    const root = R.spaces.get(R.rootSpace); if (!root) return [];
    const sec = R.obj(root, root.roots.get(1)); if (!sec) return [];
    const kids = (sp, o, k) => (o?.props?.get(k) || []).map(id => R.obj(sp, id)).filter(Boolean);
    const pages = [];
    for (const series of kids(root, sec, 0x24001C20)) {
      const metas = kids(root, series, P.MetaDataObjectsAboveGraphSpace); const ids = series.props.get(P.ChildGraphSpaceElementNodes) || [];
      ids.forEach((pid, i) => {
        const meta = metas[i]; const sp = R.spaces.get(pid); if (!sp) return;
        try { const pg = this.page(R, sp, kids); if (!pg) return;
          const t = this.str(meta?.props?.get(P.CachedTitleString)) || pg.title;
          pages.push({ title: (t || '').trim() || null, date: pg.date, level: Math.max(0, Math.min(2, (meta?.props?.get(P.PageLevel) || 1) - 1)), html: pg.html, stats: pg.stats });
        } catch (e) { console.warn('OneNote: página ignorada', e); }
      });
    }
    return pages;
  },
  page(R, sp, kids) {
    const { P } = OneStore; const self = this; const stats = { img: 0, ink: 0, table: 0, file: 0 };
    const man = R.obj(sp, sp.roots.get(1)); if (!man) return null;
    const node = kids(sp, man, 0x24001C1F).find(o => o.jcid === 0x0006000B) || man;
    let firstTime = null; const seen = new Set();
    const styleId = o => { const ps = R.obj(sp, o.props.get(0x2000342C)); return ps ? this.str(ps.props.get(0x1C00345A)) : ''; };
    const runs = o => {
      const u = o.props.get(P.RichEditTextUnicode), a = o.props.get(P.TextExtendedAscii);
      let text = u ? this.td.decode(u) : a ? this.ta.decode(a) : ''; text = text.replace(/\0+$/, '');
      if (!text) return '';
      const idxRaw = o.props.get(P.TextRunIndex); const idx = []; if (idxRaw) for (let i = 0; i + 3 < idxRaw.length; i += 4) idx.push(idxRaw[i] | idxRaw[i + 1] << 8 | idxRaw[i + 2] << 16 | idxRaw[i + 3] << 24);
      const fmts = (o.props.get(P.TextRunFormatting) || []).map(id => R.obj(sp, id));
      let html = '', start = 0; const bounds = [...idx, text.length];
      bounds.forEach((end, k) => {
        let seg = text.slice(start, end); start = end; if (!seg) return;
        const f = fmts[k]?.props; let t = esc(seg.replace(/[﷟\u0001-\u0008\u000B\u000C\u000E-\u001F]/g, '')).replace(/\r\n|\r|\n|\u000B/g, '<br>');
        if (f) {
          if (f.get(0x08001E14)) { const m = seg.match(/HYPERLINK\s+"([^"]+)"/); if (m) { pendingLink = m[1]; return; } }
          if (f.get(P.Bold)) t = `<b>${t}</b>`; if (f.get(P.Italic)) t = `<i>${t}</i>`; if (f.get(P.Underline)) t = `<u>${t}</u>`; if (f.get(P.Strike)) t = `<s>${t}</s>`;
          if (f.get(P.Superscript)) t = `<sup>${t}</sup>`; if (f.get(P.Subscript)) t = `<sub>${t}</sub>`;
          const hl = this.color(f.get(P.Highlight)), fc = this.color(f.get(P.FontColor), true);
          if (hl || (fc && fc !== '#000000')) t = `<span style="${hl ? 'background-color:' + hl + ';' : ''}${fc && fc !== '#000000' ? 'color:' + fc : ''}">${t}</span>`;
        }
        if (pendingLink) { t = `<a href="${esc(pendingLink)}">${t}</a>`; pendingLink = null; }
        html += t;
      });
      return html.replace(/HYPERLINK\s+"[^"]*"/g, '');
    };
    let pendingLink = null;
    const content = o => {
      if (seen.has(o)) return ''; seen.add(o);
      const t = o.props.get(P.CreationTimeStamp); if (t && (!firstTime || t < firstTime)) firstTime = t;
      switch (o.jcid) {
        case 0x0006000E: return runs(o);
        case 0x00060011: { const pc = R.obj(sp, o.props.get(P.PictureContainer)); const g = pc?.file?.match(/\{[0-9A-F-]+\}/i)?.[0]?.toUpperCase(); const bytes = g && R.files.get(g); const mt = bytes && this.mime(bytes);
          if (mt) { stats.img++; return `<img src="data:${mt};base64,${this.b64(bytes)}" alt="">`; } stats.img++; return '<i>[imagem do OneNote não importada]</i>'; }
        case 0x00060022: { stats.table++; let h = '<table>'; for (const row of kids(sp, o, 0x24001C20)) { h += '<tr>'; for (const cell of kids(sp, row, 0x24001C20)) h += '<td>' + oes(kids(sp, cell, 0x24001C20)) + '</td>'; h += '</tr>'; } return h + '</table>'; }
        case 0x00060035: { stats.file++; return `<i>[anexo: ${esc(this.str(o.props.get(P.EmbeddedFileName)) || 'arquivo')}]</i>`; }
        default: if ((o.jcid & 0xFFFF) === 0x0047 || (o.jcid & 0xFFFF) === 0x0048) { stats.ink++; return '<i>[desenho à mão do OneNote]</i>'; } return '';
      }
    };
    /* elementos de estrutura (OE) com filhos e listas */
    const oes = list => {
      let h = '', open = null;
      const close = () => { if (open) { h += `</${open}>`; open = null; } };
      for (const oe of list) {
        if (oe.jcid === 0x00060019) { close(); h += oes(kids(sp, oe, 0x24001C20)); continue; }
        if (oe.jcid !== 0x0006000D) { close(); h += content(oe); continue; }
        const st = kids(sp, oe, 0x24001C1F).map(c => [c, c.jcid === 0x0006000E ? styleId(c) : '']);
        if (st.some(([, s]) => s === 'PageTitle' || s === 'PageDateTime')) continue;
        let inner = st.map(([c, s]) => { const x = content(c); if (!x) return ''; const hm = /^h([1-6])$/.exec(s); return hm ? `<h${Math.min(6, +hm[1] + 1)}>${x}</h${Math.min(6, +hm[1] + 1)}>` : s === 'quote' || s === 'cite' ? `<blockquote>${x}</blockquote>` : x; }).join('');
        const ln = kids(sp, oe, P.ListNodes)[0]; const fmt = ln ? this.str(ln.props.get(P.NumberListFormat)) : '';
        const child = kids(sp, oe, 0x24001C20); const sub = child.length ? oes(child) : '';
        if (ln) { const tag = /�/.test(fmt) ? 'ol' : 'ul'; if (open !== tag) { close(); h += `<${tag}>`; open = tag; } h += `<li>${inner}${sub}</li>`; }
        else { close(); if (inner.trim()) h += /^<(h\d|blockquote|table|img)/.test(inner) ? inner : `<p>${inner}</p>`; if (sub) h += /^<(ul|ol)/.test(sub) ? sub : `<div style="margin-left:2em">${sub}</div>`; }
      }
      close(); return h;
    };
    let html = '';
    for (const el0 of kids(sp, node, 0x24001C20)) html += el0.jcid === 0x0006000C ? oes(kids(sp, el0, 0x24001C20)) : content(el0);
    /* título e data a partir da área de título, se precisar */
    let title = '';
    for (const tn of kids(sp, node, 0x24001D5F)) for (const ol of kids(sp, tn, 0x24001C20)) for (const oe of kids(sp, ol, 0x24001C20)) for (const c of kids(sp, oe, 0x24001C1F)) {
      const tt = c.props.get(P.CreationTimeStamp) || oe.props.get(P.CreationTimeStamp); if (tt && (!firstTime || tt < firstTime)) firstTime = tt;
      if (c.jcid === 0x0006000E && styleId(c) === 'PageTitle') title = (this.str(c.props.get(P.RichEditTextUnicode)) || this.ta.decode(c.props.get(P.TextExtendedAscii) || new Uint8Array())).replace(/\0/g, '');
    }
    const d = this.time32(firstTime);
    return { html, title, date: d ? d.toISOString().slice(0, 10) : null, stats };
  },
  /* caderno inteiro: ordem das seções pelo .onetoc2 (por pasta = grupo de seções) */
  async package(buf, onStep) {
    const files = await cabExtract(buf);
    const order = new Map();
    for (const f of files.filter(f => /\.onetoc2$/i.test(f.name))) {
      const dir = f.name.includes('/') ? f.name.slice(0, f.name.lastIndexOf('/') + 1) : '';
      try { const R = OneStore.parse(f.data); let k = 0;
        for (const sp of R.spaces.values()) { const rootObj = R.obj(sp, sp.roots.get(1)); for (const id of rootObj?.props?.get(0x24001CF6) || []) { const o = R.obj(sp, id); const nm = this.str(o?.props?.get(0x1C001D6B)); if (nm) order.set(dir + nm, k++); } }
      } catch (e) { }
    }
    const secs = files.filter(f => /\.one$/i.test(f.name) && !/OneNote_RecycleBin|Lixeira/i.test(f.name));
    secs.sort((a, b) => { const da = a.name.split('/').length, db = b.name.split('/').length; return (da - db) || ((order.get(a.name) ?? 999) - (order.get(b.name) ?? 999)) || a.name.localeCompare(b.name, 'pt-BR'); });
    const out = [];
    for (const f of secs) {
      onStep && onStep(f.name); await new Promise(r => setTimeout(r, 0));
      const base = f.name.replace(/\.one$/i, '').replace(/\//g, ' › ');
      try { out.push({ base, pages: this.section(f.data) }); } catch (e) { console.error(e); out.push({ base, pages: [], error: e.message }); }
    }
    return out;
  }
};
