import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
  HubDiagnostic,
  OpenClawChangelogEntry,
  OpenClawChannelInfo,
  OpenClawCronInfo,
  OpenClawDocSummary,
  OpenClawDockerConfig,
  OpenClawDockerService,
  OpenClawGatewayStatus,
  OpenClawGitStatus,
  OpenClawHubSnapshot,
  OpenClawMemoryInfo,
  OpenClawProjectMeta,
  OpenClawSkillInfo,
} from "./openclaw-hub-types";

const execFileAsync = promisify(execFile);

const CACHE_TTL_MS = 30_000;
const GATEWAY_CHECK_TTL_MS = 10_000;
const DOC_HEAD_BYTES = 4096;
const MAX_DOCS = 20;
const MAX_CHANGELOG_VERSIONS = 5;
const DEFAULT_GATEWAY_PORT = 18789;

let cachedSnapshot: OpenClawHubSnapshot | null = null;
let cachedAt = 0;
let cachedGateway: { result: OpenClawGatewayStatus; at: number } | null = null;

export function resolveOpenClawProjectDir(): string {
  const fromEnv = process.env.OPENCLAW_PROJECT_DIR?.trim();
  if (fromEnv && !fromEnv.includes("\0")) {
    return path.resolve(fromEnv);
  }
  return path.resolve(process.cwd(), "../openclaw");
}

function resolveGatewayPort(): number {
  const raw = process.env.OPENCLAW_GATEWAY_PORT?.trim();
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_GATEWAY_PORT;
}

async function runGit(dir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: dir,
    timeout: 10_000,
    maxBuffer: 1024 * 512,
  });
  return stdout.trim();
}

async function loadGitStatus(dir: string): Promise<OpenClawGitStatus | null> {
  try {
    const [branch, behindStr, logLine, statusOut] = await Promise.all([
      runGit(dir, ["rev-parse", "--abbrev-ref", "HEAD"]),
      runGit(dir, ["rev-list", "--count", "HEAD..origin/main"]).catch(() => "0"),
      runGit(dir, ["log", "-1", "--format=%h%x00%s%x00%ci"]),
      runGit(dir, ["status", "--porcelain"]),
    ]);

    const [hash = "", message = "", date = ""] = logLine.split("\0");
    const dirtyFiles = statusOut
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => line.slice(3).trim());

    return {
      branch,
      commitsBehind: Number(behindStr) || 0,
      lastCommitHash: hash,
      lastCommitMessage: message,
      lastCommitDate: date,
      isDirty: dirtyFiles.length > 0,
      dirtyFiles,
    };
  } catch {
    return null;
  }
}

async function loadProjectMeta(dir: string): Promise<OpenClawProjectMeta | null> {
  try {
    const raw = await fs.readFile(path.join(dir, "package.json"), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    const pkg = parsed as Record<string, unknown>;
    const deps = pkg.dependencies;
    const devDeps = pkg.devDependencies;
    const scripts = pkg.scripts;
    const engines = pkg.engines as Record<string, string> | undefined;

    return {
      name: String(pkg.name ?? "openclaw"),
      version: String(pkg.version ?? "unknown"),
      description: String(pkg.description ?? ""),
      depsCount: deps && typeof deps === "object" ? Object.keys(deps).length : 0,
      devDepsCount: devDeps && typeof devDeps === "object" ? Object.keys(devDeps).length : 0,
      scripts: scripts && typeof scripts === "object" ? Object.keys(scripts) : [],
      nodeEngine: engines?.node,
    };
  } catch {
    return null;
  }
}

async function checkGatewayHealth(port: number): Promise<OpenClawGatewayStatus> {
  const now = Date.now();
  if (cachedGateway && now - cachedGateway.at < GATEWAY_CHECK_TTL_MS) {
    return cachedGateway.result;
  }

  const url = `http://127.0.0.1:${port}`;
  const healthUrl = `${url}/health`;
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    const response = await fetch(healthUrl, { signal: controller.signal });
    clearTimeout(timeout);
    const latencyMs = Date.now() - start;
    const result: OpenClawGatewayStatus = {
      reachable: response.ok,
      latencyMs,
      url,
      port,
    };
    cachedGateway = { result, at: now };
    return result;
  } catch {
    const result: OpenClawGatewayStatus = {
      reachable: false,
      latencyMs: null,
      url,
      port,
    };
    cachedGateway = { result, at: now };
    return result;
  }
}

async function scanChannels(dir: string): Promise<OpenClawChannelInfo[]> {
  const channels: OpenClawChannelInfo[] = [];
  const srcChannelsDir = path.join(dir, "src", "channels");
  const extensionsDir = path.join(dir, "extensions");

  for (const [baseDir, label] of [
    [srcChannelsDir, "src/channels"],
    [extensionsDir, "extensions"],
  ] as const) {
    try {
      const entries = await fs.readdir(baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const channelDir = path.join(baseDir, entry.name);
        try {
          const files = await fs.readdir(channelDir);
          channels.push({
            name: entry.name,
            sourceDir: `${label}/${entry.name}`,
            fileCount: files.length,
          });
        } catch {
          channels.push({ name: entry.name, sourceDir: `${label}/${entry.name}`, fileCount: 0 });
        }
      }
    } catch {
      // directory doesn't exist
    }
  }

  return channels.sort((a, b) => a.name.localeCompare(b.name));
}

async function scanSkills(dir: string): Promise<OpenClawSkillInfo[]> {
  const skillsDir = path.join(dir, "skills");
  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => ({ name: e.name, path: `skills/${e.name}` }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

async function scanMemoryModule(dir: string): Promise<OpenClawMemoryInfo | null> {
  const memoryDir = path.join(dir, "src", "memory");
  try {
    const entries = await fs.readdir(memoryDir);
    return {
      files: entries.filter((f) => f.endsWith(".ts") || f.endsWith(".js")).sort(),
    };
  } catch {
    return null;
  }
}

async function scanCronModule(dir: string): Promise<OpenClawCronInfo | null> {
  const cronDir = path.join(dir, "src", "cron");
  try {
    const entries = await fs.readdir(cronDir);
    return {
      files: entries.filter((f) => f.endsWith(".ts") || f.endsWith(".js")).sort(),
    };
  } catch {
    return null;
  }
}

async function parseDockerCompose(dir: string): Promise<OpenClawDockerConfig | null> {
  const composePath = path.join(dir, "docker-compose.yml");
  try {
    const raw = await fs.readFile(composePath, "utf-8");
    const services: OpenClawDockerService[] = [];

    const serviceBlockMatch = raw.match(/^services:\s*\n([\s\S]*?)(?=\n\S|\n*$)/m);
    if (serviceBlockMatch) {
      const serviceNameRegex = /^ {2}(\S+):/gm;
      let match: RegExpExecArray | null;
      while ((match = serviceNameRegex.exec(serviceBlockMatch[1])) !== null) {
        services.push({ name: match[1] });
      }
    }

    return { services };
  } catch {
    return null;
  }
}

async function loadDocSummaries(dir: string): Promise<OpenClawDocSummary[]> {
  const summaries: OpenClawDocSummary[] = [];

  const readMdSummary = async (filePath: string, relativePath: string) => {
    try {
      const stat = await fs.stat(filePath);
      const fd = await fs.open(filePath, "r");
      try {
        const buf = Buffer.alloc(Math.min(DOC_HEAD_BYTES, stat.size));
        await fd.read(buf, 0, buf.length, 0);
        const content = buf.toString("utf-8");

        const lines = content.split("\n");
        let title = relativePath;
        let firstParagraph = "";
        const headings: string[] = [];

        for (const line of lines) {
          const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
          if (headingMatch) {
            if (headings.length === 0 && !title.includes("/")) {
              title = headingMatch[2].trim();
            }
            headings.push(headingMatch[2].trim());
          } else if (!firstParagraph && line.trim().length > 20 && !line.startsWith("#") && !line.startsWith("```")) {
            firstParagraph = line.trim().slice(0, 200);
          }
        }

        summaries.push({
          path: relativePath,
          title,
          firstParagraph,
          headings: headings.slice(0, 10),
          sizeBytes: stat.size,
        });
      } finally {
        await fd.close();
      }
    } catch {
      // skip unreadable docs
    }
  };

  // Read README.md
  await readMdSummary(path.join(dir, "README.md"), "README.md");

  // Read docs directory
  const docsDir = path.join(dir, "docs");
  try {
    const scanDir = async (base: string, prefix: string) => {
      if (summaries.length >= MAX_DOCS) return;
      const entries = await fs.readdir(base, { withFileTypes: true });
      for (const entry of entries) {
        if (summaries.length >= MAX_DOCS) break;
        const fullPath = path.join(base, entry.name);
        const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isFile() && entry.name.endsWith(".md")) {
          await readMdSummary(fullPath, `docs/${relPath}`);
        } else if (entry.isDirectory() && !entry.name.startsWith(".")) {
          await scanDir(fullPath, relPath);
        }
      }
    };
    await scanDir(docsDir, "");
  } catch {
    // docs directory missing
  }

  return summaries;
}

function parseChangelog(content: string): OpenClawChangelogEntry[] {
  const entries: OpenClawChangelogEntry[] = [];
  const versionRegex = /^## (\S+)/gm;
  const matches: Array<{ version: string; index: number }> = [];

  let match: RegExpExecArray | null;
  while ((match = versionRegex.exec(content)) !== null) {
    matches.push({ version: match[1], index: match.index });
  }

  for (let i = 0; i < Math.min(matches.length, MAX_CHANGELOG_VERSIONS); i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : content.length;
    const section = content.slice(start, end);

    let addedCount = 0;
    let fixedCount = 0;
    let changedCount = 0;
    const highlights: string[] = [];

    const lines = section.split("\n");
    let currentBlock = "";
    for (const line of lines) {
      if (line.match(/^### .*Added/i)) currentBlock = "added";
      else if (line.match(/^### .*Fix/i)) currentBlock = "fixed";
      else if (line.match(/^### .*Change/i)) currentBlock = "changed";

      if (line.startsWith("- ")) {
        if (currentBlock === "added") addedCount++;
        else if (currentBlock === "fixed") fixedCount++;
        else if (currentBlock === "changed") changedCount++;

        if (highlights.length < 3) {
          highlights.push(line.slice(2).trim().slice(0, 120));
        }
      }
    }

    entries.push({
      version: matches[i].version,
      addedCount,
      fixedCount,
      changedCount,
      highlights,
    });
  }

  return entries;
}

async function loadChangelog(dir: string): Promise<OpenClawChangelogEntry[]> {
  try {
    const raw = await fs.readFile(path.join(dir, "CHANGELOG.md"), "utf-8");
    return parseChangelog(raw);
  } catch {
    return [];
  }
}

export async function buildOpenClawHubSnapshot(): Promise<OpenClawHubSnapshot> {
  const now = Date.now();
  if (cachedSnapshot && now - cachedAt < CACHE_TTL_MS) {
    return cachedSnapshot;
  }

  const dir = resolveOpenClawProjectDir();
  const diagnostics: HubDiagnostic[] = [];

  // Check if project dir exists
  try {
    await fs.access(dir);
  } catch {
    diagnostics.push({
      level: "error",
      code: "PROJECT_DIR_NOT_FOUND",
      message: `OpenClaw project directory not found: ${dir}`,
    });
    const empty: OpenClawHubSnapshot = {
      generatedAt: now,
      projectDir: dir,
      git: null,
      project: null,
      gateway: null,
      channels: [],
      skills: [],
      memory: null,
      cron: null,
      docs: [],
      changelog: [],
      docker: null,
      diagnostics,
    };
    cachedSnapshot = empty;
    cachedAt = now;
    return empty;
  }

  const gatewayPort = resolveGatewayPort();

  const [git, project, gateway, channels, skills, memory, cron, docker, docs, changelog] =
    await Promise.all([
      loadGitStatus(dir),
      loadProjectMeta(dir),
      checkGatewayHealth(gatewayPort),
      scanChannels(dir),
      scanSkills(dir),
      scanMemoryModule(dir),
      scanCronModule(dir),
      parseDockerCompose(dir),
      loadDocSummaries(dir),
      loadChangelog(dir),
    ]);

  if (!git) {
    diagnostics.push({ level: "warning", code: "GIT_STATUS_FAILED", message: "Could not read git status" });
  }
  if (!project) {
    diagnostics.push({ level: "warning", code: "PACKAGE_JSON_FAILED", message: "Could not read package.json" });
  }
  if (!gateway?.reachable) {
    diagnostics.push({ level: "info", code: "GATEWAY_OFFLINE", message: `Gateway not reachable on port ${gatewayPort}` });
  }

  const snapshot: OpenClawHubSnapshot = {
    generatedAt: now,
    projectDir: dir,
    git,
    project,
    gateway,
    channels,
    skills,
    memory,
    cron,
    docs,
    changelog,
    docker,
    diagnostics,
  };

  cachedSnapshot = snapshot;
  cachedAt = now;
  return snapshot;
}

export async function loadFullDocument(dir: string, docPath: string): Promise<string | null> {
  // Security: prevent path traversal
  const normalized = path.normalize(docPath);
  if (normalized.includes("..") || path.isAbsolute(normalized)) {
    return null;
  }

  const fullPath = path.join(dir, normalized);
  // Ensure the resolved path is still within the project dir
  if (!fullPath.startsWith(dir)) {
    return null;
  }

  try {
    return await fs.readFile(fullPath, "utf-8");
  } catch {
    return null;
  }
}
