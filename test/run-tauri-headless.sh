#!/usr/bin/env bash
# Start an isolated headless GNOME Shell (Wayland, no Xwayland) with the pin
# extension, launch the Tauri app plus a competing window, then check that the
# app stays above, and save screenshots in test/out-tauri/.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
BIN="$ROOT/app/src-tauri/target/debug/whats-cooking"
SANDBOX=$(mktemp -d)
OUT="$ROOT/test/out-tauri"
rm -rf "$OUT"; mkdir -p "$OUT" "$SANDBOX"/{data,config,cache}/gnome-shell/extensions
export XDG_DATA_HOME="$SANDBOX/data" XDG_CONFIG_HOME="$SANDBOX/config" XDG_CACHE_HOME="$SANDBOX/cache"
cp -r "$ROOT/gnome-helper/whats-cooking-pin@localhost" "$ROOT/test/helper@localhost" "$XDG_DATA_HOME/gnome-shell/extensions/"

exec dbus-run-session -- bash -s "$ROOT" "$OUT" "$BIN" <<'INNER'
set -u
ROOT=$1 OUT=$2 BIN=$3
P="$ROOT/bin/cook"
gsettings set org.gnome.shell enabled-extensions "['whats-cooking-pin@localhost','helper@localhost']"
gsettings set org.gnome.shell welcome-dialog-last-shown-version '999'
"$P" add "Reply to accounting mail #internal" >/dev/null
"$P" add "Restore prod backup #globex /w 1" >/dev/null
"$P" add "Fix lot scan on scrap #acme" --doing >/dev/null
echo '{"hook_event_name":"UserPromptSubmit","session_id":"s1","cwd":"/home/u/Projects/Odoo/odoo-acme","prompt":"Migrate stock_custom to v19"}' | "$P" hook
echo '{"hook_event_name":"Stop","session_id":"s1"}' | "$P" hook

gnome-shell --headless --no-x11 --wayland-display=cook-test-0 --virtual-monitor 1280x800 >"$OUT/shell.log" 2>&1 &
SHELL_PID=$!
ev() { gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval "$1"; }
shot() { gdbus call --session --dest org.gnome.Shell.Screenshot --object-path /org/gnome/Shell/Screenshot \
  --method org.gnome.Shell.Screenshot.Screenshot false false "$OUT/$1.png" >/dev/null; }
for _ in $(seq 40); do
  gdbus introspect --session --dest org.gnome.Shell.Screenshot --object-path /org/gnome/Shell/Screenshot >/dev/null 2>&1 && break
  sleep 0.5
done
sleep 2
export WAYLAND_DISPLAY=cook-test-0 GDK_BACKEND=wayland WEBKIT_DISABLE_DMABUF_RENDERER=1
unset DISPLAY
"$BIN" >"$OUT/app.log" 2>&1 &
APP_PID=$!
for _ in $(seq 30); do
  ev 'global.get_window_actors().length' | grep -q "'[1-9]" && break
  sleep 1
done
ev 'JSON.stringify(global.get_window_actors().map(a => a.meta_window.get_title()))' > "$OUT/windows-before.txt"
zenity --info --text="Competing window" --width=900 --height=600 >/dev/null 2>&1 &
sleep 4
ps -o pid,stat,cmd -p $APP_PID > "$OUT/app-ps.txt" || true
# focus the competing window, then inspect stacking
ev 'const ws = global.get_window_actors().map(a => a.meta_window); const other = ws.find(w => w.get_title() !== "What'"'"'s Cooking"); if (other) other.activate(global.get_current_time()); "ok"' >/dev/null
sleep 1
ev 'JSON.stringify(global.get_window_actors().map(a => { const w = a.meta_window, r = w.get_frame_rect(); return {title: w.get_title(), wmClass: w.get_wm_class(), wayland: w.get_client_type() === 0, above: w.is_above(), sticky: w.is_on_all_workspaces(), focus: w.has_focus(), skipTaskbar: w.is_skip_taskbar(), x: r.x, y: r.y, w: r.width, h: r.height}; }))' > "$OUT/windows.txt"
shot 1-other-focused
# switch workspace: the card must follow
ev 'const wm = global.workspace_manager; if (wm.n_workspaces < 2) wm.append_new_workspace(false, global.get_current_time()); wm.get_workspace_by_index(1).activate(global.get_current_time()); "ok"' >/dev/null
sleep 1
shot 2-other-workspace
grep -i "whats-cooking-pin" "$OUT/shell.log" > "$OUT/pin.log" || true
kill $APP_PID 2>/dev/null; kill $SHELL_PID; wait $SHELL_PID 2>/dev/null || true
INNER
