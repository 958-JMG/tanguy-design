// Bouton support flottant v3 (Sprint 4 P2) — signaler un problème.
// POST /api/support/feedback qui log structuré (JMG suit dans Scaleway Logs Browser).

import { icon } from './lucide.js';
import { toast, confirmModal } from './ui.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}

export function openSupport() {
  const modal = document.createElement('div');
  modal.className = 'modal-bg';
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="support-title">
      <h2 id="support-title">Signaler un problème</h2>
      <p class="muted" style="margin-bottom:12px">Décris ce qui ne va pas. Le message est envoyé à JMG (9·58) avec le contexte technique (URL + browser).</p>
      <form id="form-support">
        <label>Que se passe-t-il ?
          <textarea name="message" rows="6" required minlength="5" maxlength="2000"
                    placeholder="Ex : impossible de modifier la date de pose du projet Junker, le bouton ne réagit pas..."></textarea>
        </label>
        <p class="muted" style="font-size:11px">
          Contexte automatique inclus : URL <code>${esc(location.href)}</code>
        </p>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="support-cancel">Annuler</button>
          <button type="submit" class="btn btn-primary">${icon('mail', 14)} Envoyer</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.addEventListener('keydown', function k(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', k); }
  });
  document.getElementById('support-cancel').onclick = close;

  // Sprint v3.21 — Protection double-submit : disable bouton + feedback immédiat
  // pour éviter que le user clique en rafale (cas vu 2026-05-21 : 6 tickets
  // identiques créés côté cockpit 9·58 parce que le user a cliqué plusieurs fois).
  let isSubmitting = false;
  document.getElementById('form-support').addEventListener('submit', async e => {
    e.preventDefault();
    if (isSubmitting) return;
    isSubmitting = true;
    const submitBtn = document.querySelector('#form-support button[type="submit"]');
    const originalLabel = submitBtn?.innerHTML;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = 'Envoi en cours…';
    }
    const fd = new FormData(e.target);
    try {
      const r = await fetch('/api/support/feedback', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: fd.get('message'),
          url: location.href,
          context: navigator.userAgent,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || r.statusText);
      }
      close();
      const t = document.createElement('div');
      t.className = 'support-toast';
      t.textContent = 'Message envoyé à JMG. Merci !';
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 3000);
    } catch (err) {
      toast('Erreur envoi : ' + err.message, 'error', 5000);
      // Restaure le bouton pour permettre un retry après erreur
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalLabel;
      }
      isSubmitting = false;
    }
  });
}
