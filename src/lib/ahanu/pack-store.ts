/**
 * IndexedDB pack object store. Falls back to memory when IDB is missing
 * (SSR / Node tests).
 */

import type { TripPackManifestV1 } from "./pack";

const DB_NAME = "ahanu-packs";
const DB_VERSION = 1;

export interface StoredObject {
  r2Key: string;
  layerId: string;
  packId: string;
  hash: string;
  contentType: string;
  body: string;
  storedAt: string;
}

export interface StoredPackState {
  packId: string;
  manifest: TripPackManifestV1;
  savedAt: string;
}

type MemoryDb = {
  objects: Map<string, StoredObject>;
  manifests: Map<string, StoredPackState>;
  current: string | null;
};

const memory: MemoryDb = {
  objects: new Map(),
  manifests: new Map(),
  current: null,
};

function hasIdb(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("objects")) {
        db.createObjectStore("objects", { keyPath: "r2Key" });
      }
      if (!db.objectStoreNames.contains("manifests")) {
        db.createObjectStore("manifests", { keyPath: "packId" });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteObject(r2Key: string): Promise<void> {
  memory.objects.delete(r2Key);
  if (!hasIdb()) return;
  const db = await openDb();
  const tx = db.transaction("objects", "readwrite");
  await idbReq(tx.objectStore("objects").delete(r2Key));
  db.close();
}

export async function putObject(obj: StoredObject): Promise<void> {
  const extras = (await listObjects(obj.packId)).filter(
    (row) => row.layerId === obj.layerId && row.r2Key !== obj.r2Key,
  );
  memory.objects.set(obj.r2Key, obj);
  for (const old of extras) memory.objects.delete(old.r2Key);
  if (!hasIdb()) return;
  const db = await openDb();
  const tx = db.transaction("objects", "readwrite");
  await idbReq(tx.objectStore("objects").put(obj));
  for (const old of extras) {
    await idbReq(tx.objectStore("objects").delete(old.r2Key));
  }
  db.close();
}

export async function getObject(r2Key: string): Promise<StoredObject | undefined> {
  if (hasIdb()) {
    const db = await openDb();
    const tx = db.transaction("objects", "readonly");
    const row = await idbReq(tx.objectStore("objects").get(r2Key) as IDBRequest<StoredObject | undefined>);
    db.close();
    if (row) {
      memory.objects.set(r2Key, row);
      return row;
    }
  }
  return memory.objects.get(r2Key);
}

export async function listObjects(packId: string): Promise<StoredObject[]> {
  if (hasIdb()) {
    const db = await openDb();
    const tx = db.transaction("objects", "readonly");
    const all = await idbReq(tx.objectStore("objects").getAll() as IDBRequest<StoredObject[]>);
    db.close();
    return (all ?? []).filter((o) => o.packId === packId);
  }
  return [...memory.objects.values()].filter((o) => o.packId === packId);
}

export async function saveManifest(manifest: TripPackManifestV1): Promise<void> {
  const row: StoredPackState = {
    packId: manifest.packId,
    manifest,
    savedAt: new Date().toISOString(),
  };
  memory.manifests.set(manifest.packId, row);
  memory.current = manifest.packId;
  if (!hasIdb()) return;
  const db = await openDb();
  const tx = db.transaction(["manifests", "meta"], "readwrite");
  await idbReq(tx.objectStore("manifests").put(row));
  await idbReq(tx.objectStore("meta").put({ id: "current", packId: manifest.packId }));
  db.close();
}

export async function loadCurrentManifest(): Promise<TripPackManifestV1 | null> {
  if (hasIdb()) {
    const db = await openDb();
    const metaTx = db.transaction("meta", "readonly");
    const meta = await idbReq(metaTx.objectStore("meta").get("current") as IDBRequest<{ packId?: string } | undefined>);
    const packId = meta?.packId ?? memory.current;
    if (!packId) {
      db.close();
      return null;
    }
    const mTx = db.transaction("manifests", "readonly");
    const row = await idbReq(mTx.objectStore("manifests").get(packId) as IDBRequest<StoredPackState | undefined>);
    db.close();
    return row?.manifest ?? null;
  }
  if (!memory.current) return null;
  return memory.manifests.get(memory.current)?.manifest ?? null;
}

export async function bodiesForPack(packId: string): Promise<Record<string, string>> {
  const objs = await listObjects(packId);
  const out: Record<string, string> = {};
  for (const o of objs) out[o.layerId] = o.body;
  return out;
}

/** Test helper — wipe memory (does not drop IDB). */
export function resetPackMemory(): void {
  memory.objects.clear();
  memory.manifests.clear();
  memory.current = null;
}

/** Test helper — extra IDB row without replacing the current layer. */
export function seedObjectMemory(obj: StoredObject): void {
  memory.objects.set(obj.r2Key, obj);
}
