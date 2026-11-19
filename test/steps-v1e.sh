WIN='global.get_window_actors().map(a => a.meta_window).find(w => w.get_title() === "What'"'"'s Cooking")'
rect() { ev "const w = $WIN; w ? (() => { const r = w.get_frame_rect(); return r.x + ' ' + r.y + ' ' + r.width + ' ' + r.height + ' op=' + w.get_compositor_private().opacity; })() : 'none'" | sed -E "s/^\(true, '\"?//; s/\"?'\)$//"; }
btn() { read -r X Y W H _ <<< "$(rect)"; echo "$((X + W - $1)) $((Y + 27))"; }   # $1 = offset from right edge
move 1100 300; sleep 0.5
shot 13-state-column
move 1100 202; sleep 0.5
shot 14-hover
click $(btn 53); sleep 2; rect > "$OUT/size-max.txt"; shot 15-max
click $(btn 53); sleep 2; rect > "$OUT/size-min.txt"
click $(btn 25); sleep 1; rect > "$OUT/after-hide.txt"
ev "$DEV for (const k of [0xffeb, 0xffe1, 0x63]) global._kb.notify_keyval(t(), k, 1); for (const k of [0x63, 0xffe1, 0xffeb]) global._kb.notify_keyval(t(), k, 0); 'ok'" >/dev/null
for i in $(seq 40); do rect >> "$OUT/reopen-samples.txt"; sleep 0.05; done
shot 16-reopened
