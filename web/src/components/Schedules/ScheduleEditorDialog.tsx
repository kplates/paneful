import React, { useEffect, useMemo, useRef, useState } from "react";
import { X, Calendar, FolderOpen } from "lucide-react";
import { useScheduleStore } from "../../stores/scheduleStore";
import { useProjectStore } from "../../stores/projectStore";
import { sendMessage } from "../../hooks/useWebSocket";
import { describeCron, isValidCron, nextRun } from "../../lib/cron";

type ScheduleMode = "interval" | "daily" | "weekly" | "cron";

const DAYS = [
  { label: "Sun", value: 0 },
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
];

function buildCron(mode: ScheduleMode, opts: BuilderState): string {
  switch (mode) {
    case "interval": {
      if (opts.intervalUnit === "minute") {
        const n = Math.max(1, Math.min(59, opts.intervalValue));
        return n === 1 ? "* * * * *" : `*/${n} * * * *`;
      }
      if (opts.intervalUnit === "hour") {
        const n = Math.max(1, Math.min(23, opts.intervalValue));
        return n === 1 ? "0 * * * *" : `0 */${n} * * *`;
      }
      // day
      const n = Math.max(1, Math.min(31, opts.intervalValue));
      const [h, m] = opts.time.split(":").map((x) => parseInt(x, 10));
      return n === 1 ? `${m} ${h} * * *` : `${m} ${h} */${n} * *`;
    }
    case "daily": {
      const [h, m] = opts.time.split(":").map((x) => parseInt(x, 10));
      return `${m} ${h} * * *`;
    }
    case "weekly": {
      const [h, m] = opts.time.split(":").map((x) => parseInt(x, 10));
      const days = opts.weekdays.length > 0 ? opts.weekdays.slice().sort((a, b) => a - b).join(",") : "*";
      return `${m} ${h} * * ${days}`;
    }
    case "cron":
      return opts.cron;
  }
}

interface BuilderState {
  intervalValue: number;
  intervalUnit: "minute" | "hour" | "day";
  time: string;
  weekdays: number[];
  cron: string;
}

function detectMode(cron: string): { mode: ScheduleMode; state: BuilderState } {
  const fallback: BuilderState = {
    intervalValue: 1,
    intervalUnit: "hour",
    time: "08:00",
    weekdays: [1, 2, 3, 4, 5],
    cron,
  };
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return { mode: "cron", state: fallback };
  const [min, hour, dom, month, dow] = fields;
  if (month !== "*") return { mode: "cron", state: fallback };

  const minStep = /^\*\/(\d+)$/.exec(min);
  const hourStep = /^\*\/(\d+)$/.exec(hour);
  const domStep = /^\*\/(\d+)$/.exec(dom);

  // Every 1 minute: * * * * *
  if (min === "*" && hour === "*" && dom === "*" && dow === "*") {
    return {
      mode: "interval",
      state: { ...fallback, intervalUnit: "minute", intervalValue: 1 },
    };
  }
  // Every N minutes: */N * * * *
  if (minStep && hour === "*" && dom === "*" && dow === "*") {
    return {
      mode: "interval",
      state: { ...fallback, intervalUnit: "minute", intervalValue: parseInt(minStep[1], 10) },
    };
  }
  // Every 1 hour (on the hour): 0 * * * *
  if (min === "0" && hour === "*" && dom === "*" && dow === "*") {
    return {
      mode: "interval",
      state: { ...fallback, intervalUnit: "hour", intervalValue: 1 },
    };
  }
  // Every N hours: 0 */N * * *
  if (hourStep && min === "0" && dom === "*" && dow === "*") {
    return {
      mode: "interval",
      state: { ...fallback, intervalUnit: "hour", intervalValue: parseInt(hourStep[1], 10) },
    };
  }
  // Every N days at HH:MM: m h */N * *
  if (domStep && /^\d+$/.test(min) && /^\d+$/.test(hour) && dow === "*") {
    const time = `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
    return {
      mode: "interval",
      state: {
        ...fallback,
        intervalUnit: "day",
        intervalValue: parseInt(domStep[1], 10),
        time,
      },
    };
  }
  // Daily at HH:MM: m h * * *
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === "*" && dow === "*") {
    const time = `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
    return { mode: "daily", state: { ...fallback, time } };
  }
  // Weekly: m h * * <days>
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === "*" && dow !== "*") {
    const days: number[] = [];
    let ok = true;
    for (const part of dow.split(",")) {
      if (/^\d+$/.test(part)) {
        days.push(parseInt(part, 10));
      } else if (/^\d+-\d+$/.test(part)) {
        const [a, b] = part.split("-").map((n) => parseInt(n, 10));
        for (let d = a; d <= b; d++) days.push(d);
      } else {
        ok = false;
        break;
      }
    }
    if (ok) {
      const time = `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
      return { mode: "weekly", state: { ...fallback, time, weekdays: days } };
    }
  }

  return { mode: "cron", state: fallback };
}

const DEFAULT_INITIAL: BuilderState = {
  intervalValue: 1,
  intervalUnit: "hour",
  time: "08:00",
  weekdays: [1, 2, 3, 4, 5],
  cron: "0 * * * *",
};

export function ScheduleEditorDialog() {
  const open = useScheduleStore((s) => s.editorOpen);
  const close = useScheduleStore((s) => s.closeEditor);
  const editingJobId = useScheduleStore((s) => s.editingJobId);
  const jobs = useScheduleStore((s) => s.jobs);
  const projects = useProjectStore((s) => s.projects);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);

  const editingJob = useMemo(
    () => (editingJobId ? jobs.find((j) => j.id === editingJobId) ?? null : null),
    [editingJobId, jobs],
  );

  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [cwd, setCwd] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [mode, setMode] = useState<ScheduleMode>("interval");
  const [builder, setBuilder] = useState<BuilderState>(DEFAULT_INITIAL);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    if (editingJob) {
      setName(editingJob.name);
      setCommand(editingJob.command);
      setCwd(editingJob.cwd);
      setEnabled(editingJob.enabled);
      const detected = detectMode(editingJob.cron);
      setMode(detected.mode);
      setBuilder(detected.state);
    } else {
      setName("");
      setCommand("");
      // Pre-fill with the active project's cwd as a sensible default.
      const active = activeProjectId ? projects[activeProjectId] : null;
      setCwd(active?.cwd ?? "");
      setEnabled(true);
      setMode("interval");
      setBuilder(DEFAULT_INITIAL);
    }
    setTimeout(() => nameRef.current?.focus(), 0);
  }, [open, editingJob, activeProjectId, projects]);

  const handleBrowse = async () => {
    try {
      const res = await fetch("/api/pick-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ default: cwd || undefined }),
      });
      const data = await res.json();
      if (data.path) setCwd(data.path);
    } catch {
      // ignore
    }
  };

  if (!open) return null;

  const cron = buildCron(mode, builder);
  const valid = isValidCron(cron);
  const next = valid ? nextRun(cron, new Date()) : null;
  const canSubmit = name.trim() && command.trim() && cwd.trim() && valid;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    if (editingJob) {
      sendMessage({
        type: "schedule:update",
        job: { ...editingJob, name: name.trim(), cron, command, cwd: cwd.trim(), enabled },
      });
    } else {
      sendMessage({
        type: "schedule:create",
        job: { name: name.trim(), cron, command, cwd: cwd.trim(), enabled },
      });
    }
    close();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
      onClick={close}
    >
      <form
        onSubmit={handleSubmit}
        className="bg-[var(--surface-1)] border border-[var(--border)] rounded-lg shadow-2xl w-[520px] max-w-[90vw] max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <Calendar size={14} className="text-[var(--accent)]" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              {editingJob ? "Edit schedule" : "New schedule"}
            </h3>
          </div>
          <button
            type="button"
            onClick={close}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <Field label="Name">
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Review PRs"
              className="w-full px-2 py-1.5 text-xs rounded bg-[var(--surface-0)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
            />
          </Field>

          <Field label="Working directory">
            <div className="flex gap-1">
              <input
                type="text"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder="/Users/you/code/somewhere"
                className="flex-1 px-2 py-1.5 text-xs font-mono rounded bg-[var(--surface-0)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
              />
              <button
                type="button"
                onClick={handleBrowse}
                title="Browse via Finder"
                className="px-2 py-1.5 text-xs rounded border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] flex items-center gap-1"
              >
                <FolderOpen size={12} />
                Browse
              </button>
            </div>
            <p className="text-[10px] text-[var(--text-muted)] mt-1">
              The command runs from this directory. Each run opens a pane in the dedicated
              <span className="text-[var(--text-secondary)]"> Schedules</span> section — your real projects aren't touched.
            </p>
          </Field>

          <Field label="Command">
            <textarea
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder={`e.g. claude --resume "review my open PRs and resolve any comments"`}
              rows={3}
              className="w-full px-2 py-1.5 text-xs font-mono rounded bg-[var(--surface-0)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] resize-none"
            />
            <p className="text-[10px] text-[var(--text-muted)] mt-1">
              Runs in a new pane in the selected project. Trailing newline is added automatically.
            </p>
          </Field>

          <Field label="When">
            <div className="flex gap-1 mb-2">
              {(["interval", "daily", "weekly", "cron"] as ScheduleMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`px-2 py-1 text-[11px] rounded ${
                    mode === m
                      ? "bg-[var(--accent)] text-[var(--surface-0)] font-medium"
                      : "bg-[var(--surface-0)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {m === "interval" ? "Every" : m === "cron" ? "Cron" : m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>

            {mode === "interval" && (
              <div className="flex gap-2 items-center">
                <span className="text-xs text-[var(--text-secondary)]">Every</span>
                <input
                  type="number"
                  min={1}
                  max={59}
                  value={builder.intervalValue}
                  onChange={(e) =>
                    setBuilder({ ...builder, intervalValue: parseInt(e.target.value || "1", 10) })
                  }
                  className="w-16 px-2 py-1 text-xs rounded bg-[var(--surface-0)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                />
                <select
                  value={builder.intervalUnit}
                  onChange={(e) =>
                    setBuilder({ ...builder, intervalUnit: e.target.value as BuilderState["intervalUnit"] })
                  }
                  className="px-2 py-1 text-xs rounded bg-[var(--surface-0)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                >
                  <option value="minute">minute(s)</option>
                  <option value="hour">hour(s)</option>
                  <option value="day">day(s)</option>
                </select>
                {builder.intervalUnit === "day" && (
                  <>
                    <span className="text-xs text-[var(--text-secondary)]">at</span>
                    <input
                      type="time"
                      value={builder.time}
                      onChange={(e) => setBuilder({ ...builder, time: e.target.value })}
                      className="px-2 py-1 text-xs rounded bg-[var(--surface-0)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                    />
                  </>
                )}
              </div>
            )}

            {mode === "daily" && (
              <div className="flex gap-2 items-center">
                <span className="text-xs text-[var(--text-secondary)]">Every day at</span>
                <input
                  type="time"
                  value={builder.time}
                  onChange={(e) => setBuilder({ ...builder, time: e.target.value })}
                  className="px-2 py-1 text-xs rounded bg-[var(--surface-0)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
            )}

            {mode === "weekly" && (
              <div className="space-y-2">
                <div className="flex gap-1">
                  {DAYS.map((d) => {
                    const sel = builder.weekdays.includes(d.value);
                    return (
                      <button
                        key={d.value}
                        type="button"
                        onClick={() => {
                          const next = sel
                            ? builder.weekdays.filter((v) => v !== d.value)
                            : [...builder.weekdays, d.value];
                          setBuilder({ ...builder, weekdays: next });
                        }}
                        className={`w-9 py-1 text-[10px] rounded ${
                          sel
                            ? "bg-[var(--accent)] text-[var(--surface-0)] font-medium"
                            : "bg-[var(--surface-0)] border border-[var(--border)] text-[var(--text-secondary)]"
                        }`}
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </div>
                <div className="flex gap-2 items-center">
                  <span className="text-xs text-[var(--text-secondary)]">at</span>
                  <input
                    type="time"
                    value={builder.time}
                    onChange={(e) => setBuilder({ ...builder, time: e.target.value })}
                    className="px-2 py-1 text-xs rounded bg-[var(--surface-0)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
              </div>
            )}

            {mode === "cron" && (
              <div>
                <input
                  type="text"
                  value={builder.cron}
                  onChange={(e) => setBuilder({ ...builder, cron: e.target.value })}
                  placeholder="0 8 * * 1-5"
                  className={`w-full px-2 py-1.5 text-xs font-mono rounded bg-[var(--surface-0)] border ${
                    valid ? "border-[var(--border)]" : "border-[var(--danger)]"
                  } text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]`}
                />
                <p className="text-[10px] text-[var(--text-muted)] mt-1">
                  Standard 5-field cron (minute hour day-of-month month day-of-week). 0=Sun. Aliases like @hourly, @daily, @weekly supported.
                </p>
              </div>
            )}
          </Field>

          <div className="text-[10px] text-[var(--text-muted)] border-t border-[var(--border)] pt-3">
            <div>
              <span className="text-[var(--text-secondary)]">cron:</span>{" "}
              <span className="font-mono">{cron}</span>{" "}
              <span className="text-[var(--text-muted)]">— {describeCron(cron)}</span>
            </div>
            <div className="mt-1">
              <span className="text-[var(--text-secondary)]">next run:</span>{" "}
              {next ? next.toLocaleString() : "—"}
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Enabled
          </label>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-[var(--border)]">
          <button
            type="button"
            onClick={close}
            className="px-3 py-1.5 text-xs rounded border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="px-3 py-1.5 text-xs rounded bg-[var(--accent)] text-[var(--surface-0)] font-medium hover:opacity-90 disabled:opacity-40"
          >
            {editingJob ? "Save" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1">
        {label}
      </div>
      {children}
    </div>
  );
}
