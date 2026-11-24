/**
 * Controleurs HTTP des modules metier (phases 5 a 12).
 *
 * Chaque controleur reste mince : validation des identifiants et de la
 * pagination, appel du service, mise en forme de la reponse. Les regles
 * metier et les permissions sont verifiees dans le service et en base.
 */
import net from 'node:net';
import { succes, cree } from '../utils/reponses.js';
import { exigerPagination, exigerUuid } from '../validateurs/commun.validateur.js';
import * as service from '../services/metiers.service.js';

function contexte(requete) {
  return {
    adresseIp: net.isIP(requete.ip ?? '') ? requete.ip : null,
    requeteId: requete.id ?? null,
  };
}

function vrai(valeur) {
  return valeur === 'true' || valeur === '1' || valeur === true;
}

/* -------------------------------------------------------------------------- */
/* Fournisseurs                                                               */
/* -------------------------------------------------------------------------- */

export async function fournisseursLister(r, q) {
  const p = exigerPagination(r, { defautLimite: 50, limiteMax: 200 });
  const x = await service.fournisseursLister({
    ...p,
    recherche: r.query.recherche ?? null,
    actif: r.query.actif === undefined ? null : vrai(r.query.actif),
  });
  return succes(q, x.rows, { page: p.page, limite: p.limite, total: x.total });
}

export async function fournisseursOptions(r, q) {
  return succes(q, await service.fournisseursOptions());
}

export async function fournisseurDetail(r, q) {
  return succes(q, await service.fournisseurDetail(exigerUuid(r.params.id, 'fournisseur')));
}

export async function fournisseurCreer(r, q) {
  return cree(q, await service.fournisseurCreer(r.utilisateur, r.body ?? {}, contexte(r)));
}

export async function fournisseurModifier(r, q) {
  return succes(
    q,
    await service.fournisseurModifier(
      r.utilisateur,
      exigerUuid(r.params.id, 'fournisseur'),
      r.body ?? {},
      contexte(r),
    ),
  );
}

export async function fournisseurSupprimer(r, q) {
  return succes(
    q,
    await service.fournisseurSupprimer(
      r.utilisateur,
      exigerUuid(r.params.id, 'fournisseur'),
      contexte(r),
    ),
  );
}

/* -------------------------------------------------------------------------- */
/* Approvisionnements                                                         */
/* -------------------------------------------------------------------------- */

export async function approvisionnementsLister(r, q) {
  const p = exigerPagination(r, { defautLimite: 50, limiteMax: 200 });
  const x = await service.approvisionnementsLister({
    ...p,
    statut: r.query.statut ?? null,
    fournisseurId: r.query.fournisseurId ?? null,
    recherche: r.query.recherche ?? null,
    du: r.query.du ?? null,
    au: r.query.au ?? null,
  });
  return succes(q, x.rows, { page: p.page, limite: p.limite, total: x.total });
}

export async function approvisionnementDetail(r, q) {
  return succes(
    q,
    await service.approvisionnementDetail(exigerUuid(r.params.id, 'approvisionnement')),
  );
}

export async function approvisionnementCreer(r, q) {
  return cree(q, await service.approvisionnementCreer(r.utilisateur, r.body ?? {}, contexte(r)));
}

export async function approvisionnementValider(r, q) {
  return succes(
    q,
    await service.approvisionnementValider(
      exigerUuid(r.params.id, 'approvisionnement'),
      r.utilisateur,
    ),
  );
}

/* -------------------------------------------------------------------------- */
/* Stocks                                                                     */
/* -------------------------------------------------------------------------- */

export async function stocksLister(r, q) {
  const p = exigerPagination(r, { defautLimite: 100, limiteMax: 500 });
  const x = await service.stocksLister({
    ...p,
    recherche: r.query.recherche ?? null,
    categorieId: r.query.categorie ?? r.query.categorieId ?? null,
    etatStock: r.query.etat_stock ?? r.query.etatStock ?? null,
  });
  return succes(q, x.rows, { page: p.page, limite: p.limite, total: x.total });
}

export async function stocksStatistiques(r, q) {
  return succes(q, await service.stocksStatistiques());
}

export async function stocksAlertes(r, q) {
  const limite = Math.min(Math.max(Number(r.query.limite) || 50, 1), 200);
  return succes(q, await service.stocksAlertes({ limite }));
}

export async function mouvementsLister(r, q) {
  const p = exigerPagination(r, { defautLimite: 50, limiteMax: 200 });
  const x = await service.mouvementsLister({
    ...p,
    produitId: r.query.produitId ?? null,
    type: r.query.type ?? null,
  });
  return succes(q, x.rows, { page: p.page, limite: p.limite, total: x.total });
}

export async function stockAjuster(r, q) {
  return cree(q, await service.stockAjuster(r.utilisateur, r.body ?? {}));
}

export async function inventairesLister(r, q) {
  const p = exigerPagination(r, { defautLimite: 50, limiteMax: 200 });
  const x = await service.inventairesLister({ ...p, statut: r.query.statut ?? null });
  return succes(q, x.rows, { page: p.page, limite: p.limite, total: x.total });
}

export async function inventaireDetail(r, q) {
  return succes(q, await service.inventaireDetail(exigerUuid(r.params.id, 'inventaire')));
}

export async function inventaireCreer(r, q) {
  return cree(q, await service.inventaireCreer(r.utilisateur, r.body ?? {}));
}

export async function inventaireValider(r, q) {
  return succes(
    q,
    await service.inventaireValider(exigerUuid(r.params.id, 'inventaire'), r.utilisateur),
  );
}

/* -------------------------------------------------------------------------- */
/* Ventes                                                                     */
/* -------------------------------------------------------------------------- */

export async function ventesLister(r, q) {
  const p = exigerPagination(r, { defautLimite: 50, limiteMax: 200 });
  const x = await service.ventesLister({
    ...p,
    statut: r.query.statut ?? null,
    recherche: r.query.recherche ?? null,
    du: r.query.du ?? null,
    au: r.query.au ?? null,
    toutes: vrai(r.query.toutes),
    acteur: r.utilisateur,
  });
  return succes(q, x.rows, { page: p.page, limite: p.limite, total: x.total });
}

export async function venteCreer(r, q) {
  return cree(q, await service.venteCreer(r.utilisateur, r.body ?? {}, contexte(r)));
}

export async function venteDetail(r, q) {
  return succes(q, await service.venteDetail(exigerUuid(r.params.id, 'vente'), r.utilisateur));
}

export async function venteRecu(r, q) {
  return succes(q, await service.venteRecu(exigerUuid(r.params.id, 'vente'), r.utilisateur));
}

export async function venteValider(r, q) {
  return succes(q, await service.venteValider(exigerUuid(r.params.id, 'vente'), r.utilisateur));
}

/* -------------------------------------------------------------------------- */
/* Paiements                                                                  */
/* -------------------------------------------------------------------------- */

export async function paiementsLister(r, q) {
  const p = exigerPagination(r, { defautLimite: 50, limiteMax: 200 });
  const x = await service.paiementsLister({
    ...p,
    moyen: r.query.moyen ?? null,
    du: r.query.du ?? null,
    au: r.query.au ?? null,
  });
  return succes(q, x.rows, { page: p.page, limite: p.limite, total: x.total });
}

/* -------------------------------------------------------------------------- */
/* Annulations                                                                */
/* -------------------------------------------------------------------------- */

export async function annulationsLister(r, q) {
  const p = exigerPagination(r, { defautLimite: 50, limiteMax: 200 });
  const x = await service.annulationsLister(
    { ...p, statut: r.query.statut ?? null },
    r.utilisateur,
  );
  return succes(q, x.rows, { page: p.page, limite: p.limite, total: x.total });
}

export async function annulationsStatistiques(r, q) {
  return succes(q, await service.annulationsStatistiques(r.utilisateur));
}

export async function annulationDemander(r, q) {
  return cree(q, await service.annulationDemander(r.utilisateur, r.body ?? {}));
}

export async function annulationApprouver(r, q) {
  return succes(
    q,
    await service.annulationDecider(
      exigerUuid(r.params.id, 'annulation'),
      r.utilisateur,
      'APPROUVEE',
      r.body?.commentaire,
    ),
  );
}

export async function annulationRejeter(r, q) {
  return succes(
    q,
    await service.annulationDecider(
      exigerUuid(r.params.id, 'annulation'),
      r.utilisateur,
      'REJETEE',
      r.body?.commentaire,
    ),
  );
}

/* -------------------------------------------------------------------------- */
/* Depenses                                                                   */
/* -------------------------------------------------------------------------- */

export async function categoriesDepenses(r, q) {
  return succes(q, await service.categoriesDepenses());
}

export async function depensesLister(r, q) {
  const p = exigerPagination(r, { defautLimite: 50, limiteMax: 200 });
  const x = await service.depensesLister(
    {
      ...p,
      statut: r.query.statut ?? null,
      categorieId: r.query.categorie ?? r.query.categorieId ?? null,
    },
    r.utilisateur,
  );
  return succes(q, x.rows, { page: p.page, limite: p.limite, total: x.total });
}

export async function depensesStatistiques(r, q) {
  return succes(q, await service.depensesStatistiques(r.utilisateur));
}

export async function depenseCreer(r, q) {
  return cree(q, await service.depenseCreer(r.utilisateur, r.body ?? {}));
}

export async function depenseValider(r, q) {
  return succes(
    q,
    await service.depenseDecider(
      exigerUuid(r.params.id, 'depense'),
      r.utilisateur,
      'VALIDEE',
      r.body?.motif,
    ),
  );
}

export async function depenseRejeter(r, q) {
  return succes(
    q,
    await service.depenseDecider(
      exigerUuid(r.params.id, 'depense'),
      r.utilisateur,
      'REJETEE',
      r.body?.motif,
    ),
  );
}

/* -------------------------------------------------------------------------- */
/* Tableau de bord et rapports                                                */
/* -------------------------------------------------------------------------- */

export async function tableauDeBord(r, q) {
  return succes(q, await service.tableauDeBord(r.utilisateur));
}

export async function rapports(r, q) {
  return succes(q, await service.rapport({ debut: r.query.debut ?? null, fin: r.query.fin ?? null }));
}

function csvEchapper(valeur) {
  const texte = String(valeur ?? '');
  return /[";\n\r]/.test(texte) ? `"${texte.replaceAll('"', '""')}"` : texte;
}

export async function rapportCsv(r, q) {
  const resultat = await service.rapport({
    debut: r.query.debut ?? null,
    fin: r.query.fin ?? null,
  });

  const lignes = [];
  lignes.push(['Section', 'Indicateur', 'Valeur'].join(';'));
  lignes.push(
    ['Resume', 'Chiffre d affaires', resultat.resume.chiffre_affaires].map(csvEchapper).join(';'),
  );
  lignes.push(
    ['Resume', 'Benefice brut', resultat.resume.benefice_brut].map(csvEchapper).join(';'),
  );
  lignes.push(
    ['Resume', 'Cout des marchandises', resultat.resume.cout_marchandises]
      .map(csvEchapper)
      .join(';'),
  );
  lignes.push(['Resume', 'Depenses', resultat.resume.depenses].map(csvEchapper).join(';'));
  lignes.push(
    ['Resume', 'Benefice net', resultat.resume.benefice_net].map(csvEchapper).join(';'),
  );
  lignes.push(
    ['Resume', 'Nombre de ventes', resultat.resume.nombre_ventes].map(csvEchapper).join(';'),
  );
  lignes.push(
    ['Resume', 'Panier moyen', resultat.resume.panier_moyen].map(csvEchapper).join(';'),
  );

  lignes.push('');
  lignes.push(['Journalier', 'Jour', 'CA', 'Benefice', 'Ventes'].join(';'));
  for (const ligne of resultat.serieJournaliere) {
    lignes.push(
      ['Journalier', ligne.jour, ligne.ca, ligne.benefice, ligne.ventes].map(csvEchapper).join(';'),
    );
  }

  lignes.push('');
  lignes.push(['Produits', 'Reference', 'Nom', 'Quantite', 'CA', 'Benefice'].join(';'));
  for (const ligne of resultat.topProduits) {
    lignes.push(
      ['Produits', ligne.reference, ligne.nom, ligne.quantite, ligne.chiffre_affaires, ligne.benefice]
        .map(csvEchapper)
        .join(';'),
    );
  }

  lignes.push('');
  lignes.push(['Vendeurs', 'Vendeur', 'Ventes', 'CA'].join(';'));
  for (const ligne of resultat.vendeurs) {
    lignes.push(
      ['Vendeurs', ligne.vendeur, ligne.ventes, ligne.chiffre_affaires].map(csvEchapper).join(';'),
    );
  }

  lignes.push('');
  lignes.push(['Depenses', 'Categorie', 'Nombre', 'Montant'].join(';'));
  for (const ligne of resultat.depensesParCategorie) {
    lignes.push(
      ['Depenses', ligne.categorie, ligne.nombre, ligne.montant].map(csvEchapper).join(';'),
    );
  }

  const nom = `rapport-simaotech-${new Date().toISOString().slice(0, 10)}.csv`;
  q.setHeader('Content-Type', 'text/csv; charset=utf-8');
  q.setHeader('Content-Disposition', `attachment; filename="${nom}"`);
  return q.send(`\uFEFF${lignes.join('\r\n')}`);
}

/* -------------------------------------------------------------------------- */
/* Parametres, appareils et synchronisation                                   */
/* -------------------------------------------------------------------------- */

export async function parametresLister(r, q) {
  return succes(q, await service.parametresLister());
}

export async function parametreModifier(r, q) {
  const cle = String(r.params.cle ?? '').trim();
  if (!cle) {
    return succes(q, null);
  }
  return succes(
    q,
    await service.parametreModifier(r.utilisateur, cle, r.body?.valeur, contexte(r)),
  );
}

export async function appareilsLister(r, q) {
  return succes(q, await service.appareilsLister());
}

export async function appareilEnregistrer(r, q) {
  return cree(q, await service.appareilEnregistrer(r.utilisateur, r.body ?? {}));
}

export async function appareilModifier(r, q) {
  return succes(
    q,
    await service.appareilModifier(
      r.utilisateur,
      exigerUuid(r.params.id, 'appareil'),
      r.body ?? {},
    ),
  );
}

export async function synchroniser(r, q) {
  return succes(q, await service.synchroniser(r.utilisateur, r.body ?? {}));
}

export async function conflitsLister(r, q) {
  const p = exigerPagination(r, { defautLimite: 50, limiteMax: 200 });
  const x = await service.conflitsLister({ ...p, statut: r.query.statut ?? null });
  return succes(q, x.rows, { page: p.page, limite: p.limite, total: x.total });
}

export async function conflitResoudre(r, q) {
  return succes(
    q,
    await service.conflitResoudre(
      r.utilisateur,
      exigerUuid(r.params.id, 'conflit'),
      r.body ?? {},
    ),
  );
}

export async function etatSynchronisation(r, q) {
  return succes(q, await service.etatSynchronisation(r.utilisateur));
}
