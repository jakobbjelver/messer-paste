import { FileText, ImageSquare, Trash } from "@phosphor-icons/react";

import { api } from "@/api";
import { bytes } from "@/lib/format";
import type { DraftFile } from "@/hooks/use-draft";

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

export function Attachments({
  files,
  slug,
  onRemove,
}: {
  files: DraftFile[];
  slug?: string;
  onRemove: (key: string) => void;
}) {
  if (files.length === 0) return null;

  return (
    <div className="grid gap-2">
      {files.map((file) => {
        const src = file.url ?? (slug && file.id ? api.fileUrl(slug, file.id) : undefined);
        const isImage = file.mime.startsWith("image/");
        return (
          <figure
            key={file.key}
            className="m-0 grid overflow-hidden border border-[var(--border)] bg-[var(--surface-2)]"
          >
            {isImage && src ? (
              <img
                src={src}
                alt={file.name}
                className="max-h-[420px] w-full object-contain"
                loading="lazy"
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
                <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-[var(--text-3)]">
                  {file.name}
                </span>
              ) : null}
              <span className="ml-auto shrink-0 font-mono text-[10.5px] text-[var(--text-3)]">
                {bytes(file.size)}
              </span>
              <RemoveButton name={file.name} onClick={() => onRemove(file.key)} />
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}
