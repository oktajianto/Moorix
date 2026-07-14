use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use tokio::sync::oneshot;

#[cfg(desktop)]
use crate::pty::PtySession;
use crate::ssh::SshSession;

/// A terminal session — either a local PTY (desktop only) or an SSH connection.
pub enum Session {
    #[cfg(desktop)]
    Pty(PtySession),
    Ssh(SshSession),
}

impl Session {
    fn write(&mut self, data: &[u8]) -> Result<(), String> {
        match self {
            #[cfg(desktop)]
            Session::Pty(s) => s.write(data),
            Session::Ssh(s) => s.write(data),
        }
    }

    fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        match self {
            #[cfg(desktop)]
            Session::Pty(s) => s.resize(cols, rows),
            Session::Ssh(s) => s.resize(cols, rows),
        }
    }

    fn kill(&mut self) {
        match self {
            #[cfg(desktop)]
            Session::Pty(s) => s.kill(),
            // Dropping the SshSession (on removal) closes the input channel,
            // which stops the IO task and disconnects.
            Session::Ssh(_) => {}
        }
    }
}

/// Application-wide state: the registry of open terminal sessions.
#[derive(Default)]
pub struct AppState {
    sessions: Mutex<HashMap<String, Session>>,
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
}
