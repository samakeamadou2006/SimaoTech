-- =============================================================================
-- 010 - Synchronisation multi-appareils
-- =============================================================================

CREATE TABLE operations_synchronisation (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appareil_id      uuid NOT NULL REFERENCES appareils(id) ON DELETE RESTRICT,
  utilisateur_id   uuid NOT NULL REFERENCES utilisateurs(id) ON DELETE RESTRICT,
  type_operation   text NOT NULL,
  entite           text NOT NULL,
  entite_id        uuid,
  cle_idempotence  uuid NOT NULL,
  charge_utile     jsonb NOT NULL,
  statut           statut_operation_sync NOT NULL DEFAULT 'RECUE',
  message          text,
  resultat         jsonb,
  recue_le         timestamptz NOT NULL DEFAULT now(),
  traitee_le       timestamptz,
  CONSTRAINT operations_type_non_vide CHECK (length(btrim(type_operation)) >= 3)
);

CREATE UNIQUE INDEX operations_idempotence_unique
  ON operations_synchronisation (cle_idempotence);
CREATE INDEX operations_appareil_idx
  ON operations_synchronisation (appareil_id, recue_le DESC);
CREATE INDEX operations_statut_idx
  ON operations_synchronisation (statut) WHERE statut IN ('RECUE', 'ECHEC', 'CONFLIT');

COMMENT ON TABLE operations_synchronisation IS
  'Registre idempotent des operations recues des appareils. Une cle deja connue renvoie le resultat initial sans reexecution.';

CREATE TABLE conflits_synchronisation (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id   uuid NOT NULL REFERENCES operations_synchronisation(id) ON DELETE RESTRICT,
  type_conflit   text NOT NULL,
  description    text NOT NULL,
  donnees        jsonb NOT NULL DEFAULT '{}'::jsonb,
  statut         statut_conflit NOT NULL DEFAULT 'OUVERT',
  resolu_par     uuid REFERENCES utilisateurs(id) ON DELETE SET NULL,
  resolu_le      timestamptz,
  resolution     text,
  cree_le        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conflits_resolution_coherente CHECK (
    (statut IN ('RESOLU', 'REJETE') AND resolu_par IS NOT NULL AND resolu_le IS NOT NULL)
    OR statut IN ('OUVERT', 'EN_COURS')
  )
);

CREATE INDEX conflits_statut_idx ON conflits_synchronisation (statut, cree_le DESC);

COMMENT ON TABLE conflits_synchronisation IS
  'Conflits conserves sans suppression automatique ; resolution manuelle par un utilisateur autorise.';
