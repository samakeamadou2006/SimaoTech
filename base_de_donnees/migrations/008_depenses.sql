-- =============================================================================
-- 008 - Depenses
-- =============================================================================

CREATE TABLE categories_depenses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  nom         text NOT NULL,
  description text,
  actif       boolean NOT NULL DEFAULT true,
  cree_le     timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE seq_depense START 1;

CREATE TABLE depenses (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero           text NOT NULL UNIQUE,
  categorie_id     uuid NOT NULL REFERENCES categories_depenses(id) ON DELETE RESTRICT,
  montant          numeric(16,2) NOT NULL,
  date_depense     timestamptz NOT NULL DEFAULT now(),
  description      text NOT NULL,
  justificatif_url text,
  utilisateur_id   uuid NOT NULL REFERENCES utilisateurs(id) ON DELETE RESTRICT,
  statut           statut_depense NOT NULL DEFAULT 'EN_ATTENTE',
  cle_idempotence  uuid,
  valide_par       uuid REFERENCES utilisateurs(id) ON DELETE SET NULL,
  valide_le        timestamptz,
  motif_rejet      text,
  cree_le          timestamptz NOT NULL DEFAULT now(),
  modifie_le       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT depenses_montant_positif CHECK (montant > 0),
  CONSTRAINT depenses_description_non_vide CHECK (length(btrim(description)) >= 3),
  CONSTRAINT depenses_validation_coherente CHECK (
    (statut = 'VALIDEE' AND valide_par IS NOT NULL AND valide_le IS NOT NULL)
    OR (statut = 'REJETEE' AND motif_rejet IS NOT NULL)
    OR statut IN ('EN_ATTENTE', 'ANNULEE')
  )
);

CREATE UNIQUE INDEX depenses_idempotence_unique ON depenses (cle_idempotence)
  WHERE cle_idempotence IS NOT NULL;
CREATE INDEX depenses_periode_idx ON depenses (date_depense DESC);
CREATE INDEX depenses_statut_idx ON depenses (statut);
CREATE INDEX depenses_categorie_idx ON depenses (categorie_id);

CREATE TABLE historique_depenses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  depense_id     uuid NOT NULL REFERENCES depenses(id) ON DELETE RESTRICT,
  statut_avant   statut_depense,
  statut_apres   statut_depense NOT NULL,
  utilisateur_id uuid REFERENCES utilisateurs(id) ON DELETE SET NULL,
  commentaire    text,
  cree_le        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX historique_depenses_idx ON historique_depenses (depense_id, cree_le DESC);

COMMENT ON TABLE depenses IS
  'Depense de fonctionnement. Les charges validees sont seules deduites du benefice net de gestion.';

CREATE TRIGGER trg_depenses_modifie_le
  BEFORE UPDATE ON depenses
  FOR EACH ROW EXECUTE FUNCTION fn_maj_modifie_le();
