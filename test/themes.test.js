const test = require("node:test");
const assert = require("node:assert/strict");
const data = require("../src/themes.json");

const MODES = ["light", "dark"];
const TABS = ["underline", "pill"];
const CARDS = ["ruled", "boxed"];

test("registry shape", () => {
  assert.equal(data.themes.length, 7);
  const ids = data.themes.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
  for (const t of data.themes) {
    assert.match(t.id, /^[a-z0-9-]{1,32}$/, `${t.id}: id shape`);
    assert.ok(t.label, `${t.id}: label`);
    assert.ok(MODES.includes(t.mode), `${t.id}: mode`);
    assert.ok(TABS.includes(t.tabs), `${t.id}: tabs archetype`);
    assert.ok(CARDS.includes(t.cards), `${t.id}: cards archetype`);
  }
  const byId = Object.fromEntries(data.themes.map((t) => [t.id, t]));
  assert.equal(byId[data.default.light].mode, "light");
  assert.equal(byId[data.default.dark].mode, "dark");
  assert.deepEqual(ids.slice(0, 2), ["paper", "midnight"], "Paper and Midnight are kept first");
});

test("every theme defines exactly the same tokens", () => {
  const keys = (t) => Object.keys(t.vars).sort().join(",");
  const first = keys(data.themes[0]);
  for (const t of data.themes) assert.equal(keys(t), first, `${t.id}: token set differs`);
  assert.ok(Object.keys(data.themes[0].vars).length >= 50);
});

// ── WCAG contrast ───────────────────────────────────────────────────────────
function parse(c) {
  c = c.trim().toLowerCase();
  if (c === "transparent") return [0, 0, 0, 0];
  let m = c.match(/^#([0-9a-f]{6})$/);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = c.match(/^rgba?\(([^)]+)\)$/);
  if (m) { const p = m[1].split(",").map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
  throw new Error("unparseable colour: " + c);
}
function over(fg, bg) {
  return [0, 1, 2].map((i) => Math.round(fg[i] * fg[3] + bg[i] * (1 - fg[3]))).concat(1);
}
function lum([r, g, b]) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a, b) { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }

// text / background pairs that must reach WCAG AA (4.5:1). A translucent background is composited over the theme `bg`.
const PAIRS = [
  ["fg", "bg"], ["dim", "bg"], ["accent-fg", "accent"], ["accent-text", "bg"], ["accent-text", "side-bg"], ["accent-text", "card-bg"],
  ["side-fg", "side-bg"], ["side-dim", "side-bg"], ["side-fg", "card-bg"], ["side-dim", "card-bg"],
  ["btn-fg", "btn-bg"], ["btn-fg", "side-bg"], ["danger", "side-bg"], ["danger", "card-bg"],
  ["badge-fg", "badge-bg"], ["pop-fg", "pop-bg"], ["pop-dim", "pop-bg"], ["pop-fg", "pop-field"], ["side-fg", "pop-field"],
  ["side-fg", "hist-bg"], ["side-dim", "hist-bg"],
  ["pending-fg", "pending-bg"], ["done-fg", "done-bg"], ["pending-fg", "hist-bg"], ["done-fg", "hist-bg"], ["pending-fg", "side-bg"], ["done-fg", "side-bg"],
  ["dim", "seg-bg"], ["tab-active-fg", "tab-active-bg"], ["seg-active-fg", "seg-active-bg"],
];

for (const t of data.themes) {
  test(`${t.id}: text meets WCAG AA (4.5:1)`, () => {
    const base = parse(t.vars.bg);
    const failures = [];
    for (const [f, b] of PAIRS) {
      const bg = over(parse(t.vars[b]), base);
      const fg = over(parse(t.vars[f]), bg);
      const r = ratio(fg, bg);
      if (r < 4.5) failures.push(`${f} on ${b} = ${r.toFixed(2)}`);
    }
    assert.deepEqual(failures, []);
  });
}
