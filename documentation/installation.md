# Installation et deploiement

## 1. Prerequis

- Node.js 20 LTS ou superieur
- Un projet Supabase (PostgreSQL 15+)
- npm 10+

## 2. Preparation de Supabase

1. Creer un projet sur <https://supabase.com>.
2. Recuperer dans **Project Settings** :
   - `DATABASE_URL` (connexion pooler, port 6543, `?pgbouncer=true` si propose) ;
   - `SUPABASE_URL` ;
   - `SUPABASE_CLE_ANON` (public) ;
   - `SUPABASE_CLE_SERVICE` (secrete, serveur uniquement).
3. Dans **Authentication > Providers**, activer Email/Password.
4. Dans **Authentication > URL Configuration**, ajouter l'URL publique de l'application et
   `<URL_PUBLIQUE>/pages/reinitialisation.html` comme URL de redirection.
5. Desactiver l'inscription publique (les comptes sont crees par le proprietaire).

## 3. Installation locale

```bash
git clone <depot> SimaoTech
cd SimaoTech
npm install
copy .env.example .env
```

Renseigner `.env` :

```ini
NODE_ENV=development
PORT=3000
URL_PUBLIQUE=http://localhost:3000
DATABASE_URL=postgresql://postgres:...@db.xxxx.supabase.co:5432/postgres
BASE_DE_DONNEES_SSL=true
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_CLE_ANON=...
SUPABASE_CLE_SERVICE=...
MODE_AUTH=supabase
JWT_DUREE_MAX=28800
```

## 4. Migrations

```bash
npm run db:migrer
```

Sortie attendue : `18 migration(s) appliquee(s)` (ou `0` si deja appliquees), sans erreur.
Verifier ensuite :

```bash
npm start
# puis ouvrir http://localhost:3000/api/sante
```

`statut` doit valoir `operationnel`, `baseDeDonnees.disponible` etre `true` et `avertissements` etre vide.

En cas d'echec, la migration fautive est annulee (transaction) et la base reste coherente ; corriger puis relancer.

## 5. Creation du premier proprietaire

Aucun compte factice n'est livre. Le script de bootstrap cree le compte Supabase Auth puis le
profil applicatif rattache au role `PROPRIETAIRE` :

```bash
npm run proprietaire -- --email proprietaire@simaotech.ci --nom "Proprietaire SimaoTech"
```

Options :

| Option | Effet |
|---|---|
| `--email <adresse>` | obligatoire |
| `--nom "<nom complet>"` | obligatoire |
| `--telephone <numero>` | facultatif |
| `--mot-de-passe <valeur>` | facultatif ; a defaut un mot de passe est genere et affiche une seule fois |
| `--ajouter` | autorise un second proprietaire |
| `--aide` | affiche l'aide |

Le script refuse de creer un second proprietaire sans `--ajouter`, et refuse de rattacher un
profil existant a un autre identifiant d'authentification.

### Pourquoi un script et pas l'interface ?

Le role `PROPRIETAIRE` est volontairement impossible a attribuer par l'API (protection contre
une elevation de privileges). Le script s'execute cote serveur avec la cle service et laisse une
trace `BOOTSTRAP_PROPRIETAIRE` dans `journal_activites`.

### Suite

1. Se connecter sur `/pages/connexion.html`.
2. Si un mot de passe a ete genere, il doit etre change immediatement (redirection forcee).
3. Depuis **Employes et permissions**, creer les comptes vendeurs et ajuster les derogations.

### Mode local (developpement sans Supabase)

Avec `MODE_AUTH=local`, le script cree un substitut `auth.users` et le profil, sans mot de passe
verifiable. Les operations de connexion par mot de passe et de reinitialisation renvoient
`503 AUTH_INDISPONIBLE` : c'est le comportement attendu en developpement.

## 6. Deploiement en production

### Option A - Plateforme Node (Render, Railway, Fly.io)

- Build : `npm ci --omit=dev`
- Start : `npm start`
- Variables : toutes celles de `.env` avec `NODE_ENV=production`
- Healthcheck : `/api/sante`
- Forcer HTTPS et `BASE_DE_DONNEES_SSL=true`.

### Option B - VPS (Ubuntu)

```bash
sudo apt install -y nodejs npm postgresql-client
git clone <depot> /opt/simaotech && cd /opt/simaotech
npm ci --omit=dev
cp .env.example .env && nano .env
npm run db:migrer
sudo npm install -g pm2
pm2 start backend/serveur.js --name simaotech
pm2 save && pm2 startup
```

Placer Nginx devant l'application, terminer TLS (Let's Encrypt), transmettre `X-Forwarded-For`.

### Verification post-deploiement

- `GET /api/sante` : `operationnel`, migrations presentes, aucun avertissement.
- Connexion proprietaire, acces au tableau de bord.
- En-tetes : `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`.
- Service worker actif (onglet Application du navigateur).

## 7. Sauvegarde et restauration

```bash
# Sauvegarde
pg_dump "$DATABASE_URL" --no-owner --format=custom --file="simaotech_$(date +%F).dump"

# Restauration
pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" simaotech_2026-11-18.dump
```

- Frequence : quotidienne, conservation 30 jours minimum, copie hors site.
- Test de restauration mensuel sur une base de recette.
- Les sauvegardes ne doivent jamais etre accessibles publiquement (elles contiennent les donnees commerciales).

## 8. Depannage

| Symptome | Cause probable | Action |
|---|---|---|
| `/api/sante` -> `degrade` | `DATABASE_URL` absente ou invalide | verifier `.env`, SSL, IP autorisee |
| 503 `AUTH_INDISPONIBLE` | cles Supabase absentes | renseigner `SUPABASE_URL` et `SUPABASE_CLE_ANON` |
| Connexion refusee `PROFIL_ABSENT` | compte Auth sans ligne `utilisateurs` | executer `npm run proprietaire -- --email ... --nom "..."` |
| 403 `MOT_DE_PASSE_A_CHANGER` en boucle | mot de passe temporaire jamais change | ouvrir `/pages/mot-de-passe.html`, saisir le mot de passe actuel puis le nouveau |
| 403 sur l ecran Employes | compte non proprietaire | attribuer `utilisateurs.gerer` via une derogation, ou utiliser le proprietaire |
| Script `proprietaire` : « proprietaire actif existe deja » | un proprietaire est deja actif | utiliser ce compte, ou ajouter `--ajouter` en connaissance de cause |
| `SESSION_EXPIREE` en boucle | horloge serveur decalee ou mauvais `JWT_SECRET` | resynchroniser l'heure, verifier le secret |
| Migration `ECHEC` | SQL incompatible avec la version | lire la ligne indiquee, corriger, relancer |
| Page blanche apres mise a jour | service worker obsolete | vider le cache (`Mettre a jour` ou DevTools) |

