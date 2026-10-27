#!/usr/bin/env node
// Fast persona test. After dmoka/quicke2e: each step the page becomes a list of legal moves,
// a decision model (Jev) picks one key in the persona's style, and CODE decides what is a bug.
// The model writes no text: typed values come from the persona's `inputs` in personas.yaml.
//
//   node persona-run.mjs --personas ../../../../todo/personas.yaml --url http://127.0.0.1:8771/index.html
//        [--steps 20] [--engine jev|stub] [--out runs/<stamp>] [--seed 1] [--headed]
import { chromium } from "playwright";
import { parse } from "yaml";
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const flag = (n) => process.argv.includes(`--${n}`);
const PERSONAS = resolve(arg("personas", "personas.yaml"));
const URL_ = arg("url", "http://127.0.0.1:8771/index.html");
const STEPS = Number(arg("steps", 20));
const ENGINE = arg("engine", "jev");
const SEED = Number(arg("seed", 1));
const OUT = resolve(arg("out", join(HERE, "runs", new Date().toISOString().replace(/[:.]/g, "-"))));
const ONLY = arg("only");  // comma-separated persona ids

// ---- key: env first, else the repo-root .env (never printed, never written anywhere) -------------
function jevKey() {
  if (process.env.JEV_API_KEY) return process.env.JEV_API_KEY;
  for (let d = HERE; d !== dirname(d); d = dirname(d)) {
    const f = join(d, ".env");
    if (existsSync(f)) { const m = readFileSync(f, "utf8").match(/^\s*JEV_API_KEY\s*=\s*"?([^"\n]+)"?/m); if (m) return m[1].trim(); }
  }
  return null;
}

// ---- engines ------------------------------------------------------------------------------------
const rngFor = (seed) => { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); };
let SCRIPT = null;
let usage = { calls: 0, ms: 0, tokens: 0, errors: 0 };
async function decide({ state, criteria, persona, goal, rng }) {
  const keys = Object.keys(criteria);
  if (ENGINE === "script") {  // replay: persona id -> list of regexes matched against move descriptions
    SCRIPT ??= JSON.parse(readFileSync(resolve(arg("script")), "utf8"));
    const want = (SCRIPT[persona.id] || [])[state.done_count];
    if (!want) return { choice: "__END__", confidence: 1 };
    const re = new RegExp(want, "i"), hit = keys.find((k) => re.test(criteria[k]) || re.test(k));
    return { choice: hit || `__NO_MATCH__ ${want}`, confidence: 1 };
  }
  if (ENGINE === "stub") return { choice: keys[Math.floor(rng() * keys.length)], confidence: 1 / keys.length };
  const key = jevKey();
  if (!key) throw new Error("JEV_API_KEY not set (env or .env)");
  const body = { model: arg("model", "jev-latest"), state: JSON.stringify(state), questions: { action: {
    type: "choice", criteria,
    instructions: { persona: persona.profile.trim(), goal, rules:
      "Choose the one next move this person would make on this page, in their style. " +
      "Prefer moves that pursue the goal; avoid repeating a move that just changed nothing." } } } };
  const t0 = performance.now();
  for (let k = 0; ; k++) {
    const res = await fetch("https://api.typesafe.ai/v1/systemone", { method: "POST",
      signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify(body) })
      .catch((e) => ({ ok: false, status: 0, text: async () => String(e) }));
    if (res.ok) {
      const j = await res.json(); usage.calls++; usage.ms += performance.now() - t0;
      usage.tokens += j.usage?.input_tokens || j.usage?.inputTokens || 0;
      return { choice: j.answers.action.choice, confidence: j.answers.action.confidence };
    }
    if (k < 3 && (res.status === 0 || res.status === 429 || res.status >= 500)) { await new Promise((r) => setTimeout(r, 400 * 2 ** k)); continue; }
    usage.errors++;
    throw new Error(`jev HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  }
}

// ---- page -> legal moves --------------------------------------------------------------------------
async function snapshot(page) {
  return page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && !el.closest("[hidden]"); };
    const label = (el) => (el.getAttribute("aria-label") || (el.labels && el.labels[0] && el.labels[0].innerText) ||
      el.getAttribute("placeholder") || el.innerText || el.value || el.name || el.id || el.tagName).trim().replace(/\s+/g, " ").slice(0, 50);
    const els = [];
    document.querySelectorAll("button, a[href], input, select, textarea, [role=button], [tabindex]:not([tabindex='-1'])").forEach((el) => {
      if (!vis(el) || el.disabled) return;
      const id = String(els.length); el.setAttribute("data-pt", id);
      const type = el.tagName === "INPUT" ? (el.type || "text") : el.tagName.toLowerCase();
      const r = el.getBoundingClientRect();
      els.push({ id, type, label: label(el), value: ("value" in el && el.type !== "checkbox") ? String(el.value).slice(0, 40) : undefined,
        checked: el.type === "checkbox" ? el.checked : undefined,
        options: el.tagName === "SELECT" ? [...el.options].map((o) => o.text).slice(0, 8) : undefined,
        cx: r.x + r.width / 2, cy: r.y + r.height / 2 });
    });
    const main = (document.querySelector("main") || document.body).innerText;
    const ae = document.activeElement;
    return { url: location.pathname, title: document.title, text: main.replace(/\s+/g, " ").slice(0, 700),
      fullText: main, rows: document.querySelectorAll("li, [role=listitem]").length, els, focused: ae && ae !== document.body ? ae.getAttribute("data-pt") : null,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
}

function legalMoves(snap, persona) {
  const inp = persona.inputs || {}, texts = inp.text || ["Buy milk"], dates = inp.dates || ["2027-01-31T09:00"];
  const b = persona.behaviour || {}, c = {};
  if (b.keyboard_only) {
    Object.assign(c, { KEY_Tab: "press Tab", KEY_ShiftTab: "press Shift+Tab", KEY_Enter: "press Enter",
      KEY_Space: "press Space", KEY_Escape: "press Escape" });
    const f = snap.els.find((e) => e.id === snap.focused);
    if (f && /text|search|textarea/.test(f.type)) texts.slice(0, 6).forEach((t, k) => { c[`TYPEF_${k}`] = `type "${t.slice(0, 40)}" into the focused ${f.label} field`; });
    if (f && f.type === "datetime-local") dates.forEach((d, k) => { c[`DATEF_${k}`] = `enter date ${d} into the focused field`; });
  } else {
    for (const e of snap.els) {
      if (/^(text|search|textarea|email|url)$/.test(e.type)) {
        texts.slice(0, 6).forEach((t, k) => { c[`TYPE_${e.id}_${k}`] = `type "${t.slice(0, 40)}" into ${e.label} [${e.type}]`; });
        if (e.value) c[`ENTER_${e.id}`] = `press Enter in ${e.label}`;
      } else if (e.type === "datetime-local" || e.type === "date") {
        dates.slice(0, 3).forEach((d, k) => { c[`DATE_${e.id}_${k}`] = `set ${e.label} to ${d}`; });
      } else if (e.type === "number") {
        (inp.numbers || ["2", "0", "-1"]).slice(0, 3).forEach((n, k) => { c[`NUM_${e.id}_${k}`] = `set ${e.label} to ${n}`; });
      } else if (e.type === "select") {
        (e.options || []).forEach((o, k) => { c[`SELECT_${e.id}_${k}`] = `choose "${o}" in ${e.label}`; });
      } else {
        c[`CLICK_${e.id}`] = `click ${e.label} [${e.type === "checkbox" ? `checkbox, ${e.checked ? "checked" : "unchecked"}` : e.type}]`;
      }
    }
  }
  c.RELOAD = "reload the page";
  const keys = Object.keys(c);
  if (keys.length > 80) for (const k of keys.slice(80)) if (k !== "RELOAD") delete c[k];  // cap one decision's size
  return c;
}

// ---- execute one move, with persona motor behaviour ------------------------------------------------
async function act(page, key, snap, persona, rng, log) {
  const b = persona.behaviour || {}, inp = persona.inputs || {};
  const texts = inp.text || ["Buy milk"], dates = inp.dates || ["2027-01-31T09:00"];
  const el = (id) => page.locator(`[data-pt="${id}"]`);
  const [kind, id, k] = key.split("_");
  const o = { timeout: 3000 };
  if (kind === "KEY") return page.keyboard.press(id === "ShiftTab" ? "Shift+Tab" : id);
  if (kind === "TYPEF") return page.keyboard.type(texts[Number(id)]);
  if (kind === "DATEF") return page.evaluate((v) => { const a = document.activeElement; a.value = v; a.dispatchEvent(new Event("input", { bubbles: true })); a.dispatchEvent(new Event("change", { bubbles: true })); }, dates[Number(id)]);
  if (kind === "RELOAD") return page.reload();
  if (kind === "TYPE") return el(id).fill(texts[Number(k)], o);
  if (kind === "ENTER") return el(id).press("Enter", o);
  if (kind === "DATE") return el(id).fill(dates[Number(k)], o);
  if (kind === "NUM") return el(id).fill((inp.numbers || ["2", "0", "-1"])[Number(k)], o);
  if (kind === "SELECT") return el(id).selectOption({ index: Number(k) }, o);
  if (kind === "CLICK") {
    const e = snap.els.find((x) => x.id === id);
    if (b.mistap && rng() < b.mistap && e) {  // shaky hand: lands just below the target
      log.push(`(mis-tapped near ${e.label})`); return page.mouse.click(e.cx + (rng() * 16 - 8), e.cy + 14 + rng() * 8);
    }
    if (b.double_click && rng() < b.double_click) { log.push(`(double-clicked ${e?.label})`); return el(id).dblclick(o); }
    return el(id).click(o);
  }
}

// Every record in every IndexedDB store, as a sorted JSON list (persistence oracle reads state, not UI).
async function storedData(page) {
  return page.evaluate(async () => {
    if (!indexedDB.databases) return null;
    const out = [];
    for (const { name } of await indexedDB.databases()) {
      const db = await new Promise((ok, no) => { const r = indexedDB.open(name); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
      for (const st of db.objectStoreNames) {
        const rows = await new Promise((ok) => { const r = db.transaction(st).objectStore(st).getAll(); r.onsuccess = () => ok(r.result); r.onerror = () => ok([]); });
        rows.forEach((x) => out.push(JSON.stringify([name, st, x])));
      }
      db.close();
    }
    return out.sort();
  }).catch(() => null);
}

// ---- oracles: code decides what is a bug -------------------------------------------------------------
const BAD_RENDER = /\b(Invalid Date|NaN|undefined|null)\b|\[object Object\]/;
async function check(page, before, after, key, persona, errors) {
  const f = [];
  if (errors.length) f.push({ type: "console-error", severity: "high", detail: errors.splice(0).join(" | ").slice(0, 200) });
  const pwned = await page.evaluate(() => !!window.__pt_pwned || !!document.querySelector("[data-pt-xss], img[src='x'], svg[onload]"));
  if (pwned) f.push({ type: "xss", severity: "high", detail: "a payload from a text field ran or rendered as markup" });
  if (after.overflow > 4) f.push({ type: "horizontal-overflow", severity: "medium", detail: `page is ${after.overflow}px wider than the viewport` });
  const m = after.fullText.match(BAD_RENDER);
  if (m && !(before.fullText.match(BAD_RENDER))) f.push({ type: "bad-render", severity: "medium", detail: `"${m[0]}" appeared on the page` });
  if (/^(KEY_Enter|KEY_Space|CLICK)/.test(key) && !after.focused) {
    const kb = persona.behaviour?.keyboard_only;
    if (kb) f.push({ type: "focus-lost", severity: "medium", detail: "focus dropped to the page body after the action" });
  }
  if ((key.startsWith("ENTER") || key.startsWith("CLICK") || key === "KEY_Enter") && after.rows - before.rows > 1)
    f.push({ type: "duplicate-add", severity: "low", detail: `one action added ${after.rows - before.rows} list rows` });
  if (key === "RELOAD" && before.stored && after.stored) {
    const lost = before.stored.filter((x) => !after.stored.includes(x));
    if (lost.length) f.push({ type: "data-lost-on-reload", severity: "high", detail: `${lost.length} stored record(s) changed or vanished across a reload` });
  }
  return f;
}

// ---- one persona ---------------------------------------------------------------------------------------
async function runPersona(browser, persona, idx) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });  // own storage: own IndexedDB
  await ctx.addInitScript(() => { window.alert = window.confirm = window.prompt = () => { window.__pt_pwned = 1; }; });
  const page = await ctx.newPage(), errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("dialog", (d) => d.dismiss().catch(() => {}));
  const rng = rngFor(SEED * 97 + idx), log = [], findings = [], seen = new Set();
  const goal = persona.goal || "Use this app the way you normally would.";
  const t0 = performance.now(); let steps = 0, stop = null;
  try {
    await page.goto(URL_, { waitUntil: "load" });
    for (; steps < Math.min(STEPS, persona.patience_steps || STEPS); steps++) {
      const before = await snapshot(page);
      before.stored = null;
      const criteria = legalMoves(before, persona);
      const state = { url: before.url, title: before.title, page_text: before.text, focused: before.focused,
        elements: before.els.map(({ id, type, label, value, checked }) => ({ id, type, label, value, checked })), done: log.slice(-5) };
      if (ENGINE === "script") state.done_count = steps;
      const d = await decide({ state, criteria, persona, goal, rng });
      if (d.choice === "__END__") break;
      if (!(d.choice in criteria)) { stop = `engine returned an unknown key: ${d.choice}`; break; }
      log.push(criteria[d.choice]);
      if (d.choice === "RELOAD") before.stored = await storedData(page);
      try { await act(page, d.choice, before, persona, rng, log); } catch (e) { log.push(`(failed: ${String(e.message).split("\n")[0].slice(0, 80)})`); }
      await page.waitForTimeout(150);
      const after = await snapshot(page);
      if (d.choice === "RELOAD") after.stored = await storedData(page);
      for (const x of await check(page, before, after, d.choice, persona, errors)) {
        const k = `${x.type}:${x.detail.slice(0, 60)}`; if (seen.has(k)) continue; seen.add(k);
        const shot = join(OUT, `${persona.id}-${findings.length + 1}.png`);
        await page.screenshot({ path: shot }).catch(() => {});
        findings.push({ ...x, persona: persona.id, step: steps + 1, repro: log.slice(-6), screenshot: shot });
      }
    }
  } catch (e) { stop = String(e.message).slice(0, 200); }
  const finalShot = join(OUT, `${persona.id}-final.png`); await page.screenshot({ path: finalShot }).catch(() => {});
  await ctx.close();
  return { persona: persona.id, emoji: persona.emoji, name: persona.name, steps, ms: Math.round(performance.now() - t0), stop, findings, trace: log, finalShot };
}

// ---- main -----------------------------------------------------------------------------------------------
mkdirSync(OUT, { recursive: true });
let personas = parse(readFileSync(PERSONAS, "utf8")).personas;
if (ONLY) personas = personas.filter((p) => ONLY.split(",").includes(p.id));
const browser = await chromium.launch({ headless: !flag("headed") });
const T0 = performance.now();
const results = await Promise.all(personas.map((p, i) => runPersona(browser, p, i)));
await browser.close();
const wall = Math.round(performance.now() - T0);

const clusters = new Map();
for (const r of results) for (const f of r.findings) {
  const k = f.type === "console-error" || f.type === "bad-render" ? `${f.type}:${f.detail.slice(0, 40)}` : f.type;
  const c = clusters.get(k) || { type: f.type, severity: f.severity, detail: f.detail, personas: new Set(), example: f };
  c.personas.add(r.emoji || r.persona); clusters.set(k, c);
}
const sev = { high: 0, medium: 1, low: 2 };
const ranked = [...clusters.values()].sort((a, b) => b.personas.size - a.personas.size || sev[a.severity] - sev[b.severity]);
const summary = { engine: ENGINE, url: URL_, wall_ms: wall, personas: results.length,
  steps: results.reduce((s, r) => s + r.steps, 0), jev: usage, issues: ranked.length };
writeFileSync(join(OUT, "results.json"), JSON.stringify({ summary, results }, null, 2));
const md = [`# Persona test (fast, ${ENGINE})`, "",
  `${results.length} personas · ${summary.steps} steps · ${(wall / 1000).toFixed(1)} s wall · ${usage.calls} Jev calls · ${ranked.length} issues`, "",
  "| # | Issue | Personas | Severity | Detail |", "|---|---|---|---|---|",
  ...ranked.map((c, i) => `| ${i + 1} | ${c.type} | ${[...c.personas].join(" ")} | ${c.severity} | ${c.detail.replace(/\|/g, "\\|")} |`), "",
  "## Repro (first occurrence)", "",
  ...ranked.flatMap((c, i) => [`${i + 1}. **${c.type}** (${c.example.persona}, step ${c.example.step}): ${c.example.repro.join(" → ")}. Screenshot: \`${c.example.screenshot}\``]), "",
  "## Per persona", "", "| Persona | Steps | Time | Stopped early |", "|---|---|---|---|",
  ...results.map((r) => `| ${r.emoji || ""} ${r.name} | ${r.steps} | ${(r.ms / 1000).toFixed(1)} s | ${r.stop || "no"} |`)].join("\n");
writeFileSync(join(OUT, "report.md"), md + "\n");
console.log(md);
console.error(`\nwritten: ${OUT}`);
