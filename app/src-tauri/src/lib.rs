use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::image::Image;
use tauri::{AppHandle, Manager};
use tauri_plugin_window_state::StateFlags;

/// Return the path of the shared journal file.
fn journal_path() -> PathBuf {
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
        .unwrap_or_default();
    base.join("whats-cooking").join("journal.jsonl")
}

/// Format the current time as an ISO 8601 UTC timestamp with milliseconds.
fn now_iso() -> String {
    let ms = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0) as i64;
    let (secs, millis) = (ms.div_euclid(1000), ms.rem_euclid(1000));
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // Civil-from-days (Howard Hinnant) avoids pulling a date crate for one timestamp.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{millis:03}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

/// Read the raw journal content; an empty string when the file is missing.
#[tauri::command]
fn read_journal() -> String {
    std::fs::read_to_string(journal_path()).unwrap_or_default()
}

/// Append one event to the journal, stamping it with the current time.
#[tauri::command]
fn append_event(mut event: serde_json::Map<String, serde_json::Value>) -> Result<(), String> {
    event.entry("ts").or_insert_with(|| now_iso().into());
    let path = journal_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let mut line = serde_json::to_string(&event).map_err(|e| e.to_string())?;
    line.push('\n');
    let mut file = OpenOptions::new().create(true).append(true).open(path).map_err(|e| e.to_string())?;
    file.write_all(line.as_bytes()).map_err(|e| e.to_string())
}

/// Show the number of active dishes next to the tray icon (AppIndicator label on Linux).
#[tauri::command]
fn set_tray_count(app: AppHandle, count: usize) {
    if let Some(tray) = app.tray_by_id("main") {
        let label = if count > 0 { Some(count.to_string()) } else { None };
        let _ = tray.set_title(label.as_deref());
        let _ = tray.set_tooltip(Some(format!("What's Cooking · {count}")));
    }
}

/// Ask the GNOME pin extension to animate the card window to a new size.
///
/// The extension moves and resizes the window in one compositor operation per
/// frame. Returns false when the extension is not available (other desktops).
#[tauri::command]
async fn animate_card(width: i32, height: i32, duration: i32) -> bool {
    if !cfg!(target_os = "linux") {
        return false;
    }
    std::process::Command::new("gdbus")
        .args([
            "call", "--session",
            "--dest", "org.gnome.Shell",
            "--object-path", "/io/github/supercolson/WhatsCooking",
            "--method", "io.github.supercolson.WhatsCooking.AnimateCard",
            &width.to_string(), &height.to_string(), &duration.to_string(),
        ])
        .output()
        .map(|out| out.status.success() && String::from_utf8_lossy(&out.stdout).contains("true"))
        .unwrap_or(false)
}

/// Show the card if hidden, hide it otherwise.
fn toggle_card(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.set_focus();
        }
    }
}

/// Create the tray icon with its Show/Hide and Quit entries.
fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle", "Show / hide", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &quit])?;
    TrayIconBuilder::with_id("main")
        .tooltip("What's Cooking")
        .icon(Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => toggle_card(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                toggle_card(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // A second launch (e.g. `whats-cooking --show` from the GNOME shortcut) shows the running card.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        // Position is left to the window manager (and the GNOME pin extension on Wayland).
        .plugin(tauri_plugin_window_state::Builder::default().with_state_flags(StateFlags::SIZE).build())
        .invoke_handler(tauri::generate_handler![read_journal, append_event, set_tray_count, animate_card])
        .setup(|app| {
            build_tray(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running What's Cooking");
}
