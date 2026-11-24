/**
 * Middleware d'authentification : extrait le jeton Bearer, le verifie et
 * attache le contexte utilisateur a `requete.utilisateur`.
 */
import { construireContexte } from '../services/authentification.service.js';
import { ErreurAuthentification } from '../utils/erreurs.js';

export function extraireJeton(requete) {
  const entete = requete.headers.authorization ?? '';
  if (!entete.toLowerCase().startsWith('bearer ')) return null;
  const jeton = entete.slice(7).trim();
  return jeton.length > 0 ? jeton : null;
}

export async function authentifier(requete, reponse, suivant) {
  try {
    const jeton = extraireJeton(requete);
    if (!jeton) throw new ErreurAuthentification('Authentification requise.');
    requete.utilisateur = await construireContexte(jeton);
    requete.jeton = jeton;
    suivant();
  } catch (erreur) {
    suivant(erreur);
  }
}

/** Variante optionnelle : ne bloque pas, mais renseigne l'utilisateur si present. */
export async function authentifierSiPresent(requete, reponse, suivant) {
  try {
    const jeton = extraireJeton(requete);
    if (jeton) requete.utilisateur = await construireContexte(jeton);
    suivant();
  } catch {
    suivant();
  }
}

export default { authentifier, authentifierSiPresent, extraireJeton };
