/**
 * Client HTTP de l'API SimaoTech.
 *
 * - Injecte le jeton d'acces.
 * - Rafraichit automatiquement la session expiree (une seule fois).
 * - Normalise les erreurs pour l'interface.
 */
import { session } from './session.js';

export class ErreurApi extends Error {
  constructor(message, { code = 'ERREUR_API', statut = 0, details = null } = {}) {
    super(message);
    this.name = 'ErreurApi';
    this.code = code;
    this.statut = statut;
    this.details = details;
  }
}

const RACINE_API = '/api';

async function lireCorps(reponse) {
  const type = reponse.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) return null;
  try {
    return await reponse.json();
  } catch {
    return null;
  }
}

let rafraichissementEnCours = null;

async function rafraichirSession() {
  if (rafraichissementEnCours) return rafraichissementEnCours;

  rafraichissementEnCours = (async () => {
    const jeton = session.jetonRafraichissement();
    if (!jeton) throw new ErreurApi('Session expiree.', { code: 'SESSION_EXPIREE', statut: 401 });

    const reponse = await fetch(`${RACINE_API}/auth/rafraichir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jetonRafraichissement: jeton }),
    });
    const corps = await lireCorps(reponse);
    if (!reponse.ok || !corps?.succes) {
      session.vider();
      throw new ErreurApi('Session expiree, veuillez vous reconnecter.', {
        code: 'SESSION_EXPIREE',
        statut: 401,
      });
    }
    session.enregistrerSession(corps.donnees.session);
    return session.jetonAcces();
  })();

  try {
    return await rafraichissementEnCours;
  } finally {
    rafraichissementEnCours = null;
  }
}

/**
 * @param {string} chemin chemin relatif a /api (ex. "/produits")
 * @param {{methode?: string, corps?: unknown, auth?: boolean, reessayer?: boolean}} options
 */
export async function api(chemin, options = {}) {
  const { methode = 'GET', corps = null, auth = true, reessayer = true } = options;

  const entetes = { Accept: 'application/json' };
  if (corps !== null) entetes['Content-Type'] = 'application/json';
  if (auth) {
    const jeton = session.jetonAcces();
    if (jeton) entetes.Authorization = `Bearer ${jeton}`;
  }

  let reponse;
  try {
    reponse = await fetch(`${RACINE_API}${chemin}`, {
      method: methode,
      headers: entetes,
      body: corps === null ? undefined : JSON.stringify(corps),
      cache: 'no-store',
    });
  } catch {
    throw new ErreurApi('Serveur injoignable. Verifiez la connexion au reseau.', {
      code: 'RESEAU_INDISPONIBLE',
      statut: 0,
    });
  }

  if (reponse.status === 401 && auth && reessayer && session.jetonRafraichissement()) {
    try {
      await rafraichirSession();
    } catch {
      session.vider();
      window.location.replace('/pages/connexion.html?raison=session-expiree');
      throw new ErreurApi('Session expiree.', { code: 'SESSION_EXPIREE', statut: 401 });
    }
    return api(chemin, { ...options, reessayer: false });
  }

  const contenu = await lireCorps(reponse);

  if (!reponse.ok || !contenu?.succes) {
    const info = contenu?.erreur ?? {};
    if (
      reponse.status === 403 &&
      info.code === 'MOT_DE_PASSE_A_CHANGER' &&
      window.location.pathname !== '/pages/mot-de-passe.html'
    ) {
      window.location.replace('/pages/mot-de-passe.html?obligatoire=1');
    }
    throw new ErreurApi(info.message ?? 'Une erreur est survenue.', {
      code: info.code ?? 'ERREUR_API',
      statut: reponse.status,
      details: info.details ?? null,
    });
  }

  return contenu;
}

export default api;
