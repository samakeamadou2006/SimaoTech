/**
 * Middlewares d'autorisation bases sur les roles et permissions.
 *
 * Rappel : les restrictions d'affichage du frontend ne sont jamais une
 * protection. Toute route sensible passe par ces middlewares.
 */
import { ErreurAutorisation, ErreurAuthentification } from '../utils/erreurs.js';
import { possedePermission, ROLES } from '../services/authentification.service.js';

export function exigerPermission(...codes) {
  return (requete, reponse, suivant) => {
    if (!requete.utilisateur) {
      return suivant(new ErreurAuthentification('Authentification requise.'));
    }
    const autorise = codes.some((code) => possedePermission(requete.utilisateur, code));
    if (!autorise) {
      return suivant(
        new ErreurAutorisation(
          'Vous n avez pas la permission requise pour cette operation.',
          `PERMISSION_MANQUANTE:${codes.join('|')}`,
        ),
      );
    }
    return suivant();
  };
}

/**
 * Bloque l'acces aux modules metier tant que le mot de passe temporaire n'a
 * pas ete remplace. Les routes de changement de mot de passe et `/auth/moi`
 * sont volontairement hors de ce filtre.
 */
export function exigerMotDePasseAJour(requete, reponse, suivant) {
  if (!requete.utilisateur) {
    return suivant(new ErreurAuthentification('Authentification requise.'));
  }
  if (requete.utilisateur.doitChangerMotDePasse) {
    return suivant(
      new ErreurAutorisation(
        'Vous devez definir un nouveau mot de passe avant de continuer.',
        'MOT_DE_PASSE_A_CHANGER',
      ),
    );
  }
  return suivant();
}

export function exigerRole(...roles) {
  return (requete, reponse, suivant) => {
    if (!requete.utilisateur) {
      return suivant(new ErreurAuthentification('Authentification requise.'));
    }
    if (requete.utilisateur.estProprietaire || roles.includes(requete.utilisateur.role.code)) {
      return suivant();
    }
    return suivant(new ErreurAutorisation('Role insuffisant pour cette operation.'));
  };
}

export const exigerProprietaire = exigerRole(ROLES.PROPRIETAIRE);

export function estAdministrateur(contexte) {
  return (
    contexte?.estProprietaire ||
    contexte?.role?.code === ROLES.ADMINISTRATEUR ||
    possedePermission(contexte, 'administration.gerer')
  );
}

/** Controle explicite pour les operations reservees a l'administration. */
export function exigerAdministration(requete, reponse, suivant) {
  if (!requete.utilisateur) return suivant(new ErreurAuthentification('Authentification requise.'));
  if (!estAdministrateur(requete.utilisateur)) {
    return suivant(new ErreurAutorisation('Operation reservee a l administration.'));
  }
  return suivant();
}

export default {
  exigerPermission,
  exigerRole,
  exigerProprietaire,
  exigerAdministration,
  exigerMotDePasseAJour,
  estAdministrateur,
};
