#!/usr/bin/env bash
# Remove What's Cooking: app, CLI, launcher, autostart, GNOME extension, Claude hooks.
#   ./uninstall.sh           keep dishes and history (~/.local/share/whats-cooking)
#   ./uninstall.sh --purge   also delete dishes, history and window settings
set -euo pipefail
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}"
BIN_DIR="$HOME/.local/bin"
EXT_DIR="$DATA/gnome-shell/extensions"
APP_ID="io.github.supercolson.whatscooking"
SETTINGS="$HOME/.claude/settings.json"

pkill -x whats-cooking 2>/dev/null || true
for uuid in whats-cooking-pin@localhost whats-cooking@localhost; do
  gnome-extensions disable "$uuid" 2>/dev/null || true
  rm -rf "${EXT_DIR:?}/$uuid"
done
ENABLED=$(gsettings get org.gnome.shell enabled-extensions)
gsettings set org.gnome.shell enabled-extensions "$(python3 -c "
import ast, sys
print([e for e in ast.literal_eval(sys.argv[1].replace('@as ', '')) if not e.startswith('whats-cooking')])
" "$ENABLED")"
rm -f "$BIN_DIR/whats-cooking" "$BIN_DIR/cook" \
  "$DATA/applications/$APP_ID.desktop" "$CONFIG/autostart/$APP_ID.desktop" \
  "$DATA/icons/hicolor/128x128/apps/whats-cooking.png"
echo "App, CLI, launcher and GNOME extension removed"

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
  rm -rf "$DATA/whats-cooking" "$DATA/$APP_ID" "$CONFIG/$APP_ID"
  echo "Dishes, history and window settings deleted"
else
  echo "Dishes and history kept in $DATA/whats-cooking"
fi
echo "Restart GNOME Shell to unload the extension completely."
