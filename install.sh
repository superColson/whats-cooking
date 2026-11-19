#!/usr/bin/env bash
# Build and install What's Cooking for the current user.
#   ./install.sh           release build, copies everything
#   ./install.sh --dev     debug build, symlinks the CLI and the GNOME extension to this repo
#   ./install.sh --hooks   also register Claude Code hooks in ~/.claude/settings.json
# Options can be combined: ./install.sh --dev --hooks
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}"
BIN_DIR="$HOME/.local/bin"
EXT_DIR="$DATA/gnome-shell/extensions"
PIN="whats-cooking-pin@localhost"
LEGACY_EXT="whats-cooking@localhost"
APP_ID="io.github.supercolson.whatscooking"
DEV=0 HOOKS=0
for arg in "$@"; do
  case "$arg" in
    --dev) DEV=1 ;;
    --hooks) HOOKS=1 ;;
    *) echo "unknown option: $arg" >&2; exit 1 ;;
  esac
done
export PATH="$HOME/.cargo/bin:$PATH"

echo "Building the app…"
cd "$ROOT/app"
[ -d node_modules ] || npm install --silent
if (( DEV )); then
  (cd src-tauri && cargo build --quiet)
  APP_BIN="$ROOT/app/src-tauri/target/debug/whats-cooking"
else
  npx tauri build --no-bundle >/dev/null
  APP_BIN="$ROOT/app/src-tauri/target/release/whats-cooking"
fi
cd "$ROOT"

mkdir -p "$BIN_DIR" "$EXT_DIR" "$DATA/applications" "$DATA/icons/hicolor/128x128/apps" "$CONFIG/autostart"
rm -f "$BIN_DIR/whats-cooking" "$BIN_DIR/cook"
rm -rf "${EXT_DIR:?}/$PIN"
glib-compile-schemas "$ROOT/gnome-helper/$PIN/schemas"
if (( DEV )); then
  ln -s "$APP_BIN" "$BIN_DIR/whats-cooking"
  ln -s "$ROOT/bin/cook" "$BIN_DIR/cook"
  ln -s "$ROOT/gnome-helper/$PIN" "$EXT_DIR/$PIN"
else
  install -m 755 "$APP_BIN" "$BIN_DIR/whats-cooking"
  install -m 755 "$ROOT/bin/cook" "$BIN_DIR/cook"
  cp -r "$ROOT/gnome-helper/$PIN" "$EXT_DIR/"
fi
install -m 644 "$ROOT/app/src-tauri/icons/128x128.png" "$DATA/icons/hicolor/128x128/apps/whats-cooking.png"

DESKTOP="[Desktop Entry]
Type=Application
Name=What's Cooking
Comment=Floating list of what you have on the stove
Exec=$BIN_DIR/whats-cooking
Icon=whats-cooking
StartupWMClass=whats-cooking
Categories=Utility;
"
printf '%s' "$DESKTOP" > "$DATA/applications/$APP_ID.desktop"
printf '%sX-GNOME-Autostart-enabled=true\n' "$DESKTOP" > "$CONFIG/autostart/$APP_ID.desktop"
echo "App, CLI and launcher installed (autostart at login)"

# GNOME: enable the pin extension, retire the former St-only card.
gnome-extensions disable "$LEGACY_EXT" 2>/dev/null || true
rm -rf "${EXT_DIR:?}/$LEGACY_EXT"
ENABLED=$(gsettings get org.gnome.shell enabled-extensions)
gsettings set org.gnome.shell enabled-extensions "$(python3 -c "
import ast, sys
current = ast.literal_eval(sys.argv[1].replace('@as ', ''))
print([e for e in current if e != sys.argv[3]] + ([] if sys.argv[2] in current else [sys.argv[2]]))
" "$ENABLED" "$PIN" "$LEGACY_EXT")"
echo "GNOME extension $PIN enabled (shortcut: Super+Shift+C)"

if (( HOOKS )); then
  SETTINGS="$HOME/.claude/settings.json"
  [[ -f "$SETTINGS" ]] || echo '{}' > "$SETTINGS"
  cp "$SETTINGS" "$SETTINGS.bak-cook"
  CMD="$BIN_DIR/cook hook"
  jq --arg cmd "$CMD" '
    reduce ("UserPromptSubmit", "Stop", "Notification") as $ev (.;
      .hooks[$ev] = ((.hooks[$ev] // [])
        | if any(.[]; any(.hooks[]?; .command == $cmd)) then .
          else . + [{"hooks": [{"type": "command", "command": $cmd}]}] end))
  ' "$SETTINGS.bak-cook" > "$SETTINGS"
  echo "Claude hooks registered (backup: $SETTINGS.bak-cook)"
fi

cat <<EOF

Next:
  - restart GNOME Shell to load the extension (X11: Alt+F2, r, Enter; Wayland: log out and back in)
  - start the app now: whats-cooking &
EOF
