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
  damage: 2,               // 身体 2 点；普通兵 6 血 = 3 发身体 / 2 发爆头
  headshotMultiplier: 1.5, // 爆头 ×1.5；爆头流强化把它推到 ×2.25–×3.75，才能一枪带走普通兵
  range: 200,
};

// 火力评级：取代旧的连杀倍率。按「造成的伤害 + 击杀」上升，不再因为打空清零：
// 打空只扣一点进度，一段时间没造成伤害会慢慢回落，被碰到直接降一级。评级决定金币倍率。
export const RATING = {
  tiers: [
    { id: 'D', gold: 1.0, need: 20, color: '#8a93b8' },
    { id: 'C', gold: 1.2, need: 30, color: '#80ed99' },
    { id: 'B', gold: 1.4, need: 40, color: '#4cc9f0' },
    { id: 'A', gold: 1.65, need: 52, color: '#ffd166' },
    { id: 'S', gold: 2.0, need: 64, color: '#ff4d6d' },
  ],
  killBonus: 2,        // 每次击杀额外 +2 进度（伤害按实际扣掉的血量算，溢出不算）
  missPenalty: 0.5,    // 打空 −0.5 进度（不清零）
  decayDelay: 1.2,     // 超过这么久没造成伤害开始回落（秒）
  decayRate: 6,        // 每秒回落的进度
  dropKeep: 0.6,       // 降级后，新等级的进度保留到 60%
};

export const FOCUS = {
  max: 20,                 // 充满所需点数
  perDamage: 0.35,         // 每造成 1 点伤害充能（爆头和身体按伤害算，不额外偏向爆头）
  duration: 4,             // 秒（真实时间）：子弹时间持续时长
  timeScale: 0.3,          // 子弹时间内敌人 / 出怪的时间流速
  ramp: 0.2,               // 进入和退出子弹时间的过渡（秒）
};

// 每种 bot 对应一种瞄准能力
export const BOTS = {
  normal: {
    label: '普通兵', skill: '基础点射',
    hp: 6, speed: 3.2, damage: 10, gold: 3,
    body: [0.8, 1.4, 0.5], head: 0.26,
    color: 0x2ec4b6, headColor: 0xfff3b0,
  },
  charger: {
    label: '冲锋兵', skill: '甩枪反应',
    hp: 3, speed: 7.5, damage: 8, gold: 2,
    body: [0.6, 1.1, 0.4], head: 0.22,
    color: 0xff8c42, headColor: 0xfff3b0,
  },
  heavy: {
    label: '重甲兵', skill: '持续跟枪',
    hp: 30, speed: 1.7, damage: 25, gold: 9,
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
// bot 血量不随波次成长：同一把枪、同一个敌人，击杀所需的枪数从头到尾不变，成长全部来自强化。
export const WAVE_COUNT = 20;

export const WAVE_CURVE = {
  // 目标：高手一般死在第 12 波左右，只有非常强的发挥才能通关（模拟测试见 docs/DESIGN.md §2.7）
  countBase: 9,         // 第 1 波敌人数
  countLinear: 1.0,      // 每波线性增加
  countQuad: 0.02,       // 二次项，让后期密度加速上升
  intervalBase: 1.1,     // 第 1 波平均出怪间隔（秒）
  intervalDecay: 0.955,  // 每波乘以该系数
  intervalMin: 0.36,
  speedPerWave: 0.016,   // 每波敌人速度 +1.6%
  damagePerWave: 0.015,   // 每波碰撞伤害 +2%（第 12 波 1.22x），让后期每一次失误都更痛
  arcBase: 120,          // 第 1 波出怪扇区（度）
  arcPerWave: 40,        // 每波扩大，第 7 波起 360°
  chargerFrom: 2, chargerPerWave: 0.022, chargerMax: 0.3,
  heavyFrom: 3, heavyPerWave: 0.015, heavyMax: 0.18,
  // 机动：从第 moveFrom 波开始，一部分普通兵 / 冲锋兵带横向或垂直机动，比例和幅度逐波上升。
  // 重甲兵永远直线（它练的是跟枪，不是预判）。
  moveFrom: 4,
  moverShareBase: 0.15, moverSharePerWave: 0.05, moverShareMax: 0.8,
  ampBase: 0.9, ampPerWave: 0.11, ampMax: 2.5,         // 横向幅度（米）
  freqBase: 0.38, freqPerWave: 0.022, freqMax: 0.75,   // 横移频率（Hz）
  // 各种机动从第几波开始出现（越往后越多种）
  stutterFrom: 4,   // 急停冲刺
  orbitFrom: 5,     // 环绕：会绕到身后
  jumpFrom: 6,
  lungeFrom: 6,     // 冲锋兵扑击
  dodgeFrom: 7,     // 闪避：被准星压住会侧闪
  adadFrom: 8,
  doubleJumpFrom: 10,
  orbitSpeedBase: 3.5, orbitSpeedPerWave: 0.15, orbitSpeedMax: 5.5, // 环绕切线速度（m/s）
  // 夹击：从第 pincerFrom 波起，一部分敌人成对出现在你的正前和正后
  pincerFrom: 6, pincerBase: 0.15, pincerPerWave: 0.02, pincerMax: 0.4,
  adadSpeedBase: 2.2, adadSpeedPerWave: 0.1, adadSpeedMax: 3.4, // ADAD 横移速度（m/s）
};

// 机动的物理参数（与波次无关）
export const MOVEMENT = {
  convergeDistance: 8,   // 距离玩家小于该值时横向幅度线性收拢到 0
  chargerAmpMul: 0.5,    // 冲锋兵只做小幅横移
  jump: { height: 1.3, gravity: 20, intervalMin: 1.6, intervalMax: 2.8, crouchTime: 0.25, landLag: 0.3, doubleJumpSide: 4 },
  adad: { accel: 16, holdMin: 0.35, holdMax: 0.9, flipChance: 0.8 },
  // 闪避：准星停在它身上 aimTime 秒后，前摇 windup 秒（侧倾 + 发白），然后 dashTime 秒内侧闪 dashDist 米
  dodge: { aimAngle: 0.07, aimTime: 0.22, windup: 0.18, dashDist: 3.2, dashTime: 0.18, cooldown: 1.4, maxDodges: 3, maxOffset: 4.5 },
  // 环绕：切线速度 tangential m/s 绕玩家转，角速度上限 maxAngular，距离 < slowRadius 时逐渐停止环绕
  orbit: { maxAngular: 0.9, slowRadius: 5 },
  // 急停冲刺：走 → 停（几乎不动）→ 下蹲前摇 → 冲刺（sprintSpeed 倍速）
  stutter: { walkMin: 0.5, walkMax: 1.2, stopMin: 0.45, stopMax: 0.8, stopSpeed: 0.1, windup: 0.18, sprint: 0.55, sprintSpeed: 2.6 },
  // 扑击（冲锋兵）：冲到 distMin–distMax 米时停下发红光 windup 秒，然后以 speed 倍速扑过来
  lunge: { distMin: 7, distMax: 11, windup: 0.55, speed: 2.0 },
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
    orbitSpeed: Math.min(c.orbitSpeedMax, c.orbitSpeedBase + c.orbitSpeedPerWave * (n - c.orbitFrom)),
    pincer: n < c.pincerFrom ? 0 : Math.min(c.pincerMax, c.pincerBase + c.pincerPerWave * (n - c.pincerFrom)),
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
    damageMul: 1 + c.damagePerWave * k,
  };
}

export const WAVES = Array.from({ length: WAVE_COUNT }, (_, i) => makeWave(i + 1));

// 为本波的一个 bot 抽取机动方式
export function rollMove(wave, type) {
  const mob = wave.mobility;
  if (!mob || type === 'heavy' || Math.random() >= mob.share) return { mode: 'none' };
  const n = wave.n;
  const c = WAVE_CURVE;
  const modes = [['sine', 1]];
  if (type === 'normal') {
    if (n >= c.stutterFrom) modes.push(['stutter', 0.8]);
    if (n >= c.orbitFrom) modes.push(['orbit', 0.8]);
    if (n >= c.jumpFrom) modes.push(['jump', 0.8]);
    if (n >= c.dodgeFrom) modes.push(['dodge', 0.9]);
    if (n >= c.adadFrom) modes.push(['adad', 0.8]);
  } else if (type === 'charger') {
    if (n >= c.lungeFrom) modes.push(['lunge', 1.3]);
    if (n >= c.orbitFrom + 3) modes.push(['orbit', 0.5]);
  }
  let r = Math.random() * modes.reduce((a, [, w]) => a + w, 0);
  let mode = modes[0][0];
  for (const [id, w] of modes) { r -= w; if (r <= 0) { mode = id; break; } }
  const ampMul = type === 'charger' ? MOVEMENT.chargerAmpMul : 1;
  if (mode === 'sine') return { mode, amp: mob.amp * ampMul, freq: mob.freq };
  if (mode === 'jump') return { mode, amp: 0, height: MOVEMENT.jump.height, doubleJump: n >= c.doubleJumpFrom };
  if (mode === 'adad') return { mode, amp: mob.amp, speed: mob.adadSpeed };
  if (mode === 'dodge') return { mode, amp: mob.amp };
  if (mode === 'orbit') return { mode, amp: 0, tangential: mob.orbitSpeed * (type === 'charger' ? 1.3 : 1) };
  return { mode, amp: 0 }; // stutter / lunge
}

// ---------------- 商店（参考 Hades 的卡戎） ----------------
// 卡戎商店：每个区域（5 波）结束时固定出现；卡戎之井：其余波次之间随机出现，卖便宜的临时道具。
// 命运骰：每局有限的刷新次数，可以刷新免费三选一、商店货架、卡戎之井。
export const SHOP = {
  shopAfter: [5, 10, 15],  // 第几波之后出现卡戎商店（区域结束）
  // 价格：下面是第 3 波前后的价格，之后每 3 波 +1 倍（与收入增长同步）
  upgradePrice: { base: 55, baseStep: 18, school: 72, general: 64, econ: 55, core: 118 },
  upgradeSlots: 2,         // 流派 / 通用强化货架（每格有概率换成核心）
  coreInShop: 0.15,
  econChance: 0.25,        // 第 2 个强化货架换成经济强化的概率
  discount: 0.8,           // 「会员卡」折扣
  // 固定货品
  healAmount: 40,          // 治疗（食物）
  healBasePrice: 40,
  healPriceStep: 20,       // 每买一次治疗涨价（整局累计）
  heartHp: 15,             // 生命之心：生命上限 +15 并回复 15
  heartPrice: 60,
  // 星尘：同一局越买越贵，越深兑换越多
  stardustBasePrice: 70,
  stardustPriceStep: 30,
  stardustYieldBase: 30,
  stardustDepthBonus: 0.12,
  // 刷新：命运骰（免费）或金币（只在卡戎商店，每次涨价）
  rerollTokensStart: 2,    // 每局开局的命运骰
  rerollTokensPerRegion: 1, // 每进入新区域（第 5、10、15 波后）+1
  goldReroll: { base: 20, step: 20 },
};

// 卡戎之井：区域内的波次之间随机出现，3 件临时道具，每件只能买一次
export const WELL = {
  from: 2,                 // 第 2 波之后才会出现
  chance: 0.35,
  slots: 3,
  priceMul: 1,             // 价格同样随深度倍增
};

// 卡戎之井的临时道具（waves = 持续几波；0 = 立即生效）
export const WELL_ITEMS = {
  ration: { icon: '🍖', name: '战地口粮', price: 25, waves: 0, desc: '立即回复 20 生命。' },
  aegis: { icon: '◈', name: '临时护盾', price: 35, waves: 0, desc: '立即获得 1 层护盾。' },
  wrath: { icon: '🔥', name: '怒火药剂', price: 40, waves: 2, desc: '接下来 2 波，所有伤害 +20%。' },
  greed: { icon: '💰', name: '金币契约', price: 35, waves: 2, desc: '接下来 2 波，击杀金币 +40%。' },
  surge: { icon: '◑', name: '专注药剂', price: 30, waves: 1, desc: '下一波开局专注直接充满。' },
  ammo: { icon: '▥', name: '扩容弹药箱', price: 30, waves: 3, desc: '接下来 3 波，弹匣 +4。' },
  dice: { icon: '🎲', name: '命运骰', price: 40, waves: 0, desc: '获得 1 个命运骰（刷新次数）。' },
};

// 结算星尘：按技术表现而不是存活时间
export const SETTLEMENT = {
  perTierWave: 3,        // 每波结束时的火力评级（D=0 … S=4）× 3，累加
  perKill: 0.2,
  perWave: 6,
  victoryBonus: 50,
  coresPerRegion: 1,     // 星核：每打完一个区域（第 5、10、15、20 波）+1，用于卡牌第 4 级和解锁觉醒卡
};

// ---------------- 命盘（参考 Hades 2 的塔罗牌） ----------------
// 5×5 共 25 张卡。星尘解锁卡牌；每张卡有心力消耗，装备的卡总消耗不能超过心力上限。
// 21 张普通卡总消耗 52，心力最高只有 24：满级也只能装不到一半，构筑来自取舍。
// 每张卡可以升 3 次（1–4 级），升级只加强效果、不增加消耗；第 4 级需要 1 个星核。
// 觉醒卡消耗 0，不能手动装备。两条路任选其一即觉醒：① 上下左右相邻的普通卡全部装备；② 各自的特殊条件（有的看命盘形状，有的在局内达成）。
// 解锁卡牌本身（不需要装备）就会把对应的局内强化加入奖池（unlocks）。
export const DECK_SIZE = 5;
export const CARD_MAX_LV = 4;
export const DECK_CAPACITY = { base: 10, step: 2, costs: [60, 100, 140, 180, 230, 280, 340] }; // 10 → 24

// 升级价格：第 2 / 3 / 4 级，按卡牌消耗定价；第 4 级额外要 1 个星核
export function cardUpgradeCost(card, toLv) {
  const base = 20 + 10 * (card.cat === 'wake' ? 3 : card.cost);
  return { dust: base * (toLv - 1), cores: toLv === CARD_MAX_LV ? 1 : 0 };
}

export const CARD_CATS = {
  tol: { name: '宽容', color: '#80ed99' },
  head: { name: '爆头', color: '#ff9e00' },
  spray: { name: '扫射', color: '#4cc9f0' },
  time: { name: '子弹时间', color: '#c77dff' },
  econ: { name: '经济', color: '#ffd166' },
  wake: { name: '觉醒', color: '#ff4d6d' },
};

// desc 里的 {v} 会替换成 vals（四个等级的数值），fmt 决定显示格式
const pct = (v) => `${v}%`;
export const CARDS = [
  // 第 1 行
  { id: 'h_aim', pos: [0, 0], cat: 'head', icon: '⌖', name: '准星校准', cost: 1, unlock: 0, vals: [0.5, 0.75, 1, 1.25], desc: '爆头伤害 +{v}。' },
  { id: 'h_pierce', pos: [0, 1], cat: 'head', icon: '⇶', name: '穿颅', cost: 2, unlock: 120, unlocks: ['pierce'], vals: [50, 70, 90, 120], fmt: pct,
    desc: '三选一中爆头流强化的出现权重 +{v}。', unlockText: '解锁即让核心「穿颅弹」进入奖池' },
  { id: 'w_full', pos: [0, 2], cat: 'wake', icon: '◉', name: '满盘', cost: 0, unlock: 90, coresToUnlock: 1, wake: 'full', vals: [2, 4, 6, 8],
    desc: '每波开始护盾补到 1 层，并回复 {v} 生命。', needText: '装备的总消耗恰好等于心力上限（一点不剩）' },
  { id: 's_heat', pos: [0, 3], cat: 'spray', icon: '♨', name: '过热', cost: 2, unlock: 120, unlocks: ['overheat'], vals: [50, 70, 90, 120], fmt: pct,
    desc: '三选一中扫射流强化的出现权重 +{v}。', unlockText: '解锁即让核心「过热枪管」及其配套进入奖池' },
  { id: 's_mag', pos: [0, 4], cat: 'spray', icon: '▥', name: '扩容', cost: 1, unlock: 0, vals: [2, 3, 4, 5], desc: '弹匣 +{v}。' },
  // 第 2 行
  { id: 'h_badge', pos: [1, 0], cat: 'head', icon: '🎯', name: '猎手徽记', cost: 4, unlock: 180, opening: true, vals: [3, 4, 5, 6], desc: '开局额外一次「爆头流 {v} 选一」。' },
  { id: 'v_body', pos: [1, 1], cat: 'tol', icon: '♥', name: '强健体魄', cost: 1, unlock: 0, vals: [15, 20, 25, 30], desc: '生命上限 +{v}。' },
  { id: 'v_shield', pos: [1, 2], cat: 'tol', icon: '◈', name: '护盾发生器', cost: 2, unlock: 70, vals: [1, 2, 2, 3], desc: '开局获得 {v} 层护盾。' },
  { id: 'v_aid', pos: [1, 3], cat: 'tol', icon: '✚', name: '战地急救', cost: 2, unlock: 90, vals: [6, 8, 10, 12], desc: '每波结束回复 {v} 生命。' },
  { id: 's_badge', pos: [1, 4], cat: 'spray', icon: '🥁', name: '弹药大师', cost: 4, unlock: 180, opening: true, vals: [3, 4, 5, 6], desc: '开局额外一次「扫射流 {v} 选一」。' },
  // 第 3 行
  { id: 'h_flick', pos: [2, 0], cat: 'head', icon: '↯', name: '甩枪', cost: 3, unlock: 150, unlocks: ['flickmaster', 'hawkeye'], vals: [25, 40, 55, 70], fmt: pct,
    desc: '一枪击杀的目标，金币 +{v}。', unlockText: '解锁即让核心「甩枪大师」和「鹰眼弹」进入奖池' },
  { id: 'e_stake', pos: [2, 1], cat: 'econ', icon: '●', name: '随身盘缠', cost: 1, unlock: 60, vals: [25, 40, 55, 70], desc: '开局携带 {v} 金币。' },
  { id: 'w_few', pos: [2, 2], cat: 'wake', icon: '☍', name: '独行', cost: 0, unlock: 180, coresToUnlock: 1, wake: 'few', vals: [1, 2, 2, 3],
    desc: '每打完一个区域（第 5、10、15 波），随机激活 {v} 张已解锁但没装备的卡，本局有效。', needText: '装备的卡不超过 4 张' },
  { id: 'e_fate', pos: [2, 3], cat: 'econ', icon: '🎲', name: '命运之手', cost: 2, unlock: 90, vals: [1, 2, 2, 3], desc: '开局多 {v} 个命运骰。' },
  { id: 's_suppress', pos: [2, 4], cat: 'spray', icon: '⊗', name: '压制', cost: 3, unlock: 150, unlocks: ['suppress'], vals: [12, 15, 18, 22], fmt: pct,
    desc: '换弹时间 −{v}。', unlockText: '解锁即让核心「压制火力」进入奖池' },
  // 第 4 行
  { id: 't_badge', pos: [3, 0], cat: 'time', icon: '⏳', name: '时之沙', cost: 4, unlock: 180, opening: true, vals: [3, 4, 5, 6], desc: '开局额外一次「子弹时间流 {v} 选一」。' },
  { id: 'v_death', pos: [3, 1], cat: 'tol', icon: '✺', name: '死亡抗拒', cost: 4, unlock: 150, vals: [30, 40, 50, 60], fmt: pct,
    desc: '每局一次：受到致命伤害时不会死，生命回复到 {v}。' },
  { id: 'e_supply', pos: [3, 2], cat: 'econ', icon: '✧', name: '开局补给', cost: 3, unlock: 160, opening: true, vals: [3, 4, 5, 6], desc: '开局额外一次「{v} 选一」强化。' },
  { id: 'v_grit', pos: [3, 3], cat: 'tol', icon: '⛨', name: '背水', cost: 4, unlock: 180, vals: [30, 35, 40, 50], fmt: pct, desc: '生命低于 40% 时，受到的伤害 −{v}。' },
  { id: 'e_star', pos: [3, 4], cat: 'econ', icon: '✦', name: '星图', cost: 3, unlock: 120, unlocks: ['starmap', 'bloodpact'], vals: [20, 30, 40, 50], fmt: pct,
    desc: '商店星尘兑换量 +{v}。', unlockText: '解锁即让「星图」「血色契约」进入奖池' },
  // 第 5 行
  { id: 't_flow', pos: [4, 0], cat: 'time', icon: '◑', name: '心流', cost: 1, unlock: 0, vals: [15, 20, 25, 30], fmt: pct, desc: '专注充能 +{v}。' },
  { id: 't_stasis', pos: [4, 1], cat: 'time', icon: '⏸', name: '时停', cost: 2, unlock: 120, unlocks: ['stasis'], vals: [50, 70, 90, 120], fmt: pct,
    desc: '三选一中子弹时间流强化的出现权重 +{v}。', unlockText: '解锁即让核心「时停」进入奖池' },
  { id: 'w_rank', pos: [4, 2], cat: 'wake', icon: '♛', name: '巅峰', cost: 0, unlock: 120, coresToUnlock: 1, wake: 'rank', vals: [10, 15, 20, 25], fmt: pct,
    desc: '此后本局击杀金币 +{v}，评级掉到 A 以下时立刻回到 A。（每波一次）', needText: '局内火力评级第一次达到 S' },
  { id: 't_debt', pos: [4, 3], cat: 'time', icon: '⧖', name: '时间债', cost: 3, unlock: 150, unlocks: ['timedebt'], vals: [0.5, 0.6, 0.8, 1], fmt: (v) => `${v} 秒`,
    desc: '子弹时间 +{v}。', unlockText: '解锁即让核心「时间债」进入奖池' },
  { id: 'w_star', pos: [4, 4], cat: 'wake', icon: '✶', name: '群星', cost: 0, unlock: 150, coresToUnlock: 1, wake: 'all', vals: [10, 15, 20, 25], fmt: pct,
    desc: '结算星尘 +{v}，开局多 1 个命运骰。', needText: '装备的卡覆盖全部五类（宽容 / 爆头 / 扫射 / 子弹时间 / 经济）' },
];

export const cardValue = (card, lv) => card.vals[Math.max(0, Math.min(card.vals.length, lv) - 1)];
export const cardText = (card, v) => card.desc.replace('{v}', (card.fmt || String)(v));

// 遗物：每局开局选 1 个带进去。cost 为 0 表示默认拥有。
export const KEEPSAKES = [
  { id: 'hunter', school: 'head', icon: '🎯', name: '猎手徽章', cost: 0, desc: '爆头倍率 +0.25；第一次三选一保底 1 个爆头流强化。' },
  { id: 'drum', school: 'spray', icon: '🥁', name: '旧弹鼓', cost: 0, desc: '弹匣 +3；第一次三选一保底 1 个扫射流强化。' },
  { id: 'watch', school: 'time', icon: '⌚', name: '怀表', cost: 0, desc: '每波开始专注 +30%；第一次三选一保底 1 个子弹时间流强化。' },
  { id: 'prism', school: null, icon: '🔺', name: '三棱镜', cost: 150, desc: '三选一的三个选项必定来自三个不同类别（爆头 / 扫射 / 子弹时间 / 基础），不受流派倾向影响。' },
  { id: 'blank', school: null, icon: '⬜', name: '空白徽章', cost: 120, desc: '没有效果；结算星尘 +25%。' },
];

// 旧版星尘工坊和遗物等级的价格，只用于把旧存档的花费退还成星尘
export const LEGACY_REFUND = {
  upgrades: { vitality: [120, 240, 420], shield: [180, 360], stake: [150, 300], extraChoice: [270], fates: [150, 300],
    unlock_pierce: [200], unlock_flickmaster: [250], unlock_overheat: [200], unlock_suppress: [250], unlock_stasis: [200],
    unlock_timedebt: [250], unlock_hawkeye: [150], unlock_starmap: [180], unlock_bloodpact: [210] },
  keepsakes: { hunter: [0, 200, 300], drum: [0, 200, 300], watch: [0, 200, 300], prism: [250], blank: [200] },
};
