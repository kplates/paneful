use portable_pty::{CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::sync::Mutex;
use tokio::sync::mpsc;
use tracing::{error, info};

pub struct PtySession {
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn portable_pty::MasterPty + Send>>,
}

// Safety: We protect all non-Sync fields with Mutex
unsafe impl Sync for PtySession {}

impl PtySession {
    pub fn spawn(
        cwd: &str,
        cols: u16,
        rows: u16,
        output_tx: mpsc::UnboundedSender<Vec<u8>>,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let pty_system = portable_pty::native_pty_system();
        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };

        let pair = pty_system.openpty(size)?;

        let mut cmd = CommandBuilder::new_default_prog();
        cmd.cwd(cwd);
        cmd.env("LANG", "en_US.UTF-8");
        cmd.env("LC_ALL", "en_US.UTF-8");
        cmd.env("TERM", "xterm-256color");

        let _child = pair.slave.spawn_command(cmd)?;
        drop(pair.slave);

        let writer = pair.master.take_writer()?;
        let mut reader = pair.master.try_clone_reader()?;

        let master = pair.master;

        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if output_tx.send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                    Err(e) => {
                        error!("PTY read error: {}", e);
                        break;
                    }
                }
            }
            info!("PTY reader thread exited");
        });

        Ok(Self {
            writer: Mutex::new(writer),
            master: Mutex::new(master),
        })
    }

    pub fn write(&self, data: &[u8]) -> std::io::Result<()> {
        let mut writer = self.writer.lock().unwrap();
        writer.write_all(data)?;
        writer.flush()
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), Box<dyn std::error::Error>> {
        let master = self.master.lock().unwrap();
        master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        Ok(())
    }
}
