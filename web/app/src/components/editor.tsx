import { useEffect, useRef } from "react";

import { highlight } from "@/lib/highlight";
import type { LanguageId } from "@/lib/language";

/**
 * A transparent textarea over a highlighted mirror, with a line-number gutter. Wrapping and the
 * gutter are mutually exclusive — a wrapped line has no single row to number — so wrap hides it.
 */
export function Editor({
  id,
  value,
  onChange,
  language,
  wrap,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  language: LanguageId | string;
  wrap: boolean;
}) {
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const lines = value === "" ? 1 : value.split("\n").length;
  const numbers = Array.from({ length: Math.min(lines, 20_000) }, (_, i) => i + 1).join("\n");

  useEffect(() => {
    const source = sourceRef.current;
    if (!source) return;
    const sync = () => {
      if (mirrorRef.current) {
        mirrorRef.current.scrollTop = source.scrollTop;
        mirrorRef.current.scrollLeft = source.scrollLeft;
      }
      if (gutterRef.current) gutterRef.current.scrollTop = source.scrollTop;
    };
    source.addEventListener("scroll", sync, { passive: true });
    return () => source.removeEventListener("scroll", sync);
  }, []);

  return (
    <div className="ed-body" data-wrap={wrap ? "on" : "off"}>
      <div ref={gutterRef} className="ed-gutter" aria-hidden="true">
        {numbers}
      </div>
      <div className="ed-pane">
        <pre
          ref={mirrorRef}
          className="ed-hl"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: `${highlight(value, language)}\n` }}
        />
        <textarea
          ref={sourceRef}
          id={id}
          className="ed-src"
          value={value}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder="Paste or type…"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Tab") return;
            event.preventDefault();
            const target = event.currentTarget;
            const start = target.selectionStart;
            const end = target.selectionEnd;
            const next = `${value.slice(0, start)}  ${value.slice(end)}`;
            onChange(next);
            requestAnimationFrame(() => {
              target.selectionStart = target.selectionEnd = start + 2;
            });
          }}
        />
      </div>
    </div>
  );
}
