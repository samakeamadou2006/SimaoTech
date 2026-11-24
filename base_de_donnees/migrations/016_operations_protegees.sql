-- =============================================================================
-- 016 - Operations metier protegees par permission
-- -----------------------------------------------------------------------------
-- Ces fonctions sont l'unique voie autorisee pour les operations sensibles
-- lorsqu'elles sont appelees directement (SQL, PostgREST). Le backend les
-- appelle apres ses propres controles.
-- =============================================================================

-- Modification du prix de vente de reference (proprietaire uniquement)
CREATE OR REPLACE FUNCTION fn_modifier_prix_produit(
  p_produit_id uuid,
  p_utilisateur_id uuid,
  p_nouveau_prix numeric,
  p_motif text DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fonction$
DECLARE
  v_ancien numeric(16,2);
  v_nom text;
BEGIN
  IF p_nouveau_prix IS NULL OR p_nouveau_prix < 0 THEN
    RAISE EXCEPTION 'PRIX_INVALIDE';
  END IF;

  PERFORM fn_exiger_permission(p_utilisateur_id, 'produits.modifier_prix');

  SELECT prix_vente_reference, nom INTO v_ancien, v_nom
    FROM produits WHERE id = p_produit_id AND supprime_le IS NULL
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUIT_INTROUVABLE:%', p_produit_id;
  END IF;

  PERFORM set_config('simaotech.utilisateur_id', p_utilisateur_id::text, true);
  PERFORM set_config('simaotech.motif_prix', coalesce(p_motif, ''), true);

  UPDATE produits
     SET prix_vente_reference = round(p_nouveau_prix, 2)
   WHERE id = p_produit_id;

  PERFORM fn_journaliser(
    p_utilisateur_id, 'MODIFICATION_PRIX', 'produits', 'produits', p_produit_id,
    jsonb_build_object('produit', v_nom, 'ancien_prix', v_ancien, 'nouveau_prix', round(p_nouveau_prix, 2), 'motif', p_motif)
  );

  RETURN jsonb_build_object(
    'produit_id', p_produit_id,
    'prix_ancien', v_ancien,
    'prix_nouveau', round(p_nouveau_prix, 2)
  );
END
$fonction$;

-- Ajustement manuel de stock (motif obligatoire)
CREATE OR REPLACE FUNCTION fn_ajuster_stock(
  p_produit_id uuid,
  p_utilisateur_id uuid,
  p_quantite numeric,
  p_motif text
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fonction$
DECLARE
  v_type type_mouvement_stock;
  v_mouvement uuid;
  v_apres numeric(14,3);
BEGIN
  PERFORM fn_exiger_permission(p_utilisateur_id, 'stocks.ajuster');

  IF p_quantite = 0 THEN
    RAISE EXCEPTION 'QUANTITE_INVALIDE';
  END IF;
  IF length(btrim(coalesce(p_motif, ''))) < 5 THEN
    RAISE EXCEPTION 'MOTIF_INVALIDE';
  END IF;

  v_type := CASE WHEN p_quantite > 0 THEN 'AJUSTEMENT_POSITIF' ELSE 'AJUSTEMENT_NEGATIF' END;

  v_mouvement := fn_enregistrer_mouvement_stock(
    p_produit_id, v_type, p_quantite, p_utilisateur_id, btrim(p_motif), 'AJUSTEMENT', NULL
  );

  SELECT quantite_disponible INTO v_apres FROM stocks WHERE produit_id = p_produit_id;

  PERFORM fn_journaliser(
    p_utilisateur_id, 'AJUSTEMENT_STOCK', 'stocks', 'produits', p_produit_id,
    jsonb_build_object('quantite', p_quantite, 'stock_apres', v_apres, 'motif', p_motif)
  );

  RETURN jsonb_build_object('mouvement_id', v_mouvement, 'stock_apres', v_apres);
END
$fonction$;

-- Creation d'une depense (permission individuelle requise)
CREATE OR REPLACE FUNCTION fn_creer_depense(
  p_utilisateur_id uuid,
  p_categorie_id uuid,
  p_montant numeric,
  p_description text,
  p_date_depense timestamptz DEFAULT now(),
  p_justificatif_url text DEFAULT NULL,
  p_cle_idempotence uuid DEFAULT NULL
) RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fonction$
DECLARE
  v_id uuid;
BEGIN
  PERFORM fn_exiger_permission(p_utilisateur_id, 'depenses.creer');

  IF p_montant IS NULL OR p_montant <= 0 THEN
    RAISE EXCEPTION 'MONTANT_INVALIDE';
  END IF;
  IF length(btrim(coalesce(p_description, ''))) < 3 THEN
    RAISE EXCEPTION 'DESCRIPTION_INVALIDE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM categories_depenses WHERE id = p_categorie_id AND actif) THEN
    RAISE EXCEPTION 'CATEGORIE_DEPENSE_INVALIDE:%', p_categorie_id;
  END IF;

  -- Idempotence : une meme cle ne cree jamais deux depenses
  IF p_cle_idempotence IS NOT NULL THEN
    SELECT id INTO v_id FROM depenses WHERE cle_idempotence = p_cle_idempotence;
    IF FOUND THEN
      RETURN v_id;
    END IF;
  END IF;

  INSERT INTO depenses (
    categorie_id, montant, date_depense, description, justificatif_url,
    utilisateur_id, cle_idempotence
  ) VALUES (
    p_categorie_id, round(p_montant, 2), p_date_depense, btrim(p_description), p_justificatif_url,
    p_utilisateur_id, p_cle_idempotence
  )
  RETURNING id INTO v_id;

  INSERT INTO historique_depenses (depense_id, statut_avant, statut_apres, utilisateur_id, commentaire)
  VALUES (v_id, NULL, 'EN_ATTENTE', p_utilisateur_id, 'Creation');

  PERFORM fn_journaliser(
    p_utilisateur_id, 'CREATION', 'depenses', 'depenses', v_id,
    jsonb_build_object('montant', round(p_montant, 2), 'description', p_description)
  );

  RETURN v_id;
END
$fonction$;

-- Validation d'un inventaire : applique les ecarts reels constates
CREATE OR REPLACE FUNCTION fn_valider_inventaire(
  p_inventaire_id uuid,
  p_utilisateur_id uuid
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fonction$
DECLARE
  v_inventaire inventaires%ROWTYPE;
  v_ligne record;
  v_ecart_total integer := 0;
BEGIN
  PERFORM fn_exiger_permission(p_utilisateur_id, 'stocks.inventorier');

  SELECT * INTO v_inventaire FROM inventaires WHERE id = p_inventaire_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVENTAIRE_INTROUVABLE:%', p_inventaire_id;
  END IF;
  IF v_inventaire.statut <> 'BROUILLON' THEN
    RAISE EXCEPTION 'STATUT_INVENTAIRE_INVALIDE:%', v_inventaire.statut;
  END IF;

  FOR v_ligne IN SELECT * FROM lignes_inventaire WHERE inventaire_id = p_inventaire_id ORDER BY id
  LOOP
    IF v_ligne.ecart <> 0 THEN
      PERFORM fn_enregistrer_mouvement_stock(
        v_ligne.produit_id,
        'INVENTAIRE',
        v_ligne.ecart,
        p_utilisateur_id,
        'Inventaire ' || v_inventaire.numero,
        'INVENTAIRE',
        v_inventaire.id
      );
      v_ecart_total := v_ecart_total + 1;
    END IF;
  END LOOP;

  UPDATE inventaires SET statut = 'VALIDE', valide_le = now() WHERE id = p_inventaire_id;

  PERFORM fn_journaliser(p_utilisateur_id, 'VALIDATION', 'stocks', 'inventaires', p_inventaire_id,
    jsonb_build_object('numero', v_inventaire.numero, 'lignes_ajustees', v_ecart_total));

  RETURN jsonb_build_object('inventaire_id', p_inventaire_id, 'lignes_ajustees', v_ecart_total);
END
$fonction$;

-- -----------------------------------------------------------------------------
-- Lien d integrite avec le fournisseur d identite (Supabase Auth)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'utilisateurs_compte_auth_fk'
  ) THEN
    ALTER TABLE utilisateurs
      ADD CONSTRAINT utilisateurs_compte_auth_fk
      FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE RESTRICT;
  END IF;
END
$$;
