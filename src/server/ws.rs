use axum::extract::ws::{Message, WebSocket};
use futures::{SinkExt, StreamExt};
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use tracing::{error, info, warn};

use crate::project::store::ProjectStore;
use crate::protocol::{ClientMessage, ServerMessage};
use crate::pty::manager::PtyManager;

/// Sender for outbound WS messages — any task can send through this channel
/// and a single writer task serializes them onto the WebSocket.
pub type WsOutbound = mpsc::UnboundedSender<ServerMessage>;

#[derive(Clone)]
pub struct AppState {
    pub pty_manager: PtyManager,
    pub project_store: ProjectStore,
    /// The current WS outbound channel (set when a client connects, cleared on disconnect)
    pub ws_outbound: Arc<Mutex<Option<WsOutbound>>>,
}

pub async fn handle_ws(socket: WebSocket, state: AppState) {
    let (mut ws_tx, mut ws_rx) = socket.split();

    // Create a channel for serialized outbound messages
    let (outbound_tx, mut outbound_rx) = mpsc::unbounded_channel::<ServerMessage>();

    // Store it so IPC and PTY tasks can send
    {
        let mut lock = state.ws_outbound.lock().await;
        *lock = Some(outbound_tx.clone());
    }

    info!("WebSocket client connected");

    // Single writer task — serializes all outbound messages onto the WebSocket
    let writer_task = tokio::spawn(async move {
        while let Some(msg) = outbound_rx.recv().await {
            if let Ok(json) = serde_json::to_string(&msg) {
                if ws_tx.send(Message::Text(json.into())).await.is_err() {
                    break;
                }
            }
        }
    });

    // Process incoming messages
    while let Some(result) = ws_rx.next().await {
        match result {
            Ok(Message::Text(text)) => {
                handle_client_message(&text, &state, &outbound_tx).await;
            }
            Ok(Message::Close(_)) => {
                info!("WebSocket client disconnected");
                break;
            }
            Err(e) => {
                error!("WebSocket error: {}", e);
                break;
            }
            _ => {}
        }
    }

    // Clear outbound channel and stop the writer
    {
        let mut lock = state.ws_outbound.lock().await;
        *lock = None;
    }
    drop(outbound_tx);
    let _ = writer_task.await;

    info!("WebSocket handler exiting");
}

async fn handle_client_message(text: &str, state: &AppState, tx: &WsOutbound) {
    let msg: ClientMessage = match serde_json::from_str(text) {
        Ok(m) => m,
        Err(e) => {
            warn!("Invalid message: {} - {}", e, text);
            let _ = tx.send(ServerMessage::Error {
                message: format!("Invalid message: {}", e),
            });
            return;
        }
    };

    match msg {
        ClientMessage::PtySpawn {
            terminal_id,
            project_id,
            cwd,
        } => {
            handle_pty_spawn(&terminal_id, &project_id, &cwd, state, tx).await;
        }
        ClientMessage::PtyInput { terminal_id, data } => {
            if let Err(e) = state.pty_manager.write(&terminal_id, data.as_bytes()).await {
                warn!("Write to terminal {} failed: {}", terminal_id, e);
            }
        }
        ClientMessage::PtyResize {
            terminal_id,
            cols,
            rows,
        } => {
            if let Err(e) = state.pty_manager.resize(&terminal_id, cols, rows).await {
                warn!("Resize terminal {} failed: {}", terminal_id, e);
            }
        }
        ClientMessage::PtyKill { terminal_id } => {
            if let Some(project_id) = state.pty_manager.kill(&terminal_id).await {
                state
                    .project_store
                    .remove_terminal(&project_id, &terminal_id)
                    .await;
                let _ = tx.send(ServerMessage::PtyExit {
                    terminal_id,
                    exit_code: 0,
                });
            }
        }
        ClientMessage::ProjectKill { project_id } => {
            let killed = state.pty_manager.kill_project(&project_id).await;
            for tid in killed {
                let _ = tx.send(ServerMessage::PtyExit {
                    terminal_id: tid,
                    exit_code: 0,
                });
            }
        }
        ClientMessage::ProjectCreate {
            project_id,
            name,
            cwd,
        } => {
            let project =
                crate::project::model::Project::new(project_id.clone(), name.clone(), cwd.clone());
            state.project_store.create(project).await;
        }
        ClientMessage::ProjectRemove { project_id } => {
            let killed = state.pty_manager.kill_project(&project_id).await;
            for tid in killed {
                let _ = tx.send(ServerMessage::PtyExit {
                    terminal_id: tid,
                    exit_code: 0,
                });
            }
            state.project_store.remove(&project_id).await;
        }
    }
}

async fn handle_pty_spawn(
    terminal_id: &str,
    project_id: &str,
    cwd: &str,
    state: &AppState,
    tx: &WsOutbound,
) {
    match state.pty_manager.spawn(terminal_id, project_id, cwd).await {
        Ok(mut rx) => {
            state
                .project_store
                .add_terminal(project_id, terminal_id)
                .await;

            let tid = terminal_id.to_string();
            let tx = tx.clone();

            // Forward PTY output through the channel (no mutex contention)
            tokio::spawn(async move {
                while let Some(data) = rx.recv().await {
                    let text = String::from_utf8_lossy(&data).to_string();
                    if tx
                        .send(ServerMessage::PtyOutput {
                            terminal_id: tid.clone(),
                            data: text,
                        })
                        .is_err()
                    {
                        break; // WS disconnected
                    }
                }

                // PTY exited
                let _ = tx.send(ServerMessage::PtyExit {
                    terminal_id: tid,
                    exit_code: 0,
                });
            });
        }
        Err(e) => {
            error!("Failed to spawn PTY: {}", e);
            let _ = tx.send(ServerMessage::Error {
                message: format!("Failed to spawn terminal: {}", e),
            });
        }
    }
}

pub async fn send_to_client(state: &AppState, msg: ServerMessage) {
    let lock = state.ws_outbound.lock().await;
    if let Some(tx) = lock.as_ref() {
        let _ = tx.send(msg);
    }
}
