-- =============================================================================
-- 001 - Types metier et fonctions utilitaires
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'statut_vente') THEN
    CREATE TYPE statut_vente AS ENUM (
      'BROUILLON',
      'EN_ATTENTE_SYNCHRONISATION',
      'VALIDEE',
      'ANNULEE',
      'ANOMALIE'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'statut_synchronisation') THEN
    CREATE TYPE statut_synchronisation AS ENUM (
      'LOCALE',
      'EN_ATTENTE',
      'SYNCHRONISEE',
      'CONFLIT',
      'REJETEE'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'statut_approvisionnement') THEN
    CREATE TYPE statut_approvisionnement AS ENUM ('BROUILLON', 'VALIDE', 'ANNULE');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'statut_inventaire') THEN
    CREATE TYPE statut_inventaire AS ENUM ('BROUILLON', 'VALIDE', 'ANNULE');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'statut_depense') THEN
    CREATE TYPE statut_depense AS ENUM ('EN_ATTENTE', 'VALIDEE', 'REJETEE', 'ANNULEE');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'statut_demande_annulation') THEN
    CREATE TYPE statut_demande_annulation AS ENUM ('EN_ATTENTE', 'APPROUVEE', 'REJETEE');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'statut_operation_sync') THEN
    CREATE TYPE statut_operation_sync AS ENUM ('RECUE', 'TRAITEE', 'ECHEC', 'CONFLIT');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'statut_conflit') THEN
    CREATE TYPE statut_conflit AS ENUM ('OUVERT', 'EN_COURS', 'RESOLU', 'REJETE');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'moyen_paiement') THEN
    CREATE TYPE moyen_paiement AS ENUM ('ESPECES', 'ORANGE_MONEY', 'MTN_MOMO', 'WAVE');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'type_mouvement_stock') THEN
    CREATE TYPE type_mouvement_stock AS ENUM (
      'ENTREE_APPROVISIONNEMENT',
      'SORTIE_VENTE',
      'RETOUR_ANNULATION',
      'AJUSTEMENT_POSITIF',
      'AJUSTEMENT_NEGATIF',
      'RESERVATION',
      'LIBERATION_RESERVATION',
      'INVENTAIRE'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'statut_produit') THEN
    CREATE TYPE statut_produit AS ENUM ('ACTIF', 'ARCHIVE');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'type_reduction') THEN
    CREATE TYPE type_reduction AS ENUM ('LIGNE', 'GLOBALE');
  END IF;
END
$$;

-- Horodatage de modification automatique
CREATE OR REPLACE FUNCTION fn_maj_modifie_le() RETURNS trigger
  LANGUAGE plpgsql
AS $fonction$
BEGIN
  NEW.modifie_le := now();
  RETURN NEW;
END
$fonction$;

-- Numero lisible : PREFIXE-AAAAMM-000123
CREATE OR REPLACE FUNCTION fn_formater_numero(p_prefixe text, p_numero bigint)
  RETURNS text
  LANGUAGE sql
  STABLE
AS $fonction$
  SELECT p_prefixe
      || '-'
      || to_char(now() AT TIME ZONE 'Africa/Abidjan', 'YYYYMM')
      || '-'
      || lpad(p_numero::text, 6, '0');
$fonction$;

-- Arrondi commercial au centime
CREATE OR REPLACE FUNCTION fn_arrondir_montant(p_valeur numeric)
  RETURNS numeric
  LANGUAGE sql
  IMMUTABLE
AS $fonction$
  SELECT round(coalesce(p_valeur, 0), 2);
$fonction$;

-- CMP d'une operation d'approvisionnement.
-- CMP = ((Q1 x CMP1) + (Q2 x C2)) / (Q1 + Q2)
CREATE OR REPLACE FUNCTION fn_cmp(
  p_quantite_avant numeric,
  p_cmp_avant numeric,
  p_quantite_entree numeric,
  p_cout_unitaire_entree numeric
) RETURNS numeric
  LANGUAGE plpgsql
  IMMUTABLE
AS $fonction$
DECLARE
  v_total numeric;
BEGIN
  IF p_quantite_avant < 0 OR p_quantite_entree < 0 THEN
    RAISE EXCEPTION 'QUANTITE_INVALIDE';
  END IF;
  IF p_cmp_avant < 0 OR p_cout_unitaire_entree < 0 THEN
    RAISE EXCEPTION 'COUT_INVALIDE';
  END IF;

  v_total := p_quantite_avant + p_quantite_entree;
  IF v_total = 0 THEN
    RETURN 0;
  END IF;

  RETURN round(
    ((p_quantite_avant * p_cmp_avant) + (p_quantite_entree * p_cout_unitaire_entree)) / v_total,
    6
  );
END
$fonction$;

COMMENT ON FUNCTION fn_cmp(numeric, numeric, numeric, numeric) IS
  'Cout moyen pondere apres entree en stock. Precision 6 decimales, jamais de flottant.';
