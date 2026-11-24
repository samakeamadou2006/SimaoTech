/**
 * Ecran de gestion des comptes et des permissions.
 *
 * Toutes les actions passent par l'API ; aucun bouton n'est decoratif.
 * L'interface masque les actions interdites, mais le serveur reste seul juge.
 */
import { api } from './api.js';
import {
  aPermission,
  afficherMessage,
  brancherDeconnexion,
  brancherMenuMobile,
  echapper,
  formatDate,
  initiales,
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
let catalogue = null;
let ciblePermissions = null;
let actionConfirmee = null;

const zoneMessage = document.getElementById('message-utilisateurs');
const corps = document.getElementById('corps-utilisateurs');
const champRecherche = document.getElementById('recherche-utilisateurs');
const filtreRole = document.getElementById('filtre-role');
const filtreActif = document.getElementById('filtre-actif');
const resumePagination = document.getElementById('resume-pagination');
const boutonPrecedent = document.getElementById('bouton-page-precedente');
const boutonSuivant = document.getElementById('bouton-page-suivante');
const boutonNouvel = document.getElementById('bouton-nouvel-utilisateur');

const formulaire = document.getElementById('formulaire-utilisateur');
const champId = document.getElementById('utilisateur-id');
const champNom = document.getElementById('nom-complet');
const champEmail = document.getElementById('email-utilisateur');
const champTelephone = document.getElementById('telephone-utilisateur');
const champRole = document.getElementById('role-employe');
const champMotDePasse = document.getElementById('mot-de-passe-initial');
const blocMotDePasse = document.getElementById('champ-mot-de-passe');
const titreModal = document.getElementById('titre-modal-utilisateur');
const boutonEnregistrer = document.getElementById('bouton-enregistrer-utilisateur');
const messageFormulaire = document.getElementById('message-formulaire');

const listePermissions = document.getElementById('liste-permissions');
const titrePermissions = document.getElementById('titre-modal-permissions');
const sousTitrePermissions = document.getElementById('sous-titre-permissions');
const messagePermissions = document.getElementById('message-permissions');

const modalUtilisateur = new bootstrap.Modal(document.getElementById('modal-utilisateur'));
const modalPermissions = new bootstrap.Modal(document.getElementById('modal-permissions'));
const modalConfirmation = new bootstrap.Modal(document.getElementById('modal-confirmation'));
const modalIdentifiants = new bootstrap.Modal(document.getElementById('modal-identifiants'));

function texteErreur(erreur) {
  if (erreur.code === 'MOT_DE_PASSE_A_CHANGER') {
    return 'Vous devez d abord changer votre mot de passe.';
  }
  if (erreur.code === 'BASE_INDISPONIBLE') {
    return 'La base de donnees n est pas disponible.';
  }
  return erreur.message ?? 'Une erreur est survenue.';
}

function pastilleRole(code) {
  const libelles = {
    PROPRIETAIRE: 'Proprietaire',
    ADMINISTRATEUR: 'Administrateur',
    EMPLOYE: 'Employe',
  };
  const classes = {
    PROPRIETAIRE: 'pastille--succes',
    ADMINISTRATEUR: 'pastille--alerte',
    EMPLOYE: '',
  };
  return `<span class="pastille ${classes[code] ?? ''}">${echapper(libelles[code] ?? code)}</span>`;
}

function rendreLignes(utilisateurs) {
  if (!corps) return;
  if (!utilisateurs.length) {
    corps.innerHTML =
      '<tr><td colspan="5" class="vide">Aucun compte ne correspond a ces criteres.</td></tr>';
    return;
  }

  corps.innerHTML = utilisateurs
    .map((utilisateur) => {
      const soiMeme = utilisateur.id === utilisateurCourant.id;
      const estProprietaire = utilisateur.role_code === 'PROPRIETAIRE';
      const actions = [];

      actions.push(
        `<button type="button" class="btn btn-st-contour btn-sm" data-action="modifier" data-id="${utilisateur.id}">Modifier</button>`,
      );

      if (!soiMeme && !estProprietaire) {
        actions.push(
          `<button type="button" class="btn btn-st-contour btn-sm" data-action="permissions" data-id="${utilisateur.id}">Permissions</button>`,
        );
      }
      if (!soiMeme) {
        actions.push(
          `<button type="button" class="btn btn-st-contour btn-sm" data-action="reinitialiser" data-id="${utilisateur.id}">Reinitialiser</button>`,
        );
      }
      if (!soiMeme && !estProprietaire) {
        actions.push(
          utilisateur.actif
            ? `<button type="button" class="btn btn-st-contour btn-sm" data-action="desactiver" data-id="${utilisateur.id}">Desactiver</button>`
            : `<button type="button" class="btn btn-st-contour btn-sm" data-action="reactiver" data-id="${utilisateur.id}">Reactiver</button>`,
        );
        actions.push(
          `<button type="button" class="btn btn-outline-danger btn-sm" data-action="supprimer" data-id="${utilisateur.id}">Supprimer</button>`,
        );
      }

      return `
        <tr>
          <td>
            <div class="cellule-personne">
              <span class="avatar avatar--petit">${echapper(initiales(utilisateur.nom_complet))}</span>
              <div>
                <strong>${echapper(utilisateur.nom_complet)}</strong>
                <div class="texte-petit texte-doux">${echapper(utilisateur.email)}</div>
                ${
                  utilisateur.doit_changer_mot_de_passe
                    ? '<span class="pastille pastille--alerte mt-1">Mot de passe a changer</span>'
                    : ''
                }
              </div>
            </div>
          </td>
          <td>${pastilleRole(utilisateur.role_code)}</td>
          <td>
            <span class="pastille ${utilisateur.actif ? 'pastille--succes' : 'pastille--danger'}">
              ${utilisateur.actif ? 'Actif' : 'Inactif'}
            </span>
          </td>
          <td class="texte-petit">${formatDate(utilisateur.derniere_connexion)}</td>
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
    'stat-administrateurs': statistiques.administrateurs,
    'stat-a-changer': statistiques.mot_de_passe_a_changer,
  };
  for (const [id, valeur] of Object.entries(cibles)) {
    const element = document.getElementById(id);
    if (element) element.textContent = valeur ?? '-';
  }
}

async function chargerUtilisateurs() {
  const parametres = new URLSearchParams({ page: String(page), limite: String(LIMITE) });
  if (champRecherche?.value.trim()) parametres.set('recherche', champRecherche.value.trim());
  if (filtreRole?.value) parametres.set('role', filtreRole.value);
  if (filtreActif?.value) parametres.set('actif', filtreActif.value);

  corps.innerHTML = '<tr><td colspan="5" class="vide">Chargement...</td></tr>';

  try {
    const { donnees, meta } = await api(`/utilisateurs?${parametres.toString()}`);
    total = meta?.total ?? donnees.length;
    rendreStatistiques(meta?.statistiques);
    rendreLignes(donnees);

    const nombrePages = Math.max(1, Math.ceil(total / LIMITE));
    if (page > nombrePages) {
      page = nombrePages;
      return chargerUtilisateurs();
    }
    if (resumePagination) {
      resumePagination.textContent = `${total} compte(s) - page ${page} sur ${nombrePages}`;
    }
    if (boutonPrecedent) boutonPrecedent.disabled = page <= 1;
    if (boutonSuivant) boutonSuivant.disabled = page >= nombrePages;
    return meta;
  } catch (erreur) {
    corps.innerHTML = '<tr><td colspan="5" class="vide">Liste indisponible.</td></tr>';
    afficherMessage(zoneMessage, 'erreur', texteErreur(erreur));
    return null;
  }
}

function reinitialiserFormulaire() {
  formulaire.reset();
  champId.value = '';
  champEmail.disabled = false;
  champRole.disabled = false;
  blocMotDePasse.hidden = false;
  champMotDePasse.required = false;
  masquerMessage(messageFormulaire);

  champRole.innerHTML = `
    <option value="EMPLOYE">Employe / Vendeur</option>
    <option value="ADMINISTRATEUR">Administrateur</option>
  `;
}

function ouvrirCreation() {
  reinitialiserFormulaire();
  titreModal.textContent = 'Nouvel employe';
  boutonEnregistrer.textContent = 'Creer le compte';
  modalUtilisateur.show();
  setTimeout(() => champNom.focus(), 250);
}

function ouvrirModification(utilisateur) {
  reinitialiserFormulaire();
  titreModal.textContent = 'Modifier un employe';
  boutonEnregistrer.textContent = 'Enregistrer';

  champId.value = utilisateur.id;
  champNom.value = utilisateur.nom_complet ?? '';
  champEmail.value = utilisateur.email ?? '';
  champEmail.disabled = true;
  champTelephone.value = utilisateur.telephone ?? '';
  blocMotDePasse.hidden = true;
  champMotDePasse.value = '';

  if (utilisateur.role_code === 'PROPRIETAIRE') {
    champRole.innerHTML = '<option value="PROPRIETAIRE">Proprietaire</option>';
    champRole.disabled = true;
  } else if (utilisateur.id === utilisateurCourant.id) {
    champRole.value = utilisateur.role_code;
    champRole.disabled = true;
  } else {
    champRole.value = utilisateur.role_code;
  }

  modalUtilisateur.show();
  setTimeout(() => champNom.focus(), 250);
}

async function soumettreFormulaire(evenement) {
  evenement.preventDefault();
  masquerMessage(messageFormulaire);

  const identifiant = champId.value;
  const creation = !identifiant;
  const nomComplet = champNom.value.trim();
  const email = champEmail.value.trim();
  const telephone = champTelephone.value.trim();
  const roleCode = champRole.disabled ? undefined : champRole.value;
  const motDePasse = creation ? champMotDePasse.value : '';

  if (nomComplet.length < 2) {
    afficherMessage(messageFormulaire, 'erreur', 'Le nom complet est obligatoire.');
    return;
  }
  if (creation && !email) {
    afficherMessage(messageFormulaire, 'erreur', 'L adresse e-mail est obligatoire.');
    return;
  }
  if (creation && motDePasse && motDePasse.length < 10) {
    afficherMessage(messageFormulaire, 'erreur', 'Le mot de passe doit contenir au moins 10 caracteres.');
    return;
  }

  const corpsRequete = { nomComplet, telephone: telephone || null };
  if (roleCode) corpsRequete.roleCode = roleCode;
  if (creation) {
    corpsRequete.email = email;
    if (motDePasse) corpsRequete.motDePasse = motDePasse;
  }

  boutonEnregistrer.disabled = true;
  try {
    const { donnees } = creation
      ? await api('/utilisateurs', { methode: 'POST', corps: corpsRequete })
      : await api(`/utilisateurs/${identifiant}`, { methode: 'PATCH', corps: corpsRequete });

    modalUtilisateur.hide();

    if (creation) {
      afficherMessage(zoneMessage, 'succes', `Compte cree pour ${donnees.utilisateur.email}.`);
      if (donnees.motDePasseTemporaire) {
        afficherIdentifiants(donnees.utilisateur.email, donnees.motDePasseTemporaire);
      } else if (donnees.modeLocal) {
        afficherMessage(
          zoneMessage,
          'info',
          'Compte cree en mode local. Aucun mot de passe n est verifie dans ce mode de developpement.',
        );
      }
    } else {
      afficherMessage(zoneMessage, 'succes', 'Compte mis a jour.');
    }
    await chargerUtilisateurs();
  } catch (erreur) {
    afficherMessage(messageFormulaire, 'erreur', texteErreur(erreur));
  } finally {
    boutonEnregistrer.disabled = false;
  }
}

function afficherIdentifiants(email, motDePasse) {
  document.getElementById('identifiants-email').value = email;
  document.getElementById('identifiants-mot-de-passe').value = motDePasse;
  document.getElementById('identifiants-avertissement').textContent =
    'Communiquez ces identifiants par un canal sur. Ils ne seront plus affiches.';
  modalIdentifiants.show();
}

async function ouvrirPermissions(identifiant) {
  masquerMessage(messagePermissions);
  listePermissions.innerHTML = '<p class="texte-doux">Chargement...</p>';
  titrePermissions.textContent = 'Permissions';
  sousTitrePermissions.textContent = '-';
  modalPermissions.show();

  try {
    const { donnees } = await api(`/utilisateurs/${identifiant}`);
    ciblePermissions = donnees;
    titrePermissions.textContent = `Permissions de ${donnees.nom_complet}`;
    sousTitrePermissions.textContent = `Role ${donnees.role_nom} - ${donnees.email}`;

    const duRole = new Set((donnees.permissions_role ?? []).map((p) => p.id));
    const derogations = new Map(
      (donnees.derogations ?? []).map((d) => [
        d.permission_id,
        d.accorde ? 'accorde' : 'retire',
      ]),
    );

    const modules = [...new Set(catalogue.permissions.map((p) => p.module))];
    listePermissions.innerHTML = modules
      .map((module) => {
        const permissions = catalogue.permissions.filter((p) => p.module === module);
        return `
          <div class="permission-module">
            <h3 class="permission-module__titre">${echapper(module)}</h3>
            ${permissions
              .map((permission) => {
                const valeur = derogations.get(permission.id) ?? 'herite';
                const base = duRole.has(permission.id);
                return `
                  <div class="permission-ligne">
                    <div class="permission-ligne__libelle">
                      <strong>${echapper(permission.nom)}</strong>
                      <span class="texte-petit texte-doux">${echapper(permission.code)}</span>
                    </div>
                    <span class="pastille ${base ? 'pastille--succes' : ''}">
                      Role : ${base ? 'oui' : 'non'}
                    </span>
                    <select
                      class="form-select form-select-sm"
                      data-permission="${permission.id}"
                      aria-label="Derogation pour ${echapper(permission.nom)}"
                    >
                      <option value="herite" ${valeur === 'herite' ? 'selected' : ''}>Herite du role</option>
                      <option value="accorde" ${valeur === 'accorde' ? 'selected' : ''}>Accorder</option>
                      <option value="retire" ${valeur === 'retire' ? 'selected' : ''}>Retirer</option>
                    </select>
                  </div>
                `;
              })
              .join('')}
          </div>
        `;
      })
      .join('');
  } catch (erreur) {
    listePermissions.innerHTML = '';
    afficherMessage(messagePermissions, 'erreur', texteErreur(erreur));
  }
}

async function enregistrerPermissions() {
  if (!ciblePermissions) return;
  const bouton = document.getElementById('bouton-enregistrer-permissions');
  const derogations = [...listePermissions.querySelectorAll('select[data-permission]')]
    .filter((select) => select.value !== 'herite')
    .map((select) => ({
      permissionId: select.dataset.permission,
      accorde: select.value === 'accorde',
    }));

  bouton.disabled = true;
  try {
    await api(`/utilisateurs/${ciblePermissions.id}/permissions`, {
      methode: 'PUT',
      corps: { derogations },
    });
    modalPermissions.hide();
    afficherMessage(zoneMessage, 'succes', 'Permissions mises a jour.');
    await chargerUtilisateurs();
  } catch (erreur) {
    afficherMessage(messagePermissions, 'erreur', texteErreur(erreur));
  } finally {
    bouton.disabled = false;
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
    const gerer = () => {
      actionConfirmee = null;
    };
    document.getElementById('modal-confirmation').addEventListener('hidden.bs.modal', gerer, {
      once: true,
    });
  });
}

async function executerAction(action, identifiant) {
  const utilisateur = utilisateurCourant;
  const cible =
    (await api(`/utilisateurs/${identifiant}`).then((r) => r.donnees).catch(() => null)) ?? null;

  if (action === 'modifier') {
    if (cible) ouvrirModification(cible);
    return;
  }
  if (action === 'permissions') {
    await ouvrirPermissions(identifiant);
    return;
  }
  if (action === 'reinitialiser') {
    const confirme = await demanderConfirmation({
      titre: 'Reinitialiser le mot de passe',
      texte: `Un mot de passe temporaire sera genere pour ${cible?.nom_complet ?? 'cet employe'}. Il devra etre change a la prochaine connexion.`,
      libelle: 'Reinitialiser',
    });
    if (!confirme) return;
    try {
      const { donnees } = await api(`/utilisateurs/${identifiant}/reinitialiser-mot-de-passe`, {
        methode: 'POST',
      });
      afficherIdentifiants(cible?.email ?? '', donnees.motDePasseTemporaire);
      await chargerUtilisateurs();
    } catch (erreur) {
      afficherMessage(zoneMessage, 'erreur', texteErreur(erreur));
    }
    return;
  }
  if (action === 'desactiver' || action === 'reactiver') {
    const actif = action === 'reactiver';
    const confirme = await demanderConfirmation({
      titre: actif ? 'Reactiver le compte' : 'Desactiver le compte',
      texte: actif
        ? `${cible?.nom_complet ?? 'Cet employe'} pourra de nouveau se connecter.`
        : `${cible?.nom_complet ?? 'Cet employe'} ne pourra plus se connecter. L historique est conserve.`,
      libelle: actif ? 'Reactiver' : 'Desactiver',
    });
    if (!confirme) return;
    try {
      await api(`/utilisateurs/${identifiant}`, { methode: 'PATCH', corps: { actif } });
      afficherMessage(zoneMessage, 'succes', actif ? 'Compte reactive.' : 'Compte desactive.');
      await chargerUtilisateurs();
    } catch (erreur) {
      afficherMessage(zoneMessage, 'erreur', texteErreur(erreur));
    }
    return;
  }
  if (action === 'supprimer') {
    const confirme = await demanderConfirmation({
      titre: 'Supprimer le compte',
      texte: `${cible?.nom_complet ?? 'Cet employe'} sera archive et ne pourra plus se connecter. Aucune donnee historique n est supprimee.`,
      libelle: 'Supprimer',
    });
    if (!confirme) return;
    try {
      await api(`/utilisateurs/${identifiant}`, { methode: 'DELETE' });
      afficherMessage(zoneMessage, 'succes', 'Compte archive.');
      await chargerUtilisateurs();
    } catch (erreur) {
      afficherMessage(zoneMessage, 'erreur', texteErreur(erreur));
    }
  }
}

let minuterieRecherche = null;
function programmerRecherche() {
  clearTimeout(minuterieRecherche);
  minuterieRecherche = setTimeout(() => {
    page = 1;
    chargerUtilisateurs();
  }, 300);
}

async function initialiser() {
  brancherMenuMobile();
  surveillerReseau(document.getElementById('pastille-reseau'));
  brancherDeconnexion();

  utilisateurCourant = await protegerPage();
  if (!utilisateurCourant) return;

  rendreMenu('utilisateurs', utilisateurCourant);
  rendreUtilisateur(utilisateurCourant);
  document.getElementById('role-utilisateur').textContent =
    utilisateurCourant.role?.nom ?? utilisateurCourant.role?.code ?? '-';

  if (!aPermission(utilisateurCourant, 'utilisateurs.gerer')) {
    document.getElementById('panneau-acces-refuse').hidden = false;
    document.getElementById('contenu-utilisateurs').hidden = true;
    return;
  }

  corpusEvenements();

  try {
    const { donnees } = await api('/utilisateurs/catalogue');
    catalogue = donnees;
  } catch (erreur) {
    afficherMessage(zoneMessage, 'erreur', `Catalogue indisponible : ${texteErreur(erreur)}`);
    return;
  }

  await chargerUtilisateurs();
}

function corpusEvenements() {
  boutonNouvel?.addEventListener('click', ouvrirCreation);
  formulaire?.addEventListener('submit', soumettreFormulaire);

  champRecherche?.addEventListener('input', programmerRecherche);
  filtreRole?.addEventListener('change', () => {
    page = 1;
    chargerUtilisateurs();
  });
  filtreActif?.addEventListener('change', () => {
    page = 1;
    chargerUtilisateurs();
  });

  boutonPrecedent?.addEventListener('click', () => {
    if (page > 1) {
      page -= 1;
      chargerUtilisateurs();
    }
  });
  boutonSuivant?.addEventListener('click', () => {
    page += 1;
    chargerUtilisateurs();
  });

  corps?.addEventListener('click', (evenement) => {
    const bouton = evenement.target.closest('button[data-action]');
    if (!bouton) return;
    executerAction(bouton.dataset.action, bouton.dataset.id);
  });

  document
    .getElementById('bouton-enregistrer-permissions')
    ?.addEventListener('click', enregistrerPermissions);

  document.getElementById('confirmation-valider')?.addEventListener('click', () => {
    modalConfirmation.hide();
    const resoudre = actionConfirmee;
    actionConfirmee = null;
    resoudre?.(true);
  });

  document.getElementById('modal-confirmation')?.addEventListener('hidden.bs.modal', () => {
    if (actionConfirmee) {
      const resoudre = actionConfirmee;
      actionConfirmee = null;
      resoudre(false);
    }
  });

  document.getElementById('bouton-copier-mot-de-passe')?.addEventListener('click', async (evenement) => {
    const champ = document.getElementById('identifiants-mot-de-passe');
    try {
      await navigator.clipboard.writeText(champ.value);
      evenement.currentTarget.textContent = 'Copie';
      setTimeout(() => {
        evenement.currentTarget.textContent = 'Copier';
      }, 2000);
    } catch {
      champ.select();
      document.execCommand('copy');
    }
  });
}

initialiser().catch((erreur) => {
  afficherMessage(zoneMessage, 'erreur', erreur.message ?? 'Erreur inattendue.');
});
