/**
 * Validation des identifiants et des entrees courantes.
 */
import { ErreurValidation } from '../utils/erreurs.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function estUuid(valeur) {
  return typeof valeur === 'string' && UUID.test(valeur);
}

export function exigerUuid(valeur, nomChamp = 'identifiant') {
  if (!estUuid(valeur)) {
    throw new ErreurValidation(`Le champ « ${nomChamp} » doit etre un UUID valide.`, {
      champ: nomChamp,
      valeur,
    });
  }
  return valeur;
}

export function exigerTexte(valeur, nomChamp, { min = 1, max = 255 } = {}) {
  if (typeof valeur !== 'string') {
    throw new ErreurValidation(`Le champ « ${nomChamp} » est obligatoire.`, { champ: nomChamp });
  }
  const propre = valeur.trim();
  if (propre.length < min || propre.length > max) {
    throw new ErreurValidation(
      `Le champ « ${nomChamp} » doit contenir entre ${min} et ${max} caracteres.`,
      { champ: nomChamp },
    );
  }
  return propre;
}

export function exigerEntier(valeur, nomChamp, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const nombre = Number(valeur);
  if (!Number.isInteger(nombre) || nombre < min || nombre > max) {
    throw new ErreurValidation(`Le champ « ${nomChamp} » doit etre un entier valide.`, {
      champ: nomChamp,
    });
  }
  return nombre;
}

export function exigerPagination(requete, { defautLimite = 50, limiteMax = 200 } = {}) {
  const limite = Math.min(Math.max(Number(requete.query.limite) || defautLimite, 1), limiteMax);
  const page = Math.max(Number(requete.query.page) || 1, 1);
  return { limite, page, decalage: (page - 1) * limite };
}
