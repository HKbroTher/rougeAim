// 遗物 = 局内强化。设计方向：奖励精准，而不是替玩家瞄准。
// 钩子由 game.js 在对应时机调用；纯数值修正通过 run.mods 读取。

export const RELICS = {
  headblast: {
    name: '爆头震爆', rarity: 'common', icon: '✸',
    desc: '爆头时在目标周围 3 米产生爆炸，对其他敌人造成 1 点伤害。',
  },
  chainhead: {
    name: '连环爆头', rarity: 'common', icon: '➶',
    desc: '连续爆头每次提升 12% 射速，最多 4 层；非爆头或打空清零。',
  },
  frostkill: {
    name: '冰霜之触', rarity: 'common', icon: '❄',
    desc: '击杀时使 5 米内敌人减速 50%，持续 2 秒。',
  },
  recoilarmor: {
    name: '反冲护甲', rarity: 'common', icon: '⛨',
    desc: '被碰到时，将 8 米内所有敌人击退 6 米。',
  },
  waveshield: {
    name: '波次护盾', rarity: 'common', icon: '◈',
    desc: '每波开始时获得 1 层护盾（抵挡一次碰撞）。',
  },
  greedsight: {
    name: '贪婪准星', rarity: 'rare', icon: '◎',
    desc: '倍率 ≥ 3.0x 时，击杀掉落金币 +50%。',
  },
  focuslens: {
    name: '专注透镜', rarity: 'common', icon: '◐',
    desc: '专注充能速度 +50%，持续时间 +1 秒。',
  },
  safety: {
    name: '保险栓', rarity: 'rare', icon: '⚿',
    desc: '每波第一次打空不会清零连杀。',
  },
  membercard: {
    name: '会员卡', rarity: 'common', icon: '▤', econ: true,
    desc: '商店中遗物价格 -20%。',
  },
  clinic: {
    name: '平价诊所', rarity: 'common', icon: '✚', econ: true,
    desc: '回血价格不再上涨，每次回血量 +10。',
  },
  // 以下需要在星尘工坊解锁
  hawkeye: {
    name: '鹰眼弹', rarity: 'rare', icon: '◉', locked: true,
    desc: '爆头额外 +1 连杀（共 +3）。',
  },
  starmap: {
    name: '星图', rarity: 'common', icon: '✦', locked: true, econ: true,
    desc: '商店星尘兑换量 +30%。',
  },
  bloodpact: {
    name: '血色契约', rarity: 'rare', icon: '☠', locked: true, curse: true,
    desc: '【诅咒】敌人移动速度 +20%，但击杀金币 +40%。',
  },
};

export function relicPool(unlocked, owned) {
  return Object.keys(RELICS).filter(
    (id) => !owned.includes(id) && (!RELICS[id].locked || unlocked.includes(id)),
  );
}

// 稀有遗物权重较低
export function pickRelics(pool, n, rng = Math.random) {
  const bag = pool.map((id) => ({ id, w: RELICS[id].rarity === 'rare' ? 1 : 2.2 }));
  const out = [];
  while (out.length < n && bag.length) {
    const total = bag.reduce((s, b) => s + b.w, 0);
    let r = rng() * total;
    let i = 0;
    for (; i < bag.length - 1; i++) {
      r -= bag[i].w;
      if (r <= 0) break;
    }
    out.push(bag[i].id);
    bag.splice(i, 1);
  }
  return out;
}
