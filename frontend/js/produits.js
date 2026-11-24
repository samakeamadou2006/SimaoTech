/**
 * Ecran Produits : catalogue, prix de reference et historique.
 *
 * Le CMP affiche provient de la base ; il n'est jamais calcule ni modifie ici.
 * Les actions sont masquees selon les permissions, mais le serveur reste seul
 * juge : chaque route reverifie la permission et journalise l'operation.
 */
import { api } from './api.js';
import {
  aPermission,
  afficherMessage,
  brancherDeconnexion,
  brancherMenuMobile,
  echapper,
  formatDate,
  formatMontant,
  formatQuantite,
  masquerMessage,
  protegerPage,
  rendreMenu,
  rendreUtilisateur,
  surveillerReseau,
} from './ui.js';

const LIMITE = 25;

let utilisateurCourant = null;
let page = 1;
let total = 0;
let categories = [];
let actionConfirmee = null;

const zoneMessage = document.getElementById('message-produits');
const corps = document.getElementById('corps-produits');
const champRecherche = document.getElementById('recherche-produits');
const filtreCategorie = document.getElementById('filtre-categorie');
const filtreStatut = document.getElementById('filtre-statut');
const filtreEtatStock = document.getElementById('filtre-etat-stock');
const resumePagination = document.getElementById('resume-pagination');
const boutonPrecedent = document.getElementById('bouton-page-precedente');
const boutonSuivant = document.getElementById('bouton-page-suivante');
const boutonNouveau = document.getElementById('bouton-nouveau-produit');

const formulaire = document.getElementById('formulaire-produit');
const champId = document.getElementById('produit-id');
const champReference = document.getElementById('reference-produit');
const aideReference = document.getElementById('aide-reference');
const champCodeBarres = document.getElementById('code-barres-produit');
const champNom = document.getElementById('nom-produit');
const champCategorie = document.getElementById('categorie-produit');
const champSeuil = document.getElementById('seuil-produit');
const champPrixInitial = document.getElementById('champ-prix-initial');
const champPrix = document.getElementById('prix-produit');
const aidePrix = document.getElementById('aide-prix-produit');
const champDescription = document.getElementById('description-produit');
const champStatut = document.getElementById('statut-produit');
const champStatutBloc = document.getElementById('champ-statut-produit');
const titreModal = document.getElementById('titre-modal-produit');
const boutonEnregistrer = document.getElementById('bouton-enregistrer-produit');
const messageFormulaire = document.getElementById('message-formulaire-produit');

const formulairePrix = document.getElementById('formulaire-prix');
const champPrixProduitId = document.getElementById('prix-produit-id');
const champPrixActuel = document.getElementById('prix-actuel');
const champNouveauPrix = document.getElementById('nouveau-prix');
const champMotifPrix = document.getElementById('motif-prix');
const titreModalPrix = document.getElementById('titre-modal-prix');
const sousTitrePrix = document.getElementById('sous-titre-prix');
const messagePrix = document.getElementById('message-prix');
const boutonEnregistrerPrix = document.getElementById('bouton-enregistrer-prix');

const titreHistorique = document.getElementById('titre-modal-historique');
const sousTitreHistorique = document.getElementById('sous-titre-historique');
const corpsHistorique = document.getElementById('corps-historique');
const messageHistorique = document.getElementById('message-historique');

const modalProduit = new bootstrap.Modal(document.getElementById('modal-produit'));
const modalPrix = new bootstrap.Modal(document.getElementById('modal-prix'));
const modalHistorique = new bootstrap.Modal(document.getElementById('modal-historique'));
const modalConfirmation = new bootstrap.Modal(document.getElementById('modal-confirmation'));

function texteErreur(erreur) {
  const libelles = {
    MOT_DE_PASSE_A_CHANGER: 'Vous devez d abord changer votre mot de passe.',
    PRIX_RESERVE_PROPRIETAIRE: 'Seul le proprietaire peut fixer ou modifier un prix de vente.',
    REFERENCE_DEJA_UTILISEE: 'Cette reference produit existe deja.',
    CODE_BARRES_DEJA_UTILISE: 'Ce code-barres est deja utilise par un autre produit.',
    STOCK_RESTANT: 'Ce produit possede encore du stock : impossible de l archiver.',
    REFERENCE_IMMUABLE: 'La reference d un produit ne peut pas etre modifiee.',
    BASE_INDISPONIBLE: 'La base de donnees n est pas disponible.',
  };
  return libelles[erreur.code] ?? erreur.message ?? 'Une erreur est survenue.';
}

function pastilleEtatStock(etat) {
  const classes = { NORMAL: 'pastille--succes', FAIBLE: 'pastille--alerte', RUPTURE: 'pastille--danger' };
  const libelles = { NORMAL: 'Normal', FAIBLE: 'Faible', RUPTURE: 'Rupture' };
  return `<span class="pastille ${classes[etat] ?? ''}">${libelles[etat] ?? etat}</span>`;
}

function peutGerer() {
  return aPermission(utilisateurCourant, 'produits.gerer');
}

function peutFixerPrix() {
  return aPermission(utilisateurCourant, 'produits.modifier_prix');
}

function rendreLignes(produits) {
  if (!produits.length) {
    corps.innerHTML =
      '<tr><td colspan="6" class="vide">Aucun produit ne correspond a ces criteres.</td></tr>';
    return;
  }

  corps.innerHTML = produits
    .map((produit) => {
      const actions = [];
      if (peutGerer()) {
        actions.push(
          `<button type="button" class="btn btn-st-contour btn-sm" data-action="modifier" data-id="${produit.id}">Modifier</button>`,
        );
      }
      if (peutFixerPrix()) {
        actions.push(
          `<button type="button" class="btn btn-st-contour btn-sm" data-action="prix" data-id="${produit.id}">Prix</button>`,
        );
      }
      actions.push(
        `<button type="button" class="btn btn-st-contour btn-sm" data-action="historique" data-id="${produit.id}">Historique</button>`,
      );
      if (peutGerer()) {
        actions.push(
          `<button type="button" class="btn btn-outline-danger btn-sm" data-action="supprimer" data-id="${produit.id}">Archiver</button>`,
        );
      }

      return `
        <tr>
          <td>
            <div class="cellule-produit">
              <strong>${echapper(produit.nom)}</strong>
              <span class="texte-petit texte-doux">
                ${echapper(produit.reference)}
                ${produit.code_barres ? ` - ${echapper(produit.code_barres)}` : ''}
                ${produit.statut === 'ARCHIVE' ? '<span class="pastille pastille--alerte ms-1">Archive</span>' : ''}
              </span>
            </div>
          </td>
          <td class="texte-petit">${echapper(produit.categorie_nom)}</td>
          <td class="text-end">${formatMontant(produit.prix_vente_reference)}</td>
          <td class="text-end">
            <strong>${formatQuantite(produit.quantite_disponible)}</strong>
            <div class="texte-petit texte-doux">CMP ${formatMontant(produit.cout_moyen_pondere)}</div>
          </td>
          <td>${pastilleEtatStock(produit.etat_stock)}</td>
          <td>
            <div class="actions-tableau">${actions.join('')}</div>
          </td>
        </tr>
      `;
    })
    .join('');
}

function rendreStatistiques(statistiques = {}) {
  const cibles = {
    'stat-total': statistiques.total,
    'stat-actifs': statistiques.actifs,
    'stat-faibles': statistiques.stocks_faibles,
    'stat-ruptures': statistiques.ruptures,
  };
  for (const [id, valeur] of Object.entries(cibles)) {
    const element = document.getElementById(id);
    if (element) element.textContent = valeur ?? '-';
  }
}

async function chargerCategories() {
  const { donnees } = await api('/categories/options');
  categories = donnees;
  const options = categories
    .map((categorie) => `<option value="${categorie.id}">${echapper(categorie.nom)}</option>`)
    .join('');
  filtreCategorie.innerHTML = `<option value="">Toutes les categories</option>${options}`;
  champCategorie.innerHTML = `<option value="">Choisir une categorie</option>${options}`;
}

async function chargerProduits() {
  const parametres = new URLSearchParams({ page: String(page), limite: String(LIMITE) });
  if (champRecherche?.value.trim()) parametres.set('recherche', champRecherche.value.trim());
  if (filtreCategorie?.value) parametres.set('categorie', filtreCategorie.value);
  if (filtreStatut?.value) parametres.set('statut', filtreStatut.value);
  if (filtreEtatStock?.value) parametres.set('etat_stock', filtreEtatStock.value);

  corps.innerHTML = '<tr><td colspan="6" class="vide">Chargement...</td></tr>';

  try {
    const { donnees, meta } = await api(`/produits?${parametres.toString()}`);
    total = meta?.total ?? donnees.length;
    rendreStatistiques(meta?.statistiques);
    rendreLignes(donnees);

    const nombrePages = Math.max(1, Math.ceil(total / LIMITE));
    if (page > nombrePages) {
      page = nombrePages;
      return chargerProduits();
    }
    if (resumePagination) {
      resumePagination.textContent = `${total} produit(s) - page ${page} sur ${nombrePages}`;
    }
    if (boutonPrecedent) boutonPrecedent.disabled = page <= 1;
    if (boutonSuivant) boutonSuivant.disabled = page >= nombrePages;
  } catch (erreur) {
    corps.innerHTML = '<tr><td colspan="6" class="vide">Catalogue indisponible.</td></tr>';
    afficherMessage(zoneMessage, 'erreur', texteErreur(erreur));
  }
}

function reinitialiserFormulaire() {
  formulaire.reset();
  champId.value = '';
  champReference.disabled = false;
  champReference.value = '';
  aideReference.hidden = false;
  champPrixInitial.hidden = !peutFixerPrix();
  champPrix.value = '0';
  champStatutBloc.hidden = true;
  champStatut.value = 'ACTIF';
  champSeuil.value = '0';
  masquerMessage(messageFormulaire);
}

function ouvrirCreation() {
  reinitialiserFormulaire();
  titreModal.textContent = 'Nouveau produit';
  boutonEnregistrer.textContent = 'Creer le produit';
  champStatutBloc.hidden = true;
  aidePrix.textContent = peutFixerPrix()
    ? 'Prix de vente initial. Il pourra etre modifie depuis l action « Prix ».'
    : 'Sans la permission de fixer les prix, le produit est cree a 0 FCFA.';
  modalProduit.show();
  setTimeout(() => champNom.focus(), 250);
}

function ouvrirModification(produit) {
  reinitialiserFormulaire();
  titreModal.textContent = 'Modifier un produit';
  boutonEnregistrer.textContent = 'Enregistrer';

  champId.value = produit.id;
  champReference.value = produit.reference;
  champReference.disabled = true;
  aideReference.hidden = true;
  champNom.value = produit.nom ?? '';
  champCodeBarres.value = produit.code_barres ?? '';
  champCategorie.value = produit.categorie_id ?? '';
  champSeuil.value = String(Number(produit.seuil_alerte ?? 0));
  champDescription.value = produit.description ?? '';
  champPrixInitial.hidden = true;
  champStatutBloc.hidden = false;
  champStatut.value = produit.statut ?? 'ACTIF';

  modalProduit.show();
  setTimeout(() => champNom.focus(), 250);
}

async function soumettreFormulaire(evenement) {
  evenement.preventDefault();
  masquerMessage(messageFormulaire);

  const identifiant = champId.value;
  const creation = !identifiant;
  const corpsRequete = {
    nom: champNom.value.trim(),
    codeBarres: champCodeBarres.value.trim() || null,
    categorieId: champCategorie.value || null,
    seuilAlerte: champSeuil.value || '0',
    description: champDescription.value.trim() || null,
  };

  if (corpsRequete.nom.length < 2) {
    afficherMessage(messageFormulaire, 'erreur', 'Le nom du produit est obligatoire.');
    return;
  }
  if (!corpsRequete.categorieId) {
    afficherMessage(messageFormulaire, 'erreur', 'Choisissez une categorie.');
    return;
  }

  if (creation) {
    if (champReference.value.trim()) corpsRequete.reference = champReference.value.trim();
    if (peutFixerPrix()) corpsRequete.prixVenteReference = champPrix.value || '0';
  } else {
    corpsRequete.statut = champStatut.value;
  }

  boutonEnregistrer.disabled = true;
  try {
    if (creation) {
      const { donnees } = await api('/produits', { methode: 'POST', corps: corpsRequete });
      afficherMessage(zoneMessage, 'succes', `Produit ${donnees.reference} cree.`);
    } else {
      await api(`/produits/${identifiant}`, { methode: 'PATCH', corps: corpsRequete });
      afficherMessage(zoneMessage, 'succes', 'Produit mis a jour.');
    }
    modalProduit.hide();
    await chargerProduits();
  } catch (erreur) {
    afficherMessage(messageFormulaire, 'erreur', texteErreur(erreur));
  } finally {
    boutonEnregistrer.disabled = false;
  }
}

function ouvrirPrix(produit) {
  masquerMessage(messagePrix);
  formulairePrix.reset();
  champPrixProduitId.value = produit.id;
  champPrixActuel.value = formatMontant(produit.prix_vente_reference);
  titreModalPrix.textContent = 'Changer le prix';
  sousTitrePrix.textContent = `${produit.nom} - ${produit.reference}`;
  modalPrix.show();
  setTimeout(() => champNouveauPrix.focus(), 250);
}

async function soumettrePrix(evenement) {
  evenement.preventDefault();
  masquerMessage(messagePrix);

  const identifiant = champPrixProduitId.value;
  const prix = champNouveauPrix.value;
  const motif = champMotifPrix.value.trim();

  if (prix === '' || Number(prix) < 0) {
    afficherMessage(messagePrix, 'erreur', 'Saisissez un prix valide.');
    return;
  }
  if (motif.length < 5) {
    afficherMessage(messagePrix, 'erreur', 'Le motif doit contenir au moins 5 caracteres.');
    return;
  }

  boutonEnregistrerPrix.disabled = true;
  try {
    const { donnees } = await api(`/produits/${identifiant}/prix`, {
      methode: 'PATCH',
      corps: { prix, motif },
    });
    modalPrix.hide();
    afficherMessage(
      zoneMessage,
      'succes',
      `Prix mis a jour : ${formatMontant(donnees.prixAncien)} -> ${formatMontant(donnees.prixNouveau)}.`,
    );
    await chargerProduits();
  } catch (erreur) {
    afficherMessage(messagePrix, 'erreur', texteErreur(erreur));
  } finally {
    boutonEnregistrerPrix.disabled = false;
  }
}

async function ouvrirHistorique(identifiant) {
  masquerMessage(messageHistorique);
  corpsHistorique.innerHTML = '<tr><td colspan="5" class="vide">Chargement...</td></tr>';
  titreHistorique.textContent = 'Historique des prix';
  sousTitreHistorique.textContent = '-';
  modalHistorique.show();

  try {
    const { donnees, meta } = await api(`/produits/${identifiant}/historique-prix?limite=50`);
    const produit = await api(`/produits/${identifiant}`).then((r) => r.donnees);
    titreHistorique.textContent = 'Historique des prix';
    sousTitreHistorique.textContent = `${produit.nom} - ${produit.reference} (${meta?.total ?? 0} changement(s))`;

    corpsHistorique.innerHTML = donnees.length
      ? donnees
          .map(
            (ligne) => `
              <tr>
                <td class="texte-petit">${formatDate(ligne.cree_le)}</td>
                <td class="text-end">${ligne.prix_vente_ancien === null ? '-' : formatMontant(ligne.prix_vente_ancien)}</td>
                <td class="text-end">${formatMontant(ligne.prix_vente_nouveau)}</td>
                <td class="texte-petit">${echapper(ligne.motif ?? '-')}</td>
                <td class="texte-petit">${echapper(ligne.modifie_par_nom ?? '-')}</td>
              </tr>
            `,
          )
          .join('')
      : '<tr><td colspan="5" class="vide">Aucun changement de prix enregistre.</td></tr>';
  } catch (erreur) {
    corpsHistorique.innerHTML = '';
    afficherMessage(messageHistorique, 'erreur', texteErreur(erreur));
  }
}

function demanderConfirmation({ titre, texte, libelle }) {
  document.getElementById('titre-confirmation').textContent = titre;
  document.getElementById('confirmation-texte').textContent = texte;
  const valider = document.getElementById('confirmation-valider');
  valider.textContent = libelle;
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

async function archiver(identifiant) {
  const confirme = await demanderConfirmation({
    titre: 'Archiver le produit',
    texte:
      'Le produit ne sera plus propose a la vente. Les ventes, approvisionnements et prix passes restent consultables.',
    libelle: 'Archiver',
  });
  if (!confirme) return;

  try {
    await api(`/produits/${identifiant}`, { methode: 'DELETE' });
    afficherMessage(zoneMessage, 'succes', 'Produit archive.');
    await chargerProduits();
  } catch (erreur) {
    afficherMessage(zoneMessage, 'erreur', texteErreur(erreur));
  }
}

async function executerAction(action, identifiant) {
  if (action === 'supprimer') {
    await archiver(identifiant);
    return;
  }
  try {
    const { donnees } = await api(`/produits/${identifiant}`);
    if (action === 'modifier') ouvrirModification(donnees);
    else if (action === 'prix') ouvrirPrix(donnees);
    else if (action === 'historique') await ouvrirHistorique(identifiant);
  } catch (erreur) {
    afficherMessage(zoneMessage, 'erreur', texteErreur(erreur));
  }
}

let minuterieRecherche = null;
function programmerRecherche() {
  clearTimeout(minuterieRecherche);
  minuterieRecherche = setTimeout(() => {
    page = 1;
    chargerProduits();
  }, 300);
}

function brancherEvenements() {
  boutonNouveau?.addEventListener('click', ouvrirCreation);
  formulaire?.addEventListener('submit', soumettreFormulaire);
  formulairePrix?.addEventListener('submit', soumettrePrix);

  champRecherche?.addEventListener('input', programmerRecherche);
  [filtreCategorie, filtreStatut, filtreEtatStock].forEach((filtre) => {
    filtre?.addEventListener('change', () => {
      page = 1;
      chargerProduits();
    });
  });

  boutonPrecedent?.addEventListener('click', () => {
    if (page > 1) {
      page -= 1;
      chargerProduits();
    }
  });
  boutonSuivant?.addEventListener('click', () => {
    page += 1;
    chargerProduits();
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

  rendreMenu('produits', utilisateurCourant);
  rendreUtilisateur(utilisateurCourant);
  document.getElementById('role-utilisateur').textContent =
    utilisateurCourant.role?.nom ?? utilisateurCourant.role?.code ?? '-';

  if (!aPermission(utilisateurCourant, 'produits.consulter')) {
    document.getElementById('panneau-acces-refuse').hidden = false;
    document.getElementById('contenu-produits').hidden = true;
    return;
  }

  boutonNouveau.hidden = !peutGerer();
  brancherEvenements();

  try {
    await chargerCategories();
  } catch (erreur) {
    afficherMessage(zoneMessage, 'erreur', `Categories indisponibles : ${texteErreur(erreur)}`);
    return;
  }

  await chargerProduits();
}

initialiser().catch((erreur) => {
  afficherMessage(zoneMessage, 'erreur', erreur.message ?? 'Erreur inattendue.');
});
