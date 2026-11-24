import { useState } from "react";

import { cn } from "@/lib/utils";
import { boxRatio, PHOTO_SIZES } from "@/lib/photo";

export type PhotoProps = {
  /** The full-size (or in-app) source. The srcset is what the browser actually picks from. */
  src: string;
  srcSet?: string;
  name: string;
  width?: number;
  height?: number;
  /** Opening is the point of a photo; without a handler it is just a picture. */
  onOpen?: () => void;
  /** The first photo on a page is the one being read: it must not wait for a scroll margin. */
  eager?: boolean;
  className?: string;
};

/**
 * A photo in a reserved box. The size the server measured sets `aspect-ratio`, so the figure is the
 * right height before any byte arrives, the skeleton fills that box, and the pixels fade in over it.
 * Without a measurement it falls back to a 3:2 box: still no shift, just letterboxed.
 */
export function Photo({ src, srcSet, name, width, height, onOpen, eager, className }: PhotoProps) {
  const [loaded, setLoaded] = useState(false);
  const ratio = boxRatio({ width, height });

  const picture = (
    <>
      {loaded ? null : <span aria-hidden="true" className="m-skeleton absolute inset-0 block" />}
      <img
        src={src}
        srcSet={srcSet}
        sizes={srcSet ? PHOTO_SIZES : undefined}
        alt={name}
        width={width}
        height={height}
        loading={eager ? "eager" : "lazy"}
        fetchPriority={eager ? "high" : undefined}
        decoding="async"
        onLoad={() => setLoaded(true)}
        className={cn(
          "absolute inset-0 block h-full w-full object-contain transition-opacity duration-200",
          loaded ? "opacity-100" : "opacity-0",
        )}
      />
    </>
  );

  const box = cn("relative block w-full max-h-[420px] bg-[var(--surface-2)]", className);
  const style = { aspectRatio: ratio };

  if (!onOpen) {
    return (
      <div className={box} style={style}>
        {picture}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${name} full size`}
      style={style}
      className={cn(box, "cursor-zoom-in outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]")}
    >
      {picture}
    </button>
  );
}
