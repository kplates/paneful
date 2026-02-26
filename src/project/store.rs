use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{error, info};

use super::model::Project;

#[derive(Clone)]
pub struct ProjectStore {
    projects: Arc<RwLock<HashMap<String, Project>>>,
    file_path: PathBuf,
}

impl ProjectStore {
    pub fn new(data_dir: PathBuf) -> Self {
        let file_path = data_dir.join("projects.json");
        let projects = if file_path.exists() {
            match std::fs::read_to_string(&file_path) {
                Ok(contents) => {
                    serde_json::from_str::<Vec<Project>>(&contents)
                        .unwrap_or_default()
                        .into_iter()
                        .map(|p| (p.id.clone(), p))
                        .collect()
                }
                Err(e) => {
                    error!("Failed to read projects file: {}", e);
                    HashMap::new()
                }
            }
        } else {
            HashMap::new()
        };

        Self {
            projects: Arc::new(RwLock::new(projects)),
            file_path,
        }
    }

    pub async fn create(&self, project: Project) {
        let mut projects = self.projects.write().await;
        info!("Creating project: {} ({})", project.name, project.id);
        projects.insert(project.id.clone(), project);
        self.persist_inner(&projects);
    }

    pub async fn remove(&self, project_id: &str) -> Option<Project> {
        let mut projects = self.projects.write().await;
        let removed = projects.remove(project_id);
        if removed.is_some() {
            info!("Removed project: {}", project_id);
            self.persist_inner(&projects);
        }
        removed
    }

    pub async fn get(&self, project_id: &str) -> Option<Project> {
        self.projects.read().await.get(project_id).cloned()
    }

    pub async fn list(&self) -> Vec<Project> {
        self.projects.read().await.values().cloned().collect()
    }

    pub async fn find_by_name(&self, name: &str) -> Option<Project> {
        self.projects
            .read()
            .await
            .values()
            .find(|p| p.name == name)
            .cloned()
    }

    pub async fn add_terminal(&self, project_id: &str, terminal_id: &str) {
        let mut projects = self.projects.write().await;
        if let Some(project) = projects.get_mut(project_id) {
            if !project.terminal_ids.contains(&terminal_id.to_string()) {
                project.terminal_ids.push(terminal_id.to_string());
                self.persist_inner(&projects);
            }
        }
    }

    pub async fn remove_terminal(&self, project_id: &str, terminal_id: &str) {
        let mut projects = self.projects.write().await;
        if let Some(project) = projects.get_mut(project_id) {
            project.terminal_ids.retain(|id| id != terminal_id);
            self.persist_inner(&projects);
        }
    }

    pub async fn get_terminal_ids(&self, project_id: &str) -> Vec<String> {
        self.projects
            .read()
            .await
            .get(project_id)
            .map(|p| p.terminal_ids.clone())
            .unwrap_or_default()
    }

    fn persist_inner(&self, projects: &HashMap<String, Project>) {
        let list: Vec<&Project> = projects.values().collect();
        match serde_json::to_string_pretty(&list) {
            Ok(json) => {
                if let Some(parent) = self.file_path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                if let Err(e) = std::fs::write(&self.file_path, json) {
                    error!("Failed to persist projects: {}", e);
                }
            }
            Err(e) => error!("Failed to serialize projects: {}", e),
        }
    }
}
