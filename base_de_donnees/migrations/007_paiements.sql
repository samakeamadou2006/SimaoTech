-- =============================================================================
-- 007 - Paiements
-- =============================================================================

CREATE TABLE paiements (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vente_id              uuid NOT NULL REFERENCES ventes(id) ON DELETE RESTRICT,
  moyen_paiement        moyen_paiement NOT NULL,
  montant               numeric(16,2) NOT NULL,
  reference_transaction text,
  operateur             text,
  utilisateur_id        uuid NOT NULL REFERENCES utilisateurs(id) ON DELETE RESTRICT,
  date_paiement         timestamptz NOT NULL DEFAULT now(),
  cree_le               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT paiements_montant_positif CHECK (montant > 0),
  -- Mobile Money : la reference de transaction saisie manuellement est obligatoire
  CONSTRAINT paiements_reference_mobile_money CHECK (
    moyen_paiement = 'ESPECES'
    OR (reference_transaction IS NOT NULL AND length(btrim(reference_transaction)) >= 4)
  )
);

CREATE INDEX paiements_vente_idx ON paiements (vente_id);
CREATE INDEX paiements_moyen_idx ON paiements (moyen_paiement, date_paiement DESC);

COMMENT ON TABLE paiements IS
  'Paiements d une vente. Le total doit egaler exactement le montant net (controle fn_valider_vente). La reference Mobile Money est saisie manuellement en v1 : aucune confirmation operateur n est simulee.';
