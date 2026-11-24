import type { PasteFile } from "@/api";

/** A box with no measurement still has to reserve something: 3:2 is the least wrong guess. */
export const PHOTO_FALLBACK_RATIO = "3 / 2";

/**
 * The measure a photo is displayed at. The reader's column is `--shell-narrow` at 896 minus the page
 * padding, and a phone is the viewport: the browser then picks the smallest derivative that covers it
 * at 2× (which is why 1024 is worth writing, and why the original never has to be).
 */
export const PHOTO_SIZES = "(min-width: 768px) 832px, 100vw";

export type PhotoSize = { width?: number; height?: number; thumbs?: number[] };

/**
 * The aspect ratio the box is reserved with before a single pixel arrives. Null-safe on purpose:
 * every caller has either a server-measured file or one that could not be measured at all, and both
 * must render without a layout shift.
 */
export function boxRatio(size: PhotoSize): string {
  const width = size.width ?? 0;
  const height = size.height ?? 0;
  if (width > 0 && height > 0) return `${width} / ${height}`;
  return PHOTO_FALLBACK_RATIO;
}

/**
 * The srcset, built only from derivatives the server said it wrote. An empty list means the original
 * is the only candidate, and the original is then the whole `src`.
 */
export function srcSetFor(thumbs: number[] | undefined, urlFor: (width: number) => string): string | undefined {
  if (!thumbs || thumbs.length === 0) return undefined;
  return thumbs.map((width) => `${urlFor(width)} ${width}w`).join(", ");
}

/** "4284 × 5712" — the number a person checks when they want to know how big the photo really is. */
export function pixelLabel(size: PhotoSize): string | undefined {
  if (!size.width || !size.height) return undefined;
  return `${size.width} × ${size.height}`;
}

/** How many swipes away the next photo is, for the viewer's own labels. */
export function positionLabel(index: number, total: number): string {
  return `${index + 1} / ${total}`;
}

/** A photo is the one thing on the page that is worth opening full size. */
export function isPhoto(file: Pick<PasteFile, "mime">): boolean {
  return file.mime.startsWith("image/");
}

/**
 * The shape of a picture that has never been to the server: a dropped file is measured here so the
 * draft preview reserves its box before the blob decodes. Unmeasurable (HEIC in Chrome, a truncated
 * file) answers undefined and the caller falls back.
 */
export async function measurePhoto(file: File): Promise<{ width: number; height: number } | undefined> {
  if (!file.type.startsWith("image/")) return undefined;
  try {
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(file);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return size.width > 0 && size.height > 0 ? size : undefined;
    }
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = url;
      });
      return { width: image.naturalWidth, height: image.naturalHeight };
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return undefined;
  }
}
