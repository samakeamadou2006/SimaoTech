/**
 * Service d'authentification.
 *
 * Le frontend ne parle jamais directement a la base : il s'authentifie aupres
 * de Supabase Auth, puis presente son jeton d'acces a l'API. Le backend verifie
 * le jeton, charge le profil applicatif (role + permissions) et refuse tout
 * compte inactif ou supprime.
 */
import configuration from '../configuration/environnement.js';
import journal from '../configuration/journal.js';
import { supabasePublic } from '../configuration/supabase.js';
import { verifierJetonLocal } from '../utils/jetons.js';
import { ErreurAuthentification, ErreurApplication } from '../utils/erreurs.js';
import * as modele from '../modeles/utilisateurs.modele.js';

export const ROLES = Object.freeze({
  PROPRIETAIRE: 'PROPRIETAIRE',
  ADMINISTRATEUR: 'ADMINISTRATEUR',
  EMPLOYE: 'EMPLOYE',
});

/** Verifie le jeton aupres du fournisseur d'identite et retourne son sujet. */
export async function verifierJeton(jeton) {
  if (!jeton) throw new ErreurAuthentification('Jeton d acces manquant.');

  if (configuration.authentification.mode === 'local') {
    const contenu = verifierJetonLocal(jeton, configuration.authentification.jwtSecret, {
      dureeMax: configuration.authentification.dureeMax,
    });
    return { id: contenu.sub, email: contenu.email ?? null };
  }

  if (!supabasePublic) {
    throw new ErreurApplication('Service d authentification indisponible.', {
      code: 'AUTH_INDISPONIBLE',
      statut: 503,
    });
  }

  const { data, error } = await supabasePublic.auth.getUser(jeton);
  if (error || !data?.user) {
    journal.warn({ erreur: error?.message }, 'Jeton Supabase refuse');
    throw new ErreurAuthentification('Session invalide ou expiree.', 'SESSION_INVALIDE');
  }
  return { id: data.user.id, email: data.user.email ?? null };
}

/**
 * Construit le contexte utilisateur attache a la requete.
 * @returns {Promise<{id, email, nomComplet, role, permissions, estProprietaire}>}
 */
export async function construireContexte(jeton) {
  const sujet = await verifierJeton(jeton);
  const profil = await modele.trouverProfilParId(sujet.id);

  if (!profil) {
    throw new ErreurAuthentification(
      'Aucun profil applicatif n est associe a ce compte. Contactez le proprietaire.',
      'PROFIL_ABSENT',
    );
  }
  if (!profil.actif) {
    throw new ErreurAuthentification('Ce compte est desactive.', 'COMPTE_DESACTIVE');
  }

  const estProprietaire = profil.role_code === ROLES.PROPRIETAIRE;

  return {
    id: profil.id,
    email: profil.email,
    nomComplet: profil.nom_complet,
    telephone: profil.telephone,
    role: { id: profil.role_id, code: profil.role_code, nom: profil.role_nom },
    permissions: new Set(profil.permissions),
    estProprietaire,
    doitChangerMotDePasse: profil.doit_changer_mot_de_passe,
  };
}

export function possedePermission(contexte, code) {
  if (!contexte) return false;
  if (contexte.estProprietaire) return true;
  return contexte.permissions.has(code);
}
