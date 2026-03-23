export type RecentFileKind = "opened" | "manual-save" | "auto-save";

export type RecentFileSnapshotMeta = {
  id: string;
  name: string;
  kind: RecentFileKind;
  savedAt: number;
  size: number;
  mimeType: string;
};

type RecentFileSnapshotRecord = RecentFileSnapshotMeta & {
  blob: Blob;
};

const DB_NAME = "hwpx-studio-local";
const STORE_NAME = "recent-file-snapshots";
const DB_VERSION = 1;
const MAX_RECENT_ENTRIES = 30;

function canUseIndexedDb(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
    tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!canUseIndexedDb()) {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Failed to open IndexedDB"));
  });
}

function toMeta(record: RecentFileSnapshotRecord): RecentFileSnapshotMeta {
  return {
    id: record.id,
    name: record.name,
    kind: record.kind,
    savedAt: record.savedAt,
    size: record.size,
    mimeType: record.mimeType,
  };
}

export async function listRecentFileSnapshots(): Promise<RecentFileSnapshotMeta[]> {
  if (!canUseIndexedDb()) {
    return [];
  }
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const records = await requestToPromise(store.getAll() as IDBRequest<RecentFileSnapshotRecord[]>);
    await txDone(tx);
    return records
      .map((record) => toMeta(record))
      .sort((a, b) => b.savedAt - a.savedAt);
  } finally {
    db.close();
  }
}

export async function loadRecentFileSnapshot(
  id: string,
): Promise<{ meta: RecentFileSnapshotMeta; blob: Blob } | null> {
  if (!canUseIndexedDb()) {
    return null;
  }
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const record = await requestToPromise(
      store.get(id) as IDBRequest<RecentFileSnapshotRecord | undefined>,
    );
    await txDone(tx);
    if (!record) {
      return null;
    }
    return {
      meta: toMeta(record),
      blob: record.blob,
    };
  } finally {
    db.close();
  }
}

export async function saveRecentFileSnapshot(params: {
  name: string;
  blob: Blob;
  kind: RecentFileKind;
}): Promise<RecentFileSnapshotMeta | null> {
  if (!canUseIndexedDb()) {
    return null;
  }

  const now = Date.now();
  const id = `${now}-${Math.random().toString(36).slice(2, 8)}`;
  const record: RecentFileSnapshotRecord = {
    id,
    name: params.name,
    kind: params.kind,
    savedAt: now,
    size: params.blob.size,
    mimeType: params.blob.type || "application/octet-stream",
    blob: params.blob,
  };

  const db = await openDb();
  try {
    {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put(record);
      await txDone(tx);
    }

    {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const all = await requestToPromise(store.getAll() as IDBRequest<RecentFileSnapshotRecord[]>);
      const staleIds = all
        .sort((a, b) => b.savedAt - a.savedAt)
        .slice(MAX_RECENT_ENTRIES)
        .map((row) => row.id);
      for (const staleId of staleIds) {
        store.delete(staleId);
      }
      await txDone(tx);
    }

    return toMeta(record);
  } finally {
    db.close();
  }
}
