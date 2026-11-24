/**
 * Controleur des comptes utilisateurs et des permissions.
 * Toute la logique metier reside dans le service ; le controleur ne fait que
 * valider la forme HTTP et formater les reponses.
 */
import net from 'node:net';
import { succes, cree } from '../utils/reponses.js';
import { exigerPagination, exigerUuid } from '../validateurs/commun.validateur.js';
import * as service from '../services/utilisateurs.service.js';

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

export async function lister(requete, reponse) {
  const { limite, page, decalage } = exigerPagination(requete, { defautLimite: 25, limiteMax: 200 });
  const resultat = await service.lister({
    page,
    limite,
    decalage,
    recherche: requete.query.recherche ?? null,
    roleCode: requete.query.role ?? null,
    actif: lireActif(requete.query.actif),
  });
  return succes(reponse, resultat.utilisateurs, resultat.meta);
}

export async function detail(requete, reponse) {
  const id = exigerUuid(requete.params.id, 'utilisateur');
  return succes(reponse, await service.detail(id));
}

export async function catalogue(requete, reponse) {
  return succes(reponse, await service.catalogue());
}

export async function creer(requete, reponse) {
  const resultat = await service.creer({
    acteur: requete.utilisateur,
    donnees: requete.body ?? {},
    contexte: contexte(requete),
  });
  return cree(reponse, resultat);
}

export async function modifier(requete, reponse) {
  const id = exigerUuid(requete.params.id, 'utilisateur');
  const utilisateur = await service.modifier({
    acteur: requete.utilisateur,
    id,
    donnees: requete.body ?? {},
    contexte: contexte(requete),
  });
  return succes(reponse, utilisateur);
}

export async function remplacerPermissions(requete, reponse) {
  const id = exigerUuid(requete.params.id, 'utilisateur');
  const utilisateur = await service.remplacerPermissions({
    acteur: requete.utilisateur,
    id,
    derogations: requete.body?.derogations,
    contexte: contexte(requete),
  });
  return succes(reponse, utilisateur);
}

export async function reinitialiserMotDePasse(requete, reponse) {
  const id = exigerUuid(requete.params.id, 'utilisateur');
  const resultat = await service.reinitialiserMotDePasse({
    acteur: requete.utilisateur,
    id,
    contexte: contexte(requete),
  });
  return succes(reponse, resultat);
}

export async function supprimer(requete, reponse) {
  const id = exigerUuid(requete.params.id, 'utilisateur');
  const resultat = await service.supprimer({
    acteur: requete.utilisateur,
    id,
    contexte: contexte(requete),
  });
  return succes(reponse, resultat);
}

export default {
  lister,
  detail,
  catalogue,
  creer,
  modifier,
  remplacerPermissions,
  reinitialiserMotDePasse,
  supprimer,
};
