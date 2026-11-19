X0=944; R5=340
move $((X0+150)) $((R5-20)); sleep 0.5
click $((X0+66)) $((R5+8))                       # tag badge of Reply (#internal)
shot 6-popover
type_text "billing"; key 0xff0d                  # create #billing
sleep 0.5; click $((X0+66)) $((R5+8))            # reopen on #billing
shot 7-popover-palette
key 0xff1b; sleep 0.3                           # Escape closes the popover
click $((X0+70)) 482; sleep 0.4                  # open Dishwasher
shot 8-washer-open
move 1100 300; ev "$DEV global._pt.notify_button(t(), 1, 1);" >/dev/null; ev "$DEV global._pt.notify_button(t(), 1, 0);" >/dev/null
click $((X0+300)) 60                             # collapse
shot 9-collapsed
click $((X0+300)) 60                             # expand
move $((X0+313)) 500; ev "$DEV global._pt.notify_button(t(), 1, 1);" >/dev/null; sleep 0.3
for y in 540 600 660; do move $((X0+313)) $y; done
ev "$DEV global._pt.notify_button(t(), 1, 0);" >/dev/null; sleep 0.8
ev 'const w = global.get_window_actors().map(a => a.meta_window).find(w => w.get_title() === "What'"'"'s Cooking"); const r = w.get_frame_rect(); `${r.x},${r.y},${r.width},${r.height}`' > "$OUT/resized.txt"
shot 10-resized
