/**
 * Fournisseur de comptes d'authentification.
 *
 * En production, les comptes sont crees et administres par Supabase Auth via
 * la cle de service (jamais exposee au frontend). En mode local de
 * developpement, un substitut minimal `auth.users` permet de preparer des
 * profils sans service externe : aucun mot de passe n'y est stocke et la
 * connexion par mot de passe reste indisponible.
 */
import crypto from 'node:crypto';
import configuration from '../configuration/environnement.js';
import journal from '../configuration/journal.js';
import { executer } from '../configuration/base_de_donnees.js';
import { supabaseAdmin } from '../configuration/supabase.js';
import { ErreurApplication, ErreurConflit, ErreurValidation } from '../utils/erreurs.js';

const CARACTERES = {
  majuscules: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  minuscules: 'abcdefghijkmnopqrstuvwxyz',
  chiffres: '23456789',
  symboles: '!@#$%*+-?',
};

function melanger(tableau) {
  const copie = [...tableau];
  for (let i = copie.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [copie[i], copie[j]] = [copie[j], copie[i]];
  }
  return copie;
}

/**
 * Genere un mot de passe temporaire robuste (au moins une majuscule, une
 * minuscule, un chiffre et un symbole). Retourne uniquement la chaine.
 */
export function genererMotDePasse(longueur = 16) {
  const taille = Math.max(12, Math.min(longueur, 64));
  const obligatoires = Object.values(CARACTERES).map(
    (alphabet) => alphabet[crypto.randomInt(0, alphabet.length)],
  );
  const tous = Object.values(CARACTERES).join('');
  const restants = Array.from({ length: taille - obligatoires.length }, () =>
    tous[crypto.randomInt(0, tous.length)],
  );
  return melanger([...obligatoires, ...restants]).join('');
}

export function modeLocal() {
  return configuration.authentification.mode === 'local';
}

async function authUsersEstSubstitutLocal() {
  const { rows } = await executer(
    `SELECT count(*)::int AS total
       FROM information_schema.columns
      WHERE table_schema = 'auth'
        AND table_name = 'users'
        AND column_name = 'encrypted_password'`,
  );
  return (rows[0]?.total ?? 0) === 0;
}

function erreurFournisseur(error, contexte) {
  const message = String(error?.message ?? '');
  if (/already|registered|exists|duplicate/i.test(message)) {
    return new ErreurConflit(
      'Un compte d authentification existe deja pour cette adresse e-mail.',
      'EMAIL_DEJA_UTILISE',
    );
  }
  journal.error({ contexte, erreur: message }, 'Echec du fournisseur d authentification');
  return new ErreurApplication(
    'Le service d authentification n a pas pu traiter la demande.',
    { code: 'AUTH_ERREUR_FOURNISSEUR', statut: 502 },
  );
}

function exigerAdministration() {
  if (!supabaseAdmin) {
    throw new ErreurApplication(
      'Administration des comptes indisponible : SUPABASE_URL et SUPABASE_CLE_SERVICE sont requis.',
      { code: 'AUTH_INDISPONIBLE', statut: 503 },
    );
  }
  return supabaseAdmin;
}

/** Cree un compte d'authentification et retourne son identifiant. */
export async function creerCompteAuth({ email, motDePasse, nomComplet }) {
  if (modeLocal()) {
    if (!(await authUsersEstSubstitutLocal())) {
      throw new ErreurApplication(
        'Le mode local ne peut pas creer de compte dans un schema auth.users de production.',
        { code: 'AUTH_MODE_LOCAL_INCOMPATIBLE', statut: 503 },
      );
    }
    const { rows } = await executer(
      `INSERT INTO auth.users (email) VALUES (lower($1)) RETURNING id`,
      [email],
    );
    return { id: rows[0].id, modeLocal: true };
  }

  const admin = exigerAdministration();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: motDePasse,
    email_confirm: true,
    user_metadata: { nom_complet: nomComplet },
  });
  if (error || !data?.user) throw erreurFournisseur(error, 'creation');
  return { id: data.user.id, modeLocal: false };
}

/** Retire un compte d'authentification (compensation d'une creation echouee). */
export async function supprimerCompteAuth(id) {
  if (modeLocal()) {
    await executer(`DELETE FROM auth.users WHERE id = $1`, [id]);
    return;
  }
  if (!supabaseAdmin) return;
  const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
  if (error) {
    journal.error({ utilisateur: id, erreur: error.message }, 'Echec de suppression du compte auth');
  }
}

/** Definit un mot de passe (reinitialisation par le proprietaire). */
export async function definirMotDePasse(id, motDePasse) {
  if (modeLocal()) {
    throw new ErreurApplication(
      'La reinitialisation de mot de passe est indisponible en mode local : aucun mot de passe n y est stocke.',
      { code: 'AUTH_INDISPONIBLE', statut: 503 },
    );
  }
  const admin = exigerAdministration();
  const { error } = await admin.auth.admin.updateUserById(id, { password: motDePasse });
  if (error) throw erreurFournisseur(error, 'mot_de_passe');
}

/**
 * Active ou suspend l'acces au fournisseur d'identite. Le backend bloque de
 * toute facon les profils inactifs ; la suspension est une defense en plus.
 */
export async function suspendreCompteAuth(id, suspendu) {
  if (modeLocal() || !supabaseAdmin) return false;
  const { error } = await supabaseAdmin.auth.admin.updateUserById(id, {
    ban_duration: suspendu ? '876000h' : 'none',
  });
  if (error) {
    // Le profil applicatif reste la reference : on journalise sans echouer
    // l'operation demandee par le proprietaire.
    journal.warn({ utilisateur: id, erreur: error.message }, 'Suspension auth non appliquee');
    return false;
  }
  return true;
}

/** Recherche un compte auth par e-mail (bootstrap proprietaire). */
export async function trouverCompteAuthParEmail(email) {
  if (modeLocal()) {
    const { rows } = await executer(
      `SELECT id, email FROM auth.users WHERE lower(email) = lower($1)`,
      [email],
    );
    return rows[0] ?? null;
  }
  const admin = exigerAdministration();
  const cible = String(email).toLowerCase();
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw erreurFournisseur(error, 'recherche');
    const utilisateurs = data?.users ?? [];
    const trouve = utilisateurs.find((u) => String(u.email ?? '').toLowerCase() === cible);
    if (trouve) return { id: trouve.id, email: trouve.email };
    if (utilisateurs.length < 200) return null;
  }
  return null;
}

/**
 * Change le mot de passe d'un utilisateur connecte apres verification de son
 * mot de passe actuel. Retourne false si le fournisseur est indisponible.
 */
export async function changerMotDePasseAvecVerification({ email, actuel, nouveau }) {
  if (modeLocal()) {
    throw new ErreurApplication(
      'Le changement de mot de passe est indisponible en mode local.',
      { code: 'AUTH_INDISPONIBLE', statut: 503 },
    );
  }
  if (!configuration.supabase.url || !configuration.supabase.cleAnon) {
    throw new ErreurApplication('Service d authentification indisponible.', {
      code: 'AUTH_INDISPONIBLE',
      statut: 503,
    });
  }

  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(configuration.supabase.url, configuration.supabase.cleAnon, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  const { data, error: erreurConnexion } = await client.auth.signInWithPassword({
    email,
    password: actuel,
  });
  if (erreurConnexion || !data?.user?.id) {
    throw new ErreurApplication('Le mot de passe actuel est incorrect.', {
      code: 'MOT_DE_PASSE_INCORRECT',
      statut: 401,
    });
  }

  await definirMotDePasse(data.user.id, nouveau);
  await client.auth.signOut().catch(() => {});
  return true;
}

/**
 * Finalise une recuperation de mot de passe a partir d'une session de
 * recuperation Supabase (jetons ou code PKCE). Retourne l'identifiant du compte.
 */
export async function finaliserRecuperation({ jetonAcces, jetonRafraichissement, code, nouveau }) {
  if (modeLocal()) {
    throw new ErreurApplication(
      'La recuperation de mot de passe est indisponible en mode local.',
      { code: 'AUTH_INDISPONIBLE', statut: 503 },
    );
  }
  if (!configuration.supabase.url || !configuration.supabase.cleAnon) {
    throw new ErreurApplication('Service d authentification indisponible.', {
      code: 'AUTH_INDISPONIBLE',
      statut: 503,
    });
  }

  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(configuration.supabase.url, configuration.supabase.cleAnon, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  let session = null;
  if (jetonAcces && jetonRafraichissement) {
    const { data, error } = await client.auth.setSession({
      access_token: jetonAcces,
      refresh_token: jetonRafraichissement,
    });
    if (error) {
      throw new ErreurApplication('Lien de reinitialisation invalide ou expire.', {
        code: 'LIEN_RECUPERATION_INVALIDE',
        statut: 400,
      });
    }
    session = data.session;
  } else if (code) {
    const { data, error } = await client.auth.exchangeCodeForSession(code);
    if (error) {
      throw new ErreurApplication('Lien de reinitialisation invalide ou expire.', {
        code: 'LIEN_RECUPERATION_INVALIDE',
        statut: 400,
      });
    }
    session = data.session;
  } else {
    throw new ErreurValidation('Jeton de recuperation manquant.');
  }

  const { data: utilisateur, error: erreurUtilisateur } = await client.auth.getUser();
  if (erreurUtilisateur || !utilisateur?.user) {
    throw new ErreurApplication('Lien de reinitialisation invalide ou expire.', {
      code: 'LIEN_RECUPERATION_INVALIDE',
      statut: 400,
    });
  }

  const { error: erreurMaj } = await client.auth.updateUser({ password: nouveau });
  if (erreurMaj) {
    throw new ErreurValidation(`Mot de passe refuse : ${erreurMaj.message}`);
  }

  await client.auth.signOut().catch(() => {});
  return { id: utilisateur.user.id, email: utilisateur.user.email ?? null, session };
}

export default {
  genererMotDePasse,
  modeLocal,
  creerCompteAuth,
  supprimerCompteAuth,
  definirMotDePasse,
  suspendreCompteAuth,
  trouverCompteAuthParEmail,
  changerMotDePasseAvecVerification,
  finaliserRecuperation,
};
