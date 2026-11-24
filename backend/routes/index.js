/**
 * Point de montage de toutes les routes de l'API (version /api).
 */
import { Router } from 'express';
import sante from './sante.routes.js';
import authentification from './authentification.routes.js';
import utilisateurs from './utilisateurs.routes.js';
import { routesCategories, routesProduits } from './catalogue.routes.js';
import metiers from './metiers.routes.js';
import { limiteGlobale } from '../middlewares/limitation.js';

const api = Router();

api.use(limiteGlobale);

api.use('/sante', sante);
api.use('/auth', authentification);
api.use('/utilisateurs', utilisateurs);
api.use('/categories', routesCategories);
api.use('/produits', routesProduits);
api.use('/', metiers);

/** Catalogue des routes disponibles (documentation vivante, sans secret). */
api.get('/', (requete, reponse) => {
  reponse.json({
    succes: true,
    donnees: {
      nom: 'SimaoTech API',
      version: '1.0.0',
      routes: [
        'GET  /api/sante',
        'POST /api/auth/connexion',
        'POST /api/auth/rafraichir',
        'POST /api/auth/mot-de-passe-oublie',
        'POST /api/auth/reinitialiser-mot-de-passe',
        'GET  /api/auth/moi',
        'POST /api/auth/mot-de-passe',
        'POST /api/auth/deconnexion',
        'GET  /api/utilisateurs',
        'GET  /api/utilisateurs/catalogue',
        'POST /api/utilisateurs',
        'GET  /api/utilisateurs/:id',
        'PATCH /api/utilisateurs/:id',
        'PUT  /api/utilisateurs/:id/permissions',
        'POST /api/utilisateurs/:id/reinitialiser-mot-de-passe',
        'DELETE /api/utilisateurs/:id',
        'GET  /api/categories',
        'GET  /api/categories/options',
        'POST /api/categories',
        'GET  /api/categories/:id',
        'PATCH /api/categories/:id',
        'DELETE /api/categories/:id',
        'GET  /api/produits',
        'POST /api/produits',
        'GET  /api/produits/:id',
        'PATCH /api/produits/:id',
        'PATCH /api/produits/:id/prix',
        'GET  /api/produits/:id/historique-prix',
        'DELETE /api/produits/:id',
        'GET  /api/fournisseurs',
        'GET  /api/fournisseurs/options',
        'GET  /api/fournisseurs/:id',
        'POST /api/fournisseurs',
        'PATCH /api/fournisseurs/:id',
        'DELETE /api/fournisseurs/:id',
        'GET  /api/approvisionnements',
        'POST /api/approvisionnements',
        'GET  /api/approvisionnements/:id',
        'POST /api/approvisionnements/:id/valider',
        'GET  /api/stocks',
        'GET  /api/stocks/statistiques',
        'GET  /api/stocks/alertes',
        'GET  /api/mouvements-stock',
        'POST /api/stocks/ajuster',
        'GET  /api/inventaires',
        'POST /api/inventaires',
        'GET  /api/inventaires/:id',
        'POST /api/inventaires/:id/valider',
        'GET  /api/ventes',
        'POST /api/ventes',
        'GET  /api/ventes/:id',
        'GET  /api/ventes/:id/recu',
        'POST /api/ventes/:id/valider',
        'GET  /api/paiements',
        'GET  /api/annulations',
        'GET  /api/annulations/statistiques',
        'POST /api/annulations',
        'POST /api/annulations/:id/approuver',
        'POST /api/annulations/:id/rejeter',
        'GET  /api/depenses',
        'POST /api/depenses',
        'GET  /api/depenses/categories',
        'GET  /api/depenses/statistiques',
        'POST /api/depenses/:id/valider',
        'POST /api/depenses/:id/rejeter',
        'GET  /api/tableau-de-bord',
        'GET  /api/rapports',
        'GET  /api/rapports/export.csv',
        'GET  /api/parametres',
        'PATCH /api/parametres/:cle',
        'GET  /api/appareils',
        'POST /api/appareils',
        'PATCH /api/appareils/:id',
        'GET  /api/synchronisation/etat',
        'GET  /api/synchronisation/conflits',
        'POST /api/synchronisation/conflits/:id/resoudre',
        'POST /api/synchronisation',
      ],
    },
  });
});

export default api;
