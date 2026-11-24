# SimaoTech

Logiciel integre de gestion commerciale pour la boutique **SimaoTech** (mono-boutique, XOF, interface francaise).

Application **PWA** : frontend HTML5/CSS3/JavaScript + Bootstrap 5, API REST **Node.js/Express**, base **PostgreSQL (Supabase)**, authentification **Supabase Auth**, stockage local **IndexedDB** et synchronisation multi-appareils.

> Etat actuel : le socle, le catalogue, les API metier et leurs tests d'integration sont presents. **Le projet n'est pas encore pret pour la production** : les ecrans des modules 5 a 11 restent generiques, et le mode hors connexion/synchronisation ne couvre qu'un sous-ensemble des operations.

---

## 1. Demarrage rapide

Prerequis : **Node.js >= 20**, un projet **Supabase** (ou une base PostgreSQL locale).

```bash
# 1. Installer les dependances
npm install

# 2. Configurer l'environnement
copy .env.example .env      # Windows
# cp .env.example .env      # macOS / Linux
# puis renseigner DATABASE_URL, SUPABASE_URL, SUPABASE_CLE_ANON, SUPABASE_CLE_SERVICE

# 3. Appliquer les migrations
npm run db:migrer

# 4. Creer le compte proprietaire (remplace l etape manuelle dans Supabase)
npm run proprietaire -- --email proprietaire@simaotech.ci --nom "Proprietaire SimaoTech"

# 5. Demarrer l'application
npm start
```

Application : <http://localhost:3000> - API : <http://localhost:3000/api> - Sante : <http://localhost:3000/api/sante>

Le script `proprietaire` cree le compte Supabase Auth (cle service, cote serveur) puis le profil
applicatif rattache au role `PROPRIETAIRE`. En mode `MODE_AUTH=local`, seul le profil et un
substitut `auth.users` sont crees : aucun mot de passe n'y est verifie.

### Developpement sans Supabase (PostgreSQL embarque)

```bash
node base_de_donnees/migrer.js --local
```

Un PostgreSQL isole est initialise dans `.postgres-local/` (port 55432) et toutes les migrations y sont appliquees. Pratique pour verifier le schema, pas pour un usage reel.

### Tests

```bash
npm test                 # arithmetique financiere (16 tests)
npm run test:integration # PostgreSQL embarque, 15 scenarios metier + 12 scenarios comptes
```

Resultat attendu : `pass 16 / fail 0` et `pass 27 / fail 0`.

---

## 2. Structure du projet

```text
SimaoTech/
  frontend/
    pages/            connexion, tableau-de-bord, utilisateurs, catalogue et module metier partage
    css/              styles.css (identite bleu / blanc / noir)
    js/               api, session, ui, metiers, stockage local, connexion, tableau-de-bord,
                      utilisateurs, mot-de-passe, reinitialisation, pwa
    images/           logo.svg
    manifest.json     PWA
    service-worker.js coque applicative hors ligne
  backend/
    configuration/    environnement, journal, base de donnees, supabase
    routes/           index, sante, authentification, utilisateurs
    controleurs/      logique HTTP
    services/         logique metier (authentification, comptes, utilisateurs)
    modeles/          requetes SQL parametrees
    middlewares/      authentification, autorisation, erreurs, limitation
    validateurs/      validation des entrees
    scripts/          creer_proprietaire.js (bootstrap du proprietaire)
    utils/            montants (decimal.js), erreurs, reponses, jetons, async
    serveur.js        point d'entree
  base_de_donnees/
    migrations/       000 a 017 (schema, fonctions, declencheurs, RLS, donnees, securite RPC)
    migrer.js         application idempotente des migrations
  tests/
    unitaires/        arithmetique financiere
    integration/      scenarios metier et comptes sur PostgreSQL reel
  documentation/
    architecture.md, base_de_donnees.md, api.md, securite.md,
    synchronisation.md, installation.md, manuel_utilisateur.md, decisions.md
```

Regle de nommage : **francais, sans accents, snake_case** pour les tables, colonnes, fonctions et fichiers metiers.

---

## 3. Regles metier garanties par la base

| Regle | Mise en oeuvre |
|---|---|
| CMP non modifiable a la main | declencheur `fn_proteger_cmp` + calcul exclusif dans `fn_valider_approvisionnement` |
| Aucune vente sous le CMP | contrainte `lignes_vente_prix_net_superieur_cmp` + controle dans `fn_valider_vente` |
| Montants exacts | `NUMERIC` partout, `decimal.js` cote Node, aucun flottant |
| Paiements exacts | `fn_valider_vente` refuse tout ecart, paiements partiels interdits |
| Stock jamais negatif | verrou `FOR UPDATE` + contrainte `stocks_quantite_positive` |
| Annulation sans suppression | vente conservee `ANNULEE`, mouvements inverses, historique |
| Historiques immuables | declencheurs `fn_proteger_historique` |
| Idempotence | index uniques sur `cle_idempotence` |
| Reductions globales | repartition deterministe au plus fort reste, verifiee cote serveur |
| Benefice brut >= 0 | contraintes de coherence sur `ventes` et `lignes_vente` |

---

## 4. Feuille de route

| Phase | Contenu | Etat |
|---|---|---|
| 1 | Initialisation (Node, Express, Bootstrap, PWA, README) | **livree** |
| 2 | Base de donnees, fonctions, RLS, tests metier | **livree** |
| 3 | Authentification complete, comptes, permissions, bootstrap proprietaire | **livree** |
| 4 | Catalogue : categories, produits, prix, CMP, historique | API et ecran dedie |
| 5 | Fournisseurs et approvisionnements | API et regles testees ; interface generique a remplacer |
| 6 | Stocks, inventaires, ajustements, alertes | API et regles testees ; interface generique a remplacer |
| 7 | Caisse, reductions, anti-perte, recus | API et regles testees ; interface de caisse a finaliser |
| 8 | Paiements et references Mobile Money | API et regles testees ; interface a finaliser |
| 9 | Annulations | API et regles testees ; interface a finaliser |
| 10 | Depenses et justificatifs | API et regles testees ; interface a finaliser |
| 11 | Tableau de bord, rapports, exports | API, indicateurs et export CSV ; visualisations et PDF/Excel a faire |
| 12 | IndexedDB et synchronisation hors ligne | partiel : file locale de ventes/approvisionnements/depenses, revalidation serveur ; quotas et resolution complete a faire |
| 13 | Tests, securite, documentation, deploiement | tests unitaires/integration presents ; revue de production et deploiement a faire |

Les ecrans generiques demandent encore des donnees JSON brutes et ne constituent pas une interface de caisse ou de gestion utilisable par les employes.

---

## 5. Securite

- Aucune cle privee dans le frontend ; `SUPABASE_CLE_SERVICE` reste cote serveur.
- Toutes les routes sensibles verifient le jeton **et** la permission cote serveur.
- RLS activee sur les tables applicatives ; les fonctions metier `SECURITY DEFINER` sont retirees de l'API RPC par la migration 017.
- Journalisation des operations sensibles dans `journal_activites` (immuable).
- Limitation de debit sur l'API et la connexion, en-tetes de securite via Helmet.
- Gestion des comptes reservee au proprietaire (`utilisateurs.gerer`, `permissions.gerer`) ; le role
  `PROPRIETAIRE` ne s'attribue que par le script de bootstrap.
- Un utilisateur ne peut pas modifier son propre role, son propre statut ni ses propres permissions ;
  le dernier proprietaire et le dernier administrateur actifs sont proteges.
- Suppression logique uniquement : le profil et l'historique sont conserves.
- Un mot de passe temporaire force son remplacement : les modules metier repondent
  `403 MOT_DE_PASSE_A_CHANGER` tant qu'il n'a pas ete change.

Voir `documentation/securite.md` et `documentation/synchronisation.md`.

---

## 6. Sauvegarde et restauration

Supabase : sauvegardes automatiques quotidiennes (offre payante) + export manuel.

```bash
# Sauvegarde complete (structure + donnees)
pg_dump "$DATABASE_URL" --no-owner --format=custom --file=sauvegarde_simaotech.dump

# Restauration
pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" sauvegarde_simaotech.dump
```

Conserver au minimum 30 sauvegardes quotidiennes et tester une restauration chaque mois.

---

## 7. Avertissements

- Version 1 mono-boutique : ne pas transformer en SaaS multi-entreprises.
- Les references Mobile Money sont saisies manuellement ; aucune confirmation operateur n'est simulee.
- Les operations mises en file hors ligne sont des intentions et doivent etre revalidees par le serveur ; les quotas de stock par appareil ne sont pas encore integres au parcours de vente.
