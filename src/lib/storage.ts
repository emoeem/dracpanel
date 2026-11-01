const BROWSER_STORAGE_PREFIX = "sing-box-dashboard.";

export interface PreferenceStorage {
  get(name: string): unknown;
  set(name: string, value: unknown): void;
  remove(name: string): void;
  subscribe(listener: (name: string) => void): () => void;
}

let preferenceStorage: PreferenceStorage | null = null;

export function configurePreferenceStorage(storage: PreferenceStorage): void {
  preferenceStorage = storage;
}

function browserStorageKey(name: string): string {
  return `${BROWSER_STORAGE_PREFIX}${name}`;
}

export function loadStoredString(name: string): string | null {
  if (preferenceStorage !== null) {
    const value = preferenceStorage.get(name);
    return typeof value === "string" ? value : null;
  }
  // localStorage throws in Safari private mode (SecurityError) and when a
  // security policy blocks it; a preference read must never break render.
  try {
    return localStorage.getItem(browserStorageKey(name));
  } catch {
    return null;
  }
}

export function saveStoredString(name: string, value: string): void {
  if (preferenceStorage !== null) {
    preferenceStorage.set(name, value);
    return;
  }
  try {
    localStorage.setItem(browserStorageKey(name), value);
  } catch {
    // Quota exceeded or storage blocked: the preference does not persist.
  }
}

export function loadStoredJson(name: string): unknown {
  if (preferenceStorage !== null) {
    return preferenceStorage.get(name) ?? null;
  }
  try {
    const raw = localStorage.getItem(browserStorageKey(name));
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function saveStoredJson(name: string, value: unknown): void {
  if (preferenceStorage !== null) {
    preferenceStorage.set(name, value);
    return;
  }
  try {
    localStorage.setItem(browserStorageKey(name), JSON.stringify(value));
  } catch {
    // Unserializable value, quota, or blocked storage: skip persistence.
  }
}

export function removeStoredValue(name: string): void {
  if (preferenceStorage !== null) {
    preferenceStorage.remove(name);
    return;
  }
  try {
    localStorage.removeItem(browserStorageKey(name));
  } catch {
    // Blocked storage: nothing to remove.
  }
}

export function watchStoredValues(listener: () => void): () => void {
  if (preferenceStorage !== null) {
    return preferenceStorage.subscribe(listener);
  }
  const handleStorage = () => listener();
  window.addEventListener("storage", handleStorage);
  return () => window.removeEventListener("storage", handleStorage);
}
