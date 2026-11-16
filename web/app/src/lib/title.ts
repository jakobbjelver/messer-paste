/**
 * The client mirror of the server's DeriveTitle, used only to show the user what the paste will be
 * called before it is saved. The server's value always wins; if these disagree, the server is right.
 */
export function deriveTitle(
  text: string,
  files: Array<{ name: string; mime: string }>,
): string {
  const first = firstLine(text);
  if (first && files.length === 0) return first;
  if (first) return `${first} + ${filePhrase(files)}`;
  if (files.length === 1) return clip(files[0].name);
  if (files.length > 1) return filePhrase(files);
  return "Untitled paste";
}

function firstLine(text: string): string {
  for (const raw of text.split("\n")) {
    // The dash must stay last: `[#>*-`]` is a RANGE from * to backtick, which is A-Z.
    const line = raw.trim().replace(/^[#>*`\s-]+/, "").replace(/\s+/g, " ").trim();
    if (line) return clip(line);
  }
  return "";
}

function clip(value: string): string {
  if (value.length <= 64) return value;
  const cut = value.slice(0, 64);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 48 ? cut.slice(0, lastSpace) : cut).replace(/[ ,.;:]+$/, "")}…`;
}

function filePhrase(files: Array<{ mime: string }>): string {
  const images = files.filter((file) => file.mime.startsWith("image/")).length;
  const others = files.length - images;
  if (images > 0 && others > 0) return `${plural(images, "image")}, ${plural(others, "file")}`;
  if (images > 0) return plural(images, "image");
  return plural(others, "file");
}

function plural(n: number, word: string): string {
  return n === 1 ? `1 ${word}` : `${n} ${word}s`;
}

/** Shorter than the stored title, so the placeholder never clips mid-word in the field. */
export function previewTitle(text: string, files: Array<{ name: string; mime: string }>): string {
  const full = deriveTitle(text, files);
  if (full.length <= 46) return full;
  const cut = full.replace(/…$/, "").slice(0, 46);
  const space = cut.lastIndexOf(" ");
  return `${(space > 32 ? cut.slice(0, space) : cut).replace(/[ ,.;:]+$/, "")}…`;
}
