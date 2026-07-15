use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use russh_sftp::client::SftpSession;
use tokio::sync::oneshot;

#[cfg(desktop)]
use crate::pty::PtySession;
#[cfg(desktop)]
use crate::serial::SerialSession;
use crate::ssh::{SshHandle, SshSession};
use crate::telnet::TelnetSession;

/// A terminal session — a local PTY or serial port (desktop only), an SSH
/// connection, or a Telnet connection.
pub enum Session {
    #[cfg(desktop)]
    Pty(PtySession),
    Ssh(SshSession),
    #[cfg(desktop)]
    Serial(SerialSession),
    Telnet(TelnetSession),
}

impl Session {
    fn write(&mut self, data: &[u8]) -> Result<(), String> {
        match self {
            #[cfg(desktop)]
            Session::Pty(s) => s.write(data),
            Session::Ssh(s) => s.write(data),
            #[cfg(desktop)]
            Session::Serial(s) => s.write(data),
            Session::Telnet(s) => s.write(data),
        }
    }

    fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        match self {
            #[cfg(desktop)]
            Session::Pty(s) => s.resize(cols, rows),
            Session::Ssh(s) => s.resize(cols, rows),
            // Serial and Telnet have no window-size concept.
            #[cfg(desktop)]
            Session::Serial(_) => Ok(()),
            Session::Telnet(_) => Ok(()),
        }
    }

    fn kill(&mut self) {
        match self {
            #[cfg(desktop)]
            Session::Pty(s) => s.kill(),
            // Dropping the Ssh/Telnet session (on removal) closes its input
            // channel, which stops the IO task and disconnects.
            Session::Ssh(_) => {}
            #[cfg(desktop)]
            Session::Serial(s) => s.kill(),
            Session::Telnet(_) => {}
        }
    }
}

/// Application-wide state: the registry of open terminal sessions.
#[derive(Default)]
pub struct AppState {
    sessions: Mutex<HashMap<String, Session>>,
    /// Open SFTP sessions (file browser), keyed by their own id. Each rides on
    /// an existing SSH session's connection.
    sftp: Mutex<HashMap<String, Arc<SftpSession>>>,
    /// Cancellation flags for in-flight SFTP transfers, keyed by transfer id.
    transfers: Mutex<HashMap<String, Arc<AtomicBool>>>,
    counter: AtomicU64,
    host_key_counter: AtomicU64,
    pending_host_keys: Mutex<HashMap<u64, oneshot::Sender<bool>>>,
}

impl AppState {
    pub fn next_id(&self) -> String {
        let n = self.counter.fetch_add(1, Ordering::Relaxed);
        format!("s{n}")
    }

    /// Register a pending host-key confirmation; returns its id and a receiver
    /// that resolves once the frontend calls `host_key_decision`.
    pub fn register_host_key_prompt(&self) -> (u64, oneshot::Receiver<bool>) {
        let id = self.host_key_counter.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.pending_host_keys.lock().unwrap().insert(id, tx);
        (id, rx)
    }

    pub fn resolve_host_key(&self, id: u64, accept: bool) {
        if let Some(tx) = self.pending_host_keys.lock().unwrap().remove(&id) {
            let _ = tx.send(accept);
        }
    }

    pub fn insert(&self, id: String, session: Session) {
        self.sessions.lock().unwrap().insert(id, session);
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        match sessions.get_mut(id) {
            Some(session) => session.write(data),
            None => Err(format!("session {id} not found")),
        }
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().unwrap();
        match sessions.get(id) {
            Some(session) => session.resize(cols, rows),
            None => Err(format!("session {id} not found")),
        }
    }

    pub fn close(&self, id: &str) {
        if let Some(mut session) = self.sessions.lock().unwrap().remove(id) {
            session.kill();
        }
    }

    /// A clone of an SSH session's connection handle, for opening an SFTP
    /// subsystem. Returns None if the id isn't an SSH session.
    pub fn ssh_handle(&self, id: &str) -> Option<SshHandle> {
        match self.sessions.lock().unwrap().get(id) {
            Some(Session::Ssh(s)) => Some(s.handle()),
            _ => None,
        }
    }

    pub fn insert_sftp(&self, id: String, sftp: Arc<SftpSession>) {
        self.sftp.lock().unwrap().insert(id, sftp);
    }

    pub fn sftp(&self, id: &str) -> Option<Arc<SftpSession>> {
        self.sftp.lock().unwrap().get(id).cloned()
    }

    pub fn remove_sftp(&self, id: &str) {
        self.sftp.lock().unwrap().remove(id);
    }

    /// Register a transfer's cancel flag; the transfer loop polls it.
    pub fn register_cancel(&self, id: String) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        self.transfers.lock().unwrap().insert(id, flag.clone());
        flag
    }

    pub fn signal_cancel(&self, id: &str) {
        if let Some(flag) = self.transfers.lock().unwrap().get(id) {
            flag.store(true, Ordering::Relaxed);
        }
    }

    pub fn clear_cancel(&self, id: &str) {
        self.transfers.lock().unwrap().remove(id);
    }
}
