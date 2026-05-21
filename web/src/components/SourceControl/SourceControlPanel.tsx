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
  GitBranch,
  ArrowUp,
  ArrowDown,
  Archive,
  ArchiveRestore,
  Loader2,
  CloudUpload,
  CloudDownload,
} from "lucide-react";
import { useProjectStore } from "../../stores/projectStore";
import { useSessionStore } from "../../stores/sessionStore";
import {
  useSourceControlStore,
  diffCacheKey,
  type SelectedFile,
  type GroupKind,
} from "../../stores/sourceControlStore";
import { sendMessage } from "../../hooks/useWebSocket";
import type {
  ScEntry,
  ScEntryStatus,
  ScDiffKind,
  ScAction,
  ScStashEntry,
} from "../../lib/protocol";
import { DiffView } from "./DiffView";
import { DiscardConfirm } from "./DiscardConfirm";
import { StashCreateDialog } from "./StashCreateDialog";

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
    case "U":
      return "text-[var(--danger)] bg-[var(--danger)]/15";
    case "?":
      return "text-[var(--text-muted)] bg-[var(--surface-3)]";
  }
}

function statusFullName(status: ScEntryStatus): string {
  switch (status) {
    case "M": return "Modified";
    case "A": return "Added";
    case "D": return "Deleted";
    case "R": return "Renamed";
    case "C": return "Copied";
    case "U": return "Conflict";
    case "?": return "Untracked";
  }
}

function selectionKey(group: GroupKind, path: string): string {
  return `${group}::${path}`;
}

function pathsForGroup(selected: Set<string>, group: GroupKind): string[] {
  const prefix = `${group}::`;
  const out: string[] = [];
  for (const key of selected) {
    if (key.startsWith(prefix)) out.push(key.slice(prefix.length));
  }
  return out;
}

interface FileRowProps {
  entry: ScEntry;
  group: GroupKind;
  diffKind: ScDiffKind;
  index: number;
  groupEntries: ScEntry[];
  isSelected: boolean;
  isFocused: boolean;
  onClick: (e: React.MouseEvent, entry: ScEntry, group: GroupKind, index: number, groupEntries: ScEntry[], diffKind: ScDiffKind) => void;
  onOpen: (entry: ScEntry) => void;
  onPrimary?: (entry: ScEntry) => void;
  onSecondary?: (entry: ScEntry) => void;
  primaryIcon?: React.ReactNode;
  primaryTitle?: string;
  secondaryIcon?: React.ReactNode;
  secondaryTitle?: string;
}

function FileRow({
  entry,
  group,
  diffKind,
  index,
  groupEntries,
  isSelected,
  isFocused,
  onClick,
  onOpen,
  onPrimary,
  onSecondary,
  primaryIcon,
  primaryTitle,
  secondaryIcon,
  secondaryTitle,
}: FileRowProps) {
  return (
    <div
      onClick={(e) => onClick(e, entry, group, index, groupEntries, diffKind)}
      className={`group flex items-center gap-2 px-3 py-1 text-xs cursor-pointer select-none ${
        isSelected
          ? "bg-[var(--accent)]/20 text-[var(--text-primary)]"
          : isFocused
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
            onOpen(entry);
          }}
          title="Open in default editor"
          className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)]"
        >
          <ExternalLink size={12} />
        </button>
        {onSecondary && secondaryIcon && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSecondary(entry);
            }}
            title={secondaryTitle}
            className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)]"
          >
            {secondaryIcon}
          </button>
        )}
        {onPrimary && primaryIcon && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPrimary(entry);
            }}
            title={primaryTitle}
            className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)]"
          >
            {primaryIcon}
          </button>
        )}
      </div>
    </div>
  );
}

interface GroupProps {
  label: string;
  group: GroupKind;
  diffKind: ScDiffKind;
  entries: ScEntry[];
  selectedPaths: Set<string>;
  focusedPath: string | null;
  onRowClick: FileRowProps["onClick"];
  onOpen: (entry: ScEntry) => void;
  onPrimary?: (entry: ScEntry) => void;
  onSecondary?: (entry: ScEntry) => void;
  primaryIcon?: React.ReactNode;
  primaryTitle?: string;
  secondaryIcon?: React.ReactNode;
  secondaryTitle?: string;
}

function Group({
  label,
  group,
  diffKind,
  entries,
  selectedPaths,
  focusedPath,
  onRowClick,
  onOpen,
  onPrimary,
  onSecondary,
  primaryIcon,
  primaryTitle,
  secondaryIcon,
  secondaryTitle,
}: GroupProps) {
  const expanded = useSourceControlStore((s) => s.expanded[group]);
  const toggleGroup = useSourceControlStore((s) => s.toggleGroup);
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => toggleGroup(group)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs uppercase tracking-wide text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="font-medium">{label}</span>
        <span className="ml-auto text-[var(--text-muted)]">{entries.length}</span>
      </button>
      {expanded && (
        <div className="flex flex-col">
          {entries.map((entry, i) => {
            const key = selectionKey(group, entry.path);
            return (
              <FileRow
                key={key}
                entry={entry}
                group={group}
                diffKind={diffKind}
                index={i}
                groupEntries={entries}
                isSelected={selectedPaths.has(key)}
                isFocused={focusedPath === entry.path && selectedPaths.size === 0}
                onClick={onRowClick}
                onOpen={onOpen}
                onPrimary={onPrimary}
                onSecondary={onSecondary}
                primaryIcon={primaryIcon}
                primaryTitle={primaryTitle}
                secondaryIcon={secondaryIcon}
                secondaryTitle={secondaryTitle}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function BranchBar() {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const gitBranches = useSessionStore((s) => s.gitBranches);
  const branch = activeProjectId ? gitBranches[activeProjectId] : null;
  const inFlight = useSourceControlStore((s) => s.inFlight);
  const setInFlight = useSourceControlStore((s) => s.setActionInFlight);

  if (!activeProjectId || !branch) return null;

  const pulling = inFlight.has("pull");
  const pushing = inFlight.has("push");

  const onPull = () => {
    if (!activeProjectId || pulling) return;
    setInFlight("pull", true);
    sendMessage({ type: "sc:pull", projectId: activeProjectId });
  };
  const onPush = () => {
    if (!activeProjectId || pushing) return;
    setInFlight("push", true);
    sendMessage({ type: "sc:push", projectId: activeProjectId });
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] text-xs">
      <GitBranch size={12} className="text-[var(--text-muted)] flex-shrink-0" />
      <span className="text-[var(--text-secondary)] truncate" title={branch.branch}>
        {branch.branch}
      </span>
      {branch.behind > 0 && (
        <span className="flex items-center text-[var(--text-muted)]" title={`${branch.behind} commits behind`}>
          <ArrowDown size={10} />
          {branch.behind}
        </span>
      )}
      {branch.ahead > 0 && (
        <span className="flex items-center text-[var(--text-muted)]" title={`${branch.ahead} commits ahead`}>
          <ArrowUp size={10} />
          {branch.ahead}
        </span>
      )}
      <div className="flex-1" />
      <button
        type="button"
        onClick={onPull}
        disabled={pulling}
        title="Pull (fast-forward only)"
        className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)] disabled:opacity-40"
      >
        {pulling ? <Loader2 size={12} className="animate-spin" /> : <CloudDownload size={12} />}
      </button>
      <button
        type="button"
        onClick={onPush}
        disabled={pushing}
        title="Push"
        className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)] disabled:opacity-40"
      >
        {pushing ? <Loader2 size={12} className="animate-spin" /> : <CloudUpload size={12} />}
      </button>
    </div>
  );
}

interface StashSectionProps {
  stashes: ScStashEntry[];
  projectId: string;
}

function StashSection({ stashes, projectId }: StashSectionProps) {
  const expanded = useSourceControlStore((s) => s.expanded.stash);
  const toggleGroup = useSourceControlStore((s) => s.toggleGroup);
  const openStashCreate = useSourceControlStore((s) => s.openStashCreate);
  const setInFlight = useSourceControlStore((s) => s.setActionInFlight);
  const inFlight = useSourceControlStore((s) => s.inFlight);

  const send = (action: "pop" | "apply" | "drop", index: number) => {
    const actionKey = `stash:${action}` as ScAction;
    setInFlight(actionKey, true);
    if (action === "pop") sendMessage({ type: "sc:stash:pop", projectId, index });
    else if (action === "apply") sendMessage({ type: "sc:stash:apply", projectId, index });
    else sendMessage({ type: "sc:stash:drop", projectId, index });
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center px-3 py-1.5 text-xs uppercase tracking-wide text-[var(--text-secondary)]">
        <button
          type="button"
          onClick={() => toggleGroup("stash")}
          className="flex items-center gap-1.5 flex-1 hover:text-[var(--text-primary)]"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="font-medium">Stash</span>
          <span className="text-[var(--text-muted)]">{stashes.length}</span>
        </button>
        <button
          type="button"
          onClick={openStashCreate}
          title="Stash current changes"
          className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)]"
        >
          <Archive size={12} />
        </button>
      </div>
      {expanded && stashes.length === 0 && (
        <div className="px-3 py-2 text-xs text-[var(--text-muted)]">No stashes.</div>
      )}
      {expanded &&
        stashes.map((stash) => {
          const popping = inFlight.has("stash:pop");
          const applying = inFlight.has("stash:apply");
          const dropping = inFlight.has("stash:drop");
          return (
            <div
              key={stash.index}
              className="group flex items-center gap-2 px-3 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"
            >
              <span className="text-[var(--text-muted)] tabular-nums w-6">#{stash.index}</span>
              <span className="truncate flex-1" title={stash.message}>
                <span className="text-[var(--text-muted)]">{stash.branch}</span>
                <span className="mx-1 text-[var(--text-muted)]">·</span>
                {stash.message}
              </span>
              <div className="hidden group-hover:flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => send("apply", stash.index)}
                  disabled={applying}
                  title="Apply (keep stash)"
                  className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)] disabled:opacity-40"
                >
                  <ArchiveRestore size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => send("pop", stash.index)}
                  disabled={popping}
                  title="Pop (apply then drop)"
                  className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)] disabled:opacity-40"
                >
                  <Undo2 size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => send("drop", stash.index)}
                  disabled={dropping}
                  title="Drop"
                  className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--surface-3)] disabled:opacity-40"
                >
                  <X size={12} />
                </button>
              </div>
            </div>
          );
        })}
    </div>
  );
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
  const selectedPaths = useSourceControlStore((s) => s.selectedPaths);
  const selectionAnchor = useSourceControlStore((s) => s.selectionAnchor);
  const setMultiSelection = useSourceControlStore((s) => s.setMultiSelection);
  const toggleSelection = useSourceControlStore((s) => s.toggleSelection);
  const clearSelection = useSourceControlStore((s) => s.clearSelection);
  const diffCache = useSourceControlStore((s) => s.diffCache);
  const commitDraft = useSourceControlStore((s) =>
    activeProjectId ? s.commitDrafts[activeProjectId] ?? "" : "",
  );
  const setCommitDraft = useSourceControlStore((s) => s.setCommitDraft);
  const lastActionError = useSourceControlStore((s) => s.lastActionError);
  const clearActionError = useSourceControlStore((s) => s.clearActionError);
  const requestDiscard = useSourceControlStore((s) => s.requestDiscard);
  const inFlight = useSourceControlStore((s) => s.inFlight);
  const setInFlight = useSourceControlStore((s) => s.setActionInFlight);

  const resizing = useRef(false);
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizing.current = true;
      const onMove = (ev: MouseEvent) => {
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

  useEffect(() => {
    if (!selectedFile || !activeProjectId) return;
    sendMessage({
      type: "sc:diff:request",
      projectId: activeProjectId,
      file: selectedFile.path,
      kind: selectedFile.kind,
    });
  }, [selectedFile, activeProjectId, status]);

  // Click handling: plain = select+open, Cmd = toggle, Shift = range
  const handleRowClick: FileRowProps["onClick"] = useCallback(
    (e, entry, group, index, groupEntries, diffKind) => {
      const key = selectionKey(group, entry.path);
      const meta = e.metaKey || e.ctrlKey;
      const shift = e.shiftKey;

      if (shift && selectionAnchor && selectionAnchor.startsWith(group + "::")) {
        const anchorPath = selectionAnchor.slice((group + "::").length);
        const anchorIdx = groupEntries.findIndex((x) => x.path === anchorPath);
        if (anchorIdx >= 0) {
          const [lo, hi] = anchorIdx <= index ? [anchorIdx, index] : [index, anchorIdx];
          const range = groupEntries.slice(lo, hi + 1).map((x) => selectionKey(group, x.path));
          setMultiSelection(range, selectionAnchor);
          return;
        }
      }

      if (meta) {
        toggleSelection(key);
        return;
      }

      // Plain click — single select + open diff
      setMultiSelection([key], key);
      const next: SelectedFile = { path: entry.path, kind: diffKind };
      if (selectedFile && selectedFile.path === entry.path && selectedFile.kind === diffKind) {
        selectFile(null);
      } else {
        selectFile(next);
      }
    },
    [selectionAnchor, selectedFile, setMultiSelection, toggleSelection, selectFile],
  );

  // Resolve which files an action should apply to:
  // if the clicked entry is part of a >1 multi-selection in the same group, act on all selected.
  const resolveActionFiles = useCallback(
    (group: GroupKind, entry: ScEntry): string[] => {
      const key = selectionKey(group, entry.path);
      if (selectedPaths.size > 1 && selectedPaths.has(key)) {
        return pathsForGroup(selectedPaths, group);
      }
      return [entry.path];
    },
    [selectedPaths],
  );

  const onStage = useCallback(
    (group: GroupKind, entry: ScEntry) => {
      if (!activeProjectId) return;
      const files = resolveActionFiles(group, entry);
      sendMessage({ type: "sc:stage", projectId: activeProjectId, files });
    },
    [activeProjectId, resolveActionFiles],
  );

  const onUnstage = useCallback(
    (group: GroupKind, entry: ScEntry) => {
      if (!activeProjectId) return;
      const files = resolveActionFiles(group, entry);
      sendMessage({ type: "sc:unstage", projectId: activeProjectId, files });
    },
    [activeProjectId, resolveActionFiles],
  );

  const onDiscard = useCallback(
    (group: GroupKind, entry: ScEntry) => {
      const files = resolveActionFiles(group, entry);
      const isUntracked = group === "untracked";
      requestDiscard(isUntracked ? [] : files, isUntracked ? files : []);
    },
    [requestDiscard, resolveActionFiles],
  );

  const onOpenFile = useCallback(
    (entry: ScEntry) => {
      if (!activeProjectId) return;
      sendMessage({ type: "open:file", projectId: activeProjectId, path: entry.path });
    },
    [activeProjectId],
  );

  const onCommit = useCallback(() => {
    if (!activeProjectId || !commitDraft.trim()) return;
    setInFlight("commit", true);
    sendMessage({ type: "sc:commit", projectId: activeProjectId, message: commitDraft });
  }, [activeProjectId, commitDraft, setInFlight]);

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

  const stagedCount = status?.staged.length ?? 0;
  const committing = inFlight.has("commit");

  return (
    <div
      className="relative flex-shrink-0 bg-[var(--surface-1)] border-l border-[var(--border)] flex flex-col h-full"
      style={{ width: panelWidth }}
      onClick={(e) => {
        // Clear multi-selection on panel-area click that isn't on a row
        if ((e.target as HTMLElement).closest("[data-sc-row]")) return;
        if (selectedPaths.size > 0) clearSelection();
      }}
    >
      <div
        className="absolute top-0 left-0 w-1 h-full cursor-col-resize z-10 hover:bg-[var(--accent)] active:bg-[var(--accent)] opacity-0 hover:opacity-40 active:opacity-60 transition-opacity"
        onMouseDown={handleResizeStart}
      />

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
          <BranchBar />

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
                disabled={stagedCount === 0 || !commitDraft.trim() || committing}
                className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded bg-[var(--accent)] text-[var(--surface-0)] font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90"
              >
                {committing ? <Loader2 size={12} className="animate-spin" /> : <GitCommit size={12} />}
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
            {selectedPaths.size > 1 && (
              <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
                <span>{selectedPaths.size} selected</span>
                <button
                  type="button"
                  onClick={clearSelection}
                  className="text-[var(--accent)] hover:underline"
                >
                  Clear
                </button>
              </div>
            )}
          </div>

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
            <div className="flex-1 overflow-auto" data-sc-row>
              <Group
                label="Conflicted"
                group="conflicted"
                diffKind="conflicted"
                entries={status.conflicted}
                selectedPaths={selectedPaths}
                focusedPath={null}
                onRowClick={handleRowClick}
                onOpen={onOpenFile}
              />
              <Group
                label="Staged Changes"
                group="staged"
                diffKind="staged"
                entries={status.staged}
                selectedPaths={selectedPaths}
                focusedPath={null}
                onRowClick={handleRowClick}
                onOpen={onOpenFile}
                onPrimary={(e) => onUnstage("staged", e)}
                primaryIcon={<Minus size={12} />}
                primaryTitle="Unstage"
              />
              <Group
                label="Changes"
                group="changes"
                diffKind="unstaged"
                entries={status.changes}
                selectedPaths={selectedPaths}
                focusedPath={null}
                onRowClick={handleRowClick}
                onOpen={onOpenFile}
                onPrimary={(e) => onStage("changes", e)}
                onSecondary={(e) => onDiscard("changes", e)}
                primaryIcon={<Plus size={12} />}
                primaryTitle="Stage"
                secondaryIcon={<Undo2 size={12} />}
                secondaryTitle="Discard changes"
              />
              <Group
                label="Untracked"
                group="untracked"
                diffKind="untracked"
                entries={status.untracked}
                selectedPaths={selectedPaths}
                focusedPath={null}
                onRowClick={handleRowClick}
                onOpen={onOpenFile}
                onPrimary={(e) => onStage("untracked", e)}
                onSecondary={(e) => onDiscard("untracked", e)}
                primaryIcon={<Plus size={12} />}
                primaryTitle="Stage"
                secondaryIcon={<Undo2 size={12} />}
                secondaryTitle="Delete file"
              />
              <div className="border-t border-[var(--border)] mt-2">
                <StashSection stashes={status.stashes} projectId={activeProjectId} />
              </div>
              {status.staged.length === 0 &&
                status.changes.length === 0 &&
                status.untracked.length === 0 &&
                status.conflicted.length === 0 &&
                status.stashes.length === 0 && (
                  <div className="text-xs text-[var(--text-muted)] px-4 py-8 text-center">
                    Working tree clean.
                  </div>
                )}
            </div>
          )}
        </>
      )}

      {lastActionError && (
        <div className="absolute bottom-2 left-2 right-2 px-3 py-2 bg-[var(--danger)]/10 border border-[var(--danger)]/40 rounded text-xs text-[var(--danger)] flex items-start gap-2">
          <span className="flex-1 break-all">{lastActionError}</span>
          <button onClick={clearActionError} className="text-[var(--danger)] hover:opacity-70">
            <X size={12} />
          </button>
        </div>
      )}

      <DiscardConfirm />
      <StashCreateDialog />
    </div>
  );
}
