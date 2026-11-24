-- =============================================================================
-- 003 - Catalogue : categories, produits, historique des prix
-- -----------------------------------------------------------------------------
-- Note de normalisation : les quantites font foi dans la table `stocks`
-- (entite dediee au stock). La vue `vue_produits` expose quantite_disponible
-- et quantite_reservee pour respecter la fiche produit fonctionnelle.
-- =============================================================================

CREATE TABLE categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  nom         text NOT NULL,
  description text,
  actif       boolean NOT NULL DEFAULT true,
  cree_le     timestamptz NOT NULL DEFAULT now(),
  modifie_le  timestamptz NOT NULL DEFAULT now(),
  supprime_le timestamptz,
  CONSTRAINT categories_nom_non_vide CHECK (length(btrim(nom)) >= 2)
);

CREATE UNIQUE INDEX categories_nom_unique ON categories (lower(nom)) WHERE supprime_le IS NULL;

CREATE TABLE produits (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference             text NOT NULL,
  code_barres           text,
  nom                   text NOT NULL,
  description           text,
  categorie_id          uuid NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  prix_vente_reference  numeric(16,2) NOT NULL DEFAULT 0,
  cout_moyen_pondere    numeric(18,6) NOT NULL DEFAULT 0,
  seuil_alerte          numeric(14,3) NOT NULL DEFAULT 0,
  statut                statut_produit NOT NULL DEFAULT 'ACTIF',
  cree_par              uuid REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cree_le               timestamptz NOT NULL DEFAULT now(),
  modifie_le            timestamptz NOT NULL DEFAULT now(),
  supprime_le           timestamptz,
  CONSTRAINT produits_reference_non_vide CHECK (length(btrim(reference)) >= 1),
  CONSTRAINT produits_prix_positif CHECK (prix_vente_reference >= 0),
  CONSTRAINT produits_cmp_positif CHECK (cout_moyen_pondere >= 0),
  CONSTRAINT produits_seuil_positif CHECK (seuil_alerte >= 0)
);

CREATE UNIQUE INDEX produits_reference_unique ON produits (upper(reference)) WHERE supprime_le IS NULL;
CREATE UNIQUE INDEX produits_code_barres_unique ON produits (code_barres) WHERE code_barres IS NOT NULL AND supprime_le IS NULL;
CREATE INDEX produits_categorie_idx ON produits (categorie_id) WHERE supprime_le IS NULL;
CREATE INDEX produits_nom_recherche_idx ON produits USING gin (to_tsvector('french', nom || ' ' || reference));
CREATE INDEX produits_statut_idx ON produits (statut) WHERE supprime_le IS NULL;

COMMENT ON COLUMN produits.cout_moyen_pondere IS
  'CMP calcule exclusivement par fn_valider_approvisionnement. Jamais modifiable a la main.';
COMMENT ON COLUMN produits.prix_vente_reference IS
  'Prix de reference. Seul le proprietaire peut le modifier (controle applicatif + RLS).';

CREATE TABLE historique_prix_produits (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produit_id          uuid NOT NULL REFERENCES produits(id) ON DELETE RESTRICT,
  prix_vente_ancien   numeric(16,2),
  prix_vente_nouveau  numeric(16,2) NOT NULL,
  modifie_par         uuid REFERENCES utilisateurs(id) ON DELETE SET NULL,
  motif               text,
  cree_le             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX historique_prix_produit_idx ON historique_prix_produits (produit_id, cree_le DESC);

CREATE TABLE stocks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produit_id          uuid NOT NULL UNIQUE REFERENCES produits(id) ON DELETE RESTRICT,
  quantite_disponible numeric(14,3) NOT NULL DEFAULT 0,
  quantite_reservee   numeric(14,3) NOT NULL DEFAULT 0,
  seuil_alerte        numeric(14,3) NOT NULL DEFAULT 0,
  valeur_stock        numeric(18,2) NOT NULL DEFAULT 0,
  mis_a_jour_le       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stocks_quantite_positive CHECK (quantite_disponible >= 0),
  CONSTRAINT stocks_reservee_positive CHECK (quantite_reservee >= 0),
  CONSTRAINT stocks_reservee_coherente CHECK (quantite_reservee <= quantite_disponible),
  CONSTRAINT stocks_seuil_positif CHECK (seuil_alerte >= 0),
  CONSTRAINT stocks_valeur_positive CHECK (valeur_stock >= 0)
);

COMMENT ON TABLE stocks IS
  'Stock courant par produit. Seules les fonctions metier mettent a jour ces valeurs.';

-- Vue fonctionnelle de la fiche produit
CREATE OR REPLACE VIEW vue_produits AS
SELECT
  p.id,
  p.reference,
  p.code_barres,
  p.nom,
  p.description,
  p.categorie_id,
  c.nom AS categorie_nom,
  p.prix_vente_reference,
  p.cout_moyen_pondere,
  coalesce(s.quantite_disponible, 0) AS quantite_disponible,
  coalesce(s.quantite_reservee, 0)   AS quantite_reservee,
  coalesce(s.quantite_disponible, 0) - coalesce(s.quantite_reservee, 0) AS quantite_vendable,
  coalesce(s.seuil_alerte, p.seuil_alerte) AS seuil_alerte,
  p.statut,
  p.cree_le,
  p.modifie_le,
  CASE
    WHEN coalesce(s.quantite_disponible, 0) <= 0 THEN 'RUPTURE'
    WHEN coalesce(s.quantite_disponible, 0) <= coalesce(s.seuil_alerte, p.seuil_alerte) THEN 'FAIBLE'
    ELSE 'NORMAL'
  END AS etat_stock,
  p.prix_vente_reference - p.cout_moyen_pondere AS benefice_unitaire_reference
FROM produits p
JOIN categories c ON c.id = p.categorie_id
LEFT JOIN stocks s ON s.produit_id = p.id
WHERE p.supprime_le IS NULL;

COMMENT ON VIEW vue_produits IS
  'Vue de lecture du catalogue : quantites issues de stocks, CMP et benefice unitaire de reference.';

CREATE TRIGGER trg_categories_modifie_le
  BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION fn_maj_modifie_le();

CREATE TRIGGER trg_produits_modifie_le
  BEFORE UPDATE ON produits
  FOR EACH ROW EXECUTE FUNCTION fn_maj_modifie_le();
