/**
 * Format de reponse uniforme de l'API.
 *
 * Succes : { succes: true, donnees: ..., meta: ... }
 * Erreur  : { succes: false, erreur: { code, message, details }, requeteId }
 */
export function succes(reponse, donnees = null, meta = undefined, statut = 200) {
  const corps = { succes: true, donnees };
  if (meta !== undefined) corps.meta = meta;
  return reponse.status(statut).json(corps);
}

export function cree(reponse, donnees, meta) {
  return succes(reponse, donnees, meta, 201);
}

export function echec(reponse, { code = 'ERREUR', message = 'Erreur.', details = null }, statut = 400) {
  return reponse.status(statut).json({
    succes: false,
    erreur: { code, message, ...(details ? { details } : {}) },
    requeteId: reponse.locals.requeteId ?? null,
  });
}
