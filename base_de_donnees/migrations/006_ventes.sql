-- =============================================================================
-- 006 - Ventes et lignes de vente
-- -----------------------------------------------------------------------------
-- La contrainte `lignes_vente_prix_net_superieur_cmp` garantit au niveau de la
-- base qu'aucune ligne ne peut etre enregistree sous son CMP applicable, en
-- complement des controles applicatifs et de la fonction de validation.
-- =============================================================================

CREATE SEQUENCE seq_vente START 1;

CREATE TABLE ventes (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero                 text NOT NULL UNIQUE,
  date_vente             timestamptz NOT NULL DEFAULT now(),
  utilisateur_id         uuid NOT NULL REFERENCES utilisateurs(id) ON DELETE RESTRICT,
  appareil_id            uuid REFERENCES appareils(id) ON DELETE SET NULL,
  statut                 statut_vente NOT NULL DEFAULT 'BROUILLON',
  statut_synchronisation statut_synchronisation NOT NULL DEFAULT 'SYNCHRONISEE',
  montant_brut           numeric(16,2) NOT NULL DEFAULT 0,
  total_reductions       numeric(16,2) NOT NULL DEFAULT 0,
  montant_net            numeric(16,2) NOT NULL DEFAULT 0,
  cout_total             numeric(16,2) NOT NULL DEFAULT 0,
  benefice_brut          numeric(16,2) NOT NULL DEFAULT 0,
  cle_idempotence        uuid,
  motif_anomalie         text,
  observations           text,
  cree_le                timestamptz NOT NULL DEFAULT now(),
  valide_le              timestamptz,
  annule_le              timestamptz,
  CONSTRAINT ventes_montants_positifs CHECK (
    montant_brut >= 0 AND total_reductions >= 0 AND montant_net >= 0
    AND cout_total >= 0 AND benefice_brut >= 0
  ),
  CONSTRAINT ventes_coherence_montants CHECK (
    montant_net = montant_brut - total_reductions
  ),
  CONSTRAINT ventes_coherence_benefice CHECK (
    benefice_brut = montant_net - cout_total
  ),
  CONSTRAINT ventes_validation_horodatage CHECK (
    (statut IN ('VALIDEE', 'ANNULEE') AND valide_le IS NOT NULL) OR statut IN ('BROUILLON', 'EN_ATTENTE_SYNCHRONISATION', 'ANOMALIE')
  ),
  CONSTRAINT ventes_annulation_horodatage CHECK (
    (statut = 'ANNULEE' AND annule_le IS NOT NULL) OR statut <> 'ANNULEE'
  ),
  CONSTRAINT ventes_anomalie_motivee CHECK (
    statut <> 'ANOMALIE' OR motif_anomalie IS NOT NULL
  )
);

CREATE UNIQUE INDEX ventes_idempotence_unique ON ventes (cle_idempotence)
  WHERE cle_idempotence IS NOT NULL;
CREATE INDEX ventes_date_idx ON ventes (date_vente DESC);
CREATE INDEX ventes_utilisateur_idx ON ventes (utilisateur_id, date_vente DESC);
CREATE INDEX ventes_statut_idx ON ventes (statut);
CREATE INDEX ventes_periode_validees_idx ON ventes (date_vente DESC)
  WHERE statut = 'VALIDEE';

COMMENT ON TABLE ventes IS
  'Vente. Une vente validee n est jamais supprimee physiquement ; son annulation passe par demandes_annulation.';

CREATE TABLE lignes_vente (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vente_id              uuid NOT NULL REFERENCES ventes(id) ON DELETE CASCADE,
  produit_id            uuid NOT NULL REFERENCES produits(id) ON DELETE RESTRICT,
  quantite              numeric(14,3) NOT NULL,
  prix_reference_unitaire numeric(16,2) NOT NULL,
  reduction_ligne       numeric(16,2) NOT NULL DEFAULT 0,
  remise_globale_affectee numeric(16,2) NOT NULL DEFAULT 0,
  prix_net_unitaire     numeric(16,2) NOT NULL DEFAULT 0,
  cmp_applique          numeric(18,6) NOT NULL,
  cout_total_ligne      numeric(16,2) NOT NULL DEFAULT 0,
  benefice_brut_ligne   numeric(16,2) NOT NULL DEFAULT 0,
  cree_le               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lignes_vente_quantite_positive CHECK (quantite > 0),
  CONSTRAINT lignes_vente_prix_positif CHECK (prix_reference_unitaire >= 0),
  CONSTRAINT lignes_vente_reduction_valide CHECK (
    reduction_ligne >= 0 AND reduction_ligne <= prix_reference_unitaire * quantite
  ),
  CONSTRAINT lignes_vente_remise_globale_valide CHECK (remise_globale_affectee >= 0),
  -- Interdiction structurelle de la vente a perte
  CONSTRAINT lignes_vente_prix_net_superieur_cmp CHECK (prix_net_unitaire >= cmp_applique),
  CONSTRAINT lignes_vente_cmp_positif CHECK (cmp_applique >= 0)
);

CREATE INDEX lignes_vente_vente_idx ON lignes_vente (vente_id);
CREATE INDEX lignes_vente_produit_idx ON lignes_vente (produit_id);

COMMENT ON COLUMN lignes_vente.cmp_applique IS
  'CMP fige au moment de la vente : il ne change jamais apres coup.';
COMMENT ON CONSTRAINT lignes_vente_prix_net_superieur_cmp ON lignes_vente IS
  'Garantie PostgreSQL : aucune ligne ne peut etre vendue sous son CMP applicable.';

CREATE TABLE reductions_ventes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vente_id        uuid NOT NULL REFERENCES ventes(id) ON DELETE CASCADE,
  type_reduction  type_reduction NOT NULL,
  ligne_vente_id  uuid REFERENCES lignes_vente(id) ON DELETE CASCADE,
  montant         numeric(16,2) NOT NULL,
  motif           text,
  accordee_par    uuid REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cree_le         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reductions_montant_positif CHECK (montant > 0),
  CONSTRAINT reductions_ligne_coherente CHECK (
    (type_reduction = 'LIGNE' AND ligne_vente_id IS NOT NULL)
    OR (type_reduction = 'GLOBALE' AND ligne_vente_id IS NULL)
  )
);

CREATE INDEX reductions_vente_idx ON reductions_ventes (vente_id);
