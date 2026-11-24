/**
 * Tests d'integration HTTP de la phase 3 : comptes, permissions, audit,
 * changement de mot de passe et bootstrap proprietaire.
 *
 * Le serveur Express est demarre sur le PostgreSQL embarque en mode
 * d'authentification local (jetons HS256 signes par le test). Aucun service
 * externe n'est requis.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  PORT_TEST,
  arreterBase,
  base,
  creerUtilisateur,
  demarrerBase,
} from './aide.js';

const executerFichier = promisify(execFile);
const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SECRET = 'secret-de-test-simaotech-suffisamment-long-pour-hs256';

let serveur = null;
let urlBase = '';
let fermerPool = null;

let proprietaire;
let administrateur;
let employe;

function base64url(valeur) {
  return Buffer.from(valeur).toString('base64url');
}

function jeton(utilisateur, { expiration = 3600 } = {}) {
  const maintenant = Math.floor(Date.now() / 1000);
  const entete = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const charge = base64url(
    JSON.stringify({
      sub: utilisateur.id,
      email: utilisateur.email,
      iat: maintenant,
      exp: maintenant + expiration,
    }),
  );
  const signature = crypto
    .createHmac('sha256', SECRET)
    .update(`${entete}.${charge}`)
    .digest('base64url');
  return `${entete}.${charge}.${signature}`;
}

async function appel(chemin, { methode = 'GET', corps = null, jetonAcces = null } = {}) {
  const entetes = { Accept: 'application/json' };
  if (corps !== null) entetes['Content-Type'] = 'application/json';
  if (jetonAcces) entetes.Authorization = `Bearer ${jetonAcces}`;

  const reponse = await fetch(`${urlBase}${chemin}`, {
    method: methode,
    headers: entetes,
    body: corps === null ? undefined : JSON.stringify(corps),
  });
  const texte = await reponse.text();
  let contenu = null;
  try {
    contenu = texte ? JSON.parse(texte) : null;
  } catch {
    contenu = null;
  }
  return { statut: reponse.status, corps: contenu };
}

before(async () => {
  await demarrerBase();

  process.env.NODE_ENV = 'test';
  process.env.MODE_AUTH = 'local';
  process.env.JWT_SECRET = SECRET;
  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${PORT_TEST}/postgres`;
  process.env.BASE_DE_DONNEES_SSL = 'false';
  process.env.PORT = '3199';
  process.env.URL_PUBLIQUE = 'http://127.0.0.1:3103';
  process.env.NIVEAU_JOURNAL = 'fatal';

  const { creerApplication } = await import('../../backend/serveur.js');
  const { fermerPool: fermer } = await import('../../backend/configuration/base_de_donnees.js');
  fermerPool = fermer;

  const application = creerApplication();
  await new Promise((resoudre) => {
    serveur = application.listen(0, '127.0.0.1', resoudre);
  });
  urlBase = `http://127.0.0.1:${serveur.address().port}`;

  proprietaire = await creerUtilisateur({
    email: 'proprietaire.phase3@simaotech.test',
    nom: 'Proprietaire Phase Trois',
    role: 'PROPRIETAIRE',
  });
  administrateur = await creerUtilisateur({
    email: 'admin.phase3@simaotech.test',
    nom: 'Administrateur Phase Trois',
    role: 'ADMINISTRATEUR',
  });
  employe = await creerUtilisateur({
    email: 'employe.phase3@simaotech.test',
    nom: 'Employe Phase Trois',
    role: 'EMPLOYE',
  });
});

after(async () => {
  if (serveur) await new Promise((resoudre) => serveur.close(resoudre));
  if (fermerPool) await fermerPool().catch(() => {});
  await arreterBase();
});

test('les routes de comptes sont fermees sans jeton ou sans permission', async () => {
  const sansJeton = await appel('/api/utilisateurs');
  assert.equal(sansJeton.statut, 401);

  const enTantQuEmploye = await appel('/api/utilisateurs', {
    jetonAcces: jeton(employe),
  });
  assert.equal(enTantQuEmploye.statut, 403);
  assert.match(enTantQuEmploye.corps.erreur.code, /PERMISSION_MANQUANTE/);

  const enTantQuAdmin = await appel('/api/utilisateurs', {
    jetonAcces: jeton(administrateur),
  });
  assert.equal(enTantQuAdmin.statut, 403);

  const enTantQueProprietaire = await appel('/api/utilisateurs', {
    jetonAcces: jeton(proprietaire),
  });
  assert.equal(enTantQueProprietaire.statut, 200);
  assert.ok(enTantQueProprietaire.corps.meta.total >= 3);
  assert.equal(enTantQueProprietaire.corps.meta.statistiques.proprietaires, 1);
});

test('le catalogue expose les roles et permissions sans secret', async () => {
  const { statut, corps } = await appel('/api/utilisateurs/catalogue', {
    jetonAcces: jeton(proprietaire),
  });
  assert.equal(statut, 200);
  const roles = corps.donnees.roles;
  const admin = roles.find((r) => r.code === 'ADMINISTRATEUR');
  const employeRole = roles.find((r) => r.code === 'EMPLOYE');
  assert.ok(admin.permissions.includes('stocks.consulter'));
  assert.ok(!admin.permissions.includes('utilisateurs.gerer'));
  assert.ok(!admin.permissions.includes('produits.modifier_prix'));
  assert.ok(employeRole.permissions.includes('ventes.creer'));
  assert.ok(!employeRole.permissions.includes('benefices.consulter'));
  assert.ok(corps.donnees.permissions.length >= 30);
});

test('le detail expose les permissions du role et les derogations', async () => {
  const { statut, corps } = await appel(`/api/utilisateurs/${employe.id}`, {
    jetonAcces: jeton(proprietaire),
  });
  assert.equal(statut, 200);
  assert.equal(corps.donnees.email, employe.email);
  assert.ok(Array.isArray(corps.donnees.permissions_role));
  assert.ok(Array.isArray(corps.donnees.derogations));
  assert.ok(corps.donnees.permissions_effectives.includes('ventes.creer'));
});

test('la creation refuse le role proprietaire et les doublons', async () => {
  const refuse = await appel('/api/utilisateurs', {
    methode: 'POST',
    jetonAcces: jeton(proprietaire),
    corps: {
      email: 'nouveau.proprietaire@simaotech.test',
      nomComplet: 'Nouveau Proprietaire',
      roleCode: 'PROPRIETAIRE',
      motDePasse: 'MotDePasse123',
    },
  });
  assert.equal(refuse.statut, 403);
  assert.equal(refuse.corps.erreur.code, 'ROLE_PROPRIETAIRE_RESERVE');

  const doublon = await appel('/api/utilisateurs', {
    methode: 'POST',
    jetonAcces: jeton(proprietaire),
    corps: {
      email: employe.email,
      nomComplet: 'Doublon',
      roleCode: 'EMPLOYE',
      motDePasse: 'MotDePasse123',
    },
  });
  assert.equal(doublon.statut, 409);
  assert.equal(doublon.corps.erreur.code, 'EMAIL_DEJA_UTILISE');
});

let nouvelEmploye = null;

test('la creation cree le compte auth, le profil et le journal', async () => {
  const { statut, corps } = await appel('/api/utilisateurs', {
    methode: 'POST',
    jetonAcces: jeton(proprietaire),
    corps: {
      email: 'vendeur.nouveau@simaotech.test',
      nomComplet: 'Vendeur Nouveau',
      telephone: '+225 07 00 00 00',
      roleCode: 'EMPLOYE',
      motDePasse: 'MotDePasse123',
    },
  });
  assert.equal(statut, 201);
  nouvelEmploye = corps.donnees.utilisateur;
  assert.equal(nouvelEmploye.role_code, 'EMPLOYE');
  assert.equal(nouvelEmploye.actif, true);
  assert.equal(nouvelEmploye.doit_changer_mot_de_passe, false);
  assert.equal(corps.donnees.motDePasseTemporaire, null);
  assert.equal(corps.donnees.modeLocal, true);

  const auth = await base().query('SELECT id, email FROM auth.users WHERE id = $1', [
    nouvelEmploye.id,
  ]);
  assert.equal(auth.rowCount, 1);
  assert.equal(auth.rows[0].email, 'vendeur.nouveau@simaotech.test');

  const journal = await base().query(
    `SELECT details FROM journal_activites
      WHERE action = 'CREATION_UTILISATEUR' AND entite_id = $1`,
    [nouvelEmploye.id],
  );
  assert.equal(journal.rowCount, 1);
  assert.equal(journal.rows[0].details.role, 'EMPLOYE');
});

test('les derogations ajoutent et retirent des permissions effectives', async () => {
  const permissions = await base().query(
    `SELECT id, code FROM permissions WHERE code IN ('depenses.consulter', 'ventes.creer')`,
  );
  const parCode = new Map(permissions.rows.map((p) => [p.code, p.id]));

  const { statut, corps } = await appel(`/api/utilisateurs/${employe.id}/permissions`, {
    methode: 'PUT',
    jetonAcces: jeton(proprietaire),
    corps: {
      derogations: [
        { permissionId: parCode.get('depenses.consulter'), accorde: true },
        { permissionId: parCode.get('ventes.creer'), accorde: false },
      ],
    },
  });
  assert.equal(statut, 200);
  assert.ok(corps.donnees.permissions_effectives.includes('depenses.consulter'));
  assert.ok(!corps.donnees.permissions_effectives.includes('ventes.creer'));

  const moi = await appel('/api/auth/moi', { jetonAcces: jeton(employe) });
  assert.equal(moi.statut, 200);
  assert.ok(moi.corps.donnees.utilisateur.permissions.includes('depenses.consulter'));
  assert.ok(!moi.corps.donnees.utilisateur.permissions.includes('ventes.creer'));

  const propre = await appel(`/api/utilisateurs/${proprietaire.id}/permissions`, {
    methode: 'PUT',
    jetonAcces: jeton(proprietaire),
    corps: { derogations: [] },
  });
  assert.equal(propre.statut, 403);
  assert.equal(propre.corps.erreur.code, 'AUTO_MODIFICATION_INTERDITE');
});

test('la modification est controlee et journalisee', async () => {
  const { statut, corps } = await appel(`/api/utilisateurs/${employe.id}`, {
    methode: 'PATCH',
    jetonAcces: jeton(proprietaire),
    corps: { nomComplet: 'Employe Renomme', telephone: '+225 05 11 22 33' },
  });
  assert.equal(statut, 200);
  assert.equal(corps.donnees.nom_complet, 'Employe Renomme');
  assert.equal(corps.donnees.telephone, '+225 05 11 22 33');

  const propreRole = await appel(`/api/utilisateurs/${proprietaire.id}`, {
    methode: 'PATCH',
    jetonAcces: jeton(proprietaire),
    corps: { roleCode: 'EMPLOYE' },
  });
  assert.equal(propreRole.statut, 403);
  assert.equal(propreRole.corps.erreur.code, 'AUTO_MODIFICATION_INTERDITE');

  const proprietaireDesactive = await appel(`/api/utilisateurs/${proprietaire.id}`, {
    methode: 'PATCH',
    jetonAcces: jeton(proprietaire),
    corps: { actif: false },
  });
  assert.equal(proprietaireDesactive.statut, 403);

  const journal = await base().query(
    `SELECT count(*)::int AS total FROM journal_activites
      WHERE action = 'MODIFICATION_UTILISATEUR' AND entite_id = $1`,
    [employe.id],
  );
  assert.ok(journal.rows[0].total >= 1);
});

test('la desactivation bloque immediatement la session applicative', async () => {
  const desactivation = await appel(`/api/utilisateurs/${employe.id}`, {
    methode: 'PATCH',
    jetonAcces: jeton(proprietaire),
    corps: { actif: false },
  });
  assert.equal(desactivation.statut, 200);
  assert.equal(desactivation.corps.donnees.actif, false);

  const moi = await appel('/api/auth/moi', { jetonAcces: jeton(employe) });
  assert.equal(moi.statut, 401);
  assert.equal(moi.corps.erreur.code, 'COMPTE_DESACTIVE');

  const reactivation = await appel(`/api/utilisateurs/${employe.id}`, {
    methode: 'PATCH',
    jetonAcces: jeton(proprietaire),
    corps: { actif: true },
  });
  assert.equal(reactivation.statut, 200);
  assert.equal(reactivation.corps.donnees.actif, true);
});

test('un mot de passe temporaire bloque les modules metier', async () => {
  await base().query(
    'UPDATE utilisateurs SET doit_changer_mot_de_passe = true WHERE id = $1',
    [nouvelEmploye.id],
  );

  const bloque = await appel('/api/utilisateurs', { jetonAcces: jeton(nouvelEmploye) });
  assert.equal(bloque.statut, 403);
  assert.equal(bloque.corps.erreur.code, 'MOT_DE_PASSE_A_CHANGER');

  const moi = await appel('/api/auth/moi', { jetonAcces: jeton(nouvelEmploye) });
  assert.equal(moi.statut, 200);
  assert.equal(moi.corps.donnees.utilisateur.doitChangerMotDePasse, true);
});

test('les operations de mot de passe echouent proprement sans Supabase', async () => {
  const changement = await appel('/api/auth/mot-de-passe', {
    methode: 'POST',
    jetonAcces: jeton(employe),
    corps: { motDePasseActuel: 'AncienMotDePasse1', nouveauMotDePasse: 'NouveauMotDePasse2' },
  });
  assert.equal(changement.statut, 503);
  assert.equal(changement.corps.erreur.code, 'AUTH_INDISPONIBLE');

  const reinitialisation = await appel('/api/auth/reinitialiser-mot-de-passe', {
    methode: 'POST',
    corps: { jetonAcces: 'x', jetonRafraichissement: 'y', motDePasse: 'NouveauMotDePasse2' },
  });
  assert.equal(reinitialisation.statut, 503);
  assert.equal(reinitialisation.corps.erreur.code, 'AUTH_INDISPONIBLE');

  const parProprietaire = await appel(
    `/api/utilisateurs/${employe.id}/reinitialiser-mot-de-passe`,
    { methode: 'POST', jetonAcces: jeton(proprietaire) },
  );
  assert.equal(parProprietaire.statut, 503);
  assert.equal(parProprietaire.corps.erreur.code, 'AUTH_INDISPONIBLE');
});

test('la suppression est logique et conserve le profil', async () => {
  const soiMeme = await appel(`/api/utilisateurs/${proprietaire.id}`, {
    methode: 'DELETE',
    jetonAcces: jeton(proprietaire),
  });
  assert.equal(soiMeme.statut, 403);

  const suppression = await appel(`/api/utilisateurs/${nouvelEmploye.id}`, {
    methode: 'DELETE',
    jetonAcces: jeton(proprietaire),
  });
  assert.equal(suppression.statut, 200);
  assert.equal(suppression.corps.donnees.supprime, true);

  const profil = await base().query(
    'SELECT actif, supprime_le FROM utilisateurs WHERE id = $1',
    [nouvelEmploye.id],
  );
  assert.equal(profil.rowCount, 1);
  assert.equal(profil.rows[0].actif, false);
  assert.ok(profil.rows[0].supprime_le instanceof Date);

  const moi = await appel('/api/auth/moi', { jetonAcces: jeton(nouvelEmploye) });
  assert.equal(moi.statut, 401);
  assert.equal(moi.corps.erreur.code, 'PROFIL_ABSENT');

  const journal = await base().query(
    `SELECT count(*)::int AS total FROM journal_activites
      WHERE action = 'SUPPRESSION_UTILISATEUR' AND entite_id = $1`,
    [nouvelEmploye.id],
  );
  assert.equal(journal.rows[0].total, 1);
});

test('le script de bootstrap cree un proprietaire operationnel', async () => {
  const { stdout } = await executerFichier(
    process.execPath,
    [
      'backend/scripts/creer_proprietaire.js',
      '--email',
      'bootstrap.phase3@simaotech.test',
      '--nom',
      'Proprietaire Bootstrap',
      '--ajouter',
    ],
    {
      cwd: racine,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        MODE_AUTH: 'local',
        DATABASE_URL: process.env.DATABASE_URL,
        NIVEAU_JOURNAL: 'fatal',
      },
      timeout: 30_000,
    },
  );
  assert.match(stdout, /Proprietaire SimaoTech pret/);
  assert.match(stdout, /bootstrap\.phase3@simaotech\.test/);

  const { rows } = await base().query(
    `SELECT u.email::text AS email, r.code AS role
       FROM utilisateurs u JOIN roles r ON r.id = u.role_id
      WHERE u.email = 'bootstrap.phase3@simaotech.test'`,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].role, 'PROPRIETAIRE');

  const journal = await base().query(
    `SELECT count(*)::int AS total FROM journal_activites
      WHERE action = 'BOOTSTRAP_PROPRIETAIRE'`,
  );
  assert.ok(journal.rows[0].total >= 1);
});
