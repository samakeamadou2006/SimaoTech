-- =============================================================================
-- 005 - Mouvements de stock, inventaires, historique du cout moyen
-- =============================================================================

CREATE TABLE mouvements_stock (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produit_id     uuid NOT NULL REFERENCES produits(id) ON DELETE RESTRICT,
  type_mouvement type_mouvement_stock NOT NULL,
  quantite       numeric(14,3) NOT NULL,
  stock_avant    numeric(14,3) NOT NULL,
  stock_apres    numeric(14,3) NOT NULL,
  cout_unitaire  numeric(18,6),
  valeur_mouvement numeric(18,2),
  reference_type text,
  reference_id   uuid,
  utilisateur_id uuid REFERENCES utilisateurs(id) ON DELETE SET NULL,
  appareil_id    uuid REFERENCES appareils(id) ON DELETE SET NULL,
  motif          text,
  cree_le        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mouvements_quantite_non_nulle CHECK (quantite <> 0),
  CONSTRAINT mouvements_stock_apres_positif CHECK (stock_apres >= 0),
  CONSTRAINT mouvements_sens_coherent CHECK (
    (type_mouvement IN ('ENTREE_APPROVISIONNEMENT', 'RETOUR_ANNULATION', 'AJUSTEMENT_POSITIF', 'LIBERATION_RESERVATION') AND quantite > 0)
    OR (type_mouvement IN ('SORTIE_VENTE', 'AJUSTEMENT_NEGATIF', 'RESERVATION') AND quantite < 0)
    OR type_mouvement = 'INVENTAIRE'
  )
);

CREATE INDEX mouvements_produit_idx ON mouvements_stock (produit_id, cree_le DESC);
CREATE INDEX mouvements_reference_idx ON mouvements_stock (reference_type, reference_id);
CREATE INDEX mouvements_periode_idx ON mouvements_stock (cree_le DESC);

COMMENT ON TABLE mouvements_stock IS
  'Historique immuable de tous les mouvements de stock (entrees, sorties, reservations, inventaires).';

CREATE SEQUENCE seq_inventaire START 1;

CREATE TABLE inventaires (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero           text NOT NULL UNIQUE,
  date_inventaire  timestamptz NOT NULL DEFAULT now(),
  utilisateur_id   uuid NOT NULL REFERENCES utilisateurs(id) ON DELETE RESTRICT,
  statut           statut_inventaire NOT NULL DEFAULT 'BROUILLON',
  observations     text,
  cree_le          timestamptz NOT NULL DEFAULT now(),
  valide_le        timestamptz,
  CONSTRAINT inventaires_valide_horodatage CHECK (
    (statut = 'VALIDE' AND valide_le IS NOT NULL) OR statut <> 'VALIDE'
  )
);

CREATE TABLE lignes_inventaire (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventaire_id     uuid NOT NULL REFERENCES inventaires(id) ON DELETE CASCADE,
  produit_id        uuid NOT NULL REFERENCES produits(id) ON DELETE RESTRICT,
  quantite_theorique numeric(14,3) NOT NULL,
  quantite_comptee  numeric(14,3) NOT NULL,
  ecart             numeric(14,3) GENERATED ALWAYS AS (quantite_comptee - quantite_theorique) STORED,
  cree_le           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lignes_inv_quantites_positives CHECK (quantite_theorique >= 0 AND quantite_comptee >= 0),
  CONSTRAINT lignes_inv_produit_unique UNIQUE (inventaire_id, produit_id)
);

CREATE TABLE historique_cout_moyen (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produit_id            uuid NOT NULL REFERENCES produits(id) ON DELETE RESTRICT,
  cmp_avant             numeric(18,6) NOT NULL,
  cmp_apres             numeric(18,6) NOT NULL,
  quantite_avant        numeric(14,3) NOT NULL,
  quantite_entree       numeric(14,3) NOT NULL,
  cout_unitaire_entree  numeric(18,6) NOT NULL,
  source_type           text NOT NULL,
  source_id             uuid,
  utilisateur_id        uuid REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cree_le               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT historique_cmp_quantites_positives CHECK (quantite_avant >= 0 AND quantite_entree >= 0),
  CONSTRAINT historique_cmp_valeurs_positives CHECK (cmp_avant >= 0 AND cmp_apres >= 0)
);

CREATE INDEX historique_cmp_produit_idx ON historique_cout_moyen (produit_id, cree_le DESC);

-- Quotas de stock attribues a un appareil pour la vente hors connexion.
-- Chaque quota fige le CMP de reference : une vente locale ne peut pas passer
-- sous ce cout, et le serveur revalide au retour de la connexion.
CREATE TABLE quotas_stock_appareil (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appareil_id       uuid NOT NULL REFERENCES appareils(id) ON DELETE CASCADE,
  produit_id        uuid NOT NULL REFERENCES produits(id) ON DELETE CASCADE,
  quantite_affectee numeric(14,3) NOT NULL,
  quantite_utilisee numeric(14,3) NOT NULL DEFAULT 0,
  cmp_reference     numeric(18,6) NOT NULL,
  actif             boolean NOT NULL DEFAULT true,
  date_affectation  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quotas_quantites_positives CHECK (
    quantite_affectee > 0 AND quantite_utilisee >= 0 AND quantite_utilisee <= quantite_affectee
  ),
  CONSTRAINT quotas_cmp_positif CHECK (cmp_reference >= 0)
);

CREATE UNIQUE INDEX quotas_appareil_produit_actif
  ON quotas_stock_appareil (appareil_id, produit_id) WHERE actif;

COMMENT ON TABLE quotas_stock_appareil IS
  'Reservation de quantites par appareil hors ligne avec CMP de reference fige (phase synchronisation).';
