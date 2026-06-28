export interface ParsedFile {
  path: string;
  content: string;
}

// Extracts files from synthesis output using the === FILE: path === delimiter format.
// Also handles common markdown header + code block patterns as fallback.
export function parseFilesFromOutput(text: string): ParsedFile[] {
  const files: ParsedFile[] = [];
  const seen = new Set<string>();

  // Primary: === FILE: path/to/file.ts ===\n```lang\ncontent\n```
  const primaryPattern = /===\s*FILE:\s*([^\s=\n][^\n=]*?)\s*===\s*\n```(?:[a-z0-9]*)\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;

  while ((match = primaryPattern.exec(text)) !== null) {
    const path = match[1]!.trim();
    const content = match[2]!.trimEnd();
    if (path && content && !seen.has(path)) {
      seen.add(path);
      files.push({ path, content });
    }
  }

  // Fallback: markdown header immediately before a fenced code block
  // Matches: ### `src/file.ts` or ### src/file.ts or **`src/file.ts`**
  if (files.length === 0) {
    const mdPattern =
      /(?:^|\n)(?:#{1,4}\s*`?([a-zA-Z0-9_.\-/]+\.[a-zA-Z]{1,10})`?|`([a-zA-Z0-9_.\-/]+\.[a-zA-Z]{1,10})`\s*:?)\s*\n```(?:[a-z0-9]*)\n([\s\S]*?)```/gm;

    while ((match = mdPattern.exec(text)) !== null) {
      const path = (match[1] ?? match[2] ?? "").trim();
      const content = (match[3] ?? "").trimEnd();
      if (path && content && !seen.has(path) && isValidPath(path)) {
        seen.add(path);
        files.push({ path, content });
      }
    }
  }

  return files;
}

function isValidPath(p: string): boolean {
  return /^[a-zA-Z0-9_.\-/]+\.[a-zA-Z]{1,12}$/.test(p) && !p.startsWith("/") && p.length < 200;
}
