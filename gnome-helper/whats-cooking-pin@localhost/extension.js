import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const APP_IDS = ['io.github.supercolson.whatscooking', 'whats-cooking'];
const TITLE = "What's Cooking";
const MARGIN = 16;
const PLACE_DELAY_MS = 250;
const PLACE_TRIES = 20;

export default class WhatsCookingPinExtension extends Extension {
    /**
     * Watch new windows and pin the ones that already exist.
     */
    enable() {
        this._pinned = new WeakSet();
        this._windowCreatedId = global.display.connect('window-created',
            (_display, win) => this._watch(win));
        for (const actor of global.get_window_actors())
            this._watch(actor.meta_window);
    }

    /**
     * Stop watching windows.
     */
    disable() {
        global.display.disconnect(this._windowCreatedId);
        this._windowCreatedId = null;
        this._pinned = null;
    }

    /**
     * Tell whether a window belongs to the What's Cooking app.
     *
     * @param {Meta.Window} win
     * @returns {boolean}
     */
    _isOurs(win) {
        return APP_IDS.includes(win.get_wm_class()) || win.get_title() === TITLE;
    }

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
     * Keep the window above others, on all workspaces, at the top right.
     *
     * @param {Meta.Window} win
     * @returns {boolean} true when the window was ours and is now pinned
     */
    _tryPin(win) {
        if (!this._pinned || this._pinned.has(win) || !this._isOurs(win))
            return false;
        this._pinned.add(win);
        win.make_above();
        win.stick();
        // Mutter applies its own initial placement on first map, so move afterwards.
        let tries = 0;
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, PLACE_DELAY_MS, () => {
            const mapped = win.get_compositor_private()?.visible && win.get_frame_rect().width > 0;
            if (mapped)
                this._place(win);
            return !mapped && ++tries < PLACE_TRIES ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
        });
        console.log(`whats-cooking-pin: pinned "${win.get_title()}" (${win.get_wm_class()})`);
        return true;
    }

    /**
     * Move the window to the top right corner of the primary monitor work area.
     *
     * @param {Meta.Window} win
     */
    _place(win) {
        const area = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
        const rect = win.get_frame_rect();
        win.move_frame(true, area.x + area.width - rect.width - MARGIN, area.y + MARGIN);
    }
}
