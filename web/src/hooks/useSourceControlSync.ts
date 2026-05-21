import { useEffect } from "react";
import { useProjectStore } from "../stores/projectStore";
import { useSourceControlStore } from "../stores/sourceControlStore";
import { sendMessage } from "./useWebSocket";

/**
 * Tells the server which project's git status to poll. The server only
 * tracks one project at a time — the one the source control panel is showing.
 */
export function useSourceControlSync() {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const panelOpen = useSourceControlStore((s) => s.panelOpen);

  useEffect(() => {
    const target = panelOpen ? activeProjectId : null;
    sendMessage({ type: "sc:set-active", projectId: target });
  }, [activeProjectId, panelOpen]);
}
