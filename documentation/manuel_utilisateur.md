# Manuel utilisateur - SimaoTech

Version 1.1 - mise a jour le 24 novembre 2026.

> Les API valident les regles metier ; certains parcours avances restent a finaliser.

## 1. Se connecter

1. Ouvrir l'adresse fournie par l'administrateur (ex. `https://simaotech.exemple.ci`).
2. Saisir l'adresse e-mail et le mot de passe communiques par le proprietaire.
3. Utiliser l'icone en forme d'oeil pour verifier le mot de passe saisi.
4. En cas d'oubli, cliquer sur **Mot de passe oublie** : un lien est envoye a l'adresse saisie.

En cas d'erreur, le message affiche la raison (identifiants incorrects, compte desactive, service indisponible).

L'acces est personnel : chaque operation est enregistree avec son auteur.

## 2. Comprendre les roles

### Proprietaire

Acces complet : produits, prix, stocks, approvisionnements, ventes, reductions, benefices, depenses, annulations, comptes, rapports, parametres.

### Employe / vendeur

Acces a la caisse et a ses propres ventes. Il peut demander une annulation, mais ne peut pas l'approuver, ni modifier un prix de reference, ni consulter les benefices globaux.

Certaines taches (enregistrer une depense, par exemple) necessitent une permission individuelle accordee par le proprietaire.

## 3. Employes et permissions (proprietaire)

Cet ecran n'est visible que si votre compte possede la permission `utilisateurs.gerer`
(en pratique : le proprietaire).

- **Nouvel employe** : nom, e-mail, telephone, role (`Employe / Vendeur` ou `Administrateur`) et,
  si vous le souhaitez, un mot de passe initial. Sans mot de passe, l'application en genere un et
  l'affiche **une seule fois** : notez-le et remettez-le a l'employe par un canal sur.
- Le role **Proprietaire** ne peut pas etre attribue depuis l'ecran ; il est reserve a la procedure
  d'installation.
- **Permissions** : la liste affiche chaque permission avec la valeur heritee du role. Une
  derogation « Accorder » ajoute une permission a cet employe, « Retirer » la lui enleve.
- **Reinitialiser** : genere un mot de passe temporaire. L'employe devra le changer a sa prochaine
  connexion ; tant qu'il ne l'a pas fait, les modules metier lui sont fermes.
- **Desactiver** : la connexion est refusee immediatement. **Reactiver** la retablit.
- **Supprimer** : archive le compte. Aucune vente, aucun paiement et aucune ligne du journal ne sont
  supprimes.

Les garde-fous : vous ne pouvez pas modifier votre propre role, votre propre statut ni vos propres
permissions, et le dernier proprietaire ou administrateur actif ne peut pas etre desactive.

## 4. Mon compte et mot de passe

Le menu **Mon compte > Mot de passe** permet de changer votre mot de passe :

1. saisir le mot de passe actuel ;
2. saisir le nouveau (au moins 10 caracteres, avec au moins une lettre et un chiffre) ;
3. confirmer, puis valider.

Apres une reinitialisation par le proprietaire, l'application vous redirige automatiquement vers
cet ecran : le changement est obligatoire avant tout autre acces. Le lien recu par e-mail depuis
« Mot de passe oublie » ouvre la page de reinitialisation et fonctionne de la meme facon.

## 5. Tableau de bord

Affiche des informations **reelles**, calculees a partir du serveur :

- etat du systeme (base connectee, migrations appliquees, mode d'authentification, service worker) ;
- etat du reseau (en ligne / hors ligne) ;
- indicateurs journaliers (chiffre d'affaires, benefice si autorise, alertes de stock et ventes validees) ;
- role, permissions effectives et vue d'ensemble des fonctions livrees ou a finaliser.

Les donnees sont chargees aupres de l'API ; une erreur de chargement est signalee et ne doit pas etre interpretee comme une valeur nulle.

## 6. Operations courantes

### Fournisseurs et achats

1. Creer un fournisseur avec un code unique et son nom.
2. Dans **Approvisionnements**, choisir le fournisseur, ajouter les produits, quantites,
   prix d'achat et reductions eventuelles.
3. Enregistrer le brouillon puis le valider depuis la liste. La validation met a jour le
   stock et le cout moyen pondere (CMP).

### Stocks et inventaires

- **Stocks** affiche les quantites disponibles ; un ajustement exige un motif et accepte
  une quantite positive (ajout) ou negative (retrait).
- **Inventaires** : creer un inventaire, saisir les quantites comptees puis valider les
  ecarts. Les validations restent soumises aux permissions du compte.

### Caisse et ventes

1. Ajouter les articles et leurs quantites ; le total est estime a partir du catalogue.
2. Si vous avez la permission de reduction, saisir une reduction par ligne.
3. Choisir un moyen de paiement. Pour Orange Money, MTN MoMo ou Wave, fournir la
   reference de transaction.
4. Enregistrer la vente. Le serveur recalcule et controle le montant final, le stock,
   le CMP et les paiements.

L'interface actuelle accepte un seul moyen de paiement par vente. Les paiements mixtes
et l'affichage/edition des recus restent a finaliser. Le prix de reference est fixe par
le proprietaire ; une vente sous le CMP est refusee.

### Depenses et annulations

- Une depense se cree avec categorie, montant et description ; elle attend ensuite la
  validation ou le rejet d'un compte autorise. Le justificatif est actuellement un lien,
  pas un televersement de fichier.
- Une annulation se demande pour une vente validee avec un motif. Un proprietaire ou un
  administrateur autorise peut l'approuver ou la rejeter. Une approbation conserve la
  vente d'origine et restitue le stock.

### Rapports

Choisir les dates de debut et de fin, consulter la synthese, puis exporter en CSV.
Les graphiques detailles et exports PDF/Excel ne sont pas encore disponibles.

## 7. Annulations

Une annulation approuvee :

- la vente d'origine est conservee et marquee **ANNULEE** ;
- les quantites retournent en stock ;
- le chiffre d'affaires et les benefices sont recalcules ;
- l'historique complet (demandeur, decideur, dates, motif) reste consultable.

## 8. Regles metier des ventes

- Le prix de vente de reference est fixe par le proprietaire.
- Une reduction est possible dans la limite du benefice : le prix net ne peut **jamais**
  descendre sous le cout moyen pondere (CMP).
- Exemple : prix 15 000 FCFA, CMP 12 000 FCFA, reduction 3 000 FCFA -> prix net
  12 000 FCFA, benefice 0 : autorise. Une reduction de 3 500 FCFA est refusee.
- Le montant du paiement doit etre exactement egal au montant net calcule par le serveur.
- Les references Mobile Money sont saisies manuellement ; aucune confirmation operateur
  n'est effectuee.

## 9. Hors connexion

L'application peut etre installee sur une tablette ou un telephone (menu du navigateur : **Installer l'application**).

Le mode hors connexion est partiel. Si le module est deja ouvert et que ses listes ont
ete chargees dans la session du navigateur, les formulaires peuvent mettre en attente
des ventes, achats ou depenses. Les listes locales expirent apres 24 heures. Les donnees
ne sont pas une reservation de stock et une vente n'est pas confirmee avant le retour au
serveur. Celui-ci revalide l'operation ; un echec peut la laisser en erreur dans la file.

Les quotas de stock par appareil et l'interface complete de correction/reprise des erreurs
ne sont pas encore disponibles. Ne pas utiliser ce mode comme garantie de vente hors ligne.

## 10. Questions frequentes

**Le stock affiche ne correspond pas au comptage physique.**
Realiser un inventaire : l'ecart constate est enregistre et justifie. Un ajustement manuel exige un motif.

**Pourquoi le benefice affiche est-il nul sur une vente ?**
La reduction a ramene le prix net au niveau du cout : la vente est autorisee mais ne degage aucune marge.

**Un vendeur ne voit pas les benefices.**
C'est normal : les benefices globaux sont reserves aux porteurs de la permission `benefices.consulter`.

**Une operation hors ligne est en erreur.**
Reconnecter l'application et communiquer le message affiche au proprietaire. La correction
et la remise en file depuis l'interface restent a finaliser.

## 11. Assistance

En cas de probleme, communiquer a l'administrateur :

1. l'heure exacte de l'incident ;
2. l'ecran concerne ;
3. le message affiche ;
4. l'identifiant de requete affiche dans la notification d'erreur (ou dans les outils de developpement).
