# Decisions techniques et arbitrages

Ce document conserve la trace des choix pris lors de l'analyse du cahier des charges, notamment lorsqu'une precision ou une coherence manquait.

## 1. Authentification : Supabase Auth + backend

**Constat.** Le cahier des charges impose Supabase Auth et un backend qui controle toutes les operations sensibles.

**Decision.** Le navigateur ne parle qu'a l'API Express. Le backend relaie la connexion a Supabase Auth, verifie chaque jeton et charge le profil applicatif. La cle `service_role` ne quitte jamais le serveur. RLS reste activee pour tout acces direct via les cles publiques.

**Consequence.** Aucune requete PostgREST directe depuis le frontend. Toute nouvelle fonctionnalite passe par une route API.

## 2. Quantites : `produits` et `stocks`

**Constat.** Le cahier des charges liste les quantites dans la fiche produit et une table `stocks`.

**Decision.** `stocks` est l'unique source des quantites. `produits` ne contient pas de quantite. La vue `vue_produits` expose les quantites pour respecter la fiche produit fonctionnelle.

**Consequence.** Toute lecture de stock passe par `stocks` ou `vue_produits` ; toute ecriture passe par une fonction metier.

## 3. Vente a perte : `>=` et non `>`

**Constat.** Le texte autorise une vente avec benefice nul (prix net = CMP).

**Decision.** La contrainte SQL est `prix_net_unitaire >= cmp_applique` ; le controle est triple (interface, service, base).

## 4. Montants : `NUMERIC` + `decimal.js`

**Constat.** Le franc CFA n'a pas de sous-unite, mais les CMP et les repartitions produisent des fractions.

**Decision.** Tous les montants sont stockes en `numeric(16,2)`, les CMP en `numeric(18,6)`, et calculees avec `decimal.js` cote Node. Aucun flottant.

**Consequence.** L'API transporte les montants sous forme de chaines decimales pour eviter toute perte.

## 5. Autorite des calculs

**Constat.** Un client peut etre modifie, rejoue ou malveillant.

**Decision.** Les prix nets, couts et benefices de ligne sont recalcules par declencheur ; les totaux de vente par fonction ; le CMP uniquement par la validation d'approvisionnement.

**Consequence.** Le frontend ne peut pas imposer un prix net, un CMP, un benefice ou un total.

## 6. Reduction globale

**Constat.** Une reduction globale doit etre repartie de maniere deterministe et aucune ligne ne doit passer sous son CMP.

**Decision.** Repartition au plus fort reste en centimes entiers, depart d'egalite par identifiant croissant. Le serveur recalcule la repartition ; la base refuse toute ligne sous le CMP. La part globale est conservee par ligne (`remise_globale_affectee`).

## 7. Hors ligne

**Constat.** Un appareil deconnecte ne peut pas connaitre les changements de cout ou de stock des autres appareils.

**Cible.** Quotas de stock par appareil avec CMP fige, vente locale marquee
`EN_ATTENTE_SYNCHRONISATION`, revalidation serveur obligatoire et anomalie
conservee sans suppression. Aucune vente hors ligne ne doit etre comptabilisee
avant validation.

**Etat actuel.** IndexedDB met en file les ventes, approvisionnements et depenses
et reutilise leurs cles d'idempotence. Les quotas de stock par appareil ne sont
pas relies au formulaire de vente et la resolution complete des conflits reste
a faire. Voir `synchronisation.md`.

## 8. Role ADMINISTRATEUR

**Constat.** Le proprietaire peut autoriser un administrateur a approuver des annulations, mais seul le proprietaire modifie les prix de reference et gere les comptes.

**Decision.** `ADMINISTRATEUR` = toutes les permissions sauf `produits.modifier_prix`, `utilisateurs.gerer`, `permissions.gerer`, `parametres.gerer`.

## 9. Suppression

**Constat.** Les donnees comptables doivent rester coherentes.

**Decision.** Suppression logique pour produits, categories, fournisseurs et utilisateurs. Ventes, paiements, approvisionnements et historiques ne sont jamais supprimes. Une vente validee ne peut etre supprimee meme par SQL (`fn_proteger_vente`).

## 10. Numerotation

**Decision.** `PREFIXE-AAAAMM-000000` (VTE, APP, DEP, INV) via sequences PostgreSQL. Aucun numero genere cote client, ce qui evite les collisions multi-appareils.

## 11. Perimetre

Application mono-boutique. Aucun `boutique_id`, aucune notion d'abonnement ou de multi-tenant. Toute evolution vers un SaaS exigerait une refonte explicite, hors perimetre v1.

## 12. Comptes et proprietaire (phase 3)

**Constat.** Le cahier des charges exige que seul le proprietaire gere les comptes, mais l'application doit rester utilisable sans intervention SQL manuelle.

**Decision.**
- Le role `PROPRIETAIRE` n'est jamais attribuable par l'API : seul `npm run proprietaire` (script serveur, cle service) le cree ou le promeut.
- Un utilisateur ne peut modifier ni son role, ni son statut, ni ses permissions.
- Le dernier proprietaire et le dernier administrateur actifs sont proteges contre la desactivation et la suppression.
- La suppression est logique ; les profils et l'historique restent en base.
- Les mots de passe ne transitent que vers Supabase Auth. En mode local, les operations de mot de passe renvoient `503 AUTH_INDISPONIBLE` plutot que de simuler un stockage.
- Un mot de passe temporaire impose son remplacement : drapeau `doit_changer_mot_de_passe` verifie par le middleware `exigerMotDePasseAJour`.

**Consequence.** Aucune fenetre d'elevation de privileges via le navigateur, meme avec un jeton valide ou un appel direct a l'API. Les tests d'integration couvrent ces refus.

## 13. Points reportes

| Sujet | Phase |
|---|---|
| Generation PDF/Excel des rapports | 11 |
| Verification automatique des transactions Mobile Money | hors v1 (saisie manuelle) |
| Notification e-mail personnalisee des comptes crees | apres v1 (mot de passe remis manuellement) |
