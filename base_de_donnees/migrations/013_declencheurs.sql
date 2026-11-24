-- =============================================================================
-- 013 - Declencheurs : calculs, verrouillages, protection des historiques
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Numerotation automatique des documents
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_attribuer_numero() RETURNS trigger
  LANGUAGE plpgsql
AS $fonction$
DECLARE
  v_prefixe text := TG_ARGV[0];
  v_sequence text := TG_ARGV[1];
BEGIN
  IF NEW.numero IS NULL OR length(btrim(NEW.numero)) = 0 THEN
    EXECUTE format('SELECT fn_formater_numero(%L, nextval(%L))', v_prefixe, v_sequence)
      INTO NEW.numero;
  END IF;
  RETURN NEW;
END
$fonction$;

CREATE TRIGGER trg_ventes_numero
  BEFORE INSERT ON ventes
  FOR EACH ROW EXECUTE FUNCTION fn_attribuer_numero('VTE', 'seq_vente');

CREATE TRIGGER trg_appro_numero
  BEFORE INSERT ON approvisionnements
  FOR EACH ROW EXECUTE FUNCTION fn_attribuer_numero('APP', 'seq_approvisionnement');

CREATE TRIGGER trg_depenses_numero
  BEFORE INSERT ON depenses
  FOR EACH ROW EXECUTE FUNCTION fn_attribuer_numero('DEP', 'seq_depense');

CREATE TRIGGER trg_inventaires_numero
  BEFORE INSERT ON inventaires
  FOR EACH ROW EXECUTE FUNCTION fn_attribuer_numero('INV', 'seq_inventaire');

-- -----------------------------------------------------------------------------
-- Lignes de vente : montants calcules par la base (jamais par le client)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_lignes_vente_calculs() RETURNS trigger
  LANGUAGE plpgsql
AS $fonction$
DECLARE
  v_statut statut_vente;
BEGIN
  SELECT statut INTO v_statut FROM ventes WHERE id = COALESCE(NEW.vente_id, OLD.vente_id);

  IF TG_OP = 'INSERT' AND v_statut NOT IN ('BROUILLON', 'EN_ATTENTE_SYNCHRONISATION', 'ANOMALIE') THEN
    RAISE EXCEPTION 'VENTE_VERROUILLEE:%', NEW.vente_id;
  END IF;
  IF TG_OP <> 'INSERT' AND v_statut IN ('VALIDEE', 'ANNULEE') THEN
    RAISE EXCEPTION 'VENTE_VERROUILLEE:%', COALESCE(NEW.vente_id, OLD.vente_id);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  NEW.prix_net_unitaire := round(
    NEW.prix_reference_unitaire
    - ((NEW.reduction_ligne + NEW.remise_globale_affectee) / NEW.quantite),
    2
  );
  NEW.cout_total_ligne := round(NEW.cmp_applique * NEW.quantite, 2);
  NEW.benefice_brut_ligne :=
    round(NEW.prix_net_unitaire * NEW.quantite, 2) - NEW.cout_total_ligne;

  RETURN NEW;
END
$fonction$;

CREATE TRIGGER trg_lignes_vente_calculs
  BEFORE INSERT OR UPDATE ON lignes_vente
  FOR EACH ROW EXECUTE FUNCTION fn_lignes_vente_calculs();

CREATE OR REPLACE FUNCTION fn_apres_lignes_vente() RETURNS trigger
  LANGUAGE plpgsql
AS $fonction$
BEGIN
  PERFORM fn_recalculer_totaux_vente(COALESCE(NEW.vente_id, OLD.vente_id));
  RETURN NULL;
END
$fonction$;

CREATE TRIGGER trg_lignes_vente_totaux
  AFTER INSERT OR UPDATE OR DELETE ON lignes_vente
  FOR EACH ROW EXECUTE FUNCTION fn_apres_lignes_vente();

-- -----------------------------------------------------------------------------
-- Lignes d'approvisionnement : cout net calcule par la base
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_lignes_appro_calculs() RETURNS trigger
  LANGUAGE plpgsql
AS $fonction$
BEGIN
  NEW.cout_net_ligne := fn_arrondir_montant(
    (NEW.quantite * NEW.prix_achat_unitaire) - NEW.reduction_ligne
  );
  NEW.cout_net_unitaire := round(NEW.cout_net_ligne / NEW.quantite, 6);
  RETURN NEW;
END
$fonction$;

CREATE TRIGGER trg_lignes_appro_calculs
  BEFORE INSERT OR UPDATE ON lignes_approvisionnement
  FOR EACH ROW EXECUTE FUNCTION fn_lignes_appro_calculs();

-- -----------------------------------------------------------------------------
-- Protection du CMP : modification uniquement par la validation d'un appro
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_proteger_cmp() RETURNS trigger
  LANGUAGE plpgsql
AS $fonction$
BEGIN
  IF NEW.cout_moyen_pondere IS DISTINCT FROM OLD.cout_moyen_pondere
     AND coalesce(current_setting('simaotech.maj_cmp', true), '') <> 'on' THEN
    RAISE EXCEPTION 'CMP_PROTEGE';
  END IF;
  RETURN NEW;
END
$fonction$;

CREATE TRIGGER trg_produits_proteger_cmp
  BEFORE UPDATE ON produits
  FOR EACH ROW EXECUTE FUNCTION fn_proteger_cmp();

-- -----------------------------------------------------------------------------
-- Historisation automatique des changements de prix de vente
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_historiser_prix() RETURNS trigger
  LANGUAGE plpgsql
AS $fonction$
BEGIN
  IF NEW.prix_vente_reference IS DISTINCT FROM OLD.prix_vente_reference THEN
    INSERT INTO historique_prix_produits (
      produit_id, prix_vente_ancien, prix_vente_nouveau, modifie_par, motif
    ) VALUES (
      NEW.id,
      OLD.prix_vente_reference,
      NEW.prix_vente_reference,
      nullif(current_setting('simaotech.utilisateur_id', true), '')::uuid,
      nullif(current_setting('simaotech.motif_prix', true), '')
    );
  END IF;
  RETURN NEW;
END
$fonction$;

CREATE TRIGGER trg_produits_historiser_prix
  AFTER UPDATE ON produits
  FOR EACH ROW EXECUTE FUNCTION fn_historiser_prix();

-- -----------------------------------------------------------------------------
-- Immutabilite des historiques et des ventes validees
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_proteger_historique() RETURNS trigger
  LANGUAGE plpgsql
AS $fonction$
BEGIN
  RAISE EXCEPTION 'HISTORIQUE_PROTEGE:%', TG_TABLE_NAME;
END
$fonction$;

CREATE TRIGGER trg_journal_immuable
  BEFORE UPDATE OR DELETE ON journal_activites
  FOR EACH ROW EXECUTE FUNCTION fn_proteger_historique();

CREATE TRIGGER trg_mouvements_immuables
  BEFORE UPDATE OR DELETE ON mouvements_stock
  FOR EACH ROW EXECUTE FUNCTION fn_proteger_historique();

CREATE TRIGGER trg_historique_cmp_immuable
  BEFORE UPDATE OR DELETE ON historique_cout_moyen
  FOR EACH ROW EXECUTE FUNCTION fn_proteger_historique();

CREATE TRIGGER trg_historique_prix_immuable
  BEFORE UPDATE OR DELETE ON historique_prix_produits
  FOR EACH ROW EXECUTE FUNCTION fn_proteger_historique();

CREATE TRIGGER trg_historique_depenses_immuable
  BEFORE UPDATE OR DELETE ON historique_depenses
  FOR EACH ROW EXECUTE FUNCTION fn_proteger_historique();

CREATE TRIGGER trg_historique_annulations_immuable
  BEFORE UPDATE OR DELETE ON historique_annulations
  FOR EACH ROW EXECUTE FUNCTION fn_proteger_historique();

CREATE OR REPLACE FUNCTION fn_proteger_vente() RETURNS trigger
  LANGUAGE plpgsql
AS $fonction$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.statut <> 'BROUILLON' THEN
      RAISE EXCEPTION 'SUPPRESSION_VENTE_INTERDITE:%', OLD.statut;
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.statut IN ('VALIDEE', 'ANNULEE') THEN
    IF NEW.statut = OLD.statut
       AND (NEW.montant_net <> OLD.montant_net
            OR NEW.cout_total <> OLD.cout_total
            OR NEW.benefice_brut <> OLD.benefice_brut
            OR NEW.utilisateur_id <> OLD.utilisateur_id
            OR NEW.date_vente <> OLD.date_vente) THEN
      RAISE EXCEPTION 'VENTE_VALIDEE_IMMUABLE:%', OLD.id;
    END IF;
  END IF;

  RETURN NEW;
END
$fonction$;

CREATE TRIGGER trg_ventes_protegees
  BEFORE UPDATE OR DELETE ON ventes
  FOR EACH ROW EXECUTE FUNCTION fn_proteger_vente();

CREATE OR REPLACE FUNCTION fn_proteger_paiements() RETURNS trigger
  LANGUAGE plpgsql
AS $fonction$
DECLARE
  v_statut statut_vente;
BEGIN
  SELECT statut INTO v_statut FROM ventes WHERE id = COALESCE(NEW.vente_id, OLD.vente_id);
  IF v_statut IN ('VALIDEE', 'ANNULEE') THEN
    RAISE EXCEPTION 'PAIEMENT_VERROUILLE:%', COALESCE(NEW.vente_id, OLD.vente_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$fonction$;

CREATE TRIGGER trg_paiements_proteges
  BEFORE UPDATE OR DELETE ON paiements
  FOR EACH ROW EXECUTE FUNCTION fn_proteger_paiements();

-- -----------------------------------------------------------------------------
-- Coherence du stock : valeur et quantite reservee
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_stocks_coherence() RETURNS trigger
  LANGUAGE plpgsql
AS $fonction$
DECLARE
  v_cmp numeric(18,6);
BEGIN
  SELECT cout_moyen_pondere INTO v_cmp FROM produits WHERE id = NEW.produit_id;
  NEW.valeur_stock := round(NEW.quantite_disponible * coalesce(v_cmp, 0), 2);
  NEW.mis_a_jour_le := now();
  RETURN NEW;
END
$fonction$;

CREATE TRIGGER trg_stocks_coherence
  BEFORE INSERT OR UPDATE ON stocks
  FOR EACH ROW EXECUTE FUNCTION fn_stocks_coherence();

-- -----------------------------------------------------------------------------
-- Mise a jour du stock technique a la creation d'un produit
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_creer_stock_produit() RETURNS trigger
  LANGUAGE plpgsql
AS $fonction$
BEGIN
  INSERT INTO stocks (produit_id, seuil_alerte)
  VALUES (NEW.id, NEW.seuil_alerte)
  ON CONFLICT (produit_id) DO NOTHING;
  RETURN NEW;
END
$fonction$;

CREATE TRIGGER trg_produits_creer_stock
  AFTER INSERT ON produits
  FOR EACH ROW EXECUTE FUNCTION fn_creer_stock_produit();
