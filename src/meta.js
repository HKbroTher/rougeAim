// 局外存档：星尘、工坊等级、设置、枪法档案与商店决策日志（用于调价）。
import { META_UPGRADES, KEEPSAKES } from './config.js';
import { migrateSettings } from './sens.js';

const KEY = 'rougeaim.save.v1';
const MAX_RUNS = 50;

function defaults() {
  return {
    stardust: 0,
    upgrades: {},            // id -> level
    keepsakes: { hunter: 1, drum: 1, watch: 1 }, // 遗物 id -> 等级（三个流派遗物 1 级默认拥有）
    keepsake: null,          // 本局携带的遗物
    // 灵敏度：sensSource（cs2 / valorant / cm360）+ sensInput（该来源下的数值）；fov 为垂直视野（度）
    settings: migrateSettings({ volume: 0.5 }),
    runs: [],                // 每局摘要（枪法档案）
    shopLog: [],             // 每次进商店的决策记录
  };
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const save = { ...defaults(), ...JSON.parse(raw) };
    migrateSettings(save.settings); // 旧版本的灵敏度倍率换算成 CS2 单位，手感不变
    return save;
  } catch {
    return defaults();
  }
}

export function persist(save) {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // 隐私模式等情况下无法存档，原型照常运行
  }
}

export function resetSave() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  return defaults();
}

export function upgradeLevel(save, id) {
  return save.upgrades[id] || 0;
}

export function nextUpgradeCost(save, up) {
  const lv = upgradeLevel(save, up.id);
  return lv < up.costs.length ? up.costs[lv] : null;
}

export function buyUpgrade(save, id) {
  const up = META_UPGRADES.find((u) => u.id === id);
  const cost = up && nextUpgradeCost(save, up);
  if (cost == null || save.stardust < cost) return false;
  save.stardust -= cost;
  save.upgrades[id] = upgradeLevel(save, id) + 1;
  persist(save);
  return true;
}

export function unlockedUpgrades(save) {
  return META_UPGRADES.filter((u) => u.unlocks && upgradeLevel(save, u.id) > 0).map((u) => u.unlocks);
}

export function keepsakeLevel(save, id) {
  return (save.keepsakes && save.keepsakes[id]) || 0;
}

export function nextKeepsakeCost(save, k) {
  const lv = keepsakeLevel(save, k.id);
  return lv < k.costs.length ? k.costs[lv] : null;
}

export function buyKeepsake(save, id) {
  const k = KEEPSAKES.find((x) => x.id === id);
  const cost = k && nextKeepsakeCost(save, k);
  if (cost == null || save.stardust < cost) return false;
  save.stardust -= cost;
  save.keepsakes = { ...save.keepsakes, [id]: keepsakeLevel(save, id) + 1 };
  persist(save);
  return true;
}

export function selectKeepsake(save, id) {
  save.keepsake = id && keepsakeLevel(save, id) > 0 ? id : null;
  persist(save);
}

export function recordRun(save, summary, shopVisits) {
  save.runs.push(summary);
  if (save.runs.length > MAX_RUNS) save.runs.splice(0, save.runs.length - MAX_RUNS);
  save.shopLog.push(...shopVisits);
  if (save.shopLog.length > MAX_RUNS * 4) save.shopLog.splice(0, save.shopLog.length - MAX_RUNS * 4);
  persist(save);
}

// 汇总商店日志：玩家把金币花在了哪里、每次逛店犹豫了多久
export function shopStats(log) {
  const spend = { heal: 0, upgrade: 0, stardust: 0 };
  const visitsWith = { heal: 0, upgrade: 0, stardust: 0, nothing: 0 };
  let totalTime = 0;
  let saved = 0;
  for (const v of log) {
    totalTime += v.timeMs;
    saved += v.goldOut;
    const kinds = new Set();
    for (const p of v.purchases) {
      // 护盾算进生存开销，刷新算进强化开销；relic 为旧存档的叫法
      const kind = { relic: 'upgrade', reroll: 'upgrade', shield: 'heal' }[p.kind] || p.kind;
      spend[kind] += p.price;
      kinds.add(kind);
    }
    if (!kinds.size) visitsWith.nothing++;
    for (const k of kinds) visitsWith[k]++;
  }
  const totalSpend = spend.heal + spend.upgrade + spend.stardust;
  return {
    visits: log.length,
    spend,
    totalSpend,
    visitsWith,
    avgTimeSec: log.length ? totalTime / log.length / 1000 : 0,
    avgLeftover: log.length ? saved / log.length : 0,
  };
}
