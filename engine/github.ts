import { Readable } from "stream";
import { createGunzip } from "zlib";
import tar from "tar-stream";

const GITHUB_API = "https://api.github.com";

export interface RepoFile {
  path: string;
  content: string;
}

export interface RepoManifestEntry {
  path: string;
  size: number;
  included: boolean;
  reason?: string; // why excluded: "too_large", "binary", "excluded_dir"
}

export function parseRepoUrl(url: string): { owner: string; repo: string } | null {
  const match = url.match(/github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/#?\s]|$)/);
  if (!match) return null;
  return { owner: match[1]!, repo: match[2]! };
}

async function ghRequest(path: string, token?: string, options?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "ai-think-tank",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const optHeaders = (options?.headers as Record<string, string>) ?? {};
  return fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: { ...headers, ...optHeaders },
  });
}

const RELEVANT_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".cs", ".cpp", ".c", ".h",
  ".rb", ".php", ".swift", ".kt", ".scala", ".ex", ".exs",
  ".md", ".mdx", ".txt",
  ".json", ".yaml", ".yml", ".toml", ".ini",
  ".sql", ".graphql", ".proto",
  ".sh", ".bash",
  ".css", ".scss", ".less",
  ".html", ".htm", ".svelte", ".vue",
  ".env.example", ".gitignore", ".dockerignore",
  ".xml", ".cfg", ".conf", ".properties",
  ".r", ".R", ".jl", ".lua", ".pl", ".pm",
  ".tf", ".hcl", // Terraform
  ".prisma", // Prisma schema
  ".graphql", ".gql",
]);

const EXCLUDE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".nuxt",
  ".cache", "vendor", "__pycache__", ".venv", "venv",
  "coverage", ".nyc_output", "target", "out", ".turbo",
  ".terraform", ".gradle", "bin", "obj",
  ".idea", ".vscode", ".vs",
  "bower_components", "jspm_packages",
  ".parcel-cache", ".svelte-kit",
  "eggs", ".eggs", "*.egg-info",
]);

const IMPORTANT_FILES = new Set([
  "package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
  "cargo.toml", "cargo.lock", "go.mod", "go.sum",
  "requirements.txt", "pyproject.toml", "setup.py", "setup.cfg", "pipfile",
  "gemfile", "gemfile.lock",
  "dockerfile", "docker-compose.yml", "docker-compose.yaml",
  "makefile", "rakefile", "justfile",
  "readme.md", "readme.rst", "readme.txt", "readme",
  "license", "license.md", "license.txt",
  ".env.example", ".env.sample",
  "tsconfig.json", "jsconfig.json", "babel.config.js", "babel.config.json",
  ".eslintrc.js", ".eslintrc.json", ".eslintrc.yml", "eslint.config.js",
  ".prettierrc", ".prettierrc.json", ".prettierrc.js",
  "vite.config.ts", "vite.config.js", "webpack.config.js", "rollup.config.js",
  "next.config.js", "next.config.mjs", "nuxt.config.ts",
  "tailwind.config.js", "tailwind.config.ts", "postcss.config.js",
  "jest.config.js", "jest.config.ts", "vitest.config.ts",
  ".github/workflows", "ci.yml", "deploy.yml",
  "agents.md", "claude.md",
  "prisma/schema.prisma",
  "railway.toml", "render.yaml", "vercel.json", "netlify.toml",
  "procfile", "nixpacks.toml",
]);

const BINARY_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp", ".avif",
  ".mp3", ".mp4", ".wav", ".ogg", ".webm",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".exe", ".dll", ".so", ".dylib", ".o", ".a",
  ".pyc", ".pyo", ".class", ".jar", ".war",
  ".db", ".sqlite", ".sqlite3",
  ".lock", // large lock files are noise
]);

// ── Limits ──
const MAX_FILES = 500;
const MAX_CHARS = 2_000_000; // 2MB of text context
const MAX_SINGLE_FILE_CHARS = 250_000; // 250KB per file

function isExcludedDir(pathPart: string): boolean {
  return EXCLUDE_DIRS.has(pathPart.toLowerCase());
}

function isBinaryExt(ext: string): boolean {
  return BINARY_EXTS.has(ext.toLowerCase());
}

function isRelevantFile(filePath: string): boolean {
  const parts = filePath.toLowerCase().split("/");
  const base = parts[parts.length - 1] ?? "";
  const dotIdx = base.lastIndexOf(".");
  const ext = dotIdx >= 0 ? base.slice(dotIdx) : "";

  // Check important files by base name
  if (IMPORTANT_FILES.has(base)) return true;

  // Check extension
  if (RELEVANT_EXTS.has(ext)) return true;

  // Dotfiles that are config (e.g., .babelrc, .npmrc)
  if (base.startsWith(".") && !isBinaryExt(ext) && base.length < 30) return true;

  return false;
}

function getFileExt(filePath: string): string {
  const dotIdx = filePath.lastIndexOf(".");
  return dotIdx >= 0 ? filePath.slice(dotIdx).toLowerCase() : "";
}

// Priority scoring — lower = more important
function filePriority(filePath: string): number {
  const parts = filePath.split("/");
  const depth = parts.length;
  const base = (parts[parts.length - 1] ?? "").toLowerCase();
  const ext = getFileExt(filePath);

  // Root-level config/readme = highest priority
  if (depth === 1 && IMPORTANT_FILES.has(base)) return 0;
  // Root-level source files
  if (depth === 1) return 1;
  // Important files at any depth
  if (IMPORTANT_FILES.has(base)) return 2;
  // Source code by depth
  if ([".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java"].includes(ext)) return 3 + depth;
  // Config and schema files
  if ([".json", ".yaml", ".yml", ".toml", ".prisma"].includes(ext)) return 5 + depth;
  // Test files
  if (base.includes("test") || base.includes("spec") || parts.some(p => p === "test" || p === "tests" || p === "__tests__")) return 10 + depth;
  // Everything else
  return 20 + depth;
}

// ── Tarball-based bulk import ──

interface TarEntry {
  path: string;
  size: number;
  content: string;
}

async function extractTarGz(buffer: ArrayBuffer): Promise<TarEntry[]> {
  // Simple tar extraction — tar format:
  // Each file: 512-byte header, then ceil(size/512)*512 bytes of data
  const data = new Uint8Array(buffer);
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const entries: TarEntry[] = [];

  let offset = 0;
  while (offset + 512 <= data.length) {
    // Read header
    const header = data.slice(offset, offset + 512);

    // Check for end-of-archive (two zero blocks)
    if (header.every(b => b === 0)) break;

    // File name (bytes 0-99)
    const nameRaw = decoder.decode(header.slice(0, 100)).replace(/\0/g, "").trim();

    // Prefix (bytes 345-499, USTAR format) for long paths
    const prefix = decoder.decode(header.slice(345, 500)).replace(/\0/g, "").trim();
    const fullName = prefix ? `${prefix}/${nameRaw}` : nameRaw;

    // File size (bytes 124-135, octal string)
    const sizeStr = decoder.decode(header.slice(124, 136)).replace(/\0/g, "").trim();
    const fileSize = parseInt(sizeStr, 8) || 0;

    // Type flag (byte 156): '0' or '\0' = regular file, '5' = directory
    const typeFlag = header[156];
    const isFile = typeFlag === 0 || typeFlag === 48; // 0 or '0'

    offset += 512; // move past header

    if (isFile && fileSize > 0) {
      const content = decoder.decode(data.slice(offset, offset + fileSize));

      // Strip the top-level directory that GitHub adds to tarballs
      // Format: "owner-repo-sha/" prefix on every path
      const pathParts = fullName.split("/");
      const strippedPath = pathParts.slice(1).join("/");

      if (strippedPath) {
        entries.push({ path: strippedPath, size: fileSize, content });
      }
    }

    // Advance past data blocks (rounded up to 512)
    offset += Math.ceil(fileSize / 512) * 512;
  }

  return entries;
}

async function extractTarWithTarStream(buffer: ArrayBuffer): Promise<TarEntry[]> {
  return new Promise((resolve, reject) => {
    // Handle both ESM default and CommonJS export shapes
    const extractFn = (tar as any).extract ?? (tar as any).default?.extract ?? tar;
    if (typeof extractFn !== "function") {
      return reject(new Error("tar-stream extract is not a function"));
    }
    const extract = extractFn();
    const entries: TarEntry[] = [];

    extract.on("entry", (header: any, stream: any, next: () => void) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => {
        if (header.type === "file") {
          const buf = Buffer.concat(chunks);
          const content = buf.toString("utf8");
          const pathParts = (header.name || "").split("/");
          const strippedPath = pathParts.slice(1).join("/");
          if (strippedPath) {
            entries.push({
              path: strippedPath,
              size: header.size ?? buf.length,
              content,
            });
          }
        }
        next();
      });
      stream.resume();
    });

    extract.on("finish", () => resolve(entries));
    extract.on("error", reject);

    const readable = new Readable();
    readable.push(Buffer.from(buffer));
    readable.push(null);
    readable.pipe(extract);
  });
}

async function decompressGzip(compressed: ArrayBuffer): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const gunzip = createGunzip();
    const chunks: Buffer[] = [];

    gunzip.on("data", (chunk: Buffer) => chunks.push(chunk));
    gunzip.on("end", () => resolve(Buffer.concat(chunks).buffer));
    gunzip.on("error", reject);

    // Feed the compressed data
    const readable = new Readable();
    readable.push(Buffer.from(compressed));
    readable.push(null);
    readable.pipe(gunzip);
  });
}

export async function fetchRepoFiles(repoUrl: string, token?: string): Promise<RepoFile[]> {
  const parsed = parseRepoUrl(repoUrl);
  if (!parsed) throw new Error("Invalid GitHub repository URL");
  const { owner, repo } = parsed;

  // Get default branch
  const repoRes = await ghRequest(`/repos/${owner}/${repo}`, token);
  if (!repoRes.ok) {
    if (repoRes.status === 403) throw new Error("GitHub API rate limit reached. Add a personal access token or wait for rate limit reset.");
    if (repoRes.status === 404) throw new Error("Repository not found — check the URL or add a token for private repos");
    if (repoRes.status === 401) throw new Error("Authentication required — provide a GitHub personal access token");
    throw new Error(`GitHub API error: ${repoRes.status}`);
  }
  const repoData = (await repoRes.json()) as { default_branch: string };
  const defaultBranch = repoData.default_branch ?? "main";

  // Download tarball — single HTTP request for the entire repo
  console.log(`[GitHub] Downloading tarball for ${owner}/${repo}@${defaultBranch}...`);
  const tarHeaders: Record<string, string> = {
    "User-Agent": "ai-think-tank",
    Accept: "application/vnd.github.v3+json",
  };
  if (token) tarHeaders["Authorization"] = `Bearer ${token}`;

  const tarUrl = `${GITHUB_API}/repos/${owner}/${repo}/tarball/${defaultBranch}`;
  const tarRes = await fetch(tarUrl, { headers: tarHeaders, redirect: "follow" });
  if (!tarRes.ok) {
    console.warn(`[GitHub] Tarball download failed (${tarRes.status}), falling back to tree API`);
    return fetchRepoFilesLegacy(owner, repo, defaultBranch, token);
  }

  const compressed = await tarRes.arrayBuffer();
  console.log(`[GitHub] Tarball downloaded: ${(compressed.byteLength / 1024).toFixed(0)}KB compressed`);

  // Decompress and extract with fallback chain: tar-stream -> manual extractTarGz -> tree API
  let tarEntries: TarEntry[];
  try {
    const decompressed = await decompressGzip(compressed);
    try {
      tarEntries = await extractTarWithTarStream(decompressed);
      console.log(`[GitHub] Extracted ${tarEntries.length} entries using tar-stream`);
    } catch (tarStreamErr) {
      console.warn(`[GitHub] tar-stream extraction failed, attempting manual tar parsing:`, tarStreamErr);
      tarEntries = await extractTarGz(decompressed);
      console.log(`[GitHub] Extracted ${tarEntries.length} entries using manual parser`);
    }
  } catch (err) {
    console.warn(`[GitHub] Tarball extraction failed, falling back to tree API:`, err);
    return fetchRepoFilesLegacy(owner, repo, defaultBranch, token);
  }

  // Filter and sort
  const candidates = tarEntries.filter((entry) => {
    const parts = entry.path.split("/");
    // Exclude blacklisted directories
    if (parts.some(p => isExcludedDir(p))) return false;
    // Skip binary files
    if (isBinaryExt(getFileExt(entry.path))) return false;
    // Must be a relevant file type
    if (!isRelevantFile(entry.path)) return false;
    // Skip individual files over the size limit
    if (entry.size > MAX_SINGLE_FILE_CHARS) return false;
    return true;
  });

  // Sort by priority
  candidates.sort((a, b) => filePriority(a.path) - filePriority(b.path));

  // Collect results within limits
  const results: RepoFile[] = [];
  let totalChars = 0;

  for (const entry of candidates) {
    if (results.length >= MAX_FILES || totalChars >= MAX_CHARS) break;

    // Validate content is text-like (not binary disguised with a text extension)
    const nullBytes = entry.content.slice(0, 1000).split("").filter(c => c === "\0").length;
    if (nullBytes > 5) continue; // likely binary

    results.push({ path: entry.path, content: entry.content });
    totalChars += entry.content.length;
  }

  console.log(`[GitHub] Imported ${results.length} files, ${(totalChars / 1024).toFixed(0)}KB of context`);
  return results;
}

// Legacy fallback — sequential Contents API (kept for when tarball fails)
async function fetchRepoFilesLegacy(
  owner: string, repo: string, branch: string, token?: string
): Promise<RepoFile[]> {
  console.log(`[GitHub] Using legacy tree API for ${owner}/${repo}@${branch}`);

  const treeRes = await ghRequest(
    `/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    token
  );
  if (!treeRes.ok) throw new Error(`Cannot read repository tree: ${treeRes.status}`);
  const treeData = (await treeRes.json()) as {
    tree: { path: string; type: string; size?: number }[];
    truncated?: boolean;
  };

  const candidates = (treeData.tree ?? []).filter((item) => {
    if (item.type !== "blob") return false;
    if ((item.size ?? 0) > MAX_SINGLE_FILE_CHARS) return false;
    const parts = item.path.toLowerCase().split("/");
    if (parts.some((p) => isExcludedDir(p))) return false;
    if (isBinaryExt(getFileExt(item.path))) return false;
    return isRelevantFile(item.path);
  });

  candidates.sort((a, b) => filePriority(a.path) - filePriority(b.path));

  const results: RepoFile[] = [];
  let totalChars = 0;

  // Batch fetch with concurrency limit
  const BATCH_SIZE = 10;
  for (let i = 0; i < candidates.length && results.length < MAX_FILES && totalChars < MAX_CHARS; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const fetches = batch.map(async (file) => {
      const encodedPath = file.path.split("/").map(encodeURIComponent).join("/");
      const contentRes = await ghRequest(
        `/repos/${owner}/${repo}/contents/${encodedPath}?ref=${branch}`,
        token
      );
      if (!contentRes.ok) return null;
      const data = (await contentRes.json()) as { content?: string };
      if (!data.content) return null;
      const content = Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf-8");
      return { path: file.path, content } as RepoFile;
    });

    const batchResults = await Promise.all(fetches);
    for (const file of batchResults) {
      if (!file) continue;
      if (results.length >= MAX_FILES || totalChars >= MAX_CHARS) break;
      results.push(file);
      totalChars += file.content.length;
    }
  }

  return results;
}

// Build a full file tree manifest — shows ALL files including excluded ones
export function buildRepoManifest(files: RepoFile[], allEntryCount?: number): string {
  const lines: string[] = [
    `REPOSITORY FILE MANIFEST`,
    `Files imported: ${files.length}${allEntryCount ? ` (out of ${allEntryCount} total in repo)` : ""}`,
    `Total context: ${Math.round(files.reduce((s, f) => s + f.content.length, 0) / 1024)}KB`,
    ``,
    `Imported files:`,
  ];

  // Group files by top-level directory
  const byDir = new Map<string, RepoFile[]>();
  for (const file of files) {
    const topDir = file.path.includes("/") ? file.path.split("/")[0]! : "(root)";
    const arr = byDir.get(topDir) ?? [];
    arr.push(file);
    byDir.set(topDir, arr);
  }

  for (const [dir, dirFiles] of byDir) {
    lines.push(`  ${dir}/`);
    for (const f of dirFiles) {
      const relPath = dir === "(root)" ? f.path : f.path.slice(dir.length + 1);
      const sizeKB = (f.content.length / 1024).toFixed(1);
      lines.push(`    ${relPath} (${sizeKB}KB)`);
    }
  }

  return lines.join("\n");
}

export function buildRepoContext(files: RepoFile[]): string {
  const manifest = buildRepoManifest(files);

  const lines: string[] = [
    `REPOSITORY CONTEXT (${files.length} files imported)\n`,
    manifest,
    `\n---\n`,
    "Use these files as the starting point. When outputting modified files, use the === FILE: path === format.\n",
    "IMPORTANT: You have access to the FULL repository contents below. Analyze the actual code, architecture, and dependencies — not hypothetical ones.\n",
  ];
  for (const file of files) {
    const ext = file.path.split(".").pop() ?? "";
    lines.push(`\n### ${file.path}`);
    lines.push("```" + ext);
    lines.push(file.content);
    lines.push("```");
  }
  return lines.join("\n");
}

export async function createPullRequest(
  repoUrl: string,
  files: RepoFile[],
  title: string,
  body: string,
  token: string
): Promise<string> {
  const parsed = parseRepoUrl(repoUrl);
  if (!parsed) throw new Error("Invalid GitHub repository URL");
  const { owner, repo } = parsed;

  const repoRes = await ghRequest(`/repos/${owner}/${repo}`, token);
  if (!repoRes.ok) throw new Error(`Cannot access repository: ${repoRes.status}`);
  const repoData = (await repoRes.json()) as { default_branch: string };
  const defaultBranch = repoData.default_branch ?? "main";

  const refRes = await ghRequest(`/repos/${owner}/${repo}/git/ref/heads/${defaultBranch}`, token);
  if (!refRes.ok) throw new Error(`Cannot get branch ref: ${refRes.status}`);
  const refData = (await refRes.json()) as { object: { sha: string } };
  const baseSha = refData.object.sha;

  // Create feature branch
  const branchName = `think-tank/${Date.now()}`;
  const branchRes = await ghRequest(`/repos/${owner}/${repo}/git/refs`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha }),
  });
  if (!branchRes.ok) {
    const err = await branchRes.text();
    throw new Error(`Cannot create branch: ${err}`);
  }

  // Commit each file
  for (const file of files) {
    const encodedPath = file.path.split("/").map(encodeURIComponent).join("/");

    let existingSha: string | undefined;
    const existRes = await ghRequest(
      `/repos/${owner}/${repo}/contents/${encodedPath}?ref=${branchName}`,
      token
    );
    if (existRes.ok) {
      const existData = (await existRes.json()) as { sha?: string };
      existingSha = existData.sha;
    }

    const payload: Record<string, string> = {
      message: `think-tank: update ${file.path}`,
      content: Buffer.from(file.content).toString("base64"),
      branch: branchName,
    };
    if (existingSha) payload["sha"] = existingSha;

    const putRes = await ghRequest(`/repos/${owner}/${repo}/contents/${encodedPath}`, token, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!putRes.ok) {
      const err = await putRes.text();
      console.error(`[GitHub] Failed to commit ${file.path}: ${err}`);
    }
  }

  // Open the PR
  const prRes = await ghRequest(`/repos/${owner}/${repo}/pulls`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      body,
      head: branchName,
      base: defaultBranch,
    }),
  });
  if (!prRes.ok) {
    const err = await prRes.text();
    throw new Error(`Cannot create pull request: ${err}`);
  }

  const prData = (await prRes.json()) as { html_url: string };
  return prData.html_url;
}

export function isGitHubConfigured(): boolean {
  return !!(process.env["GITHUB_TOKEN"] ?? "").trim();
}
