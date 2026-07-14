use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serialport::SerialPort;
use tauri::ipc::Channel;

/// A local serial-port session (desktop only). The reader thread pumps incoming
/// bytes to the frontend through `on_data`; writes go straight to the port.
pub struct SerialSession {
    port: Box<dyn SerialPort>,
    stop: Arc<AtomicBool>,
}

impl SerialSession {
    pub fn open(
        path: String,
        baud: u32,
        on_data: Channel<Vec<u8>>,
    ) -> Result<Self, String> {
        let port = serialport::new(&path, baud)
            // A short read timeout lets the reader loop poll the stop flag.
            .timeout(Duration::from_millis(50))
            .open()
            .map_err(|e| format!("open {path} failed: {e}"))?;

        let mut reader = port.try_clone().map_err(|e| e.to_string())?;
        let stop = Arc::new(AtomicBool::new(false));
        let stop_reader = stop.clone();

        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                if stop_reader.load(Ordering::Relaxed) {
                    break;
                }
                match reader.read(&mut buf) {
                    Ok(0) => {}
                    Ok(n) => {
                        if on_data.send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                    // No data within the timeout — loop and re-check the stop flag.
                    Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {}
                    // Port closed/unplugged or other fatal error.
                    Err(_) => break,
                }
            }
        });

        Ok(Self { port, stop })
    }

    pub fn write(&mut self, data: &[u8]) -> Result<(), String> {
        self.port.write_all(data).map_err(|e| e.to_string())?;
        self.port.flush().map_err(|e| e.to_string())
    }

    pub fn kill(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

/// Names of the serial ports currently available on this machine.
pub fn available_ports() -> Vec<String> {
    serialport::available_ports()
        .map(|ports| ports.into_iter().map(|p| p.port_name).collect())
        .unwrap_or_default()
}
