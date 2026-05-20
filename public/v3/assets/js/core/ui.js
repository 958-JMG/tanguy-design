// UI helpers v3 — toasts non-bloquants, modale confirm (Sprint 4 polish UX)

let toastContainer = null;

function ensureToastContainer() {
  if (toastContainer) return toastContainer;
  toastContainer = document.createElement('div');
  toastContainer.className = 'toast-container';
  document.body.appendChild(toastContainer);
  return toastContainer;
}

/**
 * Affiche un toast non-bloquant en bottom-center.
 * @param {string} message
 * @param {'success'|'error'|'info'} type
 * @param {number} durationMs (défaut 3000)
 */
export function toast(message, type = 'success', durationMs = 3000) {
  const container = ensureToastContainer();
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
  container.appendChild(el);
  // Animation in
  requestAnimationFrame(() => el.classList.add('toast-show'));
  setTimeout(() => {
    el.classList.remove('toast-show');
    setTimeout(() => el.remove(), 250);
  }, durationMs);
}

/**
 * Modale confirm non-bloquante (remplace window.confirm).
 * Retourne une Promise<boolean>.
 */
export function confirmModal(message, { okLabel = 'OK', cancelLabel = 'Annuler', danger = false } = {}) {
  return new Promise(resolve => {
    const modal = document.createElement('div');
    modal.className = 'modal-bg';
    modal.innerHTML = `
      <div class="modal modal-confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-msg">
        <p id="confirm-msg" style="margin:8px 0 16px">${String(message).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}</p>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-action="cancel">${cancelLabel}</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-action="ok">${okLabel}</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const close = (val) => { modal.remove(); document.removeEventListener('keydown', kh); resolve(val); };
    const kh = e => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter')  close(true);
    };
    document.addEventListener('keydown', kh);
    modal.addEventListener('click', e => { if (e.target === modal) close(false); });
    modal.querySelector('[data-action=cancel]').onclick = () => close(false);
    modal.querySelector('[data-action=ok]').onclick = () => close(true);
    // Focus OK par défaut
    setTimeout(() => modal.querySelector('[data-action=ok]').focus(), 50);
  });
}
