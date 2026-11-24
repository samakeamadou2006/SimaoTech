# Plan de synchronisation multi-appareils

## 1. Principe

Le serveur reste la source de verite. Une operation hors ligne est une intention
locale, pas une vente confirmee ; elle doit repasser par les validations serveur
avant d'etre consideree comme enregistree.

La file IndexedDB actuelle accepte les ventes, approvisionnements et depenses.
Elle ne constitue pas encore un moteur de synchronisation complet : les quotas
de stock et la resolution automatique ou manuelle des conflits ne sont pas relies
au parcours de reprise.

## 2. File et idempotence (etat actuel)

- Le client attribue une cle UUID aux mutations mises en file, avant le premier
  envoi, afin de conserver la meme cle lors des tentatives suivantes.
- La mise en file est limitee aux ventes, approvisionnements et depenses. Les
  ajustements de stock et demandes d'annulation ne sont pas rejoues hors ligne.
- La base comporte des contraintes d'unicite sur les cles d'idempotence.
- `POST /api/synchronisation` enregistre une operation idempotente, mais ne
  rejoue pas lui-meme la mutation metier et ne fournit pas encore un cycle
  complet de restitution du resultat initial.
- Une operation rejetee reste dans la file et l'erreur est remontee a l'interface ;
  elle n'est pas supprimee silencieusement.

## 3. Quotas de stock hors ligne (a integrer)

Le schema contient `quotas_stock_appareil`, mais les quotas par appareil et le
CMP fige ne sont pas encore connectes au parcours de vente hors ligne. Il ne faut
donc pas presenter le fonctionnement actuel comme une garantie de stock reserve
entre plusieurs appareils.

La cible devra affecter une quantite et un CMP de reference a chaque couple
(appareil, produit), appliquer ce quota hors ligne, puis revalider la vente avec
le stock et le CMP courants au serveur.

## 4. Comportement actuel et cible

Au retour en ligne et a l'affichage de la page, le client tente de vider la file
via le client API. Le service worker met en cache la coque de l'application ; il
ne rejoue pas les mutations metier.

Le parcours complet a realiser devra :

1. reprendre les operations dans l'ordre et reutiliser leur cle d'idempotence ;
2. authentifier le compte et verifier ses permissions et l'etat de l'appareil ;
3. appliquer les validations metier existantes (stock, CMP, paiements et montants) ;
4. enregistrer les conflits avec un motif visible, sans comptabiliser une operation
   invalide ;
5. retirer de la file uniquement une operation dont le resultat a ete confirme ;
6. actualiser le cache local apres confirmation serveur.

Ces etapes ne sont pas toutes implementees par le flux actuel. Les validations des
routes metier restent la reference lors d'une reprise ; le stockage d'une operation
de synchronisation seul ne constitue pas sa validation.

## 5. Conflits a prendre en charge

| Cas | Traitement cible |
|---|---|
| Stock insuffisant | Refuser la vente et afficher une anomalie a traiter |
| Prix net inferieur au CMP courant | Refuser la vente et conserver le motif |
| Cle d'idempotence deja traitee | Eviter une seconde mutation et restituer le resultat precedent |
| Lignes ou paiements incomplets | Refuser l'operation sans ecriture comptable |
| Permission retiree ou appareil revoque | Refuser la synchronisation et afficher l'erreur |

La detection, la persistance et la resolution utilisateur de tous ces cas restent
a finaliser. Ne pas supposer qu'ils sont actuellement transformes en conflits
persistants.

## 6. Securite hors ligne

- Ne stocker dans IndexedDB que les donnees necessaires au fonctionnement hors ligne.
- Ne jamais stocker de cle privee ou de secret serveur dans le navigateur.
- Une operation conservee localement doit etre revalidee par le serveur avant
  toute confirmation metier.
- Les ventes Mobile Money hors ligne ne sont pas confirmees par la seule presence
  d'une reference saisie sur l'appareil.

## 7. Etat d'avancement

- **Present** : stockage IndexedDB, file limitee a trois types de mutations,
  cles d'idempotence pour les envois pris en charge, reprise au retour en ligne
  et au chargement, conservation des echecs.
- **A terminer** : quotas stock/CMP par appareil, synchronisation idempotente
  avec restitution du resultat, traitement complet des conflits, tests des
  reprises et interface de resolution.
- Le module ne doit pas etre considere comme une synchronisation hors ligne
  complete ni comme pret pour un deploiement de production.
