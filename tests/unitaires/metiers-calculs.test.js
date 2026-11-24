import test from 'node:test';
import assert from 'node:assert/strict';
import { estimerTotalVente } from '../../frontend/js/metiers-calculs.js';

const produits = [
  { id: 'article-a', prix_vente_reference: '1500.00' },
  { id: 'article-b', prix_vente_reference: '1.00' },
];

test('estimation de vente : prix catalogue multiplie par quantite', () => {
  assert.equal(
    estimerTotalVente(
      [{ produitId: 'article-a', quantite: '2', reduction: '0' }],
      produits,
    ),
    '3000.00',
  );
});

test('estimation de vente : arrondi au centime et reduction par ligne', () => {
  assert.equal(
    estimerTotalVente(
      [
        { produitId: 'article-a', quantite: '2', reduction: '1.00' },
        { produitId: 'article-b', quantite: '0.005', reduction: '0' },
      ],
      produits,
    ),
    '2999.01',
  );
});

test('estimation de vente : refuse produit absent et precisions invalides', () => {
  assert.throws(
    () => estimerTotalVente([{ produitId: 'inconnu', quantite: '1' }], produits),
    /Selectionnez un produit/,
  );
  assert.throws(
    () =>
      estimerTotalVente(
        [{ produitId: 'article-a', quantite: '1.0001', reduction: '0' }],
        produits,
      ),
    /Quantite invalide/,
  );
  assert.throws(
    () =>
      estimerTotalVente(
        [{ produitId: 'article-a', quantite: '1', reduction: '1501' }],
        produits,
      ),
    /reduction depasse/,
  );
});
