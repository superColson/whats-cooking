#!/usr/bin/env bash
# Start an isolated headless GNOME Shell (Wayland, no Xwayland) with the
# extension, feed it sample tasks and save screenshots in test/out/.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SANDBOX=$(mktemp -d)
OUT="$ROOT/test/out"
mkdir -p "$OUT" "$SANDBOX"/{data,config,cache}/gnome-shell/extensions
export XDG_DATA_HOME="$SANDBOX/data" XDG_CONFIG_HOME="$SANDBOX/config" XDG_CACHE_HOME="$SANDBOX/cache"
cp -r "$ROOT/extension/whats-cooking@localhost" "$ROOT/test/helper@localhost" "$XDG_DATA_HOME/gnome-shell/extensions/"

exec dbus-run-session -- bash -s "$ROOT" "$OUT" <<'INNER'
set -u
ROOT=$1 OUT=$2
P="$ROOT/bin/cook"
gsettings set org.gnome.shell enabled-extensions "['whats-cooking@localhost','helper@localhost']"
gsettings set org.gnome.shell welcome-dialog-last-shown-version '999'
"$P" add "Répondre mail compta #interne" >/dev/null
"$P" add "Restaure backup prod #clientB /w 1" >/dev/null
"$P" add "Fix scan lots rebut #clientA" --doing >/dev/null
echo '{"hook_event_name":"UserPromptSubmit","session_id":"s1","cwd":"/home/u/Projects/Odoo/odoo-acme","prompt":"Migre stock_custom en v19 et lance les tests"}' | "$P" hook
echo '{"hook_event_name":"UserPromptSubmit","session_id":"s2","cwd":"/home/u/Projects/Odoo/globex","prompt":"Analyse le ticket 4512 facture fournisseur"}' | "$P" hook

gnome-shell --headless --no-x11 --wayland-display=cook-test-0 --virtual-monitor 1280x800 \
  >"$OUT/shell.log" 2>&1 &
SHELL_PID=$!
shot() {
  gdbus call --session --dest org.gnome.Shell.Screenshot --object-path /org/gnome/Shell/Screenshot \
    --method org.gnome.Shell.Screenshot.Screenshot false false "$OUT/$1.png" >/dev/null
}
for _ in $(seq 40); do
  gdbus introspect --session --dest org.gnome.Shell.Screenshot --object-path /org/gnome/Shell/Screenshot >/dev/null 2>&1 && break
  sleep 0.5
done
sleep 3
shot 1-initial
echo '{"hook_event_name":"Stop","session_id":"s1"}' | "$P" hook
sleep 1.2; shot 2-claude-done-a
sleep 0.7; shot 2-claude-done-b
ev() {
  gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
    --method org.gnome.Shell.Eval "$1" >/dev/null
}
DEV='const seat = imports.gi.Clutter.get_default_backend().get_default_seat();
global._pt ??= seat.create_virtual_device(imports.gi.Clutter.InputDeviceType.POINTER_DEVICE);
global._kb ??= seat.create_virtual_device(imports.gi.Clutter.InputDeviceType.KEYBOARD_DEVICE);
const t = () => imports.gi.GLib.get_monotonic_time();'
move() { ev "$DEV global._pt.notify_absolute_motion(t(), $1, $2);"; sleep 0.2; }
press() { ev "$DEV global._pt.notify_button(t(), 1, 1);"; sleep 0.15; }
release() { ev "$DEV global._pt.notify_button(t(), 1, 0);"; sleep 0.4; }
click() { move "$1" "$2"; press; release; }
type_text() {
  ev "$DEV for (const ch of $(printf '%s' "$1" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')) {
    const k = imports.gi.Clutter.unicode_to_keysym(ch.codePointAt(0));
    global._kb.notify_keyval(t(), k, 1); global._kb.notify_keyval(t(), k, 0); }"
  sleep 0.3
}
enter() { ev "$DEV global._kb.notify_keyval(t(), 0xff0d, 1); global._kb.notify_keyval(t(), 0xff0d, 0);"; sleep 0.6; }
# card geometry from the stage
ev 'const c = global.stage.get_children().flatMap(a => a.get_children()).find(a => a.style_class === "cook-card"); imports.gi.GLib.file_set_contents("'"$OUT"'/geom.json", JSON.stringify([c.x, c.y, c.width, c.height]));'
read CX CY CW CH < <(python3 -c "import json;print(*map(int,json.load(open('$OUT/geom.json'))))")
echo "card $CX $CY $CW $CH" > "$OUT/interact.log"
# 1. dot of 2nd row (Claude task ready) -> doing
click $((CX + 31)) $((CY + 140))
# 2. check button of last row -> done (hover first to reveal)
move $((CX + CW - 50)) $((CY + CH - 25)); click $((CX + CW - 18)) $((CY + CH - 25))
# 3. type a task in the entry
click $((CX + 150)) $((CY + 50)); type_text "Tester clavier #demo /w 5"; enter
shot 3-after-clicks
# 4. drag the card by its header
move $((CX + 60)) $((CY + 18)); press; move 500 300; move 400 250; release
shot 4-after-drag
"$ROOT/bin/cook" ls >> "$OUT/interact.log"
cat "$XDG_DATA_HOME/whats-cooking/ui.json" >> "$OUT/interact.log"
gnome-extensions info whats-cooking@localhost > "$OUT/ext-info.txt" 2>&1 || true
kill $SHELL_PID; wait $SHELL_PID 2>/dev/null || true
INNER
