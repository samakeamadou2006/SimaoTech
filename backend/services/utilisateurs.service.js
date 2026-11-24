/**
 * Service de gestion des comptes et des permissions.
 *
 * Regles structurelles appliquees ici (en plus des controles SQL) :
 * - le role PROPRIETAIRE ne s'attribue jamais depuis l'interface : il est
 *   cree exclusivement par le script de bootstrap ;
 * - un utilisateur ne peut ni modifier son propre role, ni ses propres
 *   permissions, ni se desactiver/supprimer ;
 * - le dernier proprietaire actif ne peut pas etre desactive ;
 * - toute operation est journalisee dans `journal_activites`.
 */
import configuration from '../configuration/environnement.js';
import * as modele from '../modeles/utilisateurs.modele.js';
import * as comptes from './comptes.service.js';
import {
  ErreurApplication,
  ErreurConflit,
  ErreurIntrouvable,
  ErreurValidation,
} from '../utils/erreurs.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TELEPHONE = /^\+?[0-9][0-9 ().-]{5,24}$/;
const ROLES_ATTRIBUABLES = new Set(['ADMINISTRATEUR', 'EMPLOYE']);

export function validerEmail(valeur) {
  const email = String(valeur ?? '').trim().toLowerCase();
  if (email.length < 5 || email.length > 254 || !EMAIL.test(email)) {
    throw new ErreurValidation('Adresse e-mail invalide.', { champ: 'email' });
  }
  return email;
}

export function validerNom(valeur) {
  const nom = String(valeur ?? '').trim().replace(/\s+/g, ' ');
  if (nom.length < 2 || nom.length > 120) {
    throw new ErreurValidation('Le nom doit contenir entre 2 et 120 caracteres.', {
      champ: 'nomComplet',
    });
  }
  return nom;
}

export function validerTelephone(valeur) {
  if (valeur === null || valeur === undefined || valeur === '') return null;
  const telephone = String(valeur).trim();
  if (!TELEPHONE.test(telephone)) {
    throw new ErreurValidation('Numero de telephone invalide.', { champ: 'telephone' });
  }
  return telephone;
}

export function validerMotDePasse(valeur) {
  const motDePasse = String(valeur ?? '');
  const minimum = configuration.authentification.longueurMinMotDePasse;
  if (motDePasse.length < minimum || motDePasse.length > 128) {
    throw new ErreurValidation(
      `Le mot de passe doit contenir entre ${minimum} et 128 caracteres.`,
      { champ: 'motDePasse' },
    );
  }
  if (!/[A-Za-z]/.test(motDePasse) || !/[0-9]/.test(motDePasse)) {
    throw new ErreurValidation('Le mot de passe doit contenir au moins une lettre et un chiffre.', {
      champ: 'motDePasse',
    });
  }
  return motDePasse;
}

function exigerRoleAttribuable(code) {
  const role = String(code ?? '').trim().toUpperCase();
  if (role === 'PROPRIETAIRE') {
    throw new ErreurApplication(
      'Le role proprietaire ne peut pas etre attribue depuis l interface. Utilisez le script de bootstrap.',
      { code: 'ROLE_PROPRIETAIRE_RESERVE', statut: 403 },
    );
  }
  if (!ROLES_ATTRIBUABLES.has(role)) {
    throw new ErreurValidation('Role invalide : ADMINISTRATEUR ou EMPLOYE attendu.', {
      champ: 'roleCode',
    });
  }
  return role;
}

function masquerEmail(email) {
  const valeur = String(email ?? '');
  const [local, domaine] = valeur.split('@');
  if (!domaine) return '***';
  return `${local.slice(0, 2)}***@${domaine}`;
}

async function chargerCible(id) {
  const profil = await modele.trouverProfilParId(id);
  if (!profil) throw new ErreurIntrouvable('Utilisateur introuvable.');
  return profil;
}

function contexteAudit(contexte = {}) {
  return {
    adresseIp: contexte.adresseIp ?? null,
    requeteId: contexte.requeteId ?? null,
  };
}

export async function lister({ page, limite, decalage, recherche, roleCode, actif }) {
  const [resultat, statistiques] = await Promise.all([
    modele.listerUtilisateurs({
      limite,
      decalage,
      recherche: recherche ? String(recherche).trim() : null,
      roleCode: roleCode ? String(roleCode).trim().toUpperCase() : null,
      actif,
    }),
    modele.statistiquesUtilisateurs(),
  ]);
  return {
    utilisateurs: resultat.utilisateurs,
    meta: { page, limite, total: resultat.total, statistiques },
  };
}

export async function detail(id) {
  const utilisateur = await modele.trouverDetail(id);
  if (!utilisateur) throw new ErreurIntrouvable('Utilisateur introuvable.');
  return utilisateur;
}

export async function catalogue() {
  const [roles, permissions] = await Promise.all([
    modele.listerRolesAvecPermissions(),
    modele.listerPermissions(),
  ]);
  const modules = [...new Set(permissions.map((p) => p.module))];
  return { roles, permissions, modules };
}

/**
 * Cree un compte d'authentification puis son profil applicatif.
 * En cas d'echec de creation du profil, le compte auth est supprime.
 */
export async function creer({ acteur, donnees, contexte }) {
  const email = validerEmail(donnees?.email);
  const nomComplet = validerNom(donnees?.nomComplet);
  const telephone = validerTelephone(donnees?.telephone);
  const roleCode = exigerRoleAttribuable(donnees?.roleCode);
  const role = await modele.trouverRoleParCode(roleCode);

  if (await modele.trouverParEmail(email)) {
    throw new ErreurConflit('Un utilisateur actif utilise deja cette adresse e-mail.', 'EMAIL_DEJA_UTILISE');
  }

  const motDePasseFourni = donnees?.motDePasse ? validerMotDePasse(donnees.motDePasse) : null;
  const motDePasseTemporaire =
    comptes.modeLocal() || motDePasseFourni ? null : comptes.genererMotDePasse();
  const motDePasse = motDePasseFourni ?? motDePasseTemporaire;

  let compte;
  try {
    compte = await comptes.creerCompteAuth({
      email,
      motDePasse: motDePasse ?? comptes.genererMotDePasse(),
      nomComplet,
    });
  } catch (erreur) {
    if (erreur.code === 'DOUBLON' || erreur.code === 'EMAIL_DEJA_UTILISE') {
      throw new ErreurConflit('Un compte existe deja pour cette adresse e-mail.', 'EMAIL_DEJA_UTILISE');
    }
    throw erreur;
  }

  try {
    await modele.creerProfil({
      id: compte.id,
      email,
      nomComplet,
      telephone,
      roleId: role.id,
      doitChangerMotDePasse: !comptes.modeLocal(),
    });
  } catch (erreur) {
    await comptes.supprimerCompteAuth(compte.id);
    throw erreur;
  }

  await modele.journaliser({
    utilisateurId: acteur.id,
    action: 'CREATION_UTILISATEUR',
    module: 'administration',
    entite: 'utilisateurs',
    entiteId: compte.id,
    details: { email: masquerEmail(email), role: roleCode, nom: nomComplet },
    ...contexteAudit(contexte),
  });

  const utilisateur = await detail(compte.id);
  return {
    utilisateur,
    motDePasseTemporaire,
    modeLocal: comptes.modeLocal(),
  };
}

export async function modifier({ acteur, id, donnees, contexte }) {
  const cible = await chargerCible(id);
  const soiMeme = cible.id === acteur.id;

  const nomComplet =
    donnees?.nomComplet === undefined ? cible.nom_complet : validerNom(donnees.nomComplet);
  const telephone =
    donnees?.telephone === undefined ? cible.telephone : validerTelephone(donnees.telephone);

  let roleId = cible.role_id;
  let roleCode = cible.role_code;
  if (donnees?.roleCode !== undefined) {
    const nouveauCode = String(donnees.roleCode).trim().toUpperCase();
    if (nouveauCode !== cible.role_code) {
      exigerRoleAttribuable(nouveauCode);
      if (soiMeme) {
        throw new ErreurApplication('Vous ne pouvez pas modifier votre propre role.', {
          code: 'AUTO_MODIFICATION_INTERDITE',
          statut: 403,
        });
      }
      if (cible.role_code === 'PROPRIETAIRE') {
        throw new ErreurApplication(
          'Le role proprietaire ne se modifie pas depuis l interface.',
          { code: 'ROLE_PROPRIETAIRE_RESERVE', statut: 403 },
        );
      }
      const role = await modele.trouverRoleParCode(nouveauCode);
      roleId = role.id;
      roleCode = role.code;
    }
  }

  let actif = cible.actif;
  if (donnees?.actif !== undefined) {
    if (typeof donnees.actif !== 'boolean') {
      throw new ErreurValidation('Le champ actif doit etre un booleen.', { champ: 'actif' });
    }
    if (soiMeme && donnees.actif !== cible.actif) {
      throw new ErreurApplication('Vous ne pouvez pas modifier votre propre acces.', {
        code: 'AUTO_MODIFICATION_INTERDITE',
        statut: 403,
      });
    }
    if (!donnees.actif && cible.role_code === 'PROPRIETAIRE') {
      throw new ErreurApplication('Le compte proprietaire ne peut pas etre desactive.', {
        code: 'PROPRIETAIRE_PROTEGE',
        statut: 403,
      });
    }
    if (!donnees.actif && cible.actif) {
      const autres = await modele.compterAdministrateursActifs({ exclureId: cible.id });
      if (autres === 0) {
        throw new ErreurApplication(
          'Impossible de desactiver le dernier administrateur actif.',
          { code: 'DERNIER_ADMINISTRATEUR', statut: 409 },
        );
      }
    }
    actif = donnees.actif;
  }

  await modele.majProfil(id, {
    nomComplet,
    telephone,
    roleId,
    actif,
    doitChangerMotDePasse: cible.doit_changer_mot_de_passe,
  });

  if (actif !== cible.actif) {
    await comptes.suspendreCompteAuth(id, !actif);
  }

  await modele.journaliser({
    utilisateurId: acteur.id,
    action: 'MODIFICATION_UTILISATEUR',
    module: 'administration',
    entite: 'utilisateurs',
    entiteId: id,
    details: {
      avant: {
        nom_complet: cible.nom_complet,
        telephone: cible.telephone,
        role: cible.role_code,
        actif: cible.actif,
      },
      apres: { nom_complet: nomComplet, telephone, role: roleCode, actif },
    },
    ...contexteAudit(contexte),
  });

  return detail(id);
}

/**
 * Remplace les derogations individuelles. Une derogation `accorde = true`
 * ajoute une permission, `false` la retire au role.
 */
export async function remplacerPermissions({ acteur, id, derogations, contexte }) {
  const cible = await chargerCible(id);

  if (cible.id === acteur.id) {
    throw new ErreurApplication('Vous ne pouvez pas modifier vos propres permissions.', {
      code: 'AUTO_MODIFICATION_INTERDITE',
      statut: 403,
    });
  }
  if (cible.role_code === 'PROPRIETAIRE') {
    throw new ErreurApplication('Le proprietaire possede deja toutes les permissions.', {
      code: 'PROPRIETAIRE_PROTEGE',
      statut: 403,
    });
  }
  if (!Array.isArray(derogations)) {
    throw new ErreurValidation('Le champ derogations doit etre un tableau.', {
      champ: 'derogations',
    });
  }
  if (derogations.length > 200) {
    throw new ErreurValidation('Trop de derogations envoyees.', { champ: 'derogations' });
  }

  const vues = new Set();
  const propres = derogations.map((element) => {
    const permissionId = String(element?.permissionId ?? '');
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        permissionId,
      )
    ) {
      throw new ErreurValidation('Identifiant de permission invalide.', {
        champ: 'derogations',
      });
    }
    if (vues.has(permissionId)) {
      throw new ErreurValidation('Une permission est presente plusieurs fois.', {
        champ: 'derogations',
        permissionId,
      });
    }
    vues.add(permissionId);
    if (typeof element.accorde !== 'boolean') {
      throw new ErreurValidation('Le champ accorde doit etre un booleen.', {
        champ: 'derogations',
      });
    }
    return { permissionId, accorde: element.accorde };
  });

  const existantes = await modele.trouverPermissionsParIds(propres.map((d) => d.permissionId));
  if (existantes.length !== propres.length) {
    throw new ErreurValidation('Une permission referencee est introuvable.', {
      champ: 'derogations',
    });
  }

  await modele.remplacerDerogations(id, propres, acteur.id);

  await modele.journaliser({
    utilisateurId: acteur.id,
    action: 'MODIFICATION_PERMISSIONS',
    module: 'administration',
    entite: 'utilisateurs',
    entiteId: id,
    details: { derogations: propres },
    ...contexteAudit(contexte),
  });

  return detail(id);
}

export async function reinitialiserMotDePasse({ acteur, id, contexte }) {
  const cible = await chargerCible(id);
  if (cible.id === acteur.id) {
    throw new ErreurApplication(
      'Utilisez la page « Mon compte » pour changer votre propre mot de passe.',
      { code: 'AUTO_MODIFICATION_INTERDITE', statut: 403 },
    );
  }
  if (comptes.modeLocal()) {
    throw new ErreurApplication(
      'La reinitialisation est indisponible en mode local : aucun mot de passe n y est stocke.',
      { code: 'AUTH_INDISPONIBLE', statut: 503 },
    );
  }

  const motDePasseTemporaire = comptes.genererMotDePasse();
  await comptes.definirMotDePasse(id, motDePasseTemporaire);
  await modele.majProfil(id, {
    nomComplet: cible.nom_complet,
    telephone: cible.telephone,
    roleId: cible.role_id,
    actif: cible.actif,
    doitChangerMotDePasse: true,
  });

  await modele.journaliser({
    utilisateurId: acteur.id,
    action: 'REINITIALISATION_MOT_DE_PASSE',
    module: 'administration',
    entite: 'utilisateurs',
    entiteId: id,
    details: { email: masquerEmail(cible.email), force: true },
    ...contexteAudit(contexte),
  });

  return { motDePasseTemporaire, doitChangerMotDePasse: true };
}

/** Effacement logique : aucune ligne d'historique n'est supprimee. */
export async function supprimer({ acteur, id, contexte }) {
  const cible = await chargerCible(id);
  if (cible.id === acteur.id) {
    throw new ErreurApplication('Vous ne pouvez pas supprimer votre propre compte.', {
      code: 'AUTO_MODIFICATION_INTERDITE',
      statut: 403,
    });
  }
  if (cible.role_code === 'PROPRIETAIRE') {
    throw new ErreurApplication('Le compte proprietaire ne peut pas etre supprime.', {
      code: 'PROPRIETAIRE_PROTEGE',
      statut: 403,
    });
  }
  if (cible.actif && cible.role_code === 'ADMINISTRATEUR') {
    const restants = await modele.compterAdministrateursActifs({ exclureId: cible.id });
    if (restants === 0) {
      throw new ErreurApplication('Impossible de supprimer le dernier administrateur actif.', {
        code: 'DERNIER_ADMINISTRATEUR',
        statut: 409,
      });
    }
  }

  await modele.marquerSupprime(id);
  await comptes.suspendreCompteAuth(id, true);

  await modele.journaliser({
    utilisateurId: acteur.id,
    action: 'SUPPRESSION_UTILISATEUR',
    module: 'administration',
    entite: 'utilisateurs',
    entiteId: id,
    details: { email: masquerEmail(cible.email), nom: cible.nom_complet },
    ...contexteAudit(contexte),
  });

  return { id, supprime: true };
}

/** Journalise une connexion ou une tentative refusee (appele par l'auth). */
export async function journaliserConnexion({
  utilisateur = null,
  email = null,
  succes,
  motif = null,
  contexte,
}) {
  await modele.journaliser({
    utilisateurId: utilisateur?.id ?? null,
    action: succes ? 'CONNEXION' : 'ECHEC_CONNEXION',
    module: 'authentification',
    entite: 'utilisateurs',
    entiteId: utilisateur?.id ?? null,
    details: {
      email: masquerEmail(email ?? utilisateur?.email),
      ...(utilisateur ? { role: utilisateur.role?.code ?? null } : {}),
      ...(motif ? { motif } : {}),
    },
    ...contexteAudit(contexte),
  });
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
  journaliserConnexion,
  validerEmail,
  validerNom,
  validerTelephone,
  validerMotDePasse,
};
