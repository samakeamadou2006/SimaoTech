/**
 * Ecran de connexion.
 */
import { api } from './api.js';
import { session } from './session.js';
import { afficherMessage, masquerMessage } from './ui.js';

const formulaire = document.getElementById('formulaire-connexion');
const zoneMessage = document.getElementById('message-connexion');
const champEmail = document.getElementById('email');
const champMotDePasse = document.getElementById('mot-de-passe');
const boutonOeil = document.getElementById('bouton-oeil');
const boutonValider = document.getElementById('bouton-connexion');
const lienOublie = document.getElementById('lien-mot-de-passe-oublie');

const parametres = new URLSearchParams(window.location.search);
if (parametres.get('raison') === 'session-expiree') {
  afficherMessage(zoneMessage, 'alerte', 'Votre session a expire. Veuillez vous reconnecter.');
} else if (parametres.get('raison') === 'deconnecte') {
  afficherMessage(zoneMessage, 'info', 'Vous avez ete deconnecte.');
}

if (session.estConnecte()) {
  window.location.replace('/pages/tableau-de-bord.html');
}

boutonOeil?.addEventListener('click', () => {
  const visible = champMotDePasse.type === 'text';
  champMotDePasse.type = visible ? 'password' : 'text';
  boutonOeil.setAttribute('aria-pressed', String(!visible));
  boutonOeil.setAttribute('aria-label', visible ? 'Afficher le mot de passe' : 'Masquer le mot de passe');
});

function definirChargement(actif) {
  boutonValider.disabled = actif;
  boutonValider.innerHTML = actif
    ? '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Connexion...'
    : 'Se connecter';
}

formulaire?.addEventListener('submit', async (evenement) => {
  evenement.preventDefault();
  masquerMessage(zoneMessage);

  const email = champEmail.value.trim();
  const motDePasse = champMotDePasse.value;

  if (!email || !motDePasse) {
    afficherMessage(zoneMessage, 'erreur', 'Veuillez renseigner votre adresse e-mail et votre mot de passe.');
    return;
  }

  definirChargement(true);

  try {
    const { donnees } = await api('/auth/connexion', {
      methode: 'POST',
      auth: false,
      corps: { email, motDePasse },
    });

    session.enregistrerSession(donnees.session);
    session.enregistrerUtilisateur(donnees.utilisateur);

    if (donnees.utilisateur?.doitChangerMotDePasse) {
      afficherMessage(zoneMessage, 'info', 'Vous devez definir un nouveau mot de passe.');
      window.location.replace('/pages/mot-de-passe.html?obligatoire=1');
      return;
    }

    afficherMessage(zoneMessage, 'succes', 'Connexion reussie. Ouverture du tableau de bord...');
    window.location.replace('/pages/tableau-de-bord.html');
  } catch (erreur) {
    const message =
      erreur.code === 'AUTH_INDISPONIBLE'
        ? 'Le service de connexion n est pas encore configure. Contactez l administrateur (variables SUPABASE_URL et SUPABASE_CLE_ANON).'
        : erreur.message;
    afficherMessage(zoneMessage, 'erreur', message);
    champMotDePasse.select();
  } finally {
    definirChargement(false);
  }
});

lienOublie?.addEventListener('click', async (evenement) => {
  evenement.preventDefault();
  const email = champEmail.value.trim();
  if (!email) {
    afficherMessage(zoneMessage, 'info', 'Saisissez votre adresse e-mail, puis cliquez a nouveau sur « Mot de passe oublie ».');
    champEmail.focus();
    return;
  }
  try {
    const { donnees } = await api('/auth/mot-de-passe-oublie', {
      methode: 'POST',
      auth: false,
      corps: { email },
    });
    afficherMessage(zoneMessage, 'succes', donnees.message);
  } catch (erreur) {
    afficherMessage(zoneMessage, 'erreur', erreur.message);
  }
});
