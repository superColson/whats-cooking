import {PALETTE, TAG_MAX, dayStart, fold, isExpired, newId, parseInput} from './model.js';

const tauri = window.__TAURI__;
const invoke = tauri.core.invoke;
const appWindow = tauri.window.getCurrentWindow();
const LogicalSize = tauri.dpi?.LogicalSize ?? tauri.window.LogicalSize;

const REFRESH_MS = 1000;
const TIMER_CLICK_MIN = 5;
const TIMER_WHEEL_MIN = 1;
const MIN_W = 384;
const MIN_H = 420;
const MAX_W = 640;
const MAX_H = 1260;
const SCREEN_MARGIN = 64;
const EXPANDED_W_RATIO = 0.9;
const EXPANDED_H_RATIO = 0.7;
const RESIZE_MS = 220;
const APP_TITLE = "What's cooking\u00a0?";
const DAY_MS = 86400e3;

const $ = id => document.getElementById(id);
const els = {
  card: $('card'), head: $('head'), count: $('count'), badge: $('badge'), entry: $('entry'), suggest: $('suggest'),
  list: $('list'), washer: $('washer'), washerTitle: $('washer-title'), washerList: $('washer-list'),
  popover: $('popover'),
};

let kitchen = {dishes: [], tags: new Map(), washedAt: null};
let lastText = null;
let busy = 0;           // > 0 while the user edits, drags or has a popover open
let pointerDown = false;
let renderPending = false;
let trayCount = -1;
let resizing = false;
const readyEmitted = new Set();
const prefs = loadPrefs();

// ---- persistence ------------------------------------------------------------

/**
 * Load per-window UI preferences.
 *
 * @returns {{washerOpen: boolean}}
 */
function loadPrefs() {
  try {
    return {washerOpen: false, ...JSON.parse(localStorage.getItem('prefs') || '{}')};
  } catch {
    return {washerOpen: false};
  }
}

/**
 * Save per-window UI preferences.
 */
function savePrefs() {
  try { localStorage.setItem('prefs', JSON.stringify(prefs)); } catch { /* private storage unavailable */ }
}

/**
 * Append an event to the journal, then refresh at once.
 *
 * @param {object} event
 */
async function emit(event) {
  await invoke('append_event', {event});
  await refresh(true);
}

/**
 * Register a tag with the next palette color the first time it is used.
 *
 * @param {string} name
 */
async function ensureTag(name) {
  if (name && !kitchen.tags.has(name))
    await invoke('append_event', {event: {op: 'tag', name, color: PALETTE[kitchen.tags.size % PALETTE.length]}});
}

/**
 * Re-read the journal and re-render when it changed (or when forced).
 *
 * @param {boolean} force re-render even if the journal is unchanged
 */
async function refresh(force = false) {
  const text = await invoke('read_journal');
  if (text !== lastText) {
    lastText = text;
    kitchen = fold(text);
    force = true;
  }
  await promoteExpired();
  if (force && !busy)
    render();
}

/**
 * Move Waiting dishes whose Timer ran out to Ready (stored in the journal).
 */
async function promoteExpired() {
  const now = Date.now();
  for (const dish of kitchen.dishes) {
    if (isExpired(dish, now) && !readyEmitted.has(dish.id)) {
      readyEmitted.add(dish.id);
      await invoke('append_event', {event: {op: 'set', id: dish.id, state: 'ready'}});
    }
  }
}

// ---- rendering --------------------------------------------------------------

/**
 * Build a small element with a class and optional text.
 *
 * @param {string} tag
 * @param {string} cls
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Return an inline SVG icon.
 *
 * @param {string} path SVG path data on a 16×16 grid
 * @returns {string}
 */
function icon(path) {
  return `<svg viewBox="0 0 16 16"><path d="${path}"/></svg>`;
}

/**
 * Describe the detail shown under the state name (timer, Claude activity).
 *
 * @param {object} dish
 * @param {number} now
 * @returns {string}
 */
function stateDetail(dish, now) {
  const claude = dish.source === 'claude';
  if (dish.state === 'waiting') {
    if (dish.until) return `${Math.max(1, Math.ceil((Date.parse(dish.until) - now) / 60e3))} min`;
    return claude ? 'Claude…' : '';
  }
  return '';
}

/**
 * Render a tag badge in its color.
 *
 * @param {string} name
 * @returns {HTMLElement}
 */
function tagBadge(name) {
  const color = kitchen.tags.get(name)?.color ?? PALETTE[0];
  const badge = el('span', 'tag', `#${name}`);
  badge.title = `#${name}`;
  badge.style.background = `${color}33`;
  badge.style.color = color;
  return badge;
}

/**
 * Rebuild the whole card from the folded kitchen.
 */
function render() {
  // Rebuilding rows between mousedown and mouseup would swallow the click.
  if (pointerDown) {
    renderPending = true;
    return;
  }
  renderPending = false;
  const now = Date.now();
  const active = kitchen.dishes.filter(d => d.state !== 'done');
  const ready = active.filter(d => d.state === 'ready').length;

  els.head.textContent = APP_TITLE;
  els.count.textContent = String(active.length);
  els.badge.hidden = !ready;
  els.badge.textContent = `${ready} ready`;
  if (active.length !== trayCount) {
    trayCount = active.length;
    invoke('set_tray_count', {count: trayCount}).catch(() => {});
  }

  els.list.replaceChildren(...active.map(d => dishRow(d, now)));
  if (!active.length) els.list.append(el('div', 'empty', 'Nothing cooking.'));
  renderWasher(now);
}

/**
 * Build one dish row with its controls.
 *
 * @param {object} dish
 * @param {number} now
 * @returns {HTMLElement}
 */
function dishRow(dish, now) {
  const row = el('div', `dish ${dish.state}`);
  row.dataset.id = dish.id;

  const grip = el('div', 'grip');
  grip.innerHTML = icon('M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01');

  const dot = el('button', `dot ${dish.state}`);
  dot.title = 'Queued ⇄ Cooking';
  dot.onclick = () => emit({op: 'set', id: dish.id, state: dish.state === 'cooking' ? 'queued' : 'cooking', until: null});

  const txt = el('div', 'txt');
  const title = el('div', 'title', dish.title);
  title.title = dish.title;
  title.ondblclick = () => editTitle(dish, title);
  const meta = el('div', 'meta');
  meta.append(el('span', `state ${dish.state}`, dish.state));
  const detail = stateDetail(dish, now);
  if (detail) meta.append(el('span', 'detail', `· ${detail}`));
  const age = now - Date.parse(dish.created);
  if (age >= DAY_MS) meta.append(el('span', 'age', `· ${Math.floor(age / DAY_MS)} d`));
  const tag = dish.tag ? tagBadge(dish.tag) : el('span', 'tag add', '+ tag');
  tag.onclick = ev => openTagPopover(dish, ev.currentTarget);
  meta.append(tag);

  const actions = el('div', 'actions');
  const timer = el('button', 'act');
  timer.innerHTML = icon('M8 5v3l2 1.5M8 14A5.5 5.5 0 1 0 8 3a5.5 5.5 0 0 0 0 11z');
  timer.title = 'Click +5 min · wheel ±1 min · right-click cancels';
  timer.onclick = () => shiftTimer(dish, TIMER_CLICK_MIN);
  timer.oncontextmenu = ev => {
    ev.preventDefault();
    emit({op: 'set', id: dish.id, state: 'cooking', until: null});
  };
  timer.onwheel = ev => {
    ev.preventDefault();
    shiftTimer(dish, ev.deltaY < 0 ? TIMER_WHEEL_MIN : -TIMER_WHEEL_MIN);
  };
  const done = el('button', 'act');
  done.innerHTML = icon('M3.5 8.5l3 3 6-7');
  done.title = 'Done';
  done.onclick = () => {
    row.classList.add('leaving');
    setTimeout(() => emit({op: 'set', id: dish.id, state: 'done', until: null}), 260);
  };
  const del = el('button', 'act del');
  del.innerHTML = icon('M4 4l8 8M12 4l-8 8');
  del.title = 'Delete (click twice)';
  del.onclick = () => {
    if (del.classList.contains('armed')) {
      emit({op: 'delete', id: dish.id});
      return;
    }
    del.classList.add('armed');
    del.title = 'Click again to delete';
    setTimeout(() => del.classList.remove('armed'), 2500);
  };
  // Claude decides when its own turn ends; the Timer only snoozes a finished (Ready) Claude dish.
  const claudeWorking = dish.source === 'claude' && dish.state === 'waiting' && !dish.until;
  if (dish.source === 'claude' && dish.state === 'ready') timer.title = 'Remind me later: click +5 min · wheel ±1 min';
  actions.append(...(claudeWorking ? [done, del] : [timer, done, del]));

  txt.append(title, meta);
  row.append(grip, dot, txt, actions);
  return row;
}

/**
 * Render the Dishwasher: dishes done this working day, since the last wash.
 *
 * @param {number} now
 */
function renderWasher(now) {
  const since = Math.max(dayStart(now), kitchen.washedAt ? Date.parse(kitchen.washedAt) : 0);
  const clean = kitchen.dishes
    .filter(d => d.state === 'done' && d.doneAt && Date.parse(d.doneAt) >= since)
    .sort((a, b) => Date.parse(b.doneAt) - Date.parse(a.doneAt));
  els.washerTitle.textContent = `Dishwasher · ${clean.length}`;
  els.washer.classList.toggle('open', prefs.washerOpen);
  els.washerList.replaceChildren(...clean.map(dish => {
    const row = el('div', 'clean');
    row.title = 'Click to bring it back to Queued';
    const time = el('time', '', new Date(dish.doneAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}));
    row.append(el('span', 'title', dish.title));
    if (dish.tag) row.append(tagBadge(dish.tag));
    row.append(time);
    row.onclick = () => emit({op: 'set', id: dish.id, state: 'queued', until: null});
    return row;
  }));
}

// ---- dish actions -----------------------------------------------------------

/**
 * Start a Timer or shift its deadline (never below one minute from now).
 *
 * @param {object} dish
 * @param {number} minutes
 */
function shiftTimer(dish, minutes) {
  const now = Date.now();
  const base = dish.state === 'waiting' && dish.until ? Math.max(Date.parse(dish.until), now) : now;
  const until = Math.max(base + minutes * 60e3, now + 60e3);
  readyEmitted.delete(dish.id);
  emit({op: 'set', id: dish.id, state: 'waiting', until: new Date(until).toISOString()});
}

/**
 * Replace a title with an inline editor; Enter saves, Escape cancels.
 *
 * @param {object} dish
 * @param {HTMLElement} title
 */
function editTitle(dish, title) {
  busy++;
  const input = el('input', 'title-edit');
  input.value = dish.title;
  title.replaceWith(input);
  input.focus();
  input.select();
  let closed = false;
  const close = save => {
    if (closed) return;
    closed = true;
    busy--;
    const value = input.value.trim();
    if (save && value && value !== dish.title)
      emit({op: 'set', id: dish.id, title: value, title_locked: true});
    else
      render();
  };
  input.onkeydown = ev => {
    if (ev.key === 'Enter') close(true);
    if (ev.key === 'Escape') close(false);
  };
  input.onblur = () => close(true);
}

/**
 * Open the tag picker for a dish: pick, create, clear or recolor a tag.
 *
 * @param {object} dish
 * @param {HTMLElement} anchor
 */
function openTagPopover(dish, anchor) {
  closePopover();
  busy++;
  const pop = els.popover;
  const input = el('input');
  input.placeholder = 'Find or create a tag';
  const options = el('div');
  pop.replaceChildren(input, options);

  const fill = () => {
    const query = input.value.trim().replace(/^#/, '').toLowerCase();
    const tags = [...kitchen.tags.values()]
      .filter(t => t.name.toLowerCase().includes(query))
      .sort((a, b) => Date.parse(b.used ?? 0) - Date.parse(a.used ?? 0));
    const rows = tags.slice(0, 8).map(t => {
      const opt = el('div', 'opt');
      const sw = el('span', 'swatch');
      sw.style.background = t.color;
      const name = el('span', 'name', `#${t.name}`);
      const rm = el('button', 'rm');
      rm.innerHTML = icon('M4 4l8 8M12 4l-8 8');
      rm.title = `Delete #${t.name} (click twice)`;
      rm.onclick = ev => {
        ev.stopPropagation();
        if (rm.classList.contains('armed')) {
          deleteTag(t.name);
          return;
        }
        rm.classList.add('armed');
        rm.title = 'Click again: removes the tag from the list and from active dishes';
        setTimeout(() => rm.classList.remove('armed'), 2500);
      };
      opt.append(sw, name, rm);
      opt.onclick = () => assignTag(dish, t.name);
      return opt;
    });
    if (query && !kitchen.tags.has(query)) {
      const create = el('div', 'opt', `Create #${query}`);
      create.onclick = () => assignTag(dish, query);
      rows.push(create);
    }
    if (dish.tag) {
      const clear = el('div', 'opt', 'Remove tag');
      clear.onclick = () => assignTag(dish, '');
      rows.push(clear);
    }
    options.replaceChildren(...rows);
    if (dish.tag) options.append(palette(dish.tag));
  };
  input.oninput = fill;
  input.onkeydown = ev => {
    if (ev.key === 'Escape') closePopover();
    if (ev.key === 'Enter') {
      const name = input.value.trim().replace(/^#/, '');
      if (name) assignTag(dish, name);
    }
  };
  fill();

  const box = anchor.getBoundingClientRect();
  pop.hidden = false;
  pop.style.left = `${Math.min(box.left, window.innerWidth - 210)}px`;
  pop.style.top = `${Math.min(box.bottom + 4, window.innerHeight - pop.offsetHeight - 8)}px`;
  input.focus();
  setTimeout(() => document.addEventListener('mousedown', outsideClose), 0);
}

/**
 * Build the color palette for a tag.
 *
 * @param {string} name
 * @returns {HTMLElement}
 */
function palette(name) {
  const box = el('div', 'palette');
  const current = kitchen.tags.get(name)?.color;
  for (const color of PALETTE) {
    const sw = el('button', color === current ? 'on' : '');
    sw.style.background = color;
    sw.title = `Color of #${name}`;
    sw.onclick = () => { closePopover(); emit({op: 'tag', name, color}); };
    box.append(sw);
  }
  return box;
}

/**
 * Set a dish tag, creating the tag if needed.
 *
 * @param {object} dish
 * @param {string} name empty string clears the tag
 */
async function assignTag(dish, name) {
  name = name.slice(0, TAG_MAX);
  closePopover();
  await ensureTag(name);
  emit({op: 'set', id: dish.id, tag: name});
}

/**
 * Delete a tag from the list and clear it from active dishes (done ones keep it for the log).
 *
 * @param {string} name
 */
async function deleteTag(name) {
  closePopover();
  await invoke('append_event', {event: {op: 'tag_delete', name}});
  for (const dish of kitchen.dishes) {
    if (dish.state !== 'done' && dish.tag === name)
      await invoke('append_event', {event: {op: 'set', id: dish.id, tag: ''}});
  }
  await refresh(true);
}

/**
 * Close the popover when clicking outside it.
 *
 * @param {MouseEvent} ev
 */
function outsideClose(ev) {
  if (!els.popover.contains(ev.target)) closePopover();
}

/**
 * Hide the tag popover and resume rendering.
 */
function closePopover() {
  if (els.popover.hidden) return;
  els.popover.hidden = true;
  document.removeEventListener('mousedown', outsideClose);
  busy--;
  render();
}

// ---- quick entry with tag autocompletion ------------------------------------

let suggestions = [];
let suggestIndex = 0;

/**
 * Return the `#partial` tag being typed at the caret, if any.
 *
 * @returns {{start: number, query: string}|null}
 */
function tagAtCaret() {
  const caret = els.entry.selectionStart;
  const match = els.entry.value.slice(0, caret).match(/#([\w-]*)$/);
  return match ? {start: caret - match[0].length, query: match[1].toLowerCase()} : null;
}

/**
 * Show existing tags matching the `#partial` at the caret, recent first.
 */
function updateSuggest() {
  const at = tagAtCaret();
  suggestions = at
    ? [...kitchen.tags.values()]
      .filter(t => t.name.toLowerCase().startsWith(at.query))
      .sort((a, b) => Date.parse(b.used ?? 0) - Date.parse(a.used ?? 0))
      .slice(0, 6)
    : [];
  suggestIndex = 0;
  els.suggest.hidden = !suggestions.length;
  els.suggest.replaceChildren(...suggestions.map((t, i) => {
    const li = el('li', i === suggestIndex ? 'on' : '');
    const sw = el('span', 'swatch');
    sw.style.background = t.color;
    li.append(sw, el('span', '', `#${t.name}`));
    li.onmousedown = ev => { ev.preventDefault(); completeTag(t.name); };
    return li;
  }));
}

/**
 * Replace the `#partial` at the caret with a full tag.
 *
 * @param {string} name
 */
function completeTag(name) {
  const at = tagAtCaret();
  if (!at) return;
  const value = els.entry.value;
  const caret = els.entry.selectionStart;
  els.entry.value = `${value.slice(0, at.start)}#${name} ${value.slice(caret)}`;
  const pos = at.start + name.length + 2;
  els.entry.setSelectionRange(pos, pos);
  updateSuggest();
}

/**
 * Create a dish from the quick entry.
 */
async function submitEntry() {
  const {title, tag, wait} = parseInput(els.entry.value);
  if (!title) return;
  await ensureTag(tag);
  const event = {op: 'add', id: newId(), title, tag, source: 'manual', state: 'queued'};
  if (wait) {
    event.state = 'waiting';
    event.until = new Date(Date.now() + wait * 60e3).toISOString();
  }
  els.entry.value = '';
  updateSuggest();
  emit(event);
}

els.entry.addEventListener('input', updateSuggest);
els.entry.addEventListener('keydown', ev => {
  if (!els.suggest.hidden) {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      suggestIndex = (suggestIndex + (ev.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length;
      [...els.suggest.children].forEach((li, i) => li.classList.toggle('on', i === suggestIndex));
      return;
    }
    if (ev.key === 'Tab' || (ev.key === 'Enter' && tagAtCaret()?.query !== undefined && suggestions.length)) {
      ev.preventDefault();
      completeTag(suggestions[suggestIndex].name);
      return;
    }
    if (ev.key === 'Escape') { els.suggest.hidden = true; return; }
  }
  if (ev.key === 'Enter') submitEntry();
  if (ev.key === 'Escape') { els.entry.value = ''; els.entry.blur(); }
});
els.entry.addEventListener('blur', () => { els.suggest.hidden = true; });

// ---- reorder ----------------------------------------------------------------

window.Sortable.create(els.list, {
  handle: '.grip',
  animation: 180,
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
  onStart: () => { busy++; },
  onEnd: ev => {
    busy--;
    if (ev.oldIndex === ev.newIndex) return;
    const ids = [...els.list.children].map(row => row.dataset.id);
    const pos = ids.indexOf(ev.item.dataset.id);
    emit({op: 'move', id: ev.item.dataset.id, after: pos > 0 ? ids[pos - 1] : null});
  },
});

// ---- window chrome ----------------------------------------------------------

$('hide').onclick = () => appWindow.hide();
/**
 * Size of the expanded card: a share of the largest size the screen allows.
 *
 * @returns {Promise<{width: number, height: number}>}
 */
async function expandedSize() {
  const monitor = await tauri.window.currentMonitor();
  let width = MAX_W;
  let height = MAX_H;
  if (monitor) {
    const screen = (monitor.workArea?.size ?? monitor.size).toLogical(monitor.scaleFactor);
    width = Math.min(MAX_W, screen.width - SCREEN_MARGIN);
    height = Math.min(MAX_H, screen.height - SCREEN_MARGIN);
  }
  return {
    width: Math.max(MIN_W, Math.round(width * EXPANDED_W_RATIO)),
    height: Math.max(MIN_H, Math.round(height * EXPANDED_H_RATIO)),
  };
}

/**
 * Return the current inner size of the window in logical pixels.
 *
 * @returns {Promise<{width: number, height: number}>}
 */
async function currentSize() {
  return (await appWindow.innerSize()).toLogical(await appWindow.scaleFactor());
}

/**
 * Show the shrink icon when expanded, the grow icon otherwise.
 */
async function syncSizeButton() {
  if (resizing) return;
  const size = await currentSize();
  const target = await expandedSize();
  const expanded = size.width >= target.width - 8 && size.height >= target.height - 8;
  els.card.classList.toggle('maxed', expanded);
  $('size').title = expanded ? 'Shrink to compact size' : 'Expand';
}

/**
 * Resize the window to a target size with an ease-out animation.
 *
 * Under GNOME the pin extension animates the window, moving and resizing it
 * in one step per frame; elsewhere the window is resized frame by frame here.
 *
 * @param {{width: number, height: number}} target logical size
 */
async function animateSize(target) {
  resizing = true;
  const byShell = await invoke('animate_card', {width: target.width, height: target.height, duration: RESIZE_MS})
    .catch(() => false);
  if (byShell) {
    await new Promise(resolve => setTimeout(resolve, RESIZE_MS + 60));
  } else {
    const from = await currentSize();
    const start = performance.now();
    for (;;) {
      const t = Math.min(1, (performance.now() - start) / RESIZE_MS);
      const k = 1 - (1 - t) ** 3;
      await appWindow.setSize(new LogicalSize(
        Math.round(from.width + (target.width - from.width) * k),
        Math.round(from.height + (target.height - from.height) * k)));
      if (t >= 1) break;
      await new Promise(requestAnimationFrame);
    }
  }
  resizing = false;
  syncSizeButton();
}

$('size').onclick = async () => {
  if (resizing) return;
  const expanded = els.card.classList.contains('maxed');
  els.card.classList.toggle('maxed', !expanded);
  await animateSize(expanded ? {width: MIN_W, height: MIN_H} : await expandedSize());
};
appWindow.onResized(() => syncSizeButton());
$('washer-toggle').onclick = () => {
  prefs.washerOpen = !prefs.washerOpen;
  savePrefs();
  render();
};
$('wash').onclick = () => emit({op: 'wash'});
$('resize').onmousedown = ev => {
  ev.preventDefault();
  appWindow.startResizeDragging('SouthEast');
};
/**
 * Forget a pressed button and run the render it postponed.
 */
function releasePointer() {
  pointerDown = false;
  if (renderPending) setTimeout(() => { if (!busy) render(); }, 0);
}

// Header (move) and corner (resize) presses hand the pointer to the compositor, which keeps the release.
document.addEventListener('mousedown', ev => {
  if (!ev.target.closest('[data-tauri-drag-region], #resize')) pointerDown = true;
}, true);
document.addEventListener('mouseup', releasePointer, true);
document.addEventListener('pointercancel', releasePointer, true);
document.documentElement.addEventListener('mouseleave', releasePointer);
window.addEventListener('blur', releasePointer);
window.addEventListener('focus', () => {
  if (document.activeElement === document.body) els.entry.focus();
});

syncSizeButton();
refresh(true);
setInterval(() => refresh(false), REFRESH_MS);
setInterval(() => { if (!busy) render(); }, 20e3);
