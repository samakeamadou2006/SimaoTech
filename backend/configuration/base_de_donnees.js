/**
 * Acces PostgreSQL (pool `pg`).
 *
 * Le backend est le seul a parler a la base : il utilise une connexion directe
 * (role de service). Les politiques RLS restent actives en defense en profondeur
 * pour tout acces direct via les cles publiques Supabase.
 */
import pg from 'pg';
import configuration from './environnement.js';
import journal from './journal.js';

const { Pool } = pg;

// NUMERIC est renvoye en chaine : c'est volontaire, aucun montant ne doit
// transiter par un flottant. Les services utilisent decimal.js.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (valeur) => valeur);
pg.types.setTypeParser(pg.types.builtins.INT8, (valeur) => valeur);

let pool = null;

export function obtenirPool() {
  if (!configuration.baseDeDonnees.url) return null;
  if (pool) return pool;

  pool = new Pool({
    connectionString: configuration.baseDeDonnees.url,
    ssl: configuration.baseDeDonnees.ssl ? { rejectUnauthorized: false } : false,
    max: configuration.baseDeDonnees.poolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'simaotech-api',
  });

  pool.on('error', (erreur) => {
    journal.error({ erreur: erreur.message }, 'Erreur du pool PostgreSQL');
  });

  return pool;
}

export function baseDisponible() {
  return Boolean(configuration.baseDeDonnees.url);
}

export async function executer(texte, parametres = []) {
  const p = obtenirPool();
  if (!p) {
    const erreur = new Error('La base de donnees n est pas configuree.');
    erreur.code = 'BASE_INDISPONIBLE';
    erreur.statutHttp = 503;
    throw erreur;
  }
  const debut = Date.now();
  try {
    const resultat = await p.query(texte, parametres);
    const duree = Date.now() - debut;
    if (duree > 500) {
      journal.warn({ duree, requete: texte.slice(0, 200) }, 'Requete SQL lente');
    }
    return resultat;
  } catch (erreur) {
    journal.error(
      { code: erreur.code, detail: erreur.detail, requete: texte.slice(0, 300) },
      'Echec de la requete SQL',
    );
    throw erreur;
  }
}

/**
 * Execute une fonction metier dans une transaction.
 * Le callback recoit un client dedie (BEGIN/COMMIT/ROLLBACK automatiques).
 */
export async function transaction(callback) {
  const p = obtenirPool();
  if (!p) {
    const erreur = new Error('La base de donnees n est pas configuree.');
    erreur.code = 'BASE_INDISPONIBLE';
    erreur.statutHttp = 503;
    throw erreur;
  }
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const resultat = await callback(client);
    await client.query('COMMIT');
    return resultat;
  } catch (erreur) {
    try {
      await client.query('ROLLBACK');
    } catch (erreurRollback) {
      journal.error({ erreur: erreurRollback.message }, 'Echec du ROLLBACK');
    }
    throw erreur;
  } finally {
    client.release();
  }
}

export async function verifierConnexion() {
  if (!baseDisponible()) return { disponible: false, motif: 'DATABASE_URL absente' };
  try {
    const debut = Date.now();
    const resultat = await executer('select now() as horodatage, version() as version');
    return {
      disponible: true,
      latenceMs: Date.now() - debut,
      horodatage: resultat.rows[0].horodatage,
      version: String(resultat.rows[0].version).split(' ').slice(0, 2).join(' '),
    };
  } catch (erreur) {
    return { disponible: false, motif: erreur.message };
  }
}

export async function fermerPool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export default { obtenirPool, executer, transaction, verifierConnexion, fermerPool, baseDisponible };
