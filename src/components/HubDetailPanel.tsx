/**
 * Slide-in detail panel for the Hub dashboard (L3 progressive disclosure).
 * Supports deep-dive into docs, changelog, channels, and skills.
 * Fetches full document content on demand with AbortController for race-safety.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { parseMarkdownToSections, type MarkdownSection } from "../lib/openclaw-hub";
import type { OpenClawChangelogEntry, OpenClawChannelInfo, OpenClawSkillInfo } from "../../server/openclaw-hub-types";

/** Discriminated union for the four detail panel content types. */
type DetailTarget =
  | { kind: "doc"; path: string; title: string }
  | { kind: "changelog"; entry: OpenClawChangelogEntry }
  | { kind: "channel"; channel: OpenClawChannelInfo }
  | { kind: "skill"; skill: OpenClawSkillInfo };

type Props = {
  target: DetailTarget | null;
  onClose: () => void;
};

export type { DetailTarget };

export function HubDetailPanel({ target, onClose }: Props) {
  const [docContent, setDocContent] = useState<string | null>(null);
  const [docSections, setDocSections] = useState<MarkdownSection[]>([]);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!target) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [target, onClose]);

  const loadDoc = useCallback(async (docPath: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setDocLoading(true);
    setDocError(null);
    try {
      const response = await fetch(
        `/api/office/openclaw-hub/doc?path=${encodeURIComponent(docPath)}`,
        { signal: controller.signal },
      );
      if (!response.ok) {
        throw new Error(`Failed to load document (${response.status})`);
      }
      const data = (await response.json()) as { content: string };
      if (!controller.signal.aborted) {
        setDocContent(data.content);
        setDocSections(parseMarkdownToSections(data.content));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setDocError(err instanceof Error ? err.message : String(err));
      setDocContent(null);
      setDocSections([]);
    } finally {
      if (!controller.signal.aborted) {
        setDocLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (target?.kind === "doc") {
      void loadDoc(target.path);
    } else {
      setDocContent(null);
      setDocSections([]);
    }
    return () => abortRef.current?.abort();
  }, [target, loadDoc]);

  if (!target) return null;

  return (
    <aside className="hub-detail-panel" aria-label="Hub detail panel">
      <header className="hub-detail-panel-header">
        <h3>
          {target.kind === "doc" && target.title}
          {target.kind === "changelog" && `Changelog ${target.entry.version}`}
          {target.kind === "channel" && `Channel: ${target.channel.name}`}
          {target.kind === "skill" && `Skill: ${target.skill.name}`}
        </h3>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </header>

      <div className="hub-detail-panel-body">
        {target.kind === "doc" && (
          <div className="hub-doc-content">
            {docLoading && <p className="hub-loading">Loading document...</p>}
            {docError && <p className="hub-error">{docError}</p>}
            {docContent && !docLoading && (
              <>
                {docSections.length > 0 ? (
                  docSections.map((section, i) => (
                    <section key={`${section.heading}-${i}`}>
                      {section.heading && <h4>{section.heading}</h4>}
                      <pre className="hub-doc-pre">{section.body}</pre>
                    </section>
                  ))
                ) : (
                  <pre className="hub-doc-pre">{docContent}</pre>
                )}
              </>
            )}
          </div>
        )}

        {target.kind === "changelog" && (
          <div className="hub-changelog-content">
            <dl className="hub-detail-kv">
              <div>
                <dt>Version</dt>
                <dd>{target.entry.version}</dd>
              </div>
              <div>
                <dt>Changes</dt>
                <dd>{target.entry.changedCount}</dd>
              </div>
              <div>
                <dt>Fixes</dt>
                <dd>{target.entry.fixedCount}</dd>
              </div>
              <div>
                <dt>Added</dt>
                <dd>{target.entry.addedCount}</dd>
              </div>
            </dl>
            {target.entry.highlights.length > 0 && (
              <section>
                <h4>Highlights</h4>
                <ul className="hub-highlight-list">
                  {target.entry.highlights.map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}

        {target.kind === "channel" && (
          <div className="hub-channel-content">
            <dl className="hub-detail-kv">
              <div>
                <dt>Name</dt>
                <dd>{target.channel.name}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd><code>{target.channel.sourceDir}</code></dd>
              </div>
              <div>
                <dt>Files</dt>
                <dd>{target.channel.fileCount}</dd>
              </div>
            </dl>
          </div>
        )}

        {target.kind === "skill" && (
          <div className="hub-skill-content">
            <dl className="hub-detail-kv">
              <div>
                <dt>Name</dt>
                <dd>{target.skill.name}</dd>
              </div>
              <div>
                <dt>Path</dt>
                <dd><code>{target.skill.path}</code></dd>
              </div>
            </dl>
          </div>
        )}
      </div>
    </aside>
  );
}
