import { useEffect, useMemo, useRef, useState } from "react";
import { filterCommandIds } from "../lib/command-palette";
import { useFocusTrap } from "../hooks/useFocusTrap";

export type CommandPaletteEntry = {
  id: string;
  label: string;
  description: string;
  section: string;
  shortcutLabel: string;
  keywords?: string[];
  disabled?: boolean;
};

type Props = {
  commands: CommandPaletteEntry[];
  recentCommandIds: string[];
  onClose: () => void;
  onExecute: (commandId: string) => void;
  onOpenHelp: () => void;
};

export function CommandPalette({
  commands,
  recentCommandIds,
  onClose,
  onExecute,
  onOpenHelp,
}: Props) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const focusTrapRef = useFocusTrap<HTMLDivElement>(true);

  const commandById = useMemo(
    () => new Map(commands.map((command) => [command.id, command])),
    [commands],
  );

  const filteredIds = useMemo(
    () =>
      filterCommandIds(
        commands.map((command) => ({
          id: command.id,
          label: command.label,
          description: command.description,
          keywords: command.keywords,
        })),
        query,
      ),
    [commands, query],
  );

  const visibleCommands = useMemo(
    () => filteredIds.map((id) => commandById.get(id)).filter((value): value is CommandPaletteEntry => Boolean(value)),
    [commandById, filteredIds],
  );

  const orderedCommands = useMemo(() => {
    if (query.trim()) {
      return visibleCommands;
    }
    const recent = recentCommandIds
      .map((id) => commandById.get(id))
      .filter((value): value is CommandPaletteEntry => Boolean(value));
    const recentSet = new Set(recent.map((entry) => entry.id));
    const rest = visibleCommands.filter((entry) => !recentSet.has(entry.id));
    return [...recent, ...rest];
  }, [commandById, query, recentCommandIds, visibleCommands]);

  const activeCommandIndex =
    orderedCommands.length === 0 ? 0 : Math.min(activeIndex, orderedCommands.length - 1);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) => {
          if (orderedCommands.length === 0) {
            return 0;
          }
          return (current + 1) % orderedCommands.length;
        });
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) => {
          if (orderedCommands.length === 0) {
            return 0;
          }
          return (current - 1 + orderedCommands.length) % orderedCommands.length;
        });
        return;
      }

      if (event.key === "Enter") {
        const selectedCommand = orderedCommands[activeCommandIndex];
        if (!selectedCommand || selectedCommand.disabled) {
          return;
        }
        event.preventDefault();
        onExecute(selectedCommand.id);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeCommandIndex, onClose, onExecute, orderedCommands]);

  return (
    <div
      ref={focusTrapRef}
      className="command-palette-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section className="command-palette" role="dialog" aria-modal="true" aria-label="Command Palette">
        <header className="command-palette-header">
          <div>
            <h2>Command Palette</h2>
            <p>Search commands, jump entities, and run keyboard actions.</p>
          </div>
          <button type="button" onClick={onOpenHelp}>
            Shortcut Help
          </button>
        </header>

        <label className="command-palette-search">
          Find command
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder="Search by command, shortcut, or keyword..."
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
          />
        </label>

        {orderedCommands.length === 0 ? (
          <p className="command-palette-empty">No commands match this query.</p>
        ) : (
          <ol className="command-palette-list">
            {orderedCommands.map((command, index) => {
              const isRecent = !query.trim() && recentCommandIds.includes(command.id);
              return (
                <li
                  key={command.id}
                  className={`command-palette-item ${index === activeCommandIndex ? "is-active" : ""} ${
                    command.disabled ? "is-disabled" : ""
                  }`}
                >
                  <button
                    type="button"
                    disabled={command.disabled}
                    onMouseEnter={() => {
                      setActiveIndex(index);
                    }}
                    onClick={() => {
                      onExecute(command.id);
                    }}
                  >
                    <div className="command-palette-main">
                      <div className="command-palette-label-row">
                        <strong>{command.label}</strong>
                        <span className="command-palette-section">{command.section}</span>
                        {isRecent ? <span className="command-palette-recent">Recent</span> : null}
                      </div>
                      <p>{command.description}</p>
                    </div>
                    <kbd>{command.shortcutLabel || "-"}</kbd>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
