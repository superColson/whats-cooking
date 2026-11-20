// Kitchen model: replays the shared journal (same rules as bin/cook).

export const STATES = ['queued', 'cooking', 'waiting', 'ready', 'done'];
export const PALETTE = [
  '#3584e4', '#2ec27e', '#f5c211', '#ff7800', '#e01b24', '#9141ac', '#e66198', '#986a44',
]
const LEGACY_STATES = {todo: 'queued', doing: 'cooking', wait: 'waiting'};
const DAY_START_HOUR = 4;
export const TAG_MAX = 20;

/**
 * Replay journal text into dishes, tags and the last wash time.
 *
 * @param {string} text journal content (JSON lines)
 * @returns {{dishes: object[], tags: Map<string, object>, washedAt: string|null}}
 */
export function fold(text) {
  const dishes = new Map();
  const tags = new Map();
  let order = [];
  let washedAt = null;
  const touchTag = (name, ts) => {
    if (!name) return;
    const tag = tags.get(name) ?? {name, color: null, used: ts};
    tag.used = ts ?? tag.used;
    tags.set(name, tag);
  };
  for (const line of text.split('\n')) {
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    const dish = dishes.get(ev.id);
    switch (ev.op) {
    case 'add':
      if (dish) break;
      dishes.set(ev.id, {
        id: ev.id, title: ev.title ?? '', tag: ev.tag ?? '', source: ev.source ?? 'manual',
        state: LEGACY_STATES[ev.state] ?? ev.state ?? 'queued', until: ev.until ?? null,
        titleLocked: false, created: ev.ts, doneAt: null,
      });
      order.unshift(ev.id);
      touchTag(ev.tag, ev.ts);
      break;
    case 'set':
      if (!dish) break;
      if ('title' in ev) dish.title = ev.title;
      if ('tag' in ev) { dish.tag = ev.tag; touchTag(ev.tag, ev.ts); }
      if ('until' in ev) dish.until = ev.until;
      if ('title_locked' in ev) dish.titleLocked = ev.title_locked;
      if ('state' in ev) {
        dish.state = LEGACY_STATES[ev.state] ?? ev.state;
        dish.doneAt = dish.state === 'done' ? ev.ts : null;
      }
      if (ev.alert && dish.state === 'waiting') dish.state = 'ready';
      break;
    case 'move': {
      if (!dish) break;
      order = order.filter(id => id !== ev.id);
      order.splice(ev.after ? order.indexOf(ev.after) + 1 : 0, 0, ev.id);
      break;
    }
    case 'delete':
      dishes.delete(ev.id);
      order = order.filter(id => id !== ev.id);
      break;
    case 'tag':
      if (!ev.name) break;
      touchTag(ev.name, tags.get(ev.name)?.used ?? ev.ts);
      if (ev.color) tags.get(ev.name).color = ev.color;
      break;
    case 'tag_delete':
      tags.delete(ev.name);
      break;
    case 'wash':
      washedAt = ev.ts;
      break;
    }
  }
  [...tags.values()].forEach((tag, i) => { tag.color = nearestColor(tag.color ?? PALETTE[i % PALETTE.length]); });
  return {dishes: order.map(id => dishes.get(id)).filter(Boolean), tags, washedAt};
}

/**
 * Map any color to the closest palette color (older journals used a larger palette).
 *
 * @param {string} hex `#rrggbb`
 * @returns {string}
 */
export function nearestColor(hex) {
  if (PALETTE.includes(hex)) return hex;
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const [r, g, b] = rgb(hex);
  let best = PALETTE[0];
  let bestDist = Infinity;
  for (const color of PALETTE) {
    const [r2, g2, b2] = rgb(color);
    const dist = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
    if (dist < bestDist) { best = color; bestDist = dist; }
  }
  return best;
}

/**
 * Tell whether a Waiting dish has reached its deadline.
 *
 * @param {object} dish
 * @param {number} now epoch milliseconds
 * @returns {boolean}
 */
export function isExpired(dish, now) {
  return dish.state === 'waiting' && !!dish.until && Date.parse(dish.until) <= now;
}

/**
 * Return when the current working day started (4 a.m. local time).
 *
 * @param {number} now epoch milliseconds
 * @returns {number} epoch milliseconds
 */
export function dayStart(now) {
  const d = new Date(now - DAY_START_HOUR * 3600e3);
  d.setHours(DAY_START_HOUR, 0, 0, 0);
  return d.getTime();
}

/**
 * Split quick-entry text into title, tag and wait minutes.
 *
 * @param {string} text e.g. `Restore backup #acme /w 20`
 * @returns {{title: string, tag: string, wait: number|null}}
 */
export function parseInput(text) {
  let tag = '';
  let wait = null;
  const title = text
    .replace(/\/w\s*(\d+)/i, (_m, minutes) => { wait = Number(minutes); return ''; })
    .replace(/#([\w-]+)/g, (_m, name) => { if (!tag) tag = name.slice(0, TAG_MAX); return ''; })
    .replace(/\s+/g, ' ')
    .trim();
  return {title, tag, wait};
}

/**
 * Return a short unique dish id.
 *
 * @returns {string}
 */
export function newId() {
  return Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}
