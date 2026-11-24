/**
 * Fonctions d'interface partagees : formatage, messages, menu, session.
 */
import { api } from './api.js';
import { session } from './session.js';

export const DEVISE = 'XOF';

const formateurMontant = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** 12500 -> "12 500 FCFA" (aucun arrondi masque : le serveur fournit la valeur exacte). */
export function formatMontant(valeur) {
  if (valeur === null || valeur === undefined || valeur === '') return '-';
  const nombre = Number(valeur);
  if (!Number.isFinite(nombre)) return '-';
  return `${formateurMontant.format(nombre)} FCFA`;
}

export function formatQuantite(valeur, decimales = 0) {
  if (valeur === null || valeur === undefined || valeur === '') return '-';
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: 3,
  }).format(Number(valeur));
}

export function formatDate(valeur, { avecHeure = true } = {}) {
  if (!valeur) return '-';
  const date = valeur instanceof Date ? valeur : new Date(valeur);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short',
    ...(avecHeure ? { timeStyle: 'short' } : {}),
  }).format(date);
}

export function initiales(nom) {
  return String(nom ?? '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((mot) => mot.charAt(0).toUpperCase())
    .join('');
}

export function echapper(valeur) {
  return String(valeur ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function afficherMessage(element, type, texte) {
  if (!element) return;
  element.className = `message message--${type}`;
  element.textContent = texte;
  element.hidden = false;
}

export function masquerMessage(element) {
  if (!element) return;
  element.hidden = true;
  element.textContent = '';
}

export function basculerMenu() {
  document.body.classList.toggle('menu-ouvert');
}

export function brancherMenuMobile() {
  document.getElementById('bouton-menu')?.addEventListener('click', basculerMenu);
  document.getElementById('voile-menu')?.addEventListener('click', () => {
    document.body.classList.remove('menu-ouvert');
  });
  document.querySelectorAll('.menu-lateral__lien').forEach((lien) => {
    lien.addEventListener('click', () => document.body.classList.remove('menu-ouvert'));
  });
}

/** Menu lateral : seules les pages reellement livrees sont actives. */
const ENTREES_MENU = [
  { section: 'Pilotage', liens: [{ id: 'tableau-de-bord', libelle: 'Tableau de bord', href: '/pages/tableau-de-bord.html' }] },
  {
    section: 'Catalogue',
    liens: [
      {
        id: 'produits',
        libelle: 'Produits',
        href: '/pages/produits.html',
        permission: 'produits.consulter',
      },
      {
        id: 'categories',
        libelle: 'Categories',
        href: '/pages/categories.html',
        permission: 'produits.consulter',
      },
      { id: 'fournisseurs', libelle: 'Fournisseurs', href: '/pages/module.html?module=fournisseurs', permission: 'fournisseurs.gerer' },
    ],
  },
  {
    section: 'Activite',
    liens: [
      { id: 'approvisionnements', libelle: 'Approvisionnements', href: '/pages/module.html?module=approvisionnements', permission: 'approvisionnements.consulter' },
      { id: 'stocks', libelle: 'Stocks', href: '/pages/module.html?module=stocks', permission: 'stocks.consulter' },
      { id: 'ventes', libelle: 'Ventes', href: '/pages/module.html?module=ventes', permission: 'ventes.creer' },
      { id: 'depenses', libelle: 'Depenses', href: '/pages/module.html?module=depenses', permission: 'depenses.consulter' },
      { id: 'annulations', libelle: 'Annulations', href: '/pages/module.html?module=annulations', permission: 'ventes.annuler_demander' },
    ],
  },
  {
    section: 'Administration',
    liens: [
      {
        id: 'utilisateurs',
        libelle: 'Employes et permissions',
        href: '/pages/utilisateurs.html',
        permission: 'utilisateurs.gerer',
      },
      { id: 'rapports', libelle: 'Rapports', href: '/pages/module.html?module=rapports', permission: 'rapports.consulter' },
      { id: 'parametres', libelle: 'Parametres', href: '/pages/module.html?module=parametres', permission: 'parametres.gerer' },
    ],
  },
  {
    section: 'Mon compte',
    liens: [
      { id: 'mon-compte', libelle: 'Mot de passe', href: '/pages/mot-de-passe.html' },
    ],
  },
];

export function aPermission(utilisateur, code) {
  if (!utilisateur) return false;
  return Boolean(utilisateur.estProprietaire || utilisateur.permissions?.includes(code));
}

export function rendreMenu(actif, utilisateur = null) {
  const cible = document.getElementById('menu-lateral');
  if (!cible) return;
  const blocs = ENTREES_MENU.map((groupe) => {
    const liens = groupe.liens
      .filter((lien) => !lien.permission || aPermission(utilisateur, lien.permission))
      .map((lien) => {
        const classes = ['menu-lateral__lien'];
        if (lien.id === actif) classes.push('actif');
        if (!lien.href) classes.push('desactive');
        const contenu = `${echapper(lien.libelle)}${lien.href ? '' : ' <span class="visuellement-cache">(module a venir)</span>'}`;
        return lien.href
          ? `<a class="${classes.join(' ')}" href="${lien.href}">${contenu}</a>`
          : `<span class="${classes.join(' ')}" aria-disabled="true" title="Module livre dans une phase ulterieure">${contenu}</span>`;
      })
      .join('');
    if (!liens) return '';
    return `<div><div class="menu-lateral__section">${echapper(groupe.section)}</div>${liens}</div>`;
  }).join('');

  cible.innerHTML = `
    <div class="menu-lateral__marque">
      <img src="/images/logo.svg" alt="" width="34" height="34" />
      <span>SimaoTech</span>
    </div>
    ${blocs}
    <div class="menu-lateral__pied">Version 1.0.0<br />Gestion commerciale</div>
  `;
}

/**
 * Garde de page : verifie la session aupres du serveur et retourne
 * l'utilisateur applicatif. Redirige vers la connexion si necessaire.
 */
export async function protegerPage({ ignorerChangementMotDePasse = false } = {}) {
  if (!session.estConnecte()) {
    window.location.replace('/pages/connexion.html');
    return null;
  }
  try {
    const { donnees } = await api('/auth/moi');
    session.enregistrerUtilisateur(donnees.utilisateur);

    if (
      donnees.utilisateur.doitChangerMotDePasse &&
      !ignorerChangementMotDePasse &&
      window.location.pathname !== '/pages/mot-de-passe.html'
    ) {
      window.location.replace('/pages/mot-de-passe.html?obligatoire=1');
      return null;
    }

    return donnees.utilisateur;
  } catch (erreur) {
    if (erreur.statut === 401) {
      session.vider();
      window.location.replace('/pages/connexion.html?raison=session-expiree');
      return null;
    }
    throw erreur;
  }
}

export function rendreUtilisateur(utilisateur) {
  const zone = document.getElementById('zone-utilisateur');
  if (!zone || !utilisateur) return;
  zone.innerHTML = `
    <div class="d-none d-md-flex flex-column text-end">
      <span class="fw-semibold">${echapper(utilisateur.nomComplet)}</span>
      <span class="texte-petit texte-doux">${echapper(utilisateur.role?.nom ?? utilisateur.role?.code ?? '')}</span>
    </div>
    <span class="avatar" title="${echapper(utilisateur.nomComplet)}">${echapper(initiales(utilisateur.nomComplet))}</span>
  `;
}

export function brancherDeconnexion() {
  const bouton = document.getElementById('bouton-deconnexion');
  if (!bouton) return;
  bouton.addEventListener('click', async () => {
    bouton.disabled = true;
    try {
      await api('/auth/deconnexion', { methode: 'POST' });
    } catch {
      // La session locale est videe meme si la revocation distante echoue.
    } finally {
      session.vider();
      window.location.replace('/pages/connexion.html');
    }
  });
}

/** Indicateur de connexion reseau (reel, base sur le navigateur). */
export function surveillerReseau(element) {
  if (!element) return;
  const rendre = () => {
    const enLigne = navigator.onLine;
    element.className = `pastille ${enLigne ? 'pastille--succes' : 'pastille--danger'}`;
    element.textContent = enLigne ? 'En ligne' : 'Hors ligne';
  };
  rendre();
  window.addEventListener('online', rendre);
  window.addEventListener('offline', rendre);
}
