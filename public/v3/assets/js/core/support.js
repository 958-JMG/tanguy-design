// Bouton support flottant v3 (Sprint 4 P2 / v3.22) — signaler un problème
// + recevoir les notifications de résolution depuis le cockpit 9·58.

import { icon } from './lucide.js';
import { toast, confirmModal } from './ui.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}

// Sprint v3.22 — Poll les notifications de résolution SAV au boot
// + toutes les 5 minutes. Affiche un badge rouge sur le bouton support.
let supportRevision = 0;
export async function refreshSupportBadge() {
  const revision = ++supportRevision;
  try {
    const r = await fetch('/api/sav/my-notifications', { credentials: 'same-origin' });
    if (!r.ok) throw new Error('Notifications indisponibles');
    const d = await r.json();
    if (!d.ok || !Array.isArray(d.notifications) || !Number.isInteger(d.unread)) throw new Error('Notifications indisponibles');
    if (revision !== supportRevision) return;
    const btn = document.getElementById('support-btn');
    if (!btn) return;
    let badge = btn.querySelector('.support-badge');
    if (d.unread > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'support-badge';
        btn.appendChild(badge);
      }
      badge.textContent = d.unread > 9 ? '9+' : String(d.unread);
      badge.setAttribute('aria-label', `${d.unread} notification${d.unread > 1 ? 's' : ''} non lue${d.unread > 1 ? 's' : ''}`);
    } else if (badge) {
      badge.remove();
    }
  } catch (e) { /* Le badge existant reste visible ; nouvelle tentative au prochain passage. */ }
}

// Auto-refresh : démarre dès l'import du module, ré-essaie toutes les 5 min.
if (typeof window !== 'undefined') {
  setTimeout(refreshSupportBadge, 2000);
  setInterval(refreshSupportBadge, 5 * 60 * 1000);
}

export async function openSupport() {
  // Sprint v3.22 — récup les notifications non lues pour les afficher en haut
  let notifs = [];
  try {
    const r = await fetch('/api/sav/my-notifications', { credentials: 'same-origin' });
    if (!r.ok) throw new Error('Notifications indisponibles');
    const d = await r.json();
    if (!d.ok || !Array.isArray(d.notifications)) throw new Error('Notifications indisponibles');
    notifs = d.notifications;
  } catch (e) { toast('Notifications indisponibles. Réessayez dans quelques instants.', 'error'); }
  const unread = notifs.filter(n => !n.lu);

  const modal = document.createElement('div');
  modal.className = 'modal-bg';
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="support-title">
      <h2 id="support-title">Support</h2>

      ${unread.length > 0 ? `
        <section class="support-notifs" aria-label="Notifications de résolution">
          <h3 class="support-notifs-title">${icon('check', 14)} ${unread.length} notification${unread.length > 1 ? 's' : ''} de l'équipe 9·58</h3>
          <ul class="support-notifs-list">
            ${unread.map(n => `
              <li class="support-notif-item" data-notif-id="${esc(n.id)}">
                <div class="support-notif-head">
                  <strong>${esc(n.titre)}</strong>
                  <span class="muted" style="font-size:11px">${esc(n.date.slice(0,10))}</span>
                </div>
                <p class="support-notif-msg">${esc(n.message)}</p>
                <button class="btn btn-ghost btn-sm support-notif-ack" data-id="${esc(n.id)}">${icon('check', 12)} OK, vu</button>
              </li>
            `).join('')}
          </ul>
        </section>
      ` : ''}

      <h3 style="margin-top:${unread.length > 0 ? '20px' : '0'};font-size:15px">Signaler un problème</h3>
      <p class="muted" style="margin-bottom:12px;font-size:13px">Décris ce qui ne va pas. Le message est envoyé à JMG (9·58) avec le contexte technique (URL + browser).</p>
      <form id="form-support">
        <label>Que se passe-t-il ?
          <textarea name="message" rows="5" required minlength="5" maxlength="2000"
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

  // Sprint 26/05 — Auto-mark-as-read à l'ouverture du modal (UX naturelle : si
  // tu vois les notifs, le compteur retombe à 0). Le bouton "OK, vu" reste
  // dispo pour les supprimer individuellement de la liste si voulu.
  if (unread.length > 0) {
    try {
      ++supportRevision;
      const response = await fetch('/api/sav/notifications/mark-all-read', {
        method: 'POST', credentials: 'same-origin',
      });
      if (!response.ok || !(await response.json()).ok) throw new Error('Lecture non confirmée');
      await refreshSupportBadge();
    } catch (e) { toast('Lecture non confirmée. Réessayez avec « OK, vu ».', 'error'); }
  }

  // Sprint v3.22 — bindings "OK, vu" sur les notifications (mark individual +
  // retire de la liste visible — les autres restent affichées en lecture seule).
  modal.querySelectorAll('.support-notif-ack').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const notifId = btn.dataset.id;
      btn.disabled = true;
      try {
        ++supportRevision;
        const response = await fetch(`/api/sav/notifications/${encodeURIComponent(notifId)}/read`, {
          method: 'POST', credentials: 'same-origin',
        });
        if (!response.ok || !(await response.json()).ok) throw new Error("Lecture non confirmée. Réessayez.");
        // Retire l'item de la liste
        btn.closest('.support-notif-item')?.remove();
        // Refresh badge
        refreshSupportBadge();
      } catch (err) {
        btn.disabled = false;
        toast('Erreur : ' + err.message, 'error');
      }
    });
  });

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
