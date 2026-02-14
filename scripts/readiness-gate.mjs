import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PERF_REPORT_DIR = process.env.LOCAL50_REPORT_DIR ?? ".reports/perf";
const READINESS_REPORT_DIR = process.env.READINESS_REPORT_DIR ?? ".reports/readiness";

const STAGES = [
  { profile: "local25", scenario: { agents: 25, runs: 250, events: 2500 } },
  { profile: "local50", scenario: { agents: 50, runs: 500, events: 5000 } },
];

const GATE_DEFINITIONS = {
  dataIntegrity: ["parseSessions p95", "parseRuns p95"],
  renderPerformance: ["buildPlacements p95", "searchEntityIds p95"],
  timelineReliability: ["buildTimelineIndex p95", "streamMergeBatch p95"],
  panelResponsiveness: ["heapUsed footprint"],
};

function readJson(pathname) {
  const raw = readFileSync(pathname, "utf8");
  return JSON.parse(raw);
}

function fail(message) {
  throw new Error(message);
}

function ensureScenarioMatches(report, expected) {
  const scenario = report?.scenario;
  if (!scenario) {
    return false;
  }
  return (
    Number(scenario.agents) === expected.agents &&
    Number(scenario.runs) === expected.runs &&
    Number(scenario.events) === expected.events
  );
}

function buildCheckMap(report) {
  const checks = Array.isArray(report?.checks) ? report.checks : [];
  const map = new Map();
  for (const check of checks) {
    if (!check?.metric) {
      continue;
    }
    map.set(check.metric, check);
  }
  return map;
}

function evaluateStage(stage) {
  const reportPath = join(PERF_REPORT_DIR, `${stage.profile}-latest.json`);
  const report = readJson(reportPath);
  const scenarioMatch = ensureScenarioMatches(report, stage.scenario);
  const checkMap = buildCheckMap(report);

  const gates = Object.fromEntries(
    Object.entries(GATE_DEFINITIONS).map(([gateName, metricNames]) => {
      const missing = metricNames.filter((metric) => !checkMap.has(metric));
      const failed = metricNames.filter((metric) => {
        const check = checkMap.get(metric);
        return !check || check.pass !== true;
      });
      return [
        gateName,
        {
          pass: missing.length === 0 && failed.length === 0,
          missing,
          failed,
        },
      ];
    }),
  );

  const gatePass = Object.values(gates).every((gate) => gate.pass);
  return {
    profile: stage.profile,
    reportPath,
    scenarioMatch,
    gatePass,
    gates,
    generatedAt: report?.generatedAt ?? null,
  };
}

function toMarkdown(result) {
  const lines = [
    `### Readiness Gate Report - ${result.generatedAt}`,
    "",
    "| Stage | Scenario | Gate Status |",
    "| --- | --- | --- |",
  ];

  for (const stage of result.stages) {
    const scenarioStatus = stage.scenarioMatch ? "PASS" : "FAIL";
    const gateStatus = stage.gatePass ? "PASS" : "FAIL";
    lines.push(`| ${stage.profile} | ${scenarioStatus} | ${gateStatus} |`);
  }

  lines.push("", "| Gate | local25 | local50 |", "| --- | --- | --- |");
  for (const gateName of Object.keys(GATE_DEFINITIONS)) {
    const local25 = result.stages[0]?.gates?.[gateName]?.pass ? "PASS" : "FAIL";
    const local50 = result.stages[1]?.gates?.[gateName]?.pass ? "PASS" : "FAIL";
    lines.push(`| ${gateName} | ${local25} | ${local50} |`);
  }

  lines.push("", `Overall: ${result.pass ? "PASS" : "FAIL"}`);
  lines.push("Decision Template:");
  lines.push("- release decision: go | hold");
  lines.push("- unresolved risks:");
  lines.push("- follow-up issues:");
  return `${lines.join("\n")}\n`;
}

function main() {
  const generatedAt = new Date().toISOString();
  const stages = STAGES.map((stage) => evaluateStage(stage));
  const pass = stages.every((stage) => stage.scenarioMatch && stage.gatePass);
  const result = {
    generatedAt,
    pass,
    stages,
  };

  mkdirSync(READINESS_REPORT_DIR, { recursive: true });
  const jsonPath = join(READINESS_REPORT_DIR, "readiness-latest.json");
  const mdPath = join(READINESS_REPORT_DIR, "readiness-latest.md");

  writeFileSync(jsonPath, JSON.stringify(result, null, 2));
  writeFileSync(mdPath, toMarkdown(result));

  console.log(`readiness report json: ${jsonPath}`);
  console.log(`readiness report md: ${mdPath}`);

  if (!pass) {
    fail("readiness gate failed. check readiness-latest.md for failing stages.");
  }
}

try {
  main();
} catch (error) {
  const details = error instanceof Error ? error.message : String(error);
  console.error(details);
  process.exitCode = 1;
}
