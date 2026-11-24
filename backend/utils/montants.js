/**
 * Arithemetique financiere exacte.
 *
 * Regle absolue : aucun montant ne passe par un `number` JavaScript.
 * Toutes les valeurs monetaires sont manipulees en Decimal, avec arrondi
 * commercial (ROUND_HALF_UP) au centime pour les montants en XOF et une
 * precision elevee pour les couts moyens ponderes.
 */
import Decimal from 'decimal.js';

Decimal.set({
  precision: 28,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -30,
  toExpPos: 30,
});

export { Decimal };

export const PRECISION_MONTANT = 2;
export const PRECISION_QUANTITE = 3;
export const PRECISION_CMP = 6;

export const ZERO = new Decimal(0);
export const CENT = new Decimal('0.01');

export function d(valeur, defaut = 0) {
  if (valeur === null || valeur === undefined || valeur === '') return new Decimal(defaut);
  if (valeur instanceof Decimal) return valeur;
  try {
    return new Decimal(valeur);
  } catch {
    throw new TypeError(`Valeur numerique invalide : ${valeur}`);
  }
}

/** Arrondit un montant au centime (ou a la precision demandee). */
export function arrondir(valeur, decimales = PRECISION_MONTANT) {
  return d(valeur).toDecimalPlaces(decimales, Decimal.ROUND_HALF_UP);
}

/** Formate un montant pour l API (chaine decimale, jamais un flottant). */
export function montantTexte(valeur, decimales = PRECISION_MONTANT) {
  return arrondir(valeur, decimales).toFixed(decimales);
}

export function estNegatif(valeur) {
  return d(valeur).isNegative();
}

export function estPositif(valeur) {
  return d(valeur).isPositive();
}

export function comparer(a, b) {
  return d(a).comparedTo(d(b));
}

/**
 * Cout moyen pondere apres une entree en stock.
 *
 * CMP = ((Q1 x CMP1) + (Q2 x C2)) / (Q1 + Q2)
 *
 * Le resultat est conserve avec 6 decimales pour eviter une derive d'arrondi
 * sur les entrees successives ; l'affichage et les montants restent au centime.
 */
export function calculerCmp({ quantiteAvant, cmpAvant, quantiteEntree, coutUnitaireEntree }) {
  const q1 = d(quantiteAvant);
  const c1 = d(cmpAvant);
  const q2 = d(quantiteEntree);
  const c2 = d(coutUnitaireEntree);

  if (q1.isNegative() || q2.isNegative()) {
    throw new TypeError('Les quantites ne peuvent pas etre negatives.');
  }
  if (c1.isNegative() || c2.isNegative()) {
    throw new TypeError('Les couts ne peuvent pas etre negatifs.');
  }

  const quantiteTotale = q1.plus(q2);
  if (quantiteTotale.isZero()) return new Decimal(0);

  const valeurAvant = q1.times(c1);
  const valeurEntree = q2.times(c2);
  return valeurAvant.plus(valeurEntree).dividedBy(quantiteTotale).toDecimalPlaces(
    PRECISION_CMP,
    Decimal.ROUND_HALF_UP,
  );
}

/**
 * Benefice brut d'une ligne de vente.
 * @returns {{prixNetUnitaire: Decimal, coutUnitaire: Decimal, beneficeUnitaire: Decimal,
 *            coutTotal: Decimal, beneficeBrut: Decimal, margeUnitaire: Decimal}}
 */
export function calculerLigneVente({ quantite, prixNetUnitaire, cmpApplique }) {
  const q = d(quantite);
  const prix = arrondir(prixNetUnitaire);
  const cmp = d(cmpApplique);

  if (q.isNegative()) throw new TypeError('La quantite vendue ne peut pas etre negative.');
  if (prix.lessThan(cmp)) {
    throw new Error('VENTE_A_PERTE');
  }

  const coutTotal = arrondir(cmp.times(q));
  const beneficeBrut = arrondir(prix.minus(cmp).times(q));
  const beneficeUnitaire = arrondir(prix.minus(cmp));
  const margeUnitaire = prix.isZero()
    ? new Decimal(0)
    : prix.minus(cmp).dividedBy(prix).times(100).toDecimalPlaces(2);

  return {
    prixNetUnitaire: prix,
    coutUnitaire: arrondir(cmp),
    beneficeUnitaire,
    coutTotal,
    beneficeBrut,
    margeUnitaire,
  };
}

/** Controle : le total des paiements egale exactement le montant de la vente. */
export function paiementsConformes(montantVente, paiements) {
  const total = (paiements ?? []).reduce((somme, p) => somme.plus(d(p.montant)), new Decimal(0));
  const attendu = arrondir(montantVente);
  return {
    conforme: total.equals(attendu),
    total: arrondir(total),
    attendu,
    ecart: arrondir(total.minus(attendu)),
  };
}

/**
 * Repartition deterministe et verifiable d'une reduction globale sur des lignes.
 *
 * Methode du plus fort reste, en centimes entiers :
 *  1. chaque ligne recoit la part entiere de sa quote-part proportionnelle ;
 *  2. les centimes restants sont attribues aux plus forts restes, puis par
 *     identifiant croissant (depart d'egalite totalement deterministe).
 *
 * @param {Decimal|string|number} montantReduction
 * @param {Array<{id: string, montant: Decimal|string|number}>} lignes
 * @returns {Array<{id: string, montant: Decimal}>} somme exactement egale a la reduction
 */
export function repartirReductionGlobale(montantReduction, lignes) {
  const total = arrondir(montantReduction);
  if (total.isNegative()) throw new TypeError('La reduction ne peut pas etre negative.');
  if (lignes.length === 0) {
    if (!total.isZero()) throw new TypeError('Aucune ligne a reduire.');
    return [];
  }

  const bases = lignes.map((l) => ({
    id: l.id,
    montant: arrondir(l.montant),
  }));
  const baseTotale = bases.reduce((s, l) => s.plus(l.montant), new Decimal(0));

  if (baseTotale.isZero()) {
    if (!total.isZero()) throw new TypeError('Impossible de repartir une reduction sur un total nul.');
    return bases.map((l) => ({ id: l.id, montant: ZERO }));
  }
  if (total.greaterThan(baseTotale)) {
    throw new TypeError('La reduction globale depasse le total des lignes.');
  }

  const totalCentimes = total.times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  const allocations = bases.map((l) => {
    const partExacte = l.montant.dividedBy(baseTotale).times(totalCentimes);
    const partEntiere = Math.floor(partExacte.toNumber());
    return { id: l.id, centimes: partEntiere, reste: partExacte.minus(partEntiere), montant: l.montant };
  });

  let distribues = allocations.reduce((s, a) => s + a.centimes, 0);
  let restant = totalCentimes - distribues;

  const ordonnees = [...allocations].sort((a, b) => {
    const comparaison = b.reste.comparedTo(a.reste);
    if (comparaison !== 0) return comparaison;
    return String(a.id).localeCompare(String(b.id));
  });

  let index = 0;
  while (restant > 0 && ordonnees.length > 0) {
    const cible = ordonnees[index % ordonnees.length];
    const capacite = cible.montant.times(100).toDecimalPlaces(0).toNumber() - cible.centimes;
    if (capacite > 0) {
      cible.centimes += 1;
      restant -= 1;
    }
    index += 1;
    if (index > ordonnees.length * 4 + 1000) break;
  }

  if (restant !== 0) {
    throw new TypeError('Repartition de reduction impossible.');
  }

  const parId = new Map(allocations.map((a) => [a.id, a]));
  return lignes.map((l) => ({
    id: l.id,
    montant: new Decimal(parId.get(l.id).centimes).dividedBy(100),
  }));
}

/** Controle de coherence d'une vente deja calculee. */
export function verifierCoherenceVente({ montantNet, coutTotal, beneficeBrut, lignes }) {
  const caLignes = lignes.reduce((s, l) => s.plus(arrondir(l.prixNetUnitaire).times(d(l.quantite))), new Decimal(0));
  const cmv = lignes.reduce((s, l) => s.plus(arrondir(d(l.cmpApplique).times(d(l.quantite)))), new Decimal(0));
  const marge = caLignes.minus(cmv);
  return {
    caCoherent: arrondir(caLignes).equals(arrondir(montantNet)),
    coutCoherent: arrondir(cmv).equals(arrondir(coutTotal)),
    beneficeCoherent: arrondir(marge).equals(arrondir(beneficeBrut)),
    ca: arrondir(caLignes),
    cout: arrondir(cmv),
    benefice: arrondir(marge),
  };
}
