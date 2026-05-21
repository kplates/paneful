import React, { useMemo, useState } from "react";
import type { DiffData } from "../../stores/sourceControlStore";
import { detectLanguage, highlightCode } from "../../lib/syntax-highlight";

const INITIAL_LINE_LIMIT = 500;

type LineType = "add" | "del" | "ctx" | "hunk";

interface DiffLine {
  type: LineType;
  oldNo: number | null;
  newNo: number | null;
  text: string;
  // For hunk lines only: parsed range for compact display
  hunkRange?: { oldStart: number; oldCount: number; newStart: number; newCount: number };
}

function parseDiff(text: string): DiffLine[] {
  const lines = text.split("\n");
  const out: DiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      const m = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (m) {
        const oldStart = parseInt(m[1], 10);
        const oldCount = m[2] ? parseInt(m[2], 10) : 1;
        const newStart = parseInt(m[3], 10);
        const newCount = m[4] ? parseInt(m[4], 10) : 1;
        oldNo = oldStart;
        newNo = newStart;
        out.push({
          type: "hunk",
          oldNo: null,
          newNo: null,
          text: "",
          hunkRange: { oldStart, oldCount, newStart, newCount },
        });
      }
      inHunk = true;
      continue;
    }
    // Skip everything before the first hunk (diff --git, index, ---, +++, new file mode, etc.)
    if (!inHunk) continue;

    if (line.startsWith("+")) {
      out.push({ type: "add", oldNo: null, newNo, text: line.slice(1) });
      newNo++;
    } else if (line.startsWith("-")) {
      out.push({ type: "del", oldNo, newNo: null, text: line.slice(1) });
      oldNo++;
    } else if (line.startsWith(" ")) {
      out.push({ type: "ctx", oldNo, newNo, text: line.slice(1) });
      oldNo++;
      newNo++;
    } else if (line.length === 0) {
      // empty context line (git sometimes omits the leading space)
      out.push({ type: "ctx", oldNo, newNo, text: "" });
      oldNo++;
      newNo++;
    }
    // ignore "\ No newline at end of file" and anything else
  }
  return out;
}

function hunkLabel(range: { oldStart: number; oldCount: number; newStart: number; newCount: number }): string {
  // If this is a brand-new file (oldStart=0), just show the range from new
  if (range.oldCount === 0) {
    return range.newCount === 1
      ? `Line ${range.newStart}`
      : `Lines ${range.newStart}–${range.newStart + range.newCount - 1}`;
  }
  if (range.newCount === 0) {
    return range.oldCount === 1
      ? `Line ${range.oldStart} (deleted)`
      : `Lines ${range.oldStart}–${range.oldStart + range.oldCount - 1} (deleted)`;
  }
  const newEnd = range.newStart + range.newCount - 1;
  return range.newCount === 1
    ? `Line ${range.newStart}`
    : `Lines ${range.newStart}–${newEnd}`;
}

function rowClass(type: LineType): string {
  switch (type) {
    case "add":
      return "bg-emerald-500/10 hover:bg-emerald-500/15";
    case "del":
      return "bg-rose-500/10 hover:bg-rose-500/15";
    case "hunk":
      return "bg-[var(--surface-2)]";
    case "ctx":
    default:
      return "hover:bg-[var(--surface-2)]";
  }
}

function markerClass(type: LineType): string {
  switch (type) {
    case "add":
      return "text-emerald-500";
    case "del":
      return "text-rose-500";
    default:
      return "text-[var(--text-muted)]";
  }
}

interface Props {
  data: DiffData | undefined;
  filePath: string;
}

export function DiffView({ data, filePath }: Props) {
  const [showAll, setShowAll] = useState(false);
  const lang = useMemo(() => detectLanguage(filePath), [filePath]);
  const parsed = useMemo(() => (data ? parseDiff(data.diff) : []), [data]);
  const hunkCount = useMemo(() => parsed.filter((l) => l.type === "hunk").length, [parsed]);
  // With full-file context (-U99999), almost every diff has a single hunk that covers
  // the whole file. The "Lines 1–N" separator adds no information — hide it. Keep it
  // only when there are multiple hunks, so the user can see the jump in line numbers.
  const renderable = useMemo(
    () => (hunkCount <= 1 ? parsed.filter((l) => l.type !== "hunk") : parsed),
    [parsed, hunkCount],
  );

  if (!data) {
    return (
      <div className="text-xs text-[var(--text-muted)] px-4 py-6 text-center">
        Loading diff…
      </div>
    );
  }

  if (data.binary) {
    return (
      <div className="text-xs text-[var(--text-muted)] px-4 py-6 text-center">
        Binary file — no preview available.
      </div>
    );
  }

  if (data.diff.length === 0) {
    return (
      <div className="text-xs text-[var(--text-muted)] px-4 py-6 text-center">
        No changes.
      </div>
    );
  }

  const visible = showAll ? renderable : renderable.slice(0, INITIAL_LINE_LIMIT);
  const truncatedLines = renderable.length > INITIAL_LINE_LIMIT && !showAll;

  return (
    <div className="font-mono text-[11px] leading-[1.5]">
      <table className="w-full border-collapse">
        <colgroup>
          <col className="w-10" />
          <col className="w-10" />
          <col className="w-4" />
          <col />
        </colgroup>
        <tbody>
          {visible.map((line, i) => {
            if (line.type === "hunk") {
              // Only rendered when multiple hunks exist (file has gaps not covered by -U99999).
              // Acts as a "jumped to line X" separator.
              return (
                <tr key={i} className={rowClass(line.type)}>
                  <td
                    colSpan={4}
                    className="px-3 py-1 text-[10px] uppercase tracking-wide text-[var(--text-muted)] border-y border-[var(--border)]/60 text-center"
                  >
                    {line.hunkRange ? `··· ${hunkLabel(line.hunkRange)} ···` : "···"}
                  </td>
                </tr>
              );
            }
            const marker = line.type === "add" ? "+" : line.type === "del" ? "-" : " ";
            return (
              <tr key={i} className={rowClass(line.type)}>
                <td className="select-none pl-2 pr-1 text-right text-[var(--text-muted)] align-top tabular-nums">
                  {line.oldNo ?? ""}
                </td>
                <td className="select-none pr-2 pl-1 text-right text-[var(--text-muted)] align-top tabular-nums border-r border-[var(--border)]/40">
                  {line.newNo ?? ""}
                </td>
                <td className={`select-none px-1 align-top ${markerClass(line.type)}`}>
                  {marker}
                </td>
                <td className="pr-3 whitespace-pre align-top break-all">
                  <span
                    className="sc-code"
                    dangerouslySetInnerHTML={{ __html: highlightCode(line.text, lang) || " " }}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {truncatedLines && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="w-full px-3 py-2 text-xs text-[var(--accent)] hover:bg-[var(--surface-2)] border-t border-[var(--border)]"
        >
          Show {parsed.length - INITIAL_LINE_LIMIT} more lines
        </button>
      )}
      {data.truncated && (
        <div className="px-3 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--border)] text-center">
          Diff truncated by server (too large).
        </div>
      )}
    </div>
  );
}
