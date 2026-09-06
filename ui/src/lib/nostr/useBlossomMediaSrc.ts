import { useCallback, useEffect, useMemo, useState } from "react";

import { blossomMediaFallbackUrls } from "./blossom-media-fallback";

/**
 * Walk Blossom mirrors when the published kind-0 picture/banner host 502s.
 * Does not rewrite the stored kind-0 URL — display only.
 */
export function useBlossomMediaSrc(url: string | null | undefined): {
  src: string | null;
  onError: () => void;
  failed: boolean;
} {
  const candidates = useMemo(() => blossomMediaFallbackUrls(url), [url]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [url]);

  const src = candidates[index] || null;
  const failed = candidates.length === 0 || index >= candidates.length;

  const onError = useCallback(() => {
    setIndex((i) => i + 1);
  }, []);

  return { src: failed ? null : src, onError, failed };
}
