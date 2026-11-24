/**
 * Gestion de la session cote navigateur.
 *
 * Les jetons sont conserves dans localStorage : suffisant pour un poste de
 * boutique maitrise. Le jeton n'est jamais place dans un cookie accessible en
 * JavaScript et les donnees metier sensibles ne sont pas stockees ici
 * (IndexedDB est reserve au cache hors ligne, phase 12).
 */
const CLE = 'simaotech.session.v1';

function lire() {
  try {
    const brut = localStorage.getItem(CLE);
    if (!brut) return null;
    const valeur = JSON.parse(brut);
    if (!valeur || typeof valeur !== 'object') return null;
    return valeur;
  } catch {
    return null;
  }
}

function ecrire(valeur) {
  localStorage.setItem(CLE, JSON.stringify(valeur));
}

export const session = {
  jetonAcces() {
    return lire()?.session?.jetonAcces ?? null;
  },

  jetonRafraichissement() {
    return lire()?.session?.jetonRafraichissement ?? null;
  },

  utilisateur() {
    return lire()?.utilisateur ?? null;
  },

  estConnecte() {
    return Boolean(this.jetonAcces());
  },

  enregistrerSession(nouvelleSession) {
    if (!nouvelleSession?.jetonAcces) return;
    const actuel = lire() ?? {};
    ecrire({
      ...actuel,
      session: {
        jetonAcces: nouvelleSession.jetonAcces,
        jetonRafraichissement: nouvelleSession.jetonRafraichissement ?? actuel.session?.jetonRafraichissement ?? null,
        expireLe: nouvelleSession.expireLe ?? null,
      },
    });
  },

  enregistrerUtilisateur(utilisateur) {
    const actuel = lire() ?? {};
    ecrire({ ...actuel, utilisateur });
  },

  vider() {
    localStorage.removeItem(CLE);
  },
};

export default session;
