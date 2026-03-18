const DB_NAME = 'spotitnow.audio-assets';
const STORE_NAME = 'audio-assets';
const DB_VERSION = 1;

export const AUDIO_ASSET_PREFIX = 'idb:';

interface StoredAudioAsset {
  id: string;
  blob: Blob;
  name: string;
  type: string;
  createdAt: number;
}

const supportsIndexedDb = () => typeof window !== 'undefined' && 'indexedDB' in window;

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const openAudioAssetDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('Failed to open audio asset database.'));
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
    : `audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const isStoredAudioAssetSource = (source?: string) =>
  typeof source === 'string' && source.startsWith(AUDIO_ASSET_PREFIX);

export const saveAudioAssetFromFile = async (file: File): Promise<string> => {
  if (!supportsIndexedDb()) {
    return await readFileAsDataUrl(file);
  }

  const db = await openAudioAssetDb();
  const id = createAssetId();
  const record: StoredAudioAsset = {
    id,
    blob: file,
    name: file.name,
    type: file.type,
    createdAt: Date.now()
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to store audio asset.'));
    tx.objectStore(STORE_NAME).put(record);
  });

  return `${AUDIO_ASSET_PREFIX}${id}`;
};

export const loadAudioAssetBlob = async (source: string): Promise<Blob | null> => {
  if (!isStoredAudioAssetSource(source) || !supportsIndexedDb()) return null;
  const id = source.slice(AUDIO_ASSET_PREFIX.length);
  const db = await openAudioAssetDb();

  return await new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(id);
    request.onerror = () => reject(request.error ?? new Error('Failed to read audio asset.'));
    request.onsuccess = () => {
      const record = request.result as StoredAudioAsset | undefined;
      resolve(record?.blob ?? null);
    };
  });
};

export const deleteStoredAudioAsset = async (source?: string): Promise<void> => {
  if (!isStoredAudioAssetSource(source) || !supportsIndexedDb()) return;
  const id = source.slice(AUDIO_ASSET_PREFIX.length);
  const db = await openAudioAssetDb();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to delete audio asset.'));
    tx.objectStore(STORE_NAME).delete(id);
  });
};

export const deleteStoredAudioAssets = async (sources: string[]): Promise<void> => {
  if (!supportsIndexedDb()) return;
  const stored = sources.filter((source) => isStoredAudioAssetSource(source));
  if (!stored.length) return;
  const db = await openAudioAssetDb();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to delete audio assets.'));
    const store = tx.objectStore(STORE_NAME);
    stored.forEach((source) => store.delete(source.slice(AUDIO_ASSET_PREFIX.length)));
  });
};
