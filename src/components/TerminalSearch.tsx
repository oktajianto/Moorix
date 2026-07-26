import { useEffect, useRef, useState } from "react";
import { ArrowUp, ArrowDown, X, CaseSensitive, WholeWord, Regex } from "lucide-react";
import type { Terminal } from "@xterm/xterm";
import type { SearchAddon, ISearchOptions } from "@xterm/addon-search";

/** Highlight colours for search matches. Active (current) match uses the theme
 *  accent so it stands out; the rest get a translucent yellow wash. */
function decorations(accent: string): ISearchOptions["decorations"] {
  return {
    matchBackground: "#ffd70055",
    matchBorder: "#ffd70088",
    matchOverviewRuler: "#ffd700",
    activeMatchBackground: accent,
    activeMatchBorder: accent,
    activeMatchColorOverviewRuler: accent,
  };
}

/**
 * The Find bar overlaid on a terminal pane (opened with Ctrl+F). Types-to-search
 * incrementally, highlights every match, and shows the current/total count.
 * Enter → next match, Shift+Enter → previous, Esc → close. All searching runs
 * against the pane's `SearchAddon` (loaded in TerminalView).
 */
export function TerminalSearch({
  term,
  search,
  accent,
  openSignal,
  onClose,
}: {
  term: Terminal;
  search: SearchAddon;
  accent: string;
  /** Bumped each time Ctrl+F is pressed — re-focuses and re-seeds the input. */
  openSignal: number;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [result, setResult] = useState({ index: -1, count: 0 });
  const [invalid, setInvalid] = useState(false);

  // Build fresh options each search so a toggle takes effect immediately.
  const optsRef = useRef<ISearchOptions>({});
  optsRef.current = {
    caseSensitive,
    wholeWord,
    regex,
    decorations: decorations(accent),
  };

  // Live match count from the addon (index is -1 when nothing matches).
  useEffect(() => {
    const sub = search.onDidChangeResults((e) => {
      setResult({ index: e.resultIndex, count: e.resultCount });
    });
    return () => sub.dispose();
  }, [search]);

  // On open (and each Ctrl+F while open): seed from the terminal selection if
  // there is one, then focus and select the input's text.
  useEffect(() => {
    const sel = term.hasSelection() ? term.getSelection() : "";
    const seed = sel && !sel.includes("\n") ? sel : "";
    if (seed) setQuery(seed);
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.select();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSignal]);

  // Incremental search whenever the query or an option changes: keep the current
  // match anchored so typing extends the same match instead of jumping around.
  useEffect(() => {
    if (!query) {
      search.clearDecorations();
      setResult({ index: -1, count: 0 });
      setInvalid(false);
      return;
    }
    if (regex) {
      try {
        // eslint-disable-next-line no-new
        new RegExp(query);
      } catch {
        setInvalid(true);
        search.clearDecorations();
        setResult({ index: -1, count: 0 });
        return;
      }
    }
    setInvalid(false);
    search.findNext(query, { ...optsRef.current, incremental: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, caseSensitive, wholeWord, regex]);

  const findNext = () => {
    if (query) search.findNext(query, optsRef.current);
  };
  const findPrevious = () => {
    if (query) search.findPrevious(query, optsRef.current);
  };

  const close = () => {
    search.clearDecorations();
    onClose();
    // Return focus to the terminal so typing resumes immediately.
    term.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) findPrevious();
      else findNext();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  const status = invalid
    ? "Bad pattern"
    : query === ""
      ? ""
      : result.count === 0
        ? "No results"
        : `${result.index + 1}/${result.count}`;

  return (
    <div
      className="absolute right-2 top-2 z-20 flex items-center gap-1 rounded-md border px-1.5 py-1 shadow-lg"
      style={{
        background: "var(--m-panel)",
        borderColor: "var(--m-border)",
        color: "var(--m-text)",
      }}
      // Keep clicks inside the bar from bubbling to the pane focus handlers.
      onPointerDown={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Find"
        spellCheck={false}
        className="w-44 bg-transparent px-1 text-sm outline-none"
        style={{ color: invalid ? "#ff6b6b" : "var(--m-text)" }}
      />
      <span
        className="min-w-[3.5rem] select-none text-right text-xs tabular-nums"
        style={{ color: "var(--m-muted)" }}
      >
        {status}
      </span>
      <Toggle active={caseSensitive} title="Match case" onClick={() => setCaseSensitive((v) => !v)}>
        <CaseSensitive size={15} />
      </Toggle>
      <Toggle active={wholeWord} title="Match whole word" onClick={() => setWholeWord((v) => !v)}>
        <WholeWord size={15} />
      </Toggle>
      <Toggle active={regex} title="Use regular expression" onClick={() => setRegex((v) => !v)}>
        <Regex size={15} />
      </Toggle>
      <Btn title="Previous match (Shift+Enter)" onClick={findPrevious}>
        <ArrowUp size={15} />
      </Btn>
      <Btn title="Next match (Enter)" onClick={findNext}>
        <ArrowDown size={15} />
      </Btn>
      <Btn title="Close (Esc)" onClick={close}>
        <X size={15} />
      </Btn>
    </div>
  );
}

function Btn({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="grid h-6 w-6 place-items-center rounded transition"
      style={{ color: "var(--m-muted)" }}
      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--m-text)")}
      onMouseLeave={(e) => (e.currentTarget.style.color = "var(--m-muted)")}
    >
      {children}
    </button>
  );
}

function Toggle({
  active,
  title,
  onClick,
  children,
}: {
  active: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="grid h-6 w-6 place-items-center rounded transition"
      style={{
        background: active ? "var(--m-accent)" : "transparent",
        color: active ? "var(--m-bg)" : "var(--m-muted)",
      }}
    >
      {children}
    </button>
  );
}
