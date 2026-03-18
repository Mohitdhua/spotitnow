const DB_NAME = 'spotitnow.video-assets';
const STORE_NAME = 'video-assets';
const DB_VERSION = 1;

export const VIDEO_ASSET_PREFIX = 'idb-video:';

interface StoredVideoAsset {
  id: string;
  blob: Blob;
  name: string;
  type: string;
  createdAt: number;
}

const supportsIndexedDb = () => typeof window !== 'undefined' && 'indexedDB' in window;

const openVideoAssetDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('Failed to open video asset database.'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });

const createAssetId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const isStoredVideoAssetSource = (source?: string) =>
  typeof source === 'string' && source.startsWith(VIDEO_ASSET_PREFIX);

export const saveVideoAssetFromFile = async (file: File): Promise<string> => {
  if (!supportsIndexedDb()) {
    throw new Error('IndexedDB is unavailable for storing video assets.');
  }

  const db = await openVideoAssetDb();
  const id = createAssetId();
  const record: StoredVideoAsset = {
    id,
    blob: file,
    name: file.name,
    type: file.type,
    createdAt: Date.now()
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to store video asset.'));
    tx.objectStore(STORE_NAME).put(record);
  });

  return `${VIDEO_ASSET_PREFIX}${id}`;
};

export const loadVideoAssetBlob = async (source: string): Promise<Blob | null> => {
  if (!source) return null;
  if (source.startsWith('blob:')) {
    const response = await fetch(source);
    return await response.blob();
  }
  if (source.startsWith('data:')) {
    const response = await fetch(source);
    return await response.blob();
  }
  if (source.startsWith('file:')) {
    return null;
  }
  if (source.startsWith('http')) {
    const response = await fetch(source);
    return await response.blob();
  }
  if (!isStoredVideoAssetSource(source) || !supportsIndexedDb()) return null;
  const id = source.slice(VIDEO_ASSET_PREFIX.length);
  const db = await openVideoAssetDb();

  return await new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(id);
    request.onerror = () => reject(request.error ?? new Error('Failed to read video asset.'));
    request.onsuccess = () => {
      const record = request.result as StoredVideoAsset | undefined;
      resolve(record?.blob ?? null);
    };
  });
};

export const deleteStoredVideoAsset = async (source?: string): Promise<void> => {
  if (!isStoredVideoAssetSource(source) || !supportsIndexedDb()) return;
  const id = source.slice(VIDEO_ASSET_PREFIX.length);
  const db = await openVideoAssetDb();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to delete video asset.'));
    tx.objectStore(STORE_NAME).delete(id);
  });
};

export const deleteStoredVideoAssets = async (sources: string[]): Promise<void> => {
  if (!supportsIndexedDb()) return;
  const stored = sources.filter((source) => isStoredVideoAssetSource(source));
  if (!stored.length) return;
  const db = await openVideoAssetDb();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to delete video assets.'));
    const store = tx.objectStore(STORE_NAME);
    stored.forEach((source) => store.delete(source.slice(VIDEO_ASSET_PREFIX.length)));
  });
};
