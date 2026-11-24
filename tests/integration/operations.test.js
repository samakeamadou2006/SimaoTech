/**
 * Tests d'integration HTTP des phases 5 a 12 : fournisseurs, approvisionnements,
 * stocks, ventes, paiements, annulations, depenses, tableau de bord, rapports,
 * parametres, appareils et synchronisation.
 *
 * Le serveur Express est demarre sur le PostgreSQL embarque en mode
 * d'authentification local (jetons HS256 signes par le test).
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { PORT_TEST, arreterBase, base, demarrerBase } from './aide.js';

const SECRET = 'secret-de-test-simaotech-suffisamment-long-pour-hs256';

let serveur = null;
let urlBase = '';
let fermerPool = null;

let proprietaire;
let administrateur;
let employe;

const etat = {
  categorieId: null,
  produitUn: null,
  produitDeux: null,
  fournisseurId: null,
  approId: null,
  venteMixteId: null,
  venteEmployeId: null,
  appareilId: null,
};

function base64url(valeur) {
  return Buffer.from(valeur).toString('base64url');
}

function jeton(utilisateur, { expiration = 3600 } = {}) {
  const maintenant = Math.floor(Date.now() / 1000);
  const entete = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const charge = base64url(
    JSON.stringify({
      sub: utilisateur.id,
      email: utilisateur.email,
      iat: maintenant,
      exp: maintenant + expiration,
    }),
  );
  const signature = crypto
    .createHmac('sha256', SECRET)
    .update(`${entete}.${charge}`)
    .digest('base64url');
  return `${entete}.${charge}.${signature}`;
}

async function appel(chemin, { methode = 'GET', corps = null, jetonAcces = null } = {}) {
  const entetes = { Accept: 'application/json' };
  if (corps !== null) entetes['Content-Type'] = 'application/json';
  if (jetonAcces) entetes.Authorization = `Bearer ${jetonAcces}`;

  const reponse = await fetch(`${urlBase}${chemin}`, {
    method: methode,
    headers: entetes,
    body: corps === null ? undefined : JSON.stringify(corps),
  });
  const texte = await reponse.text();
  let contenu = null;
  try {
    contenu = texte ? JSON.parse(texte) : null;
  } catch {
    contenu = null;
  }
  return { statut: reponse.status, corps: contenu, texte, entetes: reponse.headers };
}

const jp = () => jeton(proprietaire);
const ja = () => jeton(administrateur);
const je = () => jeton(employe);

async function stockDe(produitId) {
  const { rows } = await base().query(
    'SELECT quantite_disponible FROM stocks WHERE produit_id = $1',
    [produitId],
  );
  return String(rows[0].quantite_disponible);
}

before(async () => {
  await demarrerBase();

  process.env.NODE_ENV = 'test';
  process.env.MODE_AUTH = 'local';
  process.env.JWT_SECRET = SECRET;
  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${PORT_TEST}/postgres`;
  process.env.BASE_DE_DONNEES_SSL = 'false';
  process.env.PORT = '3199';
  process.env.URL_PUBLIQUE = 'http://127.0.0.1:3104';
  process.env.NIVEAU_JOURNAL = 'fatal';

  const { creerApplication } = await import('../../backend/serveur.js');
  const { fermerPool: fermer } = await import('../../backend/configuration/base_de_donnees.js');
  fermerPool = fermer;

  const application = creerApplication();
  await new Promise((resoudre) => {
    serveur = application.listen(0, '127.0.0.1', resoudre);
  });
  urlBase = `http://127.0.0.1:${serveur.address().port}`;

  const { creerUtilisateur } = await import('./aide.js');
  proprietaire = await creerUtilisateur({
    email: 'proprietaire.operations@simaotech.test',
    nom: 'Proprietaire Operations',
    role: 'PROPRIETAIRE',
  });
  administrateur = await creerUtilisateur({
    email: 'admin.operations@simaotech.test',
    nom: 'Administrateur Operations',
    role: 'ADMINISTRATEUR',
  });
  employe = await creerUtilisateur({
    email: 'employe.operations@simaotech.test',
    nom: 'Employe Operations',
    role: 'EMPLOYE',
  });

  // Catalogue de travail : une categorie et deux produits.
  const categorie = await appel('/api/categories', {
    methode: 'POST',
    corps: { nom: 'Operations Test' },
    jetonAcces: jp(),
  });
  assert.equal(categorie.statut, 201);
  etat.categorieId = categorie.corps.donnees.id;

  const produitUn = await appel('/api/produits', {
    methode: 'POST',
    corps: {
      nom: 'Article Un',
      categorieId: etat.categorieId,
      reference: 'OPS-P1',
      prixVenteReference: '1500',
      seuilAlerte: '2',
    },
    jetonAcces: jp(),
  });
  assert.equal(produitUn.statut, 201);
  etat.produitUn = produitUn.corps.donnees;

  const produitDeux = await appel('/api/produits', {
    methode: 'POST',
    corps: {
      nom: 'Article Deux',
      categorieId: etat.categorieId,
      reference: 'OPS-P2',
      prixVenteReference: '5000',
      seuilAlerte: '1',
    },
    jetonAcces: jp(),
  });
  assert.equal(produitDeux.statut, 201);
  etat.produitDeux = produitDeux.corps.donnees;
});

after(async () => {
  if (serveur) await new Promise((resoudre) => serveur.close(resoudre));
  if (fermerPool) await fermerPool().catch(() => {});
  await arreterBase();
});

/* -------------------------------------------------------------------------- */
/* Fournisseurs                                                               */
/* -------------------------------------------------------------------------- */

test('fonctions metier SECURITY DEFINER : RPC interdit aux roles API', async () => {
  const { rows } = await base().query(`
    SELECT
      has_function_privilege('anon', 'public.fn_valider_vente(uuid,uuid)', 'EXECUTE') AS anon_vente,
      has_function_privilege('authenticated', 'public.fn_valider_vente(uuid,uuid)', 'EXECUTE') AS utilisateur_vente,
      has_function_privilege('service_role', 'public.fn_ajuster_stock(uuid,uuid,numeric,text)', 'EXECUTE') AS service_ajustement,
      has_function_privilege('authenticated', 'public.fn_permission_courante(text)', 'EXECUTE') AS helper_rls
  `);
  assert.equal(rows[0].anon_vente, false);
  assert.equal(rows[0].utilisateur_vente, false);
  assert.equal(rows[0].service_ajustement, false);
  assert.equal(rows[0].helper_rls, true);
});

test('fournisseurs : employe refuse, creation et code unique', async () => {
  const interdit = await appel('/api/fournisseurs', {
    methode: 'POST',
    corps: { code: 'F-INTERDIT', nom: 'Fournisseur Interdit' },
    jetonAcces: je(),
  });
  assert.equal(interdit.statut, 403);

  const creation = await appel('/api/fournisseurs', {
    methode: 'POST',
    corps: {
      code: 'FOURN-A',
      nom: 'Fournisseur Alpha',
      telephone: '+225 0102030405',
      email: 'alpha@example.com',
    },
    jetonAcces: ja(),
  });
  assert.equal(creation.statut, 201);
  etat.fournisseurId = creation.corps.donnees.id;
  assert.equal(creation.corps.donnees.code, 'FOURN-A');

  const doublon = await appel('/api/fournisseurs', {
    methode: 'POST',
    corps: { code: 'fourn-a', nom: 'Autre Alpha' },
    jetonAcces: ja(),
  });
  assert.equal(doublon.statut, 409);
  assert.equal(doublon.corps.erreur.code, 'CODE_FOURNISSEUR_DEJA_UTILISE');

  const options = await appel('/api/fournisseurs/options', { jetonAcces: ja() });
  assert.equal(options.statut, 200);
  assert.ok(options.corps.donnees.some((f) => f.id === etat.fournisseurId));

  const emailInvalide = await appel('/api/fournisseurs', {
    methode: 'POST',
    corps: { code: 'FOURN-B', nom: 'Fournisseur Beta', email: 'pas-un-email' },
    jetonAcces: ja(),
  });
  assert.equal(emailInvalide.statut, 422);
});

test('fournisseurs : modification, archivage et suppression refusee si brouillon', async () => {
  const modification = await appel(`/api/fournisseurs/${etat.fournisseurId}`, {
    methode: 'PATCH',
    corps: { telephone: '+225 0708091011', notes: 'Livraison le lundi' },
    jetonAcces: ja(),
  });
  assert.equal(modification.statut, 200);
  assert.equal(modification.corps.donnees.telephone, '+225 0708091011');

  const brouillon = await appel('/api/approvisionnements', {
    methode: 'POST',
    corps: {
      fournisseurId: etat.fournisseurId,
      lignes: [
        { produitId: etat.produitUn.id, quantite: '1', prixAchatUnitaire: '900' },
      ],
    },
    jetonAcces: ja(),
  });
  assert.equal(brouillon.statut, 201);
  const brouillonId = brouillon.corps.donnees.id;

  const refus = await appel(`/api/fournisseurs/${etat.fournisseurId}`, {
    methode: 'DELETE',
    jetonAcces: ja(),
  });
  assert.equal(refus.statut, 409);
  assert.equal(refus.corps.erreur.code, 'FOURNISSEUR_APPROVISIONNEMENT_EN_COURS');

  // Nettoyage : suppression directe du brouillon de test (jamais valide).
  await base().query('DELETE FROM lignes_approvisionnement WHERE approvisionnement_id = $1', [
    brouillonId,
  ]);
  await base().query('DELETE FROM approvisionnements WHERE id = $1', [brouillonId]);
});

/* -------------------------------------------------------------------------- */
/* Approvisionnements et CMP                                                  */
/* -------------------------------------------------------------------------- */

test('approvisionnement : creation, validation, CMP et stock', async () => {
  const creation = await appel('/api/approvisionnements', {
    methode: 'POST',
    corps: {
      fournisseurId: etat.fournisseurId,
      observations: 'Reapprovisionnement de test',
      lignes: [
        { produitId: etat.produitUn.id, quantite: '10', prixAchatUnitaire: '1000' },
        { produitId: etat.produitDeux.id, quantite: '5', prixAchatUnitaire: '3000' },
      ],
    },
    jetonAcces: ja(),
  });
  assert.equal(creation.statut, 201);
  etat.approId = creation.corps.donnees.id;
  assert.equal(creation.corps.donnees.statut, 'BROUILLON');
  assert.equal(Number(creation.corps.donnees.cout_net), 25000);

  const validation = await appel(`/api/approvisionnements/${etat.approId}/valider`, {
    methode: 'POST',
    jetonAcces: ja(),
  });
  assert.equal(validation.statut, 200);
  assert.equal(validation.corps.donnees.approvisionnement.statut, 'VALIDE');

  assert.equal(await stockDe(etat.produitUn.id), '10.000');
  assert.equal(await stockDe(etat.produitDeux.id), '5.000');

  const cmp = await base().query('SELECT cout_moyen_pondere FROM produits WHERE id = $1', [
    etat.produitUn.id,
  ]);
  assert.equal(Number(cmp.rows[0].cout_moyen_pondere), 1000);

  const rejoue = await appel(`/api/approvisionnements/${etat.approId}/valider`, {
    methode: 'POST',
    jetonAcces: ja(),
  });
  assert.equal(rejoue.statut, 200);
  assert.equal(rejoue.corps.donnees.deja_valide, true);
});

test('approvisionnement : idempotence par cle et permission', async () => {
  const cle = crypto.randomUUID();
  const corps = {
    fournisseurId: etat.fournisseurId,
    cleIdempotence: cle,
    lignes: [{ produitId: etat.produitUn.id, quantite: '2', prixAchatUnitaire: '1000' }],
  };

  const premier = await appel('/api/approvisionnements', {
    methode: 'POST',
    corps,
    jetonAcces: ja(),
  });
  assert.equal(premier.statut, 201);

  const second = await appel('/api/approvisionnements', {
    methode: 'POST',
    corps,
    jetonAcces: ja(),
  });
  assert.equal(second.statut, 201);
  assert.equal(second.corps.donnees.id, premier.corps.donnees.id);

  const interdit = await appel('/api/approvisionnements', {
    methode: 'POST',
    corps: {
      fournisseurId: etat.fournisseurId,
      lignes: [{ produitId: etat.produitUn.id, quantite: '1', prixAchatUnitaire: '1000' }],
    },
    jetonAcces: je(),
  });
  assert.equal(interdit.statut, 403);
});

/* -------------------------------------------------------------------------- */
/* Stocks                                                                     */
/* -------------------------------------------------------------------------- */

test('stocks : liste, statistiques, alertes et mouvements', async () => {
  const liste = await appel('/api/stocks?recherche=OPS-P', { jetonAcces: je() });
  assert.equal(liste.statut, 200);
  assert.ok(liste.corps.meta.total >= 2);

  const statistiques = await appel('/api/stocks/statistiques', { jetonAcces: ja() });
  assert.equal(statistiques.statut, 200);
  assert.ok(Number(statistiques.corps.donnees.produits) >= 2);

  const alertes = await appel('/api/stocks/alertes', { jetonAcces: ja() });
  assert.equal(alertes.statut, 200);
  assert.ok(Array.isArray(alertes.corps.donnees));

  const mouvements = await appel('/api/mouvements-stock', { jetonAcces: ja() });
  assert.equal(mouvements.statut, 200);
  assert.ok(
    mouvements.corps.donnees.some((m) => m.type_mouvement === 'ENTREE_APPROVISIONNEMENT'),
  );

  const filtre = await appel('/api/mouvements-stock?type=SORTIE_VENTE', {
    jetonAcces: ja(),
  });
  assert.equal(filtre.statut, 200);
});

test('stocks : ajustement interdit a l employe, applique par l administrateur', async () => {
  const interdit = await appel('/api/stocks/ajuster', {
    methode: 'POST',
    corps: { produitId: etat.produitUn.id, quantite: '-1', motif: 'Casse constatee en rayon' },
    jetonAcces: je(),
  });
  assert.equal(interdit.statut, 403);

  const avant = Number(await stockDe(etat.produitUn.id));
  const ajustement = await appel('/api/stocks/ajuster', {
    methode: 'POST',
    corps: { produitId: etat.produitUn.id, quantite: '-1', motif: 'Casse constatee en rayon' },
    jetonAcces: ja(),
  });
  assert.equal(ajustement.statut, 201);
  assert.equal(Number(ajustement.corps.donnees.stock_apres), avant - 1);

  const motifCourt = await appel('/api/stocks/ajuster', {
    methode: 'POST',
    corps: { produitId: etat.produitUn.id, quantite: '-1', motif: 'abc' },
    jetonAcces: ja(),
  });
  assert.equal(motifCourt.statut, 422);
});

test('inventaire : creation, comptage et validation des ecarts', async () => {
  const avant = Number(await stockDe(etat.produitUn.id));
  const compte = avant + 2;

  const creation = await appel('/api/inventaires', {
    methode: 'POST',
    corps: {
      observations: 'Inventaire de controle',
      lignes: [{ produitId: etat.produitUn.id, quantiteComptee: String(compte) }],
    },
    jetonAcces: ja(),
  });
  assert.equal(creation.statut, 201);
  const inventaireId = creation.corps.donnees.id;
  assert.equal(creation.corps.donnees.statut, 'BROUILLON');
  assert.equal(Number(creation.corps.donnees.lignes[0].ecart), 2);

  const interdit = await appel(`/api/inventaires/${inventaireId}/valider`, {
    methode: 'POST',
    jetonAcces: je(),
  });
  assert.equal(interdit.statut, 403);

  const validation = await appel(`/api/inventaires/${inventaireId}/valider`, {
    methode: 'POST',
    jetonAcces: ja(),
  });
  assert.equal(validation.statut, 200);
  assert.equal(validation.corps.donnees.inventaire.statut, 'VALIDE');
  assert.equal(Number(await stockDe(etat.produitUn.id)), compte);

  const listeFiltree = await appel('/api/inventaires?statut=VALIDE', { jetonAcces: ja() });
  assert.equal(listeFiltree.statut, 200);
  assert.ok(listeFiltree.corps.donnees.some((i) => i.id === inventaireId));
});

/* -------------------------------------------------------------------------- */
/* Ventes, paiements et recus                                                 */
/* -------------------------------------------------------------------------- */

test('vente : paiement mixte, totaux exacts et recu', async () => {
  const avantUn = Number(await stockDe(etat.produitUn.id));
  const avantDeux = Number(await stockDe(etat.produitDeux.id));
  const cle = crypto.randomUUID();

  const vente = await appel('/api/ventes', {
    methode: 'POST',
    corps: {
      cleIdempotence: cle,
      lignes: [
        { produitId: etat.produitUn.id, quantite: '2' },
        { produitId: etat.produitDeux.id, quantite: '1' },
      ],
      paiements: [
        { moyen: 'ESPECES', montant: '5000' },
        { moyen: 'ORANGE_MONEY', montant: '3000', reference: 'OM-OPS-0001' },
      ],
    },
    jetonAcces: je(),
  });
  assert.equal(vente.statut, 201);
  etat.venteMixteId = vente.corps.donnees.id;
  assert.equal(vente.corps.donnees.statut, 'VALIDEE');
  assert.equal(vente.corps.donnees.montant_brut, '8000.00');
  assert.equal(vente.corps.donnees.montant_net, '8000.00');
  assert.equal(vente.corps.donnees.benefice_brut, '3000.00');
  assert.equal(vente.corps.donnees.paiements.length, 2);

  assert.equal(Number(await stockDe(etat.produitUn.id)), avantUn - 2);
  assert.equal(Number(await stockDe(etat.produitDeux.id)), avantDeux - 1);

  const recu = await appel(`/api/ventes/${etat.venteMixteId}/recu`, { jetonAcces: je() });
  assert.equal(recu.statut, 200);
  assert.equal(recu.corps.donnees.vente.numero, vente.corps.donnees.numero);
  assert.ok('boutique.nom' in recu.corps.donnees.boutique);

  // Rejeu de la meme cle : aucune seconde vente.
  const rejoue = await appel('/api/ventes', {
    methode: 'POST',
    corps: {
      cleIdempotence: cle,
      lignes: [{ produitId: etat.produitUn.id, quantite: '2' }],
      paiements: [{ moyen: 'ESPECES', montant: '3000' }],
    },
    jetonAcces: je(),
  });
  assert.equal(rejoue.statut, 201);
  assert.equal(rejoue.corps.donnees.id, etat.venteMixteId);
  assert.equal(rejoue.corps.donnees.dejaCreee, true);
});

test('vente : reduction globale repartie sans perte', async () => {
  const vente = await appel('/api/ventes', {
    methode: 'POST',
    corps: {
      lignes: [
        { produitId: etat.produitUn.id, quantite: '1' },
        { produitId: etat.produitDeux.id, quantite: '1' },
      ],
      reductionGlobale: '1000',
      motifReduction: 'Geste commercial de test',
      paiements: [{ moyen: 'ESPECES', montant: '5500' }],
    },
    jetonAcces: je(),
  });
  assert.equal(vente.statut, 201);
  assert.equal(vente.corps.donnees.montant_net, '5500.00');
  assert.equal(vente.corps.donnees.total_reductions, '1000.00');
  const sommeParts = vente.corps.donnees.lignes.reduce(
    (total, ligne) => total + Number(ligne.remise_globale_affectee),
    0,
  );
  assert.equal(sommeParts.toFixed(2), '1000.00');
});

test('vente : paiement non conforme, vente a perte et stock insuffisant refuses', async () => {
  const paiement = await appel('/api/ventes', {
    methode: 'POST',
    corps: {
      lignes: [{ produitId: etat.produitUn.id, quantite: '1' }],
      paiements: [{ moyen: 'ESPECES', montant: '1400' }],
    },
    jetonAcces: je(),
  });
  assert.equal(paiement.statut, 422);
  assert.equal(paiement.corps.erreur.code, 'PAIEMENT_NON_CONFORME');

  const perte = await appel('/api/ventes', {
    methode: 'POST',
    corps: {
      lignes: [{ produitId: etat.produitDeux.id, quantite: '1', reduction: '3000' }],
      paiements: [{ moyen: 'ESPECES', montant: '2000' }],
    },
    jetonAcces: je(),
  });
  assert.equal(perte.statut, 422);
  assert.equal(perte.corps.erreur.code, 'VENTE_A_PERTE');

  const stock = await appel('/api/ventes', {
    methode: 'POST',
    corps: {
      lignes: [{ produitId: etat.produitDeux.id, quantite: '999' }],
      paiements: [{ moyen: 'ESPECES', montant: '4995000' }],
    },
    jetonAcces: je(),
  });
  assert.equal(stock.statut, 422);
  assert.equal(stock.corps.erreur.code, 'STOCK_INSUFFISANT');
});

test('vente : reference Mobile Money obligatoire', async () => {
  const sansReference = await appel('/api/ventes', {
    methode: 'POST',
    corps: {
      lignes: [{ produitId: etat.produitUn.id, quantite: '1' }],
      paiements: [{ moyen: 'WAVE', montant: '1500' }],
    },
    jetonAcces: je(),
  });
  assert.equal(sansReference.statut, 422);
  assert.equal(sansReference.corps.erreur.code, 'VALIDATION');
});

test('ventes : portee des consultations selon les permissions', async () => {
  const propres = await appel('/api/ventes', { jetonAcces: je() });
  assert.equal(propres.statut, 200);
  assert.ok(propres.corps.meta.total >= 2);
  assert.ok(propres.corps.donnees.every((v) => v.vendeur === 'Employe Operations'));

  const toutes = await appel('/api/ventes?toutes=true', { jetonAcces: ja() });
  assert.equal(toutes.statut, 200);
  assert.ok(toutes.corps.meta.total >= propres.corps.meta.total);
});

/* -------------------------------------------------------------------------- */
/* Annulations                                                                */
/* -------------------------------------------------------------------------- */

test('annulation : demande, approbation et restitution du stock', async () => {
  const avant = Number(await stockDe(etat.produitUn.id));

  const vente = await appel('/api/ventes', {
    methode: 'POST',
    corps: {
      lignes: [{ produitId: etat.produitUn.id, quantite: '1' }],
      paiements: [{ moyen: 'ESPECES', montant: '1500' }],
    },
    jetonAcces: je(),
  });
  assert.equal(vente.statut, 201);
  etat.venteEmployeId = vente.corps.donnees.id;
  assert.equal(Number(await stockDe(etat.produitUn.id)), avant - 1);

  const demande = await appel('/api/annulations', {
    methode: 'POST',
    corps: { venteId: etat.venteEmployeId, motif: 'Client a change d avis' },
    jetonAcces: je(),
  });
  assert.equal(demande.statut, 201);
  const demandeId = demande.corps.donnees.id;
  assert.equal(demande.corps.donnees.statut, 'EN_ATTENTE');

  const autoApprobation = await appel(`/api/annulations/${demandeId}/approuver`, {
    methode: 'POST',
    corps: { commentaire: 'Tentative employe' },
    jetonAcces: je(),
  });
  assert.equal(autoApprobation.statut, 403);

  const approbation = await appel(`/api/annulations/${demandeId}/approuver`, {
    methode: 'POST',
    corps: { commentaire: 'Accord du proprietaire' },
    jetonAcces: ja(),
  });
  assert.equal(approbation.statut, 200);

  assert.equal(Number(await stockDe(etat.produitUn.id)), avant);

  const venteApres = await appel(`/api/ventes/${etat.venteEmployeId}`, { jetonAcces: je() });
  assert.equal(venteApres.statut, 200);
  assert.equal(venteApres.corps.donnees.statut, 'ANNULEE');
  assert.ok(venteApres.corps.donnees.annule_le);

  const statistiques = await appel('/api/annulations/statistiques', { jetonAcces: ja() });
  assert.equal(statistiques.statut, 200);
  assert.ok(statistiques.corps.donnees.approuvees >= 1);
});

test('annulation : rejet avec commentaire obligatoire', async () => {
  const vente = await appel('/api/ventes', {
    methode: 'POST',
    corps: {
      lignes: [{ produitId: etat.produitUn.id, quantite: '1' }],
      paiements: [{ moyen: 'ESPECES', montant: '1500' }],
    },
    jetonAcces: je(),
  });
  assert.equal(vente.statut, 201);

  const demande = await appel('/api/annulations', {
    methode: 'POST',
    corps: { venteId: vente.corps.donnees.id, motif: 'Erreur de saisie du vendeur' },
    jetonAcces: je(),
  });
  assert.equal(demande.statut, 201);
  const demandeId = demande.corps.donnees.id;

  const avant = Number(await stockDe(etat.produitUn.id));

  const commentaireCourt = await appel(`/api/annulations/${demandeId}/rejeter`, {
    methode: 'POST',
    corps: { commentaire: 'no' },
    jetonAcces: ja(),
  });
  assert.equal(commentaireCourt.statut, 422);

  const rejet = await appel(`/api/annulations/${demandeId}/rejeter`, {
    methode: 'POST',
    corps: { commentaire: 'Vente conforme, aucun motif valable' },
    jetonAcces: ja(),
  });
  assert.equal(rejet.statut, 200);
  assert.equal(Number(await stockDe(etat.produitUn.id)), avant);

  const venteApres = await appel(`/api/ventes/${vente.corps.donnees.id}`, { jetonAcces: je() });
  assert.equal(venteApres.corps.donnees.statut, 'VALIDEE');
});

/* -------------------------------------------------------------------------- */
/* Depenses                                                                   */
/* -------------------------------------------------------------------------- */

test('depenses : creation reservee, validation et statistiques', async () => {
  const categories = await appel('/api/depenses/categories', { jetonAcces: ja() });
  assert.equal(categories.statut, 200);
  const loyer = categories.corps.donnees.find((c) => c.code === 'LOYER');
  assert.ok(loyer);

  const interdit = await appel('/api/depenses', {
    methode: 'POST',
    corps: { categorieId: loyer.id, montant: '1000', description: 'Tentative employe' },
    jetonAcces: je(),
  });
  assert.equal(interdit.statut, 403);

  const creation = await appel('/api/depenses', {
    methode: 'POST',
    corps: {
      categorieId: loyer.id,
      montant: '25000',
      description: 'Loyer du mois en cours',
      justificatifUrl: 'https://exemple.test/quittance.pdf',
    },
    jetonAcces: ja(),
  });
  assert.equal(creation.statut, 201);
  assert.equal(creation.corps.donnees.statut, 'EN_ATTENTE');
  assert.equal(creation.corps.donnees.montant, '25000.00');
  const depenseId = creation.corps.donnees.id;

  const validation = await appel(`/api/depenses/${depenseId}/valider`, {
    methode: 'POST',
    jetonAcces: jp(),
  });
  assert.equal(validation.statut, 200);
  assert.equal(validation.corps.donnees.statut, 'VALIDEE');

  const liste = await appel('/api/depenses?statut=VALIDEE', { jetonAcces: ja() });
  assert.equal(liste.statut, 200);
  assert.ok(liste.corps.donnees.some((d) => d.id === depenseId));

  const statistiques = await appel('/api/depenses/statistiques', { jetonAcces: ja() });
  assert.equal(statistiques.statut, 200);
  assert.ok(statistiques.corps.donnees.validees >= 1);
  assert.ok(Number(statistiques.corps.donnees.total_mois) >= 25000);
});

/* -------------------------------------------------------------------------- */
/* Tableau de bord et rapports                                                */
/* -------------------------------------------------------------------------- */

test('tableau de bord : portee globale ou propre selon le role', async () => {
  const global = await appel('/api/tableau-de-bord', { jetonAcces: jp() });
  assert.equal(global.statut, 200);
  assert.equal(global.corps.donnees.portee, 'GLOBALE');
  assert.equal(global.corps.donnees.beneficesVisibles, true);
  assert.ok(global.corps.donnees.serieJournaliere.length >= 7);
  assert.ok(Number(global.corps.donnees.periode.jour.ventes) >= 1);

  const propre = await appel('/api/tableau-de-bord', { jetonAcces: je() });
  assert.equal(propre.statut, 200);
  assert.equal(propre.corps.donnees.portee, 'PROPRE');
  assert.equal(propre.corps.donnees.beneficesVisibles, false);
  assert.equal(propre.corps.donnees.periode.jour.benefice, null);
  assert.equal(propre.corps.donnees.topProduits.length, 0);
});

test('rapports : synthese et export CSV', async () => {
  const interdit = await appel('/api/rapports', { jetonAcces: je() });
  assert.equal(interdit.statut, 403);

  const rapport = await appel('/api/rapports', { jetonAcces: ja() });
  assert.equal(rapport.statut, 200);
  assert.ok(Number(rapport.corps.donnees.resume.nombre_ventes) >= 1);
  assert.ok(rapport.corps.donnees.resume.benefice_net !== undefined);
  assert.ok(Array.isArray(rapport.corps.donnees.topProduits));
  assert.ok(Array.isArray(rapport.corps.donnees.vendeurs));

  const aujourdHui = new Date().toISOString().slice(0, 10);
  const rapportDuJour = await appel(
    `/api/rapports?debut=${aujourdHui}&fin=${aujourdHui}`,
    { jetonAcces: ja() },
  );
  assert.equal(rapportDuJour.statut, 200);
  assert.ok(Number(rapportDuJour.corps.donnees.resume.nombre_ventes) >= 1);

  const dateImpossible = await appel('/api/rapports?debut=2026-02-31', {
    jetonAcces: ja(),
  });
  assert.equal(dateImpossible.statut, 422);

  const exportCsv = await appel('/api/rapports/export.csv', { jetonAcces: jp() });
  assert.equal(exportCsv.statut, 200);
  assert.match(exportCsv.entetes.get('content-type'), /text\/csv/);
  assert.match(exportCsv.texte, /Chiffre d affaires/);
  assert.match(exportCsv.texte, /Journalier/);
});

/* -------------------------------------------------------------------------- */
/* Parametres, appareils et synchronisation                                   */
/* -------------------------------------------------------------------------- */

test('parametres : reserves au proprietaire', async () => {
  const interdit = await appel('/api/parametres', { jetonAcces: ja() });
  assert.equal(interdit.statut, 403);

  const liste = await appel('/api/parametres', { jetonAcces: jp() });
  assert.equal(liste.statut, 200);
  assert.ok(liste.corps.donnees.some((p) => p.cle === 'boutique.nom'));

  const modification = await appel('/api/parametres/boutique.nom', {
    methode: 'PATCH',
    corps: { valeur: 'SimaoTech Boutique' },
    jetonAcces: jp(),
  });
  assert.equal(modification.statut, 200);
  assert.equal(modification.corps.donnees.valeur, 'SimaoTech Boutique');

  const restauration = await appel('/api/parametres/boutique.nom', {
    methode: 'PATCH',
    corps: { valeur: 'SimaoTech' },
    jetonAcces: jp(),
  });
  assert.equal(restauration.statut, 200);
});

test('appareils et synchronisation : enregistrement, idempotence, conflits', async () => {
  const interdit = await appel('/api/appareils', {
    methode: 'POST',
    corps: { code: 'TAB-INTERDIT', nom: 'Tablette interdite' },
    jetonAcces: je(),
  });
  assert.equal(interdit.statut, 403);

  const appareil = await appel('/api/appareils', {
    methode: 'POST',
    corps: { code: 'TAB-CAISSE-01', nom: 'Tablette caisse', plateforme: 'Android' },
    jetonAcces: jp(),
  });
  assert.equal(appareil.statut, 201);
  etat.appareilId = appareil.corps.donnees.id;

  const liste = await appel('/api/appareils', { jetonAcces: jp() });
  assert.equal(liste.statut, 200);
  assert.ok(liste.corps.donnees.some((a) => a.id === etat.appareilId));

  const cle = crypto.randomUUID();
  const operation = await appel('/api/synchronisation', {
    methode: 'POST',
    corps: {
      appareilId: etat.appareilId,
      cleIdempotence: cle,
      typeOperation: 'VENTE_HORS_LIGNE',
      entite: 'VENTES',
      entiteId: etat.venteMixteId,
      charge: { numero: 'local-1' },
    },
    jetonAcces: jp(),
  });
  assert.equal(operation.statut, 200);
  assert.equal(operation.corps.donnees.deja_recue, false);

  const rejoue = await appel('/api/synchronisation', {
    methode: 'POST',
    corps: {
      appareilId: etat.appareilId,
      cleIdempotence: cle,
      typeOperation: 'VENTE_HORS_LIGNE',
      entite: 'VENTES',
    },
    jetonAcces: jp(),
  });
  assert.equal(rejoue.statut, 200);
  assert.equal(rejoue.corps.donnees.deja_recue, true);
  assert.equal(rejoue.corps.donnees.operation_id, operation.corps.donnees.operation_id);

  const etatSync = await appel('/api/synchronisation/etat', { jetonAcces: jp() });
  assert.equal(etatSync.statut, 200);
  assert.ok(etatSync.corps.donnees.operations !== undefined);

  // Un conflit reel est insere en base pour verifier la resolution.
  const operationId = operation.corps.donnees.operation_id;
  const conflit = await base().query(
    `INSERT INTO conflits_synchronisation (operation_id, type_conflit, description, donnees)
     VALUES ($1, 'STOCK_DIVERGENT', 'Stock local different du stock serveur', '{}'::jsonb)
     RETURNING id`,
    [operationId],
  );
  const conflitId = conflit.rows[0].id;

  const conflitsOuverts = await appel('/api/synchronisation/conflits?statut=OUVERT', {
    jetonAcces: jp(),
  });
  assert.equal(conflitsOuverts.statut, 200);
  assert.ok(conflitsOuverts.corps.donnees.some((c) => c.id === conflitId));

  const resolution = await appel(`/api/synchronisation/conflits/${conflitId}/resoudre`, {
    methode: 'POST',
    corps: { statut: 'RESOLU', resolution: 'Stock serveur retenu apres verification physique' },
    jetonAcces: jp(),
  });
  assert.equal(resolution.statut, 200);
  assert.equal(resolution.corps.donnees.statut, 'RESOLU');
  assert.ok(resolution.corps.donnees.resolu_le);

  const interditResolution = await appel(`/api/synchronisation/conflits/${conflitId}/resoudre`, {
    methode: 'POST',
    corps: { statut: 'REJETE', resolution: 'Tentative employe sans droit' },
    jetonAcces: je(),
  });
  assert.equal(interditResolution.statut, 403);
});
