import { createContext, useContext, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";

export type LiveEvent = {
  type: "paste.created" | "paste.updated" | "paste.deleted" | "paste.purged";
  slug?: string;
  at: number;
};

type LiveState = { connected: boolean; last: LiveEvent | null };

export const LiveContext = createContext<LiveState>({ connected: false, last: null });

export function useLive() {
  return useContext(LiveContext);
}

/**
 * One SSE stream for the whole app. The sink route never opens it: the conformance harness
 * navigates with `networkidle`, which a live EventSource never reaches.
 */
export function useLiveEvents(allow = true): LiveState {
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const enabled = allow && pathname !== "/ui";
  const [connected, setConnected] = useState(false);
  const [last, setLast] = useState<LiveEvent | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const source = new EventSource("/api/v1/events");

    source.addEventListener("ready", () => setConnected(true));
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);

    const types: LiveEvent["type"][] = [
      "paste.created",
      "paste.updated",
      "paste.deleted",
      "paste.purged",
    ];
    const handlers = types.map((type) => {
      const handler = (event: MessageEvent) => {
        let data: LiveEvent = { type, at: Date.now() / 1000 };
        try {
          data = JSON.parse(event.data) as LiveEvent;
        } catch {
          /* keep the type */
        }
        setLast(data);
        queryClient.invalidateQueries({ queryKey: ["pastes"] });
        if (data.slug) {
          if (data.type === "paste.deleted") {
            queryClient.removeQueries({ queryKey: ["paste", data.slug] });
          } else {
            queryClient.invalidateQueries({ queryKey: ["paste", data.slug] });
          }
        }
      };
      source.addEventListener(type, handler);
      return [type, handler] as const;
    });

    return () => {
      for (const [type, handler] of handlers) source.removeEventListener(type, handler);
      source.close();
      setConnected(false);
    };
  }, [enabled, queryClient]);

  return { connected, last };
}
