/**
 * Infrastructure des tests d'integration.
 *
 * Demarre un PostgreSQL embarque isole, applique toutes les migrations puis
 * fournit des fabriques de donnees. Aucun service externe n'est requis.
 */
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import EmbeddedPostgres from 'embedded-postgres';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dossierMigrations = path.join(racine, 'base_de_donnees', 'migrations');

let instance = null;
let client = null;

/**
 * Port du PostgreSQL de test. Il est choisi dynamiquement au demarrage : une
 * instance precedente mal arretee (ou un test precedent) ne bloque donc plus
 * la suite. La valeur reste lisible apres `demarrerBase()`.
 */
export let PORT_TEST = 55433;

async function portLibre(depart) {
  for (let port = depart; port < depart + 100; port += 1) {
    const libre = await new Promise((resoudre) => {
      const sonde = net.createServer();
      sonde.once('error', () => resoudre(false));
      sonde.once('listening', () => sonde.close(() => resoudre(true)));
      sonde.listen(port, '127.0.0.1');
    });
    if (libre) return port;
  }
  throw new Error(`Aucun port libre entre ${depart} et ${depart + 99}.`);
}

export async function demarrerBase() {
  PORT_TEST = await portLibre(PORT_TEST);

  const dossier = await fs.mkdtemp(path.join(os.tmpdir(), 'simaotech-pg-'));
  instance = new EmbeddedPostgres({
    databaseDir: dossier,
    user: 'postgres',
    password: 'postgres',
    port: PORT_TEST,
    persistent: false,
  });

  await instance.initialise();
  await instance.start();

  client = new pg.Client({
    connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT_TEST}/postgres`,
    ssl: false,
  });
  await client.connect();

  const fichiers = (await fs.readdir(dossierMigrations)).filter((f) => f.endsWith('.sql')).sort();
  for (const fichier of fichiers) {
    const contenu = await fs.readFile(path.join(dossierMigrations, fichier), 'utf8');
    try {
      await client.query(contenu);
    } catch (erreur) {
      throw new Error(`Migration ${fichier} : ${erreur.message}`);
    }
  }

  return { client, dossier };
}

export async function arreterBase() {
  if (client) {
    await client.end().catch(() => {});
    client = null;
  }
  if (instance) {
    await instance.stop().catch(() => {});
    instance = null;
  }
}

export function base() {
  if (!client) throw new Error('Base de test non demarree.');
  return client;
}

export function nouvelIdentifiant() {
  return crypto.randomUUID();
}

export async function creerUtilisateur({ email, nom = 'Utilisateur Test', role = 'EMPLOYE' }) {
  const id = nouvelIdentifiant();
  await base().query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [id, email]);
  const { rows } = await base().query(
    `INSERT INTO utilisateurs (id, email, nom_complet, role_id)
     VALUES ($1, $2, $3, (SELECT id FROM roles WHERE code = $4))
     RETURNING id, email, nom_complet`,
    [id, email, nom, role],
  );
  return rows[0];
}

export async function creerCategorie(nom) {
  const { rows } = await base().query(
    `INSERT INTO categories (code, nom) VALUES ($1, $2) RETURNING id`,
    [`CAT-${nom.slice(0, 6).toUpperCase()}-${nouvelIdentifiant().slice(0, 6)}`, nom],
  );
  return rows[0].id;
}

export async function creerProduit({ nom, categorieId, prix = 1500, reference, creePar = null }) {
  const { rows } = await base().query(
    `INSERT INTO produits (reference, nom, categorie_id, prix_vente_reference, cree_par)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, reference, prix_vente_reference, cout_moyen_pondere`,
    [reference ?? `REF-${nouvelIdentifiant().slice(0, 8)}`, nom, categorieId, prix, creePar],
  );
  return rows[0];
}

export async function creerApprovisionnement({ fournisseurId, utilisateurId, lignes }) {
  const { rows } = await base().query(
    `INSERT INTO approvisionnements (fournisseur_id, utilisateur_id)
     VALUES ($1, $2) RETURNING id, numero`,
    [fournisseurId, utilisateurId],
  );
  const appro = rows[0];
  for (const ligne of lignes) {
    await base().query(
      `INSERT INTO lignes_approvisionnement
        (approvisionnement_id, produit_id, quantite, prix_achat_unitaire, reduction_ligne)
       VALUES ($1, $2, $3, $4, $5)`,
      [appro.id, ligne.produitId, ligne.quantite, ligne.prix, ligne.reduction ?? 0],
    );
  }
  return appro;
}

export async function validerApprovisionnement(id, utilisateurId) {
  const { rows } = await base().query('SELECT fn_valider_approvisionnement($1, $2) AS resultat', [
    id,
    utilisateurId,
  ]);
  return rows[0].resultat;
}

export async function stockProduit(produitId) {
  const { rows } = await base().query(
    'SELECT quantite_disponible, quantite_reservee FROM stocks WHERE produit_id = $1',
    [produitId],
  );
  return rows[0];
}

export async function cmpProduit(produitId) {
  const { rows } = await base().query('SELECT cout_moyen_pondere FROM produits WHERE id = $1', [
    produitId,
  ]);
  return rows[0].cout_moyen_pondere;
}

/**
 * Cree une vente complete (lignes + paiements) sans la valider.
 * @param {{utilisateurId: string, lignes: Array<{produitId, quantite, prix, reduction?, cmp}>, paiements: Array<{moyen, montant, reference?}>}} options
 */
export async function creerVente({ utilisateurId, lignes, paiements = [] }) {
  const vente = await base().query(
    `INSERT INTO ventes (utilisateur_id, statut) VALUES ($1, 'BROUILLON') RETURNING id, numero`,
    [utilisateurId],
  );
  const { id, numero } = vente.rows[0];

  for (const ligne of lignes) {
    await base().query(
      `INSERT INTO lignes_vente
        (vente_id, produit_id, quantite, prix_reference_unitaire, reduction_ligne, cmp_applique)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, ligne.produitId, ligne.quantite, ligne.prix, ligne.reduction ?? 0, ligne.cmp],
    );
  }

  for (const paiement of paiements) {
    await base().query(
      `INSERT INTO paiements (vente_id, moyen_paiement, montant, reference_transaction, utilisateur_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, paiement.moyen, paiement.montant, paiement.reference ?? null, utilisateurId],
    );
  }

  return { id, numero };
}

export async function validerVente(id, utilisateurId, clientPersonnalise = null) {
  const executeur = clientPersonnalise ?? base();
  const { rows } = await executeur.query('SELECT fn_valider_vente($1, $2) AS resultat', [
    id,
    utilisateurId,
  ]);
  return rows[0].resultat;
}

export async function creerFournisseur(nom) {
  const { rows } = await base().query(
    `INSERT INTO fournisseurs (code, nom)
     VALUES ($1, $2) RETURNING id`,
    [`F-${nouvelIdentifiant().slice(0, 8)}`, nom],
  );
  return rows[0].id;
}

export async function donneesVente(venteId) {
  const { rows } = await base().query(
    `SELECT id, numero, statut, montant_brut, total_reductions, montant_net,
            cout_total, benefice_brut, valide_le, annule_le
       FROM ventes WHERE id = $1`,
    [venteId],
  );
  return rows[0];
}
