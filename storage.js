let database;
export function openDatabase() {
  if (!database)
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open('sample-snip-pro', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('pads', { keyPath: 'id' });
        request.result.createObjectStore('sessions');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        database = undefined;
        reject(request.error);
      };
    });
  return database;
}
export async function getSession() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('sessions').objectStore('sessions').get('last');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function putSession(session) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sessions', 'readwrite');
    tx.objectStore('sessions').put(session, 'last');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Session could not be saved.'));
  });
}
export async function getPads(bank) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('pads').objectStore('pads').getAll();
    request.onsuccess = () => resolve(request.result.filter((pad) => pad.bank === bank));
    request.onerror = () => reject(request.error);
  });
}
export async function getPad(id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('pads').objectStore('pads').get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function putPads(pads) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pads', 'readwrite');
    for (const pad of pads) tx.objectStore('pads').put(pad);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Sample could not be saved.'));
  });
}
