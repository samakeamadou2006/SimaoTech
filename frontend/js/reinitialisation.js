/**
 * Page de reinitialisation atteinte depuis le lien envoye par Supabase Auth.
 *
 * Les jetons sont lus dans le fragment d'URL (flux implicite) ou le code PKCE
 * dans la query, puis transmis une seule fois a l'API. Le fragment est retire
 * de l'historique pour ne pas laisser de jeton visible.
 */
import { api } from './api.js';
import { afficherMessage } from './ui.js';

const parametresHash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
const parametresQuery = new URLSearchParams(window.location.search);

const jetonAcces = parametresHash.get('access_token');
const jetonRafraichissement = parametresHash.get('refresh_token');
const code = parametresQuery.get('code') ?? parametresHash.get('code');
const erreurFournisseur =
  parametresHash.get('error_description') ?? parametresQuery.get('error_description');

const formulaire = document.getElementById('formulaire-reinitialisation');
const champNouveau = document.getElementById('nouveau-mot-de-passe');
const champConfirmation = document.getElementById('confirmation-mot-de-passe');
const bouton = document.getElementById('bouton-reinitialiser');
const zoneMessage = document.getElementById('message-reinitialisation');
const zoneSucces = document.getElementById('zone-succes');
const explication = document.getElementById('explication');

// Les jetons ne doivent pas rester dans la barre d'adresse.
if (window.location.hash || parametresQuery.has('code')) {
  window.history.replaceState(null, '', window.location.pathname);
}

function desactiverFormulaire(message) {
  explication.textContent = 'Ce lien de reinitialisation ne peut pas etre utilise.';
  formulaire.hidden = true;
  afficherMessage(zoneMessage, 'erreur', message);
}

if (erreurFournisseur) {
  desactiverFormulaire(
    `Le lien de reinitialisation est invalide ou expire. Demandez un nouveau lien depuis l ecran de connexion.`,
  );
} else if (!jetonAcces && !code) {
  desactiverFormulaire(
    'Aucun jeton de reinitialisation detecte. Ouvrez le lien recu par e-mail ou demandez-en un nouveau.',
  );
} else {
  formulaire.hidden = false;
}

formulaire?.addEventListener('submit', async (evenement) => {
  evenement.preventDefault();
  const nouveau = champNouveau.value;
  const confirmation = champConfirmation.value;

  if (nouveau.length < 10) {
    afficherMessage(zoneMessage, 'erreur', 'Le mot de passe doit contenir au moins 10 caracteres.');
    return;
  }
  if (!/[A-Za-z]/.test(nouveau) || !/[0-9]/.test(nouveau)) {
    afficherMessage(
      zoneMessage,
      'erreur',
      'Le mot de passe doit contenir au moins une lettre et un chiffre.',
    );
    return;
  }
  if (nouveau !== confirmation) {
    afficherMessage(zoneMessage, 'erreur', 'Les deux mots de passe ne correspondent pas.');
    return;
  }

  bouton.disabled = true;
  bouton.innerHTML =
    '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Enregistrement...';

  try {
    await api('/auth/reinitialiser-mot-de-passe', {
      methode: 'POST',
      auth: false,
      corps: {
        motDePasse: nouveau,
        ...(jetonAcces ? { jetonAcces, jetonRafraichissement } : {}),
        ...(code ? { code } : {}),
      },
    });
    formulaire.hidden = true;
    zoneSucces.hidden = false;
    zoneMessage.hidden = true;
  } catch (erreur) {
    afficherMessage(
      zoneMessage,
      'erreur',
      erreur.code === 'AUTH_INDISPONIBLE'
        ? 'Le service de reinitialisation n est pas configure. Contactez le proprietaire.'
        : erreur.message,
    );
    bouton.disabled = false;
    bouton.textContent = 'Enregistrer le nouveau mot de passe';
  }
});
