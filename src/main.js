/* ===== Inicialização ===== */
window.addEventListener('DOMContentLoaded', () => {
  if (handleAuthPopup()) return;
  App.init().catch(e => { console.error(e); document.body.insertAdjacentHTML('afterbegin', `<div class="fatal">Erro ao iniciar: ${esc(e.message)}</div>`); });
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && window.top === window && !/claude|anthropic/.test(location.hostname)) {
    navigator.serviceWorker.register('sw.js').catch(() => { });
  }
});
