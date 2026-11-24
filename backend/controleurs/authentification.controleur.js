/**
 * Controleur d'authentification.
 *
 * Le mot de passe n'est jamais traite par le backend : il est transmis a
 * Supabase Auth (fournisseur d'identite). Le backend ne renvoie au client que
 * les jetons de session et le profil applicatif autorise.
 */
import net from 'node:net';
import configuration from '../configuration/environnement.js';
import journal from '../configuration/journal.js';
import { supabasePublic } from '../configuration/supabase.js';
import { construireContexte } from '../services/authentification.service.js';
import * as comptes from '../services/comptes.service.js';
import * as modele from '../modeles/utilisateurs.modele.js';
import { validerMotDePasse } from '../services/utilisateurs.service.js';
import { succes } from '../utils/reponses.js';
import { ErreurApplication, ErreurAuthentification, ErreurValidation } from '../utils/erreurs.js';

function exigerFournisseur() {
  if (configuration.authentification.mode !== 'supabase' || !supabasePublic) {
    throw new ErreurApplication(
      'La connexion par mot de passe necessite Supabase Auth (MODE_AUTH=supabase et cles configurees).',
      { code: 'AUTH_INDISPONIBLE', statut: 503 },
    );
  }
}

function sessionPublique(session) {
  if (!session) return null;
  return {
    jetonAcces: session.access_token,
    jetonRafraichissement: session.refresh_token,
    expireLe: session.expires_at ?? null,
    typeJeton: session.token_type ?? 'bearer',
  };
}

function contexteAudit(requete) {
  const ip = requete.ip ?? '';
  return {
    adresseIp: net.isIP(ip) ? ip : null,
    requeteId: requete.id ?? null,
  };
}

function masquerEmail(email) {
  const valeur = String(email ?? '');
  const [local, domaine] = valeur.split('@');
  if (!domaine) return '***';
  return `${local.slice(0, 2)}***@${domaine}`;
}

async function journaliserConnexion(requete, { utilisateur = null, email, succes: reussie, motif }) {
  try {
    await modele.journaliser({
      utilisateurId: utilisateur?.id ?? null,
      action: reussie ? 'CONNEXION' : 'ECHEC_CONNEXION',
      module: 'authentification',
      entite: 'utilisateurs',
      entiteId: utilisateur?.id ?? null,
      details: {
        email: masquerEmail(email ?? utilisateur?.email),
        ...(utilisateur ? { role: utilisateur.role?.code ?? null } : {}),
        ...(motif ? { motif } : {}),
      },
      ...contexteAudit(requete),
    });
  } catch (erreur) {
    // Le journal ne doit jamais empecher une connexion legitime.
    journal.warn({ erreur: erreur.message }, 'Journalisation de connexion impossible');
  }
}

export async function connexion(requete, reponse) {
  exigerFournisseur();
  const { email, motDePasse } = requete.body ?? {};

  if (!email || !motDePasse) {
    throw new ErreurValidation('Adresse e-mail et mot de passe obligatoires.');
  }

  const { data, error } = await supabasePublic.auth.signInWithPassword({
    email: String(email).trim(),
    password: String(motDePasse),
  });

  if (error || !data?.session) {
    journal.warn({ email: String(email).slice(0, 3) + '***', motif: error?.message }, 'Echec de connexion');
    await journaliserConnexion(requete, {
      email: String(email),
      succes: false,
      motif: 'identifiants_invalides',
    });
    throw new ErreurAuthentification(
      'Identifiants incorrects ou compte desactive.',
      'IDENTIFIANTS_INCORRECTS',
    );
  }

  const utilisateur = await construireContexte(data.session.access_token);
  await modele.toucherDerniereConnexion(utilisateur.id);
  await journaliserConnexion(requete, {
    utilisateur,
    succes: true,
  });

  journal.info({ utilisateur: utilisateur.id, role: utilisateur.role.code }, 'Connexion reussie');

  return succes(reponse, { utilisateur, session: sessionPublique(data.session) });
}

export async function rafraichir(requete, reponse) {
  exigerFournisseur();
  const { jetonRafraichissement } = requete.body ?? {};
  if (!jetonRafraichissement) {
    throw new ErreurValidation('Jeton de rafraichissement manquant.');
  }

  const { data, error } = await supabasePublic.auth.refreshSession({
    refresh_token: String(jetonRafraichissement),
  });

  if (error || !data?.session) {
    throw new ErreurAuthentification('Session expiree, veuillez vous reconnecter.', 'SESSION_EXPIREE');
  }

  return succes(reponse, { session: sessionPublique(data.session) });
}

export async function deconnexion(requete, reponse) {
  exigerFournisseur();
  try {
    if (requete.utilisateur?.id) {
      await modele.journaliser({
        utilisateurId: requete.utilisateur.id,
        action: 'DECONNEXION',
        module: 'authentification',
        entite: 'utilisateurs',
        entiteId: requete.utilisateur.id,
        ...contexteAudit(requete),
      });
    }
  } catch (erreur) {
    journal.warn({ erreur: erreur.message }, 'Journalisation de deconnexion impossible');
  }

  // Le jeton est revoque cote fournisseur lorsque la session est identifiee.
  try {
    if (requete.jeton) await supabasePublic.auth.signOut();
  } catch (erreur) {
    journal.warn({ erreur: erreur.message }, 'Echec de revocation de session');
  }
  return succes(reponse, { deconnecte: true });
}

export async function motDePasseOublie(requete, reponse) {
  exigerFournisseur();
  const { email, urlRedirection } = requete.body ?? {};
  if (!email) throw new ErreurValidation('Adresse e-mail obligatoire.');

  // Reponse identique quel que soit le compte (pas d'enumeration d'adresses).
  try {
    await supabasePublic.auth.resetPasswordForEmail(String(email).trim(), {
      redirectTo: urlRedirection || `${configuration.urlPublique}/pages/reinitialisation.html`,
    });
  } catch (erreur) {
    journal.warn({ erreur: erreur.message }, 'Echec de demande de reinitialisation');
  }

  try {
    await modele.journaliser({
      action: 'DEMANDE_REINITIALISATION',
      module: 'authentification',
      entite: 'utilisateurs',
      details: { email: masquerEmail(email) },
      ...contexteAudit(requete),
    });
  } catch (erreur) {
    journal.warn({ erreur: erreur.message }, 'Journalisation de demande impossible');
  }

  return succes(reponse, {
    message: 'Si un compte existe pour cette adresse, un lien de reinitialisation a ete envoye.',
  });
}

/**
 * Change le mot de passe de l'utilisateur connecte. Le mot de passe actuel est
 * verifie aupres de Supabase Auth avant toute modification.
 */
export async function changerMotDePasse(requete, reponse) {
  exigerFournisseur();
  const { motDePasseActuel, nouveauMotDePasse } = requete.body ?? {};

  if (!motDePasseActuel) {
    throw new ErreurValidation('Le mot de passe actuel est obligatoire.', {
      champ: 'motDePasseActuel',
    });
  }
  const nouveau = validerMotDePasse(nouveauMotDePasse);
  if (String(motDePasseActuel) === nouveau) {
    throw new ErreurValidation('Le nouveau mot de passe doit etre different de l actuel.', {
      champ: 'nouveauMotDePasse',
    });
  }

  await comptes.changerMotDePasseAvecVerification({
    email: requete.utilisateur.email,
    actuel: String(motDePasseActuel),
    nouveau,
  });
  await modele.marquerMotDePasseChange(requete.utilisateur.id);

  try {
    await modele.journaliser({
      utilisateurId: requete.utilisateur.id,
      action: 'CHANGEMENT_MOT_DE_PASSE',
      module: 'authentification',
      entite: 'utilisateurs',
      entiteId: requete.utilisateur.id,
      ...contexteAudit(requete),
    });
  } catch (erreur) {
    journal.warn({ erreur: erreur.message }, 'Journalisation de changement impossible');
  }

  return succes(reponse, { motDePasseChange: true, doitChangerMotDePasse: false });
}

/**
 * Finalise une reinitialisation a partir du lien envoye par Supabase
 * (jetons de recuperation ou code PKCE). Route publique, limitee en debit.
 */
export async function reinitialiserMotDePasse(requete, reponse) {
  exigerFournisseur();
  const { jetonAcces, jetonRafraichissement, code, motDePasse } = requete.body ?? {};
  const nouveau = validerMotDePasse(motDePasse);

  const resultat = await comptes.finaliserRecuperation({
    jetonAcces: jetonAcces ? String(jetonAcces) : null,
    jetonRafraichissement: jetonRafraichissement ? String(jetonRafraichissement) : null,
    code: code ? String(code) : null,
    nouveau,
  });

  if (resultat.id) {
    await modele.marquerMotDePasseChange(resultat.id);
    try {
      await modele.journaliser({
        utilisateurId: resultat.id,
        action: 'REINITIALISATION_MOT_DE_PASSE',
        module: 'authentification',
        entite: 'utilisateurs',
        entiteId: resultat.id,
        details: { email: masquerEmail(resultat.email) },
        ...contexteAudit(requete),
      });
    } catch (erreur) {
      journal.warn({ erreur: erreur.message }, 'Journalisation de reinitialisation impossible');
    }
  }

  return succes(reponse, {
    motDePasseChange: true,
    message: 'Votre mot de passe a ete modifie. Vous pouvez vous connecter.',
  });
}

export async function moi(requete, reponse) {
  const { id, email, nomComplet, telephone, role, estProprietaire, doitChangerMotDePasse } =
    requete.utilisateur;
  return succes(reponse, {
    utilisateur: {
      id,
      email,
      nomComplet,
      telephone,
      role,
      estProprietaire,
      doitChangerMotDePasse,
      permissions: [...requete.utilisateur.permissions].sort(),
    },
  });
}
