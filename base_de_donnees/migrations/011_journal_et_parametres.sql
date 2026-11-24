-- =============================================================================
-- 011 - Journal d'activite et parametres
-- =============================================================================

CREATE TABLE journal_activites (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  utilisateur_id uuid REFERENCES utilisateurs(id) ON DELETE SET NULL,
  appareil_id    uuid REFERENCES appareils(id) ON DELETE SET NULL,
  action         text NOT NULL,
  module         text NOT NULL,
  entite         text,
  entite_id      uuid,
  details        jsonb NOT NULL DEFAULT '{}'::jsonb,
  adresse_ip     inet,
  requete_id     uuid,
  cree_le        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX journal_periode_idx ON journal_activites (cree_le DESC);
CREATE INDEX journal_utilisateur_idx ON journal_activites (utilisateur_id, cree_le DESC);
CREATE INDEX journal_module_idx ON journal_activites (module, cree_le DESC);
CREATE INDEX journal_entite_idx ON journal_activites (entite, entite_id);

COMMENT ON TABLE journal_activites IS
  'Journal d audit en ajout seul. Toute modification ou suppression est bloquee par declencheur.';

CREATE TABLE parametres (
  cle         text PRIMARY KEY,
  valeur      jsonb NOT NULL,
  description text,
  modifie_par uuid REFERENCES utilisateurs(id) ON DELETE SET NULL,
  modifie_le  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT parametres_cle_format CHECK (cle ~ '^[a-z0-9_]+\.[a-z0-9_]+$')
);

COMMENT ON TABLE parametres IS
  'Parametres applicatifs (boutique, devise, recus, synchronisation) au format cle.valeur.';
