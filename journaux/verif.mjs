const urls = ['/','/pages/connexion.html','/css/styles.css','/js/api.js','/vendor/bootstrap/css/bootstrap.min.css','/manifest.json','/service-worker.js','/api','/api/inconnue','/api/auth/moi'];
for (const u of urls) {
  try {
    const r = await fetch('http://localhost:3101' + u, { redirect: 'manual' });
    const body = await r.text();
    console.log(u.padEnd(48), '->', r.status, (r.headers.get('content-type')||'').split(';')[0], '|', body.slice(0,90).replace(/\n/g,' '));
  } catch (e) { console.log(u, 'ERREUR', e.message); }
}
