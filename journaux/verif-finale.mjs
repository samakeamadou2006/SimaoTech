const base = 'http://localhost:3103';
const checks = [
  ['GET', '/api/sante'],
  ['GET', '/pages/connexion.html'],
  ['GET', '/pages/tableau-de-bord.html'],
  ['GET', '/service-worker.js'],
  ['POST', '/api/auth/connexion', { email: 'x@y.ci', motDePasse: 'motdepasse' }],
  ['POST', '/api/auth/mot-de-passe-oublie', { email: 'x@y.ci' }],
  ['GET', '/api/auth/moi'],
];
for (const [methode, chemin, corps] of checks) {
  const r = await fetch(base + chemin, {
    method: methode,
    headers: corps ? { 'Content-Type': 'application/json' } : {},
    body: corps ? JSON.stringify(corps) : undefined,
  });
  let extrait = (await r.text()).slice(0, 130).replace(/\n/g, ' ');
  console.log(`${methode.padEnd(5)} ${chemin.padEnd(34)} -> ${r.status}  ${extrait}`);
}


