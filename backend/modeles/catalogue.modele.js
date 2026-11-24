/**
 * Modele d'acces aux donnees du catalogue : categories, produits et historique
 * des prix. Aucune logique metier ici, uniquement des requetes SQL parametrees.
 *
 * Les quantites proviennent de `stocks` via la vue `vue_produits`. Le CMP et le
 * prix de vente ne sont jamais ecrits directement : le CMP appartient aux
 * approvisionnements, le prix passe par `fn_modifier_prix_produit`.
 */
import { executer } from '../configuration/base_de_donnees.js';

const COLONNES_CATEGORIE = `
  c.id,
  c.code,
  c.nom,
  c.description,
  c.actif,
  c.cree_le,
  c.modifie_le
`;

const COLONNES_PRODUIT = `
  p.id,
  p.reference,
  p.code_barres,
  p.nom,
  p.description,
  p.categorie_id,
  p.categorie_nom,
  p.prix_vente_reference,
  p.cout_moyen_pondere,
  p.quantite_disponible,
  p.quantite_reservee,
  p.quantite_vendable,
  p.seuil_alerte,
  p.statut,
  p.etat_stock,
  p.benefice_unitaire_reference,
  p.cree_le,
  p.modifie_le
`;

/* -------------------------------------------------------------------------- */
/* Categories                                                                 */
/* -------------------------------------------------------------------------- */

export async function listerCategories({ limite = 50, decalage = 0, recherche = null, actif = null } = {}) {
  const conditions = ['c.supprime_le IS NULL'];
  const parametres = [];

  if (recherche) {
    parametres.push(`%${recherche}%`);
    conditions.push(
      `(c.nom ILIKE $${parametres.length} OR c.code ILIKE $${parametres.length})`,
    );
  }
  if (actif !== null) {
    parametres.push(actif);
    conditions.push(`c.actif = $${parametres.length}`);
  }

  const filtre = conditions.join(' AND ');
  const [liste, total] = await Promise.all([
    executer(
      `SELECT ${COLONNES_CATEGORIE},
              (SELECT count(*)::int FROM produits p
                WHERE p.categorie_id = c.id AND p.supprime_le IS NULL) AS nombre_produits
         FROM categories c
        WHERE ${filtre}
        ORDER BY c.actif DESC, c.nom
        LIMIT $${parametres.length + 1} OFFSET $${parametres.length + 2}`,
      [...parametres, limite, decalage],
    ),
    executer(`SELECT count(*)::int AS total FROM categories c WHERE ${filtre}`, parametres),
  ]);

  return { categories: liste.rows, total: total.rows[0]?.total ?? 0 };
}

export async function trouverCategorie(id) {
  const { rows } = await executer(
    `SELECT ${COLONNES_CATEGORIE},
            (SELECT count(*)::int FROM produits p
              WHERE p.categorie_id = c.id AND p.supprime_le IS NULL) AS nombre_produits
       FROM categories c
      WHERE c.id = $1 AND c.supprime_le IS NULL`,
    [id],
  );
  return rows[0] ?? null;
}

/** Verifie l'unicite du nom (insensible a la casse) hors de l'identifiant donne. */
export async function trouverCategorieParNom(nom, ignorerId = null) {
  const { rows } = await executer(
    `SELECT id, nom FROM categories
      WHERE lower(nom) = lower($1) AND supprime_le IS NULL
        AND ($2::uuid IS NULL OR id <> $2::uuid)`,
    [nom, ignorerId],
  );
  return rows[0] ?? null;
}

export async function trouverCategorieParCode(code, ignorerId = null) {
  const { rows } = await executer(
    `SELECT id, code FROM categories
      WHERE lower(code) = lower($1)
        AND ($2::uuid IS NULL OR id <> $2::uuid)`,
    [code, ignorerId],
  );
  return rows[0] ?? null;
}

export async function creerCategorie({ code, nom, description, actif = true }) {
  const { rows } = await executer(
    `INSERT INTO categories (code, nom, description, actif)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [code, nom, description, actif],
  );
  return trouverCategorie(rows[0].id);
}

export async function modifierCategorie(id, { code, nom, description, actif }) {
  await executer(
    `UPDATE categories
        SET code = $2, nom = $3, description = $4, actif = $5
      WHERE id = $1 AND supprime_le IS NULL`,
    [id, code, nom, description, actif],
  );
  return trouverCategorie(id);
}

export async function supprimerCategorie(id) {
  const resultat = await executer(
    `UPDATE categories
        SET supprime_le = now(), actif = false
      WHERE id = $1 AND supprime_le IS NULL`,
    [id],
  );
  return resultat.rowCount === 1;
}

/* -------------------------------------------------------------------------- */
/* Produits                                                                   */
/* -------------------------------------------------------------------------- */

function filtreProduits({ recherche, categorieId, statut, etatStock }) {
  const conditions = [];
  const parametres = [];

  if (recherche) {
    parametres.push(`%${recherche}%`);
    conditions.push(
      `(p.nom ILIKE $${parametres.length}
        OR p.reference ILIKE $${parametres.length}
        OR coalesce(p.code_barres, '') ILIKE $${parametres.length})`,
    );
  }
  if (categorieId) {
    parametres.push(categorieId);
    conditions.push(`p.categorie_id = $${parametres.length}`);
  }
  if (statut) {
    parametres.push(statut);
    conditions.push(`p.statut = $${parametres.length}`);
  }
  if (etatStock) {
    parametres.push(etatStock);
    conditions.push(`p.etat_stock = $${parametres.length}`);
  }

  return { filtre: conditions.length ? conditions.join(' AND ') : 'TRUE', parametres };
}

const TRIS = {
  nom: 'p.nom ASC',
  reference: 'p.reference ASC',
  prix: 'p.prix_vente_reference DESC, p.nom ASC',
  stock: 'p.quantite_disponible ASC, p.nom ASC',
  recent: 'p.cree_le DESC',
};

export async function listerProduits({
  limite = 50,
  decalage = 0,
  recherche = null,
  categorieId = null,
  statut = null,
  etatStock = null,
  tri = 'nom',
} = {}) {
  const { filtre, parametres } = filtreProduits({ recherche, categorieId, statut, etatStock });
  const ordre = TRIS[tri] ?? TRIS.nom;

  const [liste, total] = await Promise.all([
    executer(
      `SELECT ${COLONNES_PRODUIT}
         FROM vue_produits p
        WHERE ${filtre}
        ORDER BY ${ordre}
        LIMIT $${parametres.length + 1} OFFSET $${parametres.length + 2}`,
      [...parametres, limite, decalage],
    ),
    executer(`SELECT count(*)::int AS total FROM vue_produits p WHERE ${filtre}`, parametres),
  ]);

  return { produits: liste.rows, total: total.rows[0]?.total ?? 0 };
}

export async function statistiquesProduits() {
  const { rows } = await executer(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE p.statut = 'ACTIF')::int AS actifs,
            count(*) FILTER (WHERE p.etat_stock = 'RUPTURE')::int AS ruptures,
            count(*) FILTER (WHERE p.etat_stock = 'FAIBLE')::int AS stocks_faibles
       FROM vue_produits p`,
  );
  return rows[0];
}

export async function trouverProduit(id) {
  const { rows } = await executer(
    `SELECT ${COLONNES_PRODUIT}
       FROM vue_produits p
      WHERE p.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function trouverProduitParReference(reference, ignorerId = null) {
  const { rows } = await executer(
    `SELECT id, reference FROM produits
      WHERE upper(reference) = upper($1) AND supprime_le IS NULL
        AND ($2::uuid IS NULL OR id <> $2::uuid)`,
    [reference, ignorerId],
  );
  return rows[0] ?? null;
}

export async function trouverProduitParCodeBarres(codeBarres, ignorerId = null) {
  if (!codeBarres) return null;
  const { rows } = await executer(
    `SELECT id, code_barres FROM produits
      WHERE code_barres = $1 AND supprime_le IS NULL
        AND ($2::uuid IS NULL OR id <> $2::uuid)`,
    [codeBarres, ignorerId],
  );
  return rows[0] ?? null;
}

export async function creerProduit({
  reference,
  codeBarres,
  nom,
  description,
  categorieId,
  prixVenteReference,
  seuilAlerte,
  statut,
  creePar,
}) {
  const { rows } = await executer(
    `INSERT INTO produits
       (reference, code_barres, nom, description, categorie_id,
        prix_vente_reference, seuil_alerte, statut, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      reference,
      codeBarres,
      nom,
      description,
      categorieId,
      prixVenteReference,
      seuilAlerte,
      statut,
      creePar,
    ],
  );
  return trouverProduit(rows[0].id);
}

export async function modifierProduit(id, { nom, description, codeBarres, categorieId, seuilAlerte, statut }) {
  await executer(
    `UPDATE produits
        SET nom = $2,
            description = $3,
            code_barres = $4,
            categorie_id = $5,
            seuil_alerte = $6,
            statut = $7
      WHERE id = $1 AND supprime_le IS NULL`,
    [id, nom, description, codeBarres, categorieId, seuilAlerte, statut],
  );
  return trouverProduit(id);
}

export async function supprimerProduit(id) {
  const resultat = await executer(
    `UPDATE produits
        SET supprime_le = now(), statut = 'ARCHIVE'
      WHERE id = $1 AND supprime_le IS NULL`,
    [id],
  );
  return resultat.rowCount === 1;
}

/** Appelle la fonction SQL qui seule peut modifier un prix de reference. */
export async function modifierPrixProduit({ produitId, utilisateurId, prix, motif }) {
  const { rows } = await executer('SELECT fn_modifier_prix_produit($1, $2, $3, $4) AS resultat', [
    produitId,
    utilisateurId,
    prix,
    motif,
  ]);
  return rows[0]?.resultat ?? null;
}

export async function listerHistoriquePrix(produitId, { limite = 50, decalage = 0 } = {}) {
  const [liste, total] = await Promise.all([
    executer(
      `SELECT h.id,
              h.prix_vente_ancien,
              h.prix_vente_nouveau,
              h.motif,
              h.cree_le,
              u.nom_complet AS modifie_par_nom
         FROM historique_prix_produits h
         LEFT JOIN utilisateurs u ON u.id = h.modifie_par
        WHERE h.produit_id = $1
        ORDER BY h.cree_le DESC
        LIMIT $2 OFFSET $3`,
      [produitId, limite, decalage],
    ),
    executer('SELECT count(*)::int AS total FROM historique_prix_produits WHERE produit_id = $1', [
      produitId,
    ]),
  ]);
  return { historique: liste.rows, total: total.rows[0]?.total ?? 0 };
}

/** Options compactes pour les listes deroulantes (categories actives). */
export async function optionsCategories() {
  const { rows } = await executer(
    `SELECT id, nom FROM categories
      WHERE supprime_le IS NULL AND actif
      ORDER BY nom`,
  );
  return rows;
}

export default {
  listerCategories,
  trouverCategorie,
  trouverCategorieParNom,
  trouverCategorieParCode,
  creerCategorie,
  modifierCategorie,
  supprimerCategorie,
  listerProduits,
  statistiquesProduits,
  trouverProduit,
  trouverProduitParReference,
  trouverProduitParCodeBarres,
  creerProduit,
  modifierProduit,
  supprimerProduit,
  modifierPrixProduit,
  listerHistoriquePrix,
  optionsCategories,
};
