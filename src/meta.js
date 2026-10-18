// 局外存档：星尘、命盘、遗物、设置、枪法档案与商店决策日志（用于调价）。
import { CARDS, DECK_CAPACITY, KEEPSAKES, LEGACY_REFUND, CARD_MAX_LV, cardUpgradeCost } from './config.js';
import { migrateSettings } from './sens.js';

const KEY = 'rougeaim.save.v1';
const MAX_RUNS = 50;

const STARTER_CARDS = CARDS.filter((c) => c.unlock === 0).map((c) => c.id);

function defaults() {
  return {
    version: 2,
    stardust: 0,
    cores: 0,                // 星核：每打完一个区域 +1，用于卡牌第 4 级和解锁觉醒卡
    // 命盘：unlocked 已解锁的卡，active 已装备的卡，levels 卡牌等级（默认 1），capacityLv 心力上限升级次数
    deck: { unlocked: [...STARTER_CARDS], active: [], levels: {}, capacityLv: 0 },
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
    // 卡牌改版：删掉已经不存在的卡（坚韧之心、盾之觉醒、不屈、金之觉醒），退还解锁花费
    const OLD = { v_heart: 150, w_shield: 90, w_revive: 180, w_gold: 120 };
    for (const [id, cost] of Object.entries(OLD)) {
      if (save.deck.unlocked.includes(id)) { save.stardust += cost; save.refunded = (save.refunded || 0) + cost; }
    }
    save.deck.unlocked = save.deck.unlocked.filter((id) => cardById(id));
    save.deck.active = save.deck.active.filter((id) => cardById(id) && cardById(id).cat !== 'wake');
    save.deck.levels ||= {};
    save.cores ||= 0;
    // 心力上限改为最高 24：超出的升级次数退还
    const extra = save.deck.capacityLv - DECK_CAPACITY.costs.length;
    if (extra > 0) { save.deck.capacityLv = DECK_CAPACITY.costs.length; save.stardust += 300 * extra; save.refunded = (save.refunded || 0) + 300 * extra; }
    while (deckUsed(save) > deckCapacity(save)) save.deck.active.pop();
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

export const cardLevel = (save, id) => (cardUnlocked(save, id) ? save.deck.levels[id] || 1 : 0);

// 上下左右相邻的普通卡（觉醒卡不算）
export function cardNeighbors(card) {
  const [r, c] = card.pos;
  return CARDS.filter((x) => x.cat !== 'wake' && Math.abs(x.pos[0] - r) + Math.abs(x.pos[1] - c) === 1);
}

// 同一行的其他普通卡
export function cardRow(card) {
  return CARDS.filter((x) => x.cat !== 'wake' && x.pos[0] === card.pos[0] && x !== card);
}

// 觉醒条件（每张觉醒卡只有一个）：
//   adjAll 上下左右相邻的卡全部装备 / row 所在行其余卡全部装备 / adjOne 相邻的卡至少装备一张 / few 装备不超过 4 张
export function wakeMet(save, card) {
  const on = (x) => cardEquipped(save, x.id);
  if (card.wake === 'adjAll') return cardNeighbors(card).every(on);
  if (card.wake === 'row') return cardRow(card).every(on);
  if (card.wake === 'adjOne') return cardNeighbors(card).some(on);
  if (card.wake === 'few') return save.deck.active.length > 0 && save.deck.active.length <= 4;
  return false;
}

export function wakeState(save, card) {
  if (card.cat !== 'wake' || !cardUnlocked(save, card.id)) return 'locked';
  return wakeMet(save, card) ? 'awake' : 'dormant';
}

export function cardAwake(save, card) {
  return wakeState(save, card) === 'awake';
}

// 本局带进去的卡（装备的 + 觉醒的）
export function activeCards(save) {
  const out = new Set(save.deck.active.filter((id) => cardUnlocked(save, id)));
  for (const c of CARDS) if (cardAwake(save, c)) out.add(c.id);
  return out;
}

export function cardLevels(save) {
  const out = {};
  for (const id of save.deck.unlocked) out[id] = cardLevel(save, id);
  return out;
}

export function unlockCard(save, id) {
  const c = cardById(id);
  const cores = c?.coresToUnlock || 0;
  if (!c || cardUnlocked(save, id) || save.stardust < c.unlock || (save.cores || 0) < cores) return false;
  save.stardust -= c.unlock;
  save.cores = (save.cores || 0) - cores;
  save.deck.unlocked.push(id);
  persist(save);
  return true;
}

export function nextCardUpgrade(save, id) {
  const c = cardById(id);
  const lv = cardLevel(save, id);
  if (!c || !lv || lv >= CARD_MAX_LV) return null;
  return cardUpgradeCost(c, lv + 1);
}

export function upgradeCard(save, id) {
  const cost = nextCardUpgrade(save, id);
  if (!cost || save.stardust < cost.dust || (save.cores || 0) < cost.cores) return false;
  save.stardust -= cost.dust;
  save.cores = (save.cores || 0) - cost.cores;
  save.deck.levels[id] = cardLevel(save, id) + 1;
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
