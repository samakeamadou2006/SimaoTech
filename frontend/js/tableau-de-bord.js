/**
 * Tableau de bord - etat de mise en service.
 *
 * Aucune donnee commerciale n'est affichee tant que les modules
 * correspondants ne sont pas livres : cet ecran ne presente que des
 * informations reellement verifiees aupres du serveur.
 */
import { api } from './api.js';
import {
  afficherMessage,
  brancherDeconnexion,
  brancherMenuMobile,
  formatMontant,
  protegerPage,
  rendreMenu,
  rendreUtilisateur,
  surveillerReseau,
} from './ui.js';

const zoneErreur = document.getElementById('message-tableau-de-bord');

async function chargerEtatSysteme() {
  const { donnees } = await api('/sante', { auth: false });

  const base = donnees.baseDeDonnees ?? {};
  const migrations = donnees.migrations ?? {};
  const auth = donnees.authentification ?? {};

  const elements = {
    'etat-base': base.disponible ? 'Connectee' : 'Indisponible',
    'etat-migrations': migrations.nombre ? `${migrations.nombre} appliquee(s)` : 'Non initialisee',
    'etat-auth': auth.mode === 'supabase' ? 'Supabase Auth' : 'Verification locale',
    'etat-environnement': donnees.environnement,
    'etat-latence': base.latenceMs !== undefined ? `${base.latenceMs} ms` : '-',
  };

  for (const [id, valeur] of Object.entries(elements)) {
    const cible = document.getElementById(id);
    if (cible) cible.textContent = valeur;
  }

  const pastilleBase = document.getElementById('pastille-base');
  if (pastilleBase) {
    pastilleBase.className = `pastille ${base.disponible ? 'pastille--succes' : 'pastille--danger'}`;
    pastilleBase.textContent = base.disponible ? 'Base operationnelle' : 'Base indisponible';
  }

  const avertissements = document.getElementById('avertissements');
  if (avertissements) {
    if (donnees.avertissements?.length) {
      avertissements.innerHTML = '';
      for (const texte of donnees.avertissements) {
        const bloc = document.createElement('div');
        bloc.className = 'message message--alerte';
        bloc.textContent = texte;
        avertissements.appendChild(bloc);
      }
    } else {
      avertissements.innerHTML =
        '<div class="message message--succes">Configuration complete : aucun avertissement.</div>';
    }
  }

  const tableauMigrations = document.getElementById('derniere-migration');
  if (tableauMigrations) {
    tableauMigrations.textContent = migrations.derniere
      ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(
          new Date(migrations.derniere),
        )
      : '-';
  }
}

async function chargerIndicateurs() {
  const { donnees } = await api('/tableau-de-bord');
  const jour = donnees.periode?.jour ?? {};
  const valeurs = {
    'indicateur-ca': formatMontant(jour.chiffreAffaires),
    'indicateur-benefice': jour.benefice === null ? 'Non autorise' : formatMontant(jour.benefice),
    'indicateur-stocks': String(donnees.stocks?.alertes_stock ?? '-'),
    'indicateur-ventes': String(jour.ventes ?? '-'),
  };
  for (const [id, valeur] of Object.entries(valeurs)) {
    const cible = document.getElementById(id);
    if (cible) cible.textContent = valeur;
  }
}

async function initialiser() {
  brancherMenuMobile();
  surveillerReseau(document.getElementById('pastille-reseau'));
  brancherDeconnexion();

  const utilisateur = await protegerPage();
  if (!utilisateur) return;

  rendreMenu('tableau-de-bord', utilisateur);
  rendreUtilisateur(utilisateur);

  const salutation = document.getElementById('salutation');
  if (salutation) {
    salutation.textContent = `Bonjour ${utilisateur.nomComplet.split(' ')[0]}`;
  }

  const role = document.getElementById('role-utilisateur');
  if (role) role.textContent = utilisateur.role?.nom ?? utilisateur.role?.code ?? '-';

  const nombrePermissions = document.getElementById('nombre-permissions');
  if (nombrePermissions) {
    nombrePermissions.textContent = utilisateur.estProprietaire
      ? 'Toutes (proprietaire)'
      : `${utilisateur.permissions.length}`;
  }

  try {
    await chargerEtatSysteme();
  } catch (erreur) {
    afficherMessage(zoneErreur, 'erreur', `Etat du systeme indisponible : ${erreur.message}`);
  }
  try {
    await chargerIndicateurs();
  } catch (erreur) {
    afficherMessage(zoneErreur, 'erreur', `Indicateurs commerciaux indisponibles : ${erreur.message}`);
  }

  // Etat reel de l'application installee / du service worker.
  const statutPwa = document.getElementById('etat-pwa');
  if (statutPwa) {
    if (!('serviceWorker' in navigator)) {
      statutPwa.textContent = 'Non pris en charge';
    } else {
      const enregistrement = await navigator.serviceWorker.getRegistration();
      statutPwa.textContent = enregistrement ? 'Service worker actif' : 'Non installe';
    }
  }
}

initialiser().catch((erreur) => {
  afficherMessage(zoneErreur, 'erreur', erreur.message ?? 'Erreur inattendue.');
});
