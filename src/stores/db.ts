const DB_NAME = 'soundcalliflow';
const DB_VERSION = 1;
const STORE_NAME = 'records';

export interface RecordEntry {
  id: string;
  region: {
    region_code: string;
    region_label: string;
    region_group: string;
  };
  transcript: string;
  audioBlob: Blob;
  audioUrl: string;
  audioFeatures: {
    avgRms: number;
    peak: number;
    silenceRatio: number;
    tempo: number;
  };
  f0Series?: number[];
  durationRatios?: number[];
  energyContour?: number[];
  /** Live acoustic frames captured during recording (for visualization replay) */
  vizFrames?: { f0: number; rms: number; timestamp: number }[];
  posterUrl: string;
  privacy: 'public' | 'private';
  timestamp: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveRecord(record: RecordEntry): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllRecords(): Promise<RecordEntry[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getRecordById(id: string): Promise<RecordEntry | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteRecord(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
