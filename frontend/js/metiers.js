import { api } from './api.js';
import { session } from './session.js';
import { ajouterOperation } from './stockage_local.js';
import { estimerTotalVente } from './metiers-calculs.js';
import {
  afficherMessage,
  masquerMessage,
  brancherMenuMobile,
  brancherDeconnexion,
  surveillerReseau,
  protegerPage,
  rendreMenu,
  rendreUtilisateur,
  formatMontant,
  formatDate,
  formatQuantite,
  echapper,
} from './ui.js';

const moduleName = new URLSearchParams(location.search).get('module') || 'stocks';
const configurations = {
  fournisseurs: {
    titre: 'Fournisseurs',
    description: 'Coordonnees des fournisseurs actifs de la boutique.',
    endpoint: '/fournisseurs',
    action: 'Creer un fournisseur',
    permissionCreation: 'fournisseurs.gerer',
    colonnes: ['code', 'nom', 'telephone', 'email', 'actif'],
    formulaire: 'fournisseur',
  },
  approvisionnements: {
    titre: 'Approvisionnements',
    description: 'Enregistrez puis validez un achat pour mettre a jour le stock et le CMP.',
    endpoint: '/approvisionnements',
    action: 'Nouvel approvisionnement',
    permissionCreation: 'approvisionnements.creer',
    colonnes: ['numero', 'fournisseur', 'statut', 'cout_net', 'date_approvisionnement'],
    formulaire: 'approvisionnement',
  },
  stocks: {
    titre: 'Stocks',
    description: 'Consultez les quantites disponibles et enregistrez les ajustements justifies.',
    endpoint: '/stocks',
    action: 'Ajuster le stock',
    permissionCreation: 'stocks.ajuster',
    colonnes: ['reference', 'nom', 'quantite_disponible', 'quantite_reservee', 'seuil_alerte'],
    formulaire: 'ajustement',
  },
  inventaires: {
    titre: 'Inventaires',
    description: 'Comparez les quantites comptees au stock theorique et validez les ecarts.',
    endpoint: '/inventaires',
    action: 'Nouvel inventaire',
    permissionCreation: 'stocks.inventorier',
    colonnes: ['numero', 'statut', 'nombre_lignes', 'ecart_total', 'date_inventaire'],
    formulaire: 'inventaire',
  },
  ventes: {
    titre: 'Caisse et ventes',
    description: 'Selectionnez les articles et le paiement. Le serveur controle le stock et le CMP.',
    endpoint: '/ventes',
    action: 'Nouvelle vente',
    permissionCreation: 'ventes.creer',
    colonnes: ['numero', 'vendeur', 'statut', 'montant_net', 'date_vente'],
    formulaire: 'vente',
  },
  depenses: {
    titre: 'Depenses',
    description: 'Enregistrez les depenses et traitez celles qui attendent une decision.',
    endpoint: '/depenses',
    action: 'Nouvelle depense',
    permissionCreation: 'depenses.creer',
    colonnes: ['numero', 'categorie', 'description', 'montant', 'statut', 'date_depense'],
    formulaire: 'depense',
  },
  annulations: {
    titre: 'Annulations',
    description: 'Demandez l annulation d une vente ou traitez les demandes en attente.',
    endpoint: '/annulations',
    action: 'Demander une annulation',
    permissionCreation: 'ventes.annuler_demander',
    colonnes: ['vente_numero', 'demandeur', 'motif', 'statut', 'cree_le'],
    formulaire: 'annulation',
  },
  rapports: {
    titre: 'Rapports',
    description: 'Consultez la synthese et exportez les resultats au format CSV.',
    endpoint: '/rapports',
    action: 'Exporter CSV',
    permissionCreation: 'rapports.exporter',
    colonnes: ['chiffre_affaires', 'benefice_brut', 'depenses', 'benefice_net', 'nombre_ventes'],
    formulaire: 'rapport',
  },
  parametres: {
    titre: 'Parametres',
    description: 'Modifiez les valeurs de configuration existantes.',
    endpoint: '/parametres',
    action: 'Modifier un parametre',
    permissionCreation: 'parametres.gerer',
    colonnes: ['cle', 'valeur', 'description', 'modifie_le'],
    formulaire: 'parametre',
  },
};

const config = configurations[moduleName];
const donneesReference = { produits: [], fournisseurs: [], categories: [], ventes: [], parametres: [] };
const DUREE_CACHE_REFERENCE = 24 * 60 * 60 * 1000;
const zoneErreur = document.getElementById('message-module');
const zoneFormulaire = document.getElementById('champs-module');
const formulaire = document.getElementById('formulaire-module');
const modalElement = document.getElementById('modal-module');
const modal = modalElement ? bootstrap.Modal.getOrCreateInstance(modalElement) : null;
let utilisateurCourant = null;
let periodeRapport = null;

function possedePermission(code) {
  return Boolean(
    utilisateurCourant?.estProprietaire || utilisateurCourant?.permissions?.includes(code),
  );
}

function valeurChamp(id) {
  return document.getElementById(id)?.value?.trim() ?? '';
}

function echapperAttribut(valeur) {
  return echapper(String(valeur ?? ''));
}

function champ(id, libelle, type = 'text', options = {}) {
  const { valeur = '', requis = false, aide = '', pas = null, lectureSeule = false } = options;
  const pasHtml = pas ? ` step="${echapperAttribut(pas)}"` : '';
  const requisHtml = requis ? ' required' : '';
  const valeurHtml = ` value="${echapperAttribut(valeur)}"`;
  const lectureSeuleHtml = lectureSeule ? ' readonly' : '';
  return `<div class="champ">
    <label for="${echapperAttribut(id)}">${echapper(libelle)}</label>
    <input class="form-control" id="${echapperAttribut(id)}" name="${echapperAttribut(id)}"
      type="${echapperAttribut(type)}"${valeurHtml}${pasHtml}${requisHtml}${lectureSeuleHtml} />
    ${aide ? `<p class="texte-petit texte-doux mb-0">${echapper(aide)}</p>` : ''}
  </div>`;
}

function zoneTexte(id, libelle, options = {}) {
  const { valeur = '', lignes = 3, requis = false } = options;
  return `<div class="champ">
    <label for="${echapperAttribut(id)}">${echapper(libelle)}</label>
    <textarea class="form-control" id="${echapperAttribut(id)}" rows="${lignes}"${requis ? ' required' : ''}>${echapperAttribut(valeur)}</textarea>
  </div>`;
}

function selectHtml(id, libelle, options, { requis = true, vide = 'Choisir...' } = {}) {
  const optionsHtml = options
    .map(
      (option) =>
        `<option value="${echapperAttribut(option.value)}">${echapper(option.label)}</option>`,
    )
    .join('');
  return `<div class="champ">
    <label for="${echapperAttribut(id)}">${echapper(libelle)}</label>
    <select class="form-select" id="${echapperAttribut(id)}"${requis ? ' required' : ''}>
      <option value="">${echapper(vide)}</option>${optionsHtml}
    </select>
  </div>`;
}

function optionsProduits() {
  return donneesReference.produits.map((produit) => ({
    value: produit.id,
    label: `${produit.nom} (${produit.reference}) - ${formatMontant(produit.prix_vente_reference)} - stock ${formatQuantite(produit.quantite_vendable, 3)}`,
  }));
}

function optionsLignes(type) {
  let colonnes =
    type === 'approvisionnement'
      ? '<th>Produit</th><th>Quantite</th><th>Prix d achat unitaire</th><th>Reduction</th>'
      : type === 'inventaire'
        ? '<th>Produit</th><th>Quantite comptee</th>'
        : '<th>Produit</th><th>Quantite</th>';
  if (type === 'vente' && possedePermission('ventes.accorder_reduction')) {
    colonnes += '<th>Reduction (FCFA)</th>';
  }
  return `<div class="champ">
    <div class="d-flex justify-content-between align-items-center mb-2">
      <span class="form-label mb-0">${type === 'inventaire' ? 'Articles comptes' : 'Articles'}</span>
      <button type="button" class="btn btn-st-contour btn-sm" data-ajouter-ligne>Ajouter un article</button>
    </div>
    <div class="table-responsive">
      <table class="tableau">
        <thead><tr>${colonnes}<th scope="col">Action</th></tr></thead>
        <tbody data-lignes="${type}"></tbody>
      </table>
    </div>
  </div>`;
}

function ligneHtml(type) {
  const produits = optionsProduits();
  const nombre = (nom, label, min = '0.001') =>
    `<input class="form-control form-control-sm" type="number" name="${nom}" min="${min}" step="0.001" required aria-label="${label}" />`;
  const champProduit = `<select class="form-select form-select-sm" name="produitId" required aria-label="Produit">
    <option value="">Choisir un produit...</option>
    ${produits.map((p) => `<option value="${echapperAttribut(p.value)}">${echapper(p.label)}</option>`).join('')}
  </select>`;
  let autres = '';
  if (type === 'approvisionnement') {
    autres = `<td>${nombre('quantite', 'Quantite')}</td>
      <td><input class="form-control form-control-sm" type="number" name="prixAchatUnitaire" min="0.01" step="0.01" required aria-label="Prix d achat unitaire" /></td>
      <td><input class="form-control form-control-sm" type="number" name="reduction" min="0" step="0.01" value="0" aria-label="Reduction de la ligne" /></td>`;
  } else if (type === 'inventaire') {
    autres = `<td>${nombre('quantiteComptee', 'Quantite comptee', '0')}</td>`;
  } else {
    autres = `<td>${nombre('quantite', 'Quantite')}</td>${
      type === 'vente' && possedePermission('ventes.accorder_reduction')
        ? '<td><input class="form-control form-control-sm" type="number" name="reduction" min="0" step="0.01" value="0" aria-label="Reduction de la ligne en FCFA" /></td>'
        : ''
    }`;
  }
  return `<tr data-ligne="${type}"><td>${champProduit}</td>${autres}
    <td><button type="button" class="btn btn-st-contour btn-sm" data-supprimer-ligne aria-label="Supprimer cet article">Retirer</button></td></tr>`;
}

async function chargerReferences() {
  if (['approvisionnement', 'ajustement', 'inventaire', 'vente'].includes(config.formulaire)) {
    donneesReference.produits = await chargerReference(
      'produits',
      '/produits?limite=200&statut=ACTIF',
    );
  }
  if (config.formulaire === 'approvisionnement') {
    donneesReference.fournisseurs = await chargerReference('fournisseurs', '/fournisseurs/options');
  }
  if (config.formulaire === 'depense') {
    donneesReference.categories = await chargerReference('categories-depenses', '/depenses/categories');
  }
  if (config.formulaire === 'annulation') {
    donneesReference.ventes = await chargerReference(
      'ventes-valides',
      '/ventes?limite=200&statut=VALIDEE',
    );
  }
  if (config.formulaire === 'parametre') {
    donneesReference.parametres = await chargerReference('parametres', '/parametres');
  }
}

async function chargerReference(cle, chemin) {
  const cleCache = `simaotech:references:${utilisateurCourant.id}:${cle}`;
  try {
    const reponse = await api(chemin);
    try {
      sessionStorage.setItem(
        cleCache,
        JSON.stringify({ donnees: reponse.donnees, sauvegardeLe: Date.now() }),
      );
    } catch {
      afficherMessage(
        zoneErreur,
        'alerte',
        'Le cache temporaire des listes est indisponible ; les formulaires hors ligne ne seront pas accessibles.',
      );
    }
    return reponse.donnees;
  } catch (erreur) {
    if (erreur.code !== 'RESEAU_INDISPONIBLE') throw erreur;
    const cache = sessionStorage.getItem(cleCache);
    if (!cache) throw erreur;
    let entree;
    try {
      entree = JSON.parse(cache);
    } catch {
      sessionStorage.removeItem(cleCache);
      throw new Error('Le cache hors ligne est invalide. Reconnectez-vous pour recharger les listes.');
    }
    if (
      !Array.isArray(entree.donnees) ||
      Date.now() - entree.sauvegardeLe > DUREE_CACHE_REFERENCE
    ) {
      sessionStorage.removeItem(cleCache);
      throw new Error('Les donnees hors ligne ont expire. Reconnectez-vous pour recharger les listes.');
    }
    afficherMessage(
      zoneErreur,
      'info',
      'Listes locales utilisees. Le serveur revalidera toute operation avant enregistrement.',
    );
    return entree.donnees;
  }
}

function dateLocale(date) {
  const annee = date.getFullYear();
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  const jour = String(date.getDate()).padStart(2, '0');
  return `${annee}-${mois}-${jour}`;
}

function periodeParDefaut() {
  const aujourdHui = new Date();
  return {
    debut: dateLocale(new Date(aujourdHui.getFullYear(), aujourdHui.getMonth(), 1)),
    fin: dateLocale(aujourdHui),
  };
}

function construireFormulaire() {
  switch (config.formulaire) {
    case 'fournisseur':
      return [
        champ('code', 'Code fournisseur', 'text', { requis: true }),
        champ('nom', 'Nom', 'text', { requis: true }),
        champ('telephone', 'Telephone', 'tel'),
        champ('email', 'Courriel', 'email'),
        champ('adresse', 'Adresse'),
        zoneTexte('notes', 'Notes'),
      ].join('');
    case 'approvisionnement':
      return [
        selectHtml(
          'fournisseurId',
          'Fournisseur',
          donneesReference.fournisseurs.map((f) => ({
            value: f.id,
            label: `${f.nom} (${f.code})`,
          })),
        ),
        champ('date', 'Date', 'date', { valeur: dateLocale(new Date()) }),
        optionsLignes('approvisionnement'),
        zoneTexte('observations', 'Observations'),
      ].join('');
    case 'ajustement':
      return [
        selectHtml('produitId', 'Produit', optionsProduits()),
        champ('quantite', 'Ajustement de quantite (+ ou -)', 'number', {
          requis: true,
          pas: '0.001',
          aide: 'Une valeur positive ajoute du stock ; une valeur negative en retire.',
        }),
        zoneTexte('motif', 'Motif de l ajustement', { requis: true }),
      ].join('');
    case 'inventaire':
      return [
        champ('date', 'Date de l inventaire', 'date', { valeur: dateLocale(new Date()) }),
        optionsLignes('inventaire'),
        zoneTexte('observations', 'Observations'),
      ].join('');
    case 'vente':
      return [
        optionsLignes('vente'),
        `<div class="rangee-champs">
          ${selectHtml('moyen-paiement', 'Moyen de paiement', [
            { value: 'ESPECES', label: 'Especes' },
            { value: 'ORANGE_MONEY', label: 'Orange Money' },
            { value: 'MTN_MOMO', label: 'MTN MoMo' },
            { value: 'WAVE', label: 'Wave' },
          ])}
          ${champ('montant-paiement', 'Montant a encaisser', 'text', {
            requis: true,
            lectureSeule: true,
            aide: 'Calcule a partir des prix catalogue ; le serveur effectue le controle final.',
          })}
        </div>
        <div class="champ" id="zone-reference-paiement" hidden>
          <label for="reference-paiement">Reference de transaction</label>
          <input class="form-control" id="reference-paiement" maxlength="120" />
        </div>
        <p class="texte-petit texte-doux" id="total-estime"></p>`,
        zoneTexte('observations', 'Observations'),
      ].join('');
    case 'depense':
      return [
        selectHtml(
          'categorieId',
          'Categorie',
          donneesReference.categories.map((c) => ({ value: c.id, label: c.nom })),
        ),
        champ('montant', 'Montant (FCFA)', 'number', { requis: true, pas: '0.01' }),
        champ('date', 'Date', 'date', { valeur: dateLocale(new Date()) }),
        champ('description', 'Description', 'text', { requis: true }),
        champ('justificatifUrl', 'Lien du justificatif (facultatif)', 'url'),
      ].join('');
    case 'annulation':
      return [
        selectHtml(
          'venteId',
          'Vente a annuler',
          donneesReference.ventes.map((vente) => ({
            value: vente.id,
            label: `${vente.numero} - ${formatMontant(vente.montant_net)} - ${formatDate(vente.date_vente)}`,
          })),
        ),
        zoneTexte('motif', 'Motif de la demande', { requis: true }),
      ].join('');
    case 'rapport': {
      periodeRapport = periodeParDefaut();
      return [
        champ('debut', 'Du', 'date', { valeur: periodeRapport.debut, requis: true }),
        champ('fin', 'Au', 'date', { valeur: periodeRapport.fin, requis: true }),
      ].join('');
    }
    case 'parametre':
      return [
        selectHtml(
          'cle-parametre',
          'Parametre',
          donneesReference.parametres.map((p) => ({ value: p.cle, label: `${p.cle} - ${p.description}` })),
        ),
        zoneTexte('valeur-parametre', 'Valeur JSON', { lignes: 5, requis: true }),
      ].join('');
    default:
      return '';
  }
}

if (moduleName === 'rapports') periodeRapport = periodeParDefaut();

function ajouterLigne() {
  const corps = zoneFormulaire.querySelector(`[data-lignes="${config.formulaire}"]`);
  if (!corps) return;
  corps.insertAdjacentHTML('beforeend', ligneHtml(config.formulaire));
}

function calculerTotalVente() {
  const lignes = [...zoneFormulaire.querySelectorAll('[data-ligne="vente"]')].map((ligne) => ({
    produitId: ligne.querySelector('[name="produitId"]').value,
    quantite: ligne.querySelector('[name="quantite"]').value,
    reduction: ligne.querySelector('[name="reduction"]')?.value || '0',
  }));
  return estimerTotalVente(lignes, donneesReference.produits);
}

function actualiserTotalVente() {
  if (config.formulaire !== 'vente') return;
  const montant = document.getElementById('montant-paiement');
  const total = document.getElementById('total-estime');
  if (!montant || !total) return;
  try {
    const estime = calculerTotalVente();
    montant.value = estime;
    total.textContent = `Total estime : ${formatMontant(estime)}`;
  } catch {
    montant.value = '';
    total.textContent = 'Selectionnez les articles et quantites pour calculer le total.';
  }
}

function lireLignes(type) {
  const lignes = [...zoneFormulaire.querySelectorAll(`[data-ligne="${type}"]`)].map((ligne) => {
    const lire = (nom) => ligne.querySelector(`[name="${nom}"]`)?.value.trim() ?? '';
    const produitId = lire('produitId');
    if (!produitId) throw new Error('Selectionnez un produit pour chaque ligne.');
    if (type === 'approvisionnement') {
      return {
        produitId,
        quantite: lire('quantite'),
        prixAchatUnitaire: lire('prixAchatUnitaire'),
        reduction: lire('reduction') || '0',
      };
    }
    if (type === 'inventaire') return { produitId, quantiteComptee: lire('quantiteComptee') };
    return {
      produitId,
      quantite: lire('quantite'),
      reduction: lire('reduction') || '0',
    };
  });
  if (!lignes.length) throw new Error('Ajoutez au moins un article.');
  if (new Set(lignes.map((ligne) => ligne.produitId)).size !== lignes.length) {
    throw new Error('Un produit ne peut apparaitre qu une fois dans la liste.');
  }
  return lignes;
}

function construireCorps() {
  switch (config.formulaire) {
    case 'fournisseur':
      return Object.fromEntries(
        ['code', 'nom', 'telephone', 'email', 'adresse', 'notes'].map((cle) => [
          cle,
          valeurChamp(cle) || null,
        ]),
      );
    case 'approvisionnement':
      return {
        fournisseurId: valeurChamp('fournisseurId'),
        date: valeurChamp('date') || null,
        lignes: lireLignes('approvisionnement'),
        observations: valeurChamp('observations') || null,
        cleIdempotence: crypto.randomUUID(),
      };
    case 'ajustement':
      return {
        produitId: valeurChamp('produitId'),
        quantite: valeurChamp('quantite'),
        motif: valeurChamp('motif'),
      };
    case 'inventaire':
      return {
        date: valeurChamp('date') || null,
        lignes: lireLignes('inventaire'),
        observations: valeurChamp('observations') || null,
      };
    case 'vente': {
      const moyen = valeurChamp('moyen-paiement');
      const reference = valeurChamp('reference-paiement');
      return {
        lignes: lireLignes('vente'),
        paiements: [
          {
            moyen,
            montant: calculerTotalVente(),
            reference: moyen === 'ESPECES' ? null : reference,
          },
        ],
        observations: valeurChamp('observations') || null,
        cleIdempotence: crypto.randomUUID(),
      };
    }
    case 'depense':
      return {
        categorieId: valeurChamp('categorieId'),
        montant: valeurChamp('montant'),
        date: valeurChamp('date') || null,
        description: valeurChamp('description'),
        justificatifUrl: valeurChamp('justificatifUrl') || null,
        cleIdempotence: crypto.randomUUID(),
      };
    case 'annulation':
      return { venteId: valeurChamp('venteId'), motif: valeurChamp('motif') };
    case 'rapport':
      return { debut: valeurChamp('debut'), fin: valeurChamp('fin') };
    case 'parametre': {
      let valeur;
      try {
        valeur = JSON.parse(valeurChamp('valeur-parametre'));
      } catch {
        throw new Error('La valeur du parametre doit etre un JSON valide.');
      }
      return { cle: valeurChamp('cle-parametre'), valeur };
    }
    default:
      throw new Error('Formulaire de module indisponible.');
  }
}

function valeurCellule(ligne, cle) {
  const valeur = ligne[cle];
  if (valeur === null || valeur === undefined || valeur === '') return '-';
  if (cle.includes('montant') || cle.includes('benefice') || cle.includes('cout') || cle === 'depenses' || cle === 'chiffre_affaires') {
    return formatMontant(valeur);
  }
  if (cle.includes('quantite') || cle === 'ecart_total') return formatQuantite(valeur, 3);
  if (cle.includes('date') || cle.endsWith('_le')) return formatDate(valeur);
  if (typeof valeur === 'boolean') return valeur ? 'Oui' : 'Non';
  if (typeof valeur === 'object') return echapper(JSON.stringify(valeur));
  return echapper(valeur);
}

function actionsLigne(ligne) {
  const boutons = [];
  const ajouter = (action, libelle, classe = 'btn-st-contour') =>
    boutons.push(
      `<button type="button" class="btn ${classe} btn-sm" data-action="${action}" data-id="${echapperAttribut(ligne.id)}">${libelle}</button>`,
    );
  if (
    moduleName === 'approvisionnements' &&
    ligne.statut === 'BROUILLON' &&
    possedePermission('approvisionnements.valider')
  ) ajouter('valider-appro', 'Valider', 'btn-st');
  if (
    moduleName === 'inventaires' &&
    ligne.statut === 'BROUILLON' &&
    possedePermission('stocks.inventorier')
  ) ajouter('valider-inventaire', 'Valider', 'btn-st');
  if (
    moduleName === 'depenses' &&
    ligne.statut === 'EN_ATTENTE' &&
    possedePermission('depenses.valider')
  ) {
    ajouter('valider-depense', 'Valider', 'btn-st');
    ajouter('rejeter-depense', 'Rejeter');
  }
  if (
    moduleName === 'annulations' &&
    ligne.statut === 'EN_ATTENTE' &&
    possedePermission('ventes.annuler_approuver')
  ) {
    ajouter('approuver-annulation', 'Approuver', 'btn-st');
    ajouter('rejeter-annulation', 'Rejeter');
  }
  return boutons.length ? `<td><div class="d-flex gap-2">${boutons.join('')}</div></td>` : '';
}

function afficherTableau(lignes) {
  const entete = document.getElementById('entete-tableau');
  const corps = document.getElementById('corps-module');
  const aActions = ['approvisionnements', 'inventaires', 'depenses', 'annulations'].includes(moduleName);
  const noms = {
    numero: 'Numero',
    fournisseur: 'Fournisseur',
    statut: 'Statut',
    cout_net: 'Cout net',
    date_approvisionnement: 'Date',
    reference: 'Reference',
    nom: 'Produit',
    quantite_disponible: 'Disponible',
    quantite_reservee: 'Reservee',
    seuil_alerte: 'Seuil d alerte',
    nombre_lignes: 'Articles',
    ecart_total: 'Ecart total',
    vendeur: 'Vendeur',
    montant_net: 'Montant',
    date_vente: 'Date',
    categorie: 'Categorie',
    description: 'Description',
    montant: 'Montant',
    date_depense: 'Date',
    vente_numero: 'Vente',
    demandeur: 'Demandeur',
    motif: 'Motif',
    cree_le: 'Demandee le',
    chiffre_affaires: 'Chiffre d affaires',
    benefice_brut: 'Benefice brut',
    depenses: 'Depenses',
    benefice_net: 'Benefice net',
    nombre_ventes: 'Ventes',
    code: 'Code',
    telephone: 'Telephone',
    email: 'Courriel',
    actif: 'Actif',
    cle: 'Cle',
    valeur: 'Valeur',
    modifie_le: 'Modifie le',
  };
  entete.innerHTML = `<tr>${config.colonnes.map((cle) => `<th scope="col">${echapper(noms[cle] ?? cle)}</th>`).join('')}${aActions ? '<th scope="col">Actions</th>' : ''}</tr>`;
  if (!lignes.length) {
    corps.innerHTML = `<tr><td colspan="${config.colonnes.length + Number(aActions)}" class="vide">Aucune donnee pour le moment.</td></tr>`;
    return;
  }
  corps.innerHTML = lignes
    .map(
      (ligne) =>
        `<tr>${config.colonnes.map((cle) => `<td>${valeurCellule(ligne, cle)}</td>`).join('')}${aActions ? actionsLigne(ligne) : ''}</tr>`,
    )
    .join('');
}

async function charger() {
  try {
    const query =
      moduleName === 'rapports' && periodeRapport
        ? `?debut=${encodeURIComponent(periodeRapport.debut)}&fin=${encodeURIComponent(periodeRapport.fin)}`
        : '';
    const reponse = await api(`${config.endpoint}${query}`);
    const lignes =
      moduleName === 'rapports'
        ? [
            {
              ...reponse.donnees.resume,
              nombre_ventes: reponse.donnees.resume.nombre_ventes,
            },
          ]
        : reponse.donnees;
    afficherTableau(Array.isArray(lignes) ? lignes : []);
  } catch (erreur) {
    afficherMessage(zoneErreur, 'danger', erreur.message);
  }
}

async function ouvrirFormulaire() {
  masquerMessage(document.getElementById('message-formulaire'));
  const bouton = document.getElementById('bouton-nouveau');
  bouton.disabled = true;
  try {
    await chargerReferences();
    zoneFormulaire.innerHTML = construireFormulaire();
    if (['approvisionnement', 'inventaire', 'vente'].includes(config.formulaire)) ajouterLigne();
    if (config.formulaire === 'parametre') {
      document.getElementById('cle-parametre')?.addEventListener('change', (event) => {
        const parametre = donneesReference.parametres.find((p) => p.cle === event.target.value);
        document.getElementById('valeur-parametre').value = JSON.stringify(parametre?.valeur ?? null, null, 2);
      });
    }
    document.getElementById('moyen-paiement')?.addEventListener('change', (event) => {
      const mobile = event.target.value !== 'ESPECES';
      document.getElementById('zone-reference-paiement').hidden = !mobile;
      document.getElementById('reference-paiement').required = mobile;
    });
    document.getElementById('titre-modal').textContent = config.action;
    modal?.show();
    actualiserTotalVente();
  } catch (erreur) {
    afficherMessage(zoneErreur, 'danger', erreur.message);
  } finally {
    bouton.disabled = false;
  }
}

async function exporterRapport(body) {
  const debut = encodeURIComponent(body.debut);
  const fin = encodeURIComponent(body.fin);
  await api(`/rapports?debut=${debut}&fin=${fin}`);
  const reponse = await fetch(`/api/rapports/export.csv?debut=${debut}&fin=${fin}`, {
    headers: { Authorization: `Bearer ${session.jetonAcces()}` },
    cache: 'no-store',
  });
  if (!reponse.ok) throw new Error('Export CSV impossible.');
  const url = URL.createObjectURL(await reponse.blob());
  const lien = document.createElement('a');
  lien.href = url;
  lien.download = `rapport-simaotech-${body.debut}-${body.fin}.csv`;
  lien.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  periodeRapport = body;
  modal?.hide();
  await charger();
}

async function envoyer(event) {
  event.preventDefault();
  const messageForm = document.getElementById('message-formulaire');
  let body;
  try {
    body = construireCorps();
  } catch (erreur) {
    afficherMessage(messageForm, 'danger', erreur.message);
    return;
  }
  if (config.formulaire === 'rapport') {
    if (body.debut > body.fin) {
      afficherMessage(messageForm, 'danger', 'La date de debut doit preceder la date de fin.');
      return;
    }
    try {
      await exporterRapport(body);
    } catch (erreur) {
      afficherMessage(messageForm, 'danger', erreur.message);
    }
    return;
  }
  try {
    let endpoint = config.endpoint;
    let methode = 'POST';
    if (config.formulaire === 'ajustement') endpoint = '/stocks/ajuster';
    if (config.formulaire === 'parametre') {
      endpoint = `/parametres/${encodeURIComponent(body.cle)}`;
      methode = 'PATCH';
      delete body.cle;
    }
    if (['ventes', 'approvisionnement', 'depense'].includes(config.formulaire)) {
      body.cleIdempotence ||= crypto.randomUUID();
    }
    await api(endpoint, { methode, corps: body });
    modal?.hide();
    afficherMessage(zoneErreur, 'success', 'Operation enregistree.');
    await charger();
  } catch (erreur) {
    if (
      erreur.code === 'RESEAU_INDISPONIBLE' &&
      ['ventes', 'approvisionnement', 'depense'].includes(config.formulaire)
    ) {
      try {
        body.cleIdempotence ||= crypto.randomUUID();
        if (config.formulaire === 'vente') body.horsLigne = true;
        const endpoint =
          config.formulaire === 'approvisionnement'
            ? '/api/approvisionnements'
            : `/api/${config.formulaire === 'depense' ? 'depenses' : 'ventes'}`;
        await ajouterOperation({ endpoint, corps: body });
        modal?.hide();
        afficherMessage(zoneErreur, 'info', 'Operation en attente de reprise en ligne et de validation serveur.');
      } catch (erreurStockage) {
        afficherMessage(messageForm, 'danger', `Impossible de mettre l operation en attente : ${erreurStockage.message}`);
      }
      return;
    }
    afficherMessage(messageForm, 'danger', erreur.message);
  }
}

async function traiterAction(event) {
  const bouton = event.target.closest('[data-action]');
  if (!bouton) return;
  const id = bouton.dataset.id;
  const action = bouton.dataset.action;
  let endpoint;
  let corps = null;
  if (action === 'valider-appro') endpoint = `/approvisionnements/${id}/valider`;
  if (action === 'valider-inventaire') endpoint = `/inventaires/${id}/valider`;
  if (action === 'valider-depense') endpoint = `/depenses/${id}/valider`;
  if (action === 'rejeter-depense') {
    const motif = window.prompt('Motif du rejet (minimum 3 caracteres) :');
    if (motif === null) return;
    corps = { motif };
    endpoint = `/depenses/${id}/rejeter`;
  }
  if (action === 'approuver-annulation') {
    if (!window.confirm('Confirmer l approbation et la restitution du stock ?')) return;
    endpoint = `/annulations/${id}/approuver`;
  }
  if (action === 'rejeter-annulation') {
    const commentaire = window.prompt('Commentaire du rejet (minimum 3 caracteres) :');
    if (commentaire === null) return;
    corps = { commentaire };
    endpoint = `/annulations/${id}/rejeter`;
  }
  if (!endpoint) return;
  bouton.disabled = true;
  try {
    await api(endpoint, { methode: 'POST', corps });
    afficherMessage(zoneErreur, 'success', 'Decision enregistree.');
    await charger();
  } catch (erreur) {
    afficherMessage(zoneErreur, 'danger', erreur.message);
  } finally {
    bouton.disabled = false;
  }
}

async function initialiser() {
  brancherMenuMobile();
  surveillerReseau(document.getElementById('pastille-reseau'));
  brancherDeconnexion();
  const utilisateur = await protegerPage();
  if (!utilisateur) return;
  if (!config) {
    afficherMessage(zoneErreur, 'danger', 'Ce module n existe pas.');
    return;
  }
  utilisateurCourant = utilisateur;
  rendreMenu(moduleName, utilisateur);
  rendreUtilisateur(utilisateur);
  document.title = `${config.titre} | SimaoTech`;
  document.getElementById('titre-module').textContent = config.titre;
  document.getElementById('titre-bloc').textContent = config.titre;
  document.getElementById('description-module').textContent = config.description;
  document.getElementById('bouton-nouveau').textContent = config.action;
  document.getElementById('bouton-nouveau').hidden = !possedePermission(config.permissionCreation);
  document.getElementById('role-utilisateur').textContent =
    utilisateur.role?.nom ?? utilisateur.role?.code ?? '-';
  if (
    ['approvisionnement', 'ajustement', 'inventaire', 'vente', 'depense', 'annulation', 'parametre'].includes(
      config.formulaire,
    )
  ) {
    try {
      await chargerReferences();
    } catch (erreur) {
      if (erreur.code !== 'RESEAU_INDISPONIBLE') {
        afficherMessage(zoneErreur, 'alerte', `Listes de reference indisponibles : ${erreur.message}`);
      }
    }
  }
  document.getElementById('bouton-nouveau').addEventListener('click', ouvrirFormulaire);
  formulaire.addEventListener('submit', envoyer);
  zoneFormulaire.addEventListener('click', (event) => {
    if (event.target.closest('[data-ajouter-ligne]')) {
      ajouterLigne();
      actualiserTotalVente();
    }
    if (event.target.closest('[data-supprimer-ligne]')) {
      const lignes = zoneFormulaire.querySelectorAll('[data-ligne]');
      if (lignes.length > 1) event.target.closest('tr').remove();
      actualiserTotalVente();
    }
  });
  zoneFormulaire.addEventListener('input', actualiserTotalVente);
  zoneFormulaire.addEventListener('change', actualiserTotalVente);
  document.getElementById('corps-module').addEventListener('click', traiterAction);
  window.addEventListener('simaotech:synchronisation', (event) => {
    const { message, type = 'info' } = event.detail ?? {};
    if (message) afficherMessage(zoneErreur, type, message);
    if (type === 'success') charger();
  });
  await charger();
}

initialiser().catch((erreur) => afficherMessage(zoneErreur, 'danger', erreur.message));
