use axum::{
    extract::{Path, State},
    http::{header, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use rust_embed::Embed;
use serde_json::json;

use crate::project::model::Project;
use crate::server::ws::AppState;

#[derive(Embed)]
#[folder = "web/dist/"]
struct Asset;

pub fn create_router(state: AppState, dev_mode: bool) -> Router {
    let app = Router::new()
        // API routes
        .route("/api/projects", get(list_projects))
        .route("/api/projects", post(create_project))
        .route("/api/projects/{id}", delete(delete_project))
        .route("/api/projects/{id}/kill", post(kill_project))
        // WebSocket
        .route("/ws", get(ws_upgrade))
        .with_state(state);

    if dev_mode {
        // In dev mode, we don't serve embedded assets — Vite handles it
        app
    } else {
        // Serve embedded frontend assets
        app.fallback(get(serve_embedded))
    }
}

async fn ws_upgrade(
    ws: axum::extract::WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| crate::server::ws::handle_ws(socket, state))
}

async fn list_projects(State(state): State<AppState>) -> Json<Vec<Project>> {
    Json(state.project_store.list().await)
}

async fn create_project(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    let id = body["id"]
        .as_str()
        .unwrap_or(&uuid::Uuid::new_v4().to_string())
        .to_string();
    let name = body["name"].as_str().unwrap_or("Unnamed").to_string();
    let cwd = body["cwd"].as_str().unwrap_or("/").to_string();

    let project = Project::new(id.clone(), name, cwd);
    state.project_store.create(project.clone()).await;

    (StatusCode::CREATED, Json(project))
}

async fn delete_project(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    // Kill all terminals first
    state.pty_manager.kill_project(&id).await;
    state.project_store.remove(&id).await;
    StatusCode::NO_CONTENT
}

async fn kill_project(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let killed = state.pty_manager.kill_project(&id).await;
    Json(json!({ "killed": killed.len() }))
}

async fn serve_embedded(uri: Uri) -> impl IntoResponse {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };

    match Asset::get(path) {
        Some(content) => {
            let mime = mime_guess::from_path(path)
                .first_or_octet_stream()
                .to_string();
            Response::builder()
                .header(header::CONTENT_TYPE, mime)
                .body(axum::body::Body::from(content.data.to_vec()))
                .unwrap()
        }
        None => {
            // SPA fallback: serve index.html for unmatched routes
            match Asset::get("index.html") {
                Some(content) => Response::builder()
                    .header(header::CONTENT_TYPE, "text/html")
                    .body(axum::body::Body::from(content.data.to_vec()))
                    .unwrap(),
                None => Response::builder()
                    .status(StatusCode::NOT_FOUND)
                    .body(axum::body::Body::from("Not found"))
                    .unwrap(),
            }
        }
    }
}
