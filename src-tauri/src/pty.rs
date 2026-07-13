use std::io::{Read, Write};
use std::path::PathBuf;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::ipc::Channel;

/// A single local PTY session: the master side of a pseudo-terminal plus the
/// child process (shell) running on the slave side.
pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

impl PtySession {
    /// Open a PTY, spawn the shell, and start a reader thread that pumps the
    /// shell's output back to the frontend through `on_data`.
    pub fn spawn(
        cols: u16,
        rows: u16,
        shell: Option<String>,
        on_data: Channel<Vec<u8>>,
    ) -> Result<Self, String> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;

        let mut cmd = CommandBuilder::new(shell.unwrap_or_else(default_shell));
        if let Some(home) = home_dir() {
            cmd.cwd(home);
        }

        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        // The slave handle is not needed in the parent process once the child
        // owns it; dropping it lets the PTY signal EOF correctly on exit.
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if on_data.send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                }
            }
        });

        Ok(Self {
            master: pair.master,
            writer,
            child,
        })
    }

    pub fn write(&mut self, data: &[u8]) -> Result<(), String> {
        self.writer.write_all(data).map_err(|e| e.to_string())?;
        self.writer.flush().map_err(|e| e.to_string())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        self.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())
    }

    pub fn kill(&mut self) {
        let _ = self.child.kill();
    }
}

#[cfg(windows)]
fn default_shell() -> String {
    "powershell.exe".to_string()
}

#[cfg(not(windows))]
fn default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}
