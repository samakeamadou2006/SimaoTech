/**
 * Enregistrement du service worker et detection des mises a jour.
 * La file locale ne contient que les ventes, approvisionnements et depenses
 * avec cle d idempotence. Toute operation est revalidee par l API au retour
 * du reseau ; les erreurs metier restent visibles et ne sont pas rejouees.
 */
import { api } from './api.js';
import {
  marquerOperationEnErreur,
  operationsEnAttente,
  supprimerOperation,
} from './stockage_local.js';

let synchronisationEnCours = null;

function signalerSynchronisation(message, type = 'info') {
  window.dispatchEvent(
    new CustomEvent('simaotech:synchronisation', { detail: { message, type } }),
  );
}

async function synchroniserFile() {
  if (!navigator.onLine) return;
  if (synchronisationEnCours) return synchronisationEnCours;

  synchronisationEnCours = (async () => {
    const operations = (await operationsEnAttente()).filter(
      (operation) => operation.statut !== 'ERREUR',
    );
    let traitees = 0;

    for (const operation of operations) {
      try {
        const chemin = operation.endpoint.replace(/^\/api/, '');
        const resultat = await api(chemin, { methode: 'POST', corps: operation.corps });
        await supprimerOperation(operation.cle);
        traitees += 1;
        if (resultat.donnees?.anomalie) {
          signalerSynchronisation(
            'Une vente hors connexion a ete enregistree en anomalie et doit etre verifiee.',
            'danger',
          );
        }
      } catch (erreur) {
        if (erreur.statut >= 400 && erreur.statut < 500 && erreur.statut !== 401) {
          await marquerOperationEnErreur(operation.cle, erreur.message);
        }
        signalerSynchronisation(
          `Synchronisation interrompue : ${erreur.message}`,
          'danger',
        );
        return;
      }
    }

    if (traitees > 0) {
      signalerSynchronisation(`${traitees} operation(s) synchronisee(s).`, 'success');
    }
  })();

  try {
    await synchronisationEnCours;
  } finally {
    synchronisationEnCours = null;
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const enregistrement = await navigator.serviceWorker.register('/service-worker.js', {
        scope: '/',
      });

      enregistrement.addEventListener('updatefound', () => {
        const nouveau = enregistrement.installing;
        if (!nouveau) return;
        nouveau.addEventListener('statechange', () => {
          if (nouveau.state === 'installed' && navigator.serviceWorker.controller) {
            const bandeau = document.getElementById('bandeau-mise-a-jour');
            if (bandeau) bandeau.hidden = false;
          }
        });
      });
    } catch (erreur) {
      console.warn('Service worker non enregistre :', erreur.message);
    }
  });

  document.getElementById('bouton-recharger')?.addEventListener('click', () => {
    window.location.reload();
  });
}

window.addEventListener('online', () => {
  synchroniserFile().catch((erreur) => {
    signalerSynchronisation(`Impossible de lire la file hors connexion : ${erreur.message}`, 'danger');
  });
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    synchroniserFile().catch((erreur) => {
      signalerSynchronisation(`Impossible de lire la file hors connexion : ${erreur.message}`, 'danger');
    });
  }
});
if (navigator.onLine) {
  synchroniserFile().catch((erreur) => {
    signalerSynchronisation(`Impossible de lire la file hors connexion : ${erreur.message}`, 'danger');
  });
}
