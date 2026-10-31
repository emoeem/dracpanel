import { useSyncExternalStore } from "react";

export interface DnsLedgerEntry {
  id: string;
  at: number;
  name: string;
  type: string;
  result: string;
  elapsedMs: number;
  source: string;
  ok: boolean;
}

const MAX_ENTRIES = 200;
const listeners = new Set<() => void>();
let entries: DnsLedgerEntry[] = [];

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): DnsLedgerEntry[] {
  return entries;
}

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function recordDnsQuery(entry: Omit<DnsLedgerEntry, "id" | "at"> & { at?: number }) {
  entries = [
    {
      ...entry,
      id: makeId(),
      at: entry.at ?? Date.now(),
    },
    ...entries,
  ].slice(0, MAX_ENTRIES);
  notify();
}

export function clearDnsLedger() {
  entries = [];
  notify();
}

export function useDnsLedger(): DnsLedgerEntry[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
