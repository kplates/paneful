use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use tracing::info;

use super::session::PtySession;

struct ManagedPty {
    session: PtySession,
    project_id: String,
}

#[derive(Clone)]
pub struct PtyManager {
    sessions: Arc<RwLock<HashMap<String, ManagedPty>>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn spawn(
        &self,
        terminal_id: &str,
        project_id: &str,
        cwd: &str,
    ) -> Result<mpsc::UnboundedReceiver<Vec<u8>>, String> {
        let (tx, rx) = mpsc::unbounded_channel();

        let session = PtySession::spawn(cwd, 80, 24, tx)
            .map_err(|e| format!("Failed to spawn PTY: {}", e))?;

        info!("Spawned PTY for terminal {} in project {}", terminal_id, project_id);

        let managed = ManagedPty {
            session,
            project_id: project_id.to_string(),
        };

        self.sessions
            .write()
            .await
            .insert(terminal_id.to_string(), managed);

        Ok(rx)
    }

    pub async fn write(&self, terminal_id: &str, data: &[u8]) -> Result<(), String> {
        let sessions = self.sessions.read().await;
        if let Some(managed) = sessions.get(terminal_id) {
            managed
                .session
                .write(data)
                .map_err(|e| format!("Write error: {}", e))
        } else {
            Err(format!("Terminal {} not found", terminal_id))
        }
    }

    pub async fn resize(&self, terminal_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.read().await;
        if let Some(managed) = sessions.get(terminal_id) {
            managed
                .session
                .resize(cols, rows)
                .map_err(|e| format!("Resize error: {}", e))
        } else {
            Err(format!("Terminal {} not found", terminal_id))
        }
    }

    pub async fn kill(&self, terminal_id: &str) -> Option<String> {
        let removed = self.sessions.write().await.remove(terminal_id);
        if let Some(managed) = &removed {
            info!("Killed terminal {}", terminal_id);
            Some(managed.project_id.clone())
        } else {
            None
        }
    }

    pub async fn kill_project(&self, project_id: &str) -> Vec<String> {
        let mut sessions = self.sessions.write().await;
        let terminal_ids: Vec<String> = sessions
            .iter()
            .filter(|(_, m)| m.project_id == project_id)
            .map(|(id, _)| id.clone())
            .collect();

        for id in &terminal_ids {
            sessions.remove(id);
        }

        if !terminal_ids.is_empty() {
            info!("Killed {} terminals for project {}", terminal_ids.len(), project_id);
        }

        terminal_ids
    }

    pub async fn kill_all(&self) {
        let mut sessions = self.sessions.write().await;
        let count = sessions.len();
        sessions.clear();
        if count > 0 {
            info!("Killed all {} terminals", count);
        }
    }

    pub async fn terminal_exists(&self, terminal_id: &str) -> bool {
        self.sessions.read().await.contains_key(terminal_id)
    }
}
