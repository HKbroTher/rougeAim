// 所有可调数值集中在这里。原型的验证重点是商店决策，
// 如果玩家总是只买同一类东西，优先改 SHOP 里的价格。

export const PLAYER = {
  maxHp: 100,
  eyeHeight: 1.6,
  hitRadius: 1.1,          // bot 进入这个距离即算碰到玩家
  baseSensitivity: 0.0022, // 每像素弧度，乘以设置里的灵敏度倍率
  fov: 90,
};

export const WEAPON = {
  name: '制式步枪',
  fireInterval: 0.14,      // 秒，按住可连发
  magSize: 10,             // 弹匣容量：打空的子弹同样消耗弹药
  reloadTime: 1.6,         // 秒，打空弹匣自动换弹，R 键手动换弹
  damage: 1,
  headshotMultiplier: 2,
  range: 200,
};

export const COMBO = {
  perHit: 1,
  perHeadshotBonus: 1,     // 爆头额外增加的连杀数（总计 +2）
  multPerCombo: 0.1,       // 每层连杀 +0.1x
  maxMult: 4,              // 倍率上限
};

export const FOCUS = {
  max: 20,                 // 充满所需点数
  perHit: 1,
  perHeadshot: 2,
  duration: 4,             // 秒（真实时间）：子弹时间持续时长
  timeScale: 0.3,          // 子弹时间内敌人 / 出怪的时间流速
  ramp: 0.2,               // 进入和退出子弹时间的过渡（秒）
};

// 每种 bot 对应一种瞄准能力
export const BOTS = {
  normal: {
    label: '普通兵', skill: '基础点射',
    hp: 2, speed: 3.2, damage: 10, gold: 3,
    body: [0.8, 1.4, 0.5], head: 0.26,
    color: 0x2ec4b6, headColor: 0xfff3b0,
  },
  charger: {
    label: '冲锋兵', skill: '甩枪反应',
    hp: 1, speed: 7.5, damage: 8, gold: 2,
    body: [0.6, 1.1, 0.4], head: 0.22,
    color: 0xff8c42, headColor: 0xfff3b0,
  },
  heavy: {
    label: '重甲兵', skill: '持续跟枪',
    hp: 10, speed: 1.7, damage: 25, gold: 9,
    body: [1.5, 2.2, 1.0], head: 0.34,
    color: 0x8d7bd8, headColor: 0xfff3b0,
  },
};

export const ARENA = {
  spawnRadius: 30,
};

// 视野外的 bot 进入该距离时，在屏幕边缘对应方向亮起红光，越近越亮、闪得越快
export const THREAT = {
  range: 11,
};

// ---------------- 波次：20 波，由公式平滑生成 ----------------
// 难度只来自敌人本身：数量、速度、出怪密度、出怪扇区、兵种比例。
// bot 血量不随波次成长，保证「一发爆头秒普通兵」的手感从头到尾不变。
export const WAVE_COUNT = 20;

export const WAVE_CURVE = {
  countBase: 8,          // 第 1 波敌人数
  countLinear: 1.6,      // 每波线性增加
  countQuad: 0.06,       // 二次项，让后期密度加速上升
  intervalBase: 1.3,     // 第 1 波平均出怪间隔（秒）
  intervalDecay: 0.93,   // 每波乘以该系数
  intervalMin: 0.35,
  speedPerWave: 0.02,    // 每波敌人速度 +2%（第 20 波 1.38x）
  arcBase: 120,          // 第 1 波出怪扇区（度）
  arcPerWave: 40,        // 每波扩大，第 7 波起 360°
  chargerFrom: 2, chargerPerWave: 0.035, chargerMax: 0.38,
  heavyFrom: 3, heavyPerWave: 0.012, heavyMax: 0.2,
};

function makeWave(n) {
  const c = WAVE_CURVE;
  const k = n - 1;
  const total = Math.round(c.countBase + c.countLinear * k + c.countQuad * k * k);
  const chargerShare = n >= c.chargerFrom ? Math.min(c.chargerMax, 0.12 + c.chargerPerWave * (n - c.chargerFrom)) : 0;
  const heavyShare = n >= c.heavyFrom ? Math.min(c.heavyMax, 0.06 + c.heavyPerWave * (n - c.heavyFrom)) : 0;
  const charger = Math.round(total * chargerShare);
  const heavy = Math.max(n >= c.heavyFrom ? 1 : 0, Math.round(total * heavyShare));
  const count = { normal: total - charger - heavy };
  if (charger) count.charger = charger;
  if (heavy) count.heavy = heavy;
  return {
    n,
    name: `第 ${n} 波`,
    count,
    total,
    interval: Math.max(c.intervalMin, c.intervalBase * c.intervalDecay ** k),
    arc: Math.min(360, c.arcBase + c.arcPerWave * k),
    speedMul: 1 + c.speedPerWave * k,
  };
}

export const WAVES = Array.from({ length: WAVE_COUNT }, (_, i) => makeWave(i + 1));

export const SHOP = {
  // 回血：价格随本局购买次数上涨
  healAmount: 30,
  healBasePrice: 25,
  healPriceStep: 15,
  // 遗物：按稀有度定价
  relicPrice: { common: 45, rare: 70 },
  relicSlots: 2,
  // 星尘：比同档遗物贵，同一局越买越贵，越深的商店兑换越多
  stardustBasePrice: 55,
  stardustPriceStep: 25,
  stardustYieldBase: 14,
  stardustYieldPerDepth: 6, // depth = 已通过的波数
  // 所有金币价格（含每次购买的涨价幅度）乘以 1 + priceGrowth × depth，
  // 与每波收入的增长大致同步；星尘兑换量的增长更快，所以越深兑换比例越好。
  priceGrowth: 0.12,
  // 哪些商店卖星尘（按商店序号，从 1 开始）。设为 null 表示全部商店都卖。
  stardustShops: null,
  discountRelic: 0.8, // 「会员卡」折扣
};

// 结算星尘：按技术表现而不是存活时间
export const SETTLEMENT = {
  comboSqrt: 6,          // 6 × √最高连杀：连杀越长越好，但边际递减，防止无限连杀刷爆星尘
  perHeadshot: 0.25,
  perWave: 5,
  victoryBonus: 50,
};

// 局外星尘工坊：解锁为主，数值只给宽容度且有上限
export const META_UPGRADES = [
  { id: 'vitality', kind: 'stat', name: '强健体魄', desc: '生命上限 +10', costs: [40, 80, 140] },
  { id: 'shield', kind: 'stat', name: '护盾发生器', desc: '每局开局获得 1 层护盾', costs: [60, 120] },
  { id: 'stake', kind: 'talent', name: '随身盘缠', desc: '开局携带 15 金币', costs: [50, 100] },
  { id: 'extraChoice', kind: 'talent', name: '开局补给', desc: '开局额外进行一次遗物三选一', costs: [90] },
  { id: 'unlock_hawkeye', kind: 'unlock', name: '解锁：鹰眼弹', desc: '遗物「鹰眼弹」进入奖池', costs: [50], relic: 'hawkeye' },
  { id: 'unlock_starmap', kind: 'unlock', name: '解锁：星图', desc: '遗物「星图」进入奖池', costs: [60], relic: 'starmap' },
  { id: 'unlock_bloodpact', kind: 'unlock', name: '解锁：血色契约', desc: '诅咒遗物「血色契约」进入奖池', costs: [70], relic: 'bloodpact' },
];
