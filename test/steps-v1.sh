# Interaction steps for run-v1-headless.sh (sourced inside the session).
X0=944; DOT=$((X0+36)); TIMER=$((X0+251)); DONE=$((X0+274)); DEL=$((X0+297)); GRIP=$((X0+16))
R1=156; R2=202; R3=248; R4=294; R5=340; R6=386
move $((X0+150)) $((R5-20)); sleep 0.5
click $DOT $R5                                   # Reply -> Cooking
move $((X0+150)) $R6; click $TIMER $R6           # Review -> Waiting 5 min
wheel UP; wheel UP                               # -> 7 min
shot 1-state-timer
move $((X0+150)) $R3; click $DONE $R3; sleep 0.6  # Fix lot scan -> Done
move $((X0+150)) $R1; click $DEL $R1; sleep 0.3; click $DEL $R1   # delete Analyse ticket
shot 2-done-delete
dblclick $((X0+120)) $((R2-7))                   # rename Restore prod backup
key 0xff57; type_text " (DB)"; key 0xff0d        # End, type, Enter
move $GRIP $R4; ev "$DEV global._pt.notify_button(t(), 1, 1);" >/dev/null; sleep 0.3
for y in 280 260 230 200 170 150 140; do move $GRIP $y; done
ev "$DEV global._pt.notify_button(t(), 1, 0);" >/dev/null; sleep 0.8   # drag Review to top
shot 3-rename-reorder
click $((X0+160)) 110; type_text "Write release notes #glo"; sleep 0.3
shot 4-autocomplete
key 0xff09; key 0xff0d                           # Tab completes, Enter adds
click $((X0+70)) 482                             # open Dishwasher
shot 5-added-washer
