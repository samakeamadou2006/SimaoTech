/**
 * Routes d'authentification.
 */
import { Router } from 'express';
import * as controleur from '../controleurs/authentification.controleur.js';
import { authentifier } from '../middlewares/authentification.js';
import { limiteConnexion } from '../middlewares/limitation.js';
import { asyncRoute } from '../utils/async.js';

const routeur = Router();

routeur.post('/connexion', limiteConnexion, asyncRoute(controleur.connexion));
routeur.post('/rafraichir', asyncRoute(controleur.rafraichir));
routeur.post('/mot-de-passe-oublie', limiteConnexion, asyncRoute(controleur.motDePasseOublie));
routeur.post(
  '/reinitialiser-mot-de-passe',
  limiteConnexion,
  asyncRoute(controleur.reinitialiserMotDePasse),
);

routeur.use(authentifier);
routeur.get('/moi', asyncRoute(controleur.moi));
routeur.post('/mot-de-passe', asyncRoute(controleur.changerMotDePasse));
routeur.post('/deconnexion', asyncRoute(controleur.deconnexion));

export default routeur;
