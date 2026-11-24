# Architecture technique - SimaoTech

## 1. Vue d'ensemble

```text
Navigateur (PWA)                     Serveur Node.js                    Supabase
+-------------------+   HTTPS/JSON   +----------------------+   SQL    +------------------+
| HTML/CSS/JS       | <------------> | Express /api         | <------> | PostgreSQL       |
| Bootstrap 5       |                | JWT + permissions     |          | schema metier    |
| IndexedDB (partiel)|               | decimal.js            |          | fonctions metier |
| Service worker    |                | pino (journaux)       |          | RLS              |
| localStorage      |                | zod (validation)      |          | Auth (jetons)    |
+-------------------+                +----------------------+          +------------------+
```

Trois responsabilites strictement separees :

1. **Frontend** : affichage, navigation, formulaires, etat de connexion, cache hors ligne partiel. Aucune regle metier critique, aucune cle privee.
2. **Backend** : authentification, autorisation, validation, calculs (CMP, benefices, repartition des reductions), transactions, rapports et tentative de reprise des mutations mises en file.
3. **Base de donnees** : integrite, contraintes, atomicite, historique, politiques RLS, dernier rempart sur les regles sensibles (vente a perte, stock negatif).

## 2. Flux de requete

```text
Requete HTTP
  -> identifiantRequete (X-Request-Id)
  -> Helmet / CORS / compression / JSON
  -> rate limit
  -> authentifier : verifie le jeton (Supabase Auth ou HS256 local)
  -> charger le profil : role + permissions effectives (BDD)
  -> exigerPermission / exigerRole
  -> validateur (zod / validateurs maison)
  -> controleur -> service -> modele SQL (parametre) ou fonction PostgreSQL
  -> succes() / echec() normalise
```

Les operations multi-tables passent par `transaction()` ou par une fonction PostgreSQL `SECURITY DEFINER` atomique.

## 3. Decisions d'architecture et arbitrages

### 3.1 Supabase Auth + backend Express (contradiction apparente)

Le cahier des charges impose Supabase Auth **et** un backend qui controle tout. Resolution :

- le navigateur s'authentifie aupres de Supabase Auth via `POST /api/auth/connexion` (le backend relaie) ;
- le backend verifie chaque jeton (`auth.getUser` ou HS256 local) puis charge le profil applicatif ;
- le navigateur n'appelle **jamais** la base directement ;
- la cle `service_role` reste sur le serveur ; la cle `anon` ne sert qu'a verifier les jetons ;
- RLS reste activee en defense en profondeur (acces PostgREST/anonyme).

### 3.2 Quantites produit : `produits` ou `stocks` ?

Le cahier des charges demande les quantites dans la fiche produit **et** une table `stocks`. Pour eviter deux sources de verite :

- `stocks` est l'unique source des quantites (disponible, reservee, seuil, valeur) ;
- `produits` porte le catalogue et le CMP ;
- la vue `vue_produits` expose `quantite_disponible`, `quantite_reservee`, `quantite_vendable`, `etat_stock` et le benefice unitaire de reference.

### 3.3 Autorite des montants

Le client n'est jamais cru :

- les montants de ligne sont recalcules par un declencheur (`prix_net_unitaire`, `cout_total_ligne`, `benefice_brut_ligne`) ;
- les totaux de vente sont recalcules par `fn_recalculer_totaux_vente` ;
- `fn_valider_vente` recalcule tout avant de valider et de decrementer le stock.

### 3.4 Arrondis

`NUMERIC` cote SQL, `decimal.js` cote Node (28 chiffres, `ROUND_HALF_UP`).
- montants : 2 decimales (centime) ;
- quantites : 3 decimales ;
- CMP : 6 decimales.

Le CA d'une ligne vaut `round(prix_net_unitaire x quantite, 2)` et le cout `round(cmp x quantite, 2)` : la somme des lignes egale exactement les totaux de la vente, donc `benefice = CA - CMV` sans derive.

### 3.5 Reductions globales

Une reduction globale est repartie au **plus fort reste**, en centimes entiers, avec depart d'egalite par identifiant croissant : resultat deterministe et reproductible. Le serveur recalcule la repartition ; la base refuse toute ligne dont le prix net passe sous son CMP. La repartition est conservee dans `lignes_vente.remise_globale_affectee` et auditée dans `reductions_ventes`.

### 3.6 Hors ligne

Voir [synchronisation.md](./synchronisation.md). La file locale prend en charge les
ventes, approvisionnements et depenses. Les quotas par appareil, le CMP fige dans
les quotas et la resolution complete des conflits ne sont pas encore connectes ;
le flux n'est pas une synchronisation hors ligne complete.

### 3.7 Role ADMINISTRATEUR

Le role `ADMINISTRATEUR` recoit toutes les permissions sauf :
`produits.modifier_prix`, `utilisateurs.gerer`, `permissions.gerer`, `parametres.gerer`.
Ces prerogatives restent au proprietaire, conformement a « seul le proprietaire modifie les prix de reference ».

## 4. Dependances

| Paquet | Role |
|---|---|
| express 4 | serveur HTTP |
| helmet, cors, compression | securite et performance HTTP |
| express-rate-limit | anti-bruteforce |
| pg | pool PostgreSQL, NUMERIC renvoye en texte |
| decimal.js | arithmetique financiere exacte |
| zod | validation de configuration et entrees |
| pino, pino-http | journaux structures |
| @supabase/supabase-js | verification des jetons, administration des comptes |
| dotenv | configuration |
| bootstrap 5.3 | interface (servie localement pour le hors ligne) |
| chart.js 4 | graphiques (phase 11) |
| embedded-postgres (dev) | PostgreSQL isole pour les tests |

Versions verrouillees dans `package.json` (Node >= 20).

## 5. API et etat de livraison

Les routes d'authentification, utilisateurs, catalogue et operations metier sont
presentees dans [api.md](./api.md). Le catalogue retourne par `GET /api` est
maintenant aligne sur les routes enregistrees. La presence d'une route ne signifie
pas que l'ecran correspondant est finalise : les formulaires de creation et de
validation des operations principales existent, mais la recherche, la modification,
les paiements mixtes, les recus et les pieces jointes restent a completer.

Les listes necessaires aux formulaires hors ligne sont conservees temporairement
dans la session du compte courant (24 heures maximum) ; le cache ne reserve pas
de stock et n'evite pas les erreurs de synchronisation.

Le backend fournit notamment les validations de ventes, paiements, stocks,
approvisionnements, depenses, rapports et permissions. Les exports PDF/Excel ne
sont pas disponibles ; seul l'export CSV est implemente. Le mode hors ligne reste
partiel (voir la section 3.6).

Chaque reponse suit `{ succes, donnees, meta? }` ou `{ succes: false, erreur: { code, message, details? }, requeteId }`.

## 6. Journalisation et observabilite

- `journaux/application.log` : requetes lentes (> 500 ms), erreurs, connexions, refus.
- `journal_activites` (BDD, immuable) : qui a fait quoi, quand, sur quelle entite.
- `GET /api/sante` : disponibilite, latence, nombre de migrations, avertissements de configuration sans secret.

## 7. Performance

- Index cibles : ventes par periode et statut, mouvements par produit, produits par categorie et recherche plein texte.
- Pagination obligatoire (`limite` max 200).
- Pool PostgreSQL configure (`POOL_MAX`), timeouts de connexion.
- Requetes lentes journalisees.

## 8. Evolutivite

- Ajout d'une fonctionnalite = migration SQL + modele + service + controleur + route + tests.
- Le schema n'est pas multi-tenant : ne pas introduire de `boutique_id` sans decision explicite (v1 mono-boutique).
- Toute nouvelle table sensible doit activer RLS et une politique explicite (aucune politique = aucun acces).
