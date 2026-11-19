#!/usr/bin/env bash
# Install the What's Cooking extension and CLI for the current user.
#   ./install.sh                 copy extension + CLI
#   ./install.sh --dev           symlink them to this repo instead (edits apply on shell restart)
#   ./install.sh --hooks         also register Claude Code hooks in ~/.claude/settings.json
# Options can be combined: ./install.sh --dev --hooks
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
EXT_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions"
BIN_DIR="$HOME/.local/bin"
UUID="whats-cooking@localhost"
DEV=0 HOOKS=0
for arg in "$@"; do
  case "$arg" in
    --dev) DEV=1 ;;
    --hooks) HOOKS=1 ;;
    *) echo "unknown option: $arg" >&2; exit 1 ;;
  esac
done

mkdir -p "$EXT_DIR" "$BIN_DIR"
rm -rf "${EXT_DIR:?}/$UUID"
rm -f "$BIN_DIR/cook"
if (( DEV )); then
  ln -s "$ROOT/extension/$UUID" "$EXT_DIR/$UUID"
  ln -s "$ROOT/bin/cook" "$BIN_DIR/cook"
  echo "Extension and CLI symlinked to $ROOT (dev mode)"
else
  cp -r "$ROOT/extension/$UUID" "$EXT_DIR/"
  install -m 755 "$ROOT/bin/cook" "$BIN_DIR/cook"
  echo "Extension copied to $EXT_DIR/$UUID, CLI to $BIN_DIR/cook"
fi

ENABLED=$(gsettings get org.gnome.shell enabled-extensions)
if [[ "$ENABLED" != *"'$UUID'"* ]]; then
  gsettings set org.gnome.shell enabled-extensions \
    "$(python3 -c "import ast,sys;l=ast.literal_eval(sys.argv[1].replace('@as ',''));print(l+[sys.argv[2]])" "$ENABLED" "$UUID")"
fi
echo "Extension enabled in GNOME settings"

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

Restart GNOME Shell to load the extension:
  - X11: Alt+F2, type r, Enter
  - Wayland: log out and back in
EOF
