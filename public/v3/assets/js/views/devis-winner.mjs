const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
const euros = n => Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

// Groupes contigus : revenir à une section plus loin ne déplace aucune ligne.
// L'API fournit l'ordre source, ou le tri naturel de secours des anciens imports.
export function sectionsWinner(lignes, zones = []) {
  const groupes = [];
  for (const l of lignes) {
    const f = l.fields || {};
    const section = f['Section Winner'] || f['Catégorie'] || 'À classer';
    const zone = zones.find(z => z.id === f.Zone?.[0]);
    const fournisseur = l.fournisseurNom || f['Fournisseur Winner'] || '';
    const marque = l.marqueNom || f['Marque Winner'] || '';
    const cle = JSON.stringify([section, zone?.id, fournisseur, marque]);
    if (groupes.at(-1)?.cle !== cle) groupes.push({ cle, section, zone, fournisseur, marque, lignes: [] });
    groupes.at(-1).lignes.push(l);
  }
  return groupes;
}

export function renderLignesWinner(lignes, zones = []) {
  if (!lignes.length) return '<div class="compact-empty"><span>Aucune ligne dans ce devis</span></div>';
  const ancien = lignes.some(l => !l.fields?.['Ordre Winner']);
  const aide = ancien
    ? 'Ancien import : ordre Winner non enregistré. Les repères sont triés par numéro ; vérifier le PDF d’origine.'
    : 'Ordre et repères du document Winner conservés.';
  return `<p class="muted" style="font-size:12px">${aide}</p>` + sectionsWinner(lignes, zones).map(g => `
    <h3 class="devis-zone-title">${esc(g.section)}${g.zone ? ` · ${esc(g.zone.fields?.['Nom zone'] || '')}` : ''}</h3>
    <p class="muted" style="font-size:12px">Fournisseur : <strong>${esc(g.fournisseur || 'À confirmer')}</strong>${g.marque ? ` · Marque / catalogue : ${esc(g.marque)}` : ''}${g.zone?.fields?.Modèle ? ` · Modèle : ${esc(g.zone.fields.Modèle)}` : ''}</p>
    <div class="table-scroll"><table class="devis-detail-table" style="background:white;border:1px solid var(--line)">
      <thead><tr><th>Repère Winner</th><th>Code</th><th>Désignation</th><th class="num">Qté</th><th class="num">Montant HT</th></tr></thead>
      <tbody>${g.lignes.map(l => {
        const f = l.fields || {}, description = String(f['Désignation'] || '');
        const desc = description.length > 180
          ? `<details><summary>${esc(description.slice(0, 150))}…</summary><div style="white-space:pre-line">${esc(description)}</div></details>`
          : `<span style="white-space:pre-line">${esc(description)}</span>`;
        return `<tr><td>${esc(f.Position ?? '')}${f['Position parent'] ? `<br><small class="muted">lié à ${esc(f['Position parent'])}</small>` : ''}</td>
          <td><strong>${esc(f['Code produit'] || '')}</strong></td><td>${desc}${f['Catégorie'] === 'Plaque de cuisson' ? '<br><span class="badge">Plaque de cuisson</span>' : ''}</td>
          <td class="num">${f.Quantité != null ? Number(f.Quantité).toLocaleString('fr-FR', { maximumFractionDigits: 4 }) : ''} ${esc(f.Unité || '')}</td>
          <td class="num">${f['Montant HT'] != null ? euros(f['Montant HT']) : '—'}</td></tr>`;
      }).join('')}</tbody></table></div>`).join('');
}
