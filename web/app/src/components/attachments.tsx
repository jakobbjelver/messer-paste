import { useState } from "react";
import { FileText, ImageSquare, Trash } from "@phosphor-icons/react";

import { api } from "@/api";
import { bytes } from "@/lib/format";
import { srcSetFor } from "@/lib/photo";
import type { DraftFile } from "@/hooks/use-draft";
import { Photo } from "@/components/photo";
import { PhotoViewer, type ViewerPhoto } from "@/components/photo-viewer";

function RemoveButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Remove ${name}`}
      onClick={onClick}
      className="ml-1 inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center text-[var(--text-3)] hover:bg-[var(--surface-2)] hover:text-[var(--destructive)]"
    >
      <Trash size={14} aria-hidden="true" />
    </button>
  );
}

/** The draft's attachments. A photo previews in its own reserved box and opens full size — checking
 * what was attached is the same gesture as reading it after it is saved. */
export function Attachments({
  files,
  slug,
  onRemove,
}: {
  files: DraftFile[];
  slug?: string;
  onRemove: (key: string) => void;
}) {
  const [viewer, setViewer] = useState<number | null>(null);
  if (files.length === 0) return null;

  const srcOf = (file: DraftFile) => file.url ?? (slug && file.id ? api.fileUrl(slug, file.id) : undefined);
  const photos: ViewerPhoto[] = files
    .filter((file) => file.mime.startsWith("image/"))
    .map((file) => ({
      src: srcOf(file) ?? "",
      name: file.name,
      width: file.width,
      height: file.height,
      size: file.size,
    }));

  let photoIndex = -1;

  return (
    <>
      <div className="grid gap-2">
        {files.map((file) => {
          const src = srcOf(file);
          const isImage = file.mime.startsWith("image/");
          const index = isImage ? ++photoIndex : -1;
          return (
            <figure
              key={file.key}
              className="m-0 grid overflow-hidden border border-[var(--border)] bg-[var(--surface-2)]"
            >
              {isImage && src ? (
                <Photo
                  src={src}
                  srcSet={
                    !file.url && file.id && slug
                      ? srcSetFor(file.thumbs, (width) => api.thumbUrl(slug, file.id!, width))
                      : undefined
                  }
                  name={file.name}
                  width={file.width}
                  height={file.height}
                  onOpen={() => setViewer(index)}
                />
              ) : (
                <span className="flex items-center gap-3 px-3 py-3">
                  <span className="grid size-8 place-items-center border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text-2)]">
                    {isImage ? (
                      <ImageSquare size={16} aria-hidden="true" />
                    ) : (
                      <FileText size={16} aria-hidden="true" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-[var(--foreground)]">
                    {file.name}
                  </span>
                </span>
              )}
              <figcaption className="flex h-8 items-center gap-2 border-t border-[var(--border)] bg-[var(--surface)] px-2">
                {isImage ? (
                  <span className="min-w-0 flex-1 truncate text-[10.5px] tabular-nums text-[var(--text-3)]">
                    {file.name}
                  </span>
                ) : null}
                <span className="ml-auto shrink-0 text-[10.5px] tabular-nums text-[var(--text-3)]">
                  {bytes(file.size)}
                </span>
                <RemoveButton name={file.name} onClick={() => onRemove(file.key)} />
              </figcaption>
            </figure>
          );
        })}
      </div>
      <PhotoViewer photos={photos} index={viewer} onClose={() => setViewer(null)} onIndex={setViewer} />
    </>
  );
}
