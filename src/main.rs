mod browser;
mod ipc;
mod project;
mod protocol;
mod pty;
mod server;

use clap::Parser;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tracing::info;

use ipc::socket::{send_ipc_command, start_ipc_listener};
use project::store::ProjectStore;
use protocol::{IpcRequest, IpcResponse};
use pty::manager::PtyManager;
use server::http::create_router;
use server::ws::AppState;

#[derive(Parser)]
#[command(name = "paneful", about = "Browser terminal multiplexer")]
struct Cli {
    /// Spawn a new project in the current directory
    #[arg(long)]
    spawn: bool,

    /// List all projects
    #[arg(long)]
    list: bool,

    /// Kill a project by name
    #[arg(long, value_name = "NAME")]
    kill: Option<String>,

    /// Run in development mode (proxy to Vite dev server)
    #[arg(long)]
    dev: bool,

    /// Port to listen on (default: random available port)
    #[arg(long)]
    port: Option<u16>,
}

fn data_dir() -> PathBuf {
    let dir = directories::BaseDirs::new()
        .map(|d| d.home_dir().to_path_buf())
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join(".paneful");
    std::fs::create_dir_all(&dir).ok();
    dir
}

fn lockfile_path() -> PathBuf {
    data_dir().join("paneful.lock")
}

fn socket_path() -> PathBuf {
    data_dir().join("paneful.sock")
}

struct LockInfo {
    pid: u32,
    port: u16,
}

fn read_lockfile() -> Option<LockInfo> {
    let path = lockfile_path();
    if !path.exists() {
        return None;
    }
    let content = std::fs::read_to_string(&path).ok()?;
    let mut lines = content.lines();
    let pid: u32 = lines.next()?.parse().ok()?;
    let port: u16 = lines.next()?.parse().ok()?;
    Some(LockInfo { pid, port })
}

fn write_lockfile(pid: u32, port: u16) {
    let path = lockfile_path();
    std::fs::write(&path, format!("{}\n{}", pid, port)).ok();
}

fn remove_lockfile() {
    let _ = std::fs::remove_file(lockfile_path());
    let _ = std::fs::remove_file(socket_path());
}

fn is_process_alive(pid: u32) -> bool {
    unsafe { libc::kill(pid as i32, 0) == 0 }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let cli = Cli::parse();

    if cli.list {
        handle_list().await;
        return;
    }

    if let Some(name) = &cli.kill {
        handle_kill(name).await;
        return;
    }

    if cli.spawn {
        handle_spawn().await;
        return;
    }

    // Default: start the server (or connect to existing)
    if let Some(lock) = read_lockfile() {
        if is_process_alive(lock.pid) {
            println!("Paneful already running on port {}", lock.port);
            browser::open_browser(lock.port);
            return;
        }
        remove_lockfile();
    }

    start_server(cli.dev, cli.port).await;
}

async fn handle_spawn() {
    let cwd = std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("/"))
        .to_string_lossy()
        .to_string();
    let name = PathBuf::from(&cwd)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "project".to_string());

    if read_lockfile()
        .map(|l| is_process_alive(l.pid))
        .unwrap_or(false)
    {
        let request = IpcRequest::Spawn {
            cwd: cwd.clone(),
            name: name.clone(),
        };
        match send_ipc_command(&socket_path(), &request).await {
            Ok(IpcResponse::Ok { .. }) => {
                println!("Project '{}' spawned in paneful", name);
            }
            Ok(IpcResponse::Error { message }) => {
                eprintln!("Error: {}", message);
                std::process::exit(1);
            }
            Err(e) => {
                eprintln!("Failed to connect: {}", e);
                std::process::exit(1);
            }
        }
    } else {
        eprintln!("Paneful is not running. Start it with: paneful");
        std::process::exit(1);
    }
}

async fn handle_list() {
    if read_lockfile()
        .map(|l| is_process_alive(l.pid))
        .unwrap_or(false)
    {
        let request = IpcRequest::List;
        match send_ipc_command(&socket_path(), &request).await {
            Ok(IpcResponse::Ok { data }) => {
                if let Some(list) = data {
                    if list.is_empty() {
                        println!("No projects");
                    } else {
                        println!("{}", list);
                    }
                } else {
                    println!("No projects");
                }
            }
            Ok(IpcResponse::Error { message }) => {
                eprintln!("Error: {}", message);
                std::process::exit(1);
            }
            Err(e) => {
                eprintln!("Failed to connect: {}", e);
                std::process::exit(1);
            }
        }
    } else {
        println!("Paneful is not running");
    }
}

async fn handle_kill(name: &str) {
    if read_lockfile()
        .map(|l| is_process_alive(l.pid))
        .unwrap_or(false)
    {
        let request = IpcRequest::Kill {
            name: name.to_string(),
        };
        match send_ipc_command(&socket_path(), &request).await {
            Ok(IpcResponse::Ok { .. }) => {
                println!("Project '{}' killed", name);
            }
            Ok(IpcResponse::Error { message }) => {
                eprintln!("Error: {}", message);
                std::process::exit(1);
            }
            Err(e) => {
                eprintln!("Failed to connect: {}", e);
                std::process::exit(1);
            }
        }
    } else {
        eprintln!("Paneful is not running");
        std::process::exit(1);
    }
}

async fn start_server(dev_mode: bool, port: Option<u16>) {
    let addr = format!("127.0.0.1:{}", port.unwrap_or(0));
    let listener = TcpListener::bind(&addr).await.expect("Failed to bind port");
    let actual_port = listener.local_addr().unwrap().port();

    let pid = std::process::id();
    write_lockfile(pid, actual_port);

    let state = AppState {
        pty_manager: PtyManager::new(),
        project_store: ProjectStore::new(data_dir()),
        ws_outbound: Arc::new(Mutex::new(None)),
    };

    // Start IPC listener
    let ipc_state = state.clone();
    let sock_path = socket_path();
    tokio::spawn(async move {
        start_ipc_listener(sock_path, ipc_state).await;
    });

    let router = create_router(state.clone(), dev_mode);

    println!("Paneful running on http://localhost:{}", actual_port);

    if !dev_mode {
        browser::open_browser(actual_port);
    }

    // Handle shutdown signals
    let pty_manager = state.pty_manager.clone();
    tokio::spawn(async move {
        tokio::signal::ctrl_c().await.ok();
        info!("Shutting down...");
        pty_manager.kill_all().await;
        remove_lockfile();
        std::process::exit(0);
    });

    axum::serve(listener, router).await.unwrap();
}
