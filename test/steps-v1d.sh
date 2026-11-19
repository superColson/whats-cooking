WIN='global.get_window_actors().map(a => a.meta_window).find(w => w.get_wm_class() === "whats-cooking")'
ev "JSON.stringify(global.display.get_tab_list(imports.gi.Meta.TabList.NORMAL, null).map(w => w.get_title()))" > "$OUT/tablist.txt"
ev "JSON.stringify(imports.gi.Shell.AppSystem.get_default().get_running().map(a => a.get_id()))" > "$OUT/running.txt"
ev "const w = $WIN; w.move_frame(true, 600, 200); 'ok'" >/dev/null; sleep 1.5
cat "$XDG_DATA_HOME/whats-cooking/window-position.json" > "$OUT/saved-position.txt" 2>&1
move 1100 300; sleep 0.4; click $((600+294)) $((200+27))      # Hide button (window now at 600,200)
ev "String(!!$WIN)" > "$OUT/after-hide.txt"
ev "$DEV for (const k of [0xffeb, 0xffe1, 0x63]) global._kb.notify_keyval(t(), k, 1); for (const k of [0x63, 0xffe1, 0xffeb]) global._kb.notify_keyval(t(), k, 0); 'ok'" >/dev/null
sleep 4
ev "const w = $WIN; w ? JSON.stringify({shown: true, focus: w.has_focus(), x: w.get_frame_rect().x, y: w.get_frame_rect().y}) : 'missing'" > "$OUT/after-shortcut.txt"
shot 12-after-shortcut
