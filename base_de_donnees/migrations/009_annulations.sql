-- =============================================================================
-- 009 - Annulations de ventes
-- -----------------------------------------------------------------------------
-- Une annulation ne supprime jamais la vente : elle cree une demande tracee,
-- puis une decision. Les mouvements de stock inverses sont enregistres par
-- fn_approuver_annulation.
-- =============================================================================

CREATE TABLE demandes_annulation (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vente_id    uuid NOT NULL REFERENCES ventes(id) ON DELETE RESTRICT,
  demandeur_id uuid NOT NULL REFERENCES utilisateurs(id) ON DELETE RESTRICT,
  motif       text NOT NULL,
  statut      statut_demande_annulation NOT NULL DEFAULT 'EN_ATTENTE',
  decideur_id uuid REFERENCES utilisateurs(id) ON DELETE SET NULL,
  decide_le   timestamptz,
  commentaire_decision text,
  cree_le     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT demandes_motif_non_vide CHECK (length(btrim(motif)) >= 5),
  CONSTRAINT demandes_decision_coherente CHECK (
    (statut = 'EN_ATTENTE' AND decideur_id IS NULL AND decide_le IS NULL)
    OR (statut IN ('APPROUVEE', 'REJETEE') AND decideur_id IS NOT NULL AND decide_le IS NOT NULL)
  )
);

-- Une seule demande en attente par vente
CREATE UNIQUE INDEX demandes_annulation_en_attente
  ON demandes_annulation (vente_id) WHERE statut = 'EN_ATTENTE';
CREATE INDEX demandes_annulation_statut_idx ON demandes_annulation (statut, cree_le DESC);

CREATE TABLE historique_annulations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vente_id       uuid NOT NULL REFERENCES ventes(id) ON DELETE RESTRICT,
  demande_id     uuid REFERENCES demandes_annulation(id) ON DELETE SET NULL,
  action         text NOT NULL,
  utilisateur_id uuid REFERENCES utilisateurs(id) ON DELETE SET NULL,
  details        jsonb NOT NULL DEFAULT '{}'::jsonb,
  cree_le        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX historique_annulations_vente_idx ON historique_annulations (vente_id, cree_le DESC);

COMMENT ON TABLE historique_annulations IS
  'Piste d audit complete des demandes, approbations et refus d annulation.';
