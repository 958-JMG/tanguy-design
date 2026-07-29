// Login page handler — flux en 3 étapes (mot de passe → 2FA TOTP ou enrôlement).
// Externalisé pour respecter la CSP script-src 'self' (pas de JS inline).
//
// Étapes :
//   1) #step-password → POST /api/login
//        { user }         → connecté (mode dégradé env) → /
//        { step:'totp' }  → 2FA déjà configuré → étape code
//        { step:'enroll' }→ 1ère connexion → étape enrôlement (QR)
//   2) #step-totp    → POST /api/login/totp { code } → connecté
//   3) #step-enroll  → POST /api/login/enroll/start (QR) puis
//                      POST /api/login/enroll/verify { code } → connecté

(function () {
  const errBox = document.getElementById('err');

  function showErr(msg) {
    errBox.textContent = msg || 'Erreur';
    errBox.style.display = 'block';
  }
  function clearErr() {
    errBox.style.display = 'none';
  }
  function goStep(id) {
    clearErr();
    document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) {
      el.classList.add('active');
      const focusable = el.querySelector('input:not([type=hidden])');
      if (focusable) setTimeout(() => focusable.focus(), 50);
    }
  }
  async function postJson(url, body) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  }

  // --- Étape 1 : mot de passe ---------------------------------------------------
  document.getElementById('step-password').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErr();
    const login = document.getElementById('login').value;
    const { ok, data } = await postJson('/api/login', { login });
    if (!ok) return showErr(data.error || 'Identifiant inconnu');
    if (data.step === 'totp') return goStep('step-totp');
    if (data.step === 'enroll') return startEnroll();
    // Connecté directement (mode dégradé env, Airtable indisponible)
    location.href = '/';
  });

  // --- Étape 2 : code TOTP ------------------------------------------------------
  document.getElementById('step-totp').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErr();
    const code = document.getElementById('totp-code').value;
    const { ok, data } = await postJson('/api/login/totp', { code });
    if (ok) { location.href = '/'; return; }
    if (data.restart) return goStep('step-password');
    showErr(data.error || 'Code invalide');
  });

  // --- Étape 3 : enrôlement -----------------------------------------------------
  async function startEnroll() {
    clearErr();
    const { ok, data } = await postJson('/api/login/enroll/start', {});
    if (!ok) {
      if (data.step === 'totp') return goStep('step-totp');
      if (data.restart) return goStep('step-password');
      return showErr(data.error || 'Erreur de configuration');
    }
    document.getElementById('enroll-qr').src = data.qr;
    document.getElementById('enroll-secret').textContent = data.secret;
    goStep('step-enroll');
  }

  document.getElementById('step-enroll').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErr();
    const code = document.getElementById('enroll-code').value;
    const { ok, data } = await postJson('/api/login/enroll/verify', { code });
    if (ok) { location.href = '/'; return; }
    if (data.restart) return goStep('step-password');
    showErr(data.error || 'Code invalide');
  });

  // --- Boutons "Recommencer" ----------------------------------------------------
  document.querySelectorAll('[data-back]').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = document.getElementById('password');
      if (p) p.value = '';
      goStep('step-password');
    });
  });

  // Restreint la saisie des champs code aux chiffres.
  ['totp-code', 'enroll-code'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => { el.value = el.value.replace(/\D/g, ''); });
  });
})();
