# Base de donnees - SimaoTech

PostgreSQL 15+ (Supabase). Migrations dans `base_de_donnees/migrations/`, appliquees par `npm run db:migrer` (idempotent, une transaction par fichier).

## 1. Conventions

- Identifiants : `uuid` (`gen_random_uuid()`).
- Montants : `numeric(16,2)` en XOF.
- Quantites : `numeric(14,3)` (fractionnaires autorisees).
- CMP : `numeric(18,6)`.
- Dates : `timestamptz`, fuseau metier `Africa/Abidjan` pour la numerotation et les rapports.
- Suppression logique : `supprime_le` (produits, categories, fournisseurs, utilisateurs).
- Historiques : aucun `UPDATE`/`DELETE` (declencheurs).
- Noms : francais, sans accents, `snake_case`.

## 2. Schema relationnel

```text
roles 1---N utilisateurs N---N permissions (role_permissions, utilisateur_permissions)
utilisateurs 1---N appareils 1---N quotas_stock_appareil N---1 produits

categories 1---N produits 1---1 stocks
produits 1---N historique_prix_produits
produits 1---N historique_cout_moyen

fournisseurs 1---N approvisionnements 1---N lignes_approvisionnement N---1 produits
approvisionnements 1---N mouvements_stock (reference)

produits 1---N mouvements_stock
inventaires 1---N lignes_inventaire N---1 produits

utilisateurs 1---N ventes 1---N lignes_vente N---1 produits
ventes 1---N paiements
ventes 1---N reductions_ventes
ventes 1---N demandes_annulation 1---N historique_annulations

categories_depenses 1---N depenses 1---N historique_depenses
appareils 1---N operations_synchronisation 1---N conflits_synchronisation
utilisateurs 1---N journal_activites
parametres (cle/valeur)
schema_migrations
```

### Tables (30 + 2 techniques)

| # | Table | Role |
|---|---|---|
| 1 | `utilisateurs` | profil applicatif lie a `auth.users` |
| 2 | `roles` | PROPRIETAIRE, ADMINISTRATEUR, EMPLOYE |
| 3 | `permissions` | catalogue des droits unitaires |
| 4 | `role_permissions` | droits par role |
| 5 | `utilisateur_permissions` | derogations individuelles (accordees ou retirees) |
| 6 | `appareils` | appareils autorises a se synchroniser |
| 7 | `categories` | categories produit |
| 8 | `produits` | catalogue, prix de reference, CMP |
| 9 | `historique_prix_produits` | tracabilite des changements de prix |
| 10 | `fournisseurs` | fournisseurs |
| 11 | `approvisionnements` | en-tete d'achat |
| 12 | `lignes_approvisionnement` | produits achetes, cout net, CMP avant/apres |
| 13 | `stocks` | quantites disponibles/reservees, seuil, valeur |
| 14 | `mouvements_stock` | historique immuable des mouvements |
| 15 | `inventaires` | session d'inventaire physique |
| 16 | `lignes_inventaire` | quantites theoriques/comptees, ecart calcule |
| 17 | `historique_cout_moyen` | evolution du CMP par entree |
| 18 | `ventes` | en-tete de vente (statuts metier et synchronisation) |
| 19 | `lignes_vente` | prix, reductions, CMP fige, benefice ligne |
| 20 | `reductions_ventes` | audit des reductions (ligne ou globale) |
| 21 | `paiements` | especes, Orange Money, MTN MoMo, Wave |
| 22 | `categories_depenses` | loyer, electricite, eau, etc. |
| 23 | `depenses` | charges de fonctionnement |
| 24 | `historique_depenses` | transitions de statut |
| 25 | `demandes_annulation` | demande tracee par vente |
| 26 | `historique_annulations` | piste d'audit des annulations |
| 27 | `operations_synchronisation` | registre idempotent |
| 28 | `conflits_synchronisation` | anomalies a resoudre manuellement |
| 29 | `journal_activites` | audit general immuable |
| 30 | `quotas_stock_appareil` | quantites reservees hors ligne + CMP fige |
| + | `parametres` | configuration cle/valeur |
| + | `schema_migrations` | suivi des migrations |

Vue : `vue_produits` (catalogue + stock + benefice unitaire + etat de stock).

## 3. Contraintes structurantes

| Contrainte | Effet |
|---|---|
| `lignes_vente_prix_net_superieur_cmp` | `prix_net_unitaire >= cmp_applique` : vente a perte impossible |
| `ventes_coherence_montants` | `montant_net = montant_brut - total_reductions` |
| `ventes_coherence_benefice` | `benefice_brut = montant_net - cout_total` |
| `stocks_quantite_positive` | stock jamais negatif |
| `stocks_reservee_coherente` | reserve <= disponible |
| `mouvements_stock_apres_positif` | tout mouvement laisse un stock >= 0 |
| `lignes_vente_reduction_valide` | reduction <= prix x quantite |
| `paiements_reference_mobile_money` | reference obligatoire hors especes |
| `paiements_montant_positif` | aucun paiement nul ou negatif |
| `depenses_validation_coherente` | validation/rejet horodates et motives |
| `demandes_decision_coherente` | decision avec decideur et date |
| uniques partiels | reference produit, code-barres, email, cle d'idempotence, quota actif |

## 4. Fonctions metier

| Fonction | Role |
|---|---|
| `fn_cmp(q1, cmp1, q2, c2)` | CMP = `(q1*cmp1 + q2*c2)/(q1+q2)`, 6 decimales |
| `fn_valider_approvisionnement(id, user)` | cout net, CMP, stock, historique, mouvements, journal |
| `fn_valider_vente(id, user)` | anti-perte, stock, paiements exacts, totaux, journal |
| `fn_enregistrer_mouvement_stock(...)` | mouvement atomique + mise a jour du stock |
| `fn_recalculer_totaux_vente(id)` | totaux serveur depuis les lignes |
| `fn_creer_demande_annulation(...)` | demande controlee, une seule en attente par vente |
| `fn_approuver_annulation(...)` | restitution du stock, statut ANNULEE, historique |
| `fn_rejeter_annulation(...)` | refus motive et trace |
| `fn_valider_depense` / `fn_rejeter_depense` | workflow des charges |
| `fn_creer_depense(...)` | creation avec permission et idempotence |
| `fn_valider_inventaire(...)` | application des ecarts constates |
| `fn_modifier_prix_produit(...)` | prix reserve au porteur de `produits.modifier_prix` |
| `fn_ajuster_stock(...)` | ajustement motive et permissionne |
| `fn_enregistrer_operation_synchronisation(...)` | idempotence multi-appareils |
| `fn_a_permission(user, code)` / `fn_exiger_permission` | controle serveur |
| `fn_journaliser(...)` | ecriture d'audit depuis une fonction metier |

## 5. Declencheurs

| Declencheur | Effet |
|---|---|
| `fn_attribuer_numero` | VTE-/APP-/DEP-/INV-AAAAMM-000000 |
| `fn_lignes_vente_calculs` | prix net, cout et benefice de ligne recalcules ; vente validee verrouillee |
| `fn_apres_lignes_vente` | recalcul des totaux de la vente |
| `fn_lignes_appro_calculs` | cout net de ligne recalcule |
| `fn_proteger_cmp` | CMP non modifiable hors validation d'approvisionnement |
| `fn_historiser_prix` | historique automatique des prix |
| `fn_proteger_historique` | UPDATE/DELETE interdits sur les historiques |
| `fn_proteger_vente` | vente validee immuable, suppression limitee aux brouillons |
| `fn_proteger_paiements` | paiements verrouilles apres validation |
| `fn_stocks_coherence` | valeur du stock recalculee avec le CMP |
| `fn_creer_stock_produit` | fiche stock creee avec le produit |
| `fn_maj_modifie_le` | horodatage des modifications |

## 6. RLS

RLS activee sur toutes les tables applicatives. Aucune politique = aucun acces.

- Employe : produits et stocks en lecture, ses ventes, ses demandes, ses depenses (si permission).
- Administrateur/proprietaire : acces etendu via `administration.gerer`.
- Journal, conflits et historiques : lecture reservee aux permissions dediees.
- Le backend se connecte en role proprietaire ; la RLS protege les acces directs via les cles publiques Supabase.

## 7. Numerotation

`PREFIXE-AAAAMM-000123`, sequences PostgreSQL (`seq_vente`, `seq_approvisionnement`, `seq_depense`, `seq_inventaire`). L'unicite est garantie par contrainte ; aucun numero n'est genere cote client.
