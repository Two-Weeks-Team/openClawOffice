/** Git repository status for the openclaw project. */
export type OpenClawGitStatus = {
  branch: string;
  commitsBehind: number;
  lastCommitHash: string;
  lastCommitMessage: string;
  lastCommitDate: string;
  isDirty: boolean;
  dirtyFiles: string[];
};

/** Project metadata extracted from package.json. */
export type OpenClawProjectMeta = {
  name: string;
  version: string;
  description: string;
  depsCount: number;
  devDepsCount: number;
  scripts: string[];
  nodeEngine?: string;
};

/** Gateway health-check result (probed at 127.0.0.1:{port}/health). */
export type OpenClawGatewayStatus = {
  reachable: boolean;
  latencyMs: number | null;
  url: string;
  port: number;
};

/** A messaging channel discovered under src/channels/ or extensions/. */
export type OpenClawChannelInfo = {
  name: string;
  sourceDir: string;
  fileCount: number;
};

/** A skill discovered under the skills/ directory. */
export type OpenClawSkillInfo = {
  name: string;
  path: string;
};

/** Memory module file listing from src/memory/. */
export type OpenClawMemoryInfo = {
  files: string[];
};

/** Cron module file listing from src/cron/. */
export type OpenClawCronInfo = {
  files: string[];
};

/** Summary of a markdown document (first 4 KB parsed for headings). */
export type OpenClawDocSummary = {
  path: string;
  title: string;
  firstParagraph: string;
  headings: string[];
  sizeBytes: number;
};

/** Parsed CHANGELOG.md version entry with change counts. */
export type OpenClawChangelogEntry = {
  version: string;
  addedCount: number;
  fixedCount: number;
  changedCount: number;
  highlights: string[];
};

/** A service parsed from docker-compose.yml. */
export type OpenClawDockerService = {
  name: string;
  image?: string;
  ports?: string[];
};

/** Docker Compose configuration summary. */
export type OpenClawDockerConfig = {
  services: OpenClawDockerService[];
};

/** Diagnostic message emitted during snapshot collection. */
export type HubDiagnostic = {
  level: "info" | "warning" | "error";
  code: string;
  message: string;
};

/** Top-level aggregate snapshot returned by the Hub API. Cached for 30 s. */
export type OpenClawHubSnapshot = {
  generatedAt: number;
  projectDir: string;
  git: OpenClawGitStatus | null;
  project: OpenClawProjectMeta | null;
  gateway: OpenClawGatewayStatus | null;
  channels: OpenClawChannelInfo[];
  skills: OpenClawSkillInfo[];
  memory: OpenClawMemoryInfo | null;
  cron: OpenClawCronInfo | null;
  docs: OpenClawDocSummary[];
  changelog: OpenClawChangelogEntry[];
  docker: OpenClawDockerConfig | null;
  diagnostics: HubDiagnostic[];
};
