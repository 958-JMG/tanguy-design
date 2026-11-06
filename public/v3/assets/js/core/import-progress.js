// Attente visible sans pourcentage fictif ; le temps est celui réellement écoulé.
export function importProgress(container, message = 'Analyse du document en cours', debut = Date.now()) {
  container.innerHTML = '<div class="card import-progress" role="status" aria-live="polite"><span class="import-spinner" aria-hidden="true"></span><div><strong class="import-message"></strong><p class="muted import-time" style="margin:4px 0 0"></p></div></div>';
  container.querySelector('.import-message').textContent = message;
  container.setAttribute('aria-busy', 'true');
  const update = () => {
    if (!container.isConnected) return stop();
    const secondes = Math.floor((Date.now() - debut) / 1000);
    const el = container.querySelector('.import-time');
    if (el) el.textContent = `Demande prise en compte · ${secondes} s écoulées. ${secondes < 20 ? 'Lecture et vérification du fichier…' : 'L’analyse continue. Patientez sans relancer l’import.'}`;
  };
  const timer = setInterval(update, 1000);
  const stop = () => { clearInterval(timer); container.removeAttribute('aria-busy'); };
  update();
  return stop;
}
