// 单局状态与规则（不依赖渲染，便于单测和平衡模拟）。
import { PLAYER, WEAPON, COMBO, FOCUS, SHOP, WAVES } from './config.js';
import { RELICS, SUPPLIES, relicPool, pickRelics } from './relics.js';
import { upgradeLevel, unlockedRelics } from './meta.js';

export function createRun(save) {
  const maxHp = PLAYER.maxHp + 10 * upgradeLevel(save, 'vitality');
  return {
    hp: maxHp,
    maxHp,
    shield: upgradeLevel(save, 'shield') > 0 ? 1 : 0,
    gold: 15 * upgradeLevel(save, 'stake'),
    combo: 0,
    maxCombo: 0,
    focus: 0,
    focusTime: 0,
    ammo: WEAPON.magSize,
    reloadLeft: 0,
    relics: [],
    unlocked: unlockedRelics(save),
    extraChoice: upgradeLevel(save, 'extraChoice') > 0,
    waveIndex: 0,
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
}

export const has = (run, id) => run.relics.includes(id);

export function multiplier(run) {
  return Math.min(COMBO.maxMult, 1 + run.combo * COMBO.multPerCombo);
}

export function fireInterval(run, base) {
  return base / (1 + 0.12 * run.chainStacks);
}

export function magSize(run) {
  return WEAPON.magSize + (has(run, 'extmag') ? 5 : 0);
}

export const reloading = (run) => run.reloadLeft > 0;

export function startReload(run) {
  if (reloading(run) || run.ammo >= magSize(run)) return false;
  run.reloadLeft = WEAPON.reloadTime;
  run.stats.reloads++;
  return true;
}

// 返回 true 表示本帧换弹完成
export function tickReload(run, dt) {
  if (!reloading(run)) return false;
  run.reloadLeft = Math.max(0, run.reloadLeft - dt);
  if (run.reloadLeft > 0) return false;
  run.ammo = magSize(run);
  return true;
}

export function focusDuration(run) {
  return FOCUS.duration + (has(run, 'focuslens') ? 1 : 0);
}

function addFocus(run, amount) {
  if (run.focusTime > 0) return;
  const gain = has(run, 'focuslens') ? amount * 1.5 : amount;
  run.focus = Math.min(FOCUS.max, run.focus + gain);
}

export function registerHit(run, headshot) {
  run.stats.hits++;
  let gain = COMBO.perHit;
  if (headshot) {
    run.stats.headshots++;
    gain += COMBO.perHeadshotBonus + (has(run, 'hawkeye') ? 1 : 0);
    if (has(run, 'chainhead')) run.chainStacks = Math.min(4, run.chainStacks + 1);
    if (has(run, 'quickload')) run.ammo = Math.min(magSize(run), run.ammo + 1);
  } else {
    run.chainStacks = 0;
  }
  run.combo += gain;
  run.maxCombo = Math.max(run.maxCombo, run.combo);
  addFocus(run, headshot ? FOCUS.perHeadshot : FOCUS.perHit);
}

// 返回 'safety' | 'broken' | 'none'
export function registerMiss(run) {
  run.stats.misses++;
  run.chainStacks = 0;
  if (run.combo === 0) return 'none';
  if (has(run, 'safety') && !run.safetyUsed) {
    run.safetyUsed = true;
    return 'safety';
  }
  run.combo = 0;
  run.stats.comboBreaks++;
  return 'broken';
}

export function canActivateFocus(run) {
  return run.focus >= FOCUS.max && run.focusTime <= 0;
}

export function activateFocus(run) {
  if (!canActivateFocus(run)) return false;
  run.focus = 0;
  run.focusTime = focusDuration(run);
  return true;
}

export function killGold(run, base) {
  const mult = multiplier(run);
  let g = base * mult;
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
  run.ammo = magSize(run);
  run.reloadLeft = 0;
  run.focusTime = 0;
  if (has(run, 'waveshield')) run.shield++;
}

export function enemySpeedMul(run) {
  return has(run, 'bloodpact') ? 1.2 : 1;
}

// ---------- 遗物三选一 ----------

export function rollRewardChoices(run, n = 3) {
  const picks = pickRelics(relicPool(run.unlocked, run.relics), n);
  const supplies = [...SUPPLIES].sort(() => Math.random() - 0.5);
  while (picks.length < n && supplies.length) picks.push(supplies.pop());
  return picks;
}

export function supplyGold(run) {
  return Math.round(25 * priceScale(run));
}

export function addRelic(run, id) {
  if (id === 'sup_gold') run.gold += supplyGold(run);
  else if (id === 'sup_heal') run.hp = Math.min(run.maxHp, run.hp + 40);
  else if (id === 'sup_maxhp') { run.maxHp += 10; run.hp += 10; }
  else if (!run.relics.includes(id)) run.relics.push(id);
}

// ---------- 商店 ----------

// 价格随深度平滑上涨，与每波收入增长同步
export function priceScale(run) {
  return 1 + SHOP.priceGrowth * run.waveIndex;
}

export function healPrice(run) {
  const step = has(run, 'clinic') ? 0 : SHOP.healPriceStep;
  return Math.round((SHOP.healBasePrice + step * run.healBuys) * priceScale(run));
}

export function healAmount(run) {
  return SHOP.healAmount + (has(run, 'clinic') ? 10 : 0);
}

export function relicPrice(run, id) {
  const base = SHOP.relicPrice[RELICS[id].rarity];
  return Math.round(base * priceScale(run) * (has(run, 'membercard') ? SHOP.discountRelic : 1));
}

export function shopSellsStardust(shopNumber) {
  return SHOP.stardustShops == null || SHOP.stardustShops.includes(shopNumber);
}

export function stardustPrice(run) {
  return Math.round((SHOP.stardustBasePrice + SHOP.stardustPriceStep * run.stardustBuys) * priceScale(run));
}

export function stardustYield(run) {
  // depth = 已通过的波数，越深兑换越多
  const depth = run.waveIndex;
  const y = SHOP.stardustYieldBase + SHOP.stardustYieldPerDepth * depth;
  return Math.round(y * (has(run, 'starmap') ? 1.3 : 1));
}

export function openShop(run) {
  run.shopCount++;
  const ids = pickRelics(relicPool(run.unlocked, run.relics), SHOP.relicSlots);
  const shop = {
    number: run.shopCount,
    relics: ids.map((id) => ({ id, sold: false })),
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
        relics: ids.map((id) => relicPrice(run, id)),
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

export function buyRelic(run, shop, slot) {
  const item = shop.relics[slot];
  if (!item || item.sold) return false;
  const price = relicPrice(run, item.id);
  if (run.gold < price) return false;
  spend(run, shop, 'relic', price, { id: item.id });
  item.sold = true;
  addRelic(run, item.id);
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
