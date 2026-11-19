#!/usr/bin/env bash
# Remove the What's Cooking extension, CLI and Claude Code hooks.
#   ./uninstall.sh           keep task data (~/.local/share/whats-cooking)
#   ./uninstall.sh --purge   also delete task data and history
set -euo pipefail
EXT_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/whats-cooking"
BIN_DIR="$HOME/.local/bin"
UUID="whats-cooking@localhost"
SETTINGS="$HOME/.claude/settings.json"

gnome-extensions disable "$UUID" 2>/dev/null || true
ENABLED=$(gsettings get org.gnome.shell enabled-extensions)
gsettings set org.gnome.shell enabled-extensions \
  "$(python3 -c "import ast,sys;l=ast.literal_eval(sys.argv[1].replace('@as ',''));print([e for e in l if e!=sys.argv[2]])" "$ENABLED" "$UUID")"
rm -rf "${EXT_DIR:?}/$UUID"
rm -f "$BIN_DIR/cook"
echo "Extension and CLI removed"

if [[ -f "$SETTINGS" ]] && grep -q "cook hook" "$SETTINGS"; then
  cp "$SETTINGS" "$SETTINGS.bak-cook-uninstall"
  jq '
    if .hooks then
      .hooks |= (with_entries(.value |= map(select(any(.hooks[]?; .command | endswith("cook hook")) | not)))
                 | with_entries(select(.value | length > 0)))
      | if (.hooks | length) == 0 then del(.hooks) else . end
    else . end
  ' "$SETTINGS.bak-cook-uninstall" > "$SETTINGS"
  echo "Claude hooks removed (backup: $SETTINGS.bak-cook-uninstall)"
fi

if [[ "${1:-}" == "--purge" ]]; then
  rm -rf "$DATA_DIR"
  echo "Task data deleted"
else
  echo "Task data kept in $DATA_DIR"
fi
echo "Restart GNOME Shell to unload the extension completely."
