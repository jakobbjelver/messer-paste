import { useQuery } from "@tanstack/react-query";

import { api } from "@/api";

/**
 * The same bundle is served from the private host and the public reader, so the app cannot tell
 * which it is from the build. The server answers that question, once per page load.
 */
export function useConfig() {
  return useQuery({
    queryKey: ["config"],
    queryFn: api.config,
    staleTime: Infinity,
    retry: 1,
  });
}

export function useIsPublicHost(): boolean {
  const { data } = useConfig();
  if (!data?.public_host) return false;
  return data.public_host.toLowerCase() === window.location.host.toLowerCase();
}

/** The link a share copies: the public host for a public paste, otherwise where the app runs. */
export function useShareBase(): string {
  const { data } = useConfig();
  if (!data?.public_host) return window.location.origin;
  return `${window.location.protocol}//${data.public_host}`;
}
