/**
 * Tests metier d'integration sur PostgreSQL reel.
 *
 * Chaque test reproduit un scenario du cahier des charges (CMP, vente a perte,
 * paiements, annulation, permissions, idempotence, concurrence, coherence).
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import {
  PORT_TEST,
  arreterBase,
  base,
  cmpProduit,
  creerApprovisionnement,
  creerCategorie,
  creerFournisseur,
  creerProduit,
  creerUtilisateur,
  creerVente,
  demarrerBase,
  donneesVente,
  stockProduit,
  validerApprovisionnement,
  validerVente,
} from './aide.js';

let proprietaire;
let vendeur;
let categorie;
let fournisseur;

before(async () => {
  await demarrerBase();
  proprietaire = await creerUtilisateur({
    email: 'proprietaire@simaotech.test',
    nom: 'Proprietaire SimaoTech',
    role: 'PROPRIETAIRE',
  });
  vendeur = await creerUtilisateur({
    email: 'vendeur@simaotech.test',
    nom: 'Vendeur Boutique',
    role: 'EMPLOYE',
  });
  categorie = await creerCategorie('Boissons');
  fournisseur = await creerFournisseur('Fournisseur Central');
});

after(async () => {
  await arreterBase();
});

async function produitApprovisionne({ prixVente = 1500, stock = 10, cout = 1000, nom = 'Produit test' }) {
  const produit = await creerProduit({ nom, categorieId: categorie, prix: prixVente });
  const appro = await creerApprovisionnement({
    fournisseurId: fournisseur,
    utilisateurId: proprietaire.id,
    lignes: [{ produitId: produit.id, quantite: stock, prix: cout }],
  });
  await validerApprovisionnement(appro.id, proprietaire.id);
  return produit;
}

// -----------------------------------------------------------------------------
// Test 1 : calcul du CMP
// -----------------------------------------------------------------------------
test('Test 1 - CMP : 10 x 1 000 puis 10 x 1 200 donne 1 100', async () => {
  const produit = await creerProduit({ nom: 'Ciment 50kg', categorieId: categorie, prix: 1500 });

  const appro1 = await creerApprovisionnement({
    fournisseurId: fournisseur,
    utilisateurId: proprietaire.id,
    lignes: [{ produitId: produit.id, quantite: 10, prix: 1000 }],
  });
  await validerApprovisionnement(appro1.id, proprietaire.id);
  assert.equal((await cmpProduit(produit.id)), '1000.000000');

  const appro2 = await creerApprovisionnement({
    fournisseurId: fournisseur,
    utilisateurId: proprietaire.id,
    lignes: [{ produitId: produit.id, quantite: 10, prix: 1200 }],
  });
  await validerApprovisionnement(appro2.id, proprietaire.id);

  assert.equal(await cmpProduit(produit.id), '1100.000000');
  assert.equal((await stockProduit(produit.id)).quantite_disponible, '20.000');

  const { rows } = await base().query(
    'SELECT count(*)::int AS n FROM historique_cout_moyen WHERE produit_id = $1',
    [produit.id],
  );
  assert.equal(rows[0].n, 2, 'chaque entree doit historiser le CMP');
});

test('Test 1b - CMP : la reduction fournisseur est deduite du cout d acquisition', async () => {
  const produit = await creerProduit({ nom: 'Huile 5L', categorieId: categorie, prix: 5000 });
  const appro = await creerApprovisionnement({
    fournisseurId: fournisseur,
    utilisateurId: proprietaire.id,
    lignes: [{ produitId: produit.id, quantite: 10, prix: 4000, reduction: 2000 }],
  });
  const resultat = await validerApprovisionnement(appro.id, proprietaire.id);
  assert.equal(Number(resultat.cout_net), 38000);
  assert.equal(await cmpProduit(produit.id), '3800.000000');
});

// -----------------------------------------------------------------------------
// Tests 2, 3, 4 : benefice, vente a perte, reduction egale au benefice
// -----------------------------------------------------------------------------
test('Test 2 - benefice unitaire : 1 500 - 1 100 = 400', async () => {
  const produit = await produitApprovisionne({ prixVente: 1500, stock: 5, cout: 1000 });
  const vente = await creerVente({
    utilisateurId: vendeur.id,
    lignes: [{ produitId: produit.id, quantite: 1, prix: 1500, cmp: '1100.000000' }],
    paiements: [{ moyen: 'ESPECES', montant: 1500 }],
  });

  const resultat = await validerVente(vente.id, vendeur.id);
  assert.equal(Number(resultat.benefice_brut), 400);
  assert.equal(Number(resultat.cout_total), 1100);
});

test('Test 3 - vente a perte : prix net 1 000 sous CMP 1 100 refusee par PostgreSQL', async () => {
  const produit = await creerProduit({ nom: 'Produit marge', categorieId: categorie, prix: 1500 });

  await assert.rejects(
    () =>
      creerVente({
        utilisateurId: vendeur.id,
        lignes: [{ produitId: produit.id, quantite: 1, prix: 1500, reduction: 500, cmp: '1100.000000' }],
        paiements: [{ moyen: 'ESPECES', montant: 1000 }],
      }),
    /prix_net_superieur_cmp|VENTE_A_PERTE/,
  );
});

test('Test 4 - reduction egale au benefice : vente autorisee avec benefice nul', async () => {
  const produit = await produitApprovisionne({ prixVente: 1500, stock: 3, cout: 1000 });
  const vente = await creerVente({
    utilisateurId: vendeur.id,
    lignes: [{ produitId: produit.id, quantite: 1, prix: 1500, reduction: 400, cmp: '1100.000000' }],
    paiements: [{ moyen: 'ESPECES', montant: 1100 }],
  });

  const resultat = await validerVente(vente.id, vendeur.id);
  assert.equal(Number(resultat.montant_net), 1100);
  assert.equal(Number(resultat.benefice_brut), 0);
});

// -----------------------------------------------------------------------------
// Tests 5 et 6 : paiements
// -----------------------------------------------------------------------------
test('Test 5 - paiement mixte 8 000 especes + 12 000 Wave valide', async () => {
  const produit = await produitApprovisionne({ prixVente: 2000, stock: 20, cout: 1000, nom: 'Produit mixte' });
  const vente = await creerVente({
    utilisateurId: vendeur.id,
    lignes: [{ produitId: produit.id, quantite: 10, prix: 2000, cmp: '1000.000000' }],
    paiements: [
      { moyen: 'ESPECES', montant: 8000 },
      { moyen: 'WAVE', montant: 12000, reference: 'WAVE-2026-0001' },
    ],
  });

  const resultat = await validerVente(vente.id, vendeur.id);
  assert.equal(Number(resultat.montant_net), 20000);
  assert.equal(Number(resultat.paiements), 20000);
});

test('Test 6 - paiement insuffisant : vente refusee, stock inchange', async () => {
  const produit = await produitApprovisionne({ prixVente: 2000, stock: 20, cout: 1000, nom: 'Produit insuffisant' });
  const vente = await creerVente({
    utilisateurId: vendeur.id,
    lignes: [{ produitId: produit.id, quantite: 10, prix: 2000, cmp: '1000.000000' }],
    paiements: [{ moyen: 'ESPECES', montant: 18000 }],
  });

  await assert.rejects(
    () => validerVente(vente.id, vendeur.id),
    /PAIEMENT_NON_CONFORME/,
  );

  const apres = await donneesVente(vente.id);
  assert.equal(apres.statut, 'BROUILLON');
  assert.equal((await stockProduit(produit.id)).quantite_disponible, '20.000');
});

test('Test 5b - Mobile Money sans reference de transaction : refuse', async () => {
  const produit = await produitApprovisionne({ prixVente: 2000, stock: 5, cout: 1000, nom: 'Produit MoMo' });
  await assert.rejects(
    () =>
      creerVente({
        utilisateurId: vendeur.id,
        lignes: [{ produitId: produit.id, quantite: 1, prix: 2000, cmp: '1000.000000' }],
        paiements: [{ moyen: 'ORANGE_MONEY', montant: 2000 }],
      }),
    (erreur) => erreur.code === '23514',
  );
});

// -----------------------------------------------------------------------------
// Test 7 et 12 : annulation et coherence
// -----------------------------------------------------------------------------
test('Test 7 - annulation : 3 unites reintegrees, vente conservee, historique complet', async () => {
  const produit = await produitApprovisionne({ prixVente: 1500, stock: 10, cout: 1000, nom: 'Produit annulation' });
  const vente = await creerVente({
    utilisateurId: vendeur.id,
    lignes: [{ produitId: produit.id, quantite: 3, prix: 1500, cmp: '1000.000000' }],
    paiements: [{ moyen: 'ESPECES', montant: 4500 }],
  });
  await validerVente(vente.id, vendeur.id);
  assert.equal((await stockProduit(produit.id)).quantite_disponible, '7.000');

  const demande = await base().query('SELECT fn_creer_demande_annulation($1, $2, $3) AS id', [
    vente.id,
    vendeur.id,
    'Client a retourne la marchandise',
  ]);
  const demandeId = demande.rows[0].id;

  const resultat = await base().query('SELECT fn_approuver_annulation($1, $2, $3) AS r', [
    demandeId,
    proprietaire.id,
    'Retour verifie',
  ]);

  assert.equal(resultat.rows[0].r.statut, 'ANNULEE');
  assert.equal(Number(resultat.rows[0].r.unites_reintegrees), 3);
  assert.equal((await stockProduit(produit.id)).quantite_disponible, '10.000');

  const apres = await donneesVente(vente.id);
  assert.equal(apres.statut, 'ANNULEE');
  assert.ok(apres.annule_le, 'la vente annulee reste en base avec sa date');

  const { rows: lignes } = await base().query('SELECT count(*)::int AS n FROM lignes_vente WHERE vente_id = $1', [vente.id]);
  assert.equal(lignes[0].n, 1, 'les lignes d origine sont conservees');

  const { rows: historique } = await base().query(
    'SELECT count(*)::int AS n FROM historique_annulations WHERE vente_id = $1',
    [vente.id],
  );
  assert.equal(historique[0].n, 2, 'demande + approbation historisees');
});

test('Test 12 - coherence : le CA et le benefice excluent les ventes annulees', async () => {
  const produit = await produitApprovisionne({ prixVente: 1500, stock: 10, cout: 1000, nom: 'Produit coherence' });

  const vente = await creerVente({
    utilisateurId: vendeur.id,
    lignes: [{ produitId: produit.id, quantite: 2, prix: 1500, cmp: '1000.000000' }],
    paiements: [{ moyen: 'ESPECES', montant: 3000 }],
  });
  await validerVente(vente.id, vendeur.id);

  const demande = await base().query('SELECT fn_creer_demande_annulation($1, $2, $3) AS id', [
    vente.id,
    vendeur.id,
    'Erreur de saisie du vendeur',
  ]);
  await base().query('SELECT fn_approuver_annulation($1, $2, $3)', [
    demande.rows[0].id,
    proprietaire.id,
    'Confirme',
  ]);

  const { rows } = await base().query(`
    SELECT
      round(coalesce(sum(montant_net), 0), 2)            AS ca,
      round(coalesce(sum(benefice_brut), 0), 2)          AS benefice,
      count(*)::int                            AS ventes
    FROM ventes
    WHERE statut = 'VALIDEE'
  `);
  const { rows: attendu } = await base().query(`
    SELECT
      round(coalesce(sum(l.prix_net_unitaire * l.quantite), 0), 2) AS ca,
      round(coalesce(sum(l.benefice_brut_ligne), 0), 2)            AS benefice
    FROM lignes_vente l
    JOIN ventes v ON v.id = l.vente_id
    WHERE v.statut = 'VALIDEE'
  `);

  assert.equal(rows[0].ca, attendu[0].ca);
  assert.equal(rows[0].benefice, attendu[0].benefice);

  const { rows: annulee } = await base().query(
    `SELECT count(*)::int AS n FROM ventes WHERE id = $1 AND statut = 'ANNULEE'`,
    [vente.id],
  );
  assert.equal(annulee[0].n, 1, 'aucune double comptabilisation : la vente reste ANNULEE une seule fois');
});

// -----------------------------------------------------------------------------
// Tests 8 et 9 : permissions
// -----------------------------------------------------------------------------
test('Test 8 - un employe ne peut pas modifier le prix de vente de reference', async () => {
  const produit = await produitApprovisionne({ prixVente: 1500, stock: 2, cout: 1000, nom: 'Produit prix protege' });

  await assert.rejects(
    () => base().query('SELECT fn_modifier_prix_produit($1, $2, $3, $4)', [produit.id, vendeur.id, 2000, 'Test']),
    /PERMISSION_REFUSEE/,
  );

  const { rows } = await base().query('SELECT prix_vente_reference FROM produits WHERE id = $1', [produit.id]);
  assert.equal(rows[0].prix_vente_reference, '1500.00');

  await base().query('SELECT fn_modifier_prix_produit($1, $2, $3, $4)', [
    produit.id,
    proprietaire.id,
    1800,
    'Hausse decidee par le proprietaire',
  ]);

  const apres = await base().query('SELECT prix_vente_reference FROM produits WHERE id = $1', [produit.id]);
  assert.equal(apres.rows[0].prix_vente_reference, '1800.00');

  const historique = await base().query(
    'SELECT prix_vente_ancien, prix_vente_nouveau, modifie_par FROM historique_prix_produits WHERE produit_id = $1',
    [produit.id],
  );
  assert.equal(historique.rows.length, 1);
  assert.equal(historique.rows[0].modifie_par, proprietaire.id);
});

test('Test 8b - le CMP ne peut pas etre modifie directement', async () => {
  const produit = await produitApprovisionne({ stock: 2, cout: 1000, nom: 'Produit cmp protege' });
  await assert.rejects(
    () => base().query('UPDATE produits SET cout_moyen_pondere = 1 WHERE id = $1', [produit.id]),
    /CMP_PROTEGE/,
  );
});

test('Test 9 - depense : refusee sans permission, acceptee avec permission individuelle', async () => {
  const { rows: categories } = await base().query(`SELECT id FROM categories_depenses WHERE code = 'TRANSPORT'`);
  const categorieDepense = categories[0].id;

  await assert.rejects(
    () =>
      base().query('SELECT fn_creer_depense($1, $2, $3, $4)', [
        vendeur.id,
        categorieDepense,
        5000,
        'Transport de marchandises',
      ]),
    /PERMISSION_REFUSEE/,
  );

  await base().query(
    `INSERT INTO utilisateur_permissions (utilisateur_id, permission_id, accorde, accorde_par)
     SELECT $1, id, true, $2 FROM permissions WHERE code = 'depenses.creer'`,
    [vendeur.id, proprietaire.id],
  );

  const creation = await base().query('SELECT fn_creer_depense($1, $2, $3, $4) AS id', [
    vendeur.id,
    categorieDepense,
    5000,
    'Transport de marchandises',
  ]);
  const depenseId = creation.rows[0].id;

  const { rows } = await base().query('SELECT statut, montant, utilisateur_id FROM depenses WHERE id = $1', [depenseId]);
  assert.equal(rows[0].statut, 'EN_ATTENTE');
  assert.equal(rows[0].montant, '5000.00');
  assert.equal(rows[0].utilisateur_id, vendeur.id);

  await base().query('SELECT fn_valider_depense($1, $2)', [depenseId, proprietaire.id]);
  const apres = await base().query('SELECT statut, valide_par FROM depenses WHERE id = $1', [depenseId]);
  assert.equal(apres.rows[0].statut, 'VALIDEE');
  assert.equal(apres.rows[0].valide_par, proprietaire.id);

  const historique = await base().query(
    'SELECT count(*)::int AS n FROM historique_depenses WHERE depense_id = $1',
    [depenseId],
  );
  assert.equal(historique.rows[0].n, 2);
});

// -----------------------------------------------------------------------------
// Test 10 : idempotence de la synchronisation
// -----------------------------------------------------------------------------
test('Test 10 - une operation transmise deux fois ne cree qu une entree', async () => {
  const { rows: appareils } = await base().query(
    `INSERT INTO appareils (code, nom, utilisateur_id) VALUES ('TAB-001', 'Tablette caisse', $1) RETURNING id`,
    [vendeur.id],
  );
  const appareilId = appareils[0].id;
  const cle = crypto.randomUUID();

  const premier = await base().query(
    `SELECT fn_enregistrer_operation_synchronisation($1, $2, 'VENTE', 'ventes', NULL, $3, '{"test":true}'::jsonb) AS r`,
    [appareilId, vendeur.id, cle],
  );
  const second = await base().query(
    `SELECT fn_enregistrer_operation_synchronisation($1, $2, 'VENTE', 'ventes', NULL, $3, '{"test":true}'::jsonb) AS r`,
    [appareilId, vendeur.id, cle],
  );

  assert.equal(premier.rows[0].r.deja_recue, false);
  assert.equal(second.rows[0].r.deja_recue, true);
  assert.equal(premier.rows[0].r.operation_id, second.rows[0].r.operation_id);

  const { rows } = await base().query(
    'SELECT count(*)::int AS n FROM operations_synchronisation WHERE cle_idempotence = $1',
    [cle],
  );
  assert.equal(rows[0].n, 1);
});

// -----------------------------------------------------------------------------
// Test 11 : concurrence sur le stock
// -----------------------------------------------------------------------------
test('Test 11 - deux ventes concurrentes ne rendent jamais le stock negatif', async () => {
  const produit = await produitApprovisionne({ prixVente: 2000, stock: 5, cout: 1000, nom: 'Produit concurrence' });

  const venteA = await creerVente({
    utilisateurId: vendeur.id,
    lignes: [{ produitId: produit.id, quantite: 4, prix: 2000, cmp: '1000.000000' }],
    paiements: [{ moyen: 'ESPECES', montant: 8000 }],
  });
  const venteB = await creerVente({
    utilisateurId: vendeur.id,
    lignes: [{ produitId: produit.id, quantite: 4, prix: 2000, cmp: '1000.000000' }],
    paiements: [{ moyen: 'ESPECES', montant: 8000 }],
  });

  const connexionA = new pg.Client({
    connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT_TEST}/postgres`,
  });
  const connexionB = new pg.Client({
    connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT_TEST}/postgres`,
  });
  await Promise.all([connexionA.connect(), connexionB.connect()]);

  const executer = async (connexion, venteId) => {
    await connexion.query('BEGIN');
    try {
      await connexion.query('SELECT fn_valider_vente($1, $2)', [venteId, vendeur.id]);
      await connexion.query('COMMIT');
      return 'validÃ©e';
    } catch (erreur) {
      await connexion.query('ROLLBACK');
      throw erreur;
    }
  };

  const resultats = await Promise.allSettled([
    executer(connexionA, venteA.id),
    executer(connexionB, venteB.id),
  ]);

  await Promise.all([connexionA.end(), connexionB.end()]);

  const succes = resultats.filter((r) => r.status === 'fulfilled');
  const echecs = resultats.filter((r) => r.status === 'rejected');

  assert.equal(succes.length, 1, 'une seule vente doit etre validee');
  assert.equal(echecs.length, 1, 'la seconde doit echouer');
  assert.match(echecs[0].reason.message, /STOCK_INSUFFISANT/);

  const stock = await stockProduit(produit.id);
  assert.equal(stock.quantite_disponible, '1.000');
  assert.ok(Number(stock.quantite_disponible) >= 0);

  const { rows } = await base().query(
    `SELECT count(*)::int AS n FROM ventes WHERE statut = 'VALIDEE' AND id = ANY($1::uuid[])`,
    [[venteA.id, venteB.id]],
  );
  assert.equal(rows[0].n, 1);
});

