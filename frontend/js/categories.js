/**
 * Ecran Categories : organisation du catalogue.
 *
 * Une categorie encore liee a des produits ne peut pas etre supprimee : le
 * serveur le refuse et l'interface explique pourquoi.
 */
import { api } from './api.js';
import {
  aPermission,
  afficherMessage,
  brancherDeconnexion,
  brancherMenuMobile,
  echapper,
  masquerMessage,
  protegerPage,
  rendreMenu,
  rendreUtilisateur,
  surveillerReseau,
} from './ui.js';

const LIMITE = 50;

let utilisateurCourant = null;
let page = 1;
let total = 0;
let actionConfirmee = null;

const zoneMessage = document.getElementById('message-categories');
const corps = document.getElementById('corps-categories');
const champRecherche = document.getElementById('recherche-categories');
const filtreActif = document.getElementById('filtre-actif-categorie');
const resumePagination = document.getElementById('resume-pagination');
const boutonPrecedent = document.getElementById('bouton-page-precedente');
const boutonSuivant = document.getElementById('bouton-page-suivante');
const boutonNouvelle = document.getElementById('bouton-nouvelle-categorie');

const formulaire = document.getElementById('formulaire-categorie');
const champId = document.getElementById('categorie-id');
const champNom = document.getElementById('nom-categorie');
const champCode = document.getElementById('code-categorie');
const champDescription = document.getElementById('description-categorie');
const champActif = document.getElementById('actif-categorie');
const titreModal = document.getElementById('titre-modal-categorie');
const boutonEnregistrer = document.getElementById('bouton-enregistrer-categorie');
const messageFormulaire = document.getElementById('message-formulaire-categorie');

const modalCategorie = new bootstrap.Modal(document.getElementById('modal-categorie'));
const modalConfirmation = new bootstrap.Modal(document.getElementById('modal-confirmation'));

function peutGerer() {
  return aPermission(utilisateurCourant, 'categories.gerer');
}

function texteErreur(erreur) {
  const libelles = {
    MOT_DE_PASSE_A_CHANGER: 'Vous devez d abord changer votre mot de passe.',
    CATEGORIE_DEJA_UTILISEE: 'Une categorie porte deja ce nom.',
    CODE_CATEGORIE_DEJA_UTILISE: 'Ce code de categorie est deja utilise.',
    CATEGORIE_UTILISEE: 'Cette categorie contient encore des produits.',
    BASE_INDISPONIBLE: 'La base de donnees n est pas disponible.',
  };
  return libelles[erreur.code] ?? erreur.message ?? 'Une erreur est survenue.';
}

function rendreLignes(categories) {
  if (!categories.length) {
    corps.innerHTML =
      '<tr><td colspan="5" class="vide">Aucune categorie ne correspond a ces criteres.</td></tr>';
    return;
  }

  corps.innerHTML = categories
    .map((categorie) => {
      const actions = [];
      if (peutGerer()) {
        actions.push(
          `<button type="button" class="btn btn-st-contour btn-sm" data-action="modifier" data-id="${categorie.id}">Modifier</button>`,
          `<button type="button" class="btn btn-outline-danger btn-sm" data-action="supprimer" data-id="${categorie.id}">Supprimer</button>`,
        );
      }
      return `
        <tr>
          <td>
            <div class="cellule-produit">
              <strong>${echapper(categorie.nom)}</strong>
              ${categorie.description ? `<span class="texte-petit texte-doux">${echapper(categorie.description)}</span>` : ''}
            </div>
          </td>
          <td class="texte-petit">${echapper(categorie.code)}</td>
          <td class="text-end">${categorie.nombre_produits}</td>
          <td>
            <span class="pastille ${categorie.actif ? 'pastille--succes' : 'pastille--danger'}">
              ${categorie.actif ? 'Active' : 'Inactive'}
            </span>
          </td>
          <td>
            <div class="actions-tableau">
              ${actions.join('') || '<span class="texte-petit texte-doux">Lecture seule</span>'}
            </div>
          </td>
        </tr>
      `;
    })
    .join('');
}

async function chargerCategories() {
  const parametres = new URLSearchParams({ page: String(page), limite: String(LIMITE) });
  if (champRecherche?.value.trim()) parametres.set('recherche', champRecherche.value.trim());
  if (filtreActif?.value) parametres.set('actif', filtreActif.value);

  corps.innerHTML = '<tr><td colspan="5" class="vide">Chargement...</td></tr>';

  try {
    const { donnees, meta } = await api(`/categories?${parametres.toString()}`);
    total = meta?.total ?? donnees.length;
    rendreLignes(donnees);

    const nombrePages = Math.max(1, Math.ceil(total / LIMITE));
    if (page > nombrePages) {
      page = nombrePages;
      return chargerCategories();
    }
    if (resumePagination) {
      resumePagination.textContent = `${total} categorie(s) - page ${page} sur ${nombrePages}`;
    }
    if (boutonPrecedent) boutonPrecedent.disabled = page <= 1;
    if (boutonSuivant) boutonSuivant.disabled = page >= nombrePages;
  } catch (erreur) {
    corps.innerHTML = '<tr><td colspan="5" class="vide">Categories indisponibles.</td></tr>';
    afficherMessage(zoneMessage, 'erreur', texteErreur(erreur));
  }
}

function reinitialiserFormulaire() {
  formulaire.reset();
  champId.value = '';
  champActif.checked = true;
  masquerMessage(messageFormulaire);
}

function ouvrirCreation() {
  reinitialiserFormulaire();
  titreModal.textContent = 'Nouvelle categorie';
  boutonEnregistrer.textContent = 'Creer la categorie';
  modalCategorie.show();
  setTimeout(() => champNom.focus(), 250);
}

function ouvrirModification(categorie) {
  reinitialiserFormulaire();
  titreModal.textContent = 'Modifier une categorie';
  boutonEnregistrer.textContent = 'Enregistrer';
  champId.value = categorie.id;
  champNom.value = categorie.nom ?? '';
  champCode.value = categorie.code ?? '';
  champDescription.value = categorie.description ?? '';
  champActif.checked = Boolean(categorie.actif);
  modalCategorie.show();
  setTimeout(() => champNom.focus(), 250);
}

async function soumettreFormulaire(evenement) {
  evenement.preventDefault();
  masquerMessage(messageFormulaire);

  const identifiant = champId.value;
  const corpsRequete = {
    nom: champNom.value.trim(),
    description: champDescription.value.trim() || null,
    actif: champActif.checked,
  };
  if (champCode.value.trim()) corpsRequete.code = champCode.value.trim();

  if (corpsRequete.nom.length < 2) {
    afficherMessage(messageFormulaire, 'erreur', 'Le nom de la categorie est obligatoire.');
    return;
  }

  boutonEnregistrer.disabled = true;
  try {
    if (identifiant) {
      await api(`/categories/${identifiant}`, { methode: 'PATCH', corps: corpsRequete });
      afficherMessage(zoneMessage, 'succes', 'Categorie mise a jour.');
    } else {
      const { donnees } = await api('/categories', { methode: 'POST', corps: corpsRequete });
      afficherMessage(zoneMessage, 'succes', `Categorie ${donnees.nom} creee.`);
    }
    modalCategorie.hide();
    await chargerCategories();
  } catch (erreur) {
    afficherMessage(messageFormulaire, 'erreur', texteErreur(erreur));
  } finally {
    boutonEnregistrer.disabled = false;
  }
}

function demanderConfirmation({ titre, texte, libelle }) {
  document.getElementById('titre-confirmation').textContent = titre;
  document.getElementById('confirmation-texte').textContent = texte;
  document.getElementById('confirmation-valider').textContent = libelle;
  modalConfirmation.show();

  return new Promise((resolve) => {
    actionConfirmee = resolve;
    document.getElementById('modal-confirmation').addEventListener(
      'hidden.bs.modal',
      () => {
        if (actionConfirmee) {
          const resoudre = actionConfirmee;
          actionConfirmee = null;
          resoudre(false);
        }
      },
      { once: true },
    );
  });
}

async function executerAction(action, identifiant) {
  try {
    const { donnees } = await api(`/categories/${identifiant}`);
    if (action === 'modifier') {
      ouvrirModification(donnees);
      return;
    }
    if (action === 'supprimer') {
      const confirme = await demanderConfirmation({
        titre: 'Supprimer la categorie',
        texte: `La categorie « ${donnees.nom} » sera archivee. Les produits historiques restent intacts.`,
        libelle: 'Supprimer',
      });
      if (!confirme) return;
      await api(`/categories/${identifiant}`, { methode: 'DELETE' });
      afficherMessage(zoneMessage, 'succes', 'Categorie supprimee.');
      await chargerCategories();
    }
  } catch (erreur) {
    afficherMessage(zoneMessage, 'erreur', texteErreur(erreur));
  }
}

let minuterieRecherche = null;
function programmerRecherche() {
  clearTimeout(minuterieRecherche);
  minuterieRecherche = setTimeout(() => {
    page = 1;
    chargerCategories();
  }, 300);
}

function brancherEvenements() {
  boutonNouvelle?.addEventListener('click', ouvrirCreation);
  formulaire?.addEventListener('submit', soumettreFormulaire);

  champRecherche?.addEventListener('input', programmerRecherche);
  filtreActif?.addEventListener('change', () => {
    page = 1;
    chargerCategories();
  });

  boutonPrecedent?.addEventListener('click', () => {
    if (page > 1) {
      page -= 1;
      chargerCategories();
    }
  });
  boutonSuivant?.addEventListener('click', () => {
    page += 1;
    chargerCategories();
  });

  corps?.addEventListener('click', (evenement) => {
    const bouton = evenement.target.closest('button[data-action]');
    if (!bouton) return;
    executerAction(bouton.dataset.action, bouton.dataset.id);
  });

  document.getElementById('confirmation-valider')?.addEventListener('click', () => {
    modalConfirmation.hide();
    const resoudre = actionConfirmee;
    actionConfirmee = null;
    resoudre?.(true);
  });
}

async function initialiser() {
  brancherMenuMobile();
  surveillerReseau(document.getElementById('pastille-reseau'));
  brancherDeconnexion();

  utilisateurCourant = await protegerPage();
  if (!utilisateurCourant) return;

  rendreMenu('categories', utilisateurCourant);
  rendreUtilisateur(utilisateurCourant);
  document.getElementById('role-utilisateur').textContent =
    utilisateurCourant.role?.nom ?? utilisateurCourant.role?.code ?? '-';

  boutonNouvelle.hidden = !peutGerer();
  brancherEvenements();
  await chargerCategories();
}

initialiser().catch((erreur) => {
  afficherMessage(zoneMessage, 'erreur', erreur.message ?? 'Erreur inattendue.');
});
