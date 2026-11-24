-- =============================================================================
-- 004 - Fournisseurs et approvisionnements
-- =============================================================================

CREATE TABLE fournisseurs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  nom         text NOT NULL,
  telephone   text,
  email       citext,
  adresse     text,
  notes       text,
  actif       boolean NOT NULL DEFAULT true,
  cree_le     timestamptz NOT NULL DEFAULT now(),
  modifie_le  timestamptz NOT NULL DEFAULT now(),
  supprime_le timestamptz,
  CONSTRAINT fournisseurs_nom_non_vide CHECK (length(btrim(nom)) >= 2),
  CONSTRAINT fournisseurs_email_format CHECK (email IS NULL OR email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

CREATE UNIQUE INDEX fournisseurs_nom_unique ON fournisseurs (lower(nom)) WHERE supprime_le IS NULL;

CREATE SEQUENCE seq_approvisionnement START 1;

CREATE TABLE approvisionnements (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero                text NOT NULL UNIQUE,
  fournisseur_id        uuid NOT NULL REFERENCES fournisseurs(id) ON DELETE RESTRICT,
  date_approvisionnement timestamptz NOT NULL DEFAULT now(),
  utilisateur_id        uuid NOT NULL REFERENCES utilisateurs(id) ON DELETE RESTRICT,
  montant_brut          numeric(16,2) NOT NULL DEFAULT 0,
  total_reductions      numeric(16,2) NOT NULL DEFAULT 0,
  cout_net              numeric(16,2) NOT NULL DEFAULT 0,
  statut                statut_approvisionnement NOT NULL DEFAULT 'BROUILLON',
  observations          text,
  cle_idempotence       uuid,
  cree_le               timestamptz NOT NULL DEFAULT now(),
  valide_le             timestamptz,
  CONSTRAINT appro_montants_positifs CHECK (
    montant_brut >= 0 AND total_reductions >= 0 AND cout_net >= 0
  ),
  CONSTRAINT appro_reductions_coherentes CHECK (
    total_reductions <= montant_brut AND cout_net = montant_brut - total_reductions
  ),
  CONSTRAINT appro_valide_horodatage CHECK (
    (statut = 'VALIDE' AND valide_le IS NOT NULL)
    OR (statut <> 'VALIDE')
  )
);

CREATE UNIQUE INDEX appro_idempotence_unique ON approvisionnements (cle_idempotence)
  WHERE cle_idempotence IS NOT NULL;
CREATE INDEX appro_fournisseur_idx ON approvisionnements (fournisseur_id, date_approvisionnement DESC);
CREATE INDEX appro_utilisateur_idx ON approvisionnements (utilisateur_id, date_approvisionnement DESC);
CREATE INDEX appro_statut_idx ON approvisionnements (statut);

CREATE TABLE lignes_approvisionnement (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approvisionnement_id uuid NOT NULL REFERENCES approvisionnements(id) ON DELETE CASCADE,
  produit_id           uuid NOT NULL REFERENCES produits(id) ON DELETE RESTRICT,
  quantite             numeric(14,3) NOT NULL,
  prix_achat_unitaire  numeric(16,2) NOT NULL,
  reduction_ligne      numeric(16,2) NOT NULL DEFAULT 0,
  cout_net_ligne       numeric(16,2) NOT NULL DEFAULT 0,
  cout_net_unitaire    numeric(18,6) NOT NULL DEFAULT 0,
  cmp_avant            numeric(18,6) NOT NULL DEFAULT 0,
  cmp_apres            numeric(18,6) NOT NULL DEFAULT 0,
  cree_le              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lignes_appro_quantite_positive CHECK (quantite > 0),
  CONSTRAINT lignes_appro_prix_positif CHECK (prix_achat_unitaire >= 0),
  CONSTRAINT lignes_appro_reduction_valide CHECK (
    reduction_ligne >= 0 AND reduction_ligne <= quantite * prix_achat_unitaire
  ),
  CONSTRAINT lignes_appro_produit_unique UNIQUE (approvisionnement_id, produit_id)
);

CREATE INDEX lignes_appro_produit_idx ON lignes_approvisionnement (produit_id);
