# Manuel utilisateur - SimaoTech

Version 1.0 - etat au 18 novembre 2026.

> Ce manuel decrit les ecrans disponibles. Les modules en cours de livraison sont signales.

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

Affiche des informations **reelles**, calculees a partir de la base :

- etat du systeme (base connectee, migrations appliquees, mode d'authentification, service worker) ;
- etat du reseau (en ligne / hors ligne) ;
- role et permissions effectives de l'utilisateur connecte.

Les indicateurs commerciaux (chiffre d'affaires du jour, de la semaine, du mois, benefice brut, depenses, benefice net, produits les plus vendus, stocks faibles, ruptures) seront actives avec les modules ventes, depenses et rapports. Aucune valeur fictive n'est affichee en attendant.

## 6. Regles de vente a connaitre

- Le prix de vente de reference est fixe par le proprietaire.
- Une reduction est possible dans la limite du benefice : le prix net ne peut **jamais** descendre sous le cout moyen pondere (CMP).
- Exemple : prix 15 000 FCFA, CMP 12 000 FCFA, reduction 3 000 FCFA -> prix net 12 000 FCFA, benefice 0 : autorise.
- Une reduction de 3 500 FCFA donnerait 11 500 FCFA : la vente est refusee.
- Le total des paiements doit etre **exactement** egal au montant de la vente (especes + Mobile Money).
- Les references Mobile Money (Orange Money, MTN MoMo, Wave) sont saisies manuellement et conservees.

## 7. Annulations

Un employe ne supprime jamais une vente. Il en fait la demande avec un motif. Le proprietaire (ou un administrateur autorise) approuve ou refuse. Si l'annulation est approuvee :

- la vente d'origine est conservee et marquee **ANNULEE** ;
- les quantites retournent en stock ;
- le chiffre d'affaires et les benefices sont recalcules ;
- l'historique complet (demandeur, decideur, dates, motif) reste consultable.

## 8. Depenses

Les depenses sont enregistrees avec une categorie (loyer, electricite, eau, internet, transport, salaires, entretien, fournitures, divers), un montant, une date, une description et, si possible, un justificatif.

Elles passent par les statuts : **en attente**, **validee**, **rejetee**, **annulee**. Seules les depenses validees sont deduites du benefice net de gestion.

## 9. Hors connexion

L'application peut etre installee sur une tablette ou un telephone (menu du navigateur : **Installer l'application**).

Hors connexion :

- le catalogue et les quotas disponibles restent consultables ;
- les ventes sont enregistrees localement avec la mention **En attente de synchronisation** ;
- aucune vente locale n'est consideree comme definitivement validee.

Au retour du reseau, les operations sont transmises au serveur, reverifiees (stock, cout, paiements, permissions), puis confirmees ou placees en anomalie. Une anomalie est conservee et doit etre traitee par le proprietaire.

## 10. Questions frequentes

**Le stock affiche ne correspond pas au comptage physique.**
Realiser un inventaire : l'ecart constate est enregistre et justifie. Un ajustement manuel exige un motif.

**Pourquoi le benefice affiche est-il nul sur une vente ?**
La reduction a ramene le prix net au niveau du cout : la vente est autorisee mais ne degage aucune marge.

**Un vendeur ne voit pas les benefices.**
C'est normal : les benefices globaux sont reserves aux porteurs de la permission `benefices.consulter`.

**La vente hors ligne n'apparait pas dans les totaux.**
Elle n'est comptabilisee qu'apres validation serveur. Verifier l'indicateur de synchronisation.

## 11. Assistance

En cas de probleme, communiquer a l'administrateur :

1. l'heure exacte de l'incident ;
2. l'ecran concerne ;
3. le message affiche ;
4. l'identifiant de requete affiche dans la notification d'erreur (ou dans les outils de developpement).
