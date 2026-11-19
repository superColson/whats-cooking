import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {
    JOURNAL, UI_FILE, appendEvent, foldJournal, isAlert, newId, parseInput, readText, writeText,
} from './journal.js';

const CARD_WIDTH = 320;
const WAIT_STEP_MIN = 10;
const SCROLL_STEP_MIN = 5;
const BLINK_MS = 700;
const REFRESH_S = 20;

const NEXT_STATE = {todo: 'doing', doing: 'todo', wait: 'doing'};

export default class WhatsCookingExtension extends Extension {
    /**
     * Build the panel indicator and the floating card, start watching the journal.
     */
    enable() {
        this._tasks = [];
        this._alertActors = [];
        this._blinkOn = false;
        this._drag = null;
        this._ui = this._loadUiState();

        this._buildIndicator();
        this._buildCard();

        const file = Gio.File.new_for_path(JOURNAL);
        this._monitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
        this._monitor.connect('changed', () => this._scheduleReload());

        this._blinkId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, BLINK_MS, () => {
            this._blinkOn = !this._blinkOn;
            this._applyBlink();
            return GLib.SOURCE_CONTINUE;
        });
        this._refreshId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_S, () => {
            this._render();
            return GLib.SOURCE_CONTINUE;
        });

        this._reload();
    }

    /**
     * Destroy every actor, timer, grab and file monitor created by enable().
     */
    disable() {
        for (const id of [this._blinkId, this._refreshId, this._reloadId]) {
            if (id)
                GLib.source_remove(id);
        }
        this._blinkId = this._refreshId = this._reloadId = null;
        this._endDrag();
        this._monitor?.cancel();
        this._monitor = null;
        this._card?.destroy();
        this._card = null;
        this._indicator?.destroy();
        this._indicator = null;
        this._alertActors = [];
        this._tasks = [];
    }

    // ---- state -------------------------------------------------------------

    /**
     * Load card position, visibility and collapsed flag.
     *
     * @returns {{x: number|null, y: number|null, visible: boolean, collapsed: boolean}}
     */
    _loadUiState() {
        const defaults = {x: null, y: null, visible: true, collapsed: false};
        try {
            return {...defaults, ...JSON.parse(readText(UI_FILE) || '{}')};
        } catch {
            return defaults;
        }
    }

    /**
     * Persist card position, visibility and collapsed flag.
     */
    _saveUiState() {
        this._ui.x = Math.round(this._card.x);
        this._ui.y = Math.round(this._card.y);
        writeText(UI_FILE, JSON.stringify(this._ui));
    }

    /**
     * Debounce journal reloads triggered by the file monitor.
     */
    _scheduleReload() {
        if (this._reloadId)
            return;
        this._reloadId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 120, () => {
            this._reloadId = null;
            this._reload();
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * Re-read the journal and refresh the UI.
     */
    _reload() {
        this._tasks = foldJournal(readText(JOURNAL));
        this._render();
    }

    /**
     * Write an event to the journal; the file monitor triggers the reload.
     *
     * @param {object} event
     */
    _emit(event) {
        try {
            appendEvent(event);
        } catch (e) {
            console.error(`cook: cannot write journal: ${e}`);
        }
        this._scheduleReload();
    }

    /**
     * Return the tasks shown in the card.
     *
     * @returns {object[]}
     */
    _activeTasks() {
        return this._tasks.filter(t => t.state !== 'done');
    }

    // ---- indicator ---------------------------------------------------------

    /**
     * Create the top-bar button that toggles the card.
     */
    _buildIndicator() {
        this._indicator = new PanelMenu.Button(0.0, "What's Cooking", true);
        const box = new St.BoxLayout({style_class: 'cook-indicator'});
        box.add_child(new St.Icon({icon_name: 'checkbox-checked-symbolic', style_class: 'system-status-icon'}));
        this._indicatorLabel = new St.Label({text: '0', y_align: Clutter.ActorAlign.CENTER});
        box.add_child(this._indicatorLabel);
        this._indicator.add_child(box);
        this._indicator.connect('button-press-event', () => {
            this._setVisible(!this._ui.visible);
            return Clutter.EVENT_STOP;
        });
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    /**
     * Show or hide the floating card.
     *
     * @param {boolean} visible
     */
    _setVisible(visible) {
        this._ui.visible = visible;
        this._card.visible = visible;
        this._saveUiState();
    }

    // ---- card --------------------------------------------------------------

    /**
     * Create the floating card and place it above all windows.
     */
    _buildCard() {
        this._card = new St.BoxLayout({
            style_class: 'cook-card',
            vertical: true,
            reactive: true,
            width: CARD_WIDTH,
        });

        this._header = new St.BoxLayout({style_class: 'cook-header', reactive: true, track_hover: true});
        this._headerTitle = new St.Label({
            style_class: 'cook-header-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._headerTitle.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._badge = new St.Label({style_class: 'cook-badge', y_align: Clutter.ActorAlign.CENTER, visible: false});
        this._collapseBtn = this._iconButton('pan-up-symbolic', () => this._toggleCollapsed());
        const hideBtn = this._iconButton('window-close-symbolic', () => this._setVisible(false));
        this._header.add_child(this._headerTitle);
        this._header.add_child(this._badge);
        this._header.add_child(this._collapseBtn);
        this._header.add_child(hideBtn);
        this._makeDraggable(this._header);

        this._entry = new St.Entry({
            style_class: 'cook-entry',
            hint_text: 'New task  #tag  /w 20',
            can_focus: true,
            x_expand: true,
        });
        this._entry.clutter_text.connect('activate', () => this._onEntryActivate());
        this._entry.clutter_text.connect('key-press-event', (_a, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                this._entry.set_text('');
                global.stage.set_key_focus(null);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this._list = new St.BoxLayout({vertical: true, style_class: 'cook-list'});

        this._card.add_child(this._header);
        this._card.add_child(this._entry);
        this._card.add_child(this._list);

        Main.layoutManager.addTopChrome(this._card);
        this._placeCard();
        this._card.visible = this._ui.visible;
        this._applyCollapsed();
    }

    /**
     * Position the card from saved state, clamped to the primary monitor.
     */
    _placeCard() {
        const monitor = Main.layoutManager.primaryMonitor;
        const defaultX = monitor.x + monitor.width - CARD_WIDTH - 24;
        const defaultY = monitor.y + Main.panel.height + 16;
        const x = this._ui.x ?? defaultX;
        const y = this._ui.y ?? defaultY;
        this._card.set_position(
            Math.min(Math.max(x, monitor.x), monitor.x + monitor.width - CARD_WIDTH),
            Math.min(Math.max(y, monitor.y), monitor.y + monitor.height - 40));
    }

    /**
     * Build a flat icon button.
     *
     * @param {string} iconName
     * @param {Function} onClick - receives the mouse button number
     * @returns {St.Button}
     */
    _iconButton(iconName, onClick) {
        const button = new St.Button({
            style_class: 'cook-icon-btn',
            child: new St.Icon({icon_name: iconName, icon_size: 14}),
            y_align: Clutter.ActorAlign.CENTER,
            button_mask: St.ButtonMask.ONE | St.ButtonMask.THREE,
        });
        button.connect('clicked', (_b, mouseButton) => onClick(mouseButton));
        return button;
    }

    /**
     * Toggle between full card and header-only mode.
     */
    _toggleCollapsed() {
        this._ui.collapsed = !this._ui.collapsed;
        this._applyCollapsed();
        this._saveUiState();
        this._render();
    }

    /**
     * Show or hide the entry and list according to the collapsed flag.
     */
    _applyCollapsed() {
        const collapsed = this._ui.collapsed;
        this._entry.visible = !collapsed;
        this._list.visible = !collapsed;
        this._collapseBtn.child.icon_name = collapsed ? 'pan-down-symbolic' : 'pan-up-symbolic';
    }

    /**
     * Create a task from the quick-entry text.
     */
    _onEntryActivate() {
        const {title, tag, wait} = parseInput(this._entry.get_text());
        if (!title)
            return;
        const event = {op: 'add', id: newId(), title, tag, source: 'manual', state: 'todo'};
        if (wait) {
            event.state = 'wait';
            event.until = new Date(Date.now() + wait * 60000).toISOString();
        }
        this._emit(event);
        this._entry.set_text('');
    }

    // ---- drag (card move and row reorder) ----------------------------------

    /**
     * Let the user move the card by dragging the given actor.
     *
     * @param {Clutter.Actor} handle
     */
    _makeDraggable(handle) {
        handle.connect('button-press-event', (_a, event) => {
            if (event.get_button() !== 1)
                return Clutter.EVENT_PROPAGATE;
            const [x, y] = event.get_coords();
            this._startDrag(handle, {kind: 'card', dx: x - this._card.x, dy: y - this._card.y});
            return Clutter.EVENT_STOP;
        });
        this._connectDragTracking(handle);
    }

    /**
     * Grab the pointer on an actor for the duration of a drag.
     *
     * @param {Clutter.Actor} handle
     * @param {object} drag - drag context
     */
    _startDrag(handle, drag) {
        this._drag = drag;
        this._grab = global.stage.grab(handle);
    }

    /**
     * Release the pointer grab and forget the drag context.
     */
    _endDrag() {
        this._grab?.dismiss();
        this._grab = null;
        this._drag = null;
    }

    /**
     * Route motion and release events of a grabbed actor to the drag logic.
     *
     * @param {Clutter.Actor} handle
     */
    _connectDragTracking(handle) {
        handle.connect('motion-event', (_a, event) => {
            if (!this._drag)
                return Clutter.EVENT_PROPAGATE;
            const [x, y] = event.get_coords();
            if (this._drag.kind === 'card')
                this._card.set_position(Math.round(x - this._drag.dx), Math.round(y - this._drag.dy));
            else
                this._drag.row.translation_y = y - this._drag.startY;
            return Clutter.EVENT_STOP;
        });
        handle.connect('button-release-event', () => {
            if (!this._drag)
                return Clutter.EVENT_PROPAGATE;
            const drag = this._drag;
            this._endDrag();
            if (drag.kind === 'card')
                this._saveUiState();
            else
                this._finishRowDrag(drag);
            return Clutter.EVENT_STOP;
        });
    }

    /**
     * Turn a row drag offset into a move event.
     *
     * @param {object} drag - row drag context
     */
    _finishRowDrag(drag) {
        const active = this._activeTasks();
        const delta = Math.round(drag.row.translation_y / Math.max(drag.row.height, 1));
        drag.row.translation_y = 0;
        const target = Math.min(Math.max(drag.index + delta, 0), active.length - 1);
        if (target === drag.index) {
            this._render();
            return;
        }
        const others = active.filter(t => t.id !== drag.id);
        this._emit({op: 'move', id: drag.id, after: target === 0 ? null : others[target - 1].id});
    }

    // ---- rendering ---------------------------------------------------------

    /**
     * Rebuild header, list and indicator from the current tasks.
     */
    _render() {
        if (!this._card || this._drag)
            return;
        const now = Date.now();
        const active = this._activeTasks();
        const alerts = active.filter(t => isAlert(t, now));

        this._indicatorLabel.text = String(active.length);
        this._indicator.remove_style_class_name('cook-indicator-blink');
        this._badge.remove_style_class_name('cook-blink');
        this._alertActors = alerts.length ? [this._indicator] : [];

        const current = active.find(t => t.state === 'doing');
        this._headerTitle.text = this._ui.collapsed && current
            ? current.title
            : `Cooking · ${active.length}`;
        this._badge.visible = alerts.length > 0;
        this._badge.text = `${alerts.length} ready`;
        if (alerts.length)
            this._alertActors.push(this._badge);

        this._list.destroy_all_children();
        if (!active.length) {
            this._list.add_child(new St.Label({style_class: 'cook-empty', text: 'Nothing cooking.'}));
        }
        active.forEach((task, index) => {
            const row = this._buildRow(task, index, now);
            this._list.add_child(row);
            if (isAlert(task, now))
                this._alertActors.push(row);
        });
        this._applyBlink();
    }

    /**
     * Toggle the blink style on every actor needing attention.
     */
    _applyBlink() {
        for (const actor of this._alertActors) {
            const cls = actor === this._indicator ? 'cook-indicator-blink' : 'cook-blink';
            if (this._blinkOn)
                actor.add_style_class_name(cls);
            else
                actor.remove_style_class_name(cls);
        }
    }

    /**
     * Describe the task status shown at the right of the row.
     *
     * @param {object} task
     * @param {number} now - epoch milliseconds
     * @returns {string}
     */
    _metaText(task, now) {
        const parts = [];
        if (task.tag)
            parts.push(`#${task.tag}`);
        if (task.state === 'wait') {
            if (isAlert(task, now))
                parts.push(task.source === 'claude' ? 'to review' : 'ready');
            else if (task.until)
                parts.push(`${Math.ceil((Date.parse(task.until) - now) / 60000)} min`);
            else
                parts.push(task.source === 'claude' ? 'Claude working…' : 'waiting');
        }
        return parts.join(' · ');
    }

    /**
     * Build one task row.
     *
     * @param {object} task
     * @param {number} index - position among active tasks
     * @param {number} now - epoch milliseconds
     * @returns {St.BoxLayout}
     */
    _buildRow(task, index, now) {
        const row = new St.BoxLayout({style_class: 'cook-row', reactive: true, track_hover: true});

        const grip = new St.Icon({
            icon_name: 'list-drag-handle-symbolic',
            style_class: 'cook-grip',
            reactive: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        grip.connect('button-press-event', (_a, event) => {
            if (event.get_button() !== 1)
                return Clutter.EVENT_PROPAGATE;
            const [, y] = event.get_coords();
            row.add_style_class_name('cook-row-dragging');
            this._startDrag(grip, {kind: 'row', row, id: task.id, index, startY: y});
            return Clutter.EVENT_STOP;
        });
        this._connectDragTracking(grip);

        const dot = new St.Button({
            style_class: `cook-dot cook-dot-${task.state}`,
            y_align: Clutter.ActorAlign.CENTER,
            accessible_name: 'Change state',
        });
        dot.connect('clicked', () => this._emit({
            op: 'set', id: task.id, state: NEXT_STATE[task.state] ?? 'doing', alert: false, until: null,
        }));

        const title = new St.Label({
            text: task.title,
            style_class: 'cook-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;

        const metaText = this._metaText(task, now);
        const meta = new St.Label({
            text: metaText,
            style_class: task.state === 'wait' ? 'cook-meta cook-meta-wait' : 'cook-meta',
            visible: metaText !== '',
        });
        meta.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        const texts = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        texts.add_child(title);
        texts.add_child(meta);

        const clock = this._iconButton('alarm-symbolic', mouseButton => {
            if (mouseButton === 3) {
                this._emit({op: 'set', id: task.id, state: 'doing', until: null, alert: false});
                return;
            }
            this._addWait(task, WAIT_STEP_MIN);
        });
        clock.connect('scroll-event', (_a, event) => {
            const direction = event.get_scroll_direction();
            if (direction === Clutter.ScrollDirection.UP)
                this._addWait(task, SCROLL_STEP_MIN);
            else if (direction === Clutter.ScrollDirection.DOWN)
                this._addWait(task, -SCROLL_STEP_MIN);
            return Clutter.EVENT_STOP;
        });

        const check = this._iconButton('object-select-symbolic', () =>
            this._emit({op: 'set', id: task.id, state: 'done', alert: false}));

        for (const child of [grip, dot, texts, clock, check])
            row.add_child(child);
        return row;
    }

    /**
     * Put a task in wait state or shift its deadline.
     *
     * @param {object} task
     * @param {number} minutes - added to the remaining time (negative shortens)
     */
    _addWait(task, minutes) {
        const now = Date.now();
        const base = task.state === 'wait' && task.until ? Math.max(Date.parse(task.until), now) : now;
        const until = Math.max(base + minutes * 60000, now + 60000);
        this._emit({op: 'set', id: task.id, state: 'wait', until: new Date(until).toISOString(), alert: false});
    }
}
