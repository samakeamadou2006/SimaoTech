-- =============================================================================
-- 015 - Donnees initiales (referentiels uniquement, aucun compte factice)
-- =============================================================================

INSERT INTO roles (code, nom, description, est_systeme) VALUES
  ('PROPRIETAIRE', 'Proprietaire', 'Acces complet a toutes les donnees et operations.', true),
  ('ADMINISTRATEUR', 'Administrateur', 'Supervision etendue, sans modification des prix ni administration des comptes.', true),
  ('EMPLOYE', 'Employe / Vendeur', 'Acces limite a la caisse et a ses propres operations.', true)
ON CONFLICT (code) DO UPDATE
  SET nom = excluded.nom,
      description = excluded.description;

INSERT INTO permissions (code, nom, module) VALUES
  ('produits.consulter',        'Consulter les produits',              'produits'),
  ('produits.gerer',            'Creer et modifier les produits',      'produits'),
  ('produits.modifier_prix',    'Modifier les prix de vente',          'produits'),
  ('categories.gerer',          'Gerer les categories',                'produits'),
  ('fournisseurs.gerer',        'Gerer les fournisseurs',              'achats'),
  ('approvisionnements.consulter', 'Consulter les approvisionnements', 'achats'),
  ('approvisionnements.creer',  'Enregistrer un approvisionnement',    'achats'),
  ('approvisionnements.valider','Valider un approvisionnement',        'achats'),
  ('stocks.consulter',          'Consulter les stocks',                'stocks'),
  ('stocks.ajuster',            'Ajuster le stock',                    'stocks'),
  ('stocks.inventorier',        'Realiser un inventaire',              'stocks'),
  ('ventes.creer',              'Enregistrer une vente',               'ventes'),
  ('ventes.consulter_propres',  'Consulter ses propres ventes',        'ventes'),
  ('ventes.consulter_toutes',   'Consulter toutes les ventes',         'ventes'),
  ('ventes.annuler_demander',   'Demander une annulation',             'ventes'),
  ('ventes.annuler_approuver',  'Approuver une annulation',            'ventes'),
  ('ventes.accorder_reduction', 'Accorder une reduction',              'ventes'),
  ('paiements.consulter',       'Consulter les paiements',             'paiements'),
  ('depenses.creer',            'Enregistrer une depense',             'depenses'),
  ('depenses.consulter',        'Consulter les depenses',              'depenses'),
  ('depenses.valider',          'Valider ou rejeter une depense',      'depenses'),
  ('benefices.consulter',       'Consulter les benefices',             'rapports'),
  ('rapports.consulter',        'Consulter les rapports',              'rapports'),
  ('rapports.exporter',         'Exporter les rapports',               'rapports'),
  ('utilisateurs.gerer',        'Gerer les comptes utilisateurs',      'administration'),
  ('permissions.gerer',         'Gerer les permissions',               'administration'),
  ('appareils.gerer',           'Gerer les appareils',                 'administration'),
  ('parametres.gerer',          'Gerer les parametres',                'administration'),
  ('synchronisation.executer',  'Executer une synchronisation',        'synchronisation'),
  ('synchronisation.resoudre_conflit', 'Resoudre un conflit',          'synchronisation'),
  ('journal.consulter',         'Consulter le journal d activite',     'administration'),
  ('administration.gerer',      'Administration generale',             'administration')
ON CONFLICT (code) DO UPDATE
  SET nom = excluded.nom,
      module = excluded.module;

-- Proprietaire : toutes les permissions (le controle reste neanmoins fonde sur le role)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE r.code = 'PROPRIETAIRE'
ON CONFLICT DO NOTHING;

-- Administrateur : tout sauf les prerogatives strictement reservees au proprietaire
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON true
 WHERE r.code = 'ADMINISTRATEUR'
   AND p.code NOT IN (
     'produits.modifier_prix',
     'utilisateurs.gerer',
     'permissions.gerer',
     'parametres.gerer'
   )
ON CONFLICT DO NOTHING;

-- Employe : perimetre caisse, sans benefices globaux ni administration
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.code IN (
    'produits.consulter',
    'stocks.consulter',
    'ventes.creer',
    'ventes.consulter_propres',
    'ventes.annuler_demander',
    'ventes.accorder_reduction'
  )
 WHERE r.code = 'EMPLOYE'
ON CONFLICT DO NOTHING;

-- Categories de depenses initiales
INSERT INTO categories_depenses (code, nom) VALUES
  ('LOYER', 'Loyer'),
  ('ELECTRICITE', 'Electricite'),
  ('EAU', 'Eau'),
  ('INTERNET', 'Internet'),
  ('TRANSPORT', 'Transport'),
  ('SALAIRES', 'Salaires'),
  ('ENTRETIEN', 'Entretien'),
  ('FOURNITURES', 'Fournitures'),
  ('DIVERS', 'Divers')
ON CONFLICT (code) DO UPDATE SET nom = excluded.nom;

-- Parametres applicatifs (modifiables depuis l ecran Parametres)
INSERT INTO parametres (cle, valeur, description) VALUES
  ('boutique.nom', to_jsonb('SimaoTech'::text), 'Nom commercial affiche sur les recus.'),
  ('boutique.devise', to_jsonb('XOF'::text), 'Devise de reference (Franc CFA).'),
  ('boutique.adresse', to_jsonb(''::text), 'Adresse de la boutique.'),
  ('boutique.telephone', to_jsonb(''::text), 'Telephone de la boutique.'),
  ('recus.mentions', to_jsonb('Merci de votre visite.'::text), 'Mentions affichees sur les recus.'),
  ('securite.duree_session', to_jsonb(28800), 'Duree maximale d une session en secondes.'),
  ('synchronisation.intervalle_secondes', to_jsonb(60), 'Frequence de synchronisation automatique.'),
  ('synchronisation.quota_actif', to_jsonb(true), 'Active les quotas de stock hors connexion.')
ON CONFLICT (cle) DO NOTHING;
