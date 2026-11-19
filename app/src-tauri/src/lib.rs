use std::path::PathBuf;

/// Return the path of the shared journal file.
fn journal_path() -> PathBuf {
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
        .unwrap_or_default();
    base.join("whats-cooking").join("journal.jsonl")
}

/// Read the raw journal content; an empty string when the file is missing.
#[tauri::command]
fn read_journal() -> String {
    std::fs::read_to_string(journal_path()).unwrap_or_default()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![read_journal])
        .run(tauri::generate_context!())
        .expect("error while running What's Cooking");
}
