-- =============================================================================
-- 000 - Compatibilite Supabase / PostgreSQL local
-- -----------------------------------------------------------------------------
-- Ces objets existent deja sur Supabase. Les blocs DO ne les creent que s'ils
-- sont absents, ce qui permet d'executer les migrations sur une base
-- PostgreSQL locale (tests) sans modifier le comportement de Supabase.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- Schema d'authentification (fourni par Supabase Auth en production)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
    CREATE SCHEMA auth;
  END IF;
END
$$;

-- Table miroir minimale des comptes d'authentification
DO $$
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    CREATE TABLE auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    COMMENT ON TABLE auth.users IS
      'Substitut local de Supabase Auth : utilise uniquement pour les tests et le developpement.';
  END IF;
END
$$;

-- Fonction auth.uid() (fournie par Supabase en production)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'auth' AND p.proname = 'uid'
  ) THEN
    CREATE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE
    AS $fonction$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $fonction$;
  END IF;
END
$$;

-- Roles utilises par les politiques RLS de Supabase
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO authenticated, service_role;

-- Table de suivi des migrations (creee aussi par le script de migration)
CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  nom_fichier text NOT NULL,
  appliquee_le timestamptz NOT NULL DEFAULT now(),
  duree_ms integer
);

COMMENT ON TABLE schema_migrations IS 'Journal des migrations SQL appliquees.';
