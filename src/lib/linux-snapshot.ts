// ---------------------------------------------------------------------------
// Linux VM snapshot persistence — IndexedDB-backed.
//
// The v86 emulator can serialize its full state (CPU + 128 MB RAM + devices +
// the running Alpine rootfs) into a single ArrayBuffer via `save_state()`.
// We stash that in IndexedDB so the next visit can boot the VM from the saved
// state instead of re-downloading the kernel/rootfs and re-booting Linux —
// a ~15 s cold boot becomes a ~1 s restore. Because the snapshot contains the
// live filesystem, files created inside Linux also survive across sessions.
//
// A tiny localStorage flag mirrors "a snapshot exists" so the UI can show the
// "instant boot" chip without touching IndexedDB on every render.
// ---------------------------------------------------------------------------

const DB_NAME = "zenbox";
const STORE = "kv";
const SNAPSHOT_KEY = "reallinux-snapshot";
const FLAG_KEY = "zenbox.reallinux.snap";

// Snapshots are namespaced per distro so Alpine and Debian VM states never
// mix (different kernels/rootfs/memory layouts).
const snapKey = (distro: string) => `${SNAPSHOT_KEY}:${distro}`;
const flagKey = (distro: string) => `${FLAG_KEY}.${distro}`;

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function idbPut(key: string, value: ArrayBuffer): Promise<void> {
  const db = await getDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function idbGet(key: string): Promise<ArrayBuffer | null> {
  const db = await getDB();
  return await new Promise<ArrayBuffer | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as ArrayBuffer | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbDel(key: string): Promise<void> {
  const db = await getDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** True when a snapshot was previously saved (localStorage mirror, sync). */
export function linuxSnapshotFlagged(distro: string = "alpine"): boolean {
  try {
    return localStorage.getItem(flagKey(distro)) === "1";
  } catch {
    return false;
  }
}

/** Save the current VM state so the next boot can restore it instantly. */
export async function saveLinuxSnapshot(buf: ArrayBuffer, distro: string = "alpine"): Promise<void> {
  try {
    await idbPut(snapKey(distro), buf);
    localStorage.setItem(flagKey(distro), "1");
  } catch (err) {
    console.warn("Could not persist Linux snapshot", err);
    throw err;
  }
}

/** Load a previously saved VM state, or null when none exists. */
export async function loadLinuxSnapshot(distro: string = "alpine"): Promise<ArrayBuffer | null> {
  try {
    return await idbGet(snapKey(distro));
  } catch {
    return null;
  }
}

/** Delete any saved snapshot (forces a fresh cold boot next time). */
export async function clearLinuxSnapshot(distro: string = "alpine"): Promise<void> {
  try {
    await idbDel(snapKey(distro));
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(flagKey(distro));
  } catch {
    /* ignore */
  }
}
