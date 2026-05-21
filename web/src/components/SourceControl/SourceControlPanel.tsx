import React, { useCallback, useEffect, useMemo, useRef } from "react";
import {
  GitCommit,
  PanelRightClose,
  ChevronDown,
  ChevronRight,
  Plus,
  Minus,
  Undo2,
  ArrowLeft,
  X,
  ExternalLink,
} from "lucide-react";
import { useProjectStore } from "../../stores/projectStore";
import {
  useSourceControlStore,
  diffCacheKey,
  type SelectedFile,
} from "../../stores/sourceControlStore";
import { sendMessage } from "../../hooks/useWebSocket";
import type { ScEntry, ScEntryStatus, ScDiffKind } from "../../lib/protocol";
import { DiffView } from "./DiffView";
import { DiscardConfirm } from "./DiscardConfirm";

const STATUS_LABEL: Record<ScEntryStatus, string> = {
  M: "M",
  A: "A",
  D: "D",
  R: "R",
  C: "C",
  U: "U",
  "?": "U",
};

function statusClasses(status: ScEntryStatus): string {
  switch (status) {
    case "M":
    case "R":
    case "C":
      return "text-[var(--accent)] bg-[var(--accent)]/15";
    case "A":
      return "text-[var(--success)] bg-[var(--success)]/15";
    case "D":
      return "text-[var(--danger)] bg-[var(--danger)]/15";
    case "U":
      return "text-[var(--danger)] bg-[var(--danger)]/15";
    case "?":
      return "text-[var(--text-muted)] bg-[var(--surface-3)]";
  }
}

interface GroupProps {
  label: string;
  kind: "staged" | "changes" | "untracked" | "conflicted";
  entries: ScEntry[];
  onPrimaryAction: (entry: ScEntry) => void;
  onSecondaryAction?: (entry: ScEntry) => void;
  onOpenFile: (entry: ScEntry) => void;
  primaryIcon: React.ReactNode;
  primaryTitle: string;
  secondaryIcon?: React.ReactNode;
  secondaryTitle?: string;
  onSelectFile: (entry: ScEntry) => void;
  selectedPath: string | null;
}

function Group({
  label,
  kind,
  entries,
  onPrimaryAction,
  onSecondaryAction,
  onOpenFile,
  primaryIcon,
  primaryTitle,
  secondaryIcon,
  secondaryTitle,
  onSelectFile,
  selectedPath,
}: GroupProps) {
  const expanded = useSourceControlStore((s) => s.expanded[kind]);
  const toggleGroup = useSourceControlStore((s) => s.toggleGroup);
  if (entries.length === 0) return null;

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => toggleGroup(kind)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs uppercase tracking-wide text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="font-medium">{label}</span>
        <span className="ml-auto text-[var(--text-muted)]">{entries.length}</span>
      </button>
      {expanded && (
        <div className="flex flex-col">
          {entries.map((entry) => {
            const isSelected = selectedPath === entry.path;
            return (
              <div
                key={`${kind}:${entry.path}`}
                onClick={() => onSelectFile(entry)}
                className={`group flex items-center gap-2 px-3 py-1 text-xs cursor-pointer ${
                  isSelected
                    ? "bg-[var(--surface-2)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"
                }`}
              >
                <span
                  className={`inline-flex items-center justify-center w-4 h-4 rounded text-[10px] font-semibold ${statusClasses(entry.status)}`}
                  title={statusFullName(entry.status)}
                >
                  {STATUS_LABEL[entry.status]}
                </span>
                <span className="truncate flex-1" title={entry.path}>
                  {entry.oldPath ? (
                    <>
                      <span className="text-[var(--text-muted)] line-through">{entry.oldPath}</span>
                      <span className="mx-1 text-[var(--text-muted)]">→</span>
                      {entry.path}
                    </>
                  ) : (
                    entry.path
                  )}
                </span>
                <div className="hidden group-hover:flex items-center gap-1">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenFile(entry);
                    }}
                    title="Open in default editor"
                    className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)]"
                  >
                    <ExternalLink size={12} />
                  </button>
                  {onSecondaryAction && secondaryIcon && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSecondaryAction(entry);
                      }}
                      title={secondaryTitle}
                      className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)]"
                    >
                      {secondaryIcon}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPrimaryAction(entry);
                    }}
                    title={primaryTitle}
                    className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)]"
                  >
                    {primaryIcon}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function statusFullName(status: ScEntryStatus): string {
  switch (status) {
    case "M":
      return "Modified";
    case "A":
      return "Added";
    case "D":
      return "Deleted";
    case "R":
      return "Renamed";
    case "C":
      return "Copied";
    case "U":
      return "Conflict";
    case "?":
      return "Untracked";
  }
}

export function SourceControlPanel() {
  const panelOpen = useSourceControlStore((s) => s.panelOpen);
  const panelWidth = useSourceControlStore((s) => s.panelWidth);
  const setPanelWidth = useSourceControlStore((s) => s.setPanelWidth);
  const togglePanel = useSourceControlStore((s) => s.togglePanel);

  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const status = useSourceControlStore((s) =>
    activeProjectId ? s.statusByProject[activeProjectId] : null,
  );
  const selectedFile = useSourceControlStore((s) => s.selectedFile);
  const selectFile = useSourceControlStore((s) => s.selectFile);
  const diffCache = useSourceControlStore((s) => s.diffCache);
  const commitDraft = useSourceControlStore((s) =>
    activeProjectId ? s.commitDrafts[activeProjectId] ?? "" : "",
  );
  const setCommitDraft = useSourceControlStore((s) => s.setCommitDraft);
  const lastActionError = useSourceControlStore((s) => s.lastActionError);
  const clearActionError = useSourceControlStore((s) => s.clearActionError);
  const requestDiscard = useSourceControlStore((s) => s.requestDiscard);

  const resizing = useRef(false);
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizing.current = true;
      const onMove = (ev: MouseEvent) => {
        // Right-side panel: width = viewport - clientX
        requestAnimationFrame(() => setPanelWidth(window.innerWidth - ev.clientX));
      };
      const onUp = () => {
        resizing.current = false;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [setPanelWidth],
  );

  // Fetch diff when selection or status changes. Cached value shows immediately
  // (if any) while the fresh response is in flight.
  useEffect(() => {
    if (!selectedFile || !activeProjectId) return;
    sendMessage({
      type: "sc:diff:request",
      projectId: activeProjectId,
      file: selectedFile.path,
      kind: selectedFile.kind,
    });
  }, [selectedFile, activeProjectId, status]);

  const onStage = useCallback(
    (entry: ScEntry) => {
      if (!activeProjectId) return;
      sendMessage({ type: "sc:stage", projectId: activeProjectId, files: [entry.path] });
    },
    [activeProjectId],
  );

  const onUnstage = useCallback(
    (entry: ScEntry) => {
      if (!activeProjectId) return;
      sendMessage({ type: "sc:unstage", projectId: activeProjectId, files: [entry.path] });
    },
    [activeProjectId],
  );

  const onDiscardSingle = useCallback(
    (entry: ScEntry, untracked: boolean) => {
      requestDiscard(untracked ? [] : [entry.path], untracked ? [entry.path] : []);
    },
    [requestDiscard],
  );

  const onCommit = useCallback(() => {
    if (!activeProjectId || !commitDraft.trim()) return;
    sendMessage({ type: "sc:commit", projectId: activeProjectId, message: commitDraft });
  }, [activeProjectId, commitDraft]);

  const onOpenFile = useCallback(
    (entry: ScEntry) => {
      if (!activeProjectId) return;
      sendMessage({ type: "open:file", projectId: activeProjectId, path: entry.path });
    },
    [activeProjectId],
  );

  const onStageAll = useCallback(() => {
    if (!activeProjectId || !status) return;
    const files = [
      ...status.changes.map((e) => e.path),
      ...status.untracked.map((e) => e.path),
    ];
    if (files.length === 0) return;
    sendMessage({ type: "sc:stage", projectId: activeProjectId, files });
  }, [activeProjectId, status]);

  const selectedKey = useMemo(() => {
    if (!selectedFile || !activeProjectId) return null;
    return diffCacheKey(activeProjectId, selectedFile.path, selectedFile.kind);
  }, [selectedFile, activeProjectId]);

  if (!panelOpen) return null;

  const handleSelect = (entry: ScEntry, kind: ScDiffKind) => {
    const next: SelectedFile = { path: entry.path, kind };
    if (
      selectedFile &&
      selectedFile.path === entry.path &&
      selectedFile.kind === kind
    ) {
      selectFile(null);
    } else {
      selectFile(next);
    }
  };

  const stagedCount = status?.staged.length ?? 0;

  return (
    <div
      className="relative flex-shrink-0 bg-[var(--surface-1)] border-l border-[var(--border)] flex flex-col h-full"
      style={{ width: panelWidth }}
    >
      {/* Resize handle (left edge) */}
      <div
        className="absolute top-0 left-0 w-1 h-full cursor-col-resize z-10 hover:bg-[var(--accent)] active:bg-[var(--accent)] opacity-0 hover:opacity-40 active:opacity-60 transition-opacity"
        onMouseDown={handleResizeStart}
      />

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        <span className="text-sm font-semibold tracking-tight text-[var(--text-primary)]">
          Source Control
        </span>
        <button
          type="button"
          onClick={togglePanel}
          title="Close panel (⌘⇧G)"
          className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          <PanelRightClose size={16} />
        </button>
      </div>

      {!activeProjectId ? (
        <div className="flex-1 flex items-center justify-center text-xs text-[var(--text-muted)] px-4 text-center">
          Open a project to view changes.
        </div>
      ) : !status ? (
        <div className="flex-1 flex items-center justify-center text-xs text-[var(--text-muted)] px-4 text-center">
          Not a git repository, or no git available.
        </div>
      ) : (
        <>
          {/* Commit box */}
          <div className="px-3 py-3 border-b border-[var(--border)] flex flex-col gap-2">
            <textarea
              value={commitDraft}
              onChange={(e) => setCommitDraft(activeProjectId, e.target.value)}
              placeholder={
                stagedCount > 0
                  ? `Commit message (${stagedCount} staged ${stagedCount === 1 ? "file" : "files"})`
                  : "Stage files to commit"
              }
              rows={2}
              className="resize-none w-full px-2 py-1.5 text-xs rounded bg-[var(--surface-0)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onCommit}
                disabled={stagedCount === 0 || !commitDraft.trim()}
                className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded bg-[var(--accent)] text-[var(--surface-0)] font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90"
              >
                <GitCommit size={12} />
                Commit
              </button>
              {(status.changes.length > 0 || status.untracked.length > 0) && (
                <button
                  type="button"
                  onClick={onStageAll}
                  title="Stage all changes"
                  className="px-2 py-1.5 text-xs rounded border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)]"
                >
                  Stage all
                </button>
              )}
            </div>
          </div>

          {/* Body — diff view or file list */}
          {selectedFile ? (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] bg-[var(--surface-1)]">
                <button
                  type="button"
                  onClick={() => selectFile(null)}
                  title="Back to file list"
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  <ArrowLeft size={14} />
                </button>
                <span className="text-xs text-[var(--text-secondary)] truncate flex-1" title={selectedFile.path}>
                  {selectedFile.path}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    activeProjectId &&
                    sendMessage({
                      type: "open:file",
                      projectId: activeProjectId,
                      path: selectedFile.path,
                    })
                  }
                  title="Open in default editor"
                  className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)]"
                >
                  <ExternalLink size={13} />
                </button>
                <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                  {selectedFile.kind}
                </span>
              </div>
              <div className="flex-1 min-h-0 overflow-auto">
                <DiffView
                  data={selectedKey ? diffCache[selectedKey] : undefined}
                  filePath={selectedFile.path}
                />
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-auto">
              <Group
                label="Conflicted"
                kind="conflicted"
                entries={status.conflicted}
                onPrimaryAction={() => {}}
                onOpenFile={onOpenFile}
                primaryIcon={<></>}
                primaryTitle=""
                onSelectFile={(e) => handleSelect(e, "conflicted")}
                selectedPath={selectedFile ? (selectedFile as SelectedFile).path : null}
              />
              <Group
                label="Staged Changes"
                kind="staged"
                entries={status.staged}
                onPrimaryAction={onUnstage}
                onOpenFile={onOpenFile}
                primaryIcon={<Minus size={12} />}
                primaryTitle="Unstage"
                onSelectFile={(e) => handleSelect(e, "staged")}
                selectedPath={selectedFile ? (selectedFile as SelectedFile).path : null}
              />
              <Group
                label="Changes"
                kind="changes"
                entries={status.changes}
                onPrimaryAction={onStage}
                onSecondaryAction={(e) => onDiscardSingle(e, false)}
                onOpenFile={onOpenFile}
                primaryIcon={<Plus size={12} />}
                primaryTitle="Stage"
                secondaryIcon={<Undo2 size={12} />}
                secondaryTitle="Discard changes"
                onSelectFile={(e) => handleSelect(e, "unstaged")}
                selectedPath={selectedFile ? (selectedFile as SelectedFile).path : null}
              />
              <Group
                label="Untracked"
                kind="untracked"
                entries={status.untracked}
                onPrimaryAction={onStage}
                onSecondaryAction={(e) => onDiscardSingle(e, true)}
                onOpenFile={onOpenFile}
                primaryIcon={<Plus size={12} />}
                primaryTitle="Stage"
                secondaryIcon={<Undo2 size={12} />}
                secondaryTitle="Delete file"
                onSelectFile={(e) => handleSelect(e, "untracked")}
                selectedPath={selectedFile ? (selectedFile as SelectedFile).path : null}
              />
              {status.staged.length === 0 &&
                status.changes.length === 0 &&
                status.untracked.length === 0 &&
                status.conflicted.length === 0 && (
                  <div className="text-xs text-[var(--text-muted)] px-4 py-8 text-center">
                    Working tree clean.
                  </div>
                )}
            </div>
          )}
        </>
      )}

      {/* Error toast */}
      {lastActionError && (
        <div className="absolute bottom-2 left-2 right-2 px-3 py-2 bg-[var(--danger)]/10 border border-[var(--danger)]/40 rounded text-xs text-[var(--danger)] flex items-start gap-2">
          <span className="flex-1 break-all">{lastActionError}</span>
          <button onClick={clearActionError} className="text-[var(--danger)] hover:opacity-70">
            <X size={12} />
          </button>
        </div>
      )}

      <DiscardConfirm />
    </div>
  );
}
