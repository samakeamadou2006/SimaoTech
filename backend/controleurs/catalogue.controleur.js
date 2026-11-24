/**
 * Controleur du catalogue : categories, produits et historique des prix.
 * La validation metier et les controles d'autorite vivent dans le service.
 */
import net from 'node:net';
import { succes, cree } from '../utils/reponses.js';
import { exigerPagination, exigerUuid } from '../validateurs/commun.validateur.js';
import * as service from '../services/catalogue.service.js';

function contexte(requete) {
  const ip = requete.ip ?? '';
  return {
    adresseIp: net.isIP(ip) ? ip : null,
    requeteId: requete.id ?? null,
  };
}

function lireActif(valeur) {
  if (valeur === undefined || valeur === '') return null;
  if (valeur === 'true' || valeur === '1') return true;
  if (valeur === 'false' || valeur === '0') return false;
  return null;
}

/* -------------------------------------------------------------------------- */
/* Categories                                                                 */
/* -------------------------------------------------------------------------- */

export async function listerCategories(requete, reponse) {
  const { limite, page, decalage } = exigerPagination(requete, { defautLimite: 50, limiteMax: 200 });
  const resultat = await service.listerCategories({
    page,
    limite,
    decalage,
    recherche: requete.query.recherche ?? null,
    actif: lireActif(requete.query.actif),
  });
  return succes(reponse, resultat.categories, resultat.meta);
}

export async function optionsCategories(requete, reponse) {
  return succes(reponse, await service.optionsCategories());
}

export async function detailCategorie(requete, reponse) {
  const id = exigerUuid(requete.params.id, 'categorie');
  return succes(reponse, await service.detailCategorie(id));
}

export async function creerCategorie(requete, reponse) {
  const categorie = await service.creerCategorie({
    acteur: requete.utilisateur,
    donnees: requete.body ?? {},
    contexte: contexte(requete),
  });
  return cree(reponse, categorie);
}

export async function modifierCategorie(requete, reponse) {
  const id = exigerUuid(requete.params.id, 'categorie');
  const categorie = await service.modifierCategorie({
    acteur: requete.utilisateur,
    id,
    donnees: requete.body ?? {},
    contexte: contexte(requete),
  });
  return succes(reponse, categorie);
}

export async function supprimerCategorie(requete, reponse) {
  const id = exigerUuid(requete.params.id, 'categorie');
  const resultat = await service.supprimerCategorie({
    acteur: requete.utilisateur,
    id,
    contexte: contexte(requete),
  });
  return succes(reponse, resultat);
}

/* -------------------------------------------------------------------------- */
/* Produits                                                                   */
/* -------------------------------------------------------------------------- */

export async function listerProduits(requete, reponse) {
  const { limite, page, decalage } = exigerPagination(requete, { defautLimite: 50, limiteMax: 200 });
  const resultat = await service.listerProduits({
    page,
    limite,
    decalage,
    recherche: requete.query.recherche ?? null,
    categorieId: requete.query.categorie ?? null,
    statut: requete.query.statut ?? null,
    etatStock: requete.query.etat_stock ?? null,
    tri: requete.query.tri ?? null,
  });
  return succes(reponse, resultat.produits, resultat.meta);
}

export async function detailProduit(requete, reponse) {
  const id = exigerUuid(requete.params.id, 'produit');
  return succes(reponse, await service.detailProduit(id));
}

export async function historiquePrix(requete, reponse) {
  const id = exigerUuid(requete.params.id, 'produit');
  const { limite, page, decalage } = exigerPagination(requete, { defautLimite: 25, limiteMax: 100 });
  const resultat = await service.historiquePrix({ id, page, limite, decalage });
  return succes(reponse, resultat.historique, resultat.meta);
}

export async function creerProduit(requete, reponse) {
  const produit = await service.creerProduit({
    acteur: requete.utilisateur,
    donnees: requete.body ?? {},
    contexte: contexte(requete),
  });
  return cree(reponse, produit);
}

export async function modifierProduit(requete, reponse) {
  const id = exigerUuid(requete.params.id, 'produit');
  const produit = await service.modifierProduit({
    acteur: requete.utilisateur,
    id,
    donnees: requete.body ?? {},
    contexte: contexte(requete),
  });
  return succes(reponse, produit);
}

export async function changerPrix(requete, reponse) {
  const id = exigerUuid(requete.params.id, 'produit');
  const resultat = await service.changerPrix({
    acteur: requete.utilisateur,
    id,
    donnees: requete.body ?? {},
    contexte: contexte(requete),
  });
  return succes(reponse, resultat);
}

export async function supprimerProduit(requete, reponse) {
  const id = exigerUuid(requete.params.id, 'produit');
  const resultat = await service.supprimerProduit({
    acteur: requete.utilisateur,
    id,
    contexte: contexte(requete),
  });
  return succes(reponse, resultat);
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
