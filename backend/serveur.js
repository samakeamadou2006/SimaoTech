/**
 * SimaoTech - serveur applicatif.
 *
 * Lancement : `npm start` (ou `npm run dev` pour le rechargement automatique).
 * Le serveur sert l'API REST sous /api et l'application PWA sous /.
 */
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import pinoHttp from 'pino-http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import configuration from './configuration/environnement.js';
import journal from './configuration/journal.js';
import { fermerPool } from './configuration/base_de_donnees.js';
import api from './routes/index.js';
import { identifiantRequete, routeInconnue, gestionErreurs } from './middlewares/erreurs.js';

export function creerApplication() {
  const application = express();

  application.disable('x-powered-by');
  application.set('trust proxy', 1);

  application.use(identifiantRequete);

  if (!configuration.estTest) {
    application.use(
      pinoHttp({
        logger: journal,
        genReqId: (requete) => requete.id,
        autoLogging: { ignore: (requete) => requete.url === '/api/sante' },
      }),
    );
  }

  const politique = {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    // Bootstrap applique quelques styles en ligne (tooltips, transitions).
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:'],
    fontSrc: ["'self'", 'data:'],
    connectSrc: ["'self'", configuration.supabase.url].filter(Boolean),
    manifestSrc: ["'self'"],
    workerSrc: ["'self'"],
    objectSrc: ["'none'"],
    frameAncestors: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
  };

  application.use(
    helmet({
      contentSecurityPolicy: { directives: politique, useDefaults: true },
      crossOriginEmbedderPolicy: false,
      hsts: configuration.estProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );

  application.use(compression());

  application.use(
    cors({
      origin(origine, rappel) {
        if (!origine) return rappel(null, true);
        if (configuration.originesAutorisees.includes(origine)) return rappel(null, true);
        return rappel(null, false);
      },
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id'],
      maxAge: 600,
    }),
  );

  application.use(express.json({ limit: '1mb' }));
  application.use(express.urlencoded({ extended: false, limit: '1mb' }));

  // --- Bibliotheques servies localement (indispensable au mode hors ligne) ---
  application.use(
    '/vendor/bootstrap',
    express.static(path.join(configuration.chemins.modules, 'bootstrap', 'dist'), {
      maxAge: '1y',
      immutable: true,
    }),
  );
  application.use(
    '/vendor/chart.js',
    express.static(path.join(configuration.chemins.modules, 'chart.js', 'dist'), {
      maxAge: '1y',
      immutable: true,
    }),
  );

  // --- API REST ---
  application.use('/api', api);

  // --- Application PWA ---
  application.get('/service-worker.js', (requete, reponse) => {
    reponse.setHeader('Service-Worker-Allowed', '/');
    reponse.setHeader('Cache-Control', 'no-cache');
    reponse.sendFile(path.join(configuration.chemins.frontend, 'service-worker.js'));
  });

  application.get('/', (requete, reponse) => {
    reponse.redirect(302, '/pages/connexion.html');
  });

  application.use(
    express.static(configuration.chemins.frontend, {
      extensions: ['html'],
      setHeaders(reponse, chemin) {
        if (chemin.endsWith('.html')) {
          reponse.setHeader('Cache-Control', 'no-cache');
        }
      },
    }),
  );

  application.use(routeInconnue);
  application.use(gestionErreurs);

  return application;
}

const estExecuteDirectement =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (estExecuteDirectement) {
  const application = creerApplication();
  const serveur = application.listen(configuration.port, () => {
    journal.info(
      {
        port: configuration.port,
        environnement: configuration.environnement,
        url: configuration.urlPublique,
      },
      'SimaoTech demarre',
    );
    console.log(`\n  SimaoTech  |  ${configuration.environnement}`);
    console.log(`  Application : ${configuration.urlPublique}`);
    console.log(`  API sante   : ${configuration.urlPublique}/api/sante\n`);
  });

  serveur.keepAliveTimeout = 65_000;
  serveur.headersTimeout = 70_000;

  const arreter = async (signal) => {
    journal.info({ signal }, 'Arret du serveur demande');
    serveur.close(async () => {
      await fermerPool();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => arreter('SIGINT'));
  process.on('SIGTERM', () => arreter('SIGTERM'));
  process.on('unhandledRejection', (raison) => {
    journal.fatal({ raison: raison?.message ?? raison }, 'Promesse rejetee non geree');
  });
  process.on('uncaughtException', (erreur) => {
    journal.fatal({ erreur: erreur.message, pile: erreur.stack }, 'Exception non capturee');
  });
}

export default { creerApplication };
