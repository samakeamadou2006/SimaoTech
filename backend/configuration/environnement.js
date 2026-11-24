/**
 * Configuration centralisee de l'application.
 *
 * Toutes les variables d'environnement sont lues et validees ici, une seule fois.
 * Aucun module ne doit lire `process.env` directement : cela evite les valeurs
 * dispersees et permet de detecter tot une configuration incomplete.
 */
import 'dotenv/config';
import { z } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const booleen = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  URL_PUBLIQUE: z.string().url().default('http://localhost:3000'),
  ORIGINES_AUTORISEES: z.string().default('http://localhost:3000'),
  FUSEAU_HORAIRE: z.string().default('Africa/Abidjan'),

  DATABASE_URL: z.string().default(''),
  BASE_DE_DONNEES_SSL: booleen.default('false'),
  POOL_MAX: z.coerce.number().int().positive().max(50).default(10),

  SUPABASE_URL: z.string().default(''),
  SUPABASE_CLE_ANON: z.string().default(''),
  SUPABASE_CLE_SERVICE: z.string().default(''),

  MODE_AUTH: z.enum(['supabase', 'local']).default('supabase'),
  JWT_SECRET: z.string().default(''),
  JWT_DUREE_MAX: z.coerce.number().int().positive().default(28800),

  MOT_DE_PASSE_LONGUEUR_MIN: z.coerce.number().int().min(8).default(10),
  DOSSIER_JOURNAUX: z.string().default('journaux'),
  NIVEAU_JOURNAL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

const analyse = schema.safeParse(process.env);

if (!analyse.success) {
  // On n'utilise pas encore le journal (il depend de cette configuration).
  console.error('Configuration invalide :');
  for (const probleme of analyse.error.issues) {
    console.error(`  - ${probleme.path.join('.')} : ${probleme.message}`);
  }
  process.exit(1);
}

const env = analyse.data;

/** Avertissements de configuration (exposes par /api/sante, jamais les secrets). */
export const avertissements = [];

if (!env.DATABASE_URL) {
  avertissements.push('DATABASE_URL absente : la base de donnees est indisponible.');
}
if (env.MODE_AUTH === 'supabase' && !env.SUPABASE_URL) {
  avertissements.push('SUPABASE_URL absente : verification des jetons impossible.');
}
if (env.MODE_AUTH === 'local' && env.JWT_SECRET.length < 32) {
  avertissements.push('JWT_SECRET absent ou trop court pour le mode local.');
}
if (env.NODE_ENV === 'production' && env.BASE_DE_DONNEES_SSL === false) {
  avertissements.push('BASE_DE_DONNEES_SSL desactive en production.');
}

export const configuration = Object.freeze({
  environnement: env.NODE_ENV,
  estProduction: env.NODE_ENV === 'production',
  estTest: env.NODE_ENV === 'test',
  port: env.PORT,
  urlPublique: env.URL_PUBLIQUE,
  originesAutorisees: env.ORIGINES_AUTORISEES.split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  fuseauHoraire: env.FUSEAU_HORAIRE,
  baseDeDonnees: {
    url: env.DATABASE_URL,
    ssl: env.BASE_DE_DONNEES_SSL,
    poolMax: env.POOL_MAX,
  },
  supabase: {
    url: env.SUPABASE_URL,
    cleAnon: env.SUPABASE_CLE_ANON,
    cleService: env.SUPABASE_CLE_SERVICE,
  },
  authentification: {
    mode: env.MODE_AUTH,
    jwtSecret: env.JWT_SECRET,
    dureeMax: env.JWT_DUREE_MAX,
    longueurMinMotDePasse: env.MOT_DE_PASSE_LONGUEUR_MIN,
  },
  journal: {
    dossier: path.resolve(racine, env.DOSSIER_JOURNAUX),
    niveau: env.NIVEAU_JOURNAL,
  },
  chemins: {
    racine,
    frontend: path.join(racine, 'frontend'),
    modules: path.join(racine, 'node_modules'),
  },
});

export default configuration;
