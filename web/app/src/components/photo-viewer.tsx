import { useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { ArrowSquareOut, CaretLeft, CaretRight, DownloadSimple, X } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";
import { boxRatio, pixelLabel, positionLabel } from "@/lib/photo";
import { bytes } from "@/lib/format";

export type ViewerPhoto = {
  /** Full resolution: the viewer exists so the photo can be read without downloading it. */
  src: string;
  name: string;
  width?: number;
  height?: number;
  size?: number;
  downloadHref?: string;
};

/**
 * The full-screen reader. A dialog rather than a new tab: the photo stays inside the app, escaping
 * to the raw file is one link away, and Esc or a tap on the backdrop comes back. The full-size image
 * is the only thing loaded here — the point is to see it, not to make a thumbnail bigger.
 */
export function PhotoViewer({
  photos,
  index,
  onClose,
  onIndex,
}: {
  photos: ViewerPhoto[];
  index: number | null;
  onClose: () => void;
  onIndex?: (next: number) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const photo = index === null ? undefined : photos[index];
  const many = photos.length > 1;

  const step = (delta: number) => {
    if (!onIndex || index === null) return;
    const next = index + delta;
    if (next < 0 || next >= photos.length) return;
    setLoaded(false);
    onIndex(next);
  };

  const meta = photo
    ? [pixelLabel(photo), photo.size ? bytes(photo.size) : undefined].filter(Boolean).join(" · ")
    : "";

  return (
    <DialogPrimitive.Root
      open={photo !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[var(--background)]" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          // The image is the reading surface: keep the browser's own pinch and pan on it, and let the
          // arrows move between attachments.
          className="fixed inset-0 z-50 flex flex-col bg-[var(--background)] outline-none"
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") {
              event.preventDefault();
              step(1);
            }
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              step(-1);
            }
          }}
        >
          <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] pl-3 pr-2">
            <DialogPrimitive.Title className="min-w-0 flex-1 truncate text-[13px] font-normal text-[var(--foreground)]">
              {photo?.name ?? "Photo"}
            </DialogPrimitive.Title>
            {meta ? (
              <span className="hidden shrink-0 text-[11px] tabular-nums text-[var(--text-3)] sm:block">{meta}</span>
            ) : null}
            {many && index !== null ? (
              <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-3)]">
                {positionLabel(index, photos.length)}
              </span>
            ) : null}
            {photo ? (
              <a
                href={photo.src}
                target="_blank"
                rel="noopener"
                aria-label="Open the original in a new tab"
                title="Open the original in a new tab"
                className="inline-grid size-8 shrink-0 place-items-center border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text-2)] no-underline transition-colors duration-150 hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
              >
                <ArrowSquareOut size={16} aria-hidden="true" />
              </a>
            ) : null}
            {photo?.downloadHref ? (
              <a
                href={photo.downloadHref}
                download={photo.name}
                aria-label={`Download ${photo.name}`}
                title={`Download ${photo.name}`}
                className="inline-grid size-8 shrink-0 place-items-center border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text-2)] no-underline transition-colors duration-150 hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
              >
                <DownloadSimple size={16} aria-hidden="true" />
              </a>
            ) : null}
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="inline-grid size-8 shrink-0 cursor-pointer place-items-center border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text-2)] transition-colors duration-150 hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </DialogPrimitive.Close>
          </header>

          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[var(--surface-2)] p-2 md:p-6">
            {loaded || !photo ? null : <span aria-hidden="true" className="m-skeleton absolute inset-0 block" />}
            {photo ? (
              <img
                key={photo.src}
                src={photo.src}
                alt={photo.name}
                width={photo.width}
                height={photo.height}
                decoding="async"
                onLoad={() => setLoaded(true)}
                style={{ aspectRatio: boxRatio(photo) }}
                className={cn(
                  "relative max-h-full max-w-full object-contain transition-opacity duration-200",
                  loaded ? "opacity-100" : "opacity-0",
                )}
              />
            ) : null}
            {many && index !== null && index > 0 ? (
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Previous photo"
                className="absolute left-2 top-1/2 grid size-9 -translate-y-1/2 cursor-pointer place-items-center border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
              >
                <CaretLeft size={16} aria-hidden="true" />
              </button>
            ) : null}
            {many && index !== null && index < photos.length - 1 ? (
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Next photo"
                className="absolute right-2 top-1/2 grid size-9 -translate-y-1/2 cursor-pointer place-items-center border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
              >
                <CaretRight size={16} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
