/**
 * Service du catalogue : categories, produits et prix de vente.
 *
 * Regles appliquees ici, en plus des contraintes SQL :
 * - seul un porteur de `produits.modifier_prix` fixe un prix de vente ;
 * - la reference d'un produit est immutable apres creation (les recus et
 *   l'historique la citent) ;
 * - un produit ne disparait jamais : suppression logique uniquement, refusee
 *   tant qu'il reste du stock ;
 * - une categorie encore utilisee ne peut pas etre supprimee ;
 * - chaque operation est journalisee dans `journal_activites`.
 */
import * as modele from '../modeles/catalogue.modele.js';
import { journaliser } from '../modeles/utilisateurs.modele.js';
import { possedePermission } from './authentification.service.js';
import {
  ErreurApplication,
  ErreurConflit,
  ErreurIntrouvable,
  ErreurValidation,
} from '../utils/erreurs.js';
import { arrondir, d, montantTexte, PRECISION_QUANTITE } from '../utils/montants.js';

const STATUTS = new Set(['ACTIF', 'ARCHIVE']);
const ETATS_STOCK = new Set(['NORMAL', 'FAIBLE', 'RUPTURE']);
const TRIS = new Set(['nom', 'reference', 'prix', 'stock', 'recent']);

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

export function sansAccents(valeur) {
  return String(valeur ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function validerCode(valeur, { prefixe = 'CAT', longueur = 40 } = {}) {
  const base = sansAccents(valeur)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, longueur);
  return base || `${prefixe}-${Date.now().toString(36).toUpperCase()}`;
}

function validerNom(valeur, nomChamp = 'nom') {
  const nom = String(valeur ?? '').trim().replace(/\s+/g, ' ');
  if (nom.length < 2 || nom.length > 120) {
    throw new ErreurValidation(`Le nom doit contenir entre 2 et 120 caracteres.`, {
      champ: nomChamp,
    });
  }
  return nom;
}

function validerDescription(valeur) {
  if (valeur === null || valeur === undefined) return null;
  const texte = String(valeur).trim();
  if (!texte) return null;
  if (texte.length > 1000) {
    throw new ErreurValidation('La description ne peut pas depasser 1000 caracteres.', {
      champ: 'description',
    });
  }
  return texte;
}

function validerReference(valeur) {
  if (valeur === null || valeur === undefined || String(valeur).trim() === '') return null;
  const reference = String(valeur).trim();
  if (reference.length > 60) {
    throw new ErreurValidation('La reference ne peut pas depasser 60 caracteres.', {
      champ: 'reference',
    });
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(reference)) {
    throw new ErreurValidation(
      'La reference ne peut contenir que lettres, chiffres, point, tiret, souligne et barre oblique.',
      { champ: 'reference' },
    );
  }
  return reference.toUpperCase();
}

function validerCodeBarres(valeur) {
  if (valeur === null || valeur === undefined || String(valeur).trim() === '') return null;
  const code = String(valeur).trim();
  if (!/^[A-Za-z0-9-]{4,64}$/.test(code)) {
    throw new ErreurValidation('Le code-barres doit contenir entre 4 et 64 caracteres alphanumeriques.', {
      champ: 'codeBarres',
    });
  }
  return code;
}

export function validerMontant(valeur, nomChamp = 'prixVenteReference') {
  if (valeur === null || valeur === undefined || valeur === '') {
    throw new ErreurValidation(`Le champ « ${nomChamp} » est obligatoire.`, { champ: nomChamp });
  }
  let montant;
  try {
    montant = d(String(valeur).replace(/\s/g, '').replace(',', '.'));
  } catch {
    throw new ErreurValidation(`Le champ « ${nomChamp} » doit etre un montant valide.`, {
      champ: nomChamp,
    });
  }
  if (montant.isNegative()) {
    throw new ErreurValidation(`Le champ « ${nomChamp} » ne peut pas etre negatif.`, {
      champ: nomChamp,
    });
  }
  if (montant.greaterThan('999999999999.99')) {
    throw new ErreurValidation(`Le champ « ${nomChamp} » depasse le maximum autorise.`, {
      champ: nomChamp,
    });
  }
  return arrondir(montant);
}

function validerQuantite(valeur, nomChamp = 'seuilAlerte') {
  if (valeur === null || valeur === undefined || valeur === '') return '0.000';
  let quantite;
  try {
    quantite = d(String(valeur).replace(',', '.'));
  } catch {
    throw new ErreurValidation(`Le champ « ${nomChamp} » doit etre une quantite valide.`, {
      champ: nomChamp,
    });
  }
  if (quantite.isNegative() || quantite.greaterThan('999999999.999')) {
    throw new ErreurValidation(`Le champ « ${nomChamp} » est hors limites.`, { champ: nomChamp });
  }
  return quantite.toFixed(PRECISION_QUANTITE);
}

function validerStatut(valeur, defaut = 'ACTIF') {
  if (valeur === undefined || valeur === null || valeur === '') return defaut;
  const statut = String(valeur).trim().toUpperCase();
  if (!STATUTS.has(statut)) {
    throw new ErreurValidation('Statut invalide : ACTIF ou ARCHIVE attendu.', { champ: 'statut' });
  }
  return statut;
}

function contexteAudit(contexte = {}) {
  return {
    adresseIp: contexte.adresseIp ?? null,
    requeteId: contexte.requeteId ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* Categories                                                                 */
/* -------------------------------------------------------------------------- */

export async function listerCategories({ page, limite, decalage, recherche, actif }) {
  const resultat = await modele.listerCategories({
    limite,
    decalage,
    recherche: recherche ? String(recherche).trim() : null,
    actif,
  });
  return { categories: resultat.categories, meta: { page, limite, total: resultat.total } };
}

export async function optionsCategories() {
  return modele.optionsCategories();
}

export async function detailCategorie(id) {
  const categorie = await modele.trouverCategorie(id);
  if (!categorie) throw new ErreurIntrouvable('Categorie introuvable.');
  return categorie;
}

async function codeCategorieDisponible(base) {
  let candidat = base;
  for (let suffixe = 2; suffixe < 100; suffixe += 1) {
    const existant = await modele.trouverCategorieParCode(candidat);
    if (!existant) return candidat;
    candidat = `${base}-${suffixe}`.slice(0, 40);
  }
  throw new ErreurConflit('Impossible de generer un code de categorie unique.');
}

export async function creerCategorie({ acteur, donnees, contexte }) {
  const nom = validerNom(donnees?.nom);
  const description = validerDescription(donnees?.description);
  const actif = donnees?.actif === undefined ? true : Boolean(donnees.actif);

  if (await modele.trouverCategorieParNom(nom)) {
    throw new ErreurConflit('Une categorie porte deja ce nom.', 'CATEGORIE_DEJA_UTILISEE');
  }

  const codeFourni = donnees?.code ? validerCode(donnees.code) : null;
  let code;
  if (codeFourni) {
    if (await modele.trouverCategorieParCode(codeFourni)) {
      throw new ErreurConflit('Ce code de categorie est deja utilise.', 'CODE_CATEGORIE_DEJA_UTILISE');
    }
    code = codeFourni;
  } else {
    code = await codeCategorieDisponible(validerCode(nom));
  }

  const categorie = await modele.creerCategorie({ code, nom, description, actif });

  await journaliser({
    utilisateurId: acteur.id,
    action: 'CREATION_CATEGORIE',
    module: 'catalogue',
    entite: 'categories',
    entiteId: categorie.id,
    details: { code, nom },
    ...contexteAudit(contexte),
  });

  return categorie;
}

export async function modifierCategorie({ acteur, id, donnees, contexte }) {
  const existante = await detailCategorie(id);

  const nom = donnees?.nom === undefined ? existante.nom : validerNom(donnees.nom);
  const description =
    donnees?.description === undefined ? existante.description : validerDescription(donnees.description);
  const actif = donnees?.actif === undefined ? existante.actif : Boolean(donnees.actif);

  let code = existante.code;
  if (donnees?.code !== undefined && validerCode(donnees.code) !== existante.code) {
    const nouveauCode = validerCode(donnees.code);
    if (await modele.trouverCategorieParCode(nouveauCode, id)) {
      throw new ErreurConflit('Ce code de categorie est deja utilise.', 'CODE_CATEGORIE_DEJA_UTILISE');
    }
    code = nouveauCode;
  }

  if (nom !== existante.nom && (await modele.trouverCategorieParNom(nom, id))) {
    throw new ErreurConflit('Une categorie porte deja ce nom.', 'CATEGORIE_DEJA_UTILISEE');
  }

  const categorie = await modele.modifierCategorie(id, { code, nom, description, actif });

  await journaliser({
    utilisateurId: acteur.id,
    action: 'MODIFICATION_CATEGORIE',
    module: 'catalogue',
    entite: 'categories',
    entiteId: id,
    details: { nom, actif, code },
    ...contexteAudit(contexte),
  });

  return categorie;
}

export async function supprimerCategorie({ acteur, id, contexte }) {
  const existante = await detailCategorie(id);
  if (existante.nombre_produits > 0) {
    throw new ErreurConflit(
      'Cette categorie contient encore des produits. Deplacez-les ou archivez-les avant de la supprimer.',
      'CATEGORIE_UTILISEE',
      { nombre_produits: existante.nombre_produits },
    );
  }

  await modele.supprimerCategorie(id);

  await journaliser({
    utilisateurId: acteur.id,
    action: 'SUPPRESSION_CATEGORIE',
    module: 'catalogue',
    entite: 'categories',
    entiteId: id,
    details: { nom: existante.nom, code: existante.code },
    ...contexteAudit(contexte),
  });

  return { id, supprime: true };
}

/* -------------------------------------------------------------------------- */
/* Produits                                                                   */
/* -------------------------------------------------------------------------- */

export async function listerProduits({
  page,
  limite,
  decalage,
  recherche,
  categorieId,
  statut,
  etatStock,
  tri,
}) {
  const etat = etatStock ? String(etatStock).trim().toUpperCase() : null;
  if (etat && !ETATS_STOCK.has(etat)) {
    throw new ErreurValidation('Etat de stock invalide.', { champ: 'etatStock' });
  }
  const ordre = tri && TRIS.has(String(tri)) ? String(tri) : 'nom';

  const [resultat, statistiques] = await Promise.all([
    modele.listerProduits({
      limite,
      decalage,
      recherche: recherche ? String(recherche).trim() : null,
      categorieId: categorieId || null,
      statut: statut ? validerStatut(statut) : null,
      etatStock: etat,
      tri: ordre,
    }),
    modele.statistiquesProduits(),
  ]);

  return {
    produits: resultat.produits,
    meta: { page, limite, total: resultat.total, statistiques },
  };
}

export async function detailProduit(id) {
  const produit = await modele.trouverProduit(id);
  if (!produit) throw new ErreurIntrouvable('Produit introuvable.');
  return produit;
}

export async function historiquePrix({ id, page, limite, decalage }) {
  await detailProduit(id);
  const resultat = await modele.listerHistoriquePrix(id, { limite, decalage });
  return { historique: resultat.historique, meta: { page, limite, total: resultat.total } };
}

async function verifierCategorieDisponible(categorieId) {
  const categorie = await modele.trouverCategorie(categorieId);
  if (!categorie) {
    throw new ErreurValidation('La categorie choisie est introuvable.', { champ: 'categorieId' });
  }
  return categorie;
}

function exigerPrixAutorise(acteur) {
  if (!possedePermission(acteur, 'produits.modifier_prix')) {
    throw new ErreurApplication(
      'Seul le proprietaire peut fixer le prix de vente de reference.',
      { code: 'PRIX_RESERVE_PROPRIETAIRE', statut: 403 },
    );
  }
}

export async function creerProduit({ acteur, donnees, contexte }) {
  const nom = validerNom(donnees?.nom);
  const description = validerDescription(donnees?.description);
  const categorieId = donnees?.categorieId;
  if (!categorieId) {
    throw new ErreurValidation('La categorie est obligatoire.', { champ: 'categorieId' });
  }
  const categorie = await verifierCategorieDisponible(categorieId);

  const prixBrut = donnees?.prixVenteReference;
  const prix = validerMontant(prixBrut ?? 0);
  if (!prix.isZero()) exigerPrixAutorise(acteur);

  const reference =
    validerReference(donnees?.reference) ?? `PRD-${Date.now().toString(36).toUpperCase()}`;
  if (await modele.trouverProduitParReference(reference)) {
    throw new ErreurConflit('Cette reference produit existe deja.', 'REFERENCE_DEJA_UTILISEE');
  }

  const codeBarres = validerCodeBarres(donnees?.codeBarres);
  if (codeBarres && (await modele.trouverProduitParCodeBarres(codeBarres))) {
    throw new ErreurConflit('Ce code-barres est deja utilise.', 'CODE_BARRES_DEJA_UTILISE');
  }

  const produit = await modele.creerProduit({
    reference,
    codeBarres,
    nom,
    description,
    categorieId: categorie.id,
    prixVenteReference: montantTexte(prix),
    seuilAlerte: validerQuantite(donnees?.seuilAlerte),
    statut: validerStatut(donnees?.statut),
    creePar: acteur.id,
  });

  await journaliser({
    utilisateurId: acteur.id,
    action: 'CREATION_PRODUIT',
    module: 'catalogue',
    entite: 'produits',
    entiteId: produit.id,
    details: {
      reference: produit.reference,
      nom: produit.nom,
      categorie: categorie.nom,
      prix_vente_reference: produit.prix_vente_reference,
    },
    ...contexteAudit(contexte),
  });

  return produit;
}

export async function modifierProduit({ acteur, id, donnees, contexte }) {
  const existant = await detailProduit(id);

  if (donnees?.reference !== undefined) {
    const reference = validerReference(donnees.reference);
    if (reference && reference !== existant.reference) {
      throw new ErreurApplication(
        'La reference d un produit ne peut pas etre modifiee apres creation.',
        { code: 'REFERENCE_IMMUABLE', statut: 422 },
      );
    }
  }

  const nom = donnees?.nom === undefined ? existant.nom : validerNom(donnees.nom);
  const description =
    donnees?.description === undefined ? existant.description : validerDescription(donnees.description);

  let categorieId = existant.categorie_id;
  if (donnees?.categorieId !== undefined && donnees.categorieId !== existant.categorie_id) {
    const categorie = await verifierCategorieDisponible(donnees.categorieId);
    categorieId = categorie.id;
  }

  let codeBarres = existant.code_barres;
  if (donnees?.codeBarres !== undefined) {
    const nouveau = validerCodeBarres(donnees.codeBarres);
    if (nouveau && (await modele.trouverProduitParCodeBarres(nouveau, id))) {
      throw new ErreurConflit('Ce code-barres est deja utilise.', 'CODE_BARRES_DEJA_UTILISE');
    }
    codeBarres = nouveau;
  }

  const produit = await modele.modifierProduit(id, {
    nom,
    description,
    codeBarres,
    categorieId,
    seuilAlerte:
      donnees?.seuilAlerte === undefined
        ? existant.seuil_alerte
        : validerQuantite(donnees.seuilAlerte),
    statut: donnees?.statut === undefined ? existant.statut : validerStatut(donnees.statut, existant.statut),
  });

  await journaliser({
    utilisateurId: acteur.id,
    action: 'MODIFICATION_PRODUIT',
    module: 'catalogue',
    entite: 'produits',
    entiteId: id,
    details: { reference: existant.reference, nom: produit.nom, statut: produit.statut },
    ...contexteAudit(contexte),
  });

  return produit;
}

export async function changerPrix({ acteur, id, donnees, contexte }) {
  exigerPrixAutorise(acteur);
  const existant = await detailProduit(id);

  const prix = validerMontant(donnees?.prix, 'prix');
  const motif = String(donnees?.motif ?? '').trim();
  if (motif.length < 5) {
    throw new ErreurValidation('Un motif d au moins 5 caracteres est obligatoire pour changer un prix.', {
      champ: 'motif',
    });
  }
  if (d(prix).equals(d(existant.prix_vente_reference))) {
    throw new ErreurValidation('Le nouveau prix est identique au prix actuel.', { champ: 'prix' });
  }

  const resultat = await modele.modifierPrixProduit({
    produitId: id,
    utilisateurId: acteur.id,
    prix: montantTexte(prix),
    motif,
  });

  const produit = await detailProduit(id);

  // La fonction SQL journalise deja l'operation ; ce journal applicatif garde
  // la trace de la requete HTTP et de son auteur.
  await journaliser({
    utilisateurId: acteur.id,
    action: 'MODIFICATION_PRIX',
    module: 'catalogue',
    entite: 'produits',
    entiteId: id,
    details: {
      reference: existant.reference,
      ancien_prix: existant.prix_vente_reference,
      nouveau_prix: produit.prix_vente_reference,
      motif,
    },
    ...contexteAudit(contexte),
  });

  return {
    produit,
    prixAncien: existant.prix_vente_reference,
    prixNouveau: produit.prix_vente_reference,
    mouvementId: resultat?.mouvement_id ?? null,
  };
}

export async function supprimerProduit({ acteur, id, contexte }) {
  const existant = await detailProduit(id);

  if (d(existant.quantite_disponible).greaterThan(0)) {
    throw new ErreurConflit(
      'Ce produit possede encore du stock. Ajustez ou ecoulez le stock avant de l archiver.',
      'STOCK_RESTANT',
      { quantite_disponible: existant.quantite_disponible },
    );
  }

  await modele.supprimerProduit(id);

  await journaliser({
    utilisateurId: acteur.id,
    action: 'SUPPRESSION_PRODUIT',
    module: 'catalogue',
    entite: 'produits',
    entiteId: id,
    details: { reference: existant.reference, nom: existant.nom },
    ...contexteAudit(contexte),
  });

  return { id, supprime: true };
}

export default {
  listerCategories,
  optionsCategories,
  detailCategorie,
  creerCategorie,
  modifierCategorie,
  supprimerCategorie,
  listerProduits,
  detailProduit,
  historiquePrix,
  creerProduit,
  modifierProduit,
  changerPrix,
  supprimerProduit,
};
