export type OpenClawGitStatus = {
  branch: string;
  commitsBehind: number;
  lastCommitHash: string;
  lastCommitMessage: string;
  lastCommitDate: string;
  isDirty: boolean;
  dirtyFiles: string[];
};

export type OpenClawProjectMeta = {
  name: string;
  version: string;
  description: string;
  depsCount: number;
  devDepsCount: number;
  scripts: string[];
  nodeEngine?: string;
};

export type OpenClawGatewayStatus = {
  reachable: boolean;
  latencyMs: number | null;
  url: string;
  port: number;
};

export type OpenClawChannelInfo = {
  name: string;
  sourceDir: string;
  fileCount: number;
};

export type OpenClawSkillInfo = {
  name: string;
  path: string;
};

export type OpenClawMemoryInfo = {
  files: string[];
};

export type OpenClawCronInfo = {
  files: string[];
};

export type OpenClawDocSummary = {
  path: string;
  title: string;
  firstParagraph: string;
  headings: string[];
  sizeBytes: number;
};

export type OpenClawChangelogEntry = {
  version: string;
  addedCount: number;
  fixedCount: number;
  changedCount: number;
  highlights: string[];
};

export type OpenClawDockerService = {
  name: string;
  image?: string;
  ports?: string[];
};

export type OpenClawDockerConfig = {
  services: OpenClawDockerService[];
};

export type HubDiagnostic = {
  level: "info" | "warning" | "error";
  code: string;
  message: string;
};

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
