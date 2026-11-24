-- =============================================================================
-- 017 - Restriction des fonctions RPC SECURITY DEFINER
-- -----------------------------------------------------------------------------
-- Les fonctions internes ne sont pas un endpoint PostgREST. Les privileges
-- EXECUTE par defaut de Supabase donnent acces a anon/authenticated/service_role
-- et PUBLIC ; ils sont retires pour les fonctions metier SECURITY DEFINER.
-- Les trois helpers necessaires aux politiques RLS restent accessibles a
-- authenticated. Le backend se connecte avec son role PostgreSQL privilegie.
-- =============================================================================

DO $$
DECLARE
  v_fonction regprocedure;
BEGIN
  FOR v_fonction IN
    SELECT p.oid::regprocedure
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef
       AND left(p.proname, 3) = 'fn_'
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',
      v_fonction
    );
  END LOOP;
END
$$;

GRANT EXECUTE ON FUNCTION fn_role_courant() TO authenticated;
GRANT EXECUTE ON FUNCTION fn_admin_courant() TO authenticated;
GRANT EXECUTE ON FUNCTION fn_permission_courante(text) TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
