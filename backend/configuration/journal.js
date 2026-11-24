/**
 * Journal technique de l'application (pino).
 * Les journaux sont ecrits sur la sortie standard et, hors tests, dans un fichier.
 */
import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import configuration from './environnement.js';

let destination = pino.destination(1);

if (!configuration.estTest) {
  try {
    fs.mkdirSync(configuration.journal.dossier, { recursive: true });
    destination = pino.destination({
      dest: path.join(configuration.journal.dossier, 'application.log'),
      sync: false,
      mkdir: true,
    });
  } catch (erreur) {
    console.warn('Impossible d ouvrir le fichier de journal :', erreur.message);
  }
}

export const journal = pino(
  {
    level: configuration.journal.niveau,
    base: { application: 'simaotech', environnement: configuration.environnement },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'motDePasse',
        'password',
        '*.motDePasse',
        '*.password',
        'SUPABASE_CLE_SERVICE',
        'DATABASE_URL',
      ],
      censor: '[masque]',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  destination,
);

export default journal;
