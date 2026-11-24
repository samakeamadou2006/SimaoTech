/**
 * Tests d'integration HTTP de la phase 4 : catalogue, categories, produits et
 * prix de vente de reference.
 *
 * Le serveur Express est demarre sur le PostgreSQL embarque en mode
 * d'authentification local (jetons HS256 signes par le test). Aucun service
 * externe n'est requis.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  PORT_TEST,
  arreterBase,
  base,
  creerApprovisionnement,
  creerFournisseur,
  creerUtilisateur,
  demarrerBase,
  validerApprovisionnement,
} from './aide.js';

const SECRET = 'secret-de-test-simaotech-suffisamment-long-pour-hs256';

let serveur = null;
let urlBase = '';
let fermerPool = null;

let proprietaire;
let administrateur;
let employe;

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
  return { statut: reponse.status, corps: contenu };
}

function jetonProprietaire() {
  return jeton(proprietaire);
}

function jetonAdmin() {
  return jeton(administrateur);
}

function jetonEmploye() {
  return jeton(employe);
}

before(async () => {
  await demarrerBase();

  process.env.NODE_ENV = 'test';
  process.env.MODE_AUTH = 'local';
  process.env.JWT_SECRET = SECRET;
  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${PORT_TEST}/postgres`;
  process.env.BASE_DE_DONNEES_SSL = 'false';
  process.env.PORT = '3198';
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

  proprietaire = await creerUtilisateur({
    email: 'proprietaire.phase4@simaotech.test',
    nom: 'Proprietaire Phase Quatre',
    role: 'PROPRIETAIRE',
  });
  administrateur = await creerUtilisateur({
    email: 'admin.phase4@simaotech.test',
    nom: 'Administrateur Phase Quatre',
    role: 'ADMINISTRATEUR',
  });
  employe = await creerUtilisateur({
    email: 'employe.phase4@simaotech.test',
    nom: 'Employe Phase Quatre',
    role: 'EMPLOYE',
  });
});

after(async () => {
  if (serveur) await new Promise((resoudre) => serveur.close(resoudre));
  if (fermerPool) await fermerPool().catch(() => {});
  await arreterBase();
});

test('le catalogue est lisible par l employe mais ferme en ecriture', async () => {
  const sansJeton = await appel('/api/produits');
  assert.equal(sansJeton.statut, 401);

  const lectureEmploye = await appel('/api/produits', { jetonAcces: jetonEmploye() });
  assert.equal(lectureEmploye.statut, 200);

  const categoriesEmploye = await appel('/api/categories', { jetonAcces: jetonEmploye() });
  assert.equal(categoriesEmploye.statut, 200);

  const creationEmploye = await appel('/api/categories', {
    methode: 'POST',
    corps: { nom: 'Interdit Employe' },
    jetonAcces: jetonEmploye(),
  });
  assert.equal(creationEmploye.statut, 403);
  assert.match(creationEmploye.corps.erreur.code, /^PERMISSION_MANQUANTE/);
});

test('creation de categorie : code derive du nom et doublons refuses', async () => {
  const creation = await appel('/api/categories', {
    methode: 'POST',
    corps: { nom: 'Boissons Fraiches', description: 'Boissons gazeuses et jus' },
    jetonAcces: jetonProprietaire(),
  });
  assert.equal(creation.statut, 201);
  assert.equal(creation.corps.donnees.code, 'BOISSONS-FRAICHES');
  assert.equal(creation.corps.donnees.nom, 'Boissons Fraiches');
  assert.equal(creation.corps.donnees.actif, true);

  const memeNom = await appel('/api/categories', {
    methode: 'POST',
    corps: { nom: 'boissons fraiches' },
    jetonAcces: jetonProprietaire(),
  });
  assert.equal(memeNom.statut, 409);
  assert.equal(memeNom.corps.erreur.code, 'CATEGORIE_DEJA_UTILISEE');

  const memeCode = await appel('/api/categories', {
    methode: 'POST',
    corps: { nom: 'Autre Rayon', code: 'BOISSONS-FRAICHES' },
    jetonAcces: jetonProprietaire(),
  });
  assert.equal(memeCode.statut, 409);
  assert.equal(memeCode.corps.erreur.code, 'CODE_CATEGORIE_DEJA_UTILISE');
});

test('modification, filtres et suppression protegee des categories', async () => {
  const creation = await appel('/api/categories', {
    methode: 'POST',
    corps: { nom: 'Epicerie Seche' },
    jetonAcces: jetonAdmin(),
  });
  assert.equal(creation.statut, 201);
  const categorie = creation.corps.donnees;

  const modification = await appel(`/api/categories/${categorie.id}`, {
    methode: 'PATCH',
    corps: { nom: 'Epicerie Generale', actif: false },
    jetonAcces: jetonAdmin(),
  });
  assert.equal(modification.statut, 200);
  assert.equal(modification.corps.donnees.nom, 'Epicerie Generale');
  assert.equal(modification.corps.donnees.actif, false);

  const filtre = await appel('/api/categories?recherche=Epicerie&actif=false', {
    jetonAcces: jetonProprietaire(),
  });
  assert.equal(filtre.statut, 200);
  assert.equal(filtre.corps.meta.total, 1);
  assert.equal(filtre.corps.donnees[0].id, categorie.id);

  const suppression = await appel(`/api/categories/${categorie.id}`, {
    methode: 'DELETE',
    jetonAcces: jetonAdmin(),
  });
  assert.equal(suppression.statut, 200);
  assert.equal(suppression.corps.donnees.supprime, true);

  const apres = await appel(`/api/categories/${categorie.id}`, {
    jetonAcces: jetonProprietaire(),
  });
  assert.equal(apres.statut, 404);
});

test('creation de produit : prix initial reserve au proprietaire', async () => {
  const categorie = await appel('/api/categories', {
    methode: 'POST',
    corps: { nom: 'Telephonie' },
    jetonAcces: jetonProprietaire(),
  });
  assert.equal(categorie.statut, 201);
  const categorieId = categorie.corps.donnees.id;

  const adminAvecPrix = await appel('/api/produits', {
    methode: 'POST',
    corps: {
      nom: 'Chargeur USB-C',
      categorieId,
      prixVenteReference: '5000',
      reference: 'CHG-USB-C',
    },
    jetonAcces: jetonAdmin(),
  });
  assert.equal(adminAvecPrix.statut, 403);
  assert.equal(adminAvecPrix.corps.erreur.code, 'PRIX_RESERVE_PROPRIETAIRE');

  const adminSansPrix = await appel('/api/produits', {
    methode: 'POST',
    corps: { nom: 'Chargeur USB-C', categorieId, reference: 'CHG-USB-C' },
    jetonAcces: jetonAdmin(),
  });
  assert.equal(adminSansPrix.statut, 201);
  assert.equal(adminSansPrix.corps.donnees.prix_vente_reference, '0.00');
  assert.equal(adminSansPrix.corps.donnees.quantite_disponible, '0.000');
  assert.equal(adminSansPrix.corps.donnees.etat_stock, 'RUPTURE');

  const proprietaireAvecPrix = await appel('/api/produits', {
    methode: 'POST',
    corps: {
      nom: 'Ecouteurs Bluetooth',
      categorieId,
      prixVenteReference: '15000',
      reference: 'ECO-BT-01',
      seuilAlerte: '3',
    },
    jetonAcces: jetonProprietaire(),
  });
  assert.equal(proprietaireAvecPrix.statut, 201);
  assert.equal(proprietaireAvecPrix.corps.donnees.prix_vente_reference, '15000.00');
  assert.equal(proprietaireAvecPrix.corps.donnees.seuil_alerte, '3.000');
});

test('reference et code-barres uniques, reference immutable', async () => {
  const categorie = await appel('/api/categories', {
    methode: 'POST',
    corps: { nom: 'Accessoires' },
    jetonAcces: jetonProprietaire(),
  });
  const categorieId = categorie.corps.donnees.id;

  const premier = await appel('/api/produits', {
    methode: 'POST',
    corps: {
      nom: 'Cable HDMI',
      categorieId,
      reference: 'CAB-HDMI-2M',
      codeBarres: '1234567890123',
      prixVenteReference: '4000',
    },
    jetonAcces: jetonProprietaire(),
  });
  assert.equal(premier.statut, 201);

  const referenceDoublon = await appel('/api/produits', {
    methode: 'POST',
    corps: { nom: 'Autre cable', categorieId, reference: 'cab-hdmi-2m', prixVenteReference: '1000' },
    jetonAcces: jetonProprietaire(),
  });
  assert.equal(referenceDoublon.statut, 409);
  assert.equal(referenceDoublon.corps.erreur.code, 'REFERENCE_DEJA_UTILISEE');

  const codeDoublon = await appel('/api/produits', {
    methode: 'POST',
    corps: {
      nom: 'Cable optique',
      categorieId,
      codeBarres: '1234567890123',
      prixVenteReference: '1000',
    },
    jetonAcces: jetonProprietaire(),
  });
  assert.equal(codeDoublon.statut, 409);
  assert.equal(codeDoublon.corps.erreur.code, 'CODE_BARRES_DEJA_UTILISE');

  const changementReference = await appel(`/api/produits/${premier.corps.donnees.id}`, {
    methode: 'PATCH',
    corps: { reference: 'CAB-HDMI-3M' },
    jetonAcces: jetonProprietaire(),
  });
  assert.equal(changementReference.statut, 422);
  assert.equal(changementReference.corps.erreur.code, 'REFERENCE_IMMUABLE');
});

test('changement de prix : permission, motif obligatoire, historique', async () => {
  const categorie = await appel('/api/categories', {
    methode: 'POST',
    corps: { nom: 'Petit Electromenager' },
    jetonAcces: jetonProprietaire(),
  });
  const categorieId = categorie.corps.donnees.id;

  const produit = await appel('/api/produits', {
    methode: 'POST',
    corps: { nom: 'Bouilloire', categorieId, reference: 'BOU-001', prixVenteReference: '12000' },
    jetonAcces: jetonProprietaire(),
  });
  assert.equal(produit.statut, 201);
  const produitId = produit.corps.donnees.id;

  const admin = await appel(`/api/produits/${produitId}/prix`, {
    methode: 'PATCH',
    corps: { prix: '13000', motif: 'Hausse du cout fournisseur' },
    jetonAcces: jetonAdmin(),
  });
  assert.equal(admin.statut, 403);
  assert.match(admin.corps.erreur.code, /^PERMISSION_MANQUANTE/);

  const motifCourt = await appel(`/api/produits/${produitId}/prix`, {
    methode: 'PATCH',
    corps: { prix: '13000', motif: 'abc' },
    jetonAcces: jetonProprietaire(),
  });
  assert.equal(motifCourt.statut, 422);
  assert.equal(motifCourt.corps.erreur.code, 'VALIDATION');

  const succes = await appel(`/api/produits/${produitId}/prix`, {
    methode: 'PATCH',
    corps: { prix: '13500', motif: 'Ajustement de la marge' },
    jetonAcces: jetonProprietaire(),
  });
  assert.equal(succes.statut, 200);
  assert.equal(succes.corps.donnees.prixAncien, '12000.00');
  assert.equal(succes.corps.donnees.prixNouveau, '13500.00');
  assert.equal(succes.corps.donnees.produit.prix_vente_reference, '13500.00');

  const historique = await appel(`/api/produits/${produitId}/historique-prix`, {
    jetonAcces: jetonProprietaire(),
  });
  assert.equal(historique.statut, 200);
  assert.equal(historique.corps.meta.total, 1);
  assert.equal(historique.corps.donnees[0].prix_vente_ancien, '12000.00');
  assert.equal(historique.corps.donnees[0].prix_vente_nouveau, '13500.00');
  assert.equal(historique.corps.donnees[0].motif, 'Ajustement de la marge');

  const { rows } = await base().query(
    `SELECT action FROM journal_activites
      WHERE entite_id = $1 AND action IN ('MODIFICATION_PRIX', 'MODIFICATION_PRIX_PRODUIT')`,
    [produitId],
  );
  assert.ok(rows.length >= 1);
});

test('filtres produits et statistiques du catalogue', async () => {
  const categorie = await appel('/api/categories', {
    methode: 'POST',
    corps: { nom: 'Rangement' },
    jetonAcces: jetonProprietaire(),
  });
  const categorieId = categorie.corps.donnees.id;

  await appel('/api/produits', {
    methode: 'POST',
    corps: { nom: 'Boite plastique', categorieId, reference: 'BOX-PLA-1', prixVenteReference: '2500' },
    jetonAcces: jetonProprietaire(),
  });
  await appel('/api/produits', {
    methode: 'POST',
    corps: { nom: 'Panier osier', categorieId, reference: 'PAN-OSI-1', prixVenteReference: '3500' },
    jetonAcces: jetonProprietaire(),
  });

  const recherche = await appel('/api/produits?recherche=Boite', {
    jetonAcces: jetonEmploye(),
  });
  assert.equal(recherche.statut, 200);
  assert.equal(recherche.corps.meta.total, 1);
  assert.equal(recherche.corps.donnees[0].reference, 'BOX-PLA-1');

  const parCategorie = await appel(`/api/produits?categorie=${categorieId}`, {
    jetonAcces: jetonProprietaire(),
  });
  assert.equal(parCategorie.statut, 200);
  assert.equal(parCategorie.corps.meta.total, 2);

  const ruptures = await appel('/api/produits?etat_stock=RUPTURE', {
    jetonAcces: jetonProprietaire(),
  });
  assert.equal(ruptures.statut, 200);
  assert.ok(ruptures.corps.meta.total >= 2);

  const statistiques = ruptures.corps.meta.statistiques;
  assert.ok(Number(statistiques.total) >= 2);
  assert.ok('actifs' in statistiques);
  assert.ok('ruptures' in statistiques);
  assert.ok('stocks_faibles' in statistiques);
});

test('archivage refuse tant qu il reste du stock, autorise a zero', async () => {
  const categorie = await appel('/api/categories', {
    methode: 'POST',
    corps: { nom: 'Stock Test' },
    jetonAcces: jetonProprietaire(),
  });
  const categorieId = categorie.corps.donnees.id;

  const produit = await appel('/api/produits', {
    methode: 'POST',
    corps: { nom: 'Article Stocke', categorieId, reference: 'STK-001', prixVenteReference: '5000' },
    jetonAcces: jetonProprietaire(),
  });
  assert.equal(produit.statut, 201);
  const produitId = produit.corps.donnees.id;

  const fournisseurId = await creerFournisseur('Fournisseur Stock');
  const appro = await creerApprovisionnement({
    fournisseurId,
    utilisateurId: proprietaire.id,
    lignes: [{ produitId, quantite: 5, prix: '3000' }],
  });
  await validerApprovisionnement(appro.id, proprietaire.id);

  const refuse = await appel(`/api/produits/${produitId}`, {
    methode: 'DELETE',
    jetonAcces: jetonProprietaire(),
  });
  assert.equal(refuse.statut, 409);
  assert.equal(refuse.corps.erreur.code, 'STOCK_RESTANT');

  await base().query('SELECT fn_ajuster_stock($1, $2, $3, $4)', [
    produitId,
    proprietaire.id,
    '-5',
    'Sortie de test pour archivage',
  ]);

  const accepte = await appel(`/api/produits/${produitId}`, {
    methode: 'DELETE',
    jetonAcces: jetonProprietaire(),
  });
  assert.equal(accepte.statut, 200);
  assert.equal(accepte.corps.donnees.supprime, true);

  const apres = await appel(`/api/produits/${produitId}`, {
    jetonAcces: jetonProprietaire(),
  });
  assert.equal(apres.statut, 404);
});

test('une categorie contenant des produits ne peut pas etre supprimee', async () => {
  const categorie = await appel('/api/categories', {
    methode: 'POST',
    corps: { nom: 'Categorie Occupee' },
    jetonAcces: jetonProprietaire(),
  });
  const categorieId = categorie.corps.donnees.id;

  await appel('/api/produits', {
    methode: 'POST',
    corps: { nom: 'Produit Rattache', categorieId, reference: 'CAT-OCC-1', prixVenteReference: '1000' },
    jetonAcces: jetonProprietaire(),
  });

  const suppression = await appel(`/api/categories/${categorieId}`, {
    methode: 'DELETE',
    jetonAcces: jetonProprietaire(),
  });
  assert.equal(suppression.statut, 409);
  assert.equal(suppression.corps.erreur.code, 'CATEGORIE_UTILISEE');
  assert.equal(suppression.corps.erreur.details.nombre_produits, 1);
});
