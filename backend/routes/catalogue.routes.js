/**
 * Routes du catalogue.
 *
 * Lecture : `produits.consulter` (tous les roles).
 * Categories : `categories.gerer` (proprietaire et administrateur).
 * Produits : `produits.gerer` (proprietaire et administrateur).
 * Prix de vente : `produits.modifier_prix` (proprietaire uniquement).
 */
import { Router } from 'express';
import * as controleur from '../controleurs/catalogue.controleur.js';
import { authentifier } from '../middlewares/authentification.js';
import { exigerMotDePasseAJour, exigerPermission } from '../middlewares/autorisation.js';
import { asyncRoute } from '../utils/async.js';

function proteger() {
  const routeur = Router();
  routeur.use(authentifier);
  routeur.use(exigerMotDePasseAJour);
  return routeur;
}

export const routesCategories = proteger();
routesCategories.get(
  '/',
  exigerPermission('produits.consulter'),
  asyncRoute(controleur.listerCategories),
);
routesCategories.get(
  '/options',
  exigerPermission('produits.consulter'),
  asyncRoute(controleur.optionsCategories),
);
routesCategories.get(
  '/:id',
  exigerPermission('produits.consulter'),
  asyncRoute(controleur.detailCategorie),
);
routesCategories.post(
  '/',
  exigerPermission('categories.gerer'),
  asyncRoute(controleur.creerCategorie),
);
routesCategories.patch(
  '/:id',
  exigerPermission('categories.gerer'),
  asyncRoute(controleur.modifierCategorie),
);
routesCategories.delete(
  '/:id',
  exigerPermission('categories.gerer'),
  asyncRoute(controleur.supprimerCategorie),
);

export const routesProduits = proteger();
routesProduits.get('/', exigerPermission('produits.consulter'), asyncRoute(controleur.listerProduits));
routesProduits.get(
  '/:id/historique-prix',
  exigerPermission('produits.consulter'),
  asyncRoute(controleur.historiquePrix),
);
routesProduits.get('/:id', exigerPermission('produits.consulter'), asyncRoute(controleur.detailProduit));
routesProduits.post('/', exigerPermission('produits.gerer'), asyncRoute(controleur.creerProduit));
routesProduits.patch('/:id', exigerPermission('produits.gerer'), asyncRoute(controleur.modifierProduit));
routesProduits.patch(
  '/:id/prix',
  exigerPermission('produits.modifier_prix'),
  asyncRoute(controleur.changerPrix),
);
routesProduits.delete(
  '/:id',
  exigerPermission('produits.gerer'),
  asyncRoute(controleur.supprimerProduit),
);

export default { routesCategories, routesProduits };
