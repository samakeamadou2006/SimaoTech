import { api } from './api.js';
import { session } from './session.js';
import { ajouterOperation } from './stockage_local.js';
import { afficherMessage, masquerMessage, brancherMenuMobile, brancherDeconnexion, surveillerReseau, protegerPage, rendreMenu, rendreUtilisateur, formatMontant, formatDate, formatQuantite, echapper } from './ui.js';

const moduleName = new URLSearchParams(location.search).get('module') || 'stocks';
const config = {
  fournisseurs: { titre:'Fournisseurs', description:'Gestion des fournisseurs.', endpoint:'/fournisseurs', action:'Creer', colonnes:['code','nom','telephone','email','actif'], champs:[
    ['code','Code'],['nom','Nom'],['telephone','Telephone'],['email','Email'],['adresse','Adresse'],['notes','Notes']
  ]},
  approvisionnements: { titre:'Approvisionnements', description:'Enregistrez puis validez les achats pour recalculer le CMP.', endpoint:'/approvisionnements', action:'Creer', colonnes:['numero','fournisseur','statut','montant_brut','cout_net','date_approvisionnement'], json:true,
    exemple:{ fournisseurId:'UUID_FOURNISSEUR', lignes:[{ produitId:'UUID_PRODUIT', quantite:10, prixAchatUnitaire:1000, reduction:0 }], observations:'' }},
  stocks: { titre:'Stocks', description:'Stocks disponibles, alertes, mouvements et ajustements.', endpoint:'/stocks', action:'Ajuster', colonnes:['reference','nom','quantite_disponible','quantite_reservee','cout_moyen_pondere','seuil_alerte'], json:true,
    exemple:{ produitId:'UUID_PRODUIT', quantite:5, motif:'Correction d inventaire' }},
  ventes: { titre:'Caisse et ventes', description:'Les ventes sont controlees serveur : anti-perte, paiement exact et stock verrouille.', endpoint:'/ventes', action:'Enregistrer une vente', colonnes:['numero','vendeur','statut','montant_net','cout_total','benefice_brut','date_vente'], json:true,
    exemple:{ lignes:[{ produitId:'UUID_PRODUIT', quantite:1, reduction:0 }], paiements:[{ moyen:'ESPECES', montant:1000 }], reductionGlobale:0, observations:'' }},
  depenses: { titre:'Depenses', description:'Depenses de fonctionnement et validation.', endpoint:'/depenses', action:'Enregistrer', colonnes:['numero','categorie','description','montant','statut','date_depense'], json:true,
    exemple:{ categorieId:'UUID_CATEGORIE', montant:5000, description:'Achat de fournitures', justificatifUrl:'' }},
  annulations: { titre:'Annulations', description:'Demandes d annulation et decisions des autorises.', endpoint:'/annulations', action:'Demander', colonnes:['vente_numero','demandeur','motif','statut','cree_le'], json:true,
    exemple:{ venteId:'UUID_VENTE', motif:'Erreur de vente' }},
  rapports: { titre:'Rapports', description:'Synthese commerciale sur une periode. Export CSV compatible Excel.', endpoint:'/rapports', action:'Exporter CSV', colonnes:['ca','benefice_brut','depenses'], json:true,
    exemple:{ debut:'2026-11-01', fin:'2026-11-30' }},
  parametres: { titre:'Parametres', description:'Configuration globale de la boutique.', endpoint:'/parametres', action:'Modifier', colonnes:['cle','valeur','description','modifie_le'], json:true,
    exemple:{ cle:'boutique.nom', valeur:'SimaoTech' }}
};
const cfg = config[moduleName] || config.stocks;

function periodeRapport() {
  const aujourdHui = new Date();
  const debutMois = new Date(aujourdHui.getFullYear(), aujourdHui.getMonth(), 1);
  const auFormatDate = (date) => {
    const annee = date.getFullYear();
    const mois = String(date.getMonth() + 1).padStart(2, '0');
    const jour = String(date.getDate()).padStart(2, '0');
    return `${annee}-${mois}-${jour}`;
  };
  const parametres = new URLSearchParams(location.search);
  return {
    debut: parametres.get('debut') || auFormatDate(debutMois),
    fin: parametres.get('fin') || auFormatDate(aujourdHui),
  };
}

const message = document.getElementById('message-module');
const messageForm = document.getElementById('message-formulaire');
const modalElement = document.getElementById('modal-module');
const modal = modalElement ? bootstrap.Modal.getOrCreateInstance(modalElement) : null;

document.title = `${cfg.titre} | SimaoTech`;
document.getElementById('titre-module').textContent = cfg.titre;
document.getElementById('titre-bloc').textContent = cfg.titre;
document.getElementById('description-module').textContent = cfg.description;
document.getElementById('bouton-nouveau').textContent = cfg.action;
document.getElementById('entete-tableau').innerHTML = `<tr>${cfg.colonnes.map(c=>`<th>${echapper(c.replaceAll('_',' '))}</th>`).join('')}</tr>`;

function valeur(row, key) {
  const v = row[key];
  if (key.includes('montant') || key.includes('benefice') || key.includes('cout') || key === 'ca' || key === 'depenses') return formatMontant(v);
  if (key.includes('quantite') || key.includes('cout_moyen')) return key.includes('cout') ? formatMontant(v) : formatQuantite(v,3);
  if (typeof v === 'boolean') return v ? 'Oui' : 'Non';
  if (v && typeof v === 'object') return echapper(JSON.stringify(v));
  if (key.includes('date') || key === 'cree_le' || key === 'modifie_le') return formatDate(v);
  return v == null ? '-' : echapper(v);
}

async function charger() {
  try {
    const periode = moduleName === 'rapports' ? periodeRapport() : null;
    const query = periode
      ? `?debut=${encodeURIComponent(periode.debut)}&fin=${encodeURIComponent(periode.fin)}`
      : '';
    const reponse = await api(`${cfg.endpoint}${query}`);
    const donnees = reponse.donnees;
    const rows = moduleName === 'rapports'
      ? [{
          ca: donnees.resume.chiffre_affaires,
          benefice_brut: donnees.resume.benefice_brut,
          depenses: donnees.resume.depenses,
        }]
      : donnees ?? [];
    document.getElementById('corps-module').innerHTML = rows.length ? rows.map(row =>
      `<tr>${cfg.colonnes.map(c=>`<td>${valeur(row,c)}</td>`).join('')}</tr>`
    ).join('') : `<tr><td colspan="${cfg.colonnes.length}" class="vide">Aucune donnee</td></tr>`;
  } catch (e) {
    afficherMessage(message,'danger',e.message);
  }
}

function ouvrirFormulaire() {
  document.getElementById('titre-modal').textContent = cfg.action;
  masquerMessage(messageForm);
  const zone = document.getElementById('champs-module');
  if (cfg.json) {
    const exemple = moduleName === 'rapports' ? { ...cfg.exemple, ...periodeRapport() } : cfg.exemple;
    zone.innerHTML = `<div class="champ"><label for="donnees-json">Donnees JSON</label><textarea class="form-control" id="donnees-json" rows="12">${echapper(JSON.stringify(exemple,null,2))}</textarea></div>`;
  } else {
    zone.innerHTML = cfg.champs.map(([cle,label]) => `<div class="champ"><label for="champ-${cle}">${echapper(label)}</label><input class="form-control" id="champ-${cle}" name="${cle}" /></div>`).join('');
  }
  modal?.show();
}

async function envoyer(event) {
  event.preventDefault();
  let body;
  let endpoint = cfg.endpoint;
  try {
    body = cfg.json
      ? JSON.parse(document.getElementById('donnees-json').value)
      : Object.fromEntries(cfg.champs.map(([cle]) => [cle, document.querySelector('#champ-'+cle)?.value]));
  } catch (e) {
    afficherMessage(messageForm,'danger','JSON invalide.');
    return;
  }
  try {
    if (moduleName === 'rapports') {
      const debut = encodeURIComponent(body.debut || periodeRapport().debut);
      const fin = encodeURIComponent(body.fin || periodeRapport().fin);
      await api(`/rapports?debut=${debut}&fin=${fin}`);
      const reponse = await fetch(`/api/rapports/export.csv?debut=${debut}&fin=${fin}`, {
        headers: { Authorization: `Bearer ${session.jetonAcces()}` },
      });
      if (!reponse.ok) throw new Error('Export du rapport impossible.');
      const lien = document.createElement('a');
      const url = URL.createObjectURL(await reponse.blob());
      lien.href = url;
      lien.download = 'rapport-simaotech.csv';
      lien.click();
      URL.revokeObjectURL(url);
      modal?.hide();
      return;
    }
    if (moduleName === 'stocks') endpoint = '/stocks/ajuster';
    if (moduleName === 'approvisionnements') endpoint = '/approvisionnements';
    if (moduleName === 'parametres') {
      endpoint = `/parametres/${encodeURIComponent(body.cle)}`;
      body = { valeur: body.valeur };
    }
    if (['ventes', 'approvisionnements', 'depenses'].includes(moduleName)) {
      body.cleIdempotence ||= crypto.randomUUID();
    }
    await api(endpoint, { methode: moduleName === 'parametres' ? 'PATCH' : 'POST', corps: body });
    modal?.hide();
    afficherMessage(message,'success','Operation enregistree.');
    await charger();
  } catch (e) {
    if (
      (!navigator.onLine || e.code === 'RESEAU_INDISPONIBLE') &&
      ['ventes', 'approvisionnements', 'depenses'].includes(moduleName)
    ) {
      try {
        body.cleIdempotence ||= crypto.randomUUID();
        if (moduleName === 'ventes') body.horsLigne = true;
        await ajouterOperation({ endpoint: '/api' + endpoint, corps: body });
        modal?.hide();
        afficherMessage(message,'info','Operation en attente de synchronisation. Elle sera revalidee par le serveur.');
        return;
      } catch (erreurStockage) {
        afficherMessage(messageForm, 'danger', `Impossible de mettre l operation en attente : ${erreurStockage.message}`);
        return;
      }
    }
    afficherMessage(messageForm,'danger',e.message);
  }
}

async function init() {
  brancherMenuMobile();
  const utilisateur = await protegerPage();
  if (!utilisateur) return;
  rendreMenu(moduleName, utilisateur);
  rendreUtilisateur(utilisateur);
  document.getElementById('role-utilisateur').textContent = utilisateur.role?.nom ?? '';
  brancherDeconnexion();
  surveillerReseau(document.getElementById('pastille-reseau'));
  window.addEventListener('simaotech:synchronisation', (event) => {
    const { message: texte, type = 'info' } = event.detail ?? {};
    if (texte) afficherMessage(message, type, texte);
    if (type === 'success') charger();
  });
  document.getElementById('bouton-nouveau').addEventListener('click', ouvrirFormulaire);
  document.getElementById('formulaire-module').addEventListener('submit', envoyer);
  await charger();
}
init().catch(e => afficherMessage(message,'danger',e.message));
