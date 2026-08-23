//! Packaged StartupTask control for the Microsoft Store build (Fase 25B-2).
//!
//! An MSIX app cannot launch at login via the registry `Run` key (it's
//! virtualized inside the package), so the sanctioned mechanism is the
//! `windows.startupTask` extension declared in AppxManifest, toggled at runtime
//! through the WinRT `StartupTask` API. This module is only compiled for the
//! `msstore` Windows build; the non-Store build keeps using the registry
//! autostart plugin.
//!
//! The `TaskId` here MUST match the `TaskId` in `msix/AppxManifest.template.xml`.

use windows::core::{RuntimeType, HSTRING};
use windows::ApplicationModel::{StartupTask, StartupTaskState};
use windows_future::{AsyncStatus, IAsyncOperation};

const TASK_ID: &str = "MoorixAutostart";

/// Block on a WinRT async operation using only inherent `IAsyncOperation`
/// methods (no dependency on the `Async` convenience trait, whose `get()` is
/// gated behind windows-future's `std` feature and varies across versions).
/// These StartupTask operations complete effectively immediately.
fn block<T: RuntimeType>(op: IAsyncOperation<T>) -> Result<T, String> {
    while op.Status().map_err(|e| e.to_string())? == AsyncStatus::Started {
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    op.GetResults().map_err(|e| e.to_string())
}

fn get_task() -> Result<StartupTask, String> {
    let op = StartupTask::GetAsync(&HSTRING::from(TASK_ID)).map_err(|e| e.to_string())?;
    block(op)
}

/// Stable lower-camel labels the frontend matches on.
fn label(s: StartupTaskState) -> String {
    if s == StartupTaskState::Enabled {
        "enabled"
    } else if s == StartupTaskState::Disabled {
        "disabled"
    } else if s == StartupTaskState::DisabledByUser {
        "disabledByUser"
    } else if s == StartupTaskState::DisabledByPolicy {
        "disabledByPolicy"
    } else if s == StartupTaskState::EnabledByPolicy {
        "enabledByPolicy"
    } else {
        "unknown"
    }
    .to_string()
}

/// Current StartupTask state.
pub fn state() -> Result<String, String> {
    let task = get_task()?;
    let s = task.State().map_err(|e| e.to_string())?;
    Ok(label(s))
}

/// Enable or disable launch-at-login. Returns the resulting state label.
///
/// Enabling can be refused by Windows (e.g. the user turned Moorix off in
/// Settings → Startup); the returned label then reflects that (`disabledByUser`
/// / `disabledByPolicy`) rather than erroring, and the caller surfaces it.
pub fn set(enabled: bool) -> Result<String, String> {
    let task = get_task()?;
    if enabled {
        let op = task.RequestEnableAsync().map_err(|e| e.to_string())?;
        Ok(label(block(op)?))
    } else {
        task.Disable().map_err(|e| e.to_string())?;
        Ok("disabled".to_string())
    }
}
