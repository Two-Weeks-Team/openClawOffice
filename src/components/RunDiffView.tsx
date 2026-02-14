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

function formatRate(value: number | null): string {
  if (value === null) {
    return "-";
  }
  return `${value.toFixed(2)} /min`;
}

function formatErrorPoint(value: number | null): string {
  if (value === null) {
    return "-";
  }
  if (value < 1000) {
    return `${value} ms`;
  }
  return `${(value / 1000).toFixed(2)} s`;
}

function formatEventText(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= 96) {
    return compact;
  }
  return `${compact.slice(0, 93)}...`;
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
        Select different baseline/candidate runs to compute a comparison diff.
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
          label="Candidate Run"
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
        <article>
          <span>Density Delta</span>
          <strong className={deltaClass(runDiff.eventDensityPerMinuteDelta)}>
            {runDiff.eventDensityPerMinuteDelta === null
              ? "-"
              : formatDelta(runDiff.eventDensityPerMinuteDelta, " /min")}
          </strong>
          <small>
            {formatRate(runDiff.baseline.eventDensityPerMinute)} {"->"}{" "}
            {formatRate(runDiff.candidate.eventDensityPerMinute)}
          </small>
        </article>
        <article>
          <span>Error Point Delta</span>
          <strong className={deltaClass(runDiff.errorPointDeltaMs)}>
            {runDiff.errorPointDeltaMs === null ? "-" : formatDelta(runDiff.errorPointDeltaMs, " ms")}
          </strong>
          <small>
            {formatErrorPoint(runDiff.baseline.errorPointMs)} {"->"}{" "}
            {formatErrorPoint(runDiff.candidate.errorPointMs)}
          </small>
        </article>
      </div>
      <div className="detail-diff-columns">
        <article className="detail-diff-column">
          <h4>Task (Baseline)</h4>
          <p>{runDiff.baseline.run.task || "-"}</p>
        </article>
        <article className="detail-diff-column">
          <h4>Task (Candidate)</h4>
          <p>{runDiff.candidate.run.task || "-"}</p>
        </article>
      </div>
      <div className="detail-diff-major-events">
        <article className="detail-diff-column">
          <h4>Major Events Only In Baseline</h4>
          {runDiff.majorEvents.baselineOnly.length === 0 ? (
            <p className="detail-muted">No baseline-only major events.</p>
          ) : (
            <ol>
              {runDiff.majorEvents.baselineOnly.map((event) => (
                <li key={event.id}>
                  <strong>{event.type.toUpperCase()}</strong> {formatErrorPoint(event.offsetMs)} |{" "}
                  {formatEventText(event.text)}
                </li>
              ))}
            </ol>
          )}
        </article>
        <article className="detail-diff-column">
          <h4>Major Events Only In Candidate</h4>
          {runDiff.majorEvents.candidateOnly.length === 0 ? (
            <p className="detail-muted">No candidate-only major events.</p>
          ) : (
            <ol>
              {runDiff.majorEvents.candidateOnly.map((event) => (
                <li key={event.id}>
                  <strong>{event.type.toUpperCase()}</strong> {formatErrorPoint(event.offsetMs)} |{" "}
                  {formatEventText(event.text)}
                </li>
              ))}
            </ol>
          )}
        </article>
      </div>
    </>
  );
}
