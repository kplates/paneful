import { useEffect, useRef } from "react";
import { useProjectStore } from "../stores/projectStore";
import { useSourceControlStore } from "../stores/sourceControlStore";
import { sendMessage } from "./useWebSocket";

/**
 * Tells the server which project's git status to poll. The server only
 * tracks one project at a time — the one the source control panel is showing.
 *
 * Also resets the per-project selection (open file + multi-select) when the
 * active project changes, so the previous project's diff doesn't linger as an
 * artifact in the new project's panel.
 */
export function useSourceControlSync() {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const panelOpen = useSourceControlStore((s) => s.panelOpen);
  const prevProjectIdRef = useRef<string | null>(activeProjectId);

  useEffect(() => {
    const target = panelOpen ? activeProjectId : null;
    sendMessage({ type: "sc:set-active", projectId: target });

    if (prevProjectIdRef.current !== activeProjectId) {
      const sc = useSourceControlStore.getState();
      sc.selectFile(null);
      sc.clearSelection();
      prevProjectIdRef.current = activeProjectId;
    }
  }, [activeProjectId, panelOpen]);
}
