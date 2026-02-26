use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub cwd: String,
    #[serde(default)]
    pub terminal_ids: Vec<String>,
}

impl Project {
    pub fn new(id: String, name: String, cwd: String) -> Self {
        Self {
            id,
            name,
            cwd,
            terminal_ids: Vec::new(),
        }
    }
}
