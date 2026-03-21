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

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => {
  const response = await fetch(dataUrl);
  if (!response.ok) {
    throw new Error('Failed to read embedded audio asset.');
  }
  return await response.blob();
};

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

const persistAudioAsset = async (blob: Blob, name: string): Promise<string> => {
  if (!supportsIndexedDb()) {
    return await blobToDataUrl(blob);
  }

  const db = await openAudioAssetDb();
  const id = createAssetId();
  const record: StoredAudioAsset = {
    id,
    blob,
    name,
    type: blob.type || 'audio/mpeg',
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

export const saveAudioAssetFromFile = async (file: File): Promise<string> => {
  return await persistAudioAsset(file, file.name || 'audio-asset');
};

export const saveAudioAssetFromDataUrl = async (
  dataUrl: string,
  name = 'audio-asset'
): Promise<string> => {
  return await persistAudioAsset(await dataUrlToBlob(dataUrl), name);
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

export const exportStoredAudioAssetMap = async (sources: Array<string | undefined>) => {
  const entries = await Promise.all(
    [...new Set(sources.filter((source): source is string => isStoredAudioAssetSource(source)))].map(
      async (source) => {
        const blob = await loadAudioAssetBlob(source);
        if (!blob) {
          return null;
        }
        return [source, await blobToDataUrl(blob)] as const;
      }
    )
  );

  return Object.fromEntries(
    entries.filter((entry): entry is readonly [string, string] => Boolean(entry))
  );
};

export const importStoredAudioAssetMap = async (assetMap?: Record<string, unknown>) => {
  const restored = new Map<string, string>();
  if (!assetMap || typeof assetMap !== 'object') {
    return restored;
  }

  const entries = Object.entries(assetMap).filter(
    (entry): entry is [string, string] =>
      typeof entry[0] === 'string' && typeof entry[1] === 'string' && entry[1].startsWith('data:')
  );

  for (const [originalSource, dataUrl] of entries) {
    try {
      restored.set(originalSource, await saveAudioAssetFromDataUrl(dataUrl));
    } catch {
      // Skip invalid asset entries and keep the original source reference.
    }
  }

  return restored;
};
