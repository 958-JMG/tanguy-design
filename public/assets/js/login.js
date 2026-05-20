// Login page handler — extracté de login.html pour respecter CSP script-src 'self'.
// Sprint 0.7 a durci la CSP en retirant 'unsafe-inline' de script-src.
// Avec le script inline, doLogin() n'était plus défini → bouton "Se connecter" sans effet.

async function doLogin(e) {
  e.preventDefault();
  const err = document.getElementById('err');
  err.style.display = 'none';
  const login = document.getElementById('login').value;
  const password = document.getElementById('password').value;
  const r = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password }),
  });
  if (r.ok) { location.href = '/'; return false; }
  const d = await r.json().catch(() => ({}));
  err.textContent = d.error || 'Erreur';
  err.style.display = 'block';
  return false;
}

// L'attribut onsubmit="return doLogin(event)" sur le form continue de fonctionner
// car la CSP script-src-attr 'unsafe-inline' autorise les handlers inline.
window.doLogin = doLogin;
