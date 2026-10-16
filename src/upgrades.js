// 强化（局内）定义。效果在 run.js / game.js 中按 id 生效，这里只放数据。
// cat: base 基础（可升 3 级） / school 流派 / core 核心 / general 通用 / econ 经济（只在商店）
// school: head 爆头 / spray 扫射 / time 子弹时间
// locked: 需要在星尘工坊解锁；requires: 只有持有该强化后才会出现

export const SCHOOLS = {
  head: { name: '爆头流', color: '#ff9e00' },
  spray: { name: '扫射流', color: '#4cc9f0' },
  time: { name: '子弹时间流', color: '#c77dff' },
};

export const CAT_LABEL = { base: '基础', school: '流派', core: '核心', general: '通用', econ: '经济' };

export const UPGRADES = {
  // ---------------- 基础强化（白，最多 3 级） ----------------
  vigor: { cat: 'base', icon: '♥', name: '体魄', desc: '生命上限 +10，并回复 10 生命。', per: '生命上限 +10' },
  mag: { cat: 'base', icon: '▥', name: '弹匣', desc: '弹匣容量 +2。', per: '弹匣 +2' },
  quick: { cat: 'base', icon: '⟳', name: '快手', desc: '换弹时间 −8%。', per: '换弹 −8%' },
  trigger: { cat: 'base', icon: '⌁', name: '扳机', desc: '射速 +5%。', per: '射速 +5%' },
  flow: { cat: 'base', icon: '◑', name: '心流', desc: '专注充能 +15%。', per: '专注充能 +15%' },
  fortune: { cat: 'base', icon: '●', name: '财运', desc: '击杀金币 +8%。', per: '金币 +8%' },
  guard: { cat: 'base', icon: '◈', name: '护盾', desc: '每波开始把护盾补到等级数（1 级 = 1 层）。', per: '每波护盾补到 +1 层' },
  bandage: { cat: 'base', icon: '✚', name: '包扎', desc: '每波结束回复 5 生命。', per: '每波回复 +5' },

  // ---------------- 爆头流 ----------------
  // ① 处决
  guillotine: { cat: 'core', school: 'head', set: '处决', icon: '⚔', name: '断头台',
    desc: '爆头倍率 ×2 → ×4。打身体 0 伤害，但仍算命中（加连杀、充专注、不断连）。' },
  onetap: { cat: 'school', school: 'head', set: '处决', icon: '⤴', name: '一击回收', desc: '满血目标被一枪打死时，返还 2 发子弹。' },
  bounty: { cat: 'school', school: 'head', set: '处决', icon: '💰', name: '斩首赏金', desc: '一枪击杀的目标，基础金币 +2。' },
  lethal: { cat: 'school', school: 'head', set: '处决', icon: '✜', name: '致命精度', desc: '爆头最终伤害 +1。' },
  chainhead: { cat: 'school', school: 'head', set: '处决', icon: '➶', name: '连环爆头', desc: '连续爆头每次射速 +8%，最多 4 层；非爆头或打空清零。' },
  // ② 连锁
  pierce: { cat: 'core', school: 'head', set: '连锁', icon: '⇶', name: '穿颅弹', locked: true,
    desc: '爆头后子弹继续飞，最多再穿 2 个目标（伤害 ×0.75）；穿透再爆头可以继续穿。' },
  headblast: { cat: 'school', school: 'head', set: '连锁', icon: '✸', name: '爆头震爆', desc: '爆头时 3 米内其他敌人受 1 点伤害。' },
  execchain: { cat: 'school', school: 'head', set: '连锁', icon: '⛓', name: '处刑链', desc: '1 秒内连续爆头不同目标，每次 +1 伤害（最多 +3）；同一目标或超时重置。' },
  aftershock: { cat: 'school', school: 'head', set: '连锁', icon: '≋', name: '余震', desc: '爆炸、穿透、灼烧造成的击杀，按爆头击杀给连杀（+2）。' },
  // ③ 甩枪
  flickmaster: { cat: 'core', school: 'head', set: '甩枪', icon: '↯', name: '甩枪大师', locked: true,
    desc: '开枪前 0.4 秒内转身 ≥ 60° 时（准星变金），这一枪若爆头：伤害 ×3、连杀 +3。' },
  hawkeye: { cat: 'school', school: 'head', set: '甩枪', icon: '◉', name: '鹰眼弹', locked: true, desc: '爆头额外 +1 连杀。' },
  glance: { cat: 'school', school: 'head', set: '甩枪', icon: '↶', name: '回眸', desc: '爆头击杀 1 秒前还在视野外的目标，金币 ×2。' },
  calm: { cat: 'school', school: 'head', set: '甩枪', icon: '☯', name: '静心', desc: '停火 ≥ 0.5 秒后的第一枪伤害 ×2。' },

  // ---------------- 扫射流 ----------------
  // ① 过热
  overheat: { cat: 'core', school: 'spray', set: '过热', icon: '♨', name: '过热枪管', locked: true,
    desc: '命中积累热度（最多 20 层，每层伤害 +4%）；打空 −5 层，停火 1 秒后每秒 −4 层。满层时命中附带灼烧（2 秒内共 4 点伤害）。' },
  heatsink: { cat: 'school', school: 'spray', set: '过热', icon: '❆', name: '散热片', requires: 'overheat', desc: '换弹和停火时热度不衰减。' },
  molten: { cat: 'school', school: 'spray', set: '过热', icon: '☄', name: '熔融弹', requires: 'overheat', desc: '满热击杀时，灼烧扩散到 4 米内最近的 1 个敌人。' },
  coolant: { cat: 'school', school: 'spray', set: '过热', icon: '💧', name: '冷却液', requires: 'overheat', desc: '满热时换弹瞬间完成，但热度清零。' },
  // ② 弹幕
  drum: { cat: 'core', school: 'spray', set: '弹幕', icon: '◎', name: '弹鼓', desc: '弹匣 10 → 24（「弹匣」强化照常叠加），换弹 1.6 → 3.2 秒。' },
  beltfeed: { cat: 'school', school: 'spray', set: '弹幕', icon: '⫶', name: '弹链', desc: '每连续命中 6 次，返还 1 发子弹。' },
  tacreload: { cat: 'school', school: 'spray', set: '弹幕', icon: '⇄', name: '战术换弹', desc: '剩余 ≥ 50% 时按 R 换弹瞬间完成；弹匣打空后的换弹时间 ×2。' },
  rapid: { cat: 'school', school: 'spray', set: '弹幕', icon: '⋙', name: '连射', desc: '射速 +10%。' },
  gambler: { cat: 'school', school: 'spray', set: '弹幕', icon: '🎲', name: '赌徒之心', desc: '打空时连杀减半而不是清零；但每次命中的连杀增长减半。' },
  // ③ 压制
  suppress: { cat: 'core', school: 'spray', set: '压制', icon: '⊗', name: '压制火力', locked: true,
    desc: '连续命中同一目标，每发让它减速 8%（最多 40%）；1 秒没命中它就恢复。' },
  rend: { cat: 'school', school: 'spray', set: '压制', icon: '⫽', name: '撕裂', desc: '对同一目标的第 4、8、12……次连续命中，伤害 ×3。' },
  shred: { cat: 'school', school: 'spray', set: '压制', icon: '⛏', name: '碎甲', desc: '重甲兵被命中 3 次后，受到的所有伤害 +1。' },
  trackshield: { cat: 'school', school: 'spray', set: '压制', icon: '⛉', name: '跟枪护盾', desc: '连续命中同一目标累计 2 秒，获得 1 层护盾（每波一次）。' },

  // ---------------- 子弹时间流 ----------------
  // ① 时停
  stasis: { cat: 'core', school: 'time', set: '时停', icon: '⏸', name: '时停', locked: true,
    desc: '子弹时间变为 1.2 秒，敌人完全静止。其他强化的时长加成只按一半生效。' },
  freezeframe: { cat: 'school', school: 'time', set: '时停', icon: '▣', name: '定格', desc: '子弹时间中的击杀额外 +3 连杀。' },
  timebank: { cat: 'school', school: 'time', set: '时停', icon: '⏳', name: '时间余量', desc: '子弹时间中每次爆头，时长 +0.15 秒（每次最多 +1.5 秒）。' },
  stasisround: { cat: 'school', school: 'time', set: '时停', icon: '❄', name: '凝滞弹', desc: '子弹时间中被命中过的敌人，结束后额外减速 50% 1 秒。' },
  // ② 续杯
  afterglow: { cat: 'core', school: 'time', set: '续杯', icon: '☀', name: '余韵', desc: '子弹时间中每次击杀，时长 +0.25 秒（每次最多 +2 秒）。' },
  focuslens: { cat: 'school', school: 'time', set: '续杯', icon: '◐', name: '专注透镜', desc: '专注充能 +30%，子弹时间 +0.5 秒。' },
  echo: { cat: 'school', school: 'time', set: '续杯', icon: '〰', name: '回响', desc: '一次子弹时间内击杀 ≥ 4 个，结束后返还 25% 专注。' },
  timeslit: { cat: 'school', school: 'time', set: '续杯', icon: '⧗', name: '时间缝隙', desc: '子弹时间中换弹瞬间完成。' },
  // ③ 高频
  timedebt: { cat: 'core', school: 'time', set: '高频', icon: '⧖', name: '时间债', locked: true,
    desc: '专注 ≥ 25% 即可释放，时长按专注比例；结束后敌人以 1.5 倍速移动，持续时间与本次子弹时间相同。' },
  fragment: { cat: 'school', school: 'time', set: '高频', icon: '◔', name: '碎片化', desc: '子弹时间时长减半，充满专注所需点数也减半。' },
  inertia: { cat: 'school', school: 'time', set: '高频', icon: '↝', name: '惯性', desc: '子弹时间结束后，敌人用 1.2 秒慢慢恢复速度（原本 0.2 秒）。' },
  overclock: { cat: 'school', school: 'time', set: '高频', icon: '⚡', name: '加速世界', desc: '子弹时间中射速 +20%。' },

  // ---------------- 通用 ----------------
  recoilarmor: { cat: 'general', icon: '⛨', name: '反冲护甲', desc: '被碰到时，将 8 米内所有敌人击退 6 米。' },
  safety: { cat: 'general', icon: '⚿', name: '保险栓', desc: '每波第一次打空不会清零连杀。' },
  greedsight: { cat: 'general', icon: '◎', name: '贪婪准星', desc: '倍率 ≥ 3.0x 时，击杀金币 +50%。' },
  bloodpact: { cat: 'general', icon: '☠', name: '血色契约', locked: true, curse: true, desc: '【诅咒】敌人移动速度 +20%，但击杀金币 +40%。' },

  // ---------------- 经济（只在商店） ----------------
  membercard: { cat: 'econ', icon: '▤', name: '会员卡', desc: '商店中强化价格 −20%。' },
  clinic: { cat: 'econ', icon: '✚', name: '平价诊所', desc: '回血价格不再上涨，每次回血量 +10。' },
  starmap: { cat: 'econ', icon: '✦', name: '星图', locked: true, desc: '商店星尘兑换量 +30%。' },
};

export const BASE_MAX_LEVEL = 3;

export const isCore = (id) => UPGRADES[id].cat === 'core';
