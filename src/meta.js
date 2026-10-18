// 局外存档：星尘、命盘、遗物、设置、枪法档案与商店决策日志（用于调价）。
import { CARDS, DECK_CAPACITY, KEEPSAKES, LEGACY_REFUND } from './config.js';
import { migrateSettings } from './sens.js';

const KEY = 'rougeaim.save.v1';
const MAX_RUNS = 50;

const STARTER_CARDS = CARDS.filter((c) => c.unlock === 0).map((c) => c.id);

function defaults() {
  return {
    version: 2,
    stardust: 0,
    // 命盘：unlocked 已解锁的卡，active 已装备的卡，capacityLv 心力上限升级次数
    deck: { unlocked: [...STARTER_CARDS], active: [], capacityLv: 0 },
    keepsakes: { hunter: 1, drum: 1, watch: 1 }, // 拥有的遗物（三个流派遗物默认拥有）
    keepsake: null,          // 本局携带的遗物
    // 灵敏度：sensSource（cs2 / valorant / cm360）+ sensInput（该来源下的数值）；fov 为垂直视野（度）
    settings: migrateSettings({ volume: 0.5 }),
    runs: [],                // 每局摘要（枪法档案）
    shopLog: [],             // 每次进商店的决策记录
  };
}

// v1 → v2：旧星尘工坊被命盘取代，工坊花费和流派遗物的 2、3 级花费全部退还成星尘
function migrate(save) {
  if (save.version >= 2) return save;
  let refund = 0;
  for (const [id, lv] of Object.entries(save.upgrades || {})) {
    const costs = LEGACY_REFUND.upgrades[id] || [];
    for (let k = 0; k < Math.min(lv, costs.length); k++) refund += costs[k];
  }
  const ks = {};
  for (const [id, lv] of Object.entries(save.keepsakes || {})) {
    if (!(lv > 0)) continue;
    ks[id] = 1;
    const costs = LEGACY_REFUND.keepsakes[id];
    if (costs && costs.length > 1) for (let k = 1; k < Math.min(lv, costs.length); k++) refund += costs[k];
  }
  save.keepsakes = { hunter: 1, drum: 1, watch: 1, ...ks };
  delete save.upgrades;
  save.stardust = (save.stardust || 0) + refund;
  save.refunded = refund;    // 标题界面提示一次
  save.version = 2;
  return save;
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const parsed = JSON.parse(raw);
    const save = { ...defaults(), ...parsed };
    if (!parsed.version) save.version = 1;
    migrate(save);
    save.deck = { ...defaults().deck, ...save.deck };
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

// ---------------- 命盘 ----------------

export const cardById = (id) => CARDS.find((c) => c.id === id);
export const cardUnlocked = (save, id) => save.deck.unlocked.includes(id);
export const cardEquipped = (save, id) => save.deck.active.includes(id);

export function deckCapacity(save) {
  return DECK_CAPACITY.base + DECK_CAPACITY.step * save.deck.capacityLv;
}

export function nextCapacityCost(save) {
  const lv = save.deck.capacityLv;
  return lv < DECK_CAPACITY.costs.length ? DECK_CAPACITY.costs[lv] : null;
}

export function deckUsed(save) {
  return save.deck.active.reduce((a, id) => a + (cardById(id)?.cost || 0), 0);
}

// 觉醒卡：已解锁 + 条件里的卡全部装备
export function cardAwake(save, card) {
  return card.cat === 'wake' && cardUnlocked(save, card.id) && card.need.every((id) => cardEquipped(save, id));
}

// 本局生效的卡（装备的 + 觉醒的）
export function activeCards(save) {
  const out = new Set(save.deck.active.filter((id) => cardUnlocked(save, id)));
  for (const c of CARDS) if (cardAwake(save, c)) out.add(c.id);
  return out;
}

export function unlockCard(save, id) {
  const c = cardById(id);
  if (!c || cardUnlocked(save, id) || save.stardust < c.unlock) return false;
  save.stardust -= c.unlock;
  save.deck.unlocked.push(id);
  persist(save);
  return true;
}

// 装备 / 卸下（觉醒卡不能手动装备）
export function toggleCard(save, id) {
  const c = cardById(id);
  if (!c || c.cat === 'wake' || !cardUnlocked(save, id)) return false;
  const d = save.deck;
  if (d.active.includes(id)) d.active = d.active.filter((x) => x !== id);
  else if (deckUsed(save) + c.cost <= deckCapacity(save)) d.active.push(id);
  else return false;
  persist(save);
  return true;
}

export function buyCapacity(save) {
  const cost = nextCapacityCost(save);
  if (cost == null || save.stardust < cost) return false;
  save.stardust -= cost;
  save.deck.capacityLv++;
  persist(save);
  return true;
}

// 解锁卡牌即把对应的局内强化加入奖池（不需要装备）
export function unlockedUpgrades(save) {
  return CARDS.filter((c) => c.unlocks && cardUnlocked(save, c.id)).flatMap((c) => c.unlocks);
}

// ---------------- 遗物 ----------------

export function keepsakeLevel(save, id) {
  return (save.keepsakes && save.keepsakes[id]) ? 1 : 0;
}

export function buyKeepsake(save, id) {
  const k = KEEPSAKES.find((x) => x.id === id);
  if (!k || keepsakeLevel(save, id) || save.stardust < k.cost) return false;
  save.stardust -= k.cost;
  save.keepsakes = { ...save.keepsakes, [id]: 1 };
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
      // 护盾算进生存开销，刷新和临时道具算进强化开销；relic 为旧存档的叫法
      const kind = { relic: 'upgrade', reroll: 'upgrade', shield: 'heal', well: 'upgrade' }[p.kind] || p.kind;
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
