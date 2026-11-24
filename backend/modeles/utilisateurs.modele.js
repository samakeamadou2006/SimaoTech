/**
 * Modele d'acces aux donnees : utilisateurs, roles et permissions.
 * Aucune logique metier ici, uniquement des requetes SQL parametrees.
 */
import { executer, transaction } from '../configuration/base_de_donnees.js';

const COLONNES_PROFIL = `
  u.id,
  u.email,
  u.nom_complet,
  u.telephone,
  u.actif,
  u.role_id,
  u.doit_changer_mot_de_passe,
  u.derniere_connexion,
  u.cree_le,
  u.modifie_le,
  u.supprime_le,
  r.code  AS role_code,
  r.nom   AS role_nom
`;

const PERMISSIONS_EFFECTIVES = `
  SELECT p.code
    FROM permissions p
    JOIN role_permissions rp ON rp.permission_id = p.id
   WHERE rp.role_id = $1
   UNION
  SELECT p.code
    FROM permissions p
    JOIN utilisateur_permissions up ON up.permission_id = p.id
   WHERE up.utilisateur_id = $2
     AND up.accorde = TRUE
   EXCEPT
  SELECT p.code
    FROM permissions p
    JOIN utilisateur_permissions up ON up.permission_id = p.id
   WHERE up.utilisateur_id = $2
     AND up.accorde = FALSE
   ORDER BY 1
`;

/** Profil complet d'un utilisateur, avec ses permissions effectives. */
export async function trouverProfilParId(id) {
  const { rows } = await executer(
    `SELECT ${COLONNES_PROFIL}
       FROM utilisateurs u
       JOIN roles r ON r.id = u.role_id
      WHERE u.id = $1
        AND u.supprime_le IS NULL`,
    [id],
  );
  if (!rows[0]) return null;

  const profil = rows[0];

  const { rows: permissions } = await executer(PERMISSIONS_EFFECTIVES, [profil.role_id, id]);
  profil.permissions = permissions.map((p) => p.code);
  return profil;
}

export async function trouverParEmail(email) {
  const { rows } = await executer(
    `SELECT ${COLONNES_PROFIL} FROM utilisateurs u JOIN roles r ON r.id = u.role_id
      WHERE lower(u.email::text) = lower($1) AND u.supprime_le IS NULL`,
    [email],
  );
  return rows[0] ?? null;
}

/**
 * Liste paginee avec recherche et filtres. Le total est calcule sur le meme
 * filtre pour que la pagination reste fiable.
 */
export async function listerUtilisateurs({
  limite = 50,
  decalage = 0,
  recherche = null,
  roleCode = null,
  actif = null,
} = {}) {
  const conditions = ['u.supprime_le IS NULL'];
  const parametres = [];

  if (recherche) {
    parametres.push(`%${recherche}%`);
    conditions.push(
      `(u.nom_complet ILIKE $${parametres.length} OR u.email::text ILIKE $${parametres.length})`,
    );
  }
  if (roleCode) {
    parametres.push(roleCode);
    conditions.push(`r.code = $${parametres.length}`);
  }
  if (actif !== null) {
    parametres.push(actif);
    conditions.push(`u.actif = $${parametres.length}`);
  }

  const filtre = conditions.join(' AND ');
  const [liste, total] = await Promise.all([
    executer(
      `SELECT ${COLONNES_PROFIL}
         FROM utilisateurs u
         JOIN roles r ON r.id = u.role_id
        WHERE ${filtre}
        ORDER BY u.actif DESC, u.nom_complet, u.email
        LIMIT $${parametres.length + 1} OFFSET $${parametres.length + 2}`,
      [...parametres, limite, decalage],
    ),
    executer(
      `SELECT count(*)::int AS total
         FROM utilisateurs u
         JOIN roles r ON r.id = u.role_id
        WHERE ${filtre}`,
      parametres,
    ),
  ]);

  return { utilisateurs: liste.rows, total: total.rows[0]?.total ?? 0 };
}

/** Detail complet : profil, permissions du role, derogations et effectives. */
export async function trouverDetail(id) {
  const profil = await trouverProfilParId(id);
  if (!profil) return null;

  const [role, derogations] = await Promise.all([
    executer(
      `SELECT p.id, p.code, p.nom, p.module
         FROM permissions p
         JOIN role_permissions rp ON rp.permission_id = p.id
        WHERE rp.role_id = $1
        ORDER BY p.module, p.code`,
      [profil.role_id],
    ),
    executer(
      `SELECT up.permission_id, up.accorde, p.code, p.nom, p.module
         FROM utilisateur_permissions up
         JOIN permissions p ON p.id = up.permission_id
        WHERE up.utilisateur_id = $1
        ORDER BY p.module, p.code`,
      [id],
    ),
  ]);

  return {
    ...profil,
    permissions_role: role.rows,
    derogations: derogations.rows,
    permissions_effectives: profil.permissions,
  };
}

export async function toucherDerniereConnexion(id) {
  await executer(
    `UPDATE utilisateurs SET derniere_connexion = now() WHERE id = $1 AND supprime_le IS NULL`,
    [id],
  );
}

export async function creerProfil({
  id,
  email,
  nomComplet,
  telephone = null,
  roleId,
  doitChangerMotDePasse = false,
}) {
  const { rows } = await executer(
    `INSERT INTO utilisateurs (id, email, nom_complet, telephone, role_id, doit_changer_mot_de_passe)
     VALUES ($1, lower($2), $3, $4, $5, $6)
     RETURNING id, email, nom_complet, telephone, role_id, actif, doit_changer_mot_de_passe, cree_le`,
    [id, email, nomComplet, telephone, roleId, doitChangerMotDePasse],
  );
  return rows[0];
}

/**
 * Met a jour le profil avec les valeurs finales (deja resolues par le service).
 * Aucun COALESCE : le service decide explicitement de chaque champ.
 */
export async function majProfil(
  id,
  { nomComplet, telephone, roleId, actif, doitChangerMotDePasse },
) {
  const { rows } = await executer(
    `UPDATE utilisateurs
        SET nom_complet = $2,
            telephone = $3,
            role_id = $4,
            actif = $5,
            doit_changer_mot_de_passe = $6,
            modifie_le = now()
      WHERE id = $1 AND supprime_le IS NULL
      RETURNING id, email, nom_complet, telephone, role_id, actif, doit_changer_mot_de_passe, modifie_le`,
    [id, nomComplet, telephone, roleId, actif, doitChangerMotDePasse],
  );
  return rows[0] ?? null;
}

/** Effacement logique : le compte n'est jamais supprime physiquement. */
export async function marquerSupprime(id) {
  const { rows } = await executer(
    `UPDATE utilisateurs
        SET actif = false,
            supprime_le = now(),
            modifie_le = now()
      WHERE id = $1 AND supprime_le IS NULL
      RETURNING id, email, supprime_le`,
    [id],
  );
  return rows[0] ?? null;
}

export async function marquerMotDePasseChange(id) {
  await executer(
    `UPDATE utilisateurs
        SET doit_changer_mot_de_passe = false,
            modifie_le = now()
      WHERE id = $1 AND supprime_le IS NULL`,
    [id],
  );
}

export async function trouverRoleParCode(code) {
  const { rows } = await executer(
    `SELECT id, code, nom, description, est_systeme FROM roles WHERE code = $1`,
    [code],
  );
  return rows[0] ?? null;
}

export async function listerRoles() {
  const { rows } = await executer(`SELECT id, code, nom, description FROM roles ORDER BY nom`);
  return rows;
}

export async function listerRolesAvecPermissions() {
  const roles = await listerRoles();
  const { rows } = await executer(
    `SELECT rp.role_id, p.code
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
      ORDER BY p.code`,
  );
  const parRole = new Map();
  for (const ligne of rows) {
    if (!parRole.has(ligne.role_id)) parRole.set(ligne.role_id, []);
    parRole.get(ligne.role_id).push(ligne.code);
  }
  return roles.map((role) => ({ ...role, permissions: parRole.get(role.id) ?? [] }));
}

export async function listerPermissions() {
  const { rows } = await executer(
    `SELECT id, code, nom, module, description FROM permissions ORDER BY module, code`,
  );
  return rows;
}

export async function trouverPermissionsParIds(ids) {
  if (ids.length === 0) return [];
  const { rows } = await executer(
    `SELECT id, code, nom, module FROM permissions WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  return rows;
}

/**
 * Remplace toutes les derogations d'un utilisateur dans une transaction.
 * @param {Array<{permissionId: string, accorde: boolean}>} derogations
 */
export async function remplacerDerogations(utilisateurId, derogations, acteurId) {
  return transaction(async (client) => {
    await client.query('DELETE FROM utilisateur_permissions WHERE utilisateur_id = $1', [
      utilisateurId,
    ]);
    for (const derogation of derogations) {
      await client.query(
        `INSERT INTO utilisateur_permissions
           (utilisateur_id, permission_id, accorde, accorde_par)
         VALUES ($1, $2, $3, $4)`,
        [utilisateurId, derogation.permissionId, derogation.accorde, acteurId],
      );
    }
    return derogations.length;
  });
}

export async function compterProprietairesActifs({ exclureId = null } = {}) {
  const { rows } = await executer(
    `SELECT count(*)::int AS total
       FROM utilisateurs u
       JOIN roles r ON r.id = u.role_id
      WHERE r.code = 'PROPRIETAIRE'
        AND u.actif
        AND u.supprime_le IS NULL
        AND ($1::uuid IS NULL OR u.id <> $1::uuid)`,
    [exclureId],
  );
  return rows[0]?.total ?? 0;
}

export async function compterAdministrateursActifs({ exclureId = null } = {}) {
  const { rows } = await executer(
    `SELECT count(*)::int AS total
       FROM utilisateurs u
       JOIN roles r ON r.id = u.role_id
      WHERE r.code IN ('PROPRIETAIRE', 'ADMINISTRATEUR')
        AND u.actif
        AND u.supprime_le IS NULL
        AND ($1::uuid IS NULL OR u.id <> $1::uuid)`,
    [exclureId],
  );
  return rows[0]?.total ?? 0;
}

/** Compteurs globaux pour l'ecran d'administration. */
export async function statistiquesUtilisateurs() {
  const { rows } = await executer(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE u.actif)::int AS actifs,
            count(*) FILTER (WHERE r.code = 'PROPRIETAIRE')::int AS proprietaires,
            count(*) FILTER (WHERE r.code = 'ADMINISTRATEUR')::int AS administrateurs,
            count(*) FILTER (WHERE u.doit_changer_mot_de_passe)::int AS mot_de_passe_a_changer
       FROM utilisateurs u
       JOIN roles r ON r.id = u.role_id
      WHERE u.supprime_le IS NULL`,
  );
  return rows[0];
}

/** Journal d'audit applicatif (immuable, en ajout seul). */
export async function journaliser({
  utilisateurId = null,
  action,
  module,
  entite = null,
  entiteId = null,
  details = {},
  adresseIp = null,
  requeteId = null,
}) {
  await executer(
    `INSERT INTO journal_activites
       (utilisateur_id, action, module, entite, entite_id, details, adresse_ip, requete_id)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::inet, $8)`,
    [
      utilisateurId,
      action,
      module,
      entite,
      entiteId,
      JSON.stringify(details ?? {}),
      adresseIp,
      requeteId,
    ],
  );
}

export default {
  trouverProfilParId,
  trouverParEmail,
  listerUtilisateurs,
  trouverDetail,
  toucherDerniereConnexion,
  creerProfil,
  majProfil,
  marquerSupprime,
  marquerMotDePasseChange,
  trouverRoleParCode,
  listerRoles,
  listerRolesAvecPermissions,
  listerPermissions,
  trouverPermissionsParIds,
  remplacerDerogations,
  compterProprietairesActifs,
  compterAdministrateursActifs,
  statistiquesUtilisateurs,
  journaliser,
};
