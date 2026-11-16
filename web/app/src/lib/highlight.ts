import type { LanguageId } from "./language";

const KEYWORDS: Record<string, string[]> = {
  typescript: "const let var function return if else for while import export from type interface enum class extends implements new async await throw try catch switch case break continue default void string number boolean unknown never any null undefined true false as of satisfies".split(
    " ",
  ),
  javascript: "const let var function return if else for while import export from class extends new async await throw try catch switch case break continue default null undefined true false typeof instanceof".split(
    " ",
  ),
  python: "def class return if elif else for while import from as with try except finally raise yield lambda pass break continue and or not in is None True False async await global nonlocal assert".split(
    " ",
  ),
  go: "package import func return if else for range go defer select case switch break continue type struct interface map chan var const nil true false error string int int64 bool byte".split(
    " ",
  ),
  shell: "if then else fi for while do done case esac function return export local readonly echo cd set printf read".split(
    " ",
  ),
  json: [],
  html: [],
  text: [],
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Near-monochrome highlighting: comments and strings carry the only colour; keywords are ink and
 * numbers the muted voice. The scan runs on raw text and every emitted slice is escaped, so a paste
 * containing markup can never become markup.
 *
 * `#` starts a comment only in python/shell — in TypeScript it is a private field or a hex colour.
 */
export function highlight(code: string, language: LanguageId | string): string {
  const kw = new Set(KEYWORDS[language] ?? []);
  const comment =
    language === "python" || language === "shell"
      ? "#[^\\n]*|//[^\\n]*|/\\*[\\s\\S]*?\\*/"
      : "//[^\\n]*|/\\*[\\s\\S]*?\\*/";
  const master = new RegExp(
    "(" +
      comment +
      ")" +
      "|(\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*'|`(?:[^`\\\\]|\\\\.)*`)" +
      "|(\\n)" +
      "|\\b(\\d+(?:\\.\\d+)?)\\b" +
      "|\\b([A-Za-z_$][\\w$]*)\\b",
    "g",
  );
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = master.exec(code))) {
    out += esc(code.slice(last, m.index));
    const [whole, commentText, str, brk, num, ident] = m;
    if (commentText) out += `<span class="tk-c">${esc(whole)}</span>`;
    else if (str) out += `<span class="tk-s">${esc(whole)}</span>`;
    else if (brk) out += "\n";
    else if (num) out += `<span class="tk-n">${esc(whole)}</span>`;
    else if (ident && kw.has(ident)) out += `<span class="tk-k">${esc(whole)}</span>`;
    else out += esc(whole);
    last = m.index + whole.length;
  }
  out += esc(code.slice(last));
  return out;
}
