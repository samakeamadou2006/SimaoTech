/**
 * Bootstrap du compte proprietaire.
 *
 * Usage :
 *   npm run proprietaire -- --email proprietaire@simaotech.ci --nom "Nom Complet"
 *   npm run proprietaire -- --email ... --nom ... --mot-de-passe "MotDePasseFort1"
 *   npm run proprietaire -- --email ... --nom ... --ajouter
 *
 * En mode Supabase, le compte d'authentification est cree (ou retrouve) via la
 * cle de service, puis le profil applicatif est rattache au role PROPRIETAIRE.
 * En mode local de developpement, seul le profil et le substitut auth.users
 * sont crees : aucun mot de passe n'y est verifie.
 */
import { executer, fermerPool } from '../configuration/base_de_donnees.js';
import { supabaseAdmin } from '../configuration/supabase.js';
import * as comptes from '../services/comptes.service.js';
import * as modele from '../modeles/utilisateurs.modele.js';
import {
  validerEmail,
  validerMotDePasse,
  validerNom,
  validerTelephone,
} from '../services/utilisateurs.service.js';

function lireArguments() {
  const options = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const argument = args[i];
    if (!argument.startsWith('--')) continue;
    const cle = argument.slice(2);
    const suivant = args[i + 1];
    if (!suivant || suivant.startsWith('--')) {
      options[cle] = true;
    } else {
      options[cle] = suivant;
      i += 1;
    }
  }
  return options;
}

function echec(message) {
  console.error(`\n[ERREUR] ${message}\n`);
  process.exitCode = 1;
}

async function roleProprietaire() {
  const role = await modele.trouverRoleParCode('PROPRIETAIRE');
  if (!role) {
    throw new Error(
      'Le role PROPRIETAIRE est absent. Appliquez les migrations : npm run db:migrer.',
    );
  }
  return role;
}

async function proprietaireActif() {
  const { rows } = await executer(
    `SELECT u.id, u.email::text AS email, u.nom_complet
       FROM utilisateurs u
       JOIN roles r ON r.id = u.role_id
      WHERE r.code = 'PROPRIETAIRE'
        AND u.actif
        AND u.supprime_le IS NULL
      ORDER BY u.cree_le
      LIMIT 1`,
  );
  return rows[0] ?? null;
}

async function main() {
  const options = lireArguments();

  if (options.aide) {
    console.log(`
Bootstrap du proprietaire SimaoTech

  --email <adresse>        obligatoire
  --nom "<nom complet>"    obligatoire
  --telephone <numero>     facultatif
  --mot-de-passe <valeur>  facultatif (genere si absent en mode Supabase)
  --ajouter                autorise un second proprietaire
  --aide                   affiche cette aide
`);
    return;
  }

  const email = validerEmail(options.email);
  const nomComplet = validerNom(options.nom);
  const telephone = validerTelephone(options.telephone);
  const motDePasseExplicite =
    options['mot-de-passe'] && options['mot-de-passe'] !== true
      ? validerMotDePasse(options['mot-de-passe'])
      : null;

  const role = await roleProprietaire();
  const existant = await proprietaireActif();

  if (existant && existant.email.toLowerCase() !== email && !options.ajouter) {
    throw new Error(
      `Un proprietaire actif existe deja (${existant.email}). Utilisez --ajouter pour en creer un second, ou connectez-vous avec ce compte.`,
    );
  }

  const profilExistant = await modele.trouverParEmail(email);
  if (profilExistant && profilExistant.id && profilExistant.role_code !== 'PROPRIETAIRE') {
    // Un employe existant peut etre promu proprietaire uniquement par ce script.
    console.log(
      `\n[INFO] Le profil ${email} existe deja avec le role ${profilExistant.role_code}. Il va etre promu proprietaire.`,
    );
  }

  const modeLocal = comptes.modeLocal();
  if (!modeLocal && !supabaseAdmin) {
    throw new Error(
      'SUPABASE_URL et SUPABASE_CLE_SERVICE sont requis pour creer le compte d authentification.',
    );
  }

  let compteAuth = await comptes.trouverCompteAuthParEmail(email);
  let motDePasseAffiche = null;
  let motDePasseGenere = false;

  if (!compteAuth) {
    const motDePasse = motDePasseExplicite ?? comptes.genererMotDePasse();
    motDePasseGenere = !motDePasseExplicite;
    const cree = await comptes.creerCompteAuth({ email, motDePasse, nomComplet });
    compteAuth = { id: cree.id, email };
    if (!modeLocal) motDePasseAffiche = motDePasse;
  } else if (!modeLocal && motDePasseExplicite) {
    await comptes.definirMotDePasse(compteAuth.id, motDePasseExplicite);
  }

  if (profilExistant && profilExistant.id !== compteAuth.id) {
    throw new Error(
      'Un profil applicatif existe pour cet e-mail avec un autre identifiant d authentification. Corrigez la donnee avant de continuer.',
    );
  }

  const doitChanger = !modeLocal && !motDePasseExplicite;
  const { rows } = await executer(
    `INSERT INTO utilisateurs
       (id, email, nom_complet, telephone, role_id, actif, doit_changer_mot_de_passe)
     VALUES ($1, lower($2), $3, $4, $5, true, $6)
     ON CONFLICT (id) DO UPDATE
       SET email = lower(excluded.email),
           nom_complet = excluded.nom_complet,
           telephone = excluded.telephone,
           role_id = excluded.role_id,
           actif = true,
           supprime_le = NULL,
           doit_changer_mot_de_passe = excluded.doit_changer_mot_de_passe,
           modifie_le = now()
     RETURNING id, email::text AS email, nom_complet`,
    [compteAuth.id, email, nomComplet, telephone, role.id, doitChanger],
  );

  await modele.journaliser({
    utilisateurId: rows[0].id,
    action: 'BOOTSTRAP_PROPRIETAIRE',
    module: 'administration',
    entite: 'utilisateurs',
    entiteId: rows[0].id,
    details: {
      email,
      mode: modeLocal ? 'local' : 'supabase',
      mot_de_passe_defini: Boolean(motDePasseExplicite || motDePasseAffiche),
    },
  });

  console.log('\n=== Proprietaire SimaoTech pret ===');
  console.log(`  Identifiant : ${rows[0].id}`);
  console.log(`  E-mail      : ${rows[0].email}`);
  console.log(`  Nom         : ${rows[0].nom_complet}`);
  console.log(`  Role        : PROPRIETAIRE`);
  console.log(`  Mode        : ${modeLocal ? 'local (developpement)' : 'Supabase Auth'}`);
  if (motDePasseAffiche) {
    console.log(`  Mot de passe: ${motDePasseAffiche}`);
    console.log('  (affiche une seule fois, a communiquer par un canal sur)');
  }
  if (motDePasseGenere && !modeLocal) {
    console.log('  Changement de mot de passe demande a la premiere connexion.');
  }
  if (modeLocal) {
    console.log(
      '  Aucun mot de passe n est verifie en mode local : utilisez un jeton signe avec JWT_SECRET pour les tests.',
    );
  }
  console.log('');
}

main()
  .catch((erreur) => echec(erreur.message))
  .finally(async () => {
    await fermerPool();
  });
