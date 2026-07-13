import { load, type Store } from "@tauri-apps/plugin-store";

let storePromise: Promise<Store> | null = null;

/** Lazily-loaded persistent store (moorix.json). */
export function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = load("moorix.json");
  }
  return storePromise;
}

/** Set a key and persist immediately. */
export async function setValue<T>(key: string, value: T): Promise<void> {
  const store = await getStore();
  await store.set(key, value);
  await store.save();
}
