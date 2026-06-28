import { execFile } from "child_process";
import { promisify } from "util";
import { mkdir, writeFile, readFile, rm, access } from "fs/promises";
import { constants } from "fs";
import path from "path";
import os from "os";
import { mkdtemp } from "fs/promises";

const execFileAsync = promisify(execFile);

export interface SandboxFile {
  path: string;
  content: string;
}

export interface BuildResult {
  success: boolean;
  command: string;
  stdout: string;
  stderr: string;
  duration: number;
}

export interface SandboxRunResult {
  dir: string;
  builds: BuildResult[];
  summary: string;
  filesWritten: number;
}

const BUILD_TIMEOUT = 90_000;

async function fileExists(p: string): Promise<boolean> {
  try { await access(p, constants.F_OK); return true; } catch { return false; }
}

async function detectBuildSteps(dir: string): Promise<{ cmd: string; args: string[] }[]> {
  const steps: { cmd: string; args: string[] }[] = [];

  const hasPkg = await fileExists(path.join(dir, "package.json"));
  const hasTs  = await fileExists(path.join(dir, "tsconfig.json"));
  const hasReq = await fileExists(path.join(dir, "requirements.txt"));
  const hasGo  = await fileExists(path.join(dir, "go.mod"));
  const hasCargo = await fileExists(path.join(dir, "Cargo.toml"));

  if (hasPkg) {
    // Read package.json to determine right scripts
    const pkg = JSON.parse(await readFile(path.join(dir, "package.json"), "utf-8")) as {
      scripts?: Record<string, string>;
    };
    // Install deps (skip if no deps)
    steps.push({ cmd: "npm", args: ["install", "--prefer-offline", "--no-audit", "--no-fund"] });

    if (pkg.scripts?.["typecheck"]) {
      steps.push({ cmd: "npm", args: ["run", "typecheck"] });
    } else if (hasTs || pkg.scripts?.["build"]) {
      if (hasTs) steps.push({ cmd: "npx", args: ["tsc", "--noEmit"] });
      if (pkg.scripts?.["build"]) steps.push({ cmd: "npm", args: ["run", "build"] });
    }

    if (pkg.scripts?.["test"]) {
      steps.push({ cmd: "npm", args: ["run", "test", "--", "--passWithNoTests"] });
    }
  } else if (hasTs) {
    steps.push({ cmd: "npx", args: ["tsc", "--noEmit"] });
  } else if (hasReq) {
    steps.push({ cmd: "pip", args: ["install", "-r", "requirements.txt", "-q"] });
    // Compile-check all .py files
    steps.push({ cmd: "python3", args: ["-m", "compileall", "-q", "."] });
  } else if (hasGo) {
    steps.push({ cmd: "go", args: ["build", "./..."] });
    steps.push({ cmd: "go", args: ["vet", "./..."] });
  } else if (hasCargo) {
    steps.push({ cmd: "cargo", args: ["check", "--quiet"] });
  } else {
    // Generic: just check for python files
    const pyFiles = await findFilesByExt(dir, ".py");
    if (pyFiles.length > 0) {
      steps.push({ cmd: "python3", args: ["-m", "compileall", "-q", "."] });
    }
  }

  return steps;
}

async function findFilesByExt(dir: string, ext: string): Promise<string[]> {
  const { readdir } = await import("fs/promises");
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const results: string[] = [];
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith(ext)) results.push(e.name);
    }
    return results;
  } catch { return []; }
}

async function runStep(dir: string, cmd: string, args: string[]): Promise<BuildResult> {
  const start = Date.now();
  const label = `${cmd} ${args.join(" ")}`;
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      cwd: dir,
      timeout: BUILD_TIMEOUT,
      maxBuffer: 2 * 1024 * 1024,
      env: {
        ...process.env,
        CI: "true",
        NO_COLOR: "1",
        FORCE_COLOR: "0",
        NODE_ENV: "production",
      },
    });
    return { success: true, command: label, stdout: stdout.slice(0, 4000), stderr: stderr.slice(0, 2000), duration: Date.now() - start };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      success: false,
      command: label,
      stdout: (e.stdout ?? "").slice(0, 4000),
      stderr: (e.stderr ?? e.message ?? "").slice(0, 4000),
      duration: Date.now() - start,
    };
  }
}

export async function runSandbox(files: SandboxFile[]): Promise<SandboxRunResult> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "think-tank-sandbox-"));

  try {
    // Write files
    for (const file of files) {
      const filePath = path.join(dir, file.path);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, file.content, "utf-8");
    }

    const steps = await detectBuildSteps(dir);
    if (steps.length === 0) {
      return {
        dir,
        builds: [],
        summary: "No build system detected — files written but not built.",
        filesWritten: files.length,
      };
    }

    const builds: BuildResult[] = [];
    for (const step of steps) {
      const result = await runStep(dir, step.cmd, step.args);
      builds.push(result);
      if (!result.success) break; // Stop on first failure
    }

    const allPassed = builds.every((b) => b.success);
    const failed = builds.find((b) => !b.success);

    const summary = allPassed
      ? `✅ Build successful — all ${builds.length} step${builds.length !== 1 ? "s" : ""} passed.`
      : `❌ Build failed at: ${failed?.command}\n\nErrors:\n${failed?.stderr || failed?.stdout}`;

    return { dir, builds, summary, filesWritten: files.length };
  } catch (err) {
    return {
      dir,
      builds: [],
      summary: `Sandbox error: ${err instanceof Error ? err.message : String(err)}`,
      filesWritten: files.length,
    };
  }
}

export async function cleanupSandbox(dir: string): Promise<void> {
  try { await rm(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}
