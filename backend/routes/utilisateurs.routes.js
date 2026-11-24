/**
 * Routes de gestion des comptes et des permissions.
 *
 * Toutes les routes sont protegees : compte actif, jeton valide, mot de passe
 * a jour, puis permission explicite. Le proprietaire est le seul role a
 * posseder `utilisateurs.gerer` et `permissions.gerer` dans les donnees
 * initiales.
 */
import { Router } from 'express';
import * as controleur from '../controleurs/utilisateurs.controleur.js';
import { authentifier } from '../middlewares/authentification.js';
import { exigerMotDePasseAJour, exigerPermission } from '../middlewares/autorisation.js';
import { asyncRoute } from '../utils/async.js';

const routeur = Router();

routeur.use(authentifier);
routeur.use(exigerMotDePasseAJour);

routeur.get('/catalogue', exigerPermission('utilisateurs.gerer'), asyncRoute(controleur.catalogue));

routeur.get('/', exigerPermission('utilisateurs.gerer'), asyncRoute(controleur.lister));
routeur.post('/', exigerPermission('utilisateurs.gerer'), asyncRoute(controleur.creer));

routeur.get('/:id', exigerPermission('utilisateurs.gerer'), asyncRoute(controleur.detail));
routeur.patch('/:id', exigerPermission('utilisateurs.gerer'), asyncRoute(controleur.modifier));
routeur.put(
  '/:id/permissions',
  exigerPermission('permissions.gerer'),
  asyncRoute(controleur.remplacerPermissions),
);
routeur.post(
  '/:id/reinitialiser-mot-de-passe',
  exigerPermission('utilisateurs.gerer'),
  asyncRoute(controleur.reinitialiserMotDePasse),
);
routeur.delete('/:id', exigerPermission('utilisateurs.gerer'), asyncRoute(controleur.supprimer));

export default routeur;
