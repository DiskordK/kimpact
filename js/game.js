/* Ушастый гоблин — терминал-рогалик. Прогресс живёт в localStorage. */
"use strict";

/* ── Константы ── */
const W = 12, H = 8, T = 52;          // поле 12×8, размер клетки
const MAX_LVL = 80;
const SAVE_KEY = "earl-goblin-save-v1";
const TICK_MS = 650;

/* ── Формулы прогрессии ── */
const xpNeed = (lvl) => Math.round(100 * Math.pow(1.5, lvl));   // 100, 150, 225…
const baseStats = (lvl) => ({ hpMax: 20 + 2 * lvl, atk: 3 + 0.5 * lvl, def: 2 + 0.5 * lvl });

/* Урон: от атаки отнимается её процент, равный защите получателя. Минимум — 1. */
const dmgOf = (atk, defPct) => Math.max(1, Math.round(atk * (1 - Math.min(defPct, 70) / 100)));

/* ── Предметы и рецепты ── */
const ITEMS = {
  water:  { name: "Капля воды",   glyph: "💧", kind: "elem", desc: "Элемент воды. Смешай с огнём." },
  fire:   { name: "Искра огня",   glyph: "🔥", kind: "elem", desc: "Элемент огня. Смешай с водой." },
  potion: { name: "Зелье лечения", glyph: "🧪", kind: "use", heal: 5,  desc: "Разовое: +5 HP. Кнопка «Выпить»." },
  elixir: { name: "Большое зелье", glyph: "⚗️", kind: "use", heal: 12, desc: "Разовое: +12 HP." },
  coal:   { name: "Тлеющий уголь", glyph: "🔶", kind: "artifact", bonus: { atk: 1 }, desc: "Артефакт: +1 к атаке." },
  ice:    { name: "Льдинка",      glyph: "🔷", kind: "artifact", bonus: { def: 1 }, desc: "Артефакт: +1 к защите." },
  ring:   { name: "Кольцо ярости", glyph: "💍", kind: "artifact", bonus: { atk: 2 }, desc: "Артефакт: +2 к атаке." },
  amulet: { name: "Амулет камня", glyph: "🧿", kind: "artifact", bonus: { def: 2 }, desc: "Артефакт: +2 к защите." },
  charm:  { name: "Оберег жизни", glyph: "🍀", kind: "artifact", bonus: { hp: 5 },  desc: "Артефакт: +5 к макс. HP." },
};
const RECIPES = {
  "fire+water": "potion",
  "fire+fire": "coal",
  "water+water": "ice",
  "potion+potion": "elixir",
};
const LOOT_POOL = [
  ["water", 4], ["fire", 4], ["potion", 1], ["ring", .7], ["amulet", .7], ["charm", .6],
];

/* ── Монстры ── */
const MOBS = [
  { key: "slime", name: "Слайм",          glyph: "🟢", tint: "#5df08a", kind: "обычный" },
  { key: "frost", name: "Морозный слайм", glyph: "❄️", tint: "#7dd7ff", kind: "морозный" },
  { key: "ember", name: "Огненный слайм", glyph: "🔥", tint: "#ff9a5d", kind: "огненный" },
  { key: "aqua",  name: "Водяной слайм",  glyph: "🌊", tint: "#5da9ff", kind: "водный" },
];
const MOB_BASE = { hp: 8, atk: 2, def: 1 };
/* прибавка к каждому стату при спавне: +1 × (уровень героя / 2) */
const mobBonus = (heroLvl) => Math.floor(heroLvl / 2);

const SLIME_ART = [
  "   ▄▄▄▄▄▄▄   ",
  "  ▟░░░░░░░░▙  ",
  " ▟ ░ ◕ ▐ ◕ ░ ▙ ",
  " ▙ ▄ ░ ▂ ░ ▄ ▟ ",
  "   ▀▀▀▀▀▀▀▀   ",
].join("\n");
const GOBLIN_ART = [
  "      ▟▄▙        ",
  " ▟▙▟█████▙▙▖     ",
  " ▟▟█ ◕ ▐▌▙▙▖     ",
  "  ▙▄  ▘  ▂▄▟    ",
  "    ▀▀▄█▄▀▀      ",
  "     ▗▟███▙▖     ",
  "     ▐ ▐▌ ▐▌▐    ",
].join("\n");
const NPC_ART = [
  "    ▟▀▀▙    ",
  "   ▟░♥░░▙   ",
  "   ▐ ░░ ▐   ",
  "    ▙▄▄▟    ",
  "   ▗▟▙▟▙▖   ",
].join("\n");

/* цена продажи: базовый элемент — 1¤, любой скрафченный продукт — 2¤ */
const itemPrice = (id) => (ITEMS[id] && ITEMS[id].kind === "elem") ? 1 : 2;

/* ── Генеративные звуки (WebAudio, без файлов) ── */
let audioCtx = null;
function sfx(kind) {
  if (typeof window === "undefined") return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const t0 = audioCtx.currentTime;
    const out = audioCtx.destination;
    const gain = audioCtx.createGain();
    gain.connect(out);
    const tone = (freq, dur, vol, type = "square", slide = 0, delay = 0) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t0 + delay);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + delay + dur);
      g.gain.setValueAtTime(vol, t0 + delay);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + delay + dur);
      o.connect(g); g.connect(out);
      o.start(t0 + delay); o.stop(t0 + delay + dur + 0.02);
    };
    switch (kind) {
      case "step":   tone(160, 0.07, 0.05, "triangle", -60); break;
      case "loot":   tone(520, 0.09, 0.07); tone(780, 0.1, 0.06, "square", 0, 0.08); break;
      case "craft":  tone(300, 0.1, 0.07); tone(450, 0.1, 0.07, "square", 0, 0.1); tone(600, 0.14, 0.07, "square", 0, 0.2); break;
      case "coin":   tone(880, 0.08, 0.08); tone(1320, 0.12, 0.07, "square", 0, 0.07); break;
      case "hit":    tone(110, 0.1, 0.1, "sawtooth", -50); break;
      case "heroHit":tone(90, 0.14, 0.12, "sawtooth", -40); break;
      case "win":    tone(392, 0.12, 0.08); tone(523, 0.12, 0.08, "square", 0, 0.12); tone(659, 0.2, 0.08, "square", 0, 0.24); break;
      case "lose":   tone(220, 0.25, 0.1, "sawtooth", -140); tone(110, 0.35, 0.1, "sawtooth", -60, 0.2); break;
      case "level":  tone(523, 0.1, 0.08); tone(659, 0.1, 0.08, "square", 0, 0.1); tone(784, 0.1, 0.08, "square", 0, 0.2); tone(1047, 0.22, 0.09, "square", 0, 0.3); break;
      case "floor":  tone(196, 0.3, 0.08, "triangle", 200); break;
      case "npc":    tone(440, 0.06, 0.05, "sine"); tone(560, 0.08, 0.05, "sine", 0, 0.07); break;
      case "block":  tone(70, 0.08, 0.08, "square", -20); break;
      default:       tone(300, 0.08, 0.05);
    }
  } catch (e) { /* звук не критичен */ }
}

/* ── Утилиты ── */
const $ = (id) => document.getElementById(id);
const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const hashStr = (s) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const pickWeighted = (rnd, pool) => {
  const total = pool.reduce((s, [, w]) => s + w, 0);
  let r = rnd() * total;
  for (const [id, w] of pool) { r -= w; if (r <= 0) return id; }
  return pool[0][0];
};

/* ── Состояние ── */
let S = null;          // сохраняемое состояние
let battle = null;     // активный бой {ci, timer}
let battleTimer = null;
let npcOpen = null;    // индекс клетки с открытым диалогом
let selected = null;   // {area:'inv'|'slot', i}
let logLines = [];
let rnd = Math.random;

function newHero() {
  return { lvl: 0, xp: 0, hp: baseStats(0).hpMax };
}
function effStats() {
  const b = baseStats(S.hero.lvl);
  let { hpMax, atk, def } = b;
  let bAtk = 0, bDef = 0, bHp = 0;
  for (const id of S.slots) {
    const it = id && ITEMS[id];
    if (it && it.bonus) { bAtk += it.bonus.atk || 0; bDef += it.bonus.def || 0; bHp += it.bonus.hp || 0; }
  }
  return { hpMax: hpMax + bHp, atk: atk + bAtk, def: def + bDef, bAtk, bDef, bHp };
}

/* ── Генерация карты ── */
function genMap() {
  const { floor } = S;
  const start = { x: 2 + Math.floor(rnd() * 8), y: 2 + Math.floor(rnd() * 4) };
  let cells;
  for (let attempt = 0; attempt < 40; attempt++) {
    cells = Array.from({ length: W * H }, (_, i) => {
      const x = i % W, y = (i / W) | 0;
      const obst = !(x === start.x && y === start.y) && rnd() < 0.16;
      return { t: obst ? "obst" : "free", mon: null, loot: null, npc: false, start: false };
    });
    // стартовая точка не окружена препятствиями: расчистим соседей
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = start.x + dx, ny = start.y + dy;
      if (nx >= 0 && nx < W && ny >= 0 && ny < H) cells[ny * W + nx].t = "free";
    }
    // связность: недостижимые свободные клетки становятся препятствиями
    const seen = new Set([start.y * W + start.x]);
    const q = [start.y * W + start.x];
    while (q.length) {
      const ci = q.pop(), x = ci % W, y = (ci / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const ni = ny * W + nx;
        if (!seen.has(ni) && cells[ni].t === "free") { seen.add(ni); q.push(ni); }
      }
    }
    for (const c of cells) if (c.t === "free" && !seen.has(cells.indexOf(c))) c.t = "obst";
    cells[start.y * W + start.x].start = true;

    const free = [];
    cells.forEach((c, i) => { if (c.t === "free" && !c.start) free.push(i); });
    const nMobs = Math.min(free.length - 1, 5 + Math.floor(rnd() * 3) + Math.min(2, Math.floor(floor / 3)));
    const nLoot = Math.min(free.length - nMobs, 3 + Math.floor(rnd() * 3));
    for (let k = 0; k < nMobs + nLoot; k++) {
      const i = free.splice(Math.floor(rnd() * free.length), 1)[0];
      if (i === undefined) break;
      if (k < nMobs) {
        const type = MOBS[Math.floor(rnd() * MOBS.length)];
        const b = mobBonus(S.hero.lvl);
        cells[i].mon = {
          t: MOBS.indexOf(type),
          hp: MOB_BASE.hp + b, hpMax: MOB_BASE.hp + b,
          atk: MOB_BASE.atk + b, def: MOB_BASE.def + b,
        };
      } else {
        cells[i].loot = pickWeighted(rnd, LOOT_POOL);
      }
    }
    // NPC — иногда, со второго этажа
    if (floor >= 2 && rnd() < 0.5 && free.length) {
      cells[free.splice(Math.floor(rnd() * free.length), 1)[0]].npc = true;
    }
    if (nMobs + nLoot >= 2) break; // нормальная карта получилась
  }
  S.pos = { ...start };
  S.map = cells;
  S.cleared = false;
}

/* ── Сохранение ── */
function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { /* приватный режим — играем без сохранения */ }
}
function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.hero && s.map) {
        if (typeof s.coins !== "number" || !isFinite(s.coins)) s.coins = 0; // сейвы до введения монет
        return s;
      }
    }
  } catch (e) { /* битый сейв — начинаем заново */ }
  return null;
}
function resetGame() {
  S = { hero: newHero(), inv: ["water", "fire", null, null, null, null], slots: [null, null, null], floor: 1, coins: 0 };
  genMap();
  save();
  logLines = [];
  log("Мир свёрнут заново. Этаж 1. Гоблин просыпается.", "good");
}

/* ── Журнал ── */
function log(msg, cls = "") {
  logLines.unshift({ msg, cls, t: new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) });
  logLines = logLines.slice(0, 60);
  renderLog();
}
function renderLog() {
  $("log").innerHTML = logLines.map(l => `<div class="l ${l.cls}"><span class="t">${l.t}</span>${l.msg}</div>`).join("");
}

/* ── Инвентарь / крафт ── */
function craftIds(a, b) {
  const key = [a, b].sort().join("+");
  return RECIPES[key] || null;
}
function craftTogether(i, j) {
  const a = S.inv[i], b = S.inv[j];
  if (!a || !b || a === b && i === j) return false;
  const res = craftIds(a, b);
  if (!res) { log(`Крафт невозможен: ${ITEMS[a].name} + ${ITEMS[b].name}.`, "dim"); return false; }
  S.inv[Math.max(i, j)] = res;
  S.inv[Math.min(i, j)] = null;
  compactInv();
  sfx("craft");
  log(`Крафт: ${ITEMS[a].name} + ${ITEMS[b].name} → ${ITEMS[res].name}!`, "good");
  renderAll(); save();
  return true;
}
function compactInv() {
  const items = S.inv.filter(Boolean);
  S.inv = Array.from({ length: 6 }, (_, i) => items[i] || null);
}
function addToInv(id) {
  const i = S.inv.indexOf(null);
  if (i === -1) return false;
  S.inv[i] = id;
  return true;
}
function usePotion(i) {
  const id = S.inv[i], it = ITEMS[id];
  if (!it || it.kind !== "use") return;
  const e = effStats();
  S.hero.hp = Math.min(e.hpMax, S.hero.hp + it.heal);
  S.inv[i] = null;
  log(`${it.name}: +${it.heal} HP.`, "good");
  renderAll(); save();
}
function equipToSlot(invI, slotI) {
  const id = S.inv[invI];
  if (!id || ITEMS[id].kind !== "artifact") return;
  const prev = S.slots[slotI];
  S.slots[slotI] = id;
  S.inv[invI] = prev;
  const e = effStats();
  S.hero.hp = Math.min(S.hero.hp, e.hpMax);
  log(`Надето: ${ITEMS[id].name}.`, "good");
  renderAll(); save();
}
function unequip(slotI, invI) {
  const id = S.slots[slotI];
  if (!id) return;
  if (invI === undefined) {
    const free = S.inv.indexOf(null);
    if (free === -1) { log("Инвентарь полон — не снять.", "warn"); return; }
    invI = free;
  }
  S.inv[invI] = id;
  S.slots[slotI] = null;
  const e = effStats();
  S.hero.hp = Math.min(S.hero.hp, e.hpMax);
  log(`Снято: ${ITEMS[id].name}.`, "dim");
  renderAll(); save();
}

/* ── Движение ── */
function cellAt(x, y) { return (x < 0 || x >= W || y < 0 || y >= H) ? null : S.map[y * W + x]; }
function passable(c) { return c && c.t === "free"; }

function tryMove(dx, dy) {
  if (battle) { log("Бой не отпускает — сначала добей слайма.", "warn"); return; }
  if (npcOpen !== null) { npcOpen = null; renderContact(); }
  const nx = S.pos.x + dx, ny = S.pos.y + dy;
  const c = cellAt(nx, ny);
  if (!c) { log("Край экрана. Пока рано: зачисти сектор.", "dim"); sfx("block"); return; }
  if (c.t === "obst") { log("Препятствие. Только обход.", "dim"); sfx("block"); return; }
  if (c.mon) { sfx("hit"); startBattle(ny * W + nx); return; }
  S.pos = { x: nx, y: ny };
  sfx("step");
  if (c.loot) {
    if (addToInv(c.loot)) {
      sfx("loot");
      log(`Подобрано: ${ITEMS[c.loot].name}.`, "good");
      c.loot = null;
    } else {
      log(`Инвентарь полон — ${ITEMS[c.loot].name} остался на клетке.`, "warn");
    }
  }
  if (!c.sparked) { // разовый бонус опыта с клетки
    c.sparked = true;
    gainXp(cellXp());
    log(`Собран бонус опыта с клетки: +${cellXp()}.`, "dim");
  }
  if (c.npc) { npcOpen = ny * W + nx; sfx("npc"); }
  renderAll(); save();
}

/* ── Бой ── */
function startBattle(ci) {
  const cell = S.map[ci];
  battle = { ci };
  npcOpen = null;
  log(`Автобой: ${MOBS[cell.mon.t].name} преграждает путь!`, "bad");
  renderContact();
  battleTimer = setInterval(tick, TICK_MS);
}
function tick() {
  if (!battle) return;
  const cell = S.map[battle.ci];
  const mob = cell.mon;
  if (!mob) { endBattle(); return; }
  const e = effStats();
  const hDmg = dmgOf(e.atk, mob.def);
  mob.hp -= hDmg;
  sfx("hit");
  log(`Ты бьёшь ${MOBS[mob.t].name} на ${hDmg}.`, "");
  if (mob.hp <= 0) { winBattle(); return; }
  const mDmg = dmgOf(mob.atk, e.def);
  S.hero.hp -= mDmg;
  sfx("heroHit");
  log(`${MOBS[mob.t].name} бьёт тебя на ${mDmg}.`, "dim");
  if (S.hero.hp <= 0) { loseBattle(); return; }
  renderAll();
}
function winBattle() {
  const cell = S.map[battle.ci];
  const mob = cell.mon;
  cell.mon = null;
  S.pos = { x: battle.ci % W, y: (battle.ci / W) | 0 };
  endBattle();
  sfx("win");
  const xp = 25 + S.hero.lvl * 5 + S.floor * 3;
  gainXp(xp);
  checkCleared();
  log(`${MOBS[mob.t].name} побеждён! +${xp} опыта, клетка твоя.`, "good");
  renderAll(); save();
}
function loseBattle() {
  const mob = S.map[battle.ci].mon;
  endBattle();
  sfx("lose");
  const need = xpNeed(S.hero.lvl);
  const penalty = Math.round(need * 0.3);
  S.hero.xp = Math.max(0, S.hero.xp - penalty);
  S.hero.hp = effStats().hpMax;
  S.pos = { ...S.pos };
  const startI = S.map.findIndex(c => c.start);
  S.pos = { x: startI % W, y: (startI / W) | 0 };
  log(`${MOBS[mob.t].name} вышибает дух. Возрождение в начале, −${penalty} опыта.`, "bad");
  renderAll(); save();
}
function endBattle() {
  battle = null;
  if (battleTimer) { clearInterval(battleTimer); battleTimer = null; }
  renderContact();
}

/* ── Опыт и уровни ── */
/* бонус опыта с клетки: 0.5 + уровень×0.5, разово на клетку до смены экрана */
const cellXp = () => 0.5 + S.hero.lvl * 0.5;
function gainXp(n) {
  if (S.hero.lvl >= MAX_LVL) return;
  S.hero.xp += n;
  let need = xpNeed(S.hero.lvl);
  while (S.hero.lvl < MAX_LVL && S.hero.xp >= need) {
    S.hero.xp -= need;
    S.hero.lvl++;
    S.hero.hp = effStats().hpMax;
    sfx("level");
    log(`Уровень ${S.hero.lvl}! ХП+2, атака+0.5, защита+0.5.`, "good");
    need = xpNeed(S.hero.lvl);
  }
}

/* ── Зачистка и переход ── */
function checkCleared() {
  if (S.cleared) return true;
  const mobsLeft = S.map.filter(c => c.mon).length;
  if (mobsLeft === 0) {
    S.cleared = true;
    log("Сектор зачищен! Уйди за край экрана — [ ENTER ].", "warn");
  }
  return S.cleared;
}
function nextFloor() {
  if (!S.cleared) { log("Сначала зачисти сектор.", "dim"); return; }
  S.floor++;
  genMap();
  S.hero.hp = effStats().hpMax;
  sfx("floor");
  log(`Этаж ${S.floor}. Поле сверстано заново, герой отдохнул.`, "good");
  renderAll(); save();
}

/* ── NPC ── */
const NPC = {
  name: "Странник Хрупт",
  got: false,
  lines: [
    "Дальше — терминальная гуща. Слаймы плодятся от твоего уровня.",
    "Вода плюс огонь — старое зелье. Остальное пробуй перетаскиванием.",
    "Мертвец теряет треть опыта уровня. Не умирай, гоблин.",
  ],
  lineIdx: 0,
};
function npcOption(key) {
  const cell = S.map[npcOpen];
  if (!cell || !cell.npc) return;
  if (key === "talk") {
    log(`Хрупт: «${NPC.lines[NPC.lineIdx % NPC.lines.length]}»`, "dim");
    NPC.lineIdx++;
  } else if (key === "gift") {
    if (NPC.got) { log("Хрупт: «Я уже всё отдал, пустые карманы.»", "dim"); }
    else {
      const id = Math.random() < 0.5 ? "water" : "fire";
      if (addToInv(id)) { NPC.got = true; log(`Хрупт даёт: ${ITEMS[id].name}.`, "good"); }
      else log("Инвентарь полон — Хрупт пожимает плечами.", "warn");
    }
  } else if (key === "give") {
    const pi = S.inv.findIndex(id => id && (ITEMS[id].kind === "use" || ITEMS[id].kind === "elem"));
    if (pi === -1) { log("Хрупт: «Нечего дать? Тогда просто поговорим.»", "dim"); }
    else {
      const id = S.inv[pi];
      S.inv[pi] = null;
      gainXp(30);
      log(`Хрупт берёт ${ITEMS[id].name} и рассказывает истории. +30 опыта.`, "good");
    }
  } else if (key === "sell") {
    // продажа любого лишнего предмета: элемент — 1¤, продукт крафта — 2¤
    const pi = S.inv.findIndex(id => id);
    if (pi === -1) { log("Хрупт: «Продавать нечего.»", "dim"); }
    else {
      const id = S.inv[pi];
      S.inv[pi] = null;
      const price = itemPrice(id);
      S.coins = (S.coins || 0) + price;
      sfx("coin");
      log(`Хрупт купил ${ITEMS[id].name} за ${price}¤.`, "good");
    }
  } else if (key === "bye") {
    npcOpen = null;
  }
  renderContact(); renderAll(); save();
}

/* ── Рендер ── */
function renderAll() {
  renderHero(); renderBoard(); renderContact(); renderHud();
}
function renderHero() {
  const e = effStats();
  $("coinNum").textContent = String(S.coins || 0);
  $("lvlNum").textContent = S.hero.lvl;
  const need = S.hero.lvl >= MAX_LVL ? 0 : xpNeed(S.hero.lvl);
  const pct = need ? Math.min(100, (S.hero.xp / need) * 100) : 100;
  $("xpFill").style.width = pct + "%";
  $("xpNum").textContent = need ? `${Math.floor(S.hero.xp)} / ${need}` : "МАКС";
  $("stHp").innerHTML = `${S.hero.hp}/${e.hpMax}${e.bHp ? ` <span class="bonus">(+${e.bHp})</span>` : ""}`;
  $("stHp").style.color = S.hero.hp <= e.hpMax * 0.3 ? "var(--danger)" : "";
  $("stAtk").innerHTML = `${e.atk}${e.bAtk ? ` <span class="bonus">(+${e.bAtk})</span>` : ""}`;
  $("stDef").innerHTML = `${e.def}${e.bDef ? ` <span class="bonus">(+${e.bDef})</span>` : ""}`;

  $("slotRow").innerHTML = S.slots.map((id, i) => {
    const it = id && ITEMS[id];
    return `<div class="cellbox ${it ? "" : "empty"} ${selected && selected.area === "slot" && selected.i === i ? "selected" : ""}"
      data-area="slot" data-i="${i}" role="button" tabindex="0" aria-label="Слот ${i + 1}">
      <span class="glyph">${it ? it.glyph : "◇"}</span></div>`;
  }).join("");
  $("invGrid").innerHTML = S.inv.map((id, i) => {
    const it = id && ITEMS[id];
    return `<div class="cellbox ${it ? "" : "empty"} ${selected && selected.area === "inv" && selected.i === i ? "selected" : ""}"
      data-area="inv" data-i="${i}" role="button" tabindex="0" draggable="${it ? "true" : "false"}" aria-label="Инвентарь ${i + 1}">
      <span class="glyph">${it ? it.glyph : "·"}</span></div>`;
  }).join("");
  renderInfo();
  bindCellEvents();
}
function renderInfo() {
  const box = $("itemInfo");
  const at = selected ? (selected.area === "inv" ? S.inv[selected.i] : S.slots[selected.i]) : null;
  const it = at && ITEMS[at];
  if (!it) { box.innerHTML = "— выбери предмет —"; return; }
  let actions = "";
  if (selected.area === "inv") {
    if (it.kind === "use") actions += `<button class="btn" data-act="use">[ выпить ]</button>`;
    if (it.kind === "artifact") actions += `<button class="btn" data-act="equip">[ надеть ]</button>`;
  } else {
    actions += `<button class="btn" data-act="unequip">[ снять ]</button>`;
  }
  box.innerHTML = `<b>${it.glyph} ${it.name}</b><br>${it.desc}${actions ? `<div class="ii-actions">${actions}</div>` : ""}`;
  box.querySelectorAll("[data-act]").forEach(b => b.addEventListener("click", () => {
    const i = selected.i;
    if (b.dataset.act === "use") usePotion(i);
    if (b.dataset.act === "equip") equipToSlot(i, S.slots.findIndex(s => !s) !== -1 ? S.slots.findIndex(s => !s) : 0);
    if (b.dataset.act === "unequip") unequip(i);
  }));
}

/* ASCII-спрайты поля: персонаж, монстры, нпс, лут, препятствия */
const FIELD_GLYPHS = {
  hero: "٩(◕)۶",
  mob: "◣_◢",
  npc: "ʕ·ᴥ·ʔ",
  obst: "▚▞",
  loot: { water: "≈≈≈", fire: "⌇⌇⌇", potion: " Ψ ", elixir: " Ψ ", coal: "◈◈◈", ice: "◇◇◇", ring: "⊙⊙⊙", amulet: "ΘΘΘ", charm: "♣♣♣" },
  spark: " + ",
};
function fieldSprite(kind, id) {
  if (kind === "hero") return `<span class="spr hero">${FIELD_GLYPHS.hero}</span>`;
  if (kind === "mob") return `<span class="spr mob" style="color:${MOBS[id].tint}">${FIELD_GLYPHS.mob}</span>`;
  if (kind === "npc") return `<span class="spr npc">${FIELD_GLYPHS.npc}</span>`;
  if (kind === "obst") return `<span class="spr obs">${FIELD_GLYPHS.obst}</span>`;
  if (kind === "spark") return `<span class="spr loot-x">${FIELD_GLYPHS.spark}</span>`;
  const id2 = id;
  const cls = id2 === "water" ? "loot-w" : id2 === "fire" ? "loot-f" : ITEMS[id2].kind === "artifact" ? "art" : "loot-x";
  return `<span class="spr ${cls}">${FIELD_GLYPHS.loot[id2]}</span>`;
}

function renderBoard() {
  const board = $("board");
  board.innerHTML = "";
  const heroI = S.pos.y * W + S.pos.x;
  const adj = new Set();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const c = cellAt(S.pos.x + dx, S.pos.y + dy);
    if (c && c.t === "free") adj.add(S.map.indexOf(c));
  }
  S.map.forEach((c, i) => {
    const el = document.createElement("div");
    const x = i % W, y = (i / W) | 0;
    el.className = "tile" + (c.t === "obst" ? " obstacle" : "") + (i === heroI ? " hero-tile" : "") + (adj.has(i) && !battle ? " step" : "");
    el.style.left = x * T + "px"; el.style.top = y * T + "px";
    el.dataset.i = i;
    if (i === heroI) {
      el.innerHTML = fieldSprite("hero");
    } else if (c.mon) {
      const m = MOBS[c.mon.t];
      el.innerHTML = fieldSprite("mob", c.mon.t);
    } else if (c.loot) {
      el.innerHTML = fieldSprite("loot", c.loot);
      if (!c.sparked) { el.innerHTML += fieldSprite("spark"); } // одноразовый опыт ждёт на клетке
    } else if (c.npc) {
      el.innerHTML = fieldSprite("npc");
    } else if (c.t === "obst") {
      el.innerHTML = fieldSprite("obst");
    }
    if (adj.has(i) && !battle) el.addEventListener("click", () => {
      const tx = i % W, ty = (i / W) | 0;
      tryMove(tx - S.pos.x, ty - S.pos.y);
    });
    board.appendChild(el);
  });
  fitBoard();
}
function fitBoard() {
  const wrap = $("boardWrap");
  // габариты поля после rotateZ(45) и rotateX(48°)
  const pw = (W + H) * T * 0.707;
  const ph = pw * Math.cos(48 * Math.PI / 180);
  const s = Math.min(1, (wrap.clientWidth - 16) / pw, (wrap.clientHeight - 16) / ph);
  $("board").style.setProperty("--s", s.toFixed(3));
}

function renderHud() {
  $("hudFloor").textContent = String(S.floor).padStart(2, "0");
  $("hudMobs").textContent = S.map.filter(c => c.mon).length;
  $("hudClear").classList.toggle("hidden", !S.cleared);
  const btn = $("btnEnter");
  btn.classList.toggle("hidden", !S.cleared);
  btn.disabled = !S.cleared;
}

function renderContact() {
  const box = $("contact");
  if (battle) {
    const cell = S.map[battle.ci];
    const mob = cell.mon, m = MOBS[mob.t];
    box.innerHTML = `
      <div class="card-tag">// контакт · автобой</div>
      <div class="mob-head">
        <pre class="mob-art" style="--mob:${m.tint}">${SLIME_ART}</pre>
        <div><div class="mob-name">${m.glyph} ${m.name}</div>
        <div class="mob-kind">слайм · ${m.kind}</div></div>
      </div>
      <div class="mstatgrid">
        <div class="stat"><dt>ХП</dt><dd>${Math.max(0, mob.hp)}/${mob.hpMax}</dd></div>
        <div class="stat"><dt>Атака</dt><dd>${mob.atk}</dd></div>
        <div class="stat"><dt>Защита</dt><dd>${mob.def}</dd></div>
      </div>
      <span class="hp-num">твой удар каждые ${TICK_MS / 1000} с — бой автоматический</span>
      <div class="vs-row">— VS —</div>
      <div class="statgrid">
        <div class="stat"><dt>Герой</dt><dd>${S.hero.hp}/${effStats().hpMax}</dd></div>
      </div>
      <div class="hp-bar"><div class="hp-fill hero" style="width:${Math.max(0, S.hero.hp / effStats().hpMax * 100)}%"></div></div>`;
    return;
  }
  if (npcOpen !== null && S.map[npcOpen] && S.map[npcOpen].npc) {
    box.innerHTML = `
      <div class="card-tag">// контакт · нпс</div>
      <div class="mob-head">
        <pre class="mob-art" style="--mob:var(--warn)">${NPC_ART}</pre>
        <div><div class="mob-name">🧙 ${NPC.name}</div>
        <div class="mob-kind">мирный · болтает</div></div>
      </div>
      <div class="dlg-options">
        <button class="btn" data-opt="talk">«Расскажи, что тут вообще…»</button>
        <button class="btn" data-opt="gift">«Дай что-нибудь»</button>
        <button class="btn" data-opt="sell">«Продать предмет» <span style="color:var(--warn)">1¤ элемент · 2¤ крафт</span></button>
        <button class="btn" data-opt="give">«Возьми мой предмет»</button>
        <button class="btn ghost" data-opt="bye">[ уйти ]</button>
      </div>
      <div class="dlg-line">Хрупт кивает из-под капюшона.</div>`;
    box.querySelectorAll("[data-opt]").forEach(b => b.addEventListener("click", () => npcOption(b.dataset.opt)));
    return;
  }
  box.innerHTML = `<div class="empty-state"><span class="big"> ▁▁▂▃▄ </span>
    Связи не установлены.<br>Шагни на клетку с монстром или НПС — контакт появится здесь.</div>`;
}

/* ── События инвентаря ── */
let dragFrom = null;
function bindCellEvents() {
  document.querySelectorAll("#invGrid .cellbox, #slotRow .cellbox").forEach(el => {
    const area = el.dataset.area, i = +el.dataset.i;
    el.addEventListener("click", () => {
      const has = area === "inv" ? S.inv[i] : S.slots[i];
      if (selected && (selected.area !== area || selected.i !== i)) {
        const srcHas = selected.area === "inv" ? S.inv[selected.i] : S.slots[selected.i];
        if (has && srcHas) {
          // второй клик: крафт (инвентарь↔инвентарь) или перенос
          if (selected.area === "inv" && area === "inv") {
            if (!craftTogether(selected.i, i)) { selected = { area, i }; }
          } else if (selected.area === "inv" && area === "slot") {
            equipToSlot(selected.i, i); selected = null;
          } else if (selected.area === "slot" && area === "inv") {
            unequip(selected.i, i); selected = null;
          } else {
            selected = { area, i };
          }
        } else {
          selected = { area, i };
        }
      } else {
        selected = { area, i };
      }
      renderHero();
    });
    el.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); el.click(); } });
    el.addEventListener("dragstart", (ev) => { dragFrom = { area, i }; ev.dataTransfer.setData("text/plain", String(i)); });
    el.addEventListener("dragover", (ev) => { ev.preventDefault(); el.classList.add("over"); });
    el.addEventListener("dragleave", () => el.classList.remove("over"));
    el.addEventListener("drop", (ev) => {
      ev.preventDefault(); el.classList.remove("over");
      if (!dragFrom) return;
      const from = dragFrom; dragFrom = null;
      if (from.area === "inv" && area === "inv") {
        if (!craftTogether(from.i, i)) {
          const tmp = S.inv[i]; S.inv[i] = S.inv[from.i]; S.inv[from.i] = tmp; // просто переставить
          renderAll(); save();
        }
      } else if (from.area === "inv" && area === "slot") {
        equipToSlot(from.i, i);
      } else if (from.area === "slot" && area === "inv") {
        unequip(from.i, i);
      } else if (from.area === "slot" && area === "slot") {
        const tmp = S.slots[i]; S.slots[i] = S.slots[from.i]; S.slots[from.i] = tmp;
        renderAll(); save();
      }
    });
  });
}

/* ── Ввод ── */
const KEYMAP = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0],
};
document.addEventListener("keydown", (ev) => {
  if (ev.repeat && !KEYMAP[ev.code]) return;
  if (KEYMAP[ev.code]) { ev.preventDefault(); tryMove(...KEYMAP[ev.code]); return; }
  if (ev.code === "Enter" && S.cleared) { ev.preventDefault(); nextFloor(); }
});
$("btnEnter").addEventListener("click", nextFloor);
$("btnReset").addEventListener("click", () => {
  resetGame();
  selected = null; npcOpen = null; renderAll();
});
window.addEventListener("resize", fitBoard);

/* ── Старт ── */
function init() {
  $("goblinArt").textContent = GOBLIN_ART;
  S = load();
  if (S) {
    log("Сохранение поднято из localStorage. Мир на месте.", "good");
  } else {
    resetGame();
  }
  // тестовый расклад для проверок: монстр и лут по соседству
  const seed = new URLSearchParams(location.search).get("seed");
  if (seed !== null) {
    rnd = mulberry32(hashStr(seed));
    resetGame();
    S.map = S.map.map(c => ({ ...c, mon: null, loot: null, npc: false }));
    const si = S.pos.y * W + S.pos.x;
    S.map[si + 1].mon = { t: 0, hp: 8, hpMax: 8, atk: 2, def: 1 };
    S.map[si - 1].loot = "water";
    S.map[si + W].npc = true;
    save();
    rnd = Math.random;
  }
  renderAll();
}
init();
