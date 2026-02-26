use serde::{Deserialize, Serialize};

// ── Client → Server ──

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum ClientMessage {
    #[serde(rename = "pty:spawn")]
    PtySpawn {
        #[serde(rename = "terminalId")]
        terminal_id: String,
        #[serde(rename = "projectId")]
        project_id: String,
        cwd: String,
    },
    #[serde(rename = "pty:input")]
    PtyInput {
        #[serde(rename = "terminalId")]
        terminal_id: String,
        data: String,
    },
    #[serde(rename = "pty:resize")]
    PtyResize {
        #[serde(rename = "terminalId")]
        terminal_id: String,
        cols: u16,
        rows: u16,
    },
    #[serde(rename = "pty:kill")]
    PtyKill {
        #[serde(rename = "terminalId")]
        terminal_id: String,
    },
    #[serde(rename = "project:kill")]
    ProjectKill {
        #[serde(rename = "projectId")]
        project_id: String,
    },
    #[serde(rename = "project:create")]
    ProjectCreate {
        #[serde(rename = "projectId")]
        project_id: String,
        name: String,
        cwd: String,
    },
    #[serde(rename = "project:remove")]
    ProjectRemove {
        #[serde(rename = "projectId")]
        project_id: String,
    },
}

// ── Server → Client ──

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type")]
pub enum ServerMessage {
    #[serde(rename = "pty:output")]
    PtyOutput {
        #[serde(rename = "terminalId")]
        terminal_id: String,
        data: String,
    },
    #[serde(rename = "pty:exit")]
    PtyExit {
        #[serde(rename = "terminalId")]
        terminal_id: String,
        #[serde(rename = "exitCode")]
        exit_code: i32,
    },
    #[serde(rename = "project:spawned")]
    ProjectSpawned {
        #[serde(rename = "projectId")]
        project_id: String,
        name: String,
        cwd: String,
    },
    #[serde(rename = "error")]
    Error { message: String },
}

// ── IPC (Unix Socket) ──

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "command")]
pub enum IpcRequest {
    #[serde(rename = "spawn")]
    Spawn { cwd: String, name: String },
    #[serde(rename = "list")]
    List,
    #[serde(rename = "kill")]
    Kill { name: String },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "status")]
pub enum IpcResponse {
    #[serde(rename = "ok")]
    Ok {
        #[serde(skip_serializing_if = "Option::is_none")]
        data: Option<String>,
    },
    #[serde(rename = "error")]
    Error { message: String },
}
