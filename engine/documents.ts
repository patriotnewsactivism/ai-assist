import { load } from "cheerio";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
// pdf-parse is CommonJS — must be loaded via require in an ESM project
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require("pdf-parse") as (buf: Buffer) => Promise<{ text: string }>;

const MAX_CHARS = 150_000;

function cap(text: string): string {
  if (text.length <= MAX_CHARS) return text.trim();
  return text.slice(0, MAX_CHARS).trim() + "\n\n[...document truncated at 150,000 characters]";
}

export async function extractPdf(buffer: Buffer): Promise<string> {
  const data = await pdfParse(buffer);
  return cap(data.text);
}

export async function extractDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return cap(result.value);
}

export function extractHtml(html: string): string {
  const $ = load(html);
  // Remove noise
  $("script, style, nav, header, footer, aside, iframe, noscript, [class*='ad'], [id*='ad']").remove();
  // Try main content areas first
  const main =
    $("article").text() ||
    $("main").text() ||
    $('[role="main"]').text() ||
    $("body").text();
  return cap(main.replace(/\s{3,}/g, "\n\n"));
}

export async function fetchUrl(url: string): Promise<{ text: string; title: string | undefined; contentType: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ThinkTank/1.0)" },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);

    const contentType = res.headers.get("content-type") ?? "";

    if (contentType.includes("application/pdf")) {
      const buf = Buffer.from(await res.arrayBuffer());
      const text = await extractPdf(buf);
      return { text, title: undefined, contentType: "pdf" };
    }

    const raw = await res.text();

    if (contentType.includes("text/html") || raw.trimStart().startsWith("<")) {
      const $ = load(raw);
      const title = $("title").first().text().trim() || undefined;
      const text = extractHtml(raw);
      return { text, title, contentType: "html" };
    }

    return { text: cap(raw), title: undefined, contentType: "text" };
  } finally {
    clearTimeout(timeout);
  }
}
