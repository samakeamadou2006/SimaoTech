-- =============================================================================
-- 012 - Fonctions metier transactionnelles
-- -----------------------------------------------------------------------------
-- Toutes les operations qui touchent plusieurs tables sont atomiques : si une
-- exception est levee, PostgreSQL annule l'ensemble de l'operation.
-- Les fonctions verifient elles-memes les permissions : un appel direct ne
-- peut pas contourner les regles.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Permissions
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_a_permission(p_utilisateur_id uuid, p_permission text)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fonction$
  SELECT EXISTS (
    SELECT 1
      FROM utilisateurs u
      JOIN roles r ON r.id = u.role_id
     WHERE u.id = p_utilisateur_id
       AND u.actif
       AND u.supprime_le IS NULL
       AND (
         r.code = 'PROPRIETAIRE'
         OR EXISTS (
           SELECT 1
             FROM permissions p
             JOIN role_permissions rp ON rp.permission_id = p.id
            WHERE rp.role_id = u.role_id AND p.code = p_permission
              AND NOT EXISTS (
                SELECT 1 FROM utilisateur_permissions up
                 JOIN permissions p2 ON p2.id = up.permission_id
                WHERE up.utilisateur_id = u.id AND up.accorde = false AND p2.code = p_permission
              )
         )
         OR EXISTS (
           SELECT 1
             FROM permissions p
             JOIN utilisateur_permissions up ON up.permission_id = p.id
            WHERE up.utilisateur_id = u.id AND up.accorde = true AND p.code = p_permission
         )
       )
  );
$fonction$;

CREATE OR REPLACE FUNCTION fn_exiger_permission(p_utilisateur_id uuid, p_permission text)
  RETURNS void
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fonction$
BEGIN
  IF p_utilisateur_id IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_REFUSEE:utilisateur absent';
  END IF;
  IF NOT fn_a_permission(p_utilisateur_id, p_permission) THEN
    RAISE EXCEPTION 'PERMISSION_REFUSEE:%', p_permission;
  END IF;
END
$fonction$;

-- -----------------------------------------------------------------------------
-- Journalisation interne (utilisee par les fonctions metier)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_journaliser(
  p_utilisateur_id uuid,
  p_action text,
  p_module text,
  p_entite text DEFAULT NULL,
  p_entite_id uuid DEFAULT NULL,
  p_details jsonb DEFAULT '{}'::jsonb,
  p_appareil_id uuid DEFAULT NULL
) RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fonction$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO journal_activites (utilisateur_id, appareil_id, action, module, entite, entite_id, details)
  VALUES (p_utilisateur_id, p_appareil_id, p_action, p_module, p_entite, p_entite_id, coalesce(p_details, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END
$fonction$;

-- -----------------------------------------------------------------------------
-- Mouvement de stock unitaire
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_enregistrer_mouvement_stock(
  p_produit_id uuid,
  p_type type_mouvement_stock,
  p_quantite numeric,
  p_utilisateur_id uuid,
  p_motif text DEFAULT NULL,
  p_reference_type text DEFAULT NULL,
  p_reference_id uuid DEFAULT NULL,
  p_appareil_id uuid DEFAULT NULL,
  p_cout_unitaire numeric DEFAULT NULL
) RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fonction$
DECLARE
  v_stock stocks%ROWTYPE;
  v_avant numeric(14,3);
  v_apres numeric(14,3);
  v_id uuid;
BEGIN
  IF p_quantite = 0 THEN
    RAISE EXCEPTION 'QUANTITE_INVALIDE';
  END IF;

  SELECT * INTO v_stock FROM stocks WHERE produit_id = p_produit_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'STOCK_INTROUVABLE:%', p_produit_id;
  END IF;

  v_avant := v_stock.quantite_disponible;
  v_apres := v_avant + p_quantite;

  IF v_apres < 0 THEN
    RAISE EXCEPTION 'STOCK_INSUFFISANT:%', p_produit_id;
  END IF;

  UPDATE stocks
     SET quantite_disponible = v_apres,
         mis_a_jour_le = now()
   WHERE id = v_stock.id;

  INSERT INTO mouvements_stock (
    produit_id, type_mouvement, quantite, stock_avant, stock_apres,
    cout_unitaire, valeur_mouvement, reference_type, reference_id,
    utilisateur_id, appareil_id, motif
  ) VALUES (
    p_produit_id, p_type, p_quantite, v_avant, v_apres,
    p_cout_unitaire, fn_arrondir_montant(abs(p_quantite) * coalesce(p_cout_unitaire, 0)),
    p_reference_type, p_reference_id, p_utilisateur_id, p_appareil_id, p_motif
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END
$fonction$;

-- -----------------------------------------------------------------------------
-- Recalcul des totaux d'une vente depuis ses lignes (source de verite)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_recalculer_totaux_vente(p_vente_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fonction$
DECLARE
  v_brut numeric(16,2);
  v_net numeric(16,2);
  v_cout numeric(16,2);
BEGIN
  SELECT
    coalesce(sum(round(l.prix_reference_unitaire * l.quantite, 2)), 0),
    coalesce(sum(round(l.prix_net_unitaire * l.quantite, 2)), 0),
    coalesce(sum(l.cout_total_ligne), 0)
  INTO v_brut, v_net, v_cout
  FROM lignes_vente l
  WHERE l.vente_id = p_vente_id;

  UPDATE ventes
     SET montant_brut = v_brut,
         montant_net = v_net,
         total_reductions = v_brut - v_net,
         cout_total = v_cout,
         benefice_brut = v_net - v_cout
   WHERE id = p_vente_id
     AND statut IN ('BROUILLON', 'EN_ATTENTE_SYNCHRONISATION', 'ANOMALIE');
END
$fonction$;

-- -----------------------------------------------------------------------------
-- Validation d'un approvisionnement
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_valider_approvisionnement(
  p_approvisionnement_id uuid,
  p_utilisateur_id uuid
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fonction$
DECLARE
  v_appro approvisionnements%ROWTYPE;
  v_ligne record;
  v_stock stocks%ROWTYPE;
  v_cmp_avant numeric(18,6);
  v_cmp_apres numeric(18,6);
  v_cout_net_ligne numeric(16,2);
  v_cout_unitaire numeric(18,6);
  v_brut numeric(16,2) := 0;
  v_reductions numeric(16,2) := 0;
  v_net numeric(16,2) := 0;
  v_nb_lignes integer := 0;
BEGIN
  PERFORM fn_exiger_permission(p_utilisateur_id, 'approvisionnements.valider');

  -- Autorise la mise a jour du CMP pendant cette transaction uniquement.
  PERFORM set_config('simaotech.maj_cmp', 'on', true);

  SELECT * INTO v_appro FROM approvisionnements WHERE id = p_approvisionnement_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'APPROVISIONNEMENT_INTROUVABLE:%', p_approvisionnement_id;
  END IF;
  IF v_appro.statut = 'VALIDE' THEN
    RETURN jsonb_build_object('deja_valide', true, 'approvisionnement_id', v_appro.id);
  END IF;
  IF v_appro.statut <> 'BROUILLON' THEN
    RAISE EXCEPTION 'STATUT_APPROVISIONNEMENT_INVALIDE:%', v_appro.statut;
  END IF;

  -- Verification des lignes AVANT toute ecriture (aucun stock partiel)
  FOR v_ligne IN
    SELECT * FROM lignes_approvisionnement
     WHERE approvisionnement_id = p_approvisionnement_id
     ORDER BY id
  LOOP
    v_nb_lignes := v_nb_lignes + 1;

    IF v_ligne.quantite <= 0 THEN
      RAISE EXCEPTION 'QUANTITE_INVALIDE:%', v_ligne.produit_id;
    END IF;
    IF v_ligne.reduction_ligne > v_ligne.quantite * v_ligne.prix_achat_unitaire THEN
      RAISE EXCEPTION 'REDUCTION_INVALIDE:%', v_ligne.produit_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM produits WHERE id = v_ligne.produit_id AND supprime_le IS NULL) THEN
      RAISE EXCEPTION 'PRODUIT_INTROUVABLE:%', v_ligne.produit_id;
    END IF;
  END LOOP;

  IF v_nb_lignes = 0 THEN
    RAISE EXCEPTION 'APPROVISIONNEMENT_VIDE';
  END IF;

  FOR v_ligne IN
    SELECT * FROM lignes_approvisionnement
     WHERE approvisionnement_id = p_approvisionnement_id
     ORDER BY id
  LOOP
    v_cout_net_ligne := fn_arrondir_montant(
      (v_ligne.quantite * v_ligne.prix_achat_unitaire) - v_ligne.reduction_ligne
    );
    v_cout_unitaire := round(v_cout_net_ligne / v_ligne.quantite, 6);

    SELECT * INTO v_stock FROM stocks WHERE produit_id = v_ligne.produit_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'STOCK_INTROUVABLE:%', v_ligne.produit_id;
    END IF;

    SELECT cout_moyen_pondere INTO v_cmp_avant FROM produits WHERE id = v_ligne.produit_id;
    v_cmp_apres := fn_cmp(v_stock.quantite_disponible, v_cmp_avant, v_ligne.quantite, v_cout_unitaire);

    UPDATE produits
       SET cout_moyen_pondere = v_cmp_apres,
           modifie_le = now()
     WHERE id = v_ligne.produit_id;

    -- Le mouvement d'entree met a jour le stock et la valeur du stock (le
    -- declencheur trg_stocks_coherence recalcule valeur_stock avec le CMP).
    UPDATE lignes_approvisionnement
       SET cout_net_ligne = v_cout_net_ligne,
           cout_net_unitaire = v_cout_unitaire,
           cmp_avant = v_cmp_avant,
           cmp_apres = v_cmp_apres
     WHERE id = v_ligne.id;

    INSERT INTO historique_cout_moyen (
      produit_id, cmp_avant, cmp_apres, quantite_avant, quantite_entree,
      cout_unitaire_entree, source_type, source_id, utilisateur_id
    ) VALUES (
      v_ligne.produit_id, v_cmp_avant, v_cmp_apres, v_stock.quantite_disponible,
      v_ligne.quantite, v_cout_unitaire, 'APPROVISIONNEMENT', v_appro.id, p_utilisateur_id
    );

    PERFORM fn_enregistrer_mouvement_stock(
      v_ligne.produit_id,
      'ENTREE_APPROVISIONNEMENT',
      v_ligne.quantite,
      p_utilisateur_id,
      'Approvisionnement ' || v_appro.numero,
      'APPROVISIONNEMENT',
      v_appro.id,
      NULL,
      v_cout_unitaire
    );

    v_brut := v_brut + fn_arrondir_montant(v_ligne.quantite * v_ligne.prix_achat_unitaire);
    v_reductions := v_reductions + v_ligne.reduction_ligne;
    v_net := v_net + v_cout_net_ligne;
  END LOOP;

  UPDATE approvisionnements
     SET montant_brut = v_brut,
         total_reductions = v_reductions,
         cout_net = v_net,
         statut = 'VALIDE',
         valide_le = now()
   WHERE id = v_appro.id;

  PERFORM fn_journaliser(
    p_utilisateur_id, 'VALIDATION', 'approvisionnements',
    'approvisionnements', v_appro.id,
    jsonb_build_object('numero', v_appro.numero, 'cout_net', v_net, 'lignes', v_nb_lignes)
  );

  RETURN jsonb_build_object(
    'approvisionnement_id', v_appro.id,
    'numero', v_appro.numero,
    'montant_brut', v_brut,
    'total_reductions', v_reductions,
    'cout_net', v_net,
    'lignes', v_nb_lignes
  );
END
$fonction$;

-- -----------------------------------------------------------------------------
-- Validation d'une vente
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_valider_vente(
  p_vente_id uuid,
  p_utilisateur_id uuid
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fonction$
DECLARE
  v_vente ventes%ROWTYPE;
  v_ligne record;
  v_stock stocks%ROWTYPE;
  v_paiements numeric(16,2);
  v_net numeric(16,2);
  v_cout numeric(16,2);
  v_brut numeric(16,2);
  v_benefice numeric(16,2);
  v_nb integer := 0;
BEGIN
  PERFORM fn_exiger_permission(p_utilisateur_id, 'ventes.creer');

  SELECT * INTO v_vente FROM ventes WHERE id = p_vente_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VENTE_INTROUVABLE:%', p_vente_id;
  END IF;

  -- Idempotence : une vente deja validee n'est jamais rejouee
  IF v_vente.statut = 'VALIDEE' THEN
    RETURN jsonb_build_object('deja_validee', true, 'vente_id', v_vente.id, 'numero', v_vente.numero);
  END IF;
  IF v_vente.statut NOT IN ('BROUILLON', 'EN_ATTENTE_SYNCHRONISATION') THEN
    RAISE EXCEPTION 'STATUT_VENTE_INVALIDE:%', v_vente.statut;
  END IF;

  -- 1. Controle des lignes et du seuil de rentabilite
  FOR v_ligne IN
    SELECT l.*, p.nom AS produit_nom
      FROM lignes_vente l
      JOIN produits p ON p.id = l.produit_id
     WHERE l.vente_id = p_vente_id
     ORDER BY l.id
  LOOP
    v_nb := v_nb + 1;
    IF v_ligne.quantite <= 0 THEN
      RAISE EXCEPTION 'QUANTITE_INVALIDE:%', v_ligne.produit_id;
    END IF;
    IF v_ligne.prix_net_unitaire < v_ligne.cmp_applique THEN
      RAISE EXCEPTION 'VENTE_A_PERTE:%', v_ligne.produit_id;
    END IF;
  END LOOP;

  IF v_nb = 0 THEN
    RAISE EXCEPTION 'VENTE_VIDE';
  END IF;

  -- 2. Recalcul serveur des totaux (le client n'est jamais cru)
  PERFORM fn_recalculer_totaux_vente(p_vente_id);
  SELECT montant_brut, montant_net, cout_total, benefice_brut
    INTO v_brut, v_net, v_cout, v_benefice
    FROM ventes WHERE id = p_vente_id;

  -- 3. Controle des paiements : total exactement egal au montant net
  SELECT coalesce(sum(montant), 0) INTO v_paiements FROM paiements WHERE vente_id = p_vente_id;
  IF v_paiements <> v_net THEN
    RAISE EXCEPTION 'PAIEMENT_NON_CONFORME:%', v_paiements;
  END IF;

  -- 4. Decrement de stock et mouvements (les lignes sont verrouillees)
  FOR v_ligne IN
    SELECT * FROM lignes_vente WHERE vente_id = p_vente_id ORDER BY id
  LOOP
    SELECT * INTO v_stock FROM stocks WHERE produit_id = v_ligne.produit_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'STOCK_INTROUVABLE:%', v_ligne.produit_id;
    END IF;
    IF v_stock.quantite_disponible < v_ligne.quantite THEN
      RAISE EXCEPTION 'STOCK_INSUFFISANT:%', v_ligne.produit_id;
    END IF;

    PERFORM fn_enregistrer_mouvement_stock(
      v_ligne.produit_id,
      'SORTIE_VENTE',
      -v_ligne.quantite,
      p_utilisateur_id,
      'Vente ' || v_vente.numero,
      'VENTE',
      v_vente.id,
      v_vente.appareil_id,
      v_ligne.cmp_applique
    );
  END LOOP;

  -- 5. Statut definitif
  UPDATE ventes
     SET statut = 'VALIDEE',
         valide_le = now(),
         montant_brut = v_brut,
         montant_net = v_net,
         total_reductions = v_brut - v_net,
         cout_total = v_cout,
         benefice_brut = v_benefice,
         motif_anomalie = NULL,
         statut_synchronisation = CASE
           WHEN statut_synchronisation = 'LOCALE' THEN 'SYNCHRONISEE'
           ELSE statut_synchronisation
         END
   WHERE id = p_vente_id;

  PERFORM fn_journaliser(
    p_utilisateur_id, 'VALIDATION', 'ventes', 'ventes', v_vente.id,
    jsonb_build_object(
      'numero', v_vente.numero,
      'montant_net', v_net,
      'benefice_brut', v_benefice,
      'paiements', v_paiements
    ),
    v_vente.appareil_id
  );

  RETURN jsonb_build_object(
    'vente_id', v_vente.id,
    'numero', v_vente.numero,
    'montant_brut', v_brut,
    'montant_net', v_net,
    'total_reductions', v_brut - v_net,
    'cout_total', v_cout,
    'benefice_brut', v_benefice,
    'paiements', v_paiements
  );
END
$fonction$;

-- -----------------------------------------------------------------------------
-- Demandes et traitement des annulations
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_creer_demande_annulation(
  p_vente_id uuid,
  p_demandeur_id uuid,
  p_motif text
) RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fonction$
DECLARE
  v_vente ventes%ROWTYPE;
  v_id uuid;
BEGIN
  IF length(btrim(coalesce(p_motif, ''))) < 5 THEN
    RAISE EXCEPTION 'MOTIF_INVALIDE';
  END IF;

  SELECT * INTO v_vente FROM ventes WHERE id = p_vente_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VENTE_INTROUVABLE:%', p_vente_id;
  END IF;
  IF v_vente.statut = 'ANNULEE' THEN
    RAISE EXCEPTION 'VENTE_DEJA_ANNULEE:%', p_vente_id;
  END IF;
  IF v_vente.statut <> 'VALIDEE' THEN
    RAISE EXCEPTION 'STATUT_VENTE_INVALIDE:%', v_vente.statut;
  END IF;

  -- Le demandeur doit etre l'auteur de la vente, ou disposer du droit de demander
  IF v_vente.utilisateur_id <> p_demandeur_id
     AND NOT fn_a_permission(p_demandeur_id, 'ventes.annuler_demander')
     AND NOT fn_a_permission(p_demandeur_id, 'ventes.annuler_approuver') THEN
    RAISE EXCEPTION 'PERMISSION_REFUSEE:ventes.annuler_demander';
  END IF;

  INSERT INTO demandes_annulation (vente_id, demandeur_id, motif)
  VALUES (p_vente_id, p_demandeur_id, btrim(p_motif))
  RETURNING id INTO v_id;

  INSERT INTO historique_annulations (vente_id, demande_id, action, utilisateur_id, details)
  VALUES (p_vente_id, v_id, 'DEMANDE', p_demandeur_id, jsonb_build_object('motif', btrim(p_motif)));

  PERFORM fn_journaliser(p_demandeur_id, 'DEMANDE_ANNULATION', 'ventes', 'ventes', p_vente_id,
    jsonb_build_object('demande_id', v_id, 'motif', btrim(p_motif)));

  RETURN v_id;
END
$fonction$;

CREATE OR REPLACE FUNCTION fn_approuver_annulation(
  p_demande_id uuid,
  p_decideur_id uuid,
  p_commentaire text DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fonction$
DECLARE
  v_demande demandes_annulation%ROWTYPE;
  v_vente ventes%ROWTYPE;
  v_ligne record;
  v_unites numeric(14,3) := 0;
BEGIN
  -- Seul le proprietaire ou un porteur de la permission peut approuver
  IF NOT fn_a_permission(p_decideur_id, 'ventes.annuler_approuver') THEN
    RAISE EXCEPTION 'ANNULATION_NON_AUTORISEE';
  END IF;

  SELECT * INTO v_demande FROM demandes_annulation WHERE id = p_demande_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DEMANDE_INTROUVABLE:%', p_demande_id;
  END IF;
  IF v_demande.statut <> 'EN_ATTENTE' THEN
    RAISE EXCEPTION 'DEMANDE_DEJA_TRAITEE:%', v_demande.statut;
  END IF;

  SELECT * INTO v_vente FROM ventes WHERE id = v_demande.vente_id FOR UPDATE;
  IF v_vente.statut = 'ANNULEE' THEN
    RAISE EXCEPTION 'VENTE_DEJA_ANNULEE:%', v_vente.id;
  END IF;
  IF v_vente.statut <> 'VALIDEE' THEN
    RAISE EXCEPTION 'STATUT_VENTE_INVALIDE:%', v_vente.statut;
  END IF;

  FOR v_ligne IN SELECT * FROM lignes_vente WHERE vente_id = v_vente.id ORDER BY id
  LOOP
    PERFORM fn_enregistrer_mouvement_stock(
      v_ligne.produit_id,
      'RETOUR_ANNULATION',
      v_ligne.quantite,
      p_decideur_id,
      'Annulation vente ' || v_vente.numero,
      'VENTE',
      v_vente.id,
      v_vente.appareil_id,
      v_ligne.cmp_applique
    );
    v_unites := v_unites + v_ligne.quantite;
  END LOOP;

  UPDATE ventes SET statut = 'ANNULEE', annule_le = now() WHERE id = v_vente.id;

  UPDATE demandes_annulation
     SET statut = 'APPROUVEE',
         decideur_id = p_decideur_id,
         decide_le = now(),
         commentaire_decision = p_commentaire
   WHERE id = v_demande.id;

  INSERT INTO historique_annulations (vente_id, demande_id, action, utilisateur_id, details)
  VALUES (v_vente.id, v_demande.id, 'APPROBATION', p_decideur_id,
    jsonb_build_object('unites_reintegrees', v_unites, 'commentaire', p_commentaire));

  PERFORM fn_journaliser(p_decideur_id, 'APPROBATION_ANNULATION', 'ventes', 'ventes', v_vente.id,
    jsonb_build_object('demande_id', v_demande.id, 'unites', v_unites, 'montant_net', v_vente.montant_net));

  RETURN jsonb_build_object(
    'vente_id', v_vente.id,
    'demande_id', v_demande.id,
    'statut', 'ANNULEE',
    'unites_reintegrees', v_unites
  );
END
$fonction$;

CREATE OR REPLACE FUNCTION fn_rejeter_annulation(
  p_demande_id uuid,
  p_decideur_id uuid,
  p_commentaire text
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fonction$
DECLARE
  v_demande demandes_annulation%ROWTYPE;
BEGIN
  IF NOT fn_a_permission(p_decideur_id, 'ventes.annuler_approuver') THEN
    RAISE EXCEPTION 'ANNULATION_NON_AUTORISEE';
  END IF;
  IF length(btrim(coalesce(p_commentaire, ''))) < 3 THEN
    RAISE EXCEPTION 'MOTIF_INVALIDE';
  END IF;

  SELECT * INTO v_demande FROM demandes_annulation WHERE id = p_demande_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DEMANDE_INTROUVABLE:%', p_demande_id;
  END IF;
  IF v_demande.statut <> 'EN_ATTENTE' THEN
    RAISE EXCEPTION 'DEMANDE_DEJA_TRAITEE:%', v_demande.statut;
  END IF;

  UPDATE demandes_annulation
     SET statut = 'REJETEE', decideur_id = p_decideur_id, decide_le = now(),
         commentaire_decision = p_commentaire
   WHERE id = p_demande_id;

  INSERT INTO historique_annulations (vente_id, demande_id, action, utilisateur_id, details)
  VALUES (v_demande.vente_id, p_demande_id, 'REJET', p_decideur_id,
    jsonb_build_object('commentaire', p_commentaire));

  PERFORM fn_journaliser(p_decideur_id, 'REJET_ANNULATION', 'ventes', 'ventes', v_demande.vente_id,
    jsonb_build_object('demande_id', p_demande_id, 'commentaire', p_commentaire));
END
$fonction$;

-- -----------------------------------------------------------------------------
-- Depenses : validation et rejet
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_valider_depense(p_depense_id uuid, p_valideur_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fonction$
DECLARE
  v_depense depenses%ROWTYPE;
BEGIN
  PERFORM fn_exiger_permission(p_valideur_id, 'depenses.valider');

  SELECT * INTO v_depense FROM depenses WHERE id = p_depense_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DEPENSE_INTROUVABLE:%', p_depense_id;
  END IF;
  IF v_depense.statut <> 'EN_ATTENTE' THEN
    RAISE EXCEPTION 'STATUT_DEPENSE_INVALIDE:%', v_depense.statut;
  END IF;

  UPDATE depenses
     SET statut = 'VALIDEE', valide_par = p_valideur_id, valide_le = now()
   WHERE id = p_depense_id;

  INSERT INTO historique_depenses (depense_id, statut_avant, statut_apres, utilisateur_id, commentaire)
  VALUES (p_depense_id, v_depense.statut, 'VALIDEE', p_valideur_id, 'Validation');

  PERFORM fn_journaliser(p_valideur_id, 'VALIDATION', 'depenses', 'depenses', p_depense_id,
    jsonb_build_object('numero', v_depense.numero, 'montant', v_depense.montant));
END
$fonction$;

CREATE OR REPLACE FUNCTION fn_rejeter_depense(p_depense_id uuid, p_valideur_id uuid, p_motif text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fonction$
DECLARE
  v_depense depenses%ROWTYPE;
BEGIN
  PERFORM fn_exiger_permission(p_valideur_id, 'depenses.valider');
  IF length(btrim(coalesce(p_motif, ''))) < 3 THEN
    RAISE EXCEPTION 'MOTIF_INVALIDE';
  END IF;

  SELECT * INTO v_depense FROM depenses WHERE id = p_depense_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DEPENSE_INTROUVABLE:%', p_depense_id;
  END IF;
  IF v_depense.statut <> 'EN_ATTENTE' THEN
    RAISE EXCEPTION 'STATUT_DEPENSE_INVALIDE:%', v_depense.statut;
  END IF;

  UPDATE depenses
     SET statut = 'REJETEE', valide_par = p_valideur_id, valide_le = now(), motif_rejet = btrim(p_motif)
   WHERE id = p_depense_id;

  INSERT INTO historique_depenses (depense_id, statut_avant, statut_apres, utilisateur_id, commentaire)
  VALUES (p_depense_id, v_depense.statut, 'REJETEE', p_valideur_id, btrim(p_motif));

  PERFORM fn_journaliser(p_valideur_id, 'REJET', 'depenses', 'depenses', p_depense_id,
    jsonb_build_object('numero', v_depense.numero, 'motif', p_motif));
END
$fonction$;

-- -----------------------------------------------------------------------------
-- Idempotence de la synchronisation
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_enregistrer_operation_synchronisation(
  p_appareil_id uuid,
  p_utilisateur_id uuid,
  p_type_operation text,
  p_entite text,
  p_entite_id uuid,
  p_cle_idempotence uuid,
  p_charge_utile jsonb
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fonction$
DECLARE
  v_existante operations_synchronisation%ROWTYPE;
  v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM appareils WHERE id = p_appareil_id AND actif) THEN
    RAISE EXCEPTION 'APPAREIL_INVALIDE:%', p_appareil_id;
  END IF;

  SELECT * INTO v_existante
    FROM operations_synchronisation
   WHERE cle_idempotence = p_cle_idempotence;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'deja_recue', true,
      'operation_id', v_existante.id,
      'statut', v_existante.statut,
      'resultat', v_existante.resultat
    );
  END IF;

  INSERT INTO operations_synchronisation (
    appareil_id, utilisateur_id, type_operation, entite, entite_id,
    cle_idempotence, charge_utile
  ) VALUES (
    p_appareil_id, p_utilisateur_id, p_type_operation, p_entite, p_entite_id,
    p_cle_idempotence, p_charge_utile
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('deja_recue', false, 'operation_id', v_id, 'statut', 'RECUE');
END
$fonction$;
