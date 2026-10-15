// 模拟真人瞄准（仅 ?debug 下用于平衡测试，正式玩法中不存在）。
// 它看到的是 reaction 秒之前的目标位置，按有限速度转身，手有抖动，只部分会提前量，
// 所以对移动目标会自然地打空。用它跑同一条难度曲线，比满精准自动测试更接近真人。
import * as THREE from '../vendor/three.module.min.js';
import * as R from './run.js';

export const SKILLS = {
  // reaction 反应(s)、gain 转身收敛速度、maxTurn 最大转速(rad/s)、noise 手抖(rad)、
  // lead 提前量比例、headAim 瞄头概率、trigger 开枪容差（>1 = 还没对准就急着开枪）
  novice:  { reaction: 0.34, gain: 5, maxTurn: 5, noise: 0.012, lead: 0.1, headAim: 0.35, trigger: 1.7 },
  average: { reaction: 0.26, gain: 8, maxTurn: 9, noise: 0.007, lead: 0.4, headAim: 0.6, trigger: 1.25 },
  expert:  { reaction: 0.19, gain: 12, maxTurn: 14, noise: 0.004, lead: 0.75, headAim: 0.9, trigger: 0.9 },
};

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const gauss = () => {
  let u = 0;
  let v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

export class SimAimer {
  constructor(game, skill) {
    this.game = game;
    this.k = skill;
    this.t = 0;
    this.hist = new Map(); // bot.id -> [{t, head, chest}]
    this.target = null;
    this.aimHead = true;
    this.acquire = 0;
    this.yaw = game.yaw;
    this.pitch = game.pitch;
    this.eye = new THREE.Vector3(0, 1.6, 0);
  }

  record() {
    const live = new Set();
    for (const b of this.game.bots) {
      if (b.dead) continue;
      live.add(b.id);
      let h = this.hist.get(b.id);
      if (!h) this.hist.set(b.id, (h = []));
      const head = b.headWorld;
      const chest = b.position.clone().setY(b.position.y + b.bodyH * 0.6);
      h.push({ t: this.t, head, chest });
      while (h.length > 2 && h[1].t < this.t - this.k.reaction - 0.25) h.shift();
    }
    for (const id of this.hist.keys()) if (!live.has(id)) this.hist.delete(id);
  }

  // 反应延迟后看到的位置，再加上部分提前量
  perceived(bot) {
    const h = this.hist.get(bot.id);
    if (!h || !h.length) return null;
    const key = this.aimHead ? 'head' : 'chest';
    const tSeen = this.t - this.k.reaction;
    let a = h[0];
    for (const s of h) { if (s.t <= tSeen) a = s; else break; }
    const p = a[key].clone();
    const prev = h.find((s) => s.t >= a.t - 0.12) || h[0];
    const dt = a.t - prev.t;
    if (dt > 0.02) {
      const vel = a[key].clone().sub(prev[key]).divideScalar(dt);
      p.addScaledVector(vel, this.k.reaction * this.k.lead);
    }
    return p;
  }

  pickTarget() {
    let best = null;
    let bestScore = Infinity;
    const fwdYaw = this.yaw;
    for (const b of this.game.bots) {
      if (b.dead || !this.hist.has(b.id)) continue;
      const p = b.position;
      const ang = Math.abs(wrap(Math.atan2(-p.x, -p.z) - fwdYaw));
      const score = b.distance + ang * 5; // 优先近的，其次是离准星近的
      if (score < bestScore) { bestScore = score; best = b; }
    }
    if (best !== this.target) {
      this.target = best;
      this.acquire = this.k.reaction * 0.6; // 换目标需要时间注意到
      this.aimHead = Math.random() < this.k.headAim;
    }
  }

  update(dt) {
    const g = this.game;
    const run = g.run;
    this.t += dt;
    this.record();
    if (!this.target || this.target.dead) this.pickTarget();
    else if (Math.random() < dt * 2) this.pickTarget(); // 偶尔重新评估威胁
    const bot = this.target;
    g.firing = false;
    if (!bot) return;

    const p = this.perceived(bot);
    if (!p) return;
    const d = p.clone().sub(this.eye);
    const wantYaw = Math.atan2(-d.x, -d.z);
    const wantPitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    if (this.acquire > 0) this.acquire -= dt;
    else {
      const f = 1 - Math.exp(-this.k.gain * dt);
      const lim = this.k.maxTurn * dt;
      this.yaw += Math.max(-lim, Math.min(lim, wrap(wantYaw - this.yaw) * f));
      this.pitch += Math.max(-lim, Math.min(lim, (wantPitch - this.pitch) * f));
    }
    // 手抖：随转身速度放大
    const err = Math.hypot(wrap(wantYaw - this.yaw), wantPitch - this.pitch);
    const shake = this.k.noise * (1 + 4 * Math.min(1, err * 3));
    g.yaw = this.yaw + gauss() * shake;
    g.pitch = this.pitch + gauss() * shake;

    // 觉得准星落在目标上才开枪
    const radius = this.aimHead ? bot.def.head : Math.min(bot.def.body[0], bot.def.body[1]) * 0.45;
    if (err < (radius / Math.max(1, d.length())) * this.k.trigger && this.acquire <= 0) g.firing = true;

    // 战术换弹和子弹时间
    const near = g.bots.filter((b) => !b.dead && b.distance < 10).length;
    if (run.ammo <= 3 && near === 0) g.tryReload();
    if (R.canActivateFocus(run) && near >= 3) g.tryFocus();
  }
}
