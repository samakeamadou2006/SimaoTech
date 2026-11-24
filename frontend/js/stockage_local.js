const NOM_BASE = 'simaotech-hors-ligne';

function ouvrir() {
  return new Promise((resolve, reject) => {
    const requete = indexedDB.open(NOM_BASE, 1);
    requete.onupgradeneeded = () => {
      const db = requete.result;
      if (!db.objectStoreNames.contains('file_synchronisation')) {
        db.createObjectStore('file_synchronisation', { keyPath: 'cle' });
      }
    };
    requete.onsuccess = () => resolve(requete.result);
    requete.onerror = () => reject(requete.error);
  });
}

export async function ajouterOperation({ endpoint, corps }) {
  if (!/^\/api\/(ventes|approvisionnements|depenses)$/.test(endpoint)) {
    throw new TypeError('Cette operation ne peut pas etre mise en attente hors connexion.');
  }
  if (!corps || typeof corps !== 'object' || Array.isArray(corps)) {
    throw new TypeError('Le contenu de l operation doit etre un objet.');
  }
  const db = await ouvrir();
  const transaction = db.transaction('file_synchronisation', 'readwrite');
  transaction.objectStore('file_synchronisation').put({
    cle: crypto.randomUUID(),
    endpoint,
    corps: JSON.parse(JSON.stringify(corps)),
    creeLe: new Date().toISOString(),
    statut: 'EN_ATTENTE',
  });
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('Ecriture IndexedDB annulee.'));
  });
}

export async function operationsEnAttente() {
  const db = await ouvrir();
  const transaction = db.transaction('file_synchronisation', 'readonly');
  const lecture = transaction.objectStore('file_synchronisation').getAll();
  return new Promise((resolve, reject) => {
    lecture.onsuccess = () => resolve(lecture.result);
    lecture.onerror = () => reject(lecture.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('Lecture IndexedDB annulee.'));
  });
}

export async function supprimerOperation(cle) {
  const db = await ouvrir();
  const transaction = db.transaction('file_synchronisation', 'readwrite');
  transaction.objectStore('file_synchronisation').delete(cle);
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('Suppression IndexedDB annulee.'));
  });
}

export async function marquerOperationEnErreur(cle, erreur) {
  const db = await ouvrir();
  const transaction = db.transaction('file_synchronisation', 'readwrite');
  const store = transaction.objectStore('file_synchronisation');
  const lecture = store.get(cle);
  lecture.onsuccess = () => {
    if (lecture.result) {
      store.put({
        ...lecture.result,
        statut: 'ERREUR',
        erreur: String(erreur).slice(0, 500),
      });
    }
  };
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('Mise a jour IndexedDB annulee.'));
  });
}
