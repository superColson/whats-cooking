move 1100 200; sleep 0.5
click 1210 75; sleep 0.8
ev 'const w = global.get_window_actors().map(a => a.meta_window).find(w => w.get_wm_class() === "whats-cooking"); const r = w.get_frame_rect(); `${r.width}x${r.height}`' > "$OUT/collapsed.txt"
shot 11-collapsed
click 1210 75; sleep 0.8
ev 'const w = global.get_window_actors().map(a => a.meta_window).find(w => w.get_wm_class() === "whats-cooking"); const r = w.get_frame_rect(); `${r.width}x${r.height}`' > "$OUT/expanded.txt"
