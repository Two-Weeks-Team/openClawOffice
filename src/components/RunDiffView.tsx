import type { DetailPanelRunDiff } from "../lib/detail-panel";

type Props = {
  runDiff: DetailPanelRunDiff | null;
  copiedKey: string | null;
  onCopy: (key: string, value: string | undefined) => Promise<void>;
  onJumpToRun?: (runId: string) => void;
};

type RunIdRowProps = {
  label: string;
  runId: string;
  copyKeyPrefix: string;
  copiedKey: string | null;
  onCopy: (key: string, value: string | undefined) => Promise<void>;
  onJumpToRun?: (runId: string) => void;
};

function formatDelta(value: number, suffix = ""): string {
  if (value === 0) {
    return `0${suffix}`;
  }
  return `${value > 0 ? "+" : ""}${value}${suffix}`;
}

function deltaClass(value: number | null): string {
  if (value === null || value === 0) {
    return "";
  }
  return value > 0 ? "detail-diff-worse" : "detail-diff-better";
}

function RunIdRow({
  label,
  runId,
  copyKeyPrefix,
  copiedKey,
  onCopy,
  onJumpToRun,
}: RunIdRowProps) {
  const copyKey = `${copyKeyPrefix}:${runId}`;
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <span className="detail-inline-copy">
          <code>{runId}</code>
          <button
            type="button"
            className="detail-copy-button"
            onClick={() => {
              void onCopy(copyKey, runId);
            }}
          >
            {copiedKey === copyKey ? "Copied" : "Copy"}
          </button>
          {onJumpToRun ? (
            <button
              type="button"
              className="detail-copy-button"
              onClick={() => {
                onJumpToRun(runId);
              }}
            >
              Jump
            </button>
          ) : null}
        </span>
      </dd>
    </div>
  );
}

export function RunDiffView({ runDiff, copiedKey, onCopy, onJumpToRun }: Props) {
  if (!runDiff) {
    return (
      <p className="detail-muted">
        Need at least one SUCCESS run and one ERROR run within recent 6 runs to compute a diff.
      </p>
    );
  }

  return (
    <>
      <dl className="detail-kv">
        <RunIdRow
          label="Baseline Run"
          runId={runDiff.baseline.run.runId}
          copyKeyPrefix="diff-baseline"
          copiedKey={copiedKey}
          onCopy={onCopy}
          onJumpToRun={onJumpToRun}
        />
        <RunIdRow
          label="Error Run"
          runId={runDiff.candidate.run.runId}
          copyKeyPrefix="diff-candidate"
          copiedKey={copiedKey}
          onCopy={onCopy}
          onJumpToRun={onJumpToRun}
        />
        <div>
          <dt>Model</dt>
          <dd>
            {runDiff.baseline.model} {"->"} {runDiff.candidate.model}
            {runDiff.modelChanged ? " (changed)" : " (same)"}
          </dd>
        </div>
      </dl>
      <div className="detail-diff-grid">
        <article>
          <span>Token Delta</span>
          <strong className={deltaClass(runDiff.tokenEstimateDelta)}>
            {formatDelta(runDiff.tokenEstimateDelta)}
          </strong>
        </article>
        <article>
          <span>Latency Delta</span>
          <strong className={deltaClass(runDiff.latencyDeltaMs)}>
            {runDiff.latencyDeltaMs === null ? "-" : formatDelta(runDiff.latencyDeltaMs, " ms")}
          </strong>
        </article>
        <article>
          <span>Event Delta</span>
          <strong className={deltaClass(runDiff.eventCountDelta)}>
            {formatDelta(runDiff.eventCountDelta)}
          </strong>
        </article>
      </div>
    </>
  );
}
