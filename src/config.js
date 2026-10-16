// 所有可调数值集中在这里。原型的验证重点是商店决策，
// 如果玩家总是只买同一类东西，优先改 SHOP 里的价格。

export const PLAYER = {
  maxHp: 100,
  eyeHeight: 1.6,
  hitRadius: 1.1,          // bot 进入这个距离即算碰到玩家
  // 灵敏度与 FOV 在设置里调整，换算见 src/sens.js（底层与 CS2 相同：0.022° / count）
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
  countBase: 10,         // 第 1 波敌人数
  countLinear: 1.6,      // 每波线性增加
  countQuad: 0.03,       // 二次项，让后期密度略微加速上升
  intervalBase: 1.1,     // 第 1 波平均出怪间隔（秒）
  intervalDecay: 0.95,   // 每波乘以该系数
  intervalMin: 0.5,      // 加入机动后，后期出怪密度上限放宽（原 0.35）
  speedPerWave: 0.015,   // 每波敌人速度 +1.5%（第 20 波 1.29x）
  arcBase: 120,          // 第 1 波出怪扇区（度）
  arcPerWave: 40,        // 每波扩大，第 7 波起 360°
  chargerFrom: 2, chargerPerWave: 0.035, chargerMax: 0.38,
  heavyFrom: 3, heavyPerWave: 0.012, heavyMax: 0.2,
  // 机动：从第 moveFrom 波开始，一部分普通兵 / 冲锋兵带横向或垂直机动，比例和幅度逐波上升。
  // 重甲兵永远直线（它练的是跟枪，不是预判）。
  moveFrom: 4,
  moverShareBase: 0.15, moverSharePerWave: 0.04, moverShareMax: 0.65,
  ampBase: 0.8, ampPerWave: 0.1, ampMax: 2.5,          // 横向幅度（米）
  freqBase: 0.35, freqPerWave: 0.02, freqMax: 0.7,     // 横移频率（Hz）
  jumpFrom: 6,
  adadFrom: 9,
  adadSpeedBase: 2.2, adadSpeedPerWave: 0.1, adadSpeedMax: 3.4, // ADAD 横移速度（m/s）
};

// 机动的物理参数（与波次无关）
export const MOVEMENT = {
  convergeDistance: 8,   // 距离玩家小于该值时横向幅度线性收拢到 0
  chargerAmpMul: 0.5,    // 冲锋兵只做小幅横移
  jump: { height: 1.3, gravity: 20, intervalMin: 1.6, intervalMax: 2.8, crouchTime: 0.25, landLag: 0.3 },
  adad: { accel: 16, holdMin: 0.35, holdMax: 0.9, flipChance: 0.8 },
  goldBonus: { sine: 1, jump: 1, adad: 2 }, // 机动目标更难打，多给金币
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
  const m = n - c.moveFrom;
  const mobility = n < c.moveFrom ? null : {
    share: Math.min(c.moverShareMax, c.moverShareBase + c.moverSharePerWave * m),
    amp: Math.min(c.ampMax, c.ampBase + c.ampPerWave * m),
    freq: Math.min(c.freqMax, c.freqBase + c.freqPerWave * m),
    jump: n >= c.jumpFrom,
    adad: n >= c.adadFrom,
    adadSpeed: Math.min(c.adadSpeedMax, c.adadSpeedBase + c.adadSpeedPerWave * (n - c.adadFrom)),
  };
  return {
    n,
    name: `第 ${n} 波`,
    mobility,
    count,
    total,
    interval: Math.max(c.intervalMin, c.intervalBase * c.intervalDecay ** k),
    arc: Math.min(360, c.arcBase + c.arcPerWave * k),
    speedMul: 1 + c.speedPerWave * k,
  };
}

export const WAVES = Array.from({ length: WAVE_COUNT }, (_, i) => makeWave(i + 1));

// 为本波的一个 bot 抽取机动方式
export function rollMove(wave, type) {
  const mob = wave.mobility;
  if (!mob || type === 'heavy' || Math.random() >= mob.share) return { mode: 'none' };
  const modes = [['sine', 1]];
  if (type === 'normal' && mob.jump) modes.push(['jump', 0.7]);
  if (type === 'normal' && mob.adad) modes.push(['adad', 0.7]);
  let r = Math.random() * modes.reduce((a, [, w]) => a + w, 0);
  let mode = modes[0][0];
  for (const [id, w] of modes) { r -= w; if (r <= 0) { mode = id; break; } }
  const ampMul = type === 'charger' ? MOVEMENT.chargerAmpMul : 1;
  if (mode === 'sine') return { mode, amp: mob.amp * ampMul, freq: mob.freq };
  if (mode === 'jump') return { mode, amp: 0, height: MOVEMENT.jump.height };
  return { mode, amp: mob.amp, speed: mob.adadSpeed };
}

export const SHOP = {
  // 回血：价格随本局购买次数上涨
  healAmount: 30,
  healBasePrice: 25,
  healPriceStep: 15,
  // 强化：按类别定价；基础强化每升一级 +baseStep
  upgradePrice: { base: 30, baseStep: 15, school: 55, general: 50, econ: 45, core: 95 },
  schoolSlots: 2,        // 流派 / 通用货架数
  coreInShop: 0.08,      // 流派货架换成核心的概率
  econChance: 0.3,       // 出现经济货架的概率
  // 星尘：比同档强化贵，同一局越买越贵，越深的商店兑换越多
  stardustBasePrice: 55,
  stardustPriceStep: 25,
  stardustYieldBase: 14,
  stardustYieldPerDepth: 4, // depth = 已通过的波数
  // 所有金币价格（含每次购买的涨价幅度）乘以 1 + priceGrowth × depth，
  // 与每波收入的增长大致同步；星尘兑换量的增长更快，所以越深兑换比例越好。
  priceGrowth: 0.12,
  // 哪些商店卖星尘（按商店序号，从 1 开始）。设为 null 表示全部商店都卖。
  stardustShops: null,
  discount: 0.8, // 「会员卡」折扣
};

// 结算星尘：按技术表现而不是存活时间
export const SETTLEMENT = {
  comboSqrt: 6,          // 6 × √最高连杀：连杀越长越好，但边际递减，防止无限连杀刷爆星尘
  perHeadshot: 0.25,
  perWave: 5,
  victoryBonus: 50,
};

// 局外星尘工坊：解锁为主，数值只给宽容度且有上限。
// 价格按模拟测试定：普通水平一局约 450 星尘（其中一半以上来自商店兑换），全部买完约需 6 局。
export const META_UPGRADES = [
  { id: 'vitality', kind: 'stat', name: '强健体魄', desc: '生命上限 +10', costs: [120, 240, 420] },
  { id: 'shield', kind: 'stat', name: '护盾发生器', desc: '每局开局获得 1 层护盾', costs: [180, 360] },
  { id: 'stake', kind: 'talent', name: '随身盘缠', desc: '开局携带 15 金币', costs: [150, 300] },
  { id: 'extraChoice', kind: 'talent', name: '开局补给', desc: '开局额外进行一次强化三选一', costs: [270] },
  // 核心强化解锁线：每个流派默认开放 1 个（断头台、弹鼓、余韵）
  { id: 'unlock_pierce', kind: 'unlock', name: '解锁：穿颅弹', desc: '爆头流核心「穿颅弹」进入奖池', costs: [200], unlocks: 'pierce' },
  { id: 'unlock_flickmaster', kind: 'unlock', name: '解锁：甩枪大师', desc: '爆头流核心「甩枪大师」进入奖池', costs: [250], unlocks: 'flickmaster' },
  { id: 'unlock_overheat', kind: 'unlock', name: '解锁：过热枪管', desc: '扫射流核心「过热枪管」及其配套进入奖池', costs: [200], unlocks: 'overheat' },
  { id: 'unlock_suppress', kind: 'unlock', name: '解锁：压制火力', desc: '扫射流核心「压制火力」进入奖池', costs: [250], unlocks: 'suppress' },
  { id: 'unlock_stasis', kind: 'unlock', name: '解锁：时停', desc: '子弹时间流核心「时停」进入奖池', costs: [200], unlocks: 'stasis' },
  { id: 'unlock_timedebt', kind: 'unlock', name: '解锁：时间债', desc: '子弹时间流核心「时间债」进入奖池', costs: [250], unlocks: 'timedebt' },
  { id: 'unlock_hawkeye', kind: 'unlock', name: '解锁：鹰眼弹', desc: '爆头流强化「鹰眼弹」进入奖池', costs: [150], unlocks: 'hawkeye' },
  { id: 'unlock_starmap', kind: 'unlock', name: '解锁：星图', desc: '经济强化「星图」进入奖池', costs: [180], unlocks: 'starmap' },
  { id: 'unlock_bloodpact', kind: 'unlock', name: '解锁：血色契约', desc: '诅咒强化「血色契约」进入奖池', costs: [210], unlocks: 'bloodpact' },
];

// 遗物：每局开局选 1 个带进去。costs[0] 为 0 表示默认拥有 1 级。
export const KEEPSAKES = [
  { id: 'hunter', school: 'head', icon: '🎯', name: '猎手徽章', costs: [0, 200, 300],
    levels: ['爆头额外 +1 连杀', '第一次三选一保底 1 个爆头流强化', '开局额外一次「爆头流三选一」'] },
  { id: 'drum', school: 'spray', icon: '🥁', name: '旧弹鼓', costs: [0, 200, 300],
    levels: ['弹匣 +4', '第一次三选一保底 1 个扫射流强化', '开局额外一次「扫射流三选一」'] },
  { id: 'watch', school: 'time', icon: '⌚', name: '怀表', costs: [0, 200, 300],
    levels: ['每波开始专注 +50%', '第一次三选一保底 1 个子弹时间流强化', '开局额外一次「子弹时间流三选一」'] },
  { id: 'prism', school: null, icon: '🔺', name: '三棱镜', costs: [250],
    levels: ['三选一的三个选项必定来自三个不同类别（爆头 / 扫射 / 子弹时间 / 基础），不受流派倾向影响'] },
  { id: 'blank', school: null, icon: '⬜', name: '空白徽章', costs: [200],
    levels: ['没有效果；结算星尘 +25%'] },
];
