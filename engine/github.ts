const GITHUB_API = "https://api.github.com";

export interface RepoFile {
  path: string;
  content: string;
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
]);

const EXCLUDE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".nuxt",
  ".cache", "vendor", "__pycache__", ".venv", "venv",
  "coverage", ".nyc_output", "target", "out", ".turbo",
]);

export async function fetchRepoFiles(repoUrl: string, token?: string): Promise<RepoFile[]> {
  const parsed = parseRepoUrl(repoUrl);
  if (!parsed) throw new Error("Invalid GitHub repository URL");
  const { owner, repo } = parsed;

  const repoRes = await ghRequest(`/repos/${owner}/${repo}`, token);
  if (!repoRes.ok) {
    if (repoRes.status === 404) throw new Error("Repository not found — check the URL or add a token for private repos");
    if (repoRes.status === 401) throw new Error("Authentication required — provide a GitHub personal access token");
    throw new Error(`GitHub API error: ${repoRes.status}`);
  }
  const repoData = (await repoRes.json()) as { default_branch: string };
  const defaultBranch = repoData.default_branch ?? "main";

  const treeRes = await ghRequest(
    `/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`,
    token
  );
  if (!treeRes.ok) throw new Error(`Cannot read repository tree: ${treeRes.status}`);
  const treeData = (await treeRes.json()) as {
    tree: { path: string; type: string; size?: number }[];
    truncated?: boolean;
  };

  const candidates = (treeData.tree ?? []).filter((item) => {
    if (item.type !== "blob") return false;
    if ((item.size ?? 0) > 80_000) return false;
    const parts = item.path.toLowerCase().split("/");
    if (parts.some((p) => EXCLUDE_DIRS.has(p))) return false;
    const dotIdx = item.path.lastIndexOf(".");
    const ext = dotIdx >= 0 ? item.path.slice(dotIdx).toLowerCase() : "";
    const base = parts[parts.length - 1] ?? "";
    const isImportant = [
      "package.json", "cargo.toml", "go.mod", "requirements.txt",
      "pyproject.toml", "gemfile", "dockerfile", "makefile", "readme.md",
      ".env.example", "tsconfig.json",
    ].includes(base.toLowerCase());
    return RELEVANT_EXTS.has(ext) || isImportant;
  });

  // Sort: root-level config/readme first, then by path depth, then alphabetically
  candidates.sort((a, b) => {
    const aDepth = a.path.split("/").length;
    const bDepth = b.path.split("/").length;
    if (aDepth !== bDepth) return aDepth - bDepth;
    return a.path.localeCompare(b.path);
  });

  const results: RepoFile[] = [];
  let totalChars = 0;
  const MAX_FILES = 50;
  const MAX_CHARS = 120_000;

  for (const file of candidates) {
    if (results.length >= MAX_FILES || totalChars >= MAX_CHARS) break;
    const contentRes = await ghRequest(
      `/repos/${owner}/${repo}/contents/${file.path.split("/").map(encodeURIComponent).join("/")}`,
      token
    );
    if (!contentRes.ok) continue;
    const data = (await contentRes.json()) as { content?: string };
    if (!data.content) continue;
    const content = Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf-8");
    results.push({ path: file.path, content });
    totalChars += content.length;
  }

  return results;
}

export function buildRepoContext(files: RepoFile[]): string {
  const lines: string[] = [
    `REPOSITORY CONTEXT (${files.length} files imported)\n`,
    "Use these files as the starting point. When outputting modified files, use the === FILE: path === format.\n",
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
