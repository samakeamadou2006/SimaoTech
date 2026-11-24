/**
 * Routes des modules metier (phases 5 a 12).
 *
 * Toutes les routes exigent une authentification valide et un mot de passe
 * a jour. Les permissions sont verifiees ici (premier filtre) puis de nouveau
 * dans les services et dans les fonctions PostgreSQL (defense en profondeur).
 */
import { Router } from 'express';
import * as c from '../controleurs/metiers.controleur.js';
import { authentifier } from '../middlewares/authentification.js';
import { exigerMotDePasseAJour, exigerPermission } from '../middlewares/autorisation.js';
import { asyncRoute } from '../utils/async.js';

const r = Router();
r.use(authentifier, exigerMotDePasseAJour);

/* Fournisseurs ------------------------------------------------------------- */
r.get(
  '/fournisseurs',
  exigerPermission('fournisseurs.gerer', 'approvisionnements.consulter'),
  asyncRoute(c.fournisseursLister),
);
r.get(
  '/fournisseurs/options',
  exigerPermission('fournisseurs.gerer', 'approvisionnements.consulter'),
  asyncRoute(c.fournisseursOptions),
);
r.get(
  '/fournisseurs/:id',
  exigerPermission('fournisseurs.gerer', 'approvisionnements.consulter'),
  asyncRoute(c.fournisseurDetail),
);
r.post('/fournisseurs', exigerPermission('fournisseurs.gerer'), asyncRoute(c.fournisseurCreer));
r.patch(
  '/fournisseurs/:id',
  exigerPermission('fournisseurs.gerer'),
  asyncRoute(c.fournisseurModifier),
);
r.delete(
  '/fournisseurs/:id',
  exigerPermission('fournisseurs.gerer'),
  asyncRoute(c.fournisseurSupprimer),
);

/* Approvisionnements ------------------------------------------------------- */
r.get(
  '/approvisionnements',
  exigerPermission('approvisionnements.consulter'),
  asyncRoute(c.approvisionnementsLister),
);
r.post(
  '/approvisionnements',
  exigerPermission('approvisionnements.creer'),
  asyncRoute(c.approvisionnementCreer),
);
r.get(
  '/approvisionnements/:id',
  exigerPermission('approvisionnements.consulter'),
  asyncRoute(c.approvisionnementDetail),
);
r.post(
  '/approvisionnements/:id/valider',
  exigerPermission('approvisionnements.valider'),
  asyncRoute(c.approvisionnementValider),
);

/* Stocks ------------------------------------------------------------------- */
r.get('/stocks', exigerPermission('stocks.consulter'), asyncRoute(c.stocksLister));
r.get('/stocks/statistiques', exigerPermission('stocks.consulter'), asyncRoute(c.stocksStatistiques));
r.get('/stocks/alertes', exigerPermission('stocks.consulter'), asyncRoute(c.stocksAlertes));
r.get('/mouvements-stock', exigerPermission('stocks.consulter'), asyncRoute(c.mouvementsLister));
r.post('/stocks/ajuster', exigerPermission('stocks.ajuster'), asyncRoute(c.stockAjuster));

r.get('/inventaires', exigerPermission('stocks.inventorier'), asyncRoute(c.inventairesLister));
r.post('/inventaires', exigerPermission('stocks.inventorier'), asyncRoute(c.inventaireCreer));
r.get(
  '/inventaires/:id',
  exigerPermission('stocks.inventorier'),
  asyncRoute(c.inventaireDetail),
);
r.post(
  '/inventaires/:id/valider',
  exigerPermission('stocks.inventorier'),
  asyncRoute(c.inventaireValider),
);

/* Ventes ------------------------------------------------------------------- */
r.get(
  '/ventes',
  exigerPermission('ventes.consulter_propres', 'ventes.consulter_toutes'),
  asyncRoute(c.ventesLister),
);
r.post('/ventes', exigerPermission('ventes.creer'), asyncRoute(c.venteCreer));
r.get(
  '/ventes/:id',
  exigerPermission('ventes.consulter_propres', 'ventes.consulter_toutes'),
  asyncRoute(c.venteDetail),
);
r.get(
  '/ventes/:id/recu',
  exigerPermission('ventes.consulter_propres', 'ventes.consulter_toutes'),
  asyncRoute(c.venteRecu),
);
r.post('/ventes/:id/valider', exigerPermission('ventes.creer'), asyncRoute(c.venteValider));

/* Paiements ---------------------------------------------------------------- */
r.get('/paiements', exigerPermission('paiements.consulter'), asyncRoute(c.paiementsLister));

/* Annulations -------------------------------------------------------------- */
r.get(
  '/annulations',
  exigerPermission('ventes.annuler_approuver', 'ventes.annuler_demander'),
  asyncRoute(c.annulationsLister),
);
r.get(
  '/annulations/statistiques',
  exigerPermission('ventes.annuler_approuver', 'ventes.annuler_demander'),
  asyncRoute(c.annulationsStatistiques),
);
r.post(
  '/annulations',
  exigerPermission('ventes.annuler_demander'),
  asyncRoute(c.annulationDemander),
);
r.post(
  '/annulations/:id/approuver',
  exigerPermission('ventes.annuler_approuver'),
  asyncRoute(c.annulationApprouver),
);
r.post(
  '/annulations/:id/rejeter',
  exigerPermission('ventes.annuler_approuver'),
  asyncRoute(c.annulationRejeter),
);

/* Depenses ----------------------------------------------------------------- */
r.get(
  '/depenses/categories',
  exigerPermission('depenses.consulter', 'depenses.creer'),
  asyncRoute(c.categoriesDepenses),
);
r.get('/depenses', exigerPermission('depenses.consulter', 'depenses.creer'), asyncRoute(c.depensesLister));
r.get(
  '/depenses/statistiques',
  exigerPermission('depenses.consulter', 'depenses.creer'),
  asyncRoute(c.depensesStatistiques),
);
r.post('/depenses', exigerPermission('depenses.creer'), asyncRoute(c.depenseCreer));
r.post('/depenses/:id/valider', exigerPermission('depenses.valider'), asyncRoute(c.depenseValider));
r.post('/depenses/:id/rejeter', exigerPermission('depenses.valider'), asyncRoute(c.depenseRejeter));

/* Tableau de bord et rapports --------------------------------------------- */
r.get('/tableau-de-bord', asyncRoute(c.tableauDeBord));
r.get('/rapports', exigerPermission('rapports.consulter'), asyncRoute(c.rapports));
r.get('/rapports/export.csv', exigerPermission('rapports.exporter'), asyncRoute(c.rapportCsv));

/* Parametres --------------------------------------------------------------- */
r.get('/parametres', exigerPermission('parametres.gerer'), asyncRoute(c.parametresLister));
r.patch('/parametres/:cle', exigerPermission('parametres.gerer'), asyncRoute(c.parametreModifier));

/* Appareils et synchronisation -------------------------------------------- */
r.get(
  '/appareils',
  exigerPermission('appareils.gerer', 'synchronisation.executer', 'synchronisation.resoudre_conflit'),
  asyncRoute(c.appareilsLister),
);
r.post('/appareils', exigerPermission('appareils.gerer'), asyncRoute(c.appareilEnregistrer));
r.patch('/appareils/:id', exigerPermission('appareils.gerer'), asyncRoute(c.appareilModifier));

r.get(
  '/synchronisation/etat',
  exigerPermission('synchronisation.executer', 'synchronisation.resoudre_conflit'),
  asyncRoute(c.etatSynchronisation),
);
r.get(
  '/synchronisation/conflits',
  exigerPermission('synchronisation.resoudre_conflit'),
  asyncRoute(c.conflitsLister),
);
r.post(
  '/synchronisation/conflits/:id/resoudre',
  exigerPermission('synchronisation.resoudre_conflit'),
  asyncRoute(c.conflitResoudre),
);
r.post('/synchronisation', exigerPermission('synchronisation.executer'), asyncRoute(c.synchroniser));

export default r;
