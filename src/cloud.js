/* ===== Nuvem (Supabase): login e sincronização entre aparelhos =====
   Offline-first: o app trabalha sempre na cópia local (IndexedDB) e sincroniza em segundo plano.
   Sem bibliotecas: fala direto com as APIs REST do Supabase (Auth, PostgREST e Storage). */
const Cloud = {
  session: null, status: 'off', syncing: false, again: false, lastError: '', timer: null,
  st: { synced: {}, tombs: {}, lastPull: 0, lastMeta: 0, metaSynced: 0, at: 0 }, // estado de sincronização (por aparelho)

  /* ---------- configuração ---------- */
  cfg() {
    let local = {}; try { local = JSON.parse(localStorage.getItem('ss-cloud') || '{}'); } catch (e) { }
    const g = window.SMARTSERMON_CONFIG || {};
    const url = (local.url || g.supabaseUrl || '').trim().replace(/\/+$/, '');
    const key = (local.key || g.supabaseAnonKey || '').trim();
    return { url, key };
  },
  configured() { const c = this.cfg(); return /^https:\/\/.+/.test(c.url) && c.key.length > 20; },
  saveCfg(url, key) { try { localStorage.setItem('ss-cloud', JSON.stringify({ url, key })); } catch (e) { } },
  redirect() { return location.origin + location.pathname; },

  /* ---------- sessão ---------- */
  loadSession() { try { this.session = JSON.parse(localStorage.getItem('ss-session') || 'null'); } catch (e) { this.session = null; } },
  saveSession(s) { this.session = s; try { s ? localStorage.setItem('ss-session', JSON.stringify(s)) : localStorage.removeItem('ss-session'); } catch (e) { } },
  sessionFrom(j) { return { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + ((+j.expires_in || 3600) - 60) * 1000, user: j.user ? { id: j.user.id, email: j.user.email } : this.session?.user }; },
  userFromToken(t) { try { const c = JSON.parse(decodeURIComponent(escape(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))); return { id: c.sub, email: c.email }; } catch (e) { return null; } },
  /* Volta do Google / link mágico: tokens chegam no #hash da URL */
  captureRedirect() {
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get('access_token')) {
      const s = this.sessionFrom({ access_token: h.get('access_token'), refresh_token: h.get('refresh_token'), expires_in: h.get('expires_in') });
      s.user = this.userFromToken(s.access_token); this.saveSession(s);
      history.replaceState(null, '', location.pathname + location.search);
      return 'ok';
    }
    if (h.get('error_description') || h.get('error')) { const m = h.get('error_description') || h.get('error'); history.replaceState(null, '', location.pathname + location.search); return m; }
    return null;
  },
  async auth(path, body, method = 'POST') {
    const c = this.cfg();
    const r = await fetch(`${c.url}/auth/v1/${path}`, { method, headers: { apikey: c.key, 'Content-Type': 'application/json', ...(this.session && path === 'user' ? { Authorization: 'Bearer ' + this.session.access_token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(this.authMsg(j.error_description || j.msg || j.message || j.error || ('Erro ' + r.status)));
    return j;
  },
  authMsg(m) {
    const map = [[/Invalid login credentials/i, 'E-mail ou senha incorretos.'], [/Email not confirmed/i, 'Confirme seu e-mail: abra o link que o Supabase enviou e depois entre de novo.'],
      [/User already registered/i, 'Este e-mail já tem conta. Use “Entrar”.'], [/Password should be at least/i, 'A senha precisa ter pelo menos 6 caracteres.'],
      [/rate limit|For security purposes/i, 'Muitas tentativas seguidas. Aguarde um minuto e tente de novo.'], [/provider is not enabled|Unsupported provider/i, 'O login com Google não está ativado no seu projeto Supabase (Authentication › Providers › Google).']];
    for (const [rx, t] of map) if (rx.test(m)) return t; return m;
  },
  async signIn(email, password) { const j = await this.auth('token?grant_type=password', { email, password }); this.saveSession(this.sessionFrom(j)); },
  async signUp(email, password) {
    const j = await this.auth(`signup?redirect_to=${encodeURIComponent(this.redirect())}`, { email, password });
    if (j.access_token) { this.saveSession(this.sessionFrom(j)); return 'in'; }
    return 'confirm';
  },
  async magicLink(email) { await this.auth(`otp?redirect_to=${encodeURIComponent(this.redirect())}`, { email, create_user: true }); },
  async providers() {
    if (this._prov) return this._prov;
    try { const c = this.cfg(); const r = await fetch(`${c.url}/auth/v1/settings`, { headers: { apikey: c.key } }); const j = await r.json(); this._prov = j.external || {}; } catch (e) { this._prov = {}; }
    return this._prov;
  },
  google() { const c = this.cfg(); location.href = `${c.url}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(this.redirect())}`; },
  async signOut() {
    try { const c = this.cfg(); await fetch(`${c.url}/auth/v1/logout`, { method: 'POST', headers: { apikey: c.key, Authorization: 'Bearer ' + this.session?.access_token } }); } catch (e) { }
    this.saveSession(null); this.setStatus('out');
  },
  async token() {
    if (!this.session) throw Object.assign(new Error('Entre na sua conta'), { auth: true });
    if (Date.now() < this.session.expires_at) return this.session.access_token;
    const c = this.cfg();
    const r = await fetch(`${c.url}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: c.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: this.session.refresh_token }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { if (r.status >= 400 && r.status < 500) { this.saveSession(null); throw Object.assign(new Error('Sessão expirada. Entre novamente.'), { auth: true }); } throw new Error('Sem conexão com o Supabase'); }
    this.saveSession(this.sessionFrom(j)); return this.session.access_token;
  },
  async rest(path, opts = {}) {
    const c = this.cfg(); const t = await this.token();
    const r = await fetch(`${c.url}${path}`, { ...opts, headers: { apikey: c.key, Authorization: 'Bearer ' + t, ...(opts.headers || {}) } });
    if (r.status === 401) { this.session.expires_at = 0; throw Object.assign(new Error('Sessão expirada'), { retry: true }); }
    if (!r.ok) { let m = 'Erro ' + r.status; try { const j = await r.json(); m = j.message || j.error || m; } catch (e) { } if (/relation .* does not exist|Could not find the table/i.test(m)) m = 'As tabelas não existem no Supabase. Rode o script supabase.sql no SQL Editor.'; throw new Error(m); }
    return r;
  },

  /* ---------- estado ---------- */
  async init() {
    this.loadSession();
    const back = this.captureRedirect();
    this.st = Object.assign(this.st, (await DB.get('kv', 'sync')) || {});
    window.addEventListener('online', () => this.schedule(500));
    window.addEventListener('offline', () => this.setStatus('offline'));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.schedule(800); });
    window.addEventListener('storage', e => { if (e.key === 'ss-session') { this.loadSession(); this.schedule(300); } }); // login feito em outra aba/janela
    $('#btn-cloud').onclick = () => CloudUI.open();
    if (back === 'ok') UI.toast('Conectado à nuvem. Sincronizando…'); else if (back) UI.toast('Login: ' + back);
    this.timer = setInterval(() => this.schedule(0), 90000);
    if (!this.configured()) this.setStatus('setup'); else if (!this.session) this.setStatus('out'); else this.schedule(300);
  },
  saveState: debounce(() => DB.put('kv', 'sync', Cloud.st), 300),
  setStatus(s, extra) {
    this.status = s; const b = $('#btn-cloud'); if (!b) return;
    const L = { setup: ['☁', 'Configurar nuvem'], out: ['☁', 'Entrar'], syncing: ['⟳', 'Sincronizando…'], ok: ['☁✓', 'Sincronizado'], offline: ['☁', 'Offline'], error: ['☁!', 'Erro na sincronização'], pending: ['☁', 'Alterações pendentes'] }[s];
    b.textContent = L[0] + ' ' + L[1]; b.dataset.state = s;
    b.title = s === 'ok' ? `Sincronizado às ${new Date(this.st.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : (extra || L[1]);
  },
  /* chamado sempre que algo muda localmente */
  schedule(ms = 4000) {
    if (!this.configured() || !this.session) return;
    clearTimeout(this._t); this._t = setTimeout(() => this.sync(), ms);
    if (this.status === 'ok') this.setStatus('pending');
  },
  tomb(id) { this.st.tombs[id] = Date.now(); delete this.st.synced[id]; this.saveState(); this.schedule(); },

  /* ---------- sincronização ---------- */
  async sync() {
    if (!this.configured() || !this.session) return;
    if (!navigator.onLine) return this.setStatus('offline');
    if (this.syncing) { this.again = true; return; }
    this.syncing = true; this.setStatus('syncing');
    try {
      App.flush();
      await this.syncMeta();
      await this.pull();
      await this.push();
      this.st.at = Date.now(); this.saveState(); this.lastError = '';
      this.setStatus('ok');
    } catch (e) {
      console.warn('sync', e); this.lastError = e.message;
      if (e.auth) this.setStatus('out', e.message); else if (!navigator.onLine) this.setStatus('offline'); else this.setStatus('error', e.message);
      if (e.retry && !this._retried) { this._retried = true; this.syncing = false; return this.sync(); }
    } finally { this.syncing = false; this._retried = false; }
    if (this.again) { this.again = false; this.schedule(1500); }
  },
  uid() { return this.session.user?.id || this.userFromToken(this.session.access_token)?.id; },

  /* Cadernos/seções/tipos: une por id; o mais recente vence nos itens em comum; exclusões viajam como lista */
  metaPayload() {
    const m = App.meta;
    return { notebooks: m.notebooks, sections: m.sections, customTypes: m.customTypes || [], deleted: m.deleted || {}, theme: m.theme, readerTheme: m.readerTheme };
  },
  async syncMeta() {
    const r = await this.rest('/rest/v1/user_meta?select=data,updated_at,server_updated');
    const rows = await r.json(); const remote = rows[0];
    const m = App.meta; m.deleted ||= {}; m.metaUpdated ||= 0;
    let changed = false;
    if (remote && remote.server_updated > this.st.lastMeta) {
      const rd = remote.data || {}; const del = { ...(rd.deleted || {}), ...m.deleted }; m.deleted = del;
      const firstTime = !this.st.metaSynced;
      const merge = (loc, rem, key) => {
        const out = []; const byId = new Map(loc.map(x => [x.id, x]));
        for (const x of rem || []) {
          if (del[x.id]) continue;
          if (firstTime && !byId.has(x.id)) { // primeira vez neste aparelho: junta itens com o mesmo nome em vez de duplicar
            const twin = loc.find(l => !rem.some(r2 => r2.id === l.id) && l.name === x.name && (key !== 'sections' || (l.nb === x.nb || this.remapNb?.[l.nb] === x.nb)));
            if (twin) { this.remap(key, twin.id, x.id); byId.delete(twin.id); }
          }
          const l = byId.get(x.id);
          out.push(l && m.metaUpdated > remote.updated_at ? l : x); byId.delete(x.id);
        }
        for (const l of byId.values()) if (!del[l.id] && !(rem || []).some(x => x.id === l.id)) out.push(l);
        return out;
      };
      this.remapNb = {};
      m.notebooks = merge(m.notebooks, rd.notebooks, 'notebooks');
      m.sections = merge(m.sections.map(s => ({ ...s, nb: this.remapNb[s.nb] || s.nb })), rd.sections, 'sections');
      m.customTypes = merge(m.customTypes || [], rd.customTypes, 'customTypes');
      if (remote.updated_at > m.metaUpdated) { if (rd.theme) m.theme = rd.theme; if (rd.readerTheme) m.readerTheme = rd.readerTheme; }
      this.st.lastMeta = remote.server_updated; changed = true;
      if (!m.notebooks.length) { const nb = { id: uid(), name: 'Ministrações', color: '#7719aa' }; m.notebooks.push(nb); }
      if (!m.notebooks.some(n => n.id === m.currentNb)) m.currentNb = m.notebooks[0].id;
      if (!m.sections.some(s => s.id === m.currentSec)) m.currentSec = m.sections.find(s => s.nb === m.currentNb)?.id || null;
      registerCustomTypes(); await DB.put('kv', 'meta', m);
    }
    if (!remote || m.metaUpdated > (this.st.metaSynced || 0) || changed) {
      const body = { user_id: this.uid(), data: this.metaPayload(), updated_at: Math.max(m.metaUpdated, remote?.updated_at || 0) };
      const r2 = await this.rest('/rest/v1/user_meta?on_conflict=user_id', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(body) });
      const saved = (await r2.json())[0]; if (saved) this.st.lastMeta = saved.server_updated;
      this.st.metaSynced = Date.now();
    }
    if (changed) { App.renderNav(); Ribbon.renderCustom(); Theme.apply(); }
  },
  remap(key, from, to) {
    const m = App.meta;
    if (key === 'notebooks') { this.remapNb[from] = to; m.sections.forEach(s => { if (s.nb === from) s.nb = to; }); if (m.currentNb === from) m.currentNb = to; }
    if (key === 'sections') { for (const s of App.sermons.values()) if (s.sec === from) { s.sec = to; App.touch(s); } if (m.currentSec === from) m.currentSec = to; }
  },

  async pull() {
    const before = App.cur && JSON.stringify(App.cur);
    let n = 0, conflicts = 0, cursor = this.st.lastPull || 0, more = true; const conflictIds = new Set();
    while (more) {
      // 1) lista leve (sem conteúdo) do que mudou desde a última vez
      const r = await this.rest(`/rest/v1/sermons?select=id,updated_at,deleted,server_updated&server_updated=gt.${cursor}&order=server_updated.asc&limit=500`);
      const rows = await r.json(); more = rows.length === 500;
      const need = [];
      for (const row of rows) {
        cursor = Math.max(cursor, row.server_updated);
        const local = App.sermons.get(row.id);
        if (this.st.tombs[row.id] && !row.deleted) continue;
        if (row.deleted) {
          if (local && local.updated <= row.updated_at) { App.sermons.delete(row.id); await DB.del('sermons', row.id); n++; }
          this.st.synced[row.id] = row.updated_at; continue;
        }
        if (local) {
          const synced = this.st.synced[row.id] || 0;
          if (row.updated_at === synced) continue;                                      // é o que já temos (eco do nosso envio)
          if (local.updated === row.updated_at) { this.st.synced[row.id] = row.updated_at; continue; }
          if (local.updated > synced && synced) { need.push(row.id); conflictIds.add(row.id); continue; } // mudou nos dois lados
          if (row.updated_at < local.updated) continue;
        }
        need.push(row.id);
      }
      // 2) baixa o conteúdo só do que precisa
      for (let i = 0; i < need.length; i += 40) {
        const ids = need.slice(i, i + 40).map(x => `"${x}"`).join(',');
        const r2 = await this.rest(`/rest/v1/sermons?select=id,data,updated_at&id=in.(${encodeURIComponent(ids)})`);
        for (const row of await r2.json()) {
          const local = App.sermons.get(row.id);
          if (local && conflictIds.has(row.id)) { // os dois lados mudaram: a versão da nuvem fica, a deste aparelho vira cópia
            const copy = structuredClone(local); copy.id = uid(); copy.title = `${local.title} (conflito — outra versão, ${new Date(local.updated).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })})`; copy.updated = Date.now();
            App.sermons.set(copy.id, copy); await DB.put('sermons', copy.id, copy); conflicts++;
          }
          const s = row.data; s.id = row.id; s.updated = row.updated_at;
          await this.inflateImages(s);
          App.sermons.set(s.id, s); await DB.put('sermons', s.id, s);
          this.st.synced[s.id] = row.updated_at; n++;
        }
      }
      this.st.lastPull = cursor; this.saveState();
    }
    if (n || conflicts) {
      App.renderNav();
      if (App.cur && !App.sermons.has(App.cur.id)) { App.cur = null; App.renderEditor(); }
      else if (App.cur) {
        const fresh = App.sermons.get(App.cur.id);
        if (fresh !== App.cur && JSON.stringify(fresh) !== before) {
          const editing = document.activeElement && $('#editor').contains(document.activeElement);
          if (editing) UI.toast('Esta ministração foi alterada em outro aparelho.', { label: 'Recarregar', fn: () => App.open(fresh.id) });
          else { App.cur = fresh; App.renderEditor(); }
        }
      }
      if (conflicts) UI.toast(`${conflicts} ministração(ões) editada(s) nos dois aparelhos — guardei as duas versões.`);
    }
  },
  async push() {
    const uidv = this.uid();
    const rows = [];
    for (const [id, ts] of Object.entries(this.st.tombs)) rows.push({ user_id: uidv, id, data: {}, updated_at: ts, deleted: true, _tomb: true });
    for (const s of App.sermons.values()) {
      if (s.welcome) continue;
      if ((this.st.synced[s.id] || 0) >= s.updated) continue;
      if (await this.uploadImages(s)) await DB.put('sermons', s.id, s);
      rows.push({ user_id: uidv, id: s.id, data: this.outbound(s), updated_at: s.updated, deleted: false });
    }
    if (!rows.length) return;
    // envia em lotes de até ~1,5 MB
    let batch = [], size = 0;
    const send = async () => {
      if (!batch.length) return;
      const body = JSON.stringify(batch.map(({ _tomb, ...r }) => r));
      await this.rest('/rest/v1/sermons?on_conflict=user_id,id', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body });
      for (const r of batch) { this.st.synced[r.id] = r.updated_at; if (r._tomb) delete this.st.tombs[r.id]; }
      this.saveState(); batch = []; size = 0;
    };
    for (const r of rows) { const len = JSON.stringify(r.data).length; if (size + len > 1500000) await send(); batch.push(r); size += len; }
    await send();
  },
  /* cópia para a nuvem: imagens viram referência ao Storage */
  outbound(s) {
    const c = structuredClone(s);
    c.blocks.forEach(b => { if (b.type === 'image' && b.cloud) b.src = ''; });
    return c;
  },
  async uploadImages(s) {
    let changed = false;
    for (const b of s.blocks) {
      if (b.type !== 'image' || !b.src || b.cloud || !b.src.startsWith('data:')) continue;
      const { bytes, mime } = dataURLtoBytes(b.src);
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 32);
      const path = `${this.uid()}/${hash}.${mime === 'image/png' ? 'png' : 'jpg'}`;
      await this.rest(`/storage/v1/object/images/${path}`, { method: 'POST', headers: { 'Content-Type': mime, 'x-upsert': 'true' }, body: bytes });
      b.cloud = path; await DB.put('images', path, b.src); changed = true;
    }
    return changed;
  },
  async inflateImages(s) {
    for (const b of s.blocks || []) {
      if (b.type !== 'image' || b.src || !b.cloud) continue;
      let d = await DB.get('images', b.cloud);
      if (!d) { try { const r = await this.rest(`/storage/v1/object/authenticated/images/${b.cloud}`); const blob = await r.blob(); d = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); }); await DB.put('images', b.cloud, d); } catch (e) { console.warn('imagem', e); } }
      if (d) b.src = d;
    }
  }
};

/* ===== Janela da conta / nuvem ===== */
const CloudUI = {
  open() {
    const body = el('div', { class: 'cloud' });
    this.m = UI.modal({ title: 'Nuvem — usar em vários aparelhos', body, wide: true });
    this.body = body; this.route();
  },
  set(...n) { this.body.innerHTML = ''; this.body.append(...n); },
  route() { if (!Cloud.configured()) return this.viewSetup(); if (!Cloud.session) return this.viewLogin(); this.viewAccount(); },
  viewSetup() {
    const c = Cloud.cfg();
    const url = el('input', { class: 'inp', placeholder: 'Project URL — https://xxxx.supabase.co', value: c.url });
    const key = el('input', { class: 'inp', placeholder: 'anon public key (chave pública)', value: c.key });
    this.set(el('p', { html: 'Ligue o SmartSermon ao seu projeto do <b>Supabase</b>. Os dados ficam protegidos por login: cada pessoa só vê as próprias ministrações.' }),
      el('ol', { class: 'steps', html: '<li>No Supabase, abra o projeto › <b>SQL Editor</b> › cole o conteúdo do arquivo <code>supabase.sql</code> › <b>Run</b>.</li><li>Em <b>Project Settings › API</b>, copie a <b>Project URL</b> e a chave <b>anon public</b>.</li><li>Em <b>Authentication › URL Configuration</b>, coloque o endereço do app em <b>Site URL</b>: <code>' + esc(Cloud.redirect()) + '</code></li>' }),
      url, key, el('div', { class: 'row-btns', style: { marginTop: '10px' } }, el('button', { class: 'btn primary', text: 'Salvar', onclick: () => {
        if (!/^https:\/\/.+/.test(url.value.trim()) || key.value.trim().length < 20) return UI.toast('Confira a URL e a chave');
        Cloud.saveCfg(url.value.trim().replace(/\/+$/, ''), key.value.trim()); this.route(); Cloud.setStatus(Cloud.session ? 'pending' : 'out');
      } })),
      el('p', { class: 'muted small', text: 'Dica: deixando a URL e a chave no arquivo config.js do site, nenhum aparelho precisa digitar isso.' }));
  },
  viewLogin(msg) {
    const email = el('input', { class: 'inp', type: 'email', placeholder: 'seu e-mail', autocomplete: 'email' });
    const pass = el('input', { class: 'inp', type: 'password', placeholder: 'senha (mínimo 6 caracteres)', autocomplete: 'current-password' });
    const out = el('p', { class: 'small', text: msg || '' });
    // Só mostra "Entrar com Google" se o provedor estiver ativado no Supabase
    const gbtn = el('button', { class: 'btn', text: 'Entrar com Google', hidden: true, onclick: () => Cloud.google() });
    Cloud.providers().then(p => { if (p.google) gbtn.hidden = false; });
    const run = async (fn) => { out.textContent = 'Aguarde…'; try { const r = await fn(); if (r !== false) { if (Cloud.session) { out.textContent = ''; this.viewAccount(); Cloud.schedule(100); } } } catch (e) { out.textContent = e.message; } };
    this.set(
      el('p', { text: 'Entre com a mesma conta em todos os seus aparelhos (Surface, notebook…). As ministrações deste aparelho são enviadas e juntadas às da nuvem.' }),
      email, el('div', { style: { height: '8px' } }), pass,
      el('div', { class: 'row-btns', style: { marginTop: '10px', flexWrap: 'wrap' } },
        el('button', { class: 'btn primary', text: 'Entrar', onclick: () => run(() => Cloud.signIn(email.value.trim(), pass.value)) }),
        el('button', { class: 'btn', text: 'Criar conta', onclick: () => run(async () => { const r = await Cloud.signUp(email.value.trim(), pass.value); if (r === 'confirm') { out.textContent = 'Conta criada! Abra o e-mail de confirmação do Supabase e depois clique em “Entrar”.'; return false; } }) }),
        el('button', { class: 'btn', text: 'Receber link por e-mail', onclick: () => run(async () => { await Cloud.magicLink(email.value.trim()); out.textContent = 'Enviamos um link para o seu e-mail. Abra-o neste aparelho para entrar.'; return false; }) }),
        gbtn),
      out,
      el('p', { class: 'small' }, el('button', { class: 'btn link', text: 'Configurar projeto Supabase', onclick: () => this.viewSetup() })));
    setTimeout(() => email.focus(), 50);
  },
  viewAccount() {
    const u = Cloud.session?.user || Cloud.userFromToken(Cloud.session.access_token) || {};
    const pend = [...App.sermons.values()].filter(s => !s.welcome && (Cloud.st.synced[s.id] || 0) < s.updated).length + Object.keys(Cloud.st.tombs).length;
    this.set(
      el('p', {}, 'Conectado como ', el('b', { text: u.email || '—' })),
      el('p', { class: 'muted', text: Cloud.st.at ? `Última sincronização: ${new Date(Cloud.st.at).toLocaleString('pt-BR')}` : 'Ainda não sincronizado neste aparelho.' }),
      pend ? el('p', { class: 'muted', text: `${pend} alteração(ões) aguardando envio.` }) : null,
      Cloud.lastError ? el('p', { class: 'on-log', text: '⚠ ' + Cloud.lastError }) : null,
      el('div', { class: 'row-btns' },
        el('button', { class: 'btn primary', text: 'Sincronizar agora', onclick: async () => { await Cloud.sync(); this.viewAccount(); } }),
        el('button', { class: 'btn', text: 'Sair desta conta', onclick: async () => { await Cloud.signOut(); this.viewLogin('Você saiu. As ministrações continuam salvas neste aparelho.'); } })),
      el('p', { class: 'muted small', text: 'A Bíblia baixada fica em cada aparelho (não ocupa a nuvem). Ministrações, cadernos, seções, tipos de bloco e imagens sincronizam.' }));
  }
};
