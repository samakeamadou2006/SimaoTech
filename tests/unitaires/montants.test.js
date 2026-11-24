/**
 * Tests unitaires de l'arithmetique financiere.
 * Execution : npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Decimal,
  arrondir,
  calculerCmp,
  calculerLigneVente,
  paiementsConformes,
  repartirReductionGlobale,
  verifierCoherenceVente,
} from '../../backend/utils/montants.js';

test('CMP - 10 unites a 1 000 puis 10 unites a 1 200 = 1 100', () => {
  const premier = calculerCmp({
    quantiteAvant: 0,
    cmpAvant: 0,
    quantiteEntree: 10,
    coutUnitaireEntree: 1000,
  });
  assert.equal(premier.toFixed(2), '1000.00');

  const second = calculerCmp({
    quantiteAvant: 10,
    cmpAvant: premier,
    quantiteEntree: 10,
    coutUnitaireEntree: 1200,
  });
  assert.equal(second.toFixed(2), '1100.00');
});

test('CMP - une entree sur stock existant ne modifie pas les quantites deja sorties', () => {
  const cmp = calculerCmp({
    quantiteAvant: 5,
    cmpAvant: 1100,
    quantiteEntree: 15,
    coutUnitaireEntree: 1400,
  });
  assert.equal(cmp.toFixed(4), '1325.0000');
});

test('CMP - stock vide et entree nulle retourne 0', () => {
  assert.equal(calculerCmp({ quantiteAvant: 0, cmpAvant: 0, quantiteEntree: 0, coutUnitaireEntree: 500 }).toNumber(), 0);
});

test('CMP - refuse les quantites negatives', () => {
  assert.throws(
    () => calculerCmp({ quantiteAvant: -1, cmpAvant: 0, quantiteEntree: 2, coutUnitaireEntree: 10 }),
    /negatives/,
  );
});

test('Benefice unitaire - 1 500 - 1 100 = 400', () => {
  const ligne = calculerLigneVente({ quantite: 1, prixNetUnitaire: 1500, cmpApplique: 1100 });
  assert.equal(ligne.beneficeUnitaire.toFixed(2), '400.00');
  assert.equal(ligne.beneficeBrut.toFixed(2), '400.00');
  assert.equal(ligne.margeUnitaire.toFixed(2), '26.67');
});

test('Vente a perte - prix net 1 000 sous CMP 1 100 : bloquee', () => {
  assert.throws(
    () => calculerLigneVente({ quantite: 1, prixNetUnitaire: 1000, cmpApplique: 1100 }),
    /VENTE_A_PERTE/,
  );
});

test('Reduction egale au benefice - autorisee avec benefice nul', () => {
  const ligne = calculerLigneVente({ quantite: 2, prixNetUnitaire: 1100, cmpApplique: 1100 });
  assert.equal(ligne.beneficeBrut.toFixed(2), '0.00');
  assert.equal(ligne.margeUnitaire.toFixed(2), '0.00');
});

test('Paiement mixte - 8 000 especes + 12 000 Wave = 20 000', () => {
  const resultat = paiementsConformes(20000, [
    { moyen: 'ESPECES', montant: 8000 },
    { moyen: 'WAVE', montant: 12000 },
  ]);
  assert.equal(resultat.conforme, true);
  assert.equal(resultat.ecart.toFixed(2), '0.00');
});

test('Paiement insuffisant - 18 000 pour 20 000 : refuse', () => {
  const resultat = paiementsConformes(20000, [{ moyen: 'ESPECES', montant: 18000 }]);
  assert.equal(resultat.conforme, false);
  assert.equal(resultat.ecart.toFixed(2), '-2000.00');
});

test('Paiement avec excedent - refuse (pas de rendu monnaie en v1)', () => {
  const resultat = paiementsConformes(20000, [{ moyen: 'ESPECES', montant: 25000 }]);
  assert.equal(resultat.conforme, false);
});

test('Repartition de reduction globale - somme exacte et deterministe', () => {
  const lignes = [
    { id: 'a', montant: '3333.33' },
    { id: 'b', montant: '3333.33' },
    { id: 'c', montant: '3333.34' },
  ];
  const repartition = repartirReductionGlobale('1000.00', lignes);
  const somme = repartition.reduce((s, r) => s.plus(r.montant), new Decimal(0));
  assert.equal(somme.toFixed(2), '1000.00');

  const seconde = repartirReductionGlobale('1000.00', lignes);
  assert.deepEqual(
    repartition.map((r) => r.montant.toFixed(2)),
    seconde.map((r) => r.montant.toFixed(2)),
  );
});

test('Repartition de reduction globale - centime restant attribue de facon deterministe', () => {
  const repartition = repartirReductionGlobale('0.01', [
    { id: 'z', montant: '10.00' },
    { id: 'a', montant: '10.00' },
  ]);
  assert.equal(repartition.find((r) => r.id === 'a').montant.toFixed(2), '0.01');
  assert.equal(repartition.find((r) => r.id === 'z').montant.toFixed(2), '0.00');
});

test('Repartition - refuse une reduction superieure au total', () => {
  assert.throws(
    () => repartirReductionGlobale('50', [{ id: 'a', montant: '10' }]),
    /depasse/,
  );
});

test('Coherence - CA, CMV et benefice d une vente multi-lignes', () => {
  const lignes = [
    { quantite: 2, prixNetUnitaire: '1500.00', cmpApplique: '1100.000000' },
    { quantite: 1, prixNetUnitaire: '800.00', cmpApplique: '650.500000' },
  ];
  const controle = verifierCoherenceVente({
    montantNet: '3800.00',
    coutTotal: '2850.50',
    beneficeBrut: '949.50',
    lignes,
  });
  assert.equal(controle.caCoherent, true);
  assert.equal(controle.coutCoherent, true);
  assert.equal(controle.beneficeCoherent, true);
});

test('Arrondi commercial - demi-centime arrondi au superieur', () => {
  assert.equal(arrondir('10.005').toFixed(2), '10.01');
  assert.equal(arrondir('10.004').toFixed(2), '10.00');
});

test('Aucun montant ne transite par un flottant', () => {
  const valeur = calculerCmp({ quantiteAvant: 3, cmpAvant: '0.1', quantiteEntree: 3, coutUnitaireEntree: '0.2' });
  assert.ok(valeur instanceof Decimal);
  assert.equal(valeur.toFixed(6), '0.150000');
});
