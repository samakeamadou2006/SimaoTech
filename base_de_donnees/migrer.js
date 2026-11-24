/**
 * Application des migrations SQL.
 *
 * Usage :
 *   npm run db:migrer                        (lit DATABASE_URL dans .env)
 *   node base_de_donnees/migrer.js --local   (PostgreSQL embarque, developpement)
 *
 * Chaque fichier de `migrations/` est applique une seule fois, dans l'ordre
 * alphabetique, dans une transaction : une migration en echec laisse la base
 * intacte et interrompt la sequence.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import 'dotenv/config';

const dossierMigrations = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const argumentLocal = process.argv.includes('--local');
const PORT_LOCAL = 55432;
const URL_LOCALE = `postgresql://postgres:postgres@127.0.0.1:${PORT_LOCAL}/postgres`;

let instanceLocale = null;

async function demarrerLocal() {
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const dossier = path.join(process.cwd(), '.postgres-local');
  await fs.mkdir(dossier, { recursive: true });

  instanceLocale = new EmbeddedPostgres({
    databaseDir: dossier,
    user: 'postgres',
    password: 'postgres',
    port: PORT_LOCAL,
    persistent: true,
  });

  try {
    await instanceLocale.initialise();
  } catch (erreur) {
    if (!/already|existe|initialized|exists/i.test(erreur.message)) throw erreur;
  }
  await instanceLocale.start();
  return URL_LOCALE;
}

async function appliquer(url) {
  const client = new pg.Client({
    connectionString: url,
    ssl: process.env.BASE_DE_DONNEES_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  await client.connect();
  console.log('Connexion PostgreSQL etablie.');

  const fichiers = (await fs.readdir(dossierMigrations))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      nom_fichier text NOT NULL,
      appliquee_le timestamptz NOT NULL DEFAULT now(),
      duree_ms integer
    )
  `);

  const { rows } = await client.query('SELECT version FROM schema_migrations');
  const dejaAppliquees = new Set(rows.map((r) => r.version));

  let appliquees = 0;
  for (const fichier of fichiers) {
    const version = fichier.split('_')[0];
    if (dejaAppliquees.has(version)) continue;

    const contenu = await fs.readFile(path.join(dossierMigrations, fichier), 'utf8');
    const empreinte = crypto.createHash('sha256').update(contenu).digest('hex').slice(0, 12);
    const debut = Date.now();

    process.stdout.write(`  -> ${fichier} ... `);
    try {
      await client.query('BEGIN');
      await client.query(contenu);
      await client.query(
        'INSERT INTO schema_migrations (version, nom_fichier, duree_ms) VALUES ($1, $2, $3)',
        [version, `${fichier} (${empreinte})`, Date.now() - debut],
      );
      await client.query('COMMIT');
      console.log(`OK (${Date.now() - debut} ms)`);
      appliquees += 1;
    } catch (erreur) {
      await client.query('ROLLBACK');
      console.log('ECHEC');
      console.error(`\nMigration ${fichier} annulee :`);
      console.error(`  ${erreur.message}`);
      if (erreur.position) {
        const lignes = contenu.split('\n');
        const numeroLigne = contenu.slice(0, Number(erreur.position)).split('\n').length;
        const debutExtrait = Math.max(1, numeroLigne - 4);
        console.error(`  Ligne ${numeroLigne} :`);
        lignes.slice(debutExtrait - 1, numeroLigne + 2).forEach((l, i) => {
          console.error(`    ${debutExtrait + i}: ${l}`);
        });
      }
      await client.end();
      throw new Error('MIGRATION_ECHOUEE');
    }
  }

  await client.end();
  console.log(`\n${appliquees} migration(s) appliquee(s), ${dejaAppliquees.size} deja presente(s).`);
  return appliquees;
}

async function principal() {
  const url = argumentLocal ? await demarrerLocal() : process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL absente. Renseignez .env ou utilisez --local.');
    process.exit(1);
  }

  await appliquer(url);

  if (instanceLocale) {
    await instanceLocale.stop();
    // Laisse au processus PostgreSQL le temps de se terminer proprement.
    await new Promise((resolution) => setTimeout(resolution, 400));
    instanceLocale = null;
  }
  process.exit(0);
}

principal().catch(async (erreur) => {
  console.error(erreur.message === 'MIGRATION_ECHOUEE' ? 'Sequence interrompue.' : `Echec : ${erreur.message}`);
  if (instanceLocale) {
    try {
      await instanceLocale.stop();
    } catch {
      /* ignore */
    }
  }
  process.exit(1);
});
