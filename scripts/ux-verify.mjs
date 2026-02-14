import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import os from "node:os";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const BASE_URL = process.env.UX_VERIFY_BASE_URL ?? "http://127.0.0.1:5180";
const ARTIFACT_DIR = process.env.UX_VERIFY_ARTIFACT_DIR ?? path.join("output", "ux-verify");
const START_TIMEOUT_MS = 45_000;
const STEP_TIMEOUT_MS = 12_000;
const REPLAY_SETTLE_MS = 3_500;
const TASK_MAX_DURATION_MS = 8_000;
const TASK_MAX_CLICKS = 4;
const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function safeUrl() {
  try {
    return new URL(BASE_URL);
  } catch {
    throw new Error(`UX_VERIFY_BASE_URL is invalid: ${BASE_URL}`);
  }
}

function slugify(input) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function serializeError(error) {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack ?? null,
    };
  }
  return {
    message: String(error),
    stack: null,
  };
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function waitForReady(getServerExitDetails) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < START_TIMEOUT_MS) {
    const exitDetails = getServerExitDetails();
    if (exitDetails) {
      throw new Error(`dev server exited before becoming ready (${exitDetails})`);
    }
    try {
      const response = await fetch(`${BASE_URL}/api/office/snapshot`);
      if (response.ok) {
        return;
      }
    } catch {
      // Server not ready yet.
    }
    await delay(500);
  }
  throw new Error(`dev server did not become ready within ${START_TIMEOUT_MS}ms`);
}

function terminateServer(server, signal) {
  if (!server || server.exitCode !== null) {
    return;
  }
  try {
    if (process.platform === "win32") {
      server.kill(signal);
      return;
    }
    if (server.pid) {
      process.kill(-server.pid, signal);
      return;
    }
  } catch {
    // Ignore process termination errors.
  }
}

async function shutdownServer(server) {
  if (!server || server.exitCode !== null) {
    return;
  }
  terminateServer(server, "SIGTERM");
  await Promise.race([once(server, "exit"), delay(2_000)]);
  if (server.exitCode === null) {
    terminateServer(server, "SIGKILL");
    await Promise.race([once(server, "exit"), delay(2_000)]);
  }
}

async function launchBrowser() {
  try {
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch (channelError) {
    try {
      return await chromium.launch({ headless: true });
    } catch (bundledError) {
      const details = [
        "Failed to launch browser for ux:verify.",
        `chrome-channel: ${serializeError(channelError).message}`,
        `bundled-chromium: ${serializeError(bundledError).message}`,
        "Try installing a browser once with: pnpm exec playwright install chromium",
      ];
      throw new Error(details.join("\n"));
    }
  }
}

async function createSyntheticStateDir() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-ux-verify-"));
  const subagentsDir = path.join(root, "subagents");
  await fs.mkdir(subagentsDir, { recursive: true });
  const now = Date.now();
  const payload = {
    version: 1,
    runs: {
      "run-ux-1": {
        runId: "run-ux-1",
        childSessionKey: "agent:ux-worker-a:session:1",
        requesterSessionKey: "agent:main:session:1",
        task: "Investigate queue depth and collect diagnostics",
        createdAt: now - 70_000,
        startedAt: now - 68_000,
      },
      "run-ux-2": {
        runId: "run-ux-2",
        childSessionKey: "agent:ux-worker-b:session:2",
        requesterSessionKey: "agent:main:session:2",
        task: "Validate sticky status visibility across layouts",
        createdAt: now - 90_000,
        startedAt: now - 87_000,
        endedAt: now - 82_000,
        outcome: { status: "ok" },
      },
      "run-ux-3": {
        runId: "run-ux-3",
        childSessionKey: "agent:ux-worker-c:session:3",
        requesterSessionKey: "agent:ops:session:3",
        task: "Reproduce replay tab reset regression and capture notes",
        createdAt: now - 55_000,
        startedAt: now - 53_000,
        endedAt: now - 49_000,
        outcome: { status: "error" },
      },
    },
  };
  await writeJson(path.join(subagentsDir, "runs.json"), payload);
  return root;
}

async function main() {
  const base = safeUrl();
  const useExistingServer = process.env.UX_VERIFY_USE_EXISTING_SERVER === "1";
  const checks = [];
  const consoleEntries = [];
  const serverLogs = [];
  let server;
  let browser;
  let context;
  let page;
  let failedChecks = 0;
  let syntheticStateDir = null;

  await fs.rm(ARTIFACT_DIR, { recursive: true, force: true });
  await fs.mkdir(ARTIFACT_DIR, { recursive: true });

  if (!useExistingServer) {
    syntheticStateDir = process.env.UX_VERIFY_STATE_DIR?.trim() || (await createSyntheticStateDir());
    const port = Number(base.port || (base.protocol === "https:" ? 443 : 80));
    assert(Number.isFinite(port) && port > 0, `Invalid port for ux:verify: ${base.port}`);
    const host = base.hostname || "127.0.0.1";
    server = spawn(pnpmCmd, ["dev", "--host", host, "--port", String(port)], {
      env: { ...process.env, CI: "1", OPENCLAW_STATE_DIR: syntheticStateDir },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    const captureLog = (chunk, prefix) => {
      const text = String(chunk).trim();
      if (!text) {
        return;
      }
      serverLogs.push(`${prefix}${text}`);
      if (serverLogs.length > 200) {
        serverLogs.shift();
      }
    };
    server.stdout.on("data", (chunk) => captureLog(chunk, "[dev] "));
    server.stderr.on("data", (chunk) => captureLog(chunk, "[err] "));
  }

  const getServerExitDetails = () => {
    if (!server) {
      return undefined;
    }
    if (server.exitCode === null && server.signalCode === null) {
      return undefined;
    }
    return `code=${server.exitCode ?? "null"}, signal=${server.signalCode ?? "null"}`;
  };

  const runCheck = async (name, fn) => {
    const startedAt = Date.now();
    try {
      const details = await fn();
      checks.push({
        name,
        pass: true,
        durationMs: Date.now() - startedAt,
        details,
      });
    } catch (error) {
      const screenshotFile = path.join(
        ARTIFACT_DIR,
        `${String(checks.length + 1).padStart(2, "0")}-${slugify(name)}.png`,
      );
      if (page) {
        try {
          await page.screenshot({ path: screenshotFile, fullPage: true });
        } catch {
          // Ignore screenshot failure during error handling.
        }
      }
      checks.push({
        name,
        pass: false,
        durationMs: Date.now() - startedAt,
        error: serializeError(error),
        screenshot: screenshotFile,
      });
      failedChecks += 1;
    }
  };

  const buildConsoleSummary = () => ({
    total: consoleEntries.length,
    warnings: consoleEntries.filter((entry) => entry.type === "warning").length,
    errors: consoleEntries.filter((entry) => entry.type === "error").length,
    recent: consoleEntries.slice(-20),
  });

  const buildReportBase = () => ({
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    syntheticStateDir,
    checks,
    console: buildConsoleSummary(),
    serverLogTail: serverLogs.slice(-30),
  });

  try {
    if (!useExistingServer) {
      await waitForReady(getServerExitDetails);
    }

    const snapshotResponse = await fetch(`${BASE_URL}/api/office/snapshot`);
    assert(snapshotResponse.ok, `snapshot endpoint failed with ${snapshotResponse.status}`);
    const snapshotPayload = await snapshotResponse.json();
    const replayRunId = snapshotPayload.runs?.at(-1)?.runId ?? null;
    const replayEventId = snapshotPayload.events?.at(-1)?.id ?? null;
    const firstSubagentLabel =
      snapshotPayload.entities?.find?.((entity) => entity?.kind === "subagent")?.label ?? null;
    assert(replayRunId, "No replay runId available from snapshot.");
    assert(replayEventId, "No replay eventId available from snapshot.");

    browser = await launchBrowser();
    context = await browser.newContext();
    page = await context.newPage();
    page.on("console", (message) => {
      consoleEntries.push({
        type: message.type(),
        text: message.text(),
      });
    });
    page.setDefaultTimeout(STEP_TIMEOUT_MS);

    await runCheck("sticky_status_bar", async () => {
      await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
      await page.locator('[aria-label="Global status bar"]').waitFor();
      const details = await page.evaluate(() => {
        const bar = document.querySelector('[aria-label="Global status bar"]');
        if (!bar) {
          return null;
        }
        const beforeTop = bar.getBoundingClientRect().top;
        window.scrollTo({ top: 500, left: 0, behavior: "auto" });
        const afterTop = bar.getBoundingClientRect().top;
        const style = window.getComputedStyle(bar);
        return {
          position: style.position,
          cssTop: style.top,
          beforeTop: Number(beforeTop.toFixed(2)),
          afterTop: Number(afterTop.toFixed(2)),
          scrollY: window.scrollY,
        };
      });
      assert(details, "Global status bar was not found.");
      const stickyPosition = details.position === "sticky" || details.position === "fixed";
      const cssTop = Number.parseFloat(details.cssTop);
      const stickyTop = Number.isFinite(cssTop)
        ? Math.abs(details.afterTop - cssTop) <= 2
        : Math.abs(details.afterTop) <= 12;
      const movedIntoStickyRange = details.afterTop <= details.beforeTop;
      assert(
        stickyPosition && stickyTop && movedIntoStickyRange,
        `Global status bar is not sticky enough: ${JSON.stringify(details)}`,
      );
      return details;
    });

    await runCheck("zone_overlap_pairs", async () => {
      await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
      await page.locator(".camera-overlap").waitFor();
      const details = await page.evaluate(() => {
        const overlapBadge = document.querySelector(".camera-overlap");
        const badgeText = overlapBadge?.textContent?.trim() ?? "";
        const badgeMatch = badgeText.match(/(-?\d+)/);
        const badgeCount = badgeMatch ? Number(badgeMatch[1]) : null;
        const nodes = [...document.querySelectorAll('button[aria-label^="Open detail panel for "]')]
          .map((node) => node.getBoundingClientRect())
          .filter((rect) => rect.width > 0 && rect.height > 0);
        let measuredPairs = 0;
        for (let i = 0; i < nodes.length; i += 1) {
          for (let j = i + 1; j < nodes.length; j += 1) {
            const a = nodes[i];
            const b = nodes[j];
            const overlapWidth = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const overlapHeight = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (overlapWidth > 1 && overlapHeight > 1) {
              measuredPairs += 1;
            }
          }
        }
        return {
          badgeText,
          badgeCount,
          measuredPairs,
          measuredNodeCount: nodes.length,
        };
      });
      assert(details.badgeCount !== null, `Could not parse overlap badge: "${details.badgeText}"`);
      assert(details.badgeCount === 0, `Overlap badge count must be 0. Got ${details.badgeCount}.`);
      assert(details.measuredPairs === 0, `Measured overlap pairs must be 0. Got ${details.measuredPairs}.`);
      return details;
    });

    await runCheck("replay_tab_persistence", async () => {
      const replayUrl = new URL(BASE_URL);
      replayUrl.searchParams.set("replay", "1");
      replayUrl.searchParams.set("runId", replayRunId);
      replayUrl.searchParams.set("eventId", replayEventId);
      await page.goto(replayUrl.toString(), { waitUntil: "domcontentloaded" });
      await page.getByRole("tab", { name: "Analysis" }).click();
      await page.getByRole("tab", { name: "Runs", exact: true }).click();

      const selectedTab = async () =>
        (await page
          .getByRole("tablist", { name: "Entity detail tabs" })
          .getByRole("tab", { selected: true })
          .textContent())?.trim() ?? "";
      const before = {
        tab: await selectedTab(),
        url: page.url(),
      };
      await page.waitForTimeout(REPLAY_SETTLE_MS);
      const after = {
        tab: await selectedTab(),
        url: page.url(),
      };
      const beforeEventId = new URL(before.url).searchParams.get("eventId");
      const afterEventId = new URL(after.url).searchParams.get("eventId");
      assert(before.tab === "Runs", `Expected replay tab to start at Runs, got "${before.tab}".`);
      assert(after.tab === "Runs", `Replay tab reset detected: expected Runs, got "${after.tab}".`);
      return {
        replayRunId,
        replayEventId,
        before,
        after,
        eventIdChanged: beforeEventId !== afterEventId,
      };
    });

    await runCheck("search_select_jump_flow", async () => {
      await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
      let clicks = 0;
      const click = async (locator) => {
        await locator.click();
        clicks += 1;
      };

      const targetLabel = firstSubagentLabel ?? "gateway-probe";
      const startedAt = Date.now();
      await click(page.getByRole("tab", { name: "Operations" }));
      await page.getByPlaceholder("agentId / runId / task").fill(targetLabel);
      const preferredEntityButton = page.getByRole("button", {
        name: `Open detail panel for ${targetLabel}`,
      });
      const entityButton =
        (await preferredEntityButton.count()) > 0
          ? preferredEntityButton
          : page.locator('button[aria-label^="Open detail panel for "]').first();
      await entityButton.waitFor();
      const selectedEntityLabel = await entityButton.getAttribute("aria-label");
      assert(selectedEntityLabel, "No entity button found for search/select flow.");
      await click(entityButton);
      await click(page.getByRole("button", { name: "Jump to run" }));
      await page.waitForFunction(() => {
        const runId = new URL(window.location.href).searchParams.get("runId");
        return typeof runId === "string" && runId.trim().length > 0;
      });
      const durationMs = Date.now() - startedAt;
      const runId = new URL(page.url()).searchParams.get("runId");
      assert(durationMs <= TASK_MAX_DURATION_MS, `Flow took ${durationMs}ms (limit: ${TASK_MAX_DURATION_MS}ms).`);
      assert(clicks <= TASK_MAX_CLICKS, `Flow used ${clicks} clicks (limit: ${TASK_MAX_CLICKS}).`);
      return {
        targetLabel,
        selectedEntityLabel,
        durationMs,
        clicks,
        runId,
        url: page.url(),
      };
    });

    const summary = {
      ...buildReportBase(),
      thresholds: {
        overlapPairsMustBeZero: true,
        replayTabMustStayOnRuns: true,
        flowMaxDurationMs: TASK_MAX_DURATION_MS,
        flowMaxClicks: TASK_MAX_CLICKS,
      },
    };

    const reportPath = path.join(ARTIFACT_DIR, "report.json");
    await writeJson(reportPath, summary);
    if (failedChecks > 0) {
      throw new Error(`ux:verify failed (${failedChecks}/${checks.length} checks failed). Report: ${reportPath}`);
    }
    console.log(`ux:verify passed (${checks.length} checks). Report: ${reportPath}`);
  } catch (error) {
    const failure = {
      ...buildReportBase(),
      failedChecks,
      error: serializeError(error),
    };
    await writeJson(path.join(ARTIFACT_DIR, "report.json"), failure);
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    if (context) {
      await context.close();
    }
    if (browser) {
      await browser.close();
    }
    if (!useExistingServer) {
      await shutdownServer(server);
      if (!process.env.UX_VERIFY_STATE_DIR?.trim() && syntheticStateDir) {
        await fs.rm(syntheticStateDir, { recursive: true, force: true });
      }
    }
  }
}

void main();
