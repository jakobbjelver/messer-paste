export type LanguageId =
  | "auto"
  | "typescript"
  | "javascript"
  | "python"
  | "go"
  | "json"
  | "html"
  | "shell"
  | "text";

export const LANGUAGES: Array<{ id: LanguageId; label: string }> = [
  { id: "auto", label: "Auto" },
  { id: "typescript", label: "TypeScript" },
  { id: "javascript", label: "JavaScript" },
  { id: "python", label: "Python" },
  { id: "go", label: "Go" },
  { id: "json", label: "JSON" },
  { id: "html", label: "HTML" },
  { id: "shell", label: "Shell" },
  { id: "text", label: "Plain text" },
];

const EXT: Record<string, LanguageId> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  py: "python",
  go: "go",
  json: "json",
  html: "html",
  htm: "html",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  txt: "text",
  md: "text",
};

/** Stable label the rail prints. `auto` resolves to what the detector saw. */
export function languageLabel(id: string): string {
  return LANGUAGES.find((l) => l.id === id)?.label ?? "Plain text";
}

export function detectLanguage(text: string, filename?: string): LanguageId {
  if (filename) {
    const ext = filename.split(".").pop()?.toLowerCase();
    if (ext && EXT[ext]) return EXT[ext];
  }
  const head = text.trimStart().slice(0, 4000);
  if (!head) return "text";
  if (head.startsWith("#!")) return head.includes("python") ? "python" : "shell";
  if (/^\s*[[{]/.test(head)) {
    try {
      JSON.parse(text);
      return "json";
    } catch {
      /* not JSON */
    }
  }
  if (/^\s*(<!doctype html|<html|<div|<section)/i.test(head)) return "html";
  if (/^\s*(package |func |import \(|type \w+ struct)/m.test(head)) return "go";
  if (/^\s*(def |class |from \w+ import|import \w+$)/m.test(head)) return "python";
  if (/\b(interface|type|enum)\s+\w+|:\s*(string|number|boolean)\b|=>/.test(head))
    return "typescript";
  if (/\b(function|const|let|var)\b/.test(head)) return "javascript";
  return "text";
}
