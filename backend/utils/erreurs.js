/**
 * Erreurs applicatives.
 *
 * Chaque erreur porte un code stable, un statut HTTP et un message destine
 * a l'utilisateur. Les details techniques restent dans les journaux.
 */
export class ErreurApplication extends Error {
  constructor(message, { code = 'ERREUR_APPLICATION', statut = 400, details = null, expose = true } = {}) {
    super(message);
    this.name = 'ErreurApplication';
    this.code = code;
    this.statutHttp = statut;
    this.details = details;
    this.expose = expose;
  }
}

export class ErreurValidation extends ErreurApplication {
  constructor(message = 'Les donnees envoyees sont invalides.', details = null) {
    super(message, { code: 'VALIDATION', statut: 422, details });
    this.name = 'ErreurValidation';
  }
}

export class ErreurAuthentification extends ErreurApplication {
  constructor(message = 'Authentification requise.', code = 'NON_AUTHENTIFIE') {
    super(message, { code, statut: 401 });
    this.name = 'ErreurAuthentification';
  }
}

export class ErreurAutorisation extends ErreurApplication {
  constructor(message = 'Vous n avez pas les droits necessaires.', code = 'ACCES_REFUSE') {
    super(message, { code, statut: 403 });
    this.name = 'ErreurAutorisation';
  }
}

export class ErreurIntrouvable extends ErreurApplication {
  constructor(message = 'Ressource introuvable.', code = 'INTROUVABLE') {
    super(message, { code, statut: 404 });
    this.name = 'ErreurIntrouvable';
  }
}

export class ErreurConflit extends ErreurApplication {
  constructor(message = 'Conflit avec l etat actuel des donnees.', code = 'CONFLIT', details = null) {
    super(message, { code, statut: 409, details });
    this.name = 'ErreurConflit';
  }
}

export class ErreurMetier extends ErreurApplication {
  constructor(message, code = 'REGLE_METIER', details = null) {
    super(message, { code, statut: 422, details });
    this.name = 'ErreurMetier';
  }
}

/**
 * Traduit les erreurs PostgreSQL levees par les fonctions metier
 * (`RAISE EXCEPTION 'CODE:detail'`) en erreurs applicatives lisibles.
 */
const MESSAGES_METIER = {
  VENTE_A_PERTE: 'Vente bloquee : le prix net est inferieur au cout moyen pondere.',
  STOCK_INSUFFISANT: 'Stock insuffisant pour valider cette operation.',
  PAIEMENT_NON_CONFORME: 'Le total des paiements doit etre exactement egal au montant de la vente.',
  QUANTITE_INVALIDE: 'Quantite invalide.',
  PRODUIT_INTROUVABLE: 'Produit introuvable.',
  STOCK_INTROUVABLE: 'Fiche de stock introuvable pour ce produit.',
  STATUT_VENTE_INVALIDE: 'Cette vente ne peut plus etre modifiee dans son statut actuel.',
  APPROVISIONNEMENT_VIDE: 'Un approvisionnement doit contenir au moins un produit.',
  PERMISSION_REFUSEE: 'Permission insuffisante pour cette operation.',
  STOCK_NEGATIF: 'Le stock ne peut pas devenir negatif.',
  VENTE_DEJA_ANNULEE: 'Cette vente est deja annulee.',
  ANNULATION_NON_AUTORISEE: 'Seul le proprietaire ou un administrateur autorise peut approuver une annulation.',
};

export function traduireErreurPostgres(erreur) {
  if (erreur instanceof ErreurApplication) return erreur;

  // Message type : "VENTE_A_PERTE:<uuid>"
  if (typeof erreur.message === 'string') {
    for (const [code, message] of Object.entries(MESSAGES_METIER)) {
      if (erreur.message === code || erreur.message.startsWith(`${code}:`)) {
        const complement = erreur.message.includes(':')
          ? erreur.message.slice(erreur.message.indexOf(':') + 1)
          : null;
        const statut = code === 'PERMISSION_REFUSEE' ? 403 : 422;
        return new ErreurMetier(message, code, complement ? { reference: complement } : null);
      }
    }
  }

  const codesPg = {
    '23505': ['DOUBLON', 'Cette valeur existe deja (contrainte d unicite).', 409],
    '23503': ['REFERENCE_INVALIDE', 'Une reference liee a cette operation est introuvable.', 409],
    '23514': ['CONTRAINTE_VIOLATION', 'Operation refusee : une contrainte de coherence est violee.', 422],
    '23502': ['CHAMP_REQUIS', 'Un champ obligatoire est manquant.', 422],
    '22P02': ['FORMAT_INVALIDE', 'Un identifiant ou une valeur a un format invalide.', 400],
    '40001': ['CONFLIT_CONCURRENCE', 'Conflit de concurrence, veuillez reessayer.', 409],
    '40P01': ['DEADLOCK', 'Conflit d acces concurrent, veuillez reessayer.', 409],
    '42501': ['ACCES_REFUSE', 'Acces refuse par la politique de securite.', 403],
  };

  if (erreur.code && codesPg[erreur.code]) {
    const [code, message, statut] = codesPg[erreur.code];
    return new ErreurApplication(message, { code, statut, details: erreur.detail ?? null });
  }

  return new ErreurApplication('Une erreur interne est survenue.', {
    code: 'ERREUR_INTERNE',
    statut: 500,
    expose: false,
  });
}
