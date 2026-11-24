/**
 * Verification de l'integrite du schema apres migration.
 *
 * Usage : npm run db:verifier
 * Verifie la presence des tables, vues, fonctions, declencheurs et politiques
 * RLS attendus, puis controle quelques invariants de coherence.
 */
import pg from 'pg';
import path from 'node:path';
import 'dotenv/config';

const ATTENDU = {
  tables: [
    'utilisateurs', 'roles', 'permissions', 'role_permissions', 'utilisateur_permissions', 'appareils',
    'categories', 'produits', 'historique_prix_produits',
    'fournisseurs', 'approvisionnements', 'lignes_approvisionnement',
    'stocks', 'mouvements_stock', 'inventaires', 'lignes_inventaire', 'historique_cout_moyen',
    'quotas_stock_appareil',
    'ventes', 'lignes_vente', 'reductions_ventes', 'paiements',
    'categories_depenses', 'depenses', 'historique_depenses',
    'demandes_annulation', 'historique_annulations',
    'operations_synchronisation', 'conflits_synchronisation',
    'journal_activites', 'parametres', 'schema_migrations',
  ],
  fonctions: [
    'fn_cmp', 'fn_valider_approvisionnement', 'fn_valider_vente',
    'fn_enregistrer_mouvement_stock', 'fn_recalculer_totaux_vente',
    'fn_creer_demande_annulation', 'fn_approuver_annulation', 'fn_rejeter_annulation',
    'fn_valider_depense', 'fn_rejeter_depense', 'fn_creer_depense',
    'fn_modifier_prix_produit', 'fn_ajuster_stock', 'fn_valider_inventaire',
    'fn_a_permission', 'fn_exiger_permission', 'fn_journaliser',
    'fn_enregistrer_operation_synchronisation',
  ],
  declencheurs: [
    'trg_lignes_vente_calculs', 'trg_lignes_vente_totaux', 'trg_produits_proteger_cmp',
    'trg_ventes_protegees', 'trg_mouvements_immuables', 'trg_journal_immuable',
    'trg_produits_creer_stock', 'trg_ventes_numero',
  ],
};

let instanceLocale = null;

async function terminer(code) {
  if (instanceLocale) {
    try {
      await instanceLocale.stop();
      // Laisse au processus PostgreSQL le temps de se terminer proprement.
      await new Promise((resolution) => setTimeout(resolution, 400));
    } catch {
      /* arret deja effectue */
    }
    instanceLocale = null;
  }
  process.exit(code);
}

async function principal() {
  if (process.argv.includes('--local')) {
    const { default: EmbeddedPostgres } = await import('embedded-postgres');
    const fs = await import('node:fs/promises');
    const dossier = path.join(process.cwd(), '.postgres-local');
    await fs.mkdir(dossier, { recursive: true });
    const dejaInitialise = await fs
      .access(path.join(dossier, 'PG_VERSION'))
      .then(() => true)
      .catch(() => false);

    instanceLocale = new EmbeddedPostgres({
      databaseDir: dossier,
      user: 'postgres',
      password: 'postgres',
      port: 55432,
      persistent: true,
    });
    if (!dejaInitialise) {
      await instanceLocale.initialise();
    }
    await instanceLocale.start();
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:55432/postgres';
  }

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL absente.');
    await terminer(1);
  }

  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.BASE_DE_DONNEES_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
  await client.connect();

  const problemes = [];

  const { rows: tables } = await client.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );
  const nomsTables = new Set(tables.map((t) => t.tablename));
  for (const table of ATTENDU.tables) {
    if (!nomsTables.has(table)) problemes.push(`table manquante : ${table}`);
  }

  const { rows: vues } = await client.query(
    `SELECT viewname FROM pg_views WHERE schemaname = 'public'`,
  );
  if (!vues.some((v) => v.viewname === 'vue_produits')) problemes.push('vue manquante : vue_produits');

  const { rows: fonctions } = await client.query(
    `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'`,
  );
  const nomsFonctions = new Set(fonctions.map((f) => f.proname));
  for (const fonction of ATTENDU.fonctions) {
    if (!nomsFonctions.has(fonction)) problemes.push(`fonction manquante : ${fonction}`);
  }

  const { rows: declencheurs } = await client.query(
    `SELECT tgname FROM pg_trigger WHERE NOT tgisinternal`,
  );
  const nomsDeclencheurs = new Set(declencheurs.map((t) => t.tgname));
  for (const declencheur of ATTENDU.declencheurs) {
    if (!nomsDeclencheurs.has(declencheur)) problemes.push(`declencheur manquant : ${declencheur}`);
  }

  const { rows: sansRls } = await client.query(
    `SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND rowsecurity = false AND tablename <> 'schema_migrations'`,
  );
  for (const table of sansRls) problemes.push(`RLS desactivee : ${table.tablename}`);

  const { rows: migrations } = await client.query(
    'SELECT count(*)::int AS n, max(appliquee_le) AS derniere FROM schema_migrations',
  );

  // Invariants de coherence (aucune ligne ne doit exister en violation)
  const controles = [
    ['ventes sous le CMP', `SELECT count(*)::int AS n FROM lignes_vente WHERE prix_net_unitaire < cmp_applique`],
    ['stocks negatifs', `SELECT count(*)::int AS n FROM stocks WHERE quantite_disponible < 0`],
    ['ventes incoherentes', `SELECT count(*)::int AS n FROM ventes WHERE benefice_brut <> montant_net - cout_total`],
    ['paiements mobiles sans reference', `SELECT count(*)::int AS n FROM paiements WHERE moyen_paiement <> 'ESPECES' AND reference_transaction IS NULL`],
  ];

  for (const [libelle, requete] of controles) {
    const { rows } = await client.query(requete);
    if (rows[0].n > 0) problemes.push(`${rows[0].n} cas de ${libelle}`);
  }

  await client.end();

  console.log(`Migrations appliquees : ${migrations[0].n} (derniere : ${migrations[0].derniere ?? '-'})`);
  console.log(`Tables : ${ATTENDU.tables.length} attendues, ${nomsTables.size} presentes`);

  if (problemes.length === 0) {
    console.log('Schema conforme : tables, vues, fonctions, declencheurs, RLS et invariants verifies.');
    await terminer(0);
  }

  console.error('\nAnomalies detectees :');
  for (const probleme of problemes) console.error(`  - ${probleme}`);
  await terminer(1);
}

principal().catch(async (erreur) => {
  console.error('Verification impossible :', erreur.message);
  await terminer(1);
});

