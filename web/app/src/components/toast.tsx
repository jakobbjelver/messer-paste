import { useSyncExternalStore } from "react";

type Item = { id: number; text: string };

let items: Item[] = [];
let seq = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function toast(text: string) {
  const id = ++seq;
  items = [...items, { id, text }];
  emit();
  window.setTimeout(() => {
    items = items.filter((item) => item.id !== id);
    emit();
  }, 2400);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => items;

/** Bottom-right, 36px, one line, mono. The only transient in the app. */
export function Toaster() {
  const list = useSyncExternalStore(subscribe, snapshot, snapshot);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 grid gap-2" aria-live="polite">
      {list.map((item) => (
        <div
          key={item.id}
          className="flex h-9 items-center border border-[var(--border-strong)] bg-[var(--surface)] px-3 font-mono text-xs text-[var(--foreground)] shadow-[var(--shadow-pop)]"
        >
          {item.text}
        </div>
      ))}
    </div>
  );
}
