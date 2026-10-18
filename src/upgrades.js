// 强化（局内）定义。效果在 run.js / game.js 中按 id 生效，这里只放数据。
// cat: base 基础（可升 3 级） / school 流派 / core 核心 / general 通用 / econ 经济（只在商店）
// school: head 爆头 / spray 扫射 / time 子弹时间
// locked: 需要在命盘里解锁对应的卡牌；requires: 只有持有该强化后才会出现

export const SCHOOLS = {
  head: { name: '爆头流', color: '#ff9e00' },
  spray: { name: '扫射流', color: '#4cc9f0' },
  time: { name: '子弹时间流', color: '#c77dff' },
};

export const CAT_LABEL = { base: '基础', school: '流派', core: '核心', general: '通用', econ: '经济' };

// 三个流派的定位（伤害模型：身体 2、爆头 ×1.5；普通兵 6 血、冲锋兵 3 血、重甲兵 30 血）：
//   爆头流 = 单发伤害：抬高爆头倍率，奖励一枪击杀，连续爆头击杀
//   扫射流 = 持续伤害：射速、弹匣、按「持续开火时间」叠加的增益、破甲；打空不会打断任何增益
//   子弹时间流 = 爆发窗口：在子弹时间里集中输出
export const UPGRADES = {
  // ---------------- 基础强化（白，最多 3 级） ----------------
  vigor: { cat: 'base', icon: '♥', name: '体魄', desc: '生命上限 +10，并回复 10 生命。', per: '生命上限 +10' },
  mag: { cat: 'base', icon: '▥', name: '弹匣', desc: '弹匣容量 +2。', per: '弹匣 +2' },
  quick: { cat: 'base', icon: '⟳', name: '快手', desc: '换弹时间 −8%。', per: '换弹 −8%' },
  trigger: { cat: 'base', icon: '⌁', name: '扳机', desc: '射速 +5%。', per: '射速 +5%' },
  caliber: { cat: 'base', icon: '⬣', name: '口径', desc: '所有子弹伤害 +8%。', per: '伤害 +8%' },
  flow: { cat: 'base', icon: '◑', name: '心流', desc: '专注充能 +15%。', per: '专注充能 +15%' },
  fortune: { cat: 'base', icon: '●', name: '财运', desc: '击杀金币 +8%。', per: '金币 +8%' },
  guard: { cat: 'base', icon: '◈', name: '护盾', desc: '每波开始把护盾补到等级数（1 级 = 1 层）。', per: '每波护盾补到 +1 层' },
  bandage: { cat: 'base', icon: '✚', name: '包扎', desc: '每波结束回复 5 生命。', per: '每波回复 +5' },

  // ---------------- 爆头流：单发伤害 ----------------
  // ① 处决：把爆头推到一枪击杀
  guillotine: { cat: 'core', school: 'head', set: '处决', icon: '⚔', name: '断头台',
    desc: '爆头倍率 ×1.5 → ×3（一枪爆头带走普通兵）；身体伤害 −50%。' },
  precision: { cat: 'school', school: 'head', set: '处决', icon: '⌖', name: '精确打击', desc: '爆头倍率 +0.75。' },
  lethal: { cat: 'school', school: 'head', set: '处决', icon: '✜', name: '致命精度', desc: '爆头伤害 +1.5。' },
  onetap: { cat: 'school', school: 'head', set: '处决', icon: '⤴', name: '一击回收', desc: '爆头击杀返还 1 发子弹；一枪打死满血目标返还 3 发。' },
  bounty: { cat: 'school', school: 'head', set: '处决', icon: '💰', name: '斩首赏金', desc: '爆头击杀基础金币 +1；一枪打死满血目标再 +2。' },
  // ② 连锁：一发子弹打多个目标
  momentum: { cat: 'core', school: 'head', set: '连锁', icon: '⇶', name: '处决势头', locked: true,
    desc: '爆头击杀后 1.5 秒内，下一发爆头伤害 ×2；用它再爆头击杀可以一直连下去。' },
  headblast: { cat: 'school', school: 'head', set: '连锁', icon: '✸', name: '爆头震爆', desc: '爆头时 3 米内其他敌人受 2 点伤害。' },
  execchain: { cat: 'school', school: 'head', set: '连锁', icon: '⛓', name: '处刑链', desc: '1 秒内连续爆头不同目标，每次 +1 伤害（最多 +3）；同一目标或超时重置。' },
  aftershock: { cat: 'school', school: 'head', set: '连锁', icon: '≋', name: '余震', desc: '震爆、灼烧造成的伤害 +50%。' },
  // ③ 甩枪：转身瞬间的那一枪
  flickmaster: { cat: 'core', school: 'head', set: '甩枪', icon: '↯', name: '甩枪大师', locked: true,
    desc: '开枪前 0.4 秒内转身 ≥ 60° 时（准星变金），这一枪若爆头：伤害 ×2，并返还 2 发子弹。' },
  hawkeye: { cat: 'school', school: 'head', set: '甩枪', icon: '◉', name: '鹰眼弹', locked: true, desc: '对 15 米外的目标，爆头伤害 +50%。' },
  glance: { cat: 'school', school: 'head', set: '甩枪', icon: '↶', name: '回眸', desc: '爆头击杀 1 秒前还在视野外的目标，金币 ×2。' },
  calm: { cat: 'school', school: 'head', set: '甩枪', icon: '☯', name: '静心', desc: '停火 ≥ 0.5 秒后的第一枪伤害 ×2。' },
  chainhead: { cat: 'school', school: 'head', set: '甩枪', icon: '➶', name: '连环爆头', desc: '连续爆头每次射速 +8%，最多 4 层；非爆头或打空清零。' },

  // ---------------- 扫射流：持续伤害 ----------------
  // 「持续开火」= 按住左键且枪在出膛；换弹或松手 0.4 秒后中断。打空不会中断。
  // ① 过热
  overheat: { cat: 'core', school: 'spray', set: '过热', icon: '♨', name: '过热枪管', locked: true,
    desc: '持续开火积累热度（2 秒满 20 层，每层伤害 +3%）；停火 0.5 秒后每秒 −8 层。满热时命中附带灼烧（2 秒内共 4 点伤害）。' },
  heatsink: { cat: 'school', school: 'spray', set: '过热', icon: '❆', name: '散热片', requires: 'overheat', desc: '换弹时热度不衰减，停火衰减减半。' },
  molten: { cat: 'school', school: 'spray', set: '过热', icon: '☄', name: '熔融弹', requires: 'overheat', desc: '满热击杀时，灼烧扩散到 4 米内最近的 1 个敌人。' },
  coolant: { cat: 'school', school: 'spray', set: '过热', icon: '💧', name: '冷却液', requires: 'overheat', desc: '满热时换弹瞬间完成，热度只 −10 层。' },
  // ② 弹幕
  drum: { cat: 'core', school: 'spray', set: '弹幕', icon: '◎', name: '弹鼓', desc: '弹匣 10 → 24（「弹匣」强化照常叠加），换弹 1.6 → 3.2 秒。' },
  beltfeed: { cat: 'school', school: 'spray', set: '弹幕', icon: '⫶', name: '弹链', desc: '持续开火每 0.4 秒返还 1 发子弹。' },
  spinup: { cat: 'school', school: 'spray', set: '弹幕', icon: '⟲', name: '预热', desc: '持续开火每 0.5 秒射速 +8%，最多 +40%。' },
  rapid: { cat: 'school', school: 'spray', set: '弹幕', icon: '⋙', name: '连射', desc: '射速 +15%。' },
  hollow: { cat: 'school', school: 'spray', set: '弹幕', icon: '⬤', name: '空尖弹', desc: '打身体的伤害 +50%（3 发身体 → 2 发带走普通兵）。' },
  tacreload: { cat: 'school', school: 'spray', set: '弹幕', icon: '⇄', name: '战术换弹', desc: '剩余 ≥ 50% 时按 R 换弹瞬间完成；弹匣打空后的换弹时间 ×2。' },
  // ③ 压制
  suppress: { cat: 'core', school: 'spray', set: '压制', icon: '⊗', name: '压制火力', locked: true,
    desc: '每命中一个目标让它减速 8%（最多 40%）；它 1 秒没被命中就恢复。打空不影响。' },
  rend: { cat: 'school', school: 'spray', set: '压制', icon: '⫽', name: '撕裂', desc: '每个目标被命中的第 3、6、9……发，伤害 ×2.5。' },
  shred: { cat: 'school', school: 'spray', set: '压制', icon: '⛏', name: '碎甲', desc: '被命中 ≥ 2 次的目标受到的伤害 +1；对重甲兵伤害 +50%。' },
  trackshield: { cat: 'school', school: 'spray', set: '压制', icon: '⛉', name: '跟枪护盾', desc: '本波持续开火累计 4 秒，获得 1 层护盾（每波一次，打空也算）。' },
  adrenaline: { cat: 'school', school: 'spray', set: '压制', icon: '♨', name: '肾上腺素', desc: '持续开火每 1 秒回复 1 生命（每波最多回复 12）。' },

  // ---------------- 子弹时间流：爆发窗口 ----------------
  // ① 时停
  stasis: { cat: 'core', school: 'time', set: '时停', icon: '⏸', name: '时停', locked: true,
    desc: '子弹时间变为 1.2 秒，敌人完全静止。其他强化的时长加成只按一半生效。' },
  freezeframe: { cat: 'school', school: 'time', set: '时停', icon: '▣', name: '定格', desc: '子弹时间中所有伤害 +40%。' },
  timebank: { cat: 'school', school: 'time', set: '时停', icon: '⏳', name: '时间余量', desc: '子弹时间中每造成 10 点伤害，时长 +0.15 秒（每次最多 +1.5 秒）。' },
  nowaste: { cat: 'school', school: 'time', set: '时停', icon: '⇉', name: '零损耗', desc: '子弹时间中，打空的子弹不消耗弹药。' },
  chill: { cat: 'school', school: 'time', set: '时停', icon: '❄', name: '冻结弹', desc: '子弹时间中被命中的敌人，本次子弹时间内移动速度再 −50%。' },
  // ② 续杯
  afterglow: { cat: 'core', school: 'time', set: '续杯', icon: '☀', name: '余韵', desc: '子弹时间中每次击杀，时长 +0.25 秒（每次最多 +2 秒）。' },
  focuslens: { cat: 'school', school: 'time', set: '续杯', icon: '◐', name: '专注透镜', desc: '专注充能 +40%，子弹时间 +0.5 秒。' },
  harvest: { cat: 'school', school: 'time', set: '续杯', icon: '⚘', name: '时之收割', desc: '子弹时间中的击杀，金币 ×1.5。' },
  timeslit: { cat: 'school', school: 'time', set: '续杯', icon: '⧗', name: '时间缝隙', desc: '子弹时间中换弹瞬间完成。' },
  reloadmoment: { cat: 'school', school: 'time', set: '续杯', icon: '▤', name: '装填时刻', desc: '释放子弹时间时，弹匣立刻装满（正在换弹也直接完成）。' },
  // ③ 高频
  blink: { cat: 'core', school: 'time', set: '高频', icon: '⧖', name: '瞬时', locked: true,
    desc: '专注分成 4 格：每攒满 1 格就能释放 1 秒子弹时间，子弹时间中可以继续释放来延长。' },
  fragment: { cat: 'school', school: 'time', set: '高频', icon: '◔', name: '碎片化', desc: '子弹时间时长减半，充满专注所需点数也减半。' },
  timeblade: { cat: 'school', school: 'time', set: '高频', icon: '↝', name: '时之刃', desc: '子弹时间中爆头伤害 +50%。' },
  overclock: { cat: 'school', school: 'time', set: '高频', icon: '⚡', name: '加速世界', desc: '子弹时间中射速 +30%。' },

  // ---------------- 通用 ----------------
  recoilarmor: { cat: 'general', icon: '⛨', name: '反冲护甲', desc: '被碰到时，将 8 米内所有敌人击退 6 米。' },
  emergency: { cat: 'general', icon: '⚿', name: '应急护盾', desc: '每波第一次生命降到 40% 以下时，获得 2 层护盾。' },
  bountyhunter: { cat: 'general', icon: '◎', name: '赏金猎人', desc: '击杀重甲兵金币 ×2，击破 Boss 金币 +50%。' },
  bloodpact: { cat: 'general', icon: '☠', name: '血色契约', locked: true, curse: true, desc: '【诅咒】敌人移动速度 +20%，但击杀金币 +40%。' },

  // ---------------- 经济（只在商店） ----------------
  membercard: { cat: 'econ', icon: '▤', name: '会员卡', desc: '商店中强化价格 −20%。' },
  clinic: { cat: 'econ', icon: '✚', name: '平价诊所', desc: '回血价格不再上涨，每次回血量 +10。' },
  starmap: { cat: 'econ', icon: '✦', name: '星图', locked: true, desc: '商店星尘兑换量 +30%。' },
};

export const BASE_MAX_LEVEL = 3;

export const isCore = (id) => UPGRADES[id].cat === 'core';
