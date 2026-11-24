# Plan de securite - SimaoTech

## 1. Authentification

- Fournisseur d'identite : **Supabase Auth** (mot de passe hache et gere par Supabase).
- Le backend ne stocke ni ne voit jamais de mot de passe.
- Flux : `POST /api/auth/connexion` -> jeton d'acces + jeton de rafraichissement.
- Verification a chaque requete : `supabase.auth.getUser(jeton)` ou signature HS256 en developpement.
- Duree maximale de session : `JWT_DUREE_MAX` (8 h par defaut), rafraichissement controle.
- Deconnexion : revocation cote fournisseur + purge du stockage local.
- Reinitialisation : lien envoye par Supabase, reponse identique que le compte existe ou non (pas d'enumeration).
- Changement de mot de passe : verification du mot de passe actuel avant modification.
- Compte desactive (`actif = false`) ou supprime logiquement : refus immediat a chaque requete.
- Mot de passe temporaire : un drapeau `doit_changer_mot_de_passe` bloque tous les modules metier
  (`403 MOT_DE_PASSE_A_CHANGER`) jusqu'au changement effectif.

## 2. Gestion des comptes

Regles appliquees dans `backend/services/utilisateurs.service.js` (jamais seulement dans l'interface) :

- `utilisateurs.gerer` et `permissions.gerer` sont reserves au proprietaire dans les donnees initiales.
- Le role `PROPRIETAIRE` ne peut pas etre attribue ni retire par l'API : seul le script
  `npm run proprietaire` le fait, sur la base de donnees.
- Personne ne modifie son propre role, son propre statut actif ni ses propres permissions.
- Le dernier proprietaire actif et le dernier administrateur actif ne peuvent pas etre
  desactives, supprimes ou retrograder.
- Suppression logique exclusive (`supprime_le`, `actif = false`) : le profil, les ventes et le
  journal restent intacts.
- Un e-mail deja utilise renvoie `409 EMAIL_DEJA_UTILISE` ; une comparaison insensible a la casse
  est appliquee.
- Toute operation (creation, modification, permissions, reinitialisation, suppression) est
  journalisee dans `journal_activites` avec l'auteur et l'IP.

## 3. Autorisation

Deux niveaux, verifies **cote serveur** :

1. **Role** : `PROPRIETAIRE`, `ADMINISTRATEUR`, `EMPLOYE`.
2. **Permission unitaire** : `module.action` (ex. `ventes.annuler_approuver`).

Les permissions effectives = permissions du role + derogations individuelles accordees - derogations retirees.
Le proprietaire court-circuite les permissions (role complet).

| Operation | Permission |
|---|---|
| Modifier un prix de reference | `produits.modifier_prix` (proprietaire) |
| Enregistrer une vente | `ventes.creer` |
| Voir toutes les ventes | `ventes.consulter_toutes` |
| Demander une annulation | auteur de la vente ou `ventes.annuler_demander` |
| Approuver une annulation | `ventes.annuler_approuver` |
| Enregistrer une depense | `depenses.creer` |
| Valider une depense | `depenses.valider` |
| Voir les benefices | `benefices.consulter` |
| Gerer les comptes | `utilisateurs.gerer` |
| Attribuer des permissions | `permissions.gerer` |

Aucun controle d'affichage frontend n'est considere comme une protection.

## 4. Base de donnees

- RLS activee sur les 30 tables applicatives.
- Aucune politique = aucun acces (refus par defaut).
- Fonctions metier `SECURITY DEFINER` avec `search_path = public, pg_temp` (protection contre le detournement de schema).
- Chaque fonction metier revalide la permission de l'utilisateur : un appel direct ne contourne pas les regles.
- Contraintes SQL comme dernier rempart : vente sous CMP, stock negatif, montants incoherents, references manquantes.
- Historiques non modifiables (declencheurs) ; ventes validees non supprimables.
- Cles etrangeres `RESTRICT` sur les donnees comptables : pas de suppression en cascade des ventes, paiements ou approvisionnements.

## 5. Secrets

| Secret | Emplacement | Exposition |
|---|---|---|
| `DATABASE_URL` | serveur uniquement | jamais |
| `SUPABASE_CLE_SERVICE` | serveur uniquement | jamais (contourne RLS) |
| `SUPABASE_CLE_ANON` | serveur (verification de jetons) | peut etre publique, mais non utilisee cote client |
| `JWT_SECRET` | serveur (mode local) | jamais |
| Jetons utilisateur | navigateur (localStorage) | envoyes uniquement a l'API |

`.env` est ignore par git ; seul `.env.example` est versionne. Les journaux masquent `authorization`, `cookie`, mots de passe, `DATABASE_URL` et la cle service.

## 6. Protection HTTP

- Helmet : CSP stricte (`script-src 'self'`, pas de script inline), HSTS en production, `frame-ancestors 'none'`.
- CORS : liste blanche `ORIGINES_AUTORISEES`.
- Limitation : 300 req/min par IP, 10 tentatives de connexion / 15 min.
- Corps JSON limite a 1 Mo.
- Erreurs normalisees : aucun detail technique expose ; identifiant de requete pour correler les journaux.
- `x-powered-by` desactive, proxy de confiance configure.

## 7. Journalisation et audit

Evenements traces : connexions, changements de prix, creations de produits, approvisionnements, ventes, reductions, annulations, depenses, permissions, synchronisations, resolutions de conflits.

`journal_activites` est en ajout seul : `UPDATE` et `DELETE` levent `HISTORIQUE_PROTEGE`.

## 8. Risques residuels et parades

| Risque | Parade |
|---|---|
| Vol de jeton sur un poste partage | duree de session limitee, deconnexion, revocation d'appareil |
| Employe modifiant le prix via l'API | permission serveur + RLS + fonctions metier |
| Vente a perte fabriquee cote client | recalcul serveur + contrainte SQL |
| Double soumission (reseau instable) | cles d'idempotence uniques |
| Appareil hors ligne avec CMP obsolete | quotas + CMP fige + revalidation serveur, vente non comptabilisee si conflit |
| Fuite de la cle service | rotation immediate, cle absente du depot et du navigateur |

## 9. Procedures

- Rotation des cles Supabase : trimestrielle ou immediate en cas de doute.
- Revue des permissions individuelles : mensuelle.
- Verification des comptes actifs et des appareils : mensuelle.
- Test de restauration de sauvegarde : mensuel.
- Analyse des journaux d'anomalies et de conflits : hebdomadaire.
