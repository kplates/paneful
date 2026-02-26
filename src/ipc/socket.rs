use std::path::PathBuf;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tracing::{error, info};

use crate::project::model::Project;
use crate::protocol::{IpcRequest, IpcResponse, ServerMessage};
use crate::server::ws::{send_to_client, AppState};

pub async fn start_ipc_listener(socket_path: PathBuf, state: AppState) {
    // Remove stale socket file
    let _ = std::fs::remove_file(&socket_path);

    let listener = match UnixListener::bind(&socket_path) {
        Ok(l) => l,
        Err(e) => {
            error!("Failed to bind Unix socket at {:?}: {}", socket_path, e);
            return;
        }
    };

    info!("IPC listener started at {:?}", socket_path);

    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                let state = state.clone();
                tokio::spawn(async move {
                    handle_ipc_connection(stream, state).await;
                });
            }
            Err(e) => {
                error!("IPC accept error: {}", e);
            }
        }
    }
}

async fn handle_ipc_connection(stream: UnixStream, state: AppState) {
    let (reader, mut writer) = stream.into_split();
    let mut reader = BufReader::new(reader);
    let mut line = String::new();

    if let Err(e) = reader.read_line(&mut line).await {
        error!("IPC read error: {}", e);
        return;
    }

    let request: IpcRequest = match serde_json::from_str(line.trim()) {
        Ok(r) => r,
        Err(e) => {
            let resp = IpcResponse::Error {
                message: format!("Invalid request: {}", e),
            };
            let _ = writer
                .write_all(format!("{}\n", serde_json::to_string(&resp).unwrap()).as_bytes())
                .await;
            return;
        }
    };

    let response = match request {
        IpcRequest::Spawn { cwd, name } => {
            let id = uuid::Uuid::new_v4().to_string();
            let project = Project::new(id.clone(), name.clone(), cwd.clone());
            state.project_store.create(project).await;

            // Notify the frontend
            send_to_client(
                &state,
                ServerMessage::ProjectSpawned {
                    project_id: id,
                    name,
                    cwd,
                },
            )
            .await;

            IpcResponse::Ok { data: None }
        }
        IpcRequest::List => {
            let projects = state.project_store.list().await;
            let list: Vec<String> = projects
                .iter()
                .map(|p| {
                    format!(
                        "{} ({}) - {} terminals",
                        p.name,
                        p.cwd,
                        p.terminal_ids.len()
                    )
                })
                .collect();
            IpcResponse::Ok {
                data: Some(list.join("\n")),
            }
        }
        IpcRequest::Kill { name } => {
            if let Some(project) = state.project_store.find_by_name(&name).await {
                state.pty_manager.kill_project(&project.id).await;
                state.project_store.remove(&project.id).await;
                IpcResponse::Ok { data: None }
            } else {
                IpcResponse::Error {
                    message: format!("Project '{}' not found", name),
                }
            }
        }
    };

    let json = serde_json::to_string(&response).unwrap();
    let _ = writer.write_all(format!("{}\n", json).as_bytes()).await;
}

pub async fn send_ipc_command(socket_path: &PathBuf, request: &IpcRequest) -> Result<IpcResponse, String> {
    let stream = UnixStream::connect(socket_path)
        .await
        .map_err(|e| format!("Failed to connect to paneful: {}", e))?;

    let (reader, mut writer) = stream.into_split();
    let json = serde_json::to_string(request).unwrap();
    writer
        .write_all(format!("{}\n", json).as_bytes())
        .await
        .map_err(|e| format!("Write error: {}", e))?;

    let mut reader = BufReader::new(reader);
    let mut line = String::new();
    reader
        .read_line(&mut line)
        .await
        .map_err(|e| format!("Read error: {}", e))?;

    serde_json::from_str(line.trim()).map_err(|e| format!("Parse error: {}", e))
}
