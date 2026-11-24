-- =============================================================================
-- 002 - Utilisateurs, roles, permissions, appareils
-- =============================================================================

CREATE TABLE roles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE,
  nom           text NOT NULL,
  description   text,
  est_systeme   boolean NOT NULL DEFAULT false,
  cree_le       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roles_code_majuscules CHECK (code = upper(code))
);

COMMENT ON TABLE roles IS 'Roles applicatifs : PROPRIETAIRE, ADMINISTRATEUR, EMPLOYE.';

CREATE TABLE permissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  nom         text NOT NULL,
  module      text NOT NULL,
  description text,
  cree_le     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT permissions_code_format CHECK (code ~ '^[a-z_]+\.[a-z_]+$')
);

COMMENT ON TABLE permissions IS 'Catalogue des permissions unitaires verifiees cote serveur.';

CREATE TABLE utilisateurs (
  id                    uuid PRIMARY KEY,
  email                 citext NOT NULL,
  nom_complet           text NOT NULL,
  telephone             text,
  role_id               uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  actif                 boolean NOT NULL DEFAULT true,
  doit_changer_mot_de_passe boolean NOT NULL DEFAULT false,
  derniere_connexion    timestamptz,
  cree_le               timestamptz NOT NULL DEFAULT now(),
  modifie_le            timestamptz NOT NULL DEFAULT now(),
  supprime_le           timestamptz,
  CONSTRAINT utilisateurs_email_format CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  CONSTRAINT utilisateurs_nom_non_vide CHECK (length(btrim(nom_complet)) >= 2)
);

COMMENT ON TABLE utilisateurs IS
  'Profil applicatif rattache a un compte auth.users (Supabase Auth). Aucun mot de passe stocke ici.';

CREATE UNIQUE INDEX utilisateurs_email_unique ON utilisateurs (lower(email)) WHERE supprime_le IS NULL;
CREATE INDEX utilisateurs_role_idx ON utilisateurs (role_id) WHERE supprime_le IS NULL;

CREATE TABLE role_permissions (
  role_id       uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  cree_le       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE utilisateur_permissions (
  utilisateur_id uuid NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  permission_id  uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  accorde        boolean NOT NULL,
  accorde_par    uuid REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cree_le        timestamptz NOT NULL DEFAULT now(),
  modifie_le     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (utilisateur_id, permission_id)
);

COMMENT ON TABLE utilisateur_permissions IS
  'Derogations individuelles : accorde = true ajoute une permission, false la retire au role.';

CREATE TABLE appareils (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                    text NOT NULL UNIQUE,
  nom                     text NOT NULL,
  plateforme              text,
  utilisateur_id          uuid REFERENCES utilisateurs(id) ON DELETE SET NULL,
  actif                   boolean NOT NULL DEFAULT true,
  derniere_synchronisation timestamptz,
  cree_le                 timestamptz NOT NULL DEFAULT now(),
  modifie_le              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appareils_code_non_vide CHECK (length(btrim(code)) >= 3)
);

COMMENT ON TABLE appareils IS
  'Appareils autorises a se synchroniser. Un appareil peut etre revoque (actif = false).';

CREATE INDEX appareils_utilisateur_idx ON appareils (utilisateur_id) WHERE actif;

CREATE TRIGGER trg_utilisateurs_modifie_le
  BEFORE UPDATE ON utilisateurs
  FOR EACH ROW EXECUTE FUNCTION fn_maj_modifie_le();

CREATE TRIGGER trg_appareils_modifie_le
  BEFORE UPDATE ON appareils
  FOR EACH ROW EXECUTE FUNCTION fn_maj_modifie_le();

CREATE TRIGGER trg_utilisateur_permissions_modifie_le
  BEFORE UPDATE ON utilisateur_permissions
  FOR EACH ROW EXECUTE FUNCTION fn_maj_modifie_le();
