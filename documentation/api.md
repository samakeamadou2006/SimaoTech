# API REST - SimaoTech

Base : `/api`. Toutes les reponses sont en JSON, encodage UTF-8.

## 1. Format

Succes :

```json
{ "succes": true, "donnees": { }, "meta": { "page": 1, "total": 42 } }
```

Erreur :

```json
{
  "succes": false,
  "erreur": { "code": "VENTE_A_PERTE", "message": "Vente bloquee : le prix net est inferieur au cout moyen pondere." },
  "requeteId": "b0c1..."
}
```

Codes d'erreur stables : `VALIDATION`, `NON_AUTHENTIFIE`, `SESSION_EXPIREE`, `ACCES_REFUSE`, `PERMISSION_MANQUANTE:*`, `INTROUVABLE`, `CONFLIT`, `REGLE_METIER`, `VENTE_A_PERTE`, `STOCK_INSUFFISANT`, `PAIEMENT_NON_CONFORME`, `TROP_DE_REQUETES`, `BASE_INDISPONIBLE`.

Codes propres aux comptes : `ROLE_PROPRIETAIRE_RESERVE`, `AUTO_MODIFICATION_INTERDITE`,
`EMAIL_DEJA_UTILISE`, `DERNIER_ADMINISTRATEUR`, `PERMISSION_INCONNUE`,
`MOT_DE_PASSE_A_CHANGER`, `AUTH_INDISPONIBLE`.

Chaque reponse porte `X-Request-Id`, repris dans les journaux serveur.

## 2. Authentification

En-tete : `Authorization: Bearer <jeton>`.

Le jeton provient de `POST /api/auth/connexion`. En cas d'expiration (401), le client appelle `POST /api/auth/rafraichir` puis rejoue la requete une seule fois.

### POST /api/auth/connexion

```json
{ "email": "vendeur@simaotech.ci", "motDePasse": "********" }
```

Reponse : `utilisateur` (id, email, nomComplet, role, permissions, estProprietaire) + `session` (`jetonAcces`, `jetonRafraichissement`, `expireLe`).

Erreurs : `IDENTIFIANTS_INCORRECTS` (401), `COMPTE_DESACTIVE` (401), `PROFIL_ABSENT` (401), `AUTH_INDISPONIBLE` (503).

### POST /api/auth/rafraichir

```json
{ "jetonRafraichissement": "..." }
```

### POST /api/auth/mot-de-passe-oublie

```json
{ "email": "vendeur@simaotech.ci" }
```

Reponse identique que le compte existe ou non.

### POST /api/auth/reinitialiser-mot-de-passe (public)

Finalise une reinitialisation depuis le lien Supabase. Accepter soit les jetons du
fragment d'URL, soit le code PKCE :

```json
{
  "motDePasse": "NouveauMotDePasse1",
  "jetonAcces": "...",
  "jetonRafraichissement": "...",
  "code": "..."
}
```

Erreurs : `VALIDATION` (mot de passe trop faible), `AUTH_INDISPONIBLE` (503).

### GET /api/auth/moi

Profil, role et permissions effectives. Sert de garde a toutes les pages. Le champ
`doitChangerMotDePasse` indique qu'un nouveau mot de passe est obligatoire.

### POST /api/auth/mot-de-passe

```json
{ "motDePasseActuel": "...", "nouveauMotDePasse": "..." }
```

Le mot de passe actuel est verifie aupres de Supabase Auth avant modification, puis
`doit_changer_mot_de_passe` repasse a `false`.

### POST /api/auth/deconnexion

Revocation cote fournisseur puis purge locale.

## 3. Comptes et permissions

Toutes les routes ci-dessous exigent `utilisateurs.gerer` ; l'attribution de
permissions exige en plus `permissions.gerer`. Dans les donnees initiales, seul le
`PROPRIETAIRE` possede ces deux permissions. Un mot de passe temporaire non change
renvoie `403 MOT_DE_PASSE_A_CHANGER`.

| Methode | Route | Permission | Role |
|---|---|---|---|
| GET | `/api/utilisateurs` | `utilisateurs.gerer` | liste paginee + statistiques |
| GET | `/api/utilisateurs/catalogue` | `utilisateurs.gerer` | roles et permissions disponibles |
| POST | `/api/utilisateurs` | `utilisateurs.gerer` | creation + compte Auth |
| GET | `/api/utilisateurs/:id` | `utilisateurs.gerer` | detail, permissions du role et derogations |
| PATCH | `/api/utilisateurs/:id` | `utilisateurs.gerer` | nom, telephone, role, statut |
| PUT | `/api/utilisateurs/:id/permissions` | `permissions.gerer` | remplace les derogations |
| POST | `/api/utilisateurs/:id/reinitialiser-mot-de-passe` | `utilisateurs.gerer` | mot de passe temporaire |
| DELETE | `/api/utilisateurs/:id` | `utilisateurs.gerer` | suppression logique |

Filtres de liste : `?recherche=&role=EMPLOYE&actif=true&page=1&limite=25`.

```json
{
  "email": "vendeur@simaotech.ci",
  "nomComplet": "Vendeur Boutique",
  "telephone": "+225 07 00 00 00",
  "roleCode": "EMPLOYE",
  "motDePasse": "MotDePasse123"
}
```

Reponse de creation : `utilisateur` + `motDePasseTemporaire` (affiche une seule fois,
`null` en mode local) + `modeLocal`.

Derogations individuelles (remplacement complet de la liste) :

```json
{ "derogations": [ { "permissionId": "<uuid>", "accorde": true } ] }
```

Codes d'erreur specifiques : `ROLE_PROPRIETAIRE_RESERVE`, `AUTO_MODIFICATION_INTERDITE`,
`EMAIL_DEJA_UTILISE`, `DERNIER_ADMINISTRATEUR`, `PERMISSION_INCONNUE`, `AUTH_INDISPONIBLE`.

## 4. Sante

### GET /api/sante (public)

```json
{
  "succes": true,
  "donnees": {
    "statut": "operationnel",
    "version": "1.0.0",
    "environnement": "production",
    "fuseauHoraire": "Africa/Abidjan",
    "baseDeDonnees": { "disponible": true, "latenceMs": 12, "version": "PostgreSQL 15" },
    "migrations": { "nombre": 18, "derniere": "2026-11-18T15:50:00Z" },
    "authentification": { "mode": "supabase", "supabase": true },
    "avertissements": []
  }
}
```

Aucun secret n'est expose.

## 5. Modules metier (phases 4 a 12)

Les routes presentes ci-dessous sont celles actuellement exposees. Les ecrans partagees
des modules operationnels restent partiels ; consultez le manuel avant usage reel.

| Module | Routes presentes |
|---|---|
| Categories | `GET /categories`, `/categories/options`, `/categories/:id`, `POST /categories`, `PATCH/DELETE /categories/:id` |
| Produits | `GET/POST /produits`, `GET /produits/:id`, `PATCH/DELETE /produits/:id`, `PATCH /produits/:id/prix`, `GET /produits/:id/historique-prix` |
| Fournisseurs | `GET /fournisseurs`, `/fournisseurs/options`, `/fournisseurs/:id`, `POST /fournisseurs`, `PATCH/DELETE /fournisseurs/:id` |
| Approvisionnements | `GET/POST /approvisionnements`, `GET /approvisionnements/:id`, `POST /approvisionnements/:id/valider` |
| Stocks | `GET /stocks`, `/stocks/alertes`, `/stocks/statistiques`, `/mouvements-stock`, `POST /stocks/ajuster` |
| Inventaires | `GET/POST /inventaires`, `GET /inventaires/:id`, `POST /inventaires/:id/valider` |
| Ventes | `GET/POST /ventes`, `GET /ventes/:id`, `/ventes/:id/recu`, `POST /ventes/:id/valider` |
| Annulations | `GET /annulations`, `/annulations/statistiques`, `POST /annulations`, `POST /annulations/:id/approuver`, `/annulations/:id/rejeter` |
| Paiements | `GET /paiements` |
| Depenses | `GET/POST /depenses`, `/depenses/categories`, `/depenses/statistiques`, validation/rejet |
| Tableau de bord | `GET /tableau-de-bord` |
| Rapports | `GET /rapports`, `GET /rapports/export.csv` |
| Appareils | `GET/POST /appareils`, `PATCH /appareils/:id` |
| Synchronisation | `POST /synchronisation`, `GET /synchronisation/etat`, `/synchronisation/conflits`, `POST /synchronisation/conflits/:id/resoudre` |
| Parametres | `GET /parametres`, `PATCH /parametres/:cle` |

Les rapports acceptent les parametres `debut` et `fin`. Une date seule en fin de
periode inclut toute cette journee ; les dates impossibles ou inversees sont
refusees avec une erreur de validation.

## 6. Pagination et filtres

- `?page=1&limite=50` (max 200).
- Dates : ISO 8601 (`2026-11-01T00:00:00Z`), interpretees dans le fuseau metier pour les regroupements.
- Tri : `?tri=date_vente&ordre=desc` lorsque pertinent.

## 7. Regles de validation

- Toute entree est validee cote serveur (type, longueur, format, plage).
- Les identifiants sont des UUID.
- Les montants sont transmis en **chaine decimale** (`"1500.00"`) pour eviter toute perte de precision.
- Les prix de reference ne sont acceptes que sur la route dediee et pour la permission `produits.modifier_prix`.
- Le client ne fournit jamais : CMP, benefice, totaux, statut final.
