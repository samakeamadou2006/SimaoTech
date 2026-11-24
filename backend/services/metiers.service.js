/**
 * Services metier des phases 5 a 12 : fournisseurs, approvisionnements, stocks,
 * ventes, paiements, annulations, depenses, rapports, parametres et
 * synchronisation.
 *
 * Principes :
 * - les montants restent des Decimal jusqu'a l'ecriture SQL (aucun flottant) ;
 * - les operations sensibles passent par les fonctions PostgreSQL protegees ;
 * - les controles de permission sont refaits ici, jamais seulement en route ;
 * - aucune vente, aucun approvisionnement valide n'est supprime : les etats
 *   (ANNULEE, ANOMALIE, REJETEE) conservent l'historique.
 */
import crypto from 'node:crypto';
import { executer, transaction } from '../configuration/base_de_donnees.js';
import { possedePermission } from './authentification.service.js';
import {
  ErreurApplication,
  ErreurConflit,
  ErreurIntrouvable,
  ErreurValidation,
} from '../utils/erreurs.js';
import {
  arrondir,
  d,
  montantTexte,
  paiementsConformes,
  PRECISION_QUANTITE,
  repartirReductionGlobale,
} from '../utils/montants.js';
import { estUuid } from '../validateurs/commun.validateur.js';

const MOYENS_PAIEMENT = new Set(['ESPECES', 'ORANGE_MONEY', 'MTN_MOMO', 'WAVE']);
const STATUTS_VENTE = new Set([
  'BROUILLON',
  'EN_ATTENTE_SYNCHRONISATION',
  'VALIDEE',
  'ANNULEE',
  'ANOMALIE',
]);
const STATUTS_APPRO = new Set(['BROUILLON', 'VALIDE', 'ANNULE']);
const STATUTS_INVENTAIRE = new Set(['BROUILLON', 'VALIDE', 'ANNULE']);
const STATUTS_DEPENSE = new Set(['EN_ATTENTE', 'VALIDEE', 'REJETEE', 'ANNULEE']);

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function texte(valeur, { min = 2, max = 120, champ = 'nom' } = {}) {
  const textePropre = String(valeur ?? '').trim().replace(/\s+/g, ' ');
  if (textePropre.length < min || textePropre.length > max) {
    throw new ErreurValidation(`Le champ « ${champ} » est invalide.`, { champ });
  }
  return textePropre;
}

function texteFacultatif(valeur, { max = 500, champ = 'champ' } = {}) {
  if (valeur === null || valeur === undefined) return null;
  const propre = String(valeur).trim();
  if (!propre) return null;
  if (propre.length > max) {
    throw new ErreurValidation(`Le champ « ${champ} » est trop long.`, { champ });
  }
  return propre;
}

function montant(valeur, champ = 'montant', { positif = false } = {}) {
  let resultat;
  try {
    resultat = d(String(valeur ?? '0').replace(/\s/g, '').replace(',', '.'));
  } catch {
    throw new ErreurValidation(`Le montant « ${champ} » est invalide.`, { champ });
  }
  if (resultat.isNegative() || (positif && !resultat.greaterThan(0))) {
    throw new ErreurValidation(`Le montant « ${champ} » est invalide.`, { champ });
  }
  return arrondir(resultat);
}

function quantite(valeur, champ = 'quantite', { strictementPositive = true } = {}) {
  let resultat;
  try {
    resultat = d(String(valeur ?? '0').replace(',', '.'));
  } catch {
    throw new ErreurValidation(`La quantite « ${champ} » est invalide.`, { champ });
  }
  if (resultat.isNegative() || (strictementPositive && !resultat.greaterThan(0))) {
    throw new ErreurValidation(`La quantite « ${champ} » est invalide.`, { champ });
  }
  return resultat.toFixed(PRECISION_QUANTITE);
}

function exigerPermission(acteur, code) {
  if (!possedePermission(acteur, code)) {
    throw new ErreurApplication('Permission insuffisante pour cette operation.', {
      code: `PERMISSION_MANQUANTE:${code}`,
      statut: 403,
    });
  }
}

function bornePar(valeur) {
  if (!valeur) return null;
  const nombre = Number(valeur);
  return Number.isFinite(nombre) && nombre > 0 ? nombre : null;
}

function dateOuNull(valeur) {
  if (!valeur) return null;
  const date = new Date(valeur);
  if (Number.isNaN(date.getTime())) {
    throw new ErreurValidation('Date invalide.', { champ: 'date' });
  }
  if (
    /^\d{4}-\d{2}-\d{2}$/.test(String(valeur)) &&
    date.toISOString().slice(0, 10) !== String(valeur)
  ) {
    throw new ErreurValidation('Date invalide.', { champ: 'date' });
  }
  return date.toISOString();
}

function dateFinOuNull(valeur) {
  if (!valeur) return null;
  const date = dateOuNull(valeur);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(valeur))) {
    return `${String(valeur)}T23:59:59.999Z`;
  }
  return date;
}

async function journaliser(acteur, action, module, entite, entiteId, details = {}, contexte = {}) {
  await executer(
    `INSERT INTO journal_activites
       (utilisateur_id, action, module, entite, entite_id, details, adresse_ip, requete_id)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::inet, $8)`,
    [
      acteur?.id ?? null,
      action,
      module,
      entite,
      entiteId,
      JSON.stringify(details ?? {}),
      contexte.adresseIp ?? null,
      contexte.requeteId ?? null,
    ],
  );
}

function urlMobileMoneyRequise(moyen) {
  return moyen !== 'ESPECES';
}

/* -------------------------------------------------------------------------- */
/* Fournisseurs                                                               */
/* -------------------------------------------------------------------------- */

export async function fournisseursLister({ limite, decalage, recherche, actif = null }) {
  const conditions = ['supprime_le IS NULL'];
  const parametres = [];
  if (recherche) {
    parametres.push(`%${String(recherche).trim()}%`);
    conditions.push(
      `(nom ILIKE $${parametres.length} OR code ILIKE $${parametres.length}
        OR coalesce(telephone, '') ILIKE $${parametres.length}
        OR coalesce(email::text, '') ILIKE $${parametres.length})`,
    );
  }
  if (actif !== null) {
    parametres.push(actif);
    conditions.push(`actif = $${parametres.length}`);
  }
  const filtre = conditions.join(' AND ');

  const [liste, total] = await Promise.all([
    executer(
      `SELECT id, code, nom, telephone, email::text AS email, adresse, notes, actif,
              cree_le, modifie_le
         FROM fournisseurs
        WHERE ${filtre}
        ORDER BY actif DESC, nom
        LIMIT $${parametres.length + 1} OFFSET $${parametres.length + 2}`,
      [...parametres, limite, decalage],
    ),
    executer(`SELECT count(*)::int AS total FROM fournisseurs WHERE ${filtre}`, parametres),
  ]);
  return { rows: liste.rows, total: total.rows[0]?.total ?? 0 };
}

export async function fournisseursOptions() {
  const { rows } = await executer(
    `SELECT id, code, nom FROM fournisseurs
      WHERE actif AND supprime_le IS NULL ORDER BY nom`,
  );
  return rows;
}

export async function fournisseurDetail(id) {
  const { rows } = await executer(
    `SELECT id, code, nom, telephone, email::text AS email, adresse, notes, actif,
            cree_le, modifie_le
       FROM fournisseurs WHERE id = $1 AND supprime_le IS NULL`,
    [id],
  );
  if (!rows[0]) throw new ErreurIntrouvable('Fournisseur introuvable.');
  return rows[0];
}

function validerEmail(valeur) {
  if (valeur === null || valeur === undefined || String(valeur).trim() === '') return null;
  const email = String(valeur).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw new ErreurValidation('Adresse e-mail invalide.', { champ: 'email' });
  }
  return email;
}

export async function fournisseurCreer(acteur, body = {}, contexte = {}) {
  const code = texte(body.code ?? body.nom, { min: 2, max: 40, champ: 'code' })
    .toUpperCase()
    .replace(/[^A-Z0-9._-]+/g, '-');
  const nom = texte(body.nom);

  const existant = await executer(
    'SELECT id FROM fournisseurs WHERE upper(code) = upper($1)',
    [code],
  );
  if (existant.rows[0]) {
    throw new ErreurConflit('Ce code fournisseur est deja utilise.', 'CODE_FOURNISSEUR_DEJA_UTILISE');
  }

  const { rows } = await executer(
    `INSERT INTO fournisseurs (code, nom, telephone, email, adresse, notes, actif)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      code,
      nom,
      texteFacultatif(body.telephone, { max: 30, champ: 'telephone' }),
      validerEmail(body.email),
      texteFacultatif(body.adresse, { max: 300, champ: 'adresse' }),
      texteFacultatif(body.notes, { max: 1000, champ: 'notes' }),
      body.actif !== false,
    ],
  );
  await journaliser(acteur, 'CREATION_FOURNISSEUR', 'achats', 'fournisseurs', rows[0].id, {
    code,
    nom,
  }, contexte);
  return fournisseurDetail(rows[0].id);
}

export async function fournisseurModifier(acteur, id, body = {}, contexte = {}) {
  const existant = await fournisseurDetail(id);
  const code =
    body.code === undefined
      ? existant.code
      : texte(body.code, { min: 2, max: 40, champ: 'code' })
          .toUpperCase()
          .replace(/[^A-Z0-9._-]+/g, '-');
  const nom = body.nom === undefined ? existant.nom : texte(body.nom);

  if (code !== existant.code) {
    const doublon = await executer(
      'SELECT id FROM fournisseurs WHERE upper(code) = upper($1) AND id <> $2',
      [code, id],
    );
    if (doublon.rows[0]) {
      throw new ErreurConflit('Ce code fournisseur est deja utilise.', 'CODE_FOURNISSEUR_DEJA_UTILISE');
    }
  }

  await executer(
    `UPDATE fournisseurs
        SET code = $2, nom = $3, telephone = $4, email = $5, adresse = $6,
            notes = $7, actif = $8
      WHERE id = $1 AND supprime_le IS NULL`,
    [
      id,
      code,
      nom,
      body.telephone === undefined
        ? existant.telephone
        : texteFacultatif(body.telephone, { max: 30, champ: 'telephone' }),
      body.email === undefined ? existant.email : validerEmail(body.email),
      body.adresse === undefined
        ? existant.adresse
        : texteFacultatif(body.adresse, { max: 300, champ: 'adresse' }),
      body.notes === undefined
        ? existant.notes
        : texteFacultatif(body.notes, { max: 1000, champ: 'notes' }),
      body.actif === undefined ? existant.actif : Boolean(body.actif),
    ],
  );

  await journaliser(acteur, 'MODIFICATION_FOURNISSEUR', 'achats', 'fournisseurs', id, {
    code,
    nom,
  }, contexte);
  return fournisseurDetail(id);
}

export async function fournisseurSupprimer(acteur, id, contexte = {}) {
  const existant = await fournisseurDetail(id);
  const enCours = await executer(
    `SELECT count(*)::int AS total FROM approvisionnements
      WHERE fournisseur_id = $1 AND statut = 'BROUILLON'`,
    [id],
  );
  if ((enCours.rows[0]?.total ?? 0) > 0) {
    throw new ErreurConflit(
      'Ce fournisseur a des approvisionnements en brouillon : validez-les ou annulez-les avant de l archiver.',
      'FOURNISSEUR_APPROVISIONNEMENT_EN_COURS',
      { approvisionnements: enCours.rows[0].total },
    );
  }
  await executer(
    'UPDATE fournisseurs SET supprime_le = now(), actif = false WHERE id = $1',
    [id],
  );
  await journaliser(acteur, 'SUPPRESSION_FOURNISSEUR', 'achats', 'fournisseurs', id, {
    nom: existant.nom,
    code: existant.code,
  }, contexte);
  return { id, supprime: true };
}

/* -------------------------------------------------------------------------- */
/* Approvisionnements                                                         */
/* -------------------------------------------------------------------------- */

function filtreAppro({ statut, fournisseurId, recherche, du, au }) {
  const conditions = [];
  const parametres = [];
  if (statut) {
    parametres.push(String(statut).toUpperCase());
    conditions.push(`a.statut = $${parametres.length}::statut_approvisionnement`);
  }
  if (fournisseurId) {
    parametres.push(fournisseurId);
    conditions.push(`a.fournisseur_id = $${parametres.length}`);
  }
  if (recherche) {
    parametres.push(`%${String(recherche).trim()}%`);
    conditions.push(
      `(a.numero ILIKE $${parametres.length} OR f.nom ILIKE $${parametres.length})`,
    );
  }
  if (du) {
    parametres.push(dateOuNull(du));
    conditions.push(`a.date_approvisionnement >= $${parametres.length}::timestamptz`);
  }
  if (au) {
    parametres.push(dateOuNull(au));
    conditions.push(`a.date_approvisionnement < ($${parametres.length}::timestamptz + interval '1 day')`);
  }
  return { filtre: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', parametres };
}

export async function approvisionnementsLister({
  limite,
  decalage,
  statut = null,
  fournisseurId = null,
  recherche = null,
  du = null,
  au = null,
}) {
  if (statut && !STATUTS_APPRO.has(String(statut).toUpperCase())) {
    throw new ErreurValidation('Statut d approvisionnement invalide.', { champ: 'statut' });
  }
  const { filtre, parametres } = filtreAppro({ statut, fournisseurId, recherche, du, au });

  const [liste, total] = await Promise.all([
    executer(
      `SELECT a.id, a.numero, a.date_approvisionnement, a.montant_brut,
              a.total_reductions, a.cout_net, a.statut, a.observations,
              f.id AS fournisseur_id, f.nom AS fournisseur,
              u.nom_complet AS utilisateur,
              (SELECT count(*)::int FROM lignes_approvisionnement l
                WHERE l.approvisionnement_id = a.id) AS nombre_lignes
         FROM approvisionnements a
         JOIN fournisseurs f ON f.id = a.fournisseur_id
         JOIN utilisateurs u ON u.id = a.utilisateur_id
         ${filtre}
        ORDER BY a.date_approvisionnement DESC
        LIMIT $${parametres.length + 1} OFFSET $${parametres.length + 2}`,
      [...parametres, limite, decalage],
    ),
    executer(
      `SELECT count(*)::int AS total
         FROM approvisionnements a JOIN fournisseurs f ON f.id = a.fournisseur_id
         ${filtre}`,
      parametres,
    ),
  ]);
  return { rows: liste.rows, total: total.rows[0]?.total ?? 0 };
}

export async function approvisionnementDetail(id) {
  const entete = await executer(
    `SELECT a.*, f.nom AS fournisseur, f.code AS fournisseur_code,
            u.nom_complet AS utilisateur
       FROM approvisionnements a
       JOIN fournisseurs f ON f.id = a.fournisseur_id
       JOIN utilisateurs u ON u.id = a.utilisateur_id
      WHERE a.id = $1`,
    [id],
  );
  if (!entete.rows[0]) throw new ErreurIntrouvable('Approvisionnement introuvable.');
  const lignes = await executer(
    `SELECT l.*, p.nom AS produit, p.reference,
            p.cout_moyen_pondere AS cmp_actuel
       FROM lignes_approvisionnement l
       JOIN produits p ON p.id = l.produit_id
      WHERE l.approvisionnement_id = $1
      ORDER BY p.nom`,
    [id],
  );
  return { ...entete.rows[0], lignes: lignes.rows };
}

export async function approvisionnementCreer(acteur, body = {}, contexte = {}) {
  const lignes = Array.isArray(body.lignes) ? body.lignes : [];
  if (!lignes.length) {
    throw new ErreurValidation('Un approvisionnement doit contenir au moins un produit.');
  }
  if (!estUuid(body.fournisseurId)) {
    throw new ErreurValidation('Fournisseur obligatoire.', { champ: 'fournisseurId' });
  }
  const fournisseur = await executer(
    'SELECT id, nom FROM fournisseurs WHERE id = $1 AND supprime_le IS NULL',
    [body.fournisseurId],
  );
  if (!fournisseur.rows[0]) {
    throw new ErreurValidation('Fournisseur introuvable.', { champ: 'fournisseurId' });
  }

  const cleIdempotence = body.cleIdempotence ?? null;
  if (cleIdempotence !== null && !estUuid(cleIdempotence)) {
    throw new ErreurValidation('Cle d idempotence invalide.', { champ: 'cleIdempotence' });
  }
  if (cleIdempotence) {
    const existant = await executer(
      'SELECT id FROM approvisionnements WHERE cle_idempotence = $1',
      [cleIdempotence],
    );
    if (existant.rows[0]) return approvisionnementDetail(existant.rows[0].id);
  }

  const produitsVus = new Set();
  const preparees = [];
  for (const ligne of lignes) {
    if (!estUuid(ligne.produitId)) {
      throw new ErreurValidation('Chaque ligne doit designer un produit valide.');
    }
    if (produitsVus.has(ligne.produitId)) {
      throw new ErreurValidation('Un produit ne peut apparaitre qu une fois dans l approvisionnement.');
    }
    produitsVus.add(ligne.produitId);

    const produit = await executer(
      `SELECT id, nom, statut FROM produits
        WHERE id = $1 AND supprime_le IS NULL`,
      [ligne.produitId],
    );
    if (!produit.rows[0]) {
      throw new ErreurValidation('Produit introuvable dans le catalogue.', { champ: 'produitId' });
    }
    if (produit.rows[0].statut !== 'ACTIF') {
      throw new ErreurConflit('Un produit archive ne peut pas etre approvisionne.', 'PRODUIT_ARCHIVE');
    }

    const quantiteLigne = quantite(ligne.quantite);
    const prix = montant(ligne.prixAchatUnitaire, 'prix achat');
    const reduction = montant(ligne.reduction ?? 0, 'reduction');
    const brutLigne = arrondir(d(quantiteLigne).times(prix));
    if (reduction.greaterThan(brutLigne)) {
      throw new ErreurValidation('La reduction depasse le montant de la ligne.', {
        champ: 'reduction',
      });
    }
    preparees.push({ produitId: ligne.produitId, quantite: quantiteLigne, prix, reduction, brutLigne });
  }

  const id = await transaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO approvisionnements
         (fournisseur_id, utilisateur_id, date_approvisionnement, observations, cle_idempotence)
       VALUES ($1, $2, coalesce($3::timestamptz, now()), $4, $5)
       RETURNING id`,
      [
        body.fournisseurId,
        acteur.id,
        dateOuNull(body.date),
        texteFacultatif(body.observations, { max: 1000, champ: 'observations' }),
        cleIdempotence,
      ],
    );
    const approId = rows[0].id;

    for (const ligne of preparees) {
      await client.query(
        `INSERT INTO lignes_approvisionnement
           (approvisionnement_id, produit_id, quantite, prix_achat_unitaire, reduction_ligne)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          approId,
          ligne.produitId,
          ligne.quantite,
          montantTexte(ligne.prix),
          montantTexte(ligne.reduction),
        ],
      );
    }

    await client.query(
      `UPDATE approvisionnements a
          SET montant_brut = t.brut, total_reductions = t.reductions, cout_net = t.net
         FROM (
           SELECT coalesce(sum(round(quantite * prix_achat_unitaire, 2)), 0) AS brut,
                  coalesce(sum(reduction_ligne), 0) AS reductions,
                  coalesce(sum(round(quantite * prix_achat_unitaire, 2) - reduction_ligne), 0) AS net
             FROM lignes_approvisionnement
            WHERE approvisionnement_id = $1
         ) t
        WHERE a.id = $1`,
      [approId],
    );

    return approId;
  });

  await journaliser(acteur, 'CREATION_APPROVISIONNEMENT', 'achats', 'approvisionnements', id, {
    fournisseur: fournisseur.rows[0].nom,
    lignes: preparees.length,
  }, contexte);

  return approvisionnementDetail(id);
}

export async function approvisionnementValider(id, acteur) {
  const { rows } = await executer(
    'SELECT fn_valider_approvisionnement($1, $2) AS resultat',
    [id, acteur.id],
  );
  return { ...rows[0].resultat, approvisionnement: await approvisionnementDetail(id) };
}

/* -------------------------------------------------------------------------- */
/* Stocks                                                                     */
/* -------------------------------------------------------------------------- */

function filtreStock({ recherche, categorieId, etatStock }) {
  const conditions = ['p.supprime_le IS NULL'];
  const parametres = [];
  if (recherche) {
    parametres.push(`%${String(recherche).trim()}%`);
    conditions.push(
      `(p.nom ILIKE $${parametres.length} OR p.reference ILIKE $${parametres.length}
        OR coalesce(p.code_barres, '') ILIKE $${parametres.length})`,
    );
  }
  if (categorieId) {
    parametres.push(categorieId);
    conditions.push(`p.categorie_id = $${parametres.length}`);
  }
  if (etatStock) {
    parametres.push(String(etatStock).toUpperCase());
    conditions.push(
      `(CASE
          WHEN s.quantite_disponible <= 0 THEN 'RUPTURE'
          WHEN s.quantite_disponible <= p.seuil_alerte THEN 'FAIBLE'
          ELSE 'NORMAL'
        END) = $${parametres.length}`,
    );
  }
  return { filtre: conditions.join(' AND '), parametres };
}

export async function stocksLister({ limite, decalage, recherche, categorieId, etatStock }) {
  const { filtre, parametres } = filtreStock({ recherche, categorieId, etatStock });
  const [liste, total] = await Promise.all([
    executer(
      `SELECT p.id, p.reference, p.nom, p.code_barres, p.categorie_id,
              c.nom AS categorie, p.cout_moyen_pondere, p.seuil_alerte,
              s.quantite_disponible, s.quantite_reservee,
              (s.quantite_disponible - s.quantite_reservee) AS quantite_vendable,
              round(s.quantite_disponible * p.cout_moyen_pondere, 2) AS valeur_stock,
              CASE
                WHEN s.quantite_disponible <= 0 THEN 'RUPTURE'
                WHEN s.quantite_disponible <= p.seuil_alerte THEN 'FAIBLE'
                ELSE 'NORMAL'
              END AS etat_stock,
              p.statut
         FROM produits p
         JOIN stocks s ON s.produit_id = p.id
         LEFT JOIN categories c ON c.id = p.categorie_id
        WHERE ${filtre}
        ORDER BY p.nom
        LIMIT $${parametres.length + 1} OFFSET $${parametres.length + 2}`,
      [...parametres, limite, decalage],
    ),
    executer(
      `SELECT count(*)::int AS total
         FROM produits p JOIN stocks s ON s.produit_id = p.id
        WHERE ${filtre}`,
      parametres,
    ),
  ]);
  return { rows: liste.rows, total: total.rows[0]?.total ?? 0 };
}

export async function stocksStatistiques() {
  const { rows } = await executer(
    `SELECT count(*)::int AS produits,
            count(*) FILTER (WHERE s.quantite_disponible <= 0)::int AS ruptures,
            count(*) FILTER (WHERE s.quantite_disponible > 0
                              AND s.quantite_disponible <= p.seuil_alerte)::int AS faibles,
            coalesce(sum(round(s.quantite_disponible * p.cout_moyen_pondere, 2)), 0)::text AS valeur
       FROM produits p JOIN stocks s ON s.produit_id = p.id
      WHERE p.supprime_le IS NULL AND p.statut = 'ACTIF'`,
  );
  return rows[0];
}

export async function stocksAlertes({ limite = 50 } = {}) {
  const { rows } = await executer(
    `SELECT p.id, p.reference, p.nom, p.seuil_alerte,
            s.quantite_disponible, c.nom AS categorie,
            CASE WHEN s.quantite_disponible <= 0 THEN 'RUPTURE' ELSE 'FAIBLE' END AS etat_stock
       FROM produits p
       JOIN stocks s ON s.produit_id = p.id
       LEFT JOIN categories c ON c.id = p.categorie_id
      WHERE p.supprime_le IS NULL AND p.statut = 'ACTIF'
        AND s.quantite_disponible <= p.seuil_alerte
      ORDER BY s.quantite_disponible ASC, p.nom
      LIMIT $1`,
    [limite],
  );
  return rows;
}

export async function mouvementsLister({ limite, decalage, produitId, type }) {
  const conditions = [];
  const parametres = [];
  if (produitId) {
    parametres.push(produitId);
    conditions.push(`m.produit_id = $${parametres.length}`);
  }
  if (type) {
    parametres.push(String(type).toUpperCase());
    conditions.push(`m.type_mouvement = $${parametres.length}::type_mouvement_stock`);
  }
  const filtre = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [liste, total] = await Promise.all([
    executer(
      `SELECT m.id, m.type_mouvement, m.quantite, m.stock_avant, m.stock_apres,
              m.cout_unitaire, m.motif, m.cree_le, m.reference_type,
              p.nom AS produit, p.reference, u.nom_complet AS utilisateur
         FROM mouvements_stock m
         JOIN produits p ON p.id = m.produit_id
         LEFT JOIN utilisateurs u ON u.id = m.utilisateur_id
         ${filtre}
        ORDER BY m.cree_le DESC
        LIMIT $${parametres.length + 1} OFFSET $${parametres.length + 2}`,
      [...parametres, limite, decalage],
    ),
    executer(
      `SELECT count(*)::int AS total FROM mouvements_stock m ${filtre}`,
      parametres,
    ),
  ]);
  return { rows: liste.rows, total: total.rows[0]?.total ?? 0 };
}

export async function stockAjuster(acteur, body = {}) {
  if (!estUuid(body.produitId)) {
    throw new ErreurValidation('Produit obligatoire.', { champ: 'produitId' });
  }
  const ajustement = d(String(body.quantite ?? '').replace(',', '.'));
  if (ajustement.isZero()) {
    throw new ErreurValidation('La quantite d ajustement ne peut pas etre nulle.');
  }
  if (ajustement.abs().greaterThan('1000000')) {
    throw new ErreurValidation('Ajustement hors limites.', { champ: 'quantite' });
  }
  const motif = texte(body.motif, { min: 5, max: 200, champ: 'motif' });
  const { rows } = await executer(
    'SELECT fn_ajuster_stock($1, $2, $3, $4) AS resultat',
    [body.produitId, acteur.id, ajustement.toFixed(PRECISION_QUANTITE), motif],
  );
  return rows[0].resultat;
}

export async function inventairesLister({ limite, decalage, statut = null }) {
  const filtre = statut ? 'WHERE i.statut = $3::statut_inventaire' : '';
  const parametres = statut ? [limite, decalage, String(statut).toUpperCase()] : [limite, decalage];
  const filtreTotal = statut ? 'WHERE i.statut = $1::statut_inventaire' : '';
  const parametresTotal = statut ? [String(statut).toUpperCase()] : [];
  const [liste, total] = await Promise.all([
    executer(
      `SELECT i.id, i.numero, i.date_inventaire, i.statut, i.observations,
              i.cree_le, i.valide_le, u.nom_complet AS utilisateur,
              (SELECT count(*)::int FROM lignes_inventaire l
                WHERE l.inventaire_id = i.id) AS nombre_lignes,
              (SELECT coalesce(sum(abs(l.ecart)), 0)::text FROM lignes_inventaire l
                WHERE l.inventaire_id = i.id) AS ecart_total
         FROM inventaires i
         JOIN utilisateurs u ON u.id = i.utilisateur_id
         ${filtre}
        ORDER BY i.date_inventaire DESC
        LIMIT $1 OFFSET $2`,
      parametres,
    ),
    executer(`SELECT count(*)::int AS total FROM inventaires i ${filtreTotal}`, parametresTotal),
  ]);
  return { rows: liste.rows, total: total.rows[0]?.total ?? 0 };
}

export async function inventaireDetail(id) {
  const entete = await executer(
    `SELECT i.*, u.nom_complet AS utilisateur
       FROM inventaires i JOIN utilisateurs u ON u.id = i.utilisateur_id
      WHERE i.id = $1`,
    [id],
  );
  if (!entete.rows[0]) throw new ErreurIntrouvable('Inventaire introuvable.');
  const lignes = await executer(
    `SELECT l.*, p.nom AS produit, p.reference
       FROM lignes_inventaire l JOIN produits p ON p.id = l.produit_id
      WHERE l.inventaire_id = $1 ORDER BY p.nom`,
    [id],
  );
  return { ...entete.rows[0], lignes: lignes.rows };
}

export async function inventaireCreer(acteur, body = {}) {
  const lignes = Array.isArray(body.lignes) ? body.lignes : [];
  if (!lignes.length) {
    throw new ErreurValidation('Un inventaire doit contenir au moins une ligne.');
  }
  const vus = new Set();
  for (const ligne of lignes) {
    if (!estUuid(ligne.produitId)) {
      throw new ErreurValidation('Chaque ligne doit designer un produit valide.');
    }
    if (vus.has(ligne.produitId)) {
      throw new ErreurValidation('Un produit ne peut apparaitre qu une fois dans l inventaire.');
    }
    vus.add(ligne.produitId);
    const stock = await executer('SELECT 1 FROM stocks WHERE produit_id = $1', [ligne.produitId]);
    if (!stock.rows[0]) {
      throw new ErreurValidation('Produit sans fiche de stock.', { champ: 'produitId' });
    }
    quantite(ligne.quantiteComptee, 'quantite comptee', { strictementPositive: false });
  }

  const id = await transaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO inventaires (date_inventaire, utilisateur_id, observations)
       VALUES (coalesce($1::timestamptz, now()), $2, $3) RETURNING id`,
      [
        dateOuNull(body.date),
        acteur.id,
        texteFacultatif(body.observations, { max: 1000, champ: 'observations' }),
      ],
    );
    const inventaireId = rows[0].id;
    for (const ligne of lignes) {
      await client.query(
        `INSERT INTO lignes_inventaire
           (inventaire_id, produit_id, quantite_theorique, quantite_comptee)
         SELECT $1, $2, s.quantite_disponible, $3
           FROM stocks s WHERE s.produit_id = $2`,
        [inventaireId, ligne.produitId, quantite(ligne.quantiteComptee, 'quantite comptee', { strictementPositive: false })],
      );
    }
    return inventaireId;
  });

  await journaliser(acteur, 'CREATION_INVENTAIRE', 'stocks', 'inventaires', id, {
    lignes: lignes.length,
  });
  return inventaireDetail(id);
}

export async function inventaireValider(id, acteur) {
  const { rows } = await executer('SELECT fn_valider_inventaire($1, $2) AS resultat', [
    id,
    acteur.id,
  ]);
  return { ...rows[0].resultat, inventaire: await inventaireDetail(id) };
}

/* -------------------------------------------------------------------------- */
/* Ventes                                                                     */
/* -------------------------------------------------------------------------- */

function peutVoirToutesLesVentes(acteur) {
  return possedePermission(acteur, 'ventes.consulter_toutes');
}

function filtreVente({ statut, recherche, du, au, toutes }, acteur) {
  const conditions = [];
  const parametres = [];
  if (!toutes || !peutVoirToutesLesVentes(acteur)) {
    parametres.push(acteur.id);
    conditions.push(`v.utilisateur_id = $${parametres.length}`);
  }
  if (statut) {
    parametres.push(String(statut).toUpperCase());
    conditions.push(`v.statut = $${parametres.length}::statut_vente`);
  }
  if (recherche) {
    parametres.push(`%${String(recherche).trim()}%`);
    conditions.push(
      `(v.numero ILIKE $${parametres.length} OR u.nom_complet ILIKE $${parametres.length})`,
    );
  }
  if (du) {
    parametres.push(dateOuNull(du));
    conditions.push(`v.date_vente >= $${parametres.length}::timestamptz`);
  }
  if (au) {
    parametres.push(dateOuNull(au));
    conditions.push(`v.date_vente < ($${parametres.length}::timestamptz + interval '1 day')`);
  }
  return {
    filtre: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    parametres,
  };
}

export async function ventesLister({
  limite,
  decalage,
  statut = null,
  recherche = null,
  du = null,
  au = null,
  toutes = false,
  acteur,
}) {
  if (statut && !STATUTS_VENTE.has(String(statut).toUpperCase())) {
    throw new ErreurValidation('Statut de vente invalide.', { champ: 'statut' });
  }
  const { filtre, parametres } = filtreVente({ statut, recherche, du, au, toutes }, acteur);
  const [liste, total] = await Promise.all([
    executer(
      `SELECT v.id, v.numero, v.date_vente, v.statut, v.statut_synchronisation,
              v.montant_brut, v.total_reductions, v.montant_net, v.cout_total,
              v.benefice_brut, v.observations, v.motif_anomalie, v.valide_le,
              v.annule_le, v.cree_le, u.nom_complet AS vendeur,
              (SELECT count(*)::int FROM lignes_vente l WHERE l.vente_id = v.id) AS nombre_lignes
         FROM ventes v
         JOIN utilisateurs u ON u.id = v.utilisateur_id
         ${filtre}
        ORDER BY v.date_vente DESC, v.cree_le DESC
        LIMIT $${parametres.length + 1} OFFSET $${parametres.length + 2}`,
      [...parametres, limite, decalage],
    ),
    executer(
      `SELECT count(*)::int AS total
         FROM ventes v JOIN utilisateurs u ON u.id = v.utilisateur_id
         ${filtre}`,
      parametres,
    ),
  ]);
  return { rows: liste.rows, total: total.rows[0]?.total ?? 0 };
}

async function chargerVente(id) {
  const entete = await executer(
    `SELECT v.*, u.nom_complet AS vendeur, u.email::text AS vendeur_email
       FROM ventes v JOIN utilisateurs u ON u.id = v.utilisateur_id
      WHERE v.id = $1`,
    [id],
  );
  if (!entete.rows[0]) throw new ErreurIntrouvable('Vente introuvable.');

  const [lignes, paiements, demandes] = await Promise.all([
    executer(
      `SELECT l.*, p.nom AS produit, p.reference
         FROM lignes_vente l JOIN produits p ON p.id = l.produit_id
        WHERE l.vente_id = $1 ORDER BY l.id`,
      [id],
    ),
    executer(
      `SELECT id, moyen_paiement, montant, reference_transaction, operateur,
              date_paiement, cree_le
         FROM paiements WHERE vente_id = $1 ORDER BY cree_le, id`,
      [id],
    ),
    executer(
      `SELECT id, statut, motif, commentaire_decision, cree_le, decide_le
         FROM demandes_annulation WHERE vente_id = $1 ORDER BY cree_le DESC`,
      [id],
    ),
  ]);

  return { ...entete.rows[0], lignes: lignes.rows, paiements: paiements.rows, annulations: demandes.rows };
}

export async function venteDetail(id, acteur) {
  const vente = await chargerVente(id);
  if (!peutVoirToutesLesVentes(acteur) && vente.utilisateur_id !== acteur.id) {
    throw new ErreurApplication('Vous ne pouvez consulter que vos propres ventes.', {
      code: 'PERMISSION_MANQUANTE:ventes.consulter_toutes',
      statut: 403,
    });
  }
  return vente;
}

async function parametresBoutique() {
  const { rows } = await executer(
    `SELECT cle, valeur FROM parametres
      WHERE cle IN ('boutique.nom', 'boutique.devise', 'boutique.adresse',
                    'boutique.telephone', 'recus.mentions')`,
  );
  const resultat = {};
  for (const ligne of rows) resultat[ligne.cle] = ligne.valeur;
  return resultat;
}

export async function venteRecu(id, acteur) {
  const vente = await venteDetail(id, acteur);
  return { vente, boutique: await parametresBoutique() };
}

function verifierPaiements(paiements) {
  const prepares = [];
  for (const paiement of paiements) {
    const moyen = String(paiement.moyen ?? paiement.moyenPaiement ?? 'ESPECES').toUpperCase();
    if (!MOYENS_PAIEMENT.has(moyen)) {
      throw new ErreurValidation(`Moyen de paiement inconnu : ${moyen}.`, { champ: 'paiements' });
    }
    const valeur = montant(paiement.montant, 'paiement', { positif: true });
    const reference = texteFacultatif(paiement.reference ?? paiement.referenceTransaction, {
      max: 120,
      champ: 'reference',
    });
    if (urlMobileMoneyRequise(moyen) && (!reference || reference.length < 4)) {
      throw new ErreurValidation(
        'Une reference de transaction est obligatoire pour un paiement Mobile Money.',
        { champ: 'reference' },
      );
    }
    prepares.push({
      moyen,
      montant: valeur,
      reference: urlMobileMoneyRequise(moyen) ? reference : null,
      operateur: texteFacultatif(paiement.operateur, { max: 60, champ: 'operateur' }),
    });
  }
  return prepares;
}

export async function venteCreer(acteur, body = {}, contexte = {}) {
  const lignes = Array.isArray(body.lignes) ? body.lignes : [];
  const paiements = Array.isArray(body.paiements) ? body.paiements : [];
  if (!lignes.length) throw new ErreurValidation('Le panier est vide.');
  if (!paiements.length) throw new ErreurValidation('Au moins un paiement est requis.');

  const cleIdempotence = body.cleIdempotence ?? crypto.randomUUID();
  if (!estUuid(cleIdempotence)) {
    throw new ErreurValidation('Cle d idempotence invalide.', { champ: 'cleIdempotence' });
  }

  const dejaCreee = await executer(
    'SELECT id FROM ventes WHERE cle_idempotence = $1',
    [cleIdempotence],
  );
  if (dejaCreee.rows[0]) {
    const vente = await venteDetail(dejaCreee.rows[0].id, acteur);
    return { ...vente, dejaCreee: true };
  }

  if (!possedePermission(acteur, 'ventes.creer')) {
    throw new ErreurApplication('Permission insuffisante pour enregistrer une vente.', {
      code: 'PERMISSION_MANQUANTE:ventes.creer',
      statut: 403,
    });
  }

  const horsLigne = body.horsLigne === true;
  const statutInitial = horsLigne ? 'EN_ATTENTE_SYNCHRONISATION' : 'BROUILLON';
  const syncInitial = horsLigne ? 'LOCALE' : 'SYNCHRONISEE';
  const reductionGlobale = montant(body.reductionGlobale ?? 0, 'reduction globale');
  const reductionsLignes = lignes.map((l) => montant(l.reduction ?? 0, 'reduction'));
  const contientReduction =
    reductionGlobale.greaterThan(0) || reductionsLignes.some((r) => r.greaterThan(0));
  if (contientReduction) exigerPermission(acteur, 'ventes.accorder_reduction');

  const paiementsPrets = verifierPaiements(paiements);

  const preparer = async (client) => {
    const { rows } = await client.query(
      `INSERT INTO ventes
         (date_vente, utilisateur_id, appareil_id, statut, statut_synchronisation,
          observations, cle_idempotence)
       VALUES (coalesce($1::timestamptz, now()), $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        dateOuNull(body.date),
        acteur.id,
        estUuid(body.appareilId) ? body.appareilId : null,
        statutInitial,
        syncInitial,
        texteFacultatif(body.observations, { max: 1000, champ: 'observations' }),
        cleIdempotence,
      ],
    );
    const venteId = rows[0].id;

    const infos = [];
    for (let index = 0; index < lignes.length; index += 1) {
      const ligne = lignes[index];
      if (!estUuid(ligne.produitId)) {
        throw new ErreurValidation('Chaque ligne doit designer un produit valide.');
      }
      const q = d(quantite(ligne.quantite));
      const { rows: produits } = await client.query(
        `SELECT p.id, p.nom, p.statut, p.prix_vente_reference, p.cout_moyen_pondere,
                s.quantite_disponible, s.quantite_reservee
           FROM produits p
           JOIN stocks s ON s.produit_id = p.id
          WHERE p.id = $1 AND p.supprime_le IS NULL
          FOR UPDATE`,
        [ligne.produitId],
      );
      const produit = produits[0];
      if (!produit) {
        throw new ErreurValidation('Produit introuvable dans le catalogue.', {
          champ: 'produitId',
        });
      }
      if (produit.statut !== 'ACTIF') {
        throw new ErreurConflit('Ce produit est archive et ne peut plus etre vendu.', 'PRODUIT_ARCHIVE');
      }
      const disponible = d(produit.quantite_disponible).minus(produit.quantite_reservee ?? 0);
      if (disponible.lessThan(q)) {
        throw new ErreurApplication(
          `Stock insuffisant pour « ${produit.nom} » : ${disponible.toFixed(3)} disponible(s).`,
          { code: 'STOCK_INSUFFISANT', statut: 422, details: { produitId: produit.id } },
        );
      }
      const prix = arrondir(produit.prix_vente_reference);
      const reduction = reductionsLignes[index];
      if (reduction.greaterThan(arrondir(prix.times(q)))) {
        throw new ErreurValidation(
          `La reduction de la ligne « ${produit.nom} » depasse son montant.`,
          { champ: 'reduction' },
        );
      }
      infos.push({
        produitId: produit.id,
        nom: produit.nom,
        quantite: q,
        prix,
        reduction,
        cmp: d(produit.cout_moyen_pondere),
      });
    }

    const totalBrut = infos.reduce((somme, info) => somme.plus(arrondir(info.prix.times(info.quantite))), d(0));
    if (reductionGlobale.greaterThan(totalBrut)) {
      throw new ErreurValidation('La reduction globale depasse le total du panier.', {
        champ: 'reductionGlobale',
      });
    }

    const parts =
      reductionGlobale.greaterThan(0) && infos.length
        ? repartirReductionGlobale(
            reductionGlobale,
            infos.map((info, index) => ({
              id: String(index).padStart(6, '0'),
              montant: arrondir(info.prix.times(info.quantite)),
            })),
          )
        : infos.map(() => ({ montant: d(0) }));

    const totaux = [];
    for (let index = 0; index < infos.length; index += 1) {
      const info = infos[index];
      const partGlobale = d(parts[index]?.montant ?? 0);
      const netUnitaire = arrondir(
        info.prix.minus(info.reduction.plus(partGlobale).dividedBy(info.quantite)),
      );
      if (netUnitaire.lessThan(info.cmp)) {
        throw new ErreurApplication(
          `Vente bloquee : le prix net de « ${info.nom} » est inferieur a son cout moyen pondere.`,
          { code: 'VENTE_A_PERTE', statut: 422, details: { produitId: info.produitId } },
        );
      }
      totaux.push({ ...info, partGlobale, netUnitaire });
    }

    const netAttendu = totaux.reduce(
      (somme, info) => somme.plus(arrondir(info.netUnitaire.times(info.quantite))),
      d(0),
    );
    const controle = paiementsConformes(
      netAttendu,
      paiementsPrets.map((p) => ({ montant: p.montant })),
    );
    if (!controle.conforme) {
      throw new ErreurApplication(
        `Le total des paiements (${montantTexte(controle.total)}) doit etre exactement egal au montant de la vente (${montantTexte(controle.attendu)}).`,
        {
          code: 'PAIEMENT_NON_CONFORME',
          statut: 422,
          details: { total: montantTexte(controle.total), attendu: montantTexte(controle.attendu) },
        },
      );
    }

    for (const info of totaux) {
      await client.query(
        `INSERT INTO lignes_vente
           (vente_id, produit_id, quantite, prix_reference_unitaire,
            reduction_ligne, remise_globale_affectee, cmp_applique)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          venteId,
          info.produitId,
          info.quantite.toFixed(PRECISION_QUANTITE),
          montantTexte(info.prix),
          montantTexte(info.reduction),
          montantTexte(info.partGlobale),
          d(info.cmp).toFixed(6),
        ],
      );
    }

    if (reductionGlobale.greaterThan(0)) {
      await client.query(
        `INSERT INTO reductions_ventes
           (vente_id, type_reduction, montant, motif, accordee_par)
         VALUES ($1, 'GLOBALE', $2, $3, $4)`,
        [
          venteId,
          montantTexte(reductionGlobale),
          texteFacultatif(body.motifReduction, { max: 200, champ: 'motifReduction' }) ??
            'Reduction globale',
          acteur.id,
        ],
      );
    }

    for (const paiement of paiementsPrets) {
      await client.query(
        `INSERT INTO paiements
           (vente_id, moyen_paiement, montant, reference_transaction, operateur, utilisateur_id)
         VALUES ($1, $2::moyen_paiement, $3, $4, $5, $6)`,
        [
          venteId,
          paiement.moyen,
          montantTexte(paiement.montant),
          paiement.reference,
          paiement.operateur,
          acteur.id,
        ],
      );
    }

    return venteId;
  };

  let venteId;
  if (horsLigne) {
    venteId = await transaction(preparer);
    try {
      await executer('SELECT fn_valider_vente($1, $2)', [venteId, acteur.id]);
    } catch (erreur) {
      const motif = erreur instanceof Error ? erreur.message : 'Validation impossible.';
      await executer(
        `UPDATE ventes
            SET statut = 'ANOMALIE',
                statut_synchronisation = 'CONFLIT',
                motif_anomalie = $2
          WHERE id = $1 AND statut = 'EN_ATTENTE_SYNCHRONISATION'`,
        [venteId, motif.slice(0, 500)],
      );
      const vente = await venteDetail(venteId, acteur);
      return { ...vente, anomalie: true };
    }
  } else {
    venteId = await transaction(async (client) => {
      const id = await preparer(client);
      await client.query('SELECT fn_valider_vente($1, $2)', [id, acteur.id]);
      return id;
    });
  }

  await journaliser(
    acteur,
    'CREATION_VENTE',
    'ventes',
    'ventes',
    venteId,
    { cle_idempotence: cleIdempotence, hors_ligne: horsLigne },
    contexte,
  );

  return { ...(await venteDetail(venteId, acteur)), dejaCreee: false, anomalie: false };
}

export async function venteValider(id, acteur) {
  const { rows } = await executer('SELECT fn_valider_vente($1, $2) AS resultat', [id, acteur.id]);
  return { ...rows[0].resultat, vente: await venteDetail(id, acteur) };
}

/* -------------------------------------------------------------------------- */
/* Paiements                                                                  */
/* -------------------------------------------------------------------------- */

export async function paiementsLister({ limite, decalage, moyen, du, au }) {
  const conditions = [];
  const parametres = [];
  if (moyen) {
    parametres.push(String(moyen).toUpperCase());
    conditions.push(`p.moyen_paiement = $${parametres.length}::moyen_paiement`);
  }
  if (du) {
    parametres.push(dateOuNull(du));
    conditions.push(`p.date_paiement >= $${parametres.length}::timestamptz`);
  }
  if (au) {
    parametres.push(dateOuNull(au));
    conditions.push(`p.date_paiement < ($${parametres.length}::timestamptz + interval '1 day')`);
  }
  const filtre = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [liste, total] = await Promise.all([
    executer(
      `SELECT p.id, p.moyen_paiement, p.montant, p.reference_transaction,
              p.operateur, p.date_paiement, v.numero, v.id AS vente_id,
              u.nom_complet AS encaisse_par
         FROM paiements p
         JOIN ventes v ON v.id = p.vente_id
         JOIN utilisateurs u ON u.id = p.utilisateur_id
         ${filtre}
        ORDER BY p.date_paiement DESC
        LIMIT $${parametres.length + 1} OFFSET $${parametres.length + 2}`,
      [...parametres, limite, decalage],
    ),
    executer(`SELECT count(*)::int AS total FROM paiements p ${filtre}`, parametres),
  ]);
  return { rows: liste.rows, total: total.rows[0]?.total ?? 0 };
}

/* -------------------------------------------------------------------------- */
/* Annulations                                                                */
/* -------------------------------------------------------------------------- */

export async function annulationsLister({ limite, decalage, statut = null }, acteur) {
  const conditions = [];
  const parametres = [];
  if (!possedePermission(acteur, 'ventes.annuler_approuver')) {
    parametres.push(acteur.id);
    conditions.push(`d.demandeur_id = $${parametres.length}`);
  }
  if (statut) {
    parametres.push(String(statut).toUpperCase());
    conditions.push(`d.statut = $${parametres.length}::statut_demande_annulation`);
  }
  const filtre = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [liste, total] = await Promise.all([
    executer(
      `SELECT d.id, d.vente_id, d.motif, d.statut, d.commentaire_decision,
              d.cree_le, d.decide_le, v.numero AS vente_numero,
              v.montant_net, v.date_vente,
              u.nom_complet AS demandeur,
              dec.nom_complet AS decideur
         FROM demandes_annulation d
         JOIN ventes v ON v.id = d.vente_id
         JOIN utilisateurs u ON u.id = d.demandeur_id
         LEFT JOIN utilisateurs dec ON dec.id = d.decideur_id
         ${filtre}
        ORDER BY d.cree_le DESC
        LIMIT $${parametres.length + 1} OFFSET $${parametres.length + 2}`,
      [...parametres, limite, decalage],
    ),
    executer(`SELECT count(*)::int AS total FROM demandes_annulation d ${filtre}`, parametres),
  ]);
  return { rows: liste.rows, total: total.rows[0]?.total ?? 0 };
}

export async function annulationDemander(acteur, body = {}) {
  if (!estUuid(body.venteId)) {
    throw new ErreurValidation('Vente obligatoire.', { champ: 'venteId' });
  }
  const vente = await venteDetail(body.venteId, acteur);
  if (vente.statut !== 'VALIDEE') {
    throw new ErreurConflit('Seule une vente validee peut faire l objet d une annulation.', 'VENTE_NON_VALIDEE');
  }
  const motif = texte(body.motif, { min: 5, max: 500, champ: 'motif' });
  const { rows } = await executer(
    'SELECT fn_creer_demande_annulation($1, $2, $3) AS id',
    [body.venteId, acteur.id, motif],
  );
  const { rows: detail } = await executer(
    `SELECT d.*, v.numero AS vente_numero, u.nom_complet AS demandeur
       FROM demandes_annulation d
       JOIN ventes v ON v.id = d.vente_id
       JOIN utilisateurs u ON u.id = d.demandeur_id
      WHERE d.id = $1`,
    [rows[0].id],
  );
  return detail[0];
}

export async function annulationsStatistiques(acteur) {
  const toutes = possedePermission(acteur, 'ventes.annuler_approuver');
  const { rows } = await executer(
    `SELECT count(*) FILTER (WHERE statut = 'EN_ATTENTE')::int AS en_attente,
            count(*) FILTER (WHERE statut = 'APPROUVEE')::int AS approuvees,
            count(*) FILTER (WHERE statut = 'REJETEE')::int AS rejetees
       FROM demandes_annulation
      ${toutes ? '' : 'WHERE demandeur_id = $1'}`,
    toutes ? [] : [acteur.id],
  );
  return rows[0];
}

export async function annulationDecider(id, acteur, decision, commentaire = null) {
  const statut = String(decision).toUpperCase();
  if (!['APPROUVEE', 'REJETEE'].includes(statut)) {
    throw new ErreurValidation('Decision d annulation invalide.');
  }
  exigerPermission(acteur, 'ventes.annuler_approuver');
  if (statut === 'APPROUVEE') {
    const { rows } = await executer('SELECT fn_approuver_annulation($1, $2, $3) AS resultat', [
      id,
      acteur.id,
      texteFacultatif(commentaire, { max: 500, champ: 'commentaire' }),
    ]);
    return rows[0].resultat;
  }
  await executer('SELECT fn_rejeter_annulation($1, $2, $3)', [
    id,
    acteur.id,
    texte(commentaire, { min: 3, max: 500, champ: 'commentaire' }),
  ]);
  return { id, statut: 'REJETEE' };
}

/* -------------------------------------------------------------------------- */
/* Depenses                                                                   */
/* -------------------------------------------------------------------------- */

export async function categoriesDepenses() {
  const { rows } = await executer(
    'SELECT id, code, nom, description FROM categories_depenses WHERE actif ORDER BY nom',
  );
  return rows;
}

export async function depensesLister({ limite, decalage, statut = null, categorieId = null }, acteur) {
  const conditions = [];
  const parametres = [];
  if (!possedePermission(acteur, 'depenses.consulter')) {
    parametres.push(acteur.id);
    conditions.push(`d.utilisateur_id = $${parametres.length}`);
  }
  if (statut) {
    if (!STATUTS_DEPENSE.has(String(statut).toUpperCase())) {
      throw new ErreurValidation('Statut de depense invalide.', { champ: 'statut' });
    }
    parametres.push(String(statut).toUpperCase());
    conditions.push(`d.statut = $${parametres.length}::statut_depense`);
  }
  if (categorieId) {
    parametres.push(categorieId);
    conditions.push(`d.categorie_id = $${parametres.length}`);
  }
  const filtre = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [liste, total] = await Promise.all([
    executer(
      `SELECT d.id, d.numero, d.montant, d.date_depense, d.description,
              d.justificatif_url, d.statut, d.motif_rejet, d.cree_le,
              c.nom AS categorie, c.code AS categorie_code,
              u.nom_complet AS utilisateur, val.nom_complet AS valide_par
         FROM depenses d
         JOIN categories_depenses c ON c.id = d.categorie_id
         JOIN utilisateurs u ON u.id = d.utilisateur_id
         LEFT JOIN utilisateurs val ON val.id = d.valide_par
         ${filtre}
        ORDER BY d.date_depense DESC, d.cree_le DESC
        LIMIT $${parametres.length + 1} OFFSET $${parametres.length + 2}`,
      [...parametres, limite, decalage],
    ),
    executer(`SELECT count(*)::int AS total FROM depenses d ${filtre}`, parametres),
  ]);
  return { rows: liste.rows, total: total.rows[0]?.total ?? 0 };
}

export async function depensesStatistiques(acteur) {
  const toutes = possedePermission(acteur, 'depenses.consulter');
  const { rows } = await executer(
    `SELECT count(*) FILTER (WHERE statut = 'EN_ATTENTE')::int AS en_attente,
            count(*) FILTER (WHERE statut = 'VALIDEE')::int AS validees,
            count(*) FILTER (WHERE statut = 'REJETEE')::int AS rejetees,
            coalesce(sum(montant) FILTER (WHERE statut = 'VALIDEE'
              AND date_depense >= date_trunc('month', now())), 0)::text AS total_mois
       FROM depenses
      ${toutes ? '' : 'WHERE utilisateur_id = $1'}`,
    toutes ? [] : [acteur.id],
  );
  return rows[0];
}

export async function depenseCreer(acteur, body = {}) {
  if (!estUuid(body.categorieId)) {
    throw new ErreurValidation('Categorie de depense obligatoire.', { champ: 'categorieId' });
  }
  const categorie = await executer(
    'SELECT id FROM categories_depenses WHERE id = $1 AND actif',
    [body.categorieId],
  );
  if (!categorie.rows[0]) {
    throw new ErreurValidation('Categorie de depense introuvable.', { champ: 'categorieId' });
  }
  const cleIdempotence = body.cleIdempotence ?? null;
  if (cleIdempotence !== null && !estUuid(cleIdempotence)) {
    throw new ErreurValidation('Cle d idempotence invalide.', { champ: 'cleIdempotence' });
  }

  const { rows } = await executer(
    'SELECT fn_creer_depense($1, $2, $3, $4, $5, $6, $7) AS id',
    [
      acteur.id,
      body.categorieId,
      montantTexte(montant(body.montant, 'montant', { positif: true })),
      texte(body.description, { min: 3, max: 1000, champ: 'description' }),
      dateOuNull(body.date) ?? new Date().toISOString(),
      texteFacultatif(body.justificatifUrl, { max: 1000, champ: 'justificatifUrl' }),
      cleIdempotence,
    ],
  );
  const { rows: detail } = await executer(
    `SELECT d.*, c.nom AS categorie, u.nom_complet AS utilisateur
       FROM depenses d
       JOIN categories_depenses c ON c.id = d.categorie_id
       JOIN utilisateurs u ON u.id = d.utilisateur_id
      WHERE d.id = $1`,
    [rows[0].id],
  );
  return detail[0];
}

export async function depenseDecider(id, acteur, decision, motif = null) {
  const statut = String(decision).toUpperCase();
  exigerPermission(acteur, 'depenses.valider');
  if (statut === 'VALIDEE') {
    await executer('SELECT fn_valider_depense($1, $2)', [id, acteur.id]);
  } else if (statut === 'REJETEE') {
    await executer('SELECT fn_rejeter_depense($1, $2, $3)', [
      id,
      acteur.id,
      texte(motif, { min: 3, max: 500, champ: 'motif' }),
    ]);
  } else {
    throw new ErreurValidation('Decision de depense invalide.');
  }
  const { rows } = await executer('SELECT * FROM depenses WHERE id = $1', [id]);
  return rows[0];
}

/* -------------------------------------------------------------------------- */
/* Tableau de bord et rapports                                                */
/* -------------------------------------------------------------------------- */

export async function tableauDeBord(acteur) {
  const global = possedePermission(acteur, 'ventes.consulter_toutes');
  const beneficesVisibles =
    possedePermission(acteur, 'benefices.consulter') || acteur.estProprietaire === true;
  const filtreVentes = global ? '' : 'AND v.utilisateur_id = $1';
  const parametresVentes = global ? [] : [acteur.id];

  const [periodes, stocks, top, serie, recentes, depenses] = await Promise.all([
    executer(
      `SELECT
         coalesce(sum(v.montant_net) FILTER (WHERE v.date_vente >= date_trunc('day', now())), 0)::text AS ca_jour,
         coalesce(sum(v.montant_net) FILTER (WHERE v.date_vente >= date_trunc('week', now())), 0)::text AS ca_semaine,
         coalesce(sum(v.montant_net) FILTER (WHERE v.date_vente >= date_trunc('month', now())), 0)::text AS ca_mois,
         coalesce(sum(v.benefice_brut) FILTER (WHERE v.date_vente >= date_trunc('day', now())), 0)::text AS benefice_jour,
         coalesce(sum(v.benefice_brut) FILTER (WHERE v.date_vente >= date_trunc('month', now())), 0)::text AS benefice_mois,
         count(*) FILTER (WHERE v.date_vente >= date_trunc('day', now()))::int AS ventes_jour,
         count(*) FILTER (WHERE v.date_vente >= date_trunc('month', now()))::int AS ventes_mois
       FROM ventes v
      WHERE v.statut = 'VALIDEE' ${filtreVentes}`,
      parametresVentes,
    ),
    executer(
      `SELECT count(*) FILTER (WHERE p.statut = 'ACTIF')::int AS produits_actifs,
              count(*) FILTER (WHERE s.quantite_disponible <= 0)::int AS ruptures,
              count(*) FILTER (WHERE s.quantite_disponible > 0
                                AND s.quantite_disponible <= p.seuil_alerte)::int AS alertes_stock,
              coalesce(sum(round(s.quantite_disponible * p.cout_moyen_pondere, 2)), 0)::text AS valeur_stock
         FROM produits p JOIN stocks s ON s.produit_id = p.id
        WHERE p.supprime_le IS NULL`,
    ),
    executer(
      `SELECT p.id, p.nom, p.reference,
              sum(l.quantite)::text AS quantite,
              sum(round(l.prix_net_unitaire * l.quantite, 2))::text AS chiffre_affaires
         FROM lignes_vente l
         JOIN ventes v ON v.id = l.vente_id
         JOIN produits p ON p.id = l.produit_id
        WHERE v.statut = 'VALIDEE'
          AND v.date_vente >= now() - interval '30 days'
          ${global ? '' : 'AND v.utilisateur_id = $1'}
        GROUP BY p.id, p.nom, p.reference
        ORDER BY sum(l.quantite) DESC
        LIMIT 5`,
      parametresVentes,
    ),
    executer(
      `SELECT to_char(jour, 'YYYY-MM-DD') AS jour,
              coalesce(sum(v.montant_net), 0)::text AS ca,
              coalesce(sum(v.benefice_brut), 0)::text AS benefice,
              count(v.id)::int AS ventes
         FROM generate_series(
                date_trunc('day', now()) - interval '6 days',
                date_trunc('day', now()), interval '1 day') AS jour
         LEFT JOIN ventes v
           ON v.date_vente >= jour AND v.date_vente < jour + interval '1 day'
          AND v.statut = 'VALIDEE'
          ${global ? '' : 'AND v.utilisateur_id = $1'}
        GROUP BY jour ORDER BY jour`,
      parametresVentes,
    ),
    executer(
      `SELECT v.id, v.numero, v.statut, v.montant_net, v.date_vente,
              u.nom_complet AS vendeur
         FROM ventes v JOIN utilisateurs u ON u.id = v.utilisateur_id
        WHERE v.statut IN ('VALIDEE', 'ANOMALIE')
          ${global ? '' : 'AND v.utilisateur_id = $1'}
        ORDER BY v.date_vente DESC LIMIT 5`,
      parametresVentes,
    ),
    beneficesVisibles
      ? executer(
          `SELECT coalesce(sum(montant) FILTER (WHERE statut = 'VALIDEE'
                    AND date_depense >= date_trunc('day', now())), 0)::text AS depenses_jour,
                  coalesce(sum(montant) FILTER (WHERE statut = 'VALIDEE'
                    AND date_depense >= date_trunc('month', now())), 0)::text AS depenses_mois
             FROM depenses`,
        )
      : Promise.resolve({ rows: [{ depenses_jour: null, depenses_mois: null }] }),
  ]);

  const p = periodes.rows[0];
  const dep = depenses.rows[0];
  return {
    portee: global ? 'GLOBALE' : 'PROPRE',
    beneficesVisibles,
    periode: {
      jour: {
        chiffreAffaires: p.ca_jour,
        benefice: beneficesVisibles ? p.benefice_jour : null,
        depenses: beneficesVisibles ? dep.depenses_jour : null,
        ventes: p.ventes_jour,
      },
      semaine: { chiffreAffaires: p.ca_semaine },
      mois: {
        chiffreAffaires: p.ca_mois,
        benefice: beneficesVisibles ? p.benefice_mois : null,
        depenses: beneficesVisibles ? dep.depenses_mois : null,
        ventes: p.ventes_mois,
      },
    },
    stocks: stocks.rows[0],
    topProduits: beneficesVisibles ? top.rows : [],
    serieJournaliere: serie.rows,
    ventesRecentes: recentes.rows,
  };
}

export async function rapport({ debut = null, fin = null } = {}) {
  const a = dateOuNull(debut) ?? '1900-01-01T00:00:00Z';
  const b = dateFinOuNull(fin) ?? '2999-12-31T23:59:59Z';
  if (new Date(a) > new Date(b)) {
    throw new ErreurValidation('La date de debut doit preceder la date de fin.', {
      champ: 'periode',
    });
  }

  const [resume, serie, top, vendeurs, categories, stocks] = await Promise.all([
    executer(
      `SELECT coalesce(sum(v.montant_net), 0)::text AS chiffre_affaires,
              coalesce(sum(v.benefice_brut), 0)::text AS benefice_brut,
              coalesce(sum(v.cout_total), 0)::text AS cout_marchandises,
              count(*)::int AS nombre_ventes,
              coalesce(avg(v.montant_net), 0)::text AS panier_moyen
         FROM ventes v
        WHERE v.statut = 'VALIDEE' AND v.date_vente BETWEEN $1::timestamptz AND $2::timestamptz`,
      [a, b],
    ),
    executer(
      `SELECT to_char(date_trunc('day', v.date_vente), 'YYYY-MM-DD') AS jour,
              coalesce(sum(v.montant_net), 0)::text AS ca,
              coalesce(sum(v.benefice_brut), 0)::text AS benefice,
              count(*)::int AS ventes
         FROM ventes v
        WHERE v.statut = 'VALIDEE' AND v.date_vente BETWEEN $1::timestamptz AND $2::timestamptz
        GROUP BY 1 ORDER BY 1`,
      [a, b],
    ),
    executer(
      `SELECT p.nom, p.reference, sum(l.quantite)::text AS quantite,
              sum(round(l.prix_net_unitaire * l.quantite, 2))::text AS chiffre_affaires,
              sum(l.benefice_brut_ligne)::text AS benefice
         FROM lignes_vente l
         JOIN ventes v ON v.id = l.vente_id
         JOIN produits p ON p.id = l.produit_id
        WHERE v.statut = 'VALIDEE' AND v.date_vente BETWEEN $1::timestamptz AND $2::timestamptz
        GROUP BY p.id, p.nom, p.reference
        ORDER BY sum(l.quantite) DESC LIMIT 10`,
      [a, b],
    ),
    executer(
      `SELECT u.nom_complet AS vendeur, count(*)::int AS ventes,
              coalesce(sum(v.montant_net), 0)::text AS chiffre_affaires
         FROM ventes v JOIN utilisateurs u ON u.id = v.utilisateur_id
        WHERE v.statut = 'VALIDEE' AND v.date_vente BETWEEN $1::timestamptz AND $2::timestamptz
        GROUP BY u.id, u.nom_complet ORDER BY sum(v.montant_net) DESC`,
      [a, b],
    ),
    executer(
      `SELECT c.nom AS categorie, count(*)::int AS nombre,
              coalesce(sum(d.montant), 0)::text AS montant
         FROM depenses d JOIN categories_depenses c ON c.id = d.categorie_id
        WHERE d.statut = 'VALIDEE' AND d.date_depense BETWEEN $1::timestamptz AND $2::timestamptz
        GROUP BY c.id, c.nom ORDER BY sum(d.montant) DESC`,
      [a, b],
    ),
    executer(
      `SELECT count(*) FILTER (WHERE s.quantite_disponible <= 0)::int AS ruptures,
              count(*) FILTER (WHERE s.quantite_disponible > 0
                                AND s.quantite_disponible <= p.seuil_alerte)::int AS alertes,
              coalesce(sum(round(s.quantite_disponible * p.cout_moyen_pondere, 2)), 0)::text AS valeur
         FROM produits p JOIN stocks s ON s.produit_id = p.id
        WHERE p.supprime_le IS NULL AND p.statut = 'ACTIF'`,
    ),
  ]);

  const depenses = categories.rows.reduce((somme, ligne) => somme.plus(d(ligne.montant)), d(0));
  const beneficeNet = d(resume.rows[0].benefice_brut).minus(depenses);
  return {
    periode: { debut: a, fin: b },
    resume: {
      ...resume.rows[0],
      depenses: montantTexte(depenses),
      benefice_net: montantTexte(beneficeNet),
    },
    serieJournaliere: serie.rows,
    topProduits: top.rows,
    vendeurs: vendeurs.rows,
    depensesParCategorie: categories.rows,
    stocks: stocks.rows[0],
  };
}

/* -------------------------------------------------------------------------- */
/* Parametres, appareils et synchronisation                                   */
/* -------------------------------------------------------------------------- */

export async function parametresLister() {
  const { rows } = await executer(
    `SELECT cle, valeur, description, modifie_le FROM parametres ORDER BY cle`,
  );
  return rows;
}

export async function parametreModifier(acteur, cle, valeur, contexte = {}) {
  const existant = await executer('SELECT cle FROM parametres WHERE cle = $1', [cle]);
  if (!existant.rows[0]) throw new ErreurIntrouvable('Parametre introuvable.');

  let json;
  try {
    json = JSON.stringify(valeur ?? null);
  } catch {
    throw new ErreurValidation('Valeur de parametre invalide.');
  }
  const { rows } = await executer(
    `UPDATE parametres
        SET valeur = $2::jsonb, modifie_le = now()
      WHERE cle = $1
      RETURNING cle, valeur, description, modifie_le`,
    [cle, json],
  );
  await journaliser(acteur, 'MODIFICATION_PARAMETRE', 'administration', 'parametres', null, {
    cle,
    valeur: json,
  }, contexte);
  return rows[0];
}

export async function appareilsLister() {
  const { rows } = await executer(
    `SELECT a.id, a.code, a.nom, a.plateforme, a.actif, a.derniere_synchronisation,
            a.cree_le, a.modifie_le, u.nom_complet AS utilisateur
       FROM appareils a LEFT JOIN utilisateurs u ON u.id = a.utilisateur_id
      ORDER BY a.actif DESC, a.nom`,
  );
  return rows;
}

export async function appareilEnregistrer(acteur, body = {}) {
  const code = texte(body.code, { min: 3, max: 60, champ: 'code' }).toUpperCase();
  const nom = texte(body.nom ?? body.code, { min: 2, max: 120, champ: 'nom' });
  const plateforme = texteFacultatif(body.plateforme, { max: 60, champ: 'plateforme' });

  const { rows } = await executer(
    `INSERT INTO appareils (code, nom, plateforme, utilisateur_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (code) DO UPDATE
       SET nom = excluded.nom,
           plateforme = excluded.plateforme,
           actif = true,
           utilisateur_id = excluded.utilisateur_id
     RETURNING id, code, nom, plateforme, actif, cree_le`,
    [code, nom, plateforme, acteur.id],
  );
  await journaliser(acteur, 'ENREGISTREMENT_APPAREIL', 'synchronisation', 'appareils', rows[0].id, {
    code,
  });
  return rows[0];
}

export async function appareilModifier(acteur, id, body = {}) {
  const { rows } = await executer(
    `UPDATE appareils
        SET actif = coalesce($2, actif),
            nom = coalesce($3, nom)
      WHERE id = $1
      RETURNING id, code, nom, plateforme, actif`,
    [
      id,
      body.actif === undefined ? null : Boolean(body.actif),
      body.nom === undefined ? null : texte(body.nom, { min: 2, max: 120, champ: 'nom' }),
    ],
  );
  if (!rows[0]) throw new ErreurIntrouvable('Appareil introuvable.');
  await journaliser(acteur, 'MODIFICATION_APPAREIL', 'synchronisation', 'appareils', id, {
    actif: rows[0].actif,
  });
  return rows[0];
}

export async function synchroniser(acteur, body = {}) {
  if (!estUuid(body.appareilId)) {
    throw new ErreurValidation('Appareil obligatoire.', { champ: 'appareilId' });
  }
  if (!estUuid(body.cleIdempotence)) {
    throw new ErreurValidation('Cle d idempotence obligatoire.', { champ: 'cleIdempotence' });
  }
  const { rows } = await executer(
    'SELECT fn_enregistrer_operation_synchronisation($1, $2, $3, $4, $5, $6, $7::jsonb) AS resultat',
    [
      body.appareilId,
      acteur.id,
      texte(body.typeOperation ?? 'SYNCHRONISATION', { min: 3, max: 60, champ: 'typeOperation' }),
      texte(body.entite ?? 'VENTE', { min: 3, max: 60, champ: 'entite' }),
      estUuid(body.entiteId) ? body.entiteId : null,
      body.cleIdempotence,
      JSON.stringify(body.charge ?? {}),
    ],
  );
  return rows[0].resultat;
}

export async function conflitsLister({ limite, decalage, statut = null }) {
  const filtre = statut ? 'WHERE c.statut = $3::statut_conflit' : '';
  const parametres = statut ? [limite, decalage, String(statut).toUpperCase()] : [limite, decalage];
  const filtreTotal = statut ? 'WHERE c.statut = $1::statut_conflit' : '';
  const parametresTotal = statut ? [String(statut).toUpperCase()] : [];
  const [liste, total] = await Promise.all([
    executer(
      `SELECT c.id, c.type_conflit, c.description, c.donnees, c.statut,
              c.resolution, c.cree_le, c.resolu_le,
              o.cle_idempotence, o.entite, o.entite_id,
              u.nom_complet AS resolu_par
         FROM conflits_synchronisation c
         JOIN operations_synchronisation o ON o.id = c.operation_id
         LEFT JOIN utilisateurs u ON u.id = c.resolu_par
         ${filtre}
        ORDER BY c.cree_le DESC
        LIMIT $1 OFFSET $2`,
      parametres,
    ),
    executer(
      `SELECT count(*)::int AS total FROM conflits_synchronisation c ${filtreTotal}`,
      parametresTotal,
    ),
  ]);
  return { rows: liste.rows, total: total.rows[0]?.total ?? 0 };
}

export async function conflitResoudre(acteur, id, body = {}) {
  const statut = String(body.statut ?? 'RESOLU').toUpperCase();
  if (!['EN_COURS', 'RESOLU', 'REJETE'].includes(statut)) {
    throw new ErreurValidation('Statut de resolution invalide.', { champ: 'statut' });
  }
  const resolution = texte(body.resolution, { min: 5, max: 1000, champ: 'resolution' });
  const { rows } = await executer(
    `UPDATE conflits_synchronisation
        SET statut = $2::statut_conflit,
            resolution = $3,
            resolu_par = $4,
            resolu_le = CASE WHEN $2 IN ('RESOLU', 'REJETE') THEN now() ELSE NULL END
      WHERE id = $1
      RETURNING id, statut, resolution, resolu_le`,
    [id, statut, resolution, acteur.id],
  );
  if (!rows[0]) throw new ErreurIntrouvable('Conflit introuvable.');
  await journaliser(acteur, 'RESOLUTION_CONFLIT', 'synchronisation', 'conflits', id, {
    statut,
    resolution,
  });
  return rows[0];
}

export async function etatSynchronisation(acteur) {
  const [operations, conflits] = await Promise.all([
    executer(
      `SELECT count(*) FILTER (WHERE statut = 'RECUE')::int AS recues,
              count(*) FILTER (WHERE statut = 'TRAITEE')::int AS traitees,
              count(*) FILTER (WHERE statut = 'ECHEC')::int AS echecs,
              count(*) FILTER (WHERE statut = 'CONFLIT')::int AS conflits
         FROM operations_synchronisation
        WHERE utilisateur_id = $1`,
      [acteur.id],
    ),
    executer(
      `SELECT count(*)::int AS ouverts FROM conflits_synchronisation WHERE statut IN ('OUVERT', 'EN_COURS')`,
    ),
  ]);
  return { operations: operations.rows[0], conflits: conflits.rows[0] };
}

export default {
  fournisseursLister,
  fournisseursOptions,
  fournisseurDetail,
  fournisseurCreer,
  fournisseurModifier,
  fournisseurSupprimer,
  approvisionnementsLister,
  approvisionnementDetail,
  approvisionnementCreer,
  approvisionnementValider,
  stocksLister,
  stocksStatistiques,
  stocksAlertes,
  mouvementsLister,
  stockAjuster,
  inventairesLister,
  inventaireDetail,
  inventaireCreer,
  inventaireValider,
  ventesLister,
  venteDetail,
  venteRecu,
  venteCreer,
  venteValider,
  paiementsLister,
  annulationsLister,
  annulationsStatistiques,
  annulationDemander,
  annulationDecider,
  categoriesDepenses,
  depensesLister,
  depensesStatistiques,
  depenseCreer,
  depenseDecider,
  tableauDeBord,
  rapport,
  parametresLister,
  parametreModifier,
  appareilsLister,
  appareilEnregistrer,
  appareilModifier,
  synchroniser,
  conflitsLister,
  conflitResoudre,
  etatSynchronisation,
};
