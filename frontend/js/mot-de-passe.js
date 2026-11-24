/**
 * Page « Mon compte » : changement du mot de passe de l'utilisateur connecte.
 * Un mot de passe temporaire non change bloque l'acces aux autres modules.
 */
import { api } from './api.js';
import { session } from './session.js';
import {
  afficherMessage,
  brancherDeconnexion,
  brancherMenuMobile,
  echapper,
  initiales,
  masquerMessage,
  protegerPage,
  rendreMenu,
  rendreUtilisateur,
  surveillerReseau,
} from './ui.js';

const formulaire = document.getElementById('formulaire-mot-de-passe');
const champActuel = document.getElementById('mot-de-passe-actuel');
const champNouveau = document.getElementById('nouveau-mot-de-passe');
const champConfirmation = document.getElementById('confirmation-mot-de-passe');
const bouton = document.getElementById('bouton-changer-mot-de-passe');
const zoneMessage = document.getElementById('message-compte');
const lienRetour = document.getElementById('lien-retour');
const obligatoire = new URLSearchParams(window.location.search).get('obligatoire') === '1';

let utilisateurCourant = null;

function afficherIdentite(utilisateur) {
  document.getElementById('avatar-compte').textContent = initiales(utilisateur.nomComplet);
  document.getElementById('nom-compte').textContent = utilisateur.nomComplet;
  document.getElementById('email-compte').textContent = utilisateur.email;
  document.getElementById('telephone-compte').textContent = utilisateur.telephone
    ? `Telephone : ${utilisateur.telephone}`
    : 'Telephone non renseigne';
  document.getElementById('role-utilisateur').textContent =
    utilisateur.role?.nom ?? utilisateur.role?.code ?? '-';
}

function verifierFormulaire() {
  masquerMessage(zoneMessage);
  const actuel = champActuel.value;
  const nouveau = champNouveau.value;
  const confirmation = champConfirmation.value;

  if (!actuel) {
    afficherMessage(zoneMessage, 'erreur', 'Saisissez votre mot de passe actuel.');
    return null;
  }
  if (nouveau.length < 10) {
    afficherMessage(zoneMessage, 'erreur', 'Le nouveau mot de passe doit contenir au moins 10 caracteres.');
    return null;
  }
  if (!/[A-Za-z]/.test(nouveau) || !/[0-9]/.test(nouveau)) {
    afficherMessage(
      zoneMessage,
      'erreur',
      'Le nouveau mot de passe doit contenir au moins une lettre et un chiffre.',
    );
    return null;
  }
  if (nouveau !== confirmation) {
    afficherMessage(zoneMessage, 'erreur', 'La confirmation ne correspond pas au nouveau mot de passe.');
    return null;
  }
  if (nouveau === actuel) {
    afficherMessage(zoneMessage, 'erreur', 'Le nouveau mot de passe doit etre different de l actuel.');
    return null;
  }
  return { actuel, nouveau };
}

async function soumettre(evenement) {
  evenement.preventDefault();
  const valeurs = verifierFormulaire();
  if (!valeurs) return;

  bouton.disabled = true;
  bouton.innerHTML =
    '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Enregistrement...';

  try {
    await api('/auth/mot-de-passe', {
      methode: 'POST',
      corps: {
        motDePasseActuel: valeurs.actuel,
        nouveauMotDePasse: valeurs.nouveau,
      },
    });

    const utilisateur = session.utilisateur();
    if (utilisateur) {
      session.enregistrerUtilisateur({ ...utilisateur, doitChangerMotDePasse: false });
    }

    afficherMessage(zoneMessage, 'succes', 'Mot de passe modifie. Redirection...');
    formulaire.reset();
    setTimeout(() => {
      window.location.replace('/pages/tableau-de-bord.html');
    }, 900);
  } catch (erreur) {
    const message =
      erreur.code === 'AUTH_INDISPONIBLE'
        ? 'Le changement de mot de passe n est pas disponible : Supabase Auth doit etre configure (MODE_AUTH=supabase).'
        : erreur.message;
    afficherMessage(zoneMessage, 'erreur', message);
    champActuel.select();
  } finally {
    bouton.disabled = false;
    bouton.textContent = 'Changer le mot de passe';
  }
}

async function initialiser() {
  brancherMenuMobile();
  surveillerReseau(document.getElementById('pastille-reseau'));
  brancherDeconnexion();

  utilisateurCourant = await protegerPage({ ignorerChangementMotDePasse: true });
  if (!utilisateurCourant) return;

  rendreMenu('mon-compte', utilisateurCourant);
  rendreUtilisateur(utilisateurCourant);
  afficherIdentite(utilisateurCourant);

  if (utilisateurCourant.doitChangerMotDePasse || obligatoire) {
    afficherMessage(
      zoneMessage,
      'alerte',
      'Votre mot de passe a ete reinitialise. Definissez un nouveau mot de passe pour acceder a l application.',
    );
    document.getElementById('explication-mot-de-passe').textContent =
      'Un nouveau mot de passe est obligatoire avant de continuer.';
    document.getElementById('bloc-aide').hidden = true;
    if (lienRetour) lienRetour.hidden = true;
    champActuel.focus();
  } else {
    document.getElementById('explication-mot-de-passe').textContent =
      `Connecte en tant que ${echapper(utilisateurCourant.role?.nom ?? '')}.`;
  }

  formulaire?.addEventListener('submit', soumettre);
}

initialiser().catch((erreur) => {
  afficherMessage(zoneMessage, 'erreur', erreur.message ?? 'Erreur inattendue.');
});
