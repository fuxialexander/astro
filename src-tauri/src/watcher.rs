//! Filesystem change notifications.
//!
//! Watches are identified by a unique string ID returned by `watch_directory`.
//! Events are debounced over a 100 ms window and emitted to the frontend as
//! `fs-change` Tauri events.

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    mpsc, Mutex,
};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

// ── Watch-ID counter ──────────────────────────────────────────────────────────

static WATCH_COUNTER: AtomicU64 = AtomicU64::new(1);

fn next_watch_id() -> String {
    format!("watch-{}", WATCH_COUNTER.fetch_add(1, Ordering::SeqCst))
}

// ── Public event types emitted to the frontend ────────────────────────────────

/// The kind of filesystem change that occurred.
#[derive(Debug, Clone, Serialize)]
pub enum FsChangeKind {
    Created,
    Modified,
    Removed,
    Renamed,
}

/// Payload for the `fs-change` Tauri event.
#[derive(Debug, Clone, Serialize)]
pub struct FsChangeEvent {
    /// Absolute path of the affected file or directory.
    pub path: String,
    pub kind: FsChangeKind,
    /// ID of the watch that produced this event.
    pub watch_id: String,
}

// ── Internal watch handle ─────────────────────────────────────────────────────

/// Keeps the `RecommendedWatcher` alive.  When this is dropped:
/// 1. The watcher is stopped and its internal `tx` is dropped.
/// 2. The debounce thread's `rx.recv_timeout` returns `Disconnected` and exits.
struct WatchHandle {
    _watcher: RecommendedWatcher,
    /// Retained for diagnostics / future list_watches command.
    #[allow(dead_code)]
    path: String,
}

// ── Managed state ─────────────────────────────────────────────────────────────

pub struct WatcherState {
    watches: Mutex<HashMap<String, WatchHandle>>,
}

impl WatcherState {
    pub fn new() -> Self {
        WatcherState {
            watches: Mutex::new(HashMap::new()),
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Map a `notify` `EventKind` to our simpler `FsChangeKind`.
/// Returns `None` for access events and other noise we don't forward.
pub fn event_kind_to_change_kind(kind: &EventKind) -> Option<FsChangeKind> {
    match kind {
        EventKind::Create(_) => Some(FsChangeKind::Created),
        EventKind::Modify(notify::event::ModifyKind::Name(_)) => Some(FsChangeKind::Renamed),
        EventKind::Modify(_) => Some(FsChangeKind::Modified),
        EventKind::Remove(_) => Some(FsChangeKind::Removed),
        _ => None,
    }
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Start watching a directory for filesystem changes.
///
/// Returns a watch ID that should be passed to `unwatch` when done.
/// Events are debounced over a 100 ms window to avoid flooding the frontend.
#[tauri::command]
pub fn watch_directory(
    path: String,
    recursive: bool,
    app: AppHandle,
    state: State<'_, WatcherState>,
) -> Result<String, String> {
    let watch_id = next_watch_id();
    let watch_id_thread = watch_id.clone();

    // Channel between notify callback and the debounce thread.
    let (tx, rx) = mpsc::channel::<Event>();

    let watcher = RecommendedWatcher::new(
        move |result: notify::Result<Event>| {
            if let Ok(event) = result {
                let _ = tx.send(event);
            }
        },
        notify::Config::default(),
    )
    .map_err(|e| format!("failed to create watcher: {e}"))?;

    // Debounce thread: collects events and flushes once per 100 ms window.
    thread::spawn(move || {
        const DEBOUNCE: Duration = Duration::from_millis(100);
        const POLL: Duration = Duration::from_millis(20);

        let mut pending: HashMap<PathBuf, FsChangeKind> = HashMap::new();
        let mut window_start = Instant::now();

        loop {
            match rx.recv_timeout(POLL) {
                Ok(event) => {
                    if let Some(kind) = event_kind_to_change_kind(&event.kind) {
                        for p in event.paths {
                            // First event kind within a debounce window wins.
                            pending.entry(p).or_insert_with(|| kind.clone());
                        }
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }

            if !pending.is_empty() && window_start.elapsed() >= DEBOUNCE {
                for (p, kind) in pending.drain() {
                    let _ = app.emit(
                        "fs-change",
                        FsChangeEvent {
                            path: p.to_string_lossy().to_string(),
                            kind,
                            watch_id: watch_id_thread.clone(),
                        },
                    );
                }
                window_start = Instant::now();
            }
        }
    });

    let mode = if recursive {
        RecursiveMode::Recursive
    } else {
        RecursiveMode::NonRecursive
    };

    let mut watcher = watcher;
    watcher
        .watch(std::path::Path::new(&path), mode)
        .map_err(|e| format!("watch failed for '{path}': {e}"))?;

    state
        .watches
        .lock()
        .map_err(|e| e.to_string())?
        .insert(watch_id.clone(), WatchHandle { _watcher: watcher, path });

    Ok(watch_id)
}

/// Stop a filesystem watch by its ID.
///
/// Dropping the `WatchHandle` automatically stops the watcher and causes the
/// debounce thread to exit.
#[tauri::command]
pub fn unwatch(watch_id: String, state: State<'_, WatcherState>) -> Result<(), String> {
    let mut watches = state.watches.lock().map_err(|e| e.to_string())?;
    if watches.remove(&watch_id).is_none() {
        return Err(format!("watch ID '{watch_id}' not found"));
    }
    Ok(())
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn watcher_state_starts_empty() {
        let state = WatcherState::new();
        assert!(
            state.watches.lock().unwrap().is_empty(),
            "fresh WatcherState should have no watches"
        );
    }

    #[test]
    fn watch_ids_are_unique() {
        let id1 = next_watch_id();
        let id2 = next_watch_id();
        let id3 = next_watch_id();
        assert_ne!(id1, id2, "watch IDs should be unique");
        assert_ne!(id2, id3);
        assert_ne!(id1, id3);
    }

    #[test]
    fn watch_ids_have_prefix() {
        let id = next_watch_id();
        assert!(id.starts_with("watch-"), "ID should start with 'watch-'");
    }

    #[test]
    fn event_kind_create() {
        use notify::event::CreateKind;
        let k = event_kind_to_change_kind(&EventKind::Create(CreateKind::File));
        assert!(matches!(k, Some(FsChangeKind::Created)));
    }

    #[test]
    fn event_kind_modify_data() {
        use notify::event::{DataChange, ModifyKind};
        let k = event_kind_to_change_kind(&EventKind::Modify(ModifyKind::Data(
            DataChange::Content,
        )));
        assert!(matches!(k, Some(FsChangeKind::Modified)));
    }

    #[test]
    fn event_kind_remove() {
        use notify::event::RemoveKind;
        let k = event_kind_to_change_kind(&EventKind::Remove(RemoveKind::File));
        assert!(matches!(k, Some(FsChangeKind::Removed)));
    }

    #[test]
    fn event_kind_rename() {
        use notify::event::{ModifyKind, RenameMode};
        let k = event_kind_to_change_kind(&EventKind::Modify(ModifyKind::Name(RenameMode::Any)));
        assert!(matches!(k, Some(FsChangeKind::Renamed)));
    }

    #[test]
    fn event_kind_access_is_none() {
        use notify::event::AccessKind;
        let k = event_kind_to_change_kind(&EventKind::Access(AccessKind::Read));
        assert!(k.is_none(), "access events should be filtered out");
    }

    #[test]
    fn event_kind_other_is_none() {
        let k = event_kind_to_change_kind(&EventKind::Other);
        assert!(k.is_none());
    }

    #[test]
    fn fs_change_event_serializes() {
        let evt = FsChangeEvent {
            path: "/tmp/foo.txt".to_string(),
            kind: FsChangeKind::Modified,
            watch_id: "watch-42".to_string(),
        };
        let json = serde_json::to_string(&evt).unwrap();
        assert!(json.contains("/tmp/foo.txt"));
        assert!(json.contains("Modified"));
        assert!(json.contains("watch-42"));
    }

    #[test]
    fn all_change_kinds_serialize() {
        for kind in [
            FsChangeKind::Created,
            FsChangeKind::Modified,
            FsChangeKind::Removed,
            FsChangeKind::Renamed,
        ] {
            let json = serde_json::to_string(&kind).unwrap();
            assert!(!json.is_empty());
        }
    }
}
