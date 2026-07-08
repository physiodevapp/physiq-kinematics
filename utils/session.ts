import type { KinematicsPayload } from "@/interfaces/kinematics";

const SESSION_TTL = 24 * 60 * 60 * 1000;

export interface SessionRecord {
  sessionId: number;
  createdAt: number;
  updatedAt: number;
  date: string;
  patient: string;
  diagnosis: string | null;
  manualRegion: string | null;
  rom: unknown;
  assessmentState: unknown;
  assessment: unknown;
  force: unknown[] | null;
  questionnaires: unknown[] | null;
  kinematics: KinematicsPayload[] | null;
}

function openSessionDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("physiq", 3);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains("audio")) db.createObjectStore("audio");
      if (!db.objectStoreNames.contains("session")) db.createObjectStore("session");
    };
    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror = (e) => reject((e.target as IDBOpenDBRequest).error);
  });
}

export function readSession(): Promise<SessionRecord | null> {
  return openSessionDB()
    .then(
      (db) =>
        new Promise<SessionRecord | null>((resolve) => {
          const tx = db.transaction("session", "readonly");
          const req = tx.objectStore("session").get("active");
          req.onsuccess = () => {
            const s = req.result as SessionRecord | undefined;
            if (!s || Date.now() - s.createdAt > SESSION_TTL) return resolve(null);
            resolve(s);
          };
          req.onerror = () => resolve(null);
        }),
    )
    .catch(() => null);
}

export function writeSession(patch: Partial<SessionRecord>): Promise<SessionRecord | null> {
  return openSessionDB()
    .then(
      (db) =>
        new Promise<SessionRecord | null>((resolve, reject) => {
          const tx = db.transaction("session", "readwrite");
          const store = tx.objectStore("session");
          const req = store.get("active");
          req.onsuccess = () => {
            const now = Date.now();
            const prev = req.result as SessionRecord | undefined;
            const base = prev && now - prev.createdAt <= SESSION_TTL ? prev : null;
            const next: SessionRecord = base
              ? { ...base, ...patch, updatedAt: now }
              : {
                  sessionId: now,
                  createdAt: now,
                  updatedAt: now,
                  patient: "",
                  date: new Date().toLocaleDateString("es-ES"),
                  diagnosis: null,
                  manualRegion: null,
                  rom: null,
                  assessmentState: null,
                  assessment: null,
                  force: null,
                  questionnaires: null,
                  kinematics: null,
                  ...patch,
                };
            store.put(next, "active");
            tx.oncomplete = () => resolve(next);
            tx.onerror = () => reject();
          };
          req.onerror = () => reject();
        }),
    )
    .catch(() => null);
}

export function clearSession(): Promise<void> {
  return openSessionDB()
    .then(
      (db) =>
        new Promise<void>((resolve) => {
          const tx = db.transaction("session", "readwrite");
          tx.objectStore("session").delete("active");
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        }),
    )
    .catch(() => undefined);
}
