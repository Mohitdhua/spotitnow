const DB_NAME = 'spotitnow.image-assets';
const STORE_NAME = 'image-assets';
const DB_VERSION = 1;

export const IMAGE_ASSET_PREFIX = 'idb-image:';

interface StoredImageAsset {
  id: string;
  blob: Blob;
  name: string;
  type: string;
  createdAt: number;
}

const supportsIndexedDb = () => typeof indexedDB !== 'undefined';

const blobToDataUrl = async (blob: Blob): Promise<string> =>
  await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to convert image asset to a data URL.'));
    reader.readAsDataURL(blob);
  });

const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => {
  const response = await fetch(dataUrl);
  if (!response.ok) {
    throw new Error('Failed to read embedded image asset.');
  }
  return await response.blob();
};

const openImageAssetDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('Failed to open image asset database.'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });

const hexDigest = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), (value) => value.toString(16).padStart(2, '0')).join('');

const computeBlobFingerprint = async (blob: Blob): Promise<string> => {
  const buffer = await blob.arrayBuffer();

  if (typeof crypto !== 'undefined' && crypto.subtle?.digest) {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return hexDigest(digest);
  }

  const bytes = new Uint8Array(buffer);
  let hash = 2166136261;
  for (const value of bytes) {
    hash ^= value;
    hash = Math.imul(hash, 16777619);
  }

  return `fnv-${blob.size}-${hash >>> 0}`;
};

const persistImageAsset = async (blob: Blob, name: string): Promise<string> => {
  if (!supportsIndexedDb()) {
    return await blobToDataUrl(blob);
  }

  const id = await computeBlobFingerprint(blob);
  const db = await openImageAssetDb();
  const record: StoredImageAsset = {
    id,
    blob,
    name,
    type: blob.type || 'image/png',
    createdAt: Date.now()
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to store image asset.'));
    tx.objectStore(STORE_NAME).put(record);
  });

  return `${IMAGE_ASSET_PREFIX}${id}`;
};

export const isStoredImageAssetSource = (source?: string) =>
  typeof source === 'string' && source.startsWith(IMAGE_ASSET_PREFIX);

export const isInlineImageAssetSource = (source?: string) =>
  typeof source === 'string' && source.startsWith('data:image/');

export const saveImageAssetFromBlob = async (
  blob: Blob,
  name = 'image-asset'
): Promise<string> => {
  return await persistImageAsset(blob, name);
};

export const saveImageAssetFromFile = async (file: File): Promise<string> => {
  return await persistImageAsset(file, file.name || 'image-asset');
};

export const saveImageAssetFromDataUrl = async (
  dataUrl: string,
  name = 'image-asset'
): Promise<string> => {
  return await persistImageAsset(await dataUrlToBlob(dataUrl), name);
};

export const loadImageAssetBlob = async (source: string): Promise<Blob | null> => {
  if (!source) return null;

  if (
    source.startsWith('blob:') ||
    source.startsWith('data:') ||
    source.startsWith('http')
  ) {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`Failed to fetch image asset (${response.status}).`);
    }
    return await response.blob();
  }

  if (!isStoredImageAssetSource(source) || !supportsIndexedDb()) {
    return null;
  }

  const id = source.slice(IMAGE_ASSET_PREFIX.length);
  const db = await openImageAssetDb();

  return await new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(id);
    request.onerror = () => reject(request.error ?? new Error('Failed to read image asset.'));
    request.onsuccess = () => {
      const record = request.result as StoredImageAsset | undefined;
      resolve(record?.blob ?? null);
    };
  });
};

export const exportStoredImageAssetMap = async (sources: Array<string | undefined>) => {
  const entries = await Promise.all(
    [...new Set(sources.filter((source): source is string => isStoredImageAssetSource(source)))].map(
      async (source) => {
        const blob = await loadImageAssetBlob(source);
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

export const importStoredImageAssetMap = async (assetMap?: Record<string, unknown>) => {
  const restored = new Map<string, string>();
  if (!assetMap || typeof assetMap !== 'object') {
    return restored;
  }

  const entries = Object.entries(assetMap).filter(
    (entry): entry is [string, string] =>
      typeof entry[0] === 'string' && typeof entry[1] === 'string' && entry[1].startsWith('data:image/')
  );

  for (const [originalSource, dataUrl] of entries) {
    try {
      restored.set(originalSource, await saveImageAssetFromDataUrl(dataUrl));
    } catch {
      // Skip invalid asset entries and keep the original source reference.
    }
  }

  return restored;
};

export const migrateInlineImageSource = async (
  source?: string,
  name = 'image-asset'
): Promise<string | undefined> => {
  if (!isInlineImageAssetSource(source)) {
    return source;
  }
  return await saveImageAssetFromDataUrl(source, name);
};
