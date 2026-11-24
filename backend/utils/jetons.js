/**
 * Verification des jetons d'acces (JWT) en mode local.
 *
 * En production, les jetons sont emis et verifies par Supabase Auth
 * (voir services/authentification.service.js). Ce module permet de faire
 * tourner l'API en developpement avec un secret HS256 maitrise.
 */
import crypto from 'node:crypto';
import { ErreurAuthentification } from './erreurs.js';

function base64urlVersTampon(segment) {
  return Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** Verifie la signature HS256 et la validite temporelle d'un JWT. */
export function verifierJetonLocal(jeton, secret, { dureeMax = 28800, maintenant = Date.now() } = {}) {
  if (!secret || secret.length < 32) {
    throw new ErreurAuthentification('Verification locale mal configuree.', 'AUTH_MAL_CONFIGUREE');
  }
  const segments = String(jeton ?? '').split('.');
  if (segments.length !== 3) {
    throw new ErreurAuthentification('Jeton mal forme.');
  }
  const [entete, charge, signature] = segments;

  const attendue = crypto
    .createHmac('sha256', secret)
    .update(`${entete}.${charge}`)
    .digest();
  const fournie = base64urlVersTampon(signature);

  if (fournie.length !== attendue.length || !crypto.timingSafeEqual(fournie, attendue)) {
    throw new ErreurAuthentification('Signature du jeton invalide.');
  }

  let contenu;
  try {
    contenu = JSON.parse(base64urlVersTampon(charge).toString('utf8'));
  } catch {
    throw new ErreurAuthentification('Contenu du jeton illisible.');
  }

  const secondes = Math.floor(maintenant / 1000);
  if (typeof contenu.exp !== 'number' || contenu.exp <= secondes) {
    throw new ErreurAuthentification('Session expiree, veuillez vous reconnecter.', 'SESSION_EXPIREE');
  }
  if (contenu.iat && secondes - contenu.iat > dureeMax) {
    throw new ErreurAuthentification('Session trop ancienne, veuillez vous reconnecter.', 'SESSION_EXPIREE');
  }
  if (!contenu.sub) {
    throw new ErreurAuthentification('Jeton sans identifiant utilisateur.');
  }

  return contenu;
}

export default { verifierJetonLocal };
