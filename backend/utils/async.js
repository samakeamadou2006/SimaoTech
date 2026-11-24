/**
 * Enveloppe les controleurs asynchrones.
 *
 * Express 4 ne transmet pas les rejets de promesse au middleware d'erreurs :
 * sans cette enveloppe, une erreur metier laisserait la requete sans reponse.
 */
export function asyncRoute(gestionnaire) {
  return (requete, reponse, suivant) => {
    Promise.resolve(gestionnaire(requete, reponse, suivant)).catch(suivant);
  };
}

export default asyncRoute;
