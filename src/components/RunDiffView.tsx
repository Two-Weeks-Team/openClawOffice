import type { DetailPanelRunDiff } from "../lib/detail-panel";

type Props = {
  runDiff: DetailPanelRunDiff | null;
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
  return value > 0 ? "detail-diff-plus" : "detail-diff-minus";
}

export function RunDiffView({ runDiff, copiedKey, onCopy, onJumpToRun }: Props) {
  if (!runDiff) {
    return (
      <p className="detail-muted">
        Need at least one recent SUCCESS run and one ERROR run to compute a diff.
      </p>
    );
  }

  return (
    <>
      <dl className="detail-kv">
        <div>
          <dt>Baseline Run</dt>
          <dd>
            <span className="detail-inline-copy">
              <code>{runDiff.baseline.run.runId}</code>
              <button
                type="button"
                className="detail-copy-button"
                onClick={() => {
                  void onCopy(`diff-baseline:${runDiff.baseline.run.runId}`, runDiff.baseline.run.runId);
                }}
              >
                {copiedKey === `diff-baseline:${runDiff.baseline.run.runId}` ? "Copied" : "Copy"}
              </button>
              {onJumpToRun ? (
                <button
                  type="button"
                  className="detail-copy-button"
                  onClick={() => {
                    onJumpToRun(runDiff.baseline.run.runId);
                  }}
                >
                  Jump
                </button>
              ) : null}
            </span>
          </dd>
        </div>
        <div>
          <dt>Error Run</dt>
          <dd>
            <span className="detail-inline-copy">
              <code>{runDiff.candidate.run.runId}</code>
              <button
                type="button"
                className="detail-copy-button"
                onClick={() => {
                  void onCopy(`diff-candidate:${runDiff.candidate.run.runId}`, runDiff.candidate.run.runId);
                }}
              >
                {copiedKey === `diff-candidate:${runDiff.candidate.run.runId}` ? "Copied" : "Copy"}
              </button>
              {onJumpToRun ? (
                <button
                  type="button"
                  className="detail-copy-button"
                  onClick={() => {
                    onJumpToRun(runDiff.candidate.run.runId);
                  }}
                >
                  Jump
                </button>
              ) : null}
            </span>
          </dd>
        </div>
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
