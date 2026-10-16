// 单局状态与规则（不依赖渲染，便于单测和平衡模拟）。
import { PLAYER, WEAPON, COMBO, FOCUS, SHOP, WAVES, KEEPSAKES } from './config.js';
import { UPGRADES, BASE_MAX_LEVEL } from './upgrades.js';
import { upgradeLevel, unlockedUpgrades, keepsakeLevel } from './meta.js';

export function createRun(save) {
  const maxHp = PLAYER.maxHp + 10 * upgradeLevel(save, 'vitality');
  const keepsake = save.keepsake && keepsakeLevel(save, save.keepsake) > 0 ? save.keepsake : null;
  const run = {
    hp: maxHp,
    maxHp,
    shield: upgradeLevel(save, 'shield') > 0 ? 1 : 0,
    gold: 15 * upgradeLevel(save, 'stake'),
    combo: 0,
    maxCombo: 0,
    focus: 0,
    focusTime: 0,
    focusTotal: 0,   // 本次子弹时间的总时长（HUD 用）
    debtTime: 0,     // 时间债：敌人加速的剩余时间
    bt: null,        // 本次子弹时间的统计：{ kills, ext, bankExt }
    ammo: 0,
    reloadLeft: 0,
    reloadTotal: 0,
    heat: 0,         // 过热枪管
    idle: 0,         // 停火时长（过热衰减、静心）
    hitStreak: 0,    // 连续命中次数（弹链）
    track: { botId: null, count: 0, time: 0, lastHit: -9 }, // 连续命中同一目标（撕裂、跟枪护盾）
    trackShieldUsed: false,
    execChain: { botId: null, at: -9, bonus: 0 },
    ups: {},         // 强化 id -> 等级
    keepsake,
    keepsakeLv: keepsake ? keepsakeLevel(save, keepsake) : 0,
    unlocked: unlockedUpgrades(save),
    extraChoice: upgradeLevel(save, 'extraChoice') > 0,
    waveIndex: 0,
    wavesSinceCore: 0,
    rewardsTaken: 0,
    healBuys: 0,
    stardustBuys: 0,
    shopCount: 0,
    stardustFromShop: 0,
    safetyUsed: false,
    chainStacks: 0,
    stats: { shots: 0, hits: 0, headshots: 0, kills: 0, goldEarned: 0, damageTaken: 0, misses: 0, comboBreaks: 0, reloads: 0, moverHits: 0, moverMisses: 0 },
    shopVisits: [],
    waveLog: [], // 每波的血量、命中、金币变化，用于平衡分析
  };
  run.ammo = magSize(run);
  return run;
}

export const lv = (run, id) => run.ups[id] || 0;
export const has = (run, id) => lv(run, id) > 0;
export const keepsakeIs = (run, id, minLv = 1) => run.keepsake === id && run.keepsakeLv >= minLv;
export const inBulletTime = (run) => run.focusTime > 0;

export function multiplier(run) {
  return Math.min(COMBO.maxMult, 1 + Math.floor(run.combo) * COMBO.multPerCombo);
}

// ---------------- 武器 ----------------

export function fireInterval(run, base) {
  let rate = (1 + 0.08 * run.chainStacks) * (1 + 0.05 * lv(run, 'trigger'));
  if (has(run, 'rapid')) rate *= 1.1;
  if (inBulletTime(run) && has(run, 'overclock')) rate *= 1.2;
  return base / rate;
}

export function magSize(run) {
  let m = has(run, 'drum') ? 24 : WEAPON.magSize;
  m += 2 * lv(run, 'mag');
  if (keepsakeIs(run, 'drum')) m += 3;
  return m;
}

export function baseReloadTime(run) {
  return (has(run, 'drum') ? 3.2 : WEAPON.reloadTime) * (1 - 0.08 * lv(run, 'quick'));
}

export const reloading = (run) => run.reloadLeft > 0;

export function refundAmmo(run, n) {
  if (!reloading(run)) run.ammo = Math.min(magSize(run), run.ammo + n);
}

// manual：玩家按 R（战术换弹只对手动换弹生效）
// 返回 'instant' | 'started' | false
export function startReload(run, manual = false) {
  if (reloading(run) || run.ammo >= magSize(run)) return false;
  run.stats.reloads++;
  const instant =
    (inBulletTime(run) && has(run, 'timeslit')) ||
    (manual && has(run, 'tacreload') && run.ammo >= magSize(run) * 0.5) ||
    (has(run, 'coolant') && run.heat >= 20);
  if (has(run, 'coolant') && run.heat >= 20) run.heat = 0;
  if (instant) {
    run.ammo = magSize(run);
    return 'instant';
  }
  let t = baseReloadTime(run);
  if (run.ammo <= 0 && has(run, 'tacreload')) t *= 2;
  run.reloadLeft = t;
  run.reloadTotal = t;
  return 'started';
}

// 返回 true 表示本帧换弹完成
export function tickReload(run, dt) {
  if (!reloading(run)) return false;
  if (inBulletTime(run) && has(run, 'timeslit')) run.reloadLeft = 0;
  else run.reloadLeft = Math.max(0, run.reloadLeft - dt);
  if (run.reloadLeft > 0) return false;
  run.ammo = magSize(run);
  return true;
}

// 过热：停火衰减
export function tickHeat(run, dt, firedThisFrame) {
  if (firedThisFrame) { run.idle = 0; return; }
  run.idle += dt;
  if (!has(run, 'overheat') || run.heat <= 0) return;
  if (has(run, 'heatsink')) return;
  if (run.idle >= 1) run.heat = Math.max(0, run.heat - 4 * dt);
}

// ---------------- 专注 / 子弹时间 ----------------

export function focusMax(run) {
  return FOCUS.max * (has(run, 'fragment') ? 0.5 : 1);
}

export function focusDuration(run) {
  const bonus = has(run, 'focuslens') ? 0.5 : 0;
  let d = has(run, 'stasis') ? 1.2 + bonus * 0.5 : FOCUS.duration + bonus;
  if (has(run, 'fragment')) d *= 0.5;
  return d;
}

// 子弹时间中的世界流速（时停 = 完全静止）
export function bulletTimeScale(run) {
  return has(run, 'stasis') ? 0 : FOCUS.timeScale;
}

function addFocus(run, amount) {
  if (inBulletTime(run)) return;
  let gain = amount * (has(run, 'focuslens') ? 1.3 : 1) * (1 + 0.15 * lv(run, 'flow'));
  run.focus = Math.min(focusMax(run), run.focus + gain);
}

export function canActivateFocus(run) {
  if (inBulletTime(run) || run.debtTime > 0) return false;
  const need = has(run, 'timedebt') ? focusMax(run) * 0.25 : focusMax(run);
  return run.focus >= need - 1e-6;
}

export function activateFocus(run) {
  if (!canActivateFocus(run)) return false;
  const frac = has(run, 'timedebt') ? run.focus / focusMax(run) : 1;
  run.focus = 0;
  run.focusTime = focusDuration(run) * frac;
  run.focusTotal = run.focusTime;
  run.bt = { kills: 0, ext: 0, bankExt: 0, hitBots: new Set() };
  return true;
}

// 子弹时间延长（余韵、时间余量），按时停减半
function extendBulletTime(run, sec) {
  const k = has(run, 'stasis') ? 0.5 : 1;
  run.focusTime += sec * k;
  run.focusTotal += sec * k;
}

// 子弹时间结束时调用，返回需要的后续处理
export function endBulletTime(run) {
  const bt = run.bt || { kills: 0, hitBots: new Set() };
  if (has(run, 'echo') && bt.kills >= 4) run.focus = Math.min(focusMax(run), focusMax(run) * 0.25);
  if (has(run, 'timedebt')) run.debtTime = run.focusTotal;
  run.bt = null;
  return bt;
}

// ---------------- 命中 / 打空 ----------------

function gainCombo(run, n) {
  run.combo += has(run, 'gambler') ? n * 0.5 : n;
  run.maxCombo = Math.max(run.maxCombo, Math.floor(run.combo));
}

export function addCombo(run, n) {
  gainCombo(run, n);
}

// extra：穿透等额外命中，不计入命中统计（否则命中率会超过 100%）
export function registerHit(run, headshot, { extra = false, bonusCombo = 0 } = {}) {
  if (!extra) {
    run.stats.hits++;
    if (headshot) run.stats.headshots++;
  }
  let gain = COMBO.perHit + bonusCombo;
  if (headshot) {
    gain += COMBO.perHeadshotBonus + (has(run, 'hawkeye') ? 1 : 0) + (keepsakeIs(run, 'hunter') ? 1 : 0);
    if (has(run, 'chainhead')) run.chainStacks = Math.min(4, run.chainStacks + 1);
  } else {
    run.chainStacks = 0;
  }
  gainCombo(run, gain);
  addFocus(run, headshot ? FOCUS.perHeadshot : FOCUS.perHit);
  if (extra) return;
  run.hitStreak++;
  if (has(run, 'beltfeed') && run.hitStreak % 6 === 0) refundAmmo(run, 1);
  if (has(run, 'overheat')) run.heat = Math.min(20, run.heat + 1);
}

// 返回 'safety' | 'halved' | 'broken' | 'none'
export function registerMiss(run) {
  run.stats.misses++;
  run.chainStacks = 0;
  run.hitStreak = 0;
  run.track.count = 0;
  run.track.botId = null;
  if (has(run, 'overheat')) run.heat = Math.max(0, run.heat - 5);
  if (run.combo < 1) return 'none';
  if (has(run, 'safety') && !run.safetyUsed) {
    run.safetyUsed = true;
    return 'safety';
  }
  if (has(run, 'gambler')) {
    run.combo = Math.floor(run.combo / 2);
    return 'halved';
  }
  run.combo = 0;
  run.stats.comboBreaks++;
  return 'broken';
}

// 子弹时间里的击杀结算（余韵、定格），返回额外连杀
export function onKillInBulletTime(run) {
  if (!inBulletTime(run) || !run.bt) return;
  run.bt.kills++;
  if (has(run, 'afterglow') && run.bt.ext < 2) {
    const add = Math.min(0.25, 2 - run.bt.ext);
    run.bt.ext += add;
    extendBulletTime(run, add);
  }
  if (has(run, 'freezeframe')) gainCombo(run, 3);
}

export function onHeadshotInBulletTime(run) {
  if (!inBulletTime(run) || !run.bt || !has(run, 'timebank') || run.bt.bankExt >= 1.5) return;
  const add = Math.min(0.15, 1.5 - run.bt.bankExt);
  run.bt.bankExt += add;
  extendBulletTime(run, add);
}

export function killGold(run, base, extraMul = 1) {
  const mult = multiplier(run);
  const goldMult = 1 + (mult - 1) * COMBO.goldMultScale;
  let g = base * goldMult * extraMul * (1 + 0.08 * lv(run, 'fortune'));
  if (has(run, 'greedsight') && mult >= 3) g *= 1.5;
  if (has(run, 'bloodpact')) g *= 1.4;
  const gold = Math.max(1, Math.round(g));
  run.gold += gold;
  run.stats.goldEarned += gold;
  run.stats.kills++;
  return gold;
}

// 返回 { absorbed: bool, dead: bool }
export function takeDamage(run, dmg) {
  if (run.shield > 0) {
    run.shield--;
    return { absorbed: true, dead: false };
  }
  run.hp = Math.max(0, run.hp - dmg);
  run.stats.damageTaken += dmg;
  return { absorbed: false, dead: run.hp <= 0 };
}

// ---------------- 波次 ----------------

function snapshot(run) {
  const s = run.stats;
  return { hp: run.hp, shield: run.shield, shots: s.shots, hits: s.hits, gold: s.goldEarned, dmg: s.damageTaken, mh: s.moverHits, mm: s.moverMisses };
}

export function logWaveEnd(run, cleared) {
  const w = run.waveLog[run.waveLog.length - 1];
  if (!w || w.end) return;
  w.end = snapshot(run);
  w.cleared = cleared;
}

export function startWave(run) {
  run.waveLog.push({ wave: run.waveIndex + 1, start: snapshot(run) });
  run.safetyUsed = false;
  run.trackShieldUsed = false;
  run.ammo = magSize(run);
  run.reloadLeft = 0;
  run.focusTime = 0;
  run.debtTime = 0;
  run.bt = null;
  run.heat = 0;
  // 护盾强化：每波开始把护盾补到等级数（不会跨波无限累积）
  if (has(run, 'guard')) run.shield = Math.max(run.shield, lv(run, 'guard'));
  if (keepsakeIs(run, 'watch')) run.focus = Math.min(focusMax(run), run.focus + focusMax(run) * 0.3);
}

// 清完一波
export function finishWave(run) {
  run.waveIndex++;
  run.wavesSinceCore++;
  run.focusTime = 0;
  run.debtTime = 0;
  run.bt = null;
  if (has(run, 'bandage')) run.hp = Math.min(run.maxHp, run.hp + 5 * lv(run, 'bandage'));
}

export function enemySpeedMul(run) {
  return has(run, 'bloodpact') ? 1.2 : 1;
}

// ---------------- 强化池与三选一 ----------------

function available(run, id) {
  const u = UPGRADES[id];
  if (u.locked && !run.unlocked.includes(id)) return false;
  if (u.requires && !has(run, u.requires)) return false;
  if (u.cat === 'base') return lv(run, id) < BASE_MAX_LEVEL;
  return !has(run, id);
}

function poolOf(run, filter) {
  return Object.keys(UPGRADES).filter((id) => available(run, id) && filter(UPGRADES[id]));
}

const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];

function schoolWeights(run) {
  const owned = { head: 0, spray: 0, time: 0 };
  for (const id of Object.keys(run.ups)) {
    const s = UPGRADES[id].school;
    if (s) owned[s]++;
  }
  const w = {};
  for (const s of Object.keys(owned)) w[s] = Math.min(3, 1 + 0.4 * owned[s]);
  return w;
}

function rollSchool(weights) {
  const entries = Object.entries(weights);
  let r = Math.random() * entries.reduce((a, [, x]) => a + x, 0);
  for (const [s, x] of entries) { r -= x; if (r <= 0) return s; }
  return entries[0][0];
}

export function coreChance(run) {
  if (run.waveIndex < 3) return 0;
  return Math.min(0.25, 0.04 + 0.03 * run.wavesSinceCore);
}

// 抽一个选项。kind：'core' | 'school' | 'base' | 'general'
function rollKind(run, kind, exclude, school = null) {
  const not = (id) => !exclude.includes(id);
  if (kind === 'core') {
    return pickOne(poolOf(run, (u) => u.cat === 'core' && (!school || u.school === school)).filter(not));
  }
  if (kind === 'school') {
    const weights = school ? { [school]: 1 } : schoolWeights(run);
    // 选中的流派没有可用强化时换一个流派
    for (let tries = 0; tries < 4; tries++) {
      const s = rollSchool(weights);
      const id = pickOne(poolOf(run, (u) => u.cat === 'school' && u.school === s).filter(not));
      if (id) return id;
      delete weights[s];
      if (!Object.keys(weights).length) break;
    }
    return null;
  }
  if (kind === 'base') return pickOne(poolOf(run, (u) => u.cat === 'base').filter(not));
  return pickOne(poolOf(run, (u) => u.cat === 'general').filter(not));
}

function rollSlot(run, exclude, { allowCore = true } = {}) {
  if (allowCore && Math.random() < coreChance(run)) {
    const id = rollKind(run, 'core', exclude);
    if (id) return id;
  }
  const r = Math.random();
  const kind = r < 0.65 ? 'school' : r < 0.9 ? 'base' : 'general';
  return rollKind(run, kind, exclude) || rollKind(run, 'base', exclude) || rollKind(run, 'general', exclude) || rollKind(run, 'school', exclude);
}

// 三选一。opts.school：只出某流派（遗物 3 级的开局三选一）
export function rollRewardChoices(run, n = 3, opts = {}) {
  const out = [];
  if (opts.school) {
    while (out.length < n) {
      const id = rollKind(run, 'school', out, opts.school);
      if (!id) break;
      out.push(id);
    }
    return out;
  }
  // 三棱镜：三个选项来自三个不同类别
  if (keepsakeIs(run, 'prism')) {
    const kinds = ['head', 'spray', 'time', 'base'].sort(() => Math.random() - 0.5);
    for (const k of kinds) {
      if (out.length >= n) break;
      let id = null;
      if (k === 'base') id = rollKind(run, 'base', out);
      else if (Math.random() < coreChance(run)) id = rollKind(run, 'core', out, k);
      if (!id && k !== 'base') id = rollKind(run, 'school', out, k);
      if (id) out.push(id);
    }
    while (out.length < n) { const id = rollSlot(run, out); if (!id) break; out.push(id); }
    return out;
  }
  while (out.length < n) {
    const id = rollSlot(run, out);
    if (!id) break;
    out.push(id);
  }
  // 至少保留 1 个其他流派或基础强化：三个全是同一流派时，最后一个换成基础
  const schools = out.map((id) => UPGRADES[id].school);
  if (out.length === n && schools[0] && schools.every((s) => s === schools[0])) {
    const alt = rollKind(run, 'base', out);
    if (alt) out[n - 1] = alt;
  }
  // 遗物 2 级：第一次三选一保底 1 个对应流派
  const ks = KEEPSAKES.find((k) => k.id === run.keepsake);
  if (ks && ks.school && run.keepsakeLv >= 2 && run.rewardsTaken === 0 && !out.some((id) => UPGRADES[id].school === ks.school)) {
    const id = rollKind(run, 'school', out, ks.school);
    if (id) out[0] = id;
  }
  return out;
}

// 获得一个强化（基础强化升一级）
export function addUpgrade(run, id) {
  const u = UPGRADES[id];
  if (!u) return;
  run.ups[id] = lv(run, id) + 1;
  if (u.cat === 'core') run.wavesSinceCore = 0;
  if (id === 'vigor') { run.maxHp += 10; run.hp += 10; }
  if (id === 'mag' || id === 'drum') run.ammo = magSize(run);
}

// ---------------- 商店 ----------------

// 价格随深度平滑上涨，与每波收入增长同步
// 第 k 家商店（每 3 波一家）价格 × k
export function priceScale(run) {
  return Math.max(1, run.waveIndex / SHOP.every);
}

export function healPrice(run) {
  const step = has(run, 'clinic') ? 0 : SHOP.healPriceStep;
  return Math.round((SHOP.healBasePrice + step * run.healBuys) * priceScale(run));
}

export function healAmount(run) {
  return SHOP.healAmount + (has(run, 'clinic') ? 10 : 0);
}

export function upgradePrice(run, id) {
  const u = UPGRADES[id];
  const P = SHOP.upgradePrice;
  const base = u.cat === 'base' ? P.base + P.baseStep * lv(run, id) : P[u.cat];
  return Math.round(base * priceScale(run) * (has(run, 'membercard') ? SHOP.discount : 1));
}

export function shopSellsStardust(shopNumber) {
  return SHOP.stardustShops == null || SHOP.stardustShops.includes(shopNumber);
}

export function stardustPrice(run) {
  return Math.round((SHOP.stardustBasePrice + SHOP.stardustPriceStep * run.stardustBuys) * priceScale(run));
}

export function stardustYield(run) {
  // 兑换量随商店深度增长得比价格快，越深越划算
  const k = priceScale(run);
  const y = SHOP.stardustYieldBase * k * (1 + SHOP.stardustDepthBonus * (k - 1));
  return Math.round(y * (has(run, 'starmap') ? 1.3 : 1));
}

// 商店货架：3 个强化（流派 60% / 基础 25% / 通用 15%，每格有概率换成核心），第 3 格可能换成经济强化
function rollShopItems(run) {
  const ids = [];
  for (let i = 0; i < SHOP.slots; i++) {
    let id = null;
    if (i === SHOP.slots - 1 && Math.random() < SHOP.econChance) id = pickOne(poolOf(run, (u) => u.cat === 'econ'));
    if (!id && Math.random() < SHOP.coreInShop) id = rollKind(run, 'core', ids);
    if (!id) {
      const r = Math.random();
      const kind = r < 0.6 ? 'school' : r < 0.85 ? 'base' : 'general';
      id = rollKind(run, kind, ids) || rollKind(run, 'school', ids) || rollKind(run, 'base', ids);
    }
    if (id) ids.push(id);
  }
  return ids;
}

// 这一波打完之后有没有商店
export function shopAfterWave(run) {
  return run.waveIndex % SHOP.every === 0;
}

export function openShop(run) {
  run.shopCount++;
  const ids = rollShopItems(run);
  const shop = {
    number: run.shopCount,
    items: ids.map((id) => ({ id, sold: false })),
    sellsStardust: shopSellsStardust(run.shopCount),
    openedAt: performance.now(),
    visit: {
      wave: run.waveIndex,
      shop: run.shopCount,
      goldIn: run.gold,
      hpIn: run.hp,
      maxHp: run.maxHp,
      offered: {
        heal: healPrice(run),
        items: ids.map((id) => upgradePrice(run, id)),
        stardust: shopSellsStardust(run.shopCount) ? stardustPrice(run) : null,
      },
      purchases: [],
      goldOut: 0,
      timeMs: 0,
    },
  };
  return shop;
}

function spend(run, shop, kind, price, extra = {}) {
  run.gold -= price;
  shop.visit.purchases.push({ kind, price, t: Math.round(performance.now() - shop.openedAt), ...extra });
}

export function buyHeal(run, shop) {
  const price = healPrice(run);
  if (run.gold < price || run.hp >= run.maxHp) return false;
  spend(run, shop, 'heal', price, { hpBefore: run.hp });
  run.hp = Math.min(run.maxHp, run.hp + healAmount(run));
  run.healBuys++;
  return true;
}

export function buyItem(run, shop, slot) {
  const item = shop.items[slot];
  if (!item || item.sold) return false;
  const price = upgradePrice(run, item.id);
  if (run.gold < price) return false;
  spend(run, shop, 'upgrade', price, { id: item.id });
  item.sold = true;
  addUpgrade(run, item.id);
  return true;
}

export function buyStardust(run, shop) {
  if (!shop.sellsStardust) return false;
  const price = stardustPrice(run);
  if (run.gold < price) return false;
  const amount = stardustYield(run);
  spend(run, shop, 'stardust', price, { amount });
  run.stardustBuys++;
  run.stardustFromShop += amount;
  return amount;
}

export function closeShop(run, shop) {
  shop.visit.goldOut = run.gold;
  shop.visit.timeMs = Math.round(performance.now() - shop.openedAt);
  run.shopVisits.push(shop.visit);
}

export const totalWaves = () => WAVES.length;
