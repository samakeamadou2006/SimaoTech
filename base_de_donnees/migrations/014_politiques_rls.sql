-- =============================================================================
-- 014 - Row Level Security
-- -----------------------------------------------------------------------------
-- Le backend se connecte avec un role proprietaire (service) et applique ses
-- propres controles. Les politiques ci-dessous protegent tout acces direct via
-- les cles publiques Supabase (PostgREST / client anon) : defense en profondeur.
-- Principe : aucune politique = aucun acces.
-- =============================================================================

-- Fonctions d'aide
CREATE OR REPLACE FUNCTION fn_role_courant() RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fonction$
  SELECT r.code
    FROM utilisateurs u
    JOIN roles r ON r.id = u.role_id
   WHERE u.id = auth.uid() AND u.actif AND u.supprime_le IS NULL;
$fonction$;

CREATE OR REPLACE FUNCTION fn_admin_courant() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fonction$
  SELECT coalesce(fn_role_courant() = 'PROPRIETAIRE', false)
      OR coalesce(fn_a_permission(auth.uid(), 'administration.gerer'), false);
$fonction$;

CREATE OR REPLACE FUNCTION fn_permission_courante(p_permission text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fonction$
  SELECT fn_a_permission(auth.uid(), p_permission);
$fonction$;

REVOKE ALL ON FUNCTION fn_role_courant() FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_admin_courant() FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_permission_courante(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_role_courant() TO authenticated;
GRANT EXECUTE ON FUNCTION fn_admin_courant() TO authenticated;
GRANT EXECUTE ON FUNCTION fn_permission_courante(text) TO authenticated;

-- Activation de RLS sur toutes les tables applicatives
DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'roles', 'permissions', 'utilisateurs', 'role_permissions', 'utilisateur_permissions', 'appareils',
    'categories', 'produits', 'historique_prix_produits', 'stocks', 'mouvements_stock',
    'quotas_stock_appareil', 'inventaires', 'lignes_inventaire', 'historique_cout_moyen',
    'fournisseurs', 'approvisionnements', 'lignes_approvisionnement',
    'ventes', 'lignes_vente', 'reductions_ventes', 'paiements',
    'categories_depenses', 'depenses', 'historique_depenses',
    'demandes_annulation', 'historique_annulations',
    'operations_synchronisation', 'conflits_synchronisation',
    'journal_activites', 'parametres'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', v_table);
  END LOOP;
END
$$;

-- --- Referentiels -----------------------------------------------------------
CREATE POLICY roles_lecture ON roles FOR SELECT TO authenticated USING (true);
CREATE POLICY permissions_lecture ON permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY role_permissions_lecture ON role_permissions FOR SELECT TO authenticated USING (true);

CREATE POLICY utilisateur_permissions_lecture ON utilisateur_permissions
  FOR SELECT TO authenticated
  USING (utilisateur_id = auth.uid() OR fn_admin_courant());

-- --- Utilisateurs -----------------------------------------------------------
CREATE POLICY utilisateurs_lecture_soi ON utilisateurs
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR fn_admin_courant());

CREATE POLICY utilisateurs_ecriture_admin ON utilisateurs
  FOR ALL TO authenticated
  USING (fn_permission_courante('utilisateurs.gerer'))
  WITH CHECK (fn_permission_courante('utilisateurs.gerer'));

CREATE POLICY utilisateurs_permissions_ecriture ON utilisateur_permissions
  FOR ALL TO authenticated
  USING (fn_permission_courante('permissions.gerer'))
  WITH CHECK (fn_permission_courante('permissions.gerer'));

CREATE POLICY role_permissions_ecriture ON role_permissions
  FOR ALL TO authenticated
  USING (fn_permission_courante('permissions.gerer'))
  WITH CHECK (fn_permission_courante('permissions.gerer'));

-- --- Appareils --------------------------------------------------------------
CREATE POLICY appareils_lecture ON appareils
  FOR SELECT TO authenticated
  USING (utilisateur_id = auth.uid() OR fn_admin_courant());

CREATE POLICY appareils_gestion ON appareils
  FOR ALL TO authenticated
  USING (fn_permission_courante('appareils.gerer'))
  WITH CHECK (fn_permission_courante('appareils.gerer'));

-- --- Catalogue --------------------------------------------------------------
CREATE POLICY categories_lecture ON categories FOR SELECT TO authenticated USING (true);

CREATE POLICY categories_ecriture ON categories
  FOR ALL TO authenticated
  USING (fn_permission_courante('categories.gerer'))
  WITH CHECK (fn_permission_courante('categories.gerer'));

CREATE POLICY produits_lecture ON produits FOR SELECT TO authenticated USING (true);

CREATE POLICY produits_ecriture ON produits
  FOR ALL TO authenticated
  USING (fn_permission_courante('produits.gerer'))
  WITH CHECK (fn_permission_courante('produits.gerer'));

CREATE POLICY historique_prix_lecture ON historique_prix_produits
  FOR SELECT TO authenticated
  USING (fn_permission_courante('produits.consulter') OR fn_admin_courant());

-- --- Stocks -----------------------------------------------------------------
CREATE POLICY stocks_lecture ON stocks FOR SELECT TO authenticated USING (true);

CREATE POLICY mouvements_lecture ON mouvements_stock
  FOR SELECT TO authenticated
  USING (fn_permission_courante('stocks.consulter') OR fn_admin_courant());

CREATE POLICY inventaires_lecture ON inventaires
  FOR SELECT TO authenticated
  USING (fn_permission_courante('stocks.consulter') OR fn_admin_courant());

CREATE POLICY lignes_inventaire_lecture ON lignes_inventaire
  FOR SELECT TO authenticated
  USING (fn_permission_courante('stocks.consulter') OR fn_admin_courant());

CREATE POLICY historique_cmp_lecture ON historique_cout_moyen
  FOR SELECT TO authenticated
  USING (fn_permission_courante('stocks.consulter') OR fn_admin_courant());

CREATE POLICY quotas_lecture ON quotas_stock_appareil
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM appareils a WHERE a.id = appareil_id AND a.utilisateur_id = auth.uid())
    OR fn_admin_courant()
  );

-- --- Achats -----------------------------------------------------------------
CREATE POLICY fournisseurs_lecture ON fournisseurs
  FOR SELECT TO authenticated
  USING (fn_permission_courante('fournisseurs.gerer') OR fn_admin_courant());

CREATE POLICY fournisseurs_ecriture ON fournisseurs
  FOR ALL TO authenticated
  USING (fn_permission_courante('fournisseurs.gerer'))
  WITH CHECK (fn_permission_courante('fournisseurs.gerer'));

CREATE POLICY appro_lecture ON approvisionnements
  FOR SELECT TO authenticated
  USING (fn_permission_courante('approvisionnements.consulter') OR fn_admin_courant());

CREATE POLICY appro_lignes_lecture ON lignes_approvisionnement
  FOR SELECT TO authenticated
  USING (fn_permission_courante('approvisionnements.consulter') OR fn_admin_courant());

-- --- Ventes -----------------------------------------------------------------
CREATE POLICY ventes_lecture ON ventes
  FOR SELECT TO authenticated
  USING (
    utilisateur_id = auth.uid()
    OR fn_permission_courante('ventes.consulter_toutes')
    OR fn_admin_courant()
  );

CREATE POLICY ventes_creation ON ventes
  FOR INSERT TO authenticated
  WITH CHECK (
    utilisateur_id = auth.uid()
    AND fn_permission_courante('ventes.creer')
  );

CREATE POLICY ventes_maj_brouillon ON ventes
  FOR UPDATE TO authenticated
  USING (utilisateur_id = auth.uid() AND statut = 'BROUILLON')
  WITH CHECK (utilisateur_id = auth.uid());

CREATE POLICY lignes_vente_lecture ON lignes_vente
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM ventes v
     WHERE v.id = vente_id
       AND (v.utilisateur_id = auth.uid()
            OR fn_permission_courante('ventes.consulter_toutes')
            OR fn_admin_courant())
  ));

CREATE POLICY lignes_vente_ecriture ON lignes_vente
  FOR INSERT TO authenticated
  WITH CHECK (
    fn_permission_courante('ventes.creer')
    AND EXISTS (
      SELECT 1 FROM ventes v
       WHERE v.id = vente_id
         AND v.utilisateur_id = auth.uid()
         AND v.statut IN ('BROUILLON', 'EN_ATTENTE_SYNCHRONISATION')
    )
  );

CREATE POLICY reductions_lecture ON reductions_ventes
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM ventes v
     WHERE v.id = vente_id
       AND (v.utilisateur_id = auth.uid()
            OR fn_permission_courante('ventes.consulter_toutes')
            OR fn_admin_courant())
  ));

CREATE POLICY paiements_lecture ON paiements
  FOR SELECT TO authenticated
  USING (
    fn_permission_courante('paiements.consulter')
    OR fn_admin_courant()
    OR EXISTS (SELECT 1 FROM ventes v WHERE v.id = vente_id AND v.utilisateur_id = auth.uid())
  );

-- --- Depenses ---------------------------------------------------------------
CREATE POLICY depenses_lecture ON depenses
  FOR SELECT TO authenticated
  USING (
    utilisateur_id = auth.uid()
    OR fn_permission_courante('depenses.consulter')
    OR fn_admin_courant()
  );

CREATE POLICY depenses_creation ON depenses
  FOR INSERT TO authenticated
  WITH CHECK (
    utilisateur_id = auth.uid()
    AND fn_permission_courante('depenses.creer')
  );

CREATE POLICY historique_depenses_lecture ON historique_depenses
  FOR SELECT TO authenticated
  USING (fn_permission_courante('depenses.consulter') OR fn_admin_courant());

CREATE POLICY categories_depenses_lecture ON categories_depenses FOR SELECT TO authenticated USING (true);

-- --- Annulations ------------------------------------------------------------
CREATE POLICY demandes_lecture ON demandes_annulation
  FOR SELECT TO authenticated
  USING (
    demandeur_id = auth.uid()
    OR fn_permission_courante('ventes.annuler_approuver')
    OR fn_admin_courant()
  );

CREATE POLICY demandes_creation ON demandes_annulation
  FOR INSERT TO authenticated
  WITH CHECK (demandeur_id = auth.uid());

CREATE POLICY historique_annulations_lecture ON historique_annulations
  FOR SELECT TO authenticated
  USING (fn_permission_courante('ventes.annuler_approuver') OR fn_admin_courant());

-- --- Synchronisation --------------------------------------------------------
CREATE POLICY operations_lecture ON operations_synchronisation
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM appareils a WHERE a.id = appareil_id AND a.utilisateur_id = auth.uid())
    OR fn_admin_courant()
  );

CREATE POLICY conflits_lecture ON conflits_synchronisation
  FOR SELECT TO authenticated
  USING (fn_permission_courante('synchronisation.resoudre_conflit') OR fn_admin_courant());

-- --- Journal et parametres --------------------------------------------------
CREATE POLICY journal_lecture ON journal_activites
  FOR SELECT TO authenticated
  USING (fn_permission_courante('journal.consulter') OR fn_admin_courant());

CREATE POLICY parametres_lecture ON parametres FOR SELECT TO authenticated USING (true);

CREATE POLICY parametres_ecriture ON parametres
  FOR ALL TO authenticated
  USING (fn_permission_courante('parametres.gerer'))
  WITH CHECK (fn_permission_courante('parametres.gerer'));
