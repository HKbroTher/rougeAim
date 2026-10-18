// 单局状态与规则（不依赖渲染，便于单测和平衡模拟）。
import { PLAYER, WEAPON, RATING, FOCUS, SHOP, WAVES, KEEPSAKES, WELL, WELL_ITEMS, CARDS, cardValue } from './config.js';
import { UPGRADES, BASE_MAX_LEVEL } from './upgrades.js';
import { unlockedUpgrades, keepsakeLevel, activeCards, cardLevels } from './meta.js';

export function createRun(save) {
  const cards = activeCards(save);
  const levels = cardLevels(save);
  const cv = (id) => (cards.has(id) ? cardValue(CARD_BY_ID[id], levels[id] || 1) : 0);
  const maxHp = PLAYER.maxHp + cv('v_body');
  const keepsake = save.keepsake && keepsakeLevel(save, save.keepsake) > 0 ? save.keepsake : null;
  const run = {
    hp: maxHp,
    maxHp,
    cards,
    cardLv: levels,
    shield: 0,
    revivesLeft: cv('v_death'), // 死亡抗拒：可以复活的次数
    iframe: 0,          // 喘息：受伤后的无敌时间（秒，真实时间）
    momentumUntil: -9,  // 处决势头：这个时刻之前的下一发爆头 ×2
    gold: cv('e_stake'),
    // 火力评级：tier 0..4（D..S），points 当前等级的进度，idle 多久没造成伤害
    rating: { tier: 0, points: 0, idle: 0, peak: 0 },
    ratingScore: 0,  // 每波结束时的评级累加（结算星尘）
    reviveUsed: false,
    unlockedCards: [...save.deck.unlocked],
    gifted: [],        // 独行：本局额外激活的卡
    focus: 0,
    focusTime: 0,
    focusTotal: 0,   // 本次子弹时间的总时长（HUD 用）
    bt: null,        // 本次子弹时间的统计：{ kills, dmg, ext, bankExt, hitBots }
    ammo: 0,
    reloadLeft: 0,
    reloadTotal: 0,
    heat: 0,         // 过热枪管
    idle: 0,         // 停火时长（过热衰减、静心）
    sprayTime: 0,    // 持续开火时长（过热、弹链、预热）
    beltAcc: 0,
    trackShieldUsed: false,
    waveFireTime: 0,   // 本波持续开火的累计时间（跟枪护盾）
    execChain: { botId: null, at: -9, bonus: 0 },
    ups: {},         // 强化 id -> 等级
    keepsake,
    keepsakeLv: keepsake ? 1 : 0,
    unlocked: unlockedUpgrades(save),
    waveIndex: 0,
    wavesSinceCore: 0,
    rerolls: SHOP.rerollTokensStart + cv('e_fate') + (cards.has('w_star') ? 1 : 0), // 命运骰
    temp: [],        // 卡戎之井的临时效果：{ id, waves }
    rewardsTaken: 0,
    healBuys: 0,
    stardustBuys: 0,
    shopCount: 0,
    stardustFromShop: 0,
    emergencyUsed: false,
    adrenalineHealed: 0,
    chainStacks: 0,
    stats: { shots: 0, hits: 0, headshots: 0, kills: 0, goldEarned: 0, damageTaken: 0, misses: 0, tierDrops: 0, reloads: 0, moverHits: 0, moverMisses: 0, damage: 0 },
    shopVisits: [],
    waveLog: [], // 每波的血量、命中、金币变化，用于平衡分析
  };
  run.ammo = magSize(run);
  return run;
}

export const lv = (run, id) => run.ups[id] || 0;
const CARD_BY_ID = Object.fromEntries(CARDS.map((c) => [c.id, c]));
export const hasCard = (run, id) => run.cards.has(id);
// 卡牌在当前等级的数值；没带这张卡为 0
export const cv = (run, id) => (run.cards.has(id) ? cardValue(CARD_BY_ID[id], run.cardLv[id] || 1) : 0);
export const hasTemp = (run, id) => run.temp.some((t) => t.id === id);
export const tempDamageMul = (run) => (hasTemp(run, 'wrath') ? 1.2 : 1);
export const has = (run, id) => lv(run, id) > 0;
export const keepsakeIs = (run, id) => run.keepsake === id;
export const inBulletTime = (run) => run.focusTime > 0;

// ---------------- 火力评级 ----------------

export const tierDef = (run) => RATING.tiers[run.rating.tier];
const MAX_TIER = RATING.tiers.length - 1;

function addRating(run, pts) {
  const r = run.rating;
  r.points += pts;
  while (r.tier < MAX_TIER && r.points >= RATING.tiers[r.tier].need) {
    r.points -= RATING.tiers[r.tier].need;
    r.tier++;
  }
  if (r.tier === MAX_TIER) r.points = Math.min(r.points, RATING.tiers[MAX_TIER].need);
  r.peak = Math.max(r.peak, r.tier);
}

function dropTier(run) {
  const r = run.rating;
  if (r.tier === 0) { r.points = 0; return; }
  r.tier--;
  r.points = RATING.tiers[r.tier].need * RATING.dropKeep;
  run.stats.tierDrops++;
}


// 每帧：一段时间没造成伤害就慢慢回落（稳定火力：不回落）
export function tickRating(run, dt) {
  const r = run.rating;
  r.idle += dt;
  if (r.idle < RATING.decayDelay) return;
  r.points -= RATING.decayRate * Math.min(dt, r.idle - RATING.decayDelay);
  if (r.points < 0) {
    if (r.tier === 0) r.points = 0;
    else dropTier(run);
  }
}

// ---------------- 武器 ----------------

export function headMultiplier(run) {
  let m = has(run, 'guillotine') ? 3 : WEAPON.headshotMultiplier;
  if (has(run, 'precision')) m += 0.75;
  if (keepsakeIs(run, 'hunter')) m += 0.25;
  return m;
}

export function fireInterval(run, base) {
  let rate = (1 + 0.08 * run.chainStacks) * (1 + 0.05 * lv(run, 'trigger'));
  if (has(run, 'rapid')) rate *= 1.15;
  rate *= 1 + cv(run, 's_heat') / 100;
  if (has(run, 'spinup')) rate *= 1 + 0.08 * Math.min(5, Math.floor(run.sprayTime / 0.5));
  if (inBulletTime(run) && has(run, 'overclock')) rate *= 1.3;
  return base / rate;
}

export function magSize(run) {
  let m = has(run, 'drum') ? 24 : WEAPON.magSize;
  m += 2 * lv(run, 'mag');
  m += cv(run, 's_mag');
  if (keepsakeIs(run, 'drum')) m += 3;
  if (hasTemp(run, 'ammo')) m += 4;
  return m;
}

export function baseReloadTime(run) {
  return (has(run, 'drum') ? 3.2 : WEAPON.reloadTime) * (1 - 0.08 * lv(run, 'quick')) * (1 - cv(run, 's_suppress') / 100);
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
  const cool = has(run, 'coolant') && run.heat >= 20;
  const instant =
    (inBulletTime(run) && has(run, 'timeslit')) ||
    (manual && has(run, 'tacreload') && run.ammo >= magSize(run) * 0.5) ||
    cool;
  if (cool) run.heat -= 10;
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

// 持续开火：active = 按住左键且枪能出膛（没在换弹、有子弹）。打空也算在开火。
// 驱动过热、弹链、预热；松手或换弹 0.4 秒后中断。
export function tickFire(run, dt, active) {
  if (active) {
    run.idle = 0;
    run.sprayTime += dt;
    // 肾上腺素：持续开火每秒回复 1 生命（每波最多 12）
    if (has(run, 'adrenaline') && run.adrenalineHealed < 12) {
      const h = Math.min(dt, 12 - run.adrenalineHealed);
      run.adrenalineHealed += h;
      run.hp = Math.min(run.maxHp, run.hp + h);
    }
    if (has(run, 'overheat')) run.heat = Math.min(20, run.heat + 10 * dt);
    if (has(run, 'beltfeed')) {
      run.beltAcc += dt;
      while (run.beltAcc >= 0.4) { run.beltAcc -= 0.4; refundAmmo(run, 1); }
    }
    return;
  }
  run.idle += dt;
  if (run.idle >= 0.4) { run.sprayTime = 0; run.beltAcc = 0; }
  if (!has(run, 'overheat') || run.heat <= 0 || run.idle < 0.5) return;
  if (has(run, 'heatsink') && reloading(run)) return;
  run.heat = Math.max(0, run.heat - (has(run, 'heatsink') ? 4 : 8) * dt);
}

// ---------------- 专注 / 子弹时间 ----------------

export function focusMax(run) {
  return FOCUS.max * (has(run, 'fragment') ? 0.5 : 1);
}

export function focusDuration(run) {
  const bonus = (has(run, 'focuslens') ? 0.5 : 0) + cv(run, 't_debt');
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
  const gain = amount * (has(run, 'focuslens') ? 1.4 : 1) * (1 + 0.15 * lv(run, 'flow')) * (1 + cv(run, 't_flow') / 100);
  run.focus = Math.min(focusMax(run), run.focus + gain);
}

// 瞬时：专注分 4 格，每格单独释放 1 秒，子弹时间中可以继续释放来延长
export function canActivateFocus(run) {
  if (has(run, 'blink')) return run.focus >= focusMax(run) * 0.25 - 1e-6;
  if (inBulletTime(run)) return false;
  return run.focus >= focusMax(run) - 1e-6;
}

export function activateFocus(run) {
  if (!canActivateFocus(run)) return false;
  // 装填时刻：释放子弹时间时弹匣立刻装满
  if (has(run, 'reloadmoment')) { run.reloadLeft = 0; run.ammo = magSize(run); }
  if (has(run, 'blink')) {
    run.focus -= focusMax(run) * 0.25;
    const sec = focusDuration(run) / FOCUS.duration; // 1 秒，按其他强化的时长加成等比放大
    if (inBulletTime(run)) { run.focusTime += sec; run.focusTotal += sec; return true; }
    run.focusTime = sec;
  } else {
    run.focus = 0;
    run.focusTime = focusDuration(run);
  }
  run.focusTotal = run.focusTime;
  run.bt = { kills: 0, dmg: 0, bankAcc: 0, ext: 0, bankExt: 0, hitBots: new Set() };
  return true;
}

// 子弹时间延长（余韵、时间余量），按时停减半
function extendBulletTime(run, sec) {
  const k = has(run, 'stasis') ? 0.5 : 1;
  run.focusTime += sec * k;
  run.focusTotal += sec * k;
}

// 子弹时间结束时调用，返回本次统计
export function endBulletTime(run) {
  const bt = run.bt || { kills: 0, dmg: 0, hitBots: new Set() };
  run.bt = null;
  return bt;
}

// ---------------- 命中 / 打空 / 伤害 ----------------

// 一次命中的统计。extra：额外命中，不计入命中统计（否则命中率会超过 100%）
export function registerHit(run, headshot, { extra = false } = {}) {
  if (extra) return;
  run.stats.hits++;
  if (headshot) {
    run.stats.headshots++;
    if (has(run, 'chainhead')) run.chainStacks = Math.min(4, run.chainStacks + 1);
  } else {
    run.chainStacks = 0;
  }
}

export function registerMiss(run) {
  run.stats.misses++;
  run.chainStacks = 0;
  addRating(run, -Math.min(run.rating.points, RATING.missPenalty));
}

// 对敌人实际造成的伤害（溢出不算），所有来源（子弹、震爆、灼烧）都走这里。
// 评级与专注都按伤害增长，所以爆头和身体按各自的伤害算，不再额外偏向爆头。
export function onDamage(run, applied, killed) {
  run.stats.damage += applied;
  run.rating.idle = 0;
  addRating(run, applied + (killed ? RATING.killBonus : 0));
  addFocus(run, applied * FOCUS.perDamage);
  const bt = inBulletTime(run) && run.bt;
  if (!bt) return;
  bt.dmg += applied;
  if (has(run, 'timebank') && bt.bankExt < 1.5) {
    bt.bankAcc += applied;
    while (bt.bankAcc >= 10 && bt.bankExt < 1.5) {
      bt.bankAcc -= 10;
      const add = Math.min(0.15, 1.5 - bt.bankExt);
      bt.bankExt += add;
      extendBulletTime(run, add);
    }
  }
}

// 子弹时间里的击杀结算（余韵）
export function onKillInBulletTime(run) {
  if (!inBulletTime(run) || !run.bt) return;
  run.bt.kills++;
  if (has(run, 'afterglow') && run.bt.ext < 2) {
    const add = Math.min(0.25, 2 - run.bt.ext);
    run.bt.ext += add;
    extendBulletTime(run, add);
  }
}

export function goldMultiplier(run) {
  return tierDef(run).gold;
}

export function killGold(run, base, extraMul = 1) {
  let g = base * goldMultiplier(run) * extraMul * (1 + 0.08 * lv(run, 'fortune'));
  if (hasTemp(run, 'greed')) g *= 1.4;
  if (has(run, 'bloodpact')) g *= 1.4;
  g *= 1 + cv(run, 'w_rank') / 100;
  const gold = Math.max(1, Math.round(g));
  run.gold += gold;
  run.stats.goldEarned += gold;
  run.stats.kills++;
  return gold;
}

// 返回 { absorbed, dead, revived }
export function takeDamage(run, dmg) {
  // 喘息：受伤后的无敌时间内不再受伤
  if (run.iframe > 0) return { absorbed: true, dead: false, iframe: true };
  if (run.shield > 0) {
    run.shield--;
    return { absorbed: true, dead: false };
  }
  // 背水：受到的伤害 −x%，生命低于 40% 时翻倍
  const grit = cv(run, 'v_grit') / 100;
  if (grit) dmg *= 1 - (run.hp < run.maxHp * 0.4 ? grit * 2 : grit);
  // 老兵：从第 6 波开始减伤
  if (run.waveIndex >= 5) dmg *= 1 - cv(run, 'v_aid') / 100;
  dmg = Math.round(dmg);
  run.hp = Math.max(0, run.hp - dmg);
  run.iframe = cv(run, 'v_shield');
  run.stats.damageTaken += dmg;
  // 被碰到降一级评级
  dropTier(run);
  // 应急护盾：每波第一次降到 40% 以下，获得 2 层护盾
  if (has(run, 'emergency') && !run.emergencyUsed && run.hp > 0 && run.hp < run.maxHp * 0.4) { run.emergencyUsed = true; run.shield += 2; }
  if (run.hp <= 0 && run.revivesLeft > 0) {
    run.revivesLeft--;
    run.reviveUsed = true;
    run.hp = Math.round(run.maxHp * 0.5);
    return { absorbed: false, dead: false, revived: true };
  }
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
  run.emergencyUsed = false;
  run.adrenalineHealed = 0;
  run.trackShieldUsed = false;
  run.waveFireTime = 0;
  run.ammo = magSize(run);
  run.reloadLeft = 0;
  run.focusTime = 0;
  run.bt = null;
  run.heat = 0;
  run.sprayTime = 0;
  run.beltAcc = 0;
  run.rating.idle = 0;
  // 时之沙：每波开始专注 +x%
  if (hasCard(run, 't_badge')) run.focus = Math.min(focusMax(run), run.focus + focusMax(run) * cv(run, 't_badge') / 100);
  // 护盾强化：每波开始把护盾补到等级数（不会跨波无限累积）
  if (has(run, 'guard')) run.shield = Math.max(run.shield, lv(run, 'guard'));
  if (keepsakeIs(run, 'watch')) run.focus = Math.min(focusMax(run), run.focus + focusMax(run) * 0.3);
  if (hasTemp(run, 'surge')) run.focus = focusMax(run);
}

// 清完一波
export function finishWave(run) {
  run.lastGifted = [];
  run.waveIndex++;
  run.wavesSinceCore++;
  run.focusTime = 0;
  run.bt = null;
  run.ratingScore += run.rating.tier;
  const heal = 5 * lv(run, 'bandage');
  if (heal) run.hp = Math.min(run.maxHp, run.hp + heal);
  // 临时效果倒数；进入新区域送一个命运骰
  run.temp = run.temp.map((t) => ({ ...t, waves: t.waves - 1 })).filter((t) => t.waves > 0);
  if (SHOP.shopAfter.includes(run.waveIndex)) {
    run.rerolls += SHOP.rerollTokensPerRegion;
    if (hasCard(run, 'w_few')) giftCards(run, cv(run, 'w_few'));
  }
}

// 独行：随机激活几张已解锁、没带进来的卡（开局三选一类的卡局中无效，不参与）
export function giftCards(run, n) {
  const pool = CARDS.filter((c) => c.cat !== 'wake' && !c.opening && run.unlockedCards.includes(c.id) && !run.cards.has(c.id));
  const got = [];
  for (let k = 0; k < n && pool.length; k++) {
    const c = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    run.cards.add(c.id);
    got.push(c.id);
    // 开局才生效的数值，激活时立刻补上
    const v = cv(run, c.id);
    if (c.id === 'v_body') { run.maxHp += v; run.hp += v; }
    if (c.id === 'e_stake') run.gold += v;
    if (c.id === 'e_fate') run.rerolls += v;
    if (c.id === 'v_death') run.revivesLeft += v;
  }
  run.gifted.push(...got);
  run.lastGifted = got;
  return got;
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
  const card = { head: 'h_pierce', spray: 's_heat', time: 't_stasis' };
  for (const s of Object.keys(owned)) w[s] = Math.min(3, 1 + 0.4 * owned[s]) * (hasCard(run, card[s]) ? 1.6 : 1);
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
  // Boss 战利品：只出核心强化（核心不够时用流派强化补齐）
  if (opts.core) {
    while (out.length < n) {
      const id = rollKind(run, 'core', out) || rollKind(run, 'school', out) || rollKind(run, 'base', out);
      if (!id) break;
      out.push(id);
    }
    return out;
  }
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
  // 流派遗物：第一次三选一保底 1 个对应流派
  const ks = KEEPSAKES.find((k) => k.id === run.keepsake);
  if (ks && ks.school && run.rewardsTaken === 0 && !out.some((id) => UPGRADES[id].school === ks.school)) {
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

// ---------------- 商店（参考 Hades 的卡戎） ----------------
// 卡戎商店：每个区域结束（第 5、10、15 波后）固定出现，卖强化、基础强化、生命之心、治疗、星尘。
// 卡戎之井：其余波次之间随机出现，3 件便宜的临时道具。
// 命运骰：刷新免费三选一 / 商店货架 / 卡戎之井；卡戎商店还可以花金币刷新。

// 价格随深度增长：第 3 波后为 1 倍，之后每 3 波 +1 倍（与收入增长同步）
export function priceScale(run) {
  return Math.max(1, run.waveIndex / 3);
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
  return Math.round(base * priceScale(run) * (has(run, 'membercard') ? SHOP.discount : 1) * (1 - cv(run, 'e_supply') / 100));
}

export function stardustPrice(run) {
  return Math.round((SHOP.stardustBasePrice + SHOP.stardustPriceStep * run.stardustBuys) * priceScale(run));
}

export function stardustYield(run) {
  // 兑换量随深度增长得比价格快，越深越划算
  const k = priceScale(run);
  const y = SHOP.stardustYieldBase * k * (1 + SHOP.stardustDepthBonus * (k - 1));
  return Math.round(y * (has(run, 'starmap') ? 1.3 : 1) * (1 + cv(run, 'e_star') / 100));
}

export function goldRerollPrice(run, shop) {
  return Math.round((SHOP.goldReroll.base + SHOP.goldReroll.step * shop.goldRerolls) * priceScale(run));
}

// 这一波打完之后：卡戎商店 / 卡戎之井 / 都没有
export function isShopWave(run) {
  return SHOP.shopAfter.includes(run.waveIndex);
}

export function rollWell(run) {
  return run.waveIndex >= WELL.from && !isShopWave(run) && Math.random() < WELL.chance;
}

// 卡戎商店的强化货架：流派 / 通用（可能是核心或经济）+ 1 个基础强化
function rollShopUpgrades(run) {
  const ids = [];
  for (let i = 0; i < SHOP.upgradeSlots; i++) {
    let id = null;
    if (i === SHOP.upgradeSlots - 1 && Math.random() < SHOP.econChance) id = pickOne(poolOf(run, (u) => u.cat === 'econ'));
    if (!id && Math.random() < SHOP.coreInShop) id = rollKind(run, 'core', ids);
    if (!id) id = rollKind(run, Math.random() < 0.8 ? 'school' : 'general', ids) || rollKind(run, 'school', ids) || rollKind(run, 'general', ids);
    if (id && !ids.includes(id)) ids.push(id);
  }
  const base = rollKind(run, 'base', ids);
  if (base) ids.push(base);
  return ids;
}

function rollWellItems() {
  return Object.keys(WELL_ITEMS).sort(() => Math.random() - 0.5).slice(0, WELL.slots);
}

export function wellPrice(run, id) {
  return Math.round(WELL_ITEMS[id].price * WELL.priceMul * priceScale(run));
}

export function goodPrice(run, shop, id) {
  if (shop.kind === 'well') return wellPrice(run, id);
  if (id === 'heal') return healPrice(run);
  if (id === 'heart') return Math.round(SHOP.heartPrice * priceScale(run));
  if (id === 'stardust') return stardustPrice(run);
  return 0;
}

// kind: 'shop' 卡戎商店 / 'well' 卡戎之井
export function openShop(run, kind = 'shop') {
  run.shopCount++;
  const shop = {
    number: run.shopCount,
    kind,
    items: [],      // 强化：{ id, sold }
    goods: [],      // 商店固定货品 / 卡戎之井道具：{ id, sold }
    goldRerolls: 0,
    openedAt: performance.now(),
  };
  if (kind === 'shop') {
    shop.items = rollShopUpgrades(run).map((id) => ({ id, sold: false }));
    shop.goods = ['heal', 'heart', 'stardust'].map((id) => ({ id, sold: false }));
  } else {
    shop.goods = rollWellItems().map((id) => ({ id, sold: false }));
  }
  shop.visit = {
    wave: run.waveIndex,
    shop: run.shopCount,
    kind,
    goldIn: run.gold,
    hpIn: run.hp,
    maxHp: run.maxHp,
    offered: { items: shop.items.map((it) => upgradePrice(run, it.id)), goods: shop.goods.map((g) => goodPrice(run, shop, g.id)) },
    purchases: [],
    goldOut: 0,
    timeMs: 0,
  };
  return shop;
}

function spend(run, shop, kind, price, extra = {}) {
  run.gold -= price;
  shop.visit.purchases.push({ kind, price, t: Math.round(performance.now() - shop.openedAt), ...extra });
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

export function canBuyGood(run, shop, slot) {
  const g = shop.goods[slot];
  if (!g || g.sold) return false;
  if ((g.id === 'heal' || g.id === 'ration') && run.hp >= run.maxHp) return false;
  return run.gold >= goodPrice(run, shop, g.id);
}

export function buyGood(run, shop, slot) {
  if (!canBuyGood(run, shop, slot)) return false;
  const g = shop.goods[slot];
  const price = goodPrice(run, shop, g.id);
  if (shop.kind === 'shop') {
    if (g.id === 'heal') {
      spend(run, shop, 'heal', price, { hpBefore: run.hp });
      run.hp = Math.min(run.maxHp, run.hp + healAmount(run));
      run.healBuys++;
      return true; // 治疗可以连续买（越买越贵）
    }
    if (g.id === 'stardust') {
      const amount = stardustYield(run);
      spend(run, shop, 'stardust', price, { amount });
      run.stardustBuys++;
      run.stardustFromShop += amount;
      return true; // 星尘可以连续买（越买越贵）
    }
    spend(run, shop, 'heal', price, { heart: true }); // 生命之心
    run.maxHp += SHOP.heartHp;
    run.hp += SHOP.heartHp;
    g.sold = true;
    return true;
  }
  // 卡戎之井：每件只能买一次
  spend(run, shop, g.id === 'ration' || g.id === 'aegis' ? 'heal' : 'well', price, { id: g.id });
  if (g.id === 'ration') run.hp = Math.min(run.maxHp, run.hp + 20);
  else if (g.id === 'aegis') run.shield++;
  else if (g.id === 'dice') run.rerolls++;
  else run.temp.push({ id: g.id, waves: WELL_ITEMS[g.id].waves });
  g.sold = true;
  return true;
}

// 刷新：命运骰（任何商店）或金币（只在卡戎商店，每次涨价）。只刷新没买的格子。
export function rerollShop(run, shop, useToken) {
  if (useToken) {
    if (run.rerolls <= 0) return false;
    run.rerolls--;
    shop.visit.purchases.push({ kind: 'reroll', price: 0, token: true });
  } else {
    if (shop.kind !== 'shop') return false;
    const price = goldRerollPrice(run, shop);
    if (run.gold < price) return false;
    spend(run, shop, 'reroll', price);
    shop.goldRerolls++;
  }
  if (shop.kind === 'shop') {
    const keep = shop.items.filter((it) => it.sold).map((it) => it.id);
    const fresh = rollShopUpgrades(run).filter((id) => !keep.includes(id));
    shop.items = shop.items.map((it) => (it.sold ? it : { id: fresh.shift() || it.id, sold: false }));
  } else {
    const keep = shop.goods.filter((g) => g.sold).map((g) => g.id);
    const fresh = rollWellItems().filter((id) => !keep.includes(id));
    shop.goods = shop.goods.map((g) => (g.sold ? g : { id: fresh.shift() || g.id, sold: false }));
  }
  return true;
}

// 用命运骰刷新免费三选一
export function useRerollToken(run) {
  if (run.rerolls <= 0) return false;
  run.rerolls--;
  return true;
}

export function closeShop(run, shop) {
  shop.visit.goldOut = run.gold;
  shop.visit.timeMs = Math.round(performance.now() - shop.openedAt);
  run.shopVisits.push(shop.visit);
}

export const totalWaves = () => WAVES.length;
