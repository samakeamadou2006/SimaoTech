/**
 * Limitation de debit (protection brute force et abus d'API).
 */
import rateLimit from 'express-rate-limit';

const options = {
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    succes: false,
    erreur: {
      code: 'TROP_DE_REQUETES',
      message: 'Trop de requetes. Veuillez patienter avant de reessayer.',
    },
  },
};

export const limiteGlobale = rateLimit({
  ...options,
  windowMs: 60_000,
  limit: 300,
});

export const limiteConnexion = rateLimit({
  ...options,
  windowMs: 15 * 60_000,
  limit: 10,
  skipSuccessfulRequests: true,
});

export default { limiteGlobale, limiteConnexion };
