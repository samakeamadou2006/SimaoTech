/**
 * Gestion centralisee des erreurs et des routes inconnues.
 */
import crypto from 'node:crypto';
import journal from '../configuration/journal.js';
import { traduireErreurPostgres, ErreurIntrouvable } from '../utils/erreurs.js';
import { echec } from '../utils/reponses.js';

export function identifiantRequete(requete, reponse, suivant) {
  requete.id = requete.headers['x-request-id'] || crypto.randomUUID();
  reponse.locals.requeteId = requete.id;
  reponse.setHeader('x-request-id', requete.id);
  suivant();
}

export function routeInconnue(requete, reponse, suivant) {
  suivant(new ErreurIntrouvable(`La route ${requete.method} ${requete.originalUrl} n existe pas.`));
}

// eslint-disable-next-line no-unused-vars
export function gestionErreurs(erreur, requete, reponse, suivant) {
  const traduite = traduireErreurPostgres(erreur);
  const statut = traduite.statutHttp ?? 500;
  const contexte = {
    requeteId: requete.id,
    methode: requete.method,
    url: requete.originalUrl,
    utilisateur: requete.utilisateur?.id ?? null,
    code: traduite.code,
  };

  if (statut >= 500) {
    journal.error({ ...contexte, erreur: erreur.message, pile: erreur.stack }, 'Erreur serveur');
  } else if (statut >= 400) {
    journal.warn({ ...contexte, message: traduite.message }, 'Requete refusee');
  }

  if (reponse.headersSent) return;

  echec(
    reponse,
    {
      code: traduite.code ?? 'ERREUR',
      message: traduite.expose
        ? traduite.message
        : 'Une erreur interne est survenue. Consultez les journaux avec l identifiant de requete.',
      details: traduite.details,
    },
    statut,
  );
}

export default { identifiantRequete, routeInconnue, gestionErreurs };
