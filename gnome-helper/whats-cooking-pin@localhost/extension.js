import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const APP_IDS = ['io.github.supercolson.whatscooking', 'whats-cooking'];
const TITLES = ["What's cooking ?", "What's Cooking"];
const LAUNCH = ['whats-cooking', '--show'];
const MARGIN = 16;
const PLACE_DELAY_MS = 250;
const PLACE_TRIES = 20;
const SAVE_DELAY_MS = 500;
const DOCK_SNAP = 24;
const ANIM_STEP_MS = 16;
const DBUS_PATH = '/io/github/supercolson/WhatsCooking';
const DBUS_IFACE = `<node>
  <interface name="io.github.supercolson.WhatsCooking">
    <method name="AnimateCard">
      <arg type="i" direction="in" name="width"/>
      <arg type="i" direction="in" name="height"/>
      <arg type="i" direction="in" name="duration"/>
      <arg type="b" direction="out" name="done"/>
    </method>
  </interface>
</node>`;
const POSITION_FILE = GLib.build_filenamev([GLib.get_user_data_dir(), 'whats-cooking', 'window-position.json']);

/**
 * Tell whether a window belongs to the What's Cooking app.
 *
 * @param {Meta.Window} win
 * @returns {boolean}
 */
function isOurs(win) {
    return !!win && (APP_IDS.includes(win.get_wm_class()) || TITLES.includes(win.get_title()));
}

export default class WhatsCookingPinExtension extends Extension {
    /**
     * Watch windows, hide ours from window lists and bind the shortcut.
     */
    enable() {
        this._pinned = new WeakSet();
        this._focusNext = false;
        this._saveId = null;
        this._windowCreatedId = global.display.connect('window-created',
            (_display, win) => this._watch(win));
        for (const actor of global.get_window_actors())
            this._watch(actor.meta_window);
        this._patchWindowLists();
        Main.wm.addKeybinding('toggle-card', this.getSettings(), Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW, () => this._showCard());
        this._animId = null;
        this._dbus = Gio.DBusExportedObject.wrapJSObject(DBUS_IFACE, this);
        this._dbus.export(Gio.DBus.session, DBUS_PATH);
    }

    /**
     * Undo everything enable() did.
     */
    disable() {
        this._dbus.unexport();
        this._dbus = null;
        if (this._animId)
            GLib.source_remove(this._animId);
        this._animId = null;
        Main.wm.removeKeybinding('toggle-card');
        this._unpatchWindowLists();
        global.display.disconnect(this._windowCreatedId);
        if (this._saveId)
            GLib.source_remove(this._saveId);
        this._windowCreatedId = this._saveId = null;
        this._pinned = null;
    }

    // ---- D-Bus: size animation ----------------------------------------------

    /**
     * Animate the card window to a new size, moving and resizing it in one
     * compositor operation per frame so it never jumps sideways.
     *
     * A card docked to the right edge of the screen keeps its right edge,
     * otherwise it keeps its left edge; it always stays inside the work area.
     *
     * @param {number} width target frame width
     * @param {number} height target frame height
     * @param {number} duration animation length in milliseconds
     * @returns {boolean} false when the card window is not found
     */
    AnimateCard(width, height, duration) {
        const win = global.get_window_actors().map(a => a.meta_window).find(isOurs);
        if (!win)
            return false;
        if (this._animId)
            GLib.source_remove(this._animId);
        const area = Main.layoutManager.getWorkAreaForMonitor(win.get_monitor());
        const from = win.get_frame_rect();
        const right = from.x + from.width;
        const docked = right >= area.x + area.width - MARGIN - DOCK_SNAP;
        const clampX = (x, w) => Math.min(Math.max(x, area.x), area.x + area.width - w);
        const clampY = (y, h) => Math.min(Math.max(y, area.y), area.y + area.height - h);
        const start = GLib.get_monotonic_time();
        this._animating = true;
        const step = () => {
            const t = Math.min(1, (GLib.get_monotonic_time() - start) / 1000 / Math.max(duration, 1));
            const k = 1 - (1 - t) ** 3;
            const w = Math.round(from.width + (width - from.width) * k);
            const h = Math.round(from.height + (height - from.height) * k);
            const x = clampX(docked ? right - w : from.x, w);
            win.move_resize_frame(true, x, clampY(from.y, h), w, h);
            if (t < 1)
                return GLib.SOURCE_CONTINUE;
            this._animId = null;
            this._animating = false;
            this._scheduleSave(win);
            return GLib.SOURCE_REMOVE;
        };
        step();
        this._animId = GLib.timeout_add(GLib.PRIORITY_HIGH, ANIM_STEP_MS, step);
        return true;
    }

    // ---- shortcut -----------------------------------------------------------

    /**
     * Focus the card; launch or unhide it through the app when it is not mapped.
     */
    _showCard() {
        const win = global.get_window_actors().map(a => a.meta_window).find(isOurs);
        if (win) {
            win.activate(global.get_current_time());
            return;
        }
        this._focusNext = true;
        try {
            GLib.spawn_async(null, LAUNCH, null, GLib.SpawnFlags.SEARCH_PATH, null);
        } catch (e) {
            console.error(`whats-cooking-pin: cannot launch the app: ${e.message}`);
        }
    }

    // ---- Alt+Tab and dock ---------------------------------------------------

    /**
     * Keep the card out of Alt+Tab and of the running apps shown in the dock.
     *
     * Wayland ignores the app's own "skip taskbar" hint, so the lists that the
     * shell builds in JavaScript are filtered here instead.
     */
    _patchWindowLists() {
        const display = Meta.Display.prototype;
        const appSystem = Shell.AppSystem.prototype;
        this._origTabList = display.get_tab_list;
        this._origRunning = appSystem.get_running;
        const origTabList = this._origTabList;
        const origRunning = this._origRunning;
        display.get_tab_list = function (type, workspace) {
            return origTabList.call(this, type, workspace).filter(w => !isOurs(w));
        };
        appSystem.get_running = function () {
            return origRunning.call(this).filter(app => !app.get_windows().some(isOurs));
        };
    }

    /**
     * Restore the shell functions patched by _patchWindowLists().
     */
    _unpatchWindowLists() {
        Meta.Display.prototype.get_tab_list = this._origTabList;
        Shell.AppSystem.prototype.get_running = this._origRunning;
    }

    // ---- pinning and position -----------------------------------------------

    /**
     * Pin a window now, or as soon as its app id or title is known.
     *
     * @param {Meta.Window} win
     */
    _watch(win) {
        if (this._tryPin(win))
            return;
        const ids = [];
        const retry = () => {
            if (this._pinned && this._tryPin(win))
                ids.forEach(id => win.disconnect(id));
        };
        ids.push(win.connect('notify::wm-class', retry));
        ids.push(win.connect('notify::title', retry));
        ids.push(win.connect('shown', retry));
        ids.push(win.connect('unmanaged', () => ids.forEach(id => win.disconnect(id))));
    }

    /**
     * Keep the window above others, on all workspaces, at its saved position.
     *
     * @param {Meta.Window} win
     * @returns {boolean} true when the window was ours and is now pinned
     */
    _tryPin(win) {
        if (!this._pinned || this._pinned.has(win) || !isOurs(win))
            return false;
        this._pinned.add(win);
        win.make_above();
        win.stick();
        // Mutter applies its own initial placement on first map; moving in the
        // 'shown' handler happens before the first frame is painted, so no flash.
        let placed = false;
        const settle = () => {
            if (placed || !(win.get_frame_rect().width > 0))
                return placed;
            placed = true;
            this._place(win);
            let last = win.get_frame_rect();
            win.connect('position-changed', () => {
                last = win.get_frame_rect();
                this._scheduleSave(win);
            });
            win.connect('size-changed', () => {
                last = this._keepRightEdge(win, last);
            });
            if (this._focusNext) {
                this._focusNext = false;
                win.activate(global.get_current_time());
            }
            return true;
        };
        const shownId = win.connect('shown', () => {
            win.disconnect(shownId);
            settle();
        });
        // Fallback for windows already shown when the extension is enabled.
        let tries = 0;
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, PLACE_DELAY_MS, () => {
            if (!placed && win.get_compositor_private()?.visible)
                settle();
            return !placed && ++tries < PLACE_TRIES ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
        });
        return true;
    }

    /**
     * Move the window to its saved position, or to the top right corner.
     *
     * @param {Meta.Window} win
     */
    _place(win) {
        const area = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
        const rect = win.get_frame_rect();
        const saved = this._loadPosition();
        let x = area.x + area.width - rect.width - MARGIN;
        let y = area.y + MARGIN;
        if (saved) {
            x = Math.min(Math.max(saved.x, area.x), area.x + area.width - rect.width);
            y = Math.min(Math.max(saved.y, area.y), area.y + area.height - 40);
        }
        win.move_frame(true, x, y);
    }

    /**
     * Keep a card docked to the right of the screen docked there when it resizes.
     *
     * @param {Meta.Window} win
     * @param {Mtk.Rectangle} before frame rect before the resize
     * @returns {Mtk.Rectangle} the frame rect now
     */
    _keepRightEdge(win, before) {
        if (this._animating)
            return win.get_frame_rect();
        const area = Main.layoutManager.getWorkAreaForMonitor(win.get_monitor());
        const rect = win.get_frame_rect();
        const right = before.x + before.width;
        const docked = right >= area.x + area.width - MARGIN - DOCK_SNAP;
        if (docked && rect.width !== before.width) {
            const x = Math.max(area.x, right - rect.width);
            win.move_frame(true, x, rect.y);
            return win.get_frame_rect();
        }
        return rect;
    }

    /**
     * Save the window position shortly after it stops moving.
     *
     * @param {Meta.Window} win
     */
    _scheduleSave(win) {
        if (this._saveId)
            GLib.source_remove(this._saveId);
        this._saveId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SAVE_DELAY_MS, () => {
            this._saveId = null;
            const rect = win.get_frame_rect();
            try {
                GLib.mkdir_with_parents(GLib.path_get_dirname(POSITION_FILE), 0o755);
                GLib.file_set_contents(POSITION_FILE, JSON.stringify({x: rect.x, y: rect.y}));
            } catch (e) {
                console.error(`whats-cooking-pin: cannot save position: ${e.message}`);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * Read the saved window position.
     *
     * @returns {{x: number, y: number}|null}
     */
    _loadPosition() {
        try {
            const [ok, bytes] = GLib.file_get_contents(POSITION_FILE);
            return ok ? JSON.parse(new TextDecoder().decode(bytes)) : null;
        } catch {
            return null;
        }
    }
}
