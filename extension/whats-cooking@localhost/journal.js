import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

export const DATA_DIR = GLib.build_filenamev([GLib.get_user_data_dir(), 'whats-cooking']);
export const JOURNAL = GLib.build_filenamev([DATA_DIR, 'journal.jsonl']);
export const UI_FILE = GLib.build_filenamev([DATA_DIR, 'ui.json']);

/**
 * Return a short unique task id.
 *
 * @returns {string}
 */
export function newId() {
    return Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}

/**
 * Read a UTF-8 file, returning an empty string when missing.
 *
 * @param {string} path
 * @returns {string}
 */
export function readText(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? new TextDecoder().decode(bytes) : '';
    } catch {
        return '';
    }
}

/**
 * Overwrite a UTF-8 file.
 *
 * @param {string} path
 * @param {string} text
 */
export function writeText(path, text) {
    GLib.mkdir_with_parents(DATA_DIR, 0o755);
    GLib.file_set_contents(path, text);
}

/**
 * Append one event line to the journal.
 *
 * @param {object} event - event payload, `ts` is added when absent
 */
export function appendEvent(event) {
    GLib.mkdir_with_parents(DATA_DIR, 0o755);
    const line = `${JSON.stringify({ts: new Date().toISOString(), ...event})}\n`;
    const stream = Gio.File.new_for_path(JOURNAL).append_to(Gio.FileCreateFlags.NONE, null);
    stream.write_all(new TextEncoder().encode(line), null);
    stream.close(null);
}

/**
 * Replay journal events into the ordered task list.
 *
 * @param {string} text - journal content (JSON lines)
 * @returns {object[]} tasks in display order, done ones included
 */
export function foldJournal(text) {
    const tasks = new Map();
    let order = [];
    for (const line of text.split('\n')) {
        if (!line.trim())
            continue;
        let ev;
        try {
            ev = JSON.parse(line);
        } catch {
            continue;
        }
        const task = tasks.get(ev.id);
        switch (ev.op) {
        case 'add':
            if (task)
                break;
            tasks.set(ev.id, {
                id: ev.id,
                title: ev.title ?? '',
                tag: ev.tag ?? '',
                source: ev.source ?? 'manual',
                state: ev.state ?? 'todo',
                until: ev.until ?? null,
                alert: false,
                created: ev.ts,
                doneAt: null,
            });
            order.unshift(ev.id);
            break;
        case 'set':
            if (!task)
                break;
            for (const key of ['title', 'tag', 'state', 'until', 'alert']) {
                if (key in ev)
                    task[key] = ev[key];
            }
            if ('state' in ev)
                task.doneAt = ev.state === 'done' ? ev.ts : null;
            break;
        case 'move': {
            if (!task)
                break;
            order = order.filter(id => id !== ev.id);
            const index = ev.after ? order.indexOf(ev.after) + 1 : 0;
            order.splice(index, 0, ev.id);
            break;
        }
        case 'delete':
            tasks.delete(ev.id);
            order = order.filter(id => id !== ev.id);
            break;
        }
    }
    return order.map(id => tasks.get(id)).filter(Boolean);
}

/**
 * Tell whether a task needs the user's attention.
 *
 * @param {object} task
 * @param {number} now - epoch milliseconds
 * @returns {boolean}
 */
export function isAlert(task, now) {
    if (task.state === 'done')
        return false;
    if (task.alert)
        return true;
    return task.state === 'wait' && !!task.until && Date.parse(task.until) <= now;
}

/**
 * Split quick-entry text into title, tag and wait minutes.
 *
 * Syntax: `Restore backup #clientA /w 20`.
 *
 * @param {string} text
 * @returns {{title: string, tag: string, wait: number|null}}
 */
export function parseInput(text) {
    let tag = '';
    let wait = null;
    const title = text
        .replace(/\/w\s*(\d+)/i, (_m, minutes) => {
            wait = Number(minutes);
            return '';
        })
        .replace(/#([\w-]+)/g, (_m, name) => {
            if (!tag)
                tag = name;
            return '';
        })
        .replace(/\s+/g, ' ')
        .trim();
    return {title, tag, wait};
}
