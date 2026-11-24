/**
 * Sonde de sante : etat du serveur, de la base et de la configuration.
 * Ne divulgue aucun secret.
 */
import { Router } from 'express';
import configuration, { avertissements } from '../configuration/environnement.js';
import { verifierConnexion } from '../configuration/base_de_donnees.js';
import { supabaseDisponible } from '../configuration/supabase.js';
import { executer } from '../configuration/base_de_donnees.js';
import { succes } from '../utils/reponses.js';

const routeur = Router();

const DEMARRE_LE = new Date();

routeur.get('/', async (requete, reponse, suivant) => {
  try {
    const base = await verifierConnexion();

    let migrations = null;
    if (base.disponible) {
      try {
        const { rows } = await executer(
          `SELECT count(*)::int AS nombre, max(appliquee_le) AS derniere
             FROM schema_migrations`,
        );
        migrations = rows[0];
      } catch {
        migrations = { nombre: 0, derniere: null, etat: 'non initialisee' };
      }
    }

    return succes(reponse, {
      statut: base.disponible ? 'operationnel' : 'degrade',
      version: '1.0.0',
      environnement: configuration.environnement,
      demarreLe: DEMARRE_LE.toISOString(),
      disponibiliteSecondes: Math.round((Date.now() - DEMARRE_LE.getTime()) / 1000),
      fuseauHoraire: configuration.fuseauHoraire,
      baseDeDonnees: base,
      migrations,
      authentification: {
        mode: configuration.authentification.mode,
        supabase: supabaseDisponible(),
      },
      avertissements,
    });
  } catch (erreur) {
    return suivant(erreur);
  }
});

export default routeur;
