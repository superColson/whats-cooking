#!/usr/bin/env bash
# Launch the V1 app in an isolated headless GNOME Shell (Wayland, no Xwayland)
# with the pin extension and sample data. Optional step file ($1) is sourced
# inside the session to drive pointer/keyboard. Output: test/out-v1/.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
STEPS=${1:-}
SANDBOX=$(mktemp -d)
OUT="$ROOT/test/out-v1"
trap 'rm -rf "$SANDBOX"' EXIT
rm -rf "$OUT"; mkdir -p "$OUT" "$SANDBOX"/{data,config,cache}/gnome-shell/extensions
export XDG_DATA_HOME="$SANDBOX/data" XDG_CONFIG_HOME="$SANDBOX/config" XDG_CACHE_HOME="$SANDBOX/cache"
cp -r "$ROOT/gnome-helper/whats-cooking-pin@localhost" "$ROOT/test/helper@localhost" "$XDG_DATA_HOME/gnome-shell/extensions/"
J="$XDG_DATA_HOME/whats-cooking/journal.jsonl"
mkdir -p "$(dirname "$J")"
old=$(date -u -d '3 days ago' +%Y-%m-%dT%H:%M:%S.000Z)
echo "{\"ts\":\"$old\",\"op\":\"add\",\"id\":\"old1\",\"title\":\"Review vendor contract\",\"tag\":\"globex\",\"state\":\"todo\"}" > "$J"

dbus-run-session -- bash -s "$ROOT" "$OUT" "$STEPS" <<'INNER'
set -u
ROOT=$1 OUT=$2 STEPS=$3
C="$ROOT/bin/cook"
gsettings set org.gnome.shell enabled-extensions "['whats-cooking-pin@localhost','helper@localhost','ubuntu-appindicators@ubuntu.com']"
gsettings set org.gnome.shell welcome-dialog-last-shown-version '999'
$C add "Reply to accounting mail #internal" >/dev/null
$C add "Restore prod backup #globex /w 12" >/dev/null
$C add "Fix lot scan on scrap #acme" --start >/dev/null
$C add "Update the invoice report #acme" >/dev/null
$C done 1 >/dev/null
echo '{"hook_event_name":"UserPromptSubmit","session_id":"s1","cwd":"/home/u/Projects/Odoo/odoo-acme","prompt":"Migrate stock_custom to v19"}' | $C hook
echo '{"hook_event_name":"Stop","session_id":"s1"}' | $C hook
echo '{"hook_event_name":"UserPromptSubmit","session_id":"s2","cwd":"/home/u/Projects/Odoo/initech","prompt":"Analyse ticket 4512"}' | $C hook

mkdir -p "$XDG_DATA_HOME/bin"; ln -sf "$ROOT/app/src-tauri/target/debug/whats-cooking" "$XDG_DATA_HOME/bin/whats-cooking"
PATH="$XDG_DATA_HOME/bin:$PATH" WAYLAND_DISPLAY=cook-v1-0 GDK_BACKEND=wayland WEBKIT_DISABLE_DMABUF_RENDERER=1 gnome-shell --headless --no-x11 --wayland-display=cook-v1-0 --virtual-monitor 1280x800 >"$OUT/shell.log" 2>&1 &
SHELL_PID=$!
ev() { gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval "$1"; }
shot() { gdbus call --session --dest org.gnome.Shell.Screenshot --object-path /org/gnome/Shell/Screenshot \
  --method org.gnome.Shell.Screenshot.Screenshot false false "$OUT/$1.png" >/dev/null; }
DEV='const seat = imports.gi.Clutter.get_default_backend().get_default_seat();
global._pt ??= seat.create_virtual_device(imports.gi.Clutter.InputDeviceType.POINTER_DEVICE);
global._kb ??= seat.create_virtual_device(imports.gi.Clutter.InputDeviceType.KEYBOARD_DEVICE);
const t = () => imports.gi.GLib.get_monotonic_time();'
move() { ev "$DEV global._pt.notify_absolute_motion(t(), $1, $2);" >/dev/null; sleep 0.25; }
button() { ev "$DEV global._pt.notify_button(t(), $1, 1); global._pt.notify_button(t(), $1, 0);" >/dev/null; sleep 0.5; }
click() { move "$1" "$2"; button 1; }
rclick() { move "$1" "$2"; button 3; }
dblclick() { move "$1" "$2"; ev "$DEV for (let i = 0; i < 2; i++) { global._pt.notify_button(t(), 1, 1); global._pt.notify_button(t(), 1, 0); }" >/dev/null; sleep 0.5; }
wheel() { ev "$DEV global._pt.notify_discrete_scroll(t(), imports.gi.Clutter.ScrollDirection.$1, imports.gi.Clutter.ScrollSource.WHEEL);" >/dev/null; sleep 0.4; }
key() { ev "$DEV global._kb.notify_keyval(t(), $1, 1); global._kb.notify_keyval(t(), $1, 0);" >/dev/null; sleep 0.3; }
type_text() {
  ev "$DEV for (const ch of $(printf '%s' "$1" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')) {
    const k = imports.gi.Clutter.unicode_to_keysym(ch.codePointAt(0));
    global._kb.notify_keyval(t(), k, 1); global._kb.notify_keyval(t(), k, 0); }" >/dev/null
  sleep 0.4
}
for _ in $(seq 40); do
  gdbus introspect --session --dest org.gnome.Shell.Screenshot --object-path /org/gnome/Shell/Screenshot >/dev/null 2>&1 && break
  sleep 0.5
done
sleep 2
WAYLAND_DISPLAY=cook-v1-0 GDK_BACKEND=wayland WEBKIT_DISABLE_DMABUF_RENDERER=1 DISPLAY= \
  "$ROOT/app/src-tauri/target/debug/whats-cooking" >"$OUT/app.log" 2>&1 &
APP_PID=$!
for _ in $(seq 30); do ev 'global.get_window_actors().length' | grep -q "'[1-9]" && break; sleep 1; done
sleep 4
ev 'const w = global.get_window_actors().map(a => a.meta_window).find(w => w.get_title() === "What'"'"'s Cooking"); const r = w.get_frame_rect(), b = w.get_buffer_rect(); JSON.stringify({frame: [r.x, r.y, r.width, r.height], buffer: [b.x, b.y, b.width, b.height], above: w.is_above()})' > "$OUT/window.txt"
shot 0-start
[ -n "$STEPS" ] && source "$STEPS"
"$C" ls > "$OUT/ls.txt"
cp "$XDG_DATA_HOME/whats-cooking/journal.jsonl" "$OUT/journal.jsonl"
kill $APP_PID 2>/dev/null; kill $SHELL_PID; wait $SHELL_PID 2>/dev/null || true
INNER
