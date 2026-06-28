import { load } from "cheerio";
import mammoth from "mammoth";
import { createRequire } from "module";

// Lazy loader — only called when a PDF is actually uploaded, never at server startup.
// Loads lib/pdf-parse.js directly to skip index.js, which reads a test fixture
// (./test/data/05-versions-space.pdf) that crashes the process when it doesn't exist.
function getPdfParse(): (buf: Buffer) => Promise<{ text: string }> {
  const req = createRequire(import.meta.url);
  try {
    return req("pdf-parse/lib/pdf-parse.js");
  } catch {
    return req("pdf-parse");
  }
}

const MAX_CHARS = 150_000;

function cap(text: string): string {
  if (text.length <= MAX_CHARS) return text.trim();
  return text.slice(0, MAX_CHARS).trim() + "\n\n[...document truncated at 150,000 characters]";
}

export async function extractPdf(buffer: Buffer): Promise<string> {
  const pdfParse = getPdfParse();
  const data = await pdfParse(buffer);
  return cap(data.text);
}

export async function extractDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return cap(result.value);
}

export function extractHtml(html: string): string {
  const $ = load(html);
  $("script, style, nav, header, footer, aside, iframe, noscript, [class*='ad'], [id*='ad']").remove();
  const main =
    $("article").text() ||
    $("main").text() ||
    $('[role="main"]').text() ||
    $("body").text();
  return cap(main.replace(/\s{3,}/g, "\n\n"));
}

export async function fetchUrl(url: string): Promise<{ text: string; title: string | undefined; contentType: string }> {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ThinkTank/1.0)" },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);

    const contentType = res.headers.get("content-type") ?? "";

    if (contentType.includes("application/pdf")) {
      const buf  = Buffer.from(await res.arrayBuffer());
      const text = await extractPdf(buf);
      return { text, title: undefined, contentType: "pdf" };
    }

    const raw = await res.text();

    if (contentType.includes("text/html") || raw.trimStart().startsWith("<")) {
      const $     = load(raw);
      const title = $("title").first().text().trim() || undefined;
      const text  = extractHtml(raw);
      return { text, title, contentType: "html" };
    }

    return { text: cap(raw), title: undefined, contentType: "text" };
  } finally {
    clearTimeout(timeout);
  }
}
