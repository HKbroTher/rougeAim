// Boss 战：Boss 在远处发射小球，小球飞到玩家身上才扣血，打一下就碎。
// 打 Boss 的弱点 = 爆头，并触发每个 Boss 的专属效果（打断 / 破绽 / 拆除 / 清屏）。
// Orb 和 Boss 都实现了和 Bot 一样的接口（hitMeshes、position、headWorld、update、damage、remove……），
// 所以命中判定、子弹时间、视野外红光、雷达、模拟瞄准都直接复用。
import * as THREE from '../vendor/three.module.min.js';
import { PLAYER, BOSS, BOSSES, ORBS } from './config.js';

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
let nextId = 1e6; // 和 bot 的 id 分开，避免处刑链等按 id 判断的逻辑混淆

const sphereGeo = new Map();
const sphere = (r) => {
  const key = r.toFixed(3);
  if (!sphereGeo.has(key)) sphereGeo.set(key, new THREE.SphereGeometry(r, 18, 12));
  return sphereGeo.get(key);
};

// 极坐标：r 到玩家的水平距离，theta 方位角，s 切向偏移，y 高度。和 bot 的约定一致：+z 朝向玩家
function polarToXZ(r, theta, s) {
  const ux = Math.sin(theta);
  const uz = Math.cos(theta);
  return [ux * r + uz * s, uz * r - ux * s];
}

// ---------------- 小球 ----------------

export class Orb {
  // opts: { r, theta, y, dir }
  constructor(kind, scene, opts) {
    const o = ORBS[kind];
    this.id = nextId++;
    this.isOrb = true;
    this.type = 'orb';
    this.kind = kind;
    this.def = { label: o.name, gold: 0, damage: o.damage, color: o.color, head: o.radius, body: [o.radius * 2, o.radius * 2, o.radius * 2], core: o.core };
    this.hp = o.hp;
    this.maxHp = o.hp;
    this.speed = o.speed;
    this.scene = scene;
    this.move = { mode: 'orb' };
    this.r = opts.r;
    this.r0 = opts.r;
    this.theta = opts.theta;
    this.y = opts.y;
    this.y0 = opts.y;
    this.s = 0;
    this.dir = opts.dir || (Math.random() < 0.5 ? -1 : 1);
    this.sweepLeft = kind === 'orbit' ? o.sweep : 0;
    this.age = 0;
    this.phase = Math.random() * Math.PI * 2;
    this.slowTime = 0;
    this.knockV = 0;
    this.flash = 0;
    this.bodyH = 0;
    this.dead = false;

    this.group = new THREE.Group();
    this.mat = new THREE.MeshStandardMaterial({ color: o.color, emissive: o.color, emissiveIntensity: 0.9, roughness: 0.3,
      transparent: kind === 'split', opacity: kind === 'split' ? 0.55 : 1 });
    this.mesh = new THREE.Mesh(sphere(o.radius), this.mat);
    this.mesh.userData = { bot: this, part: 'orb' };
    this.group.add(this.mesh);
    this.extras = [];
    if (o.core) {
      // 分裂弹的核心：看得见，但不单独参与射线检测（命中外壳后按离中心多近判定）
      const cm = new THREE.MeshBasicMaterial({ color: 0xffffff });
      this.group.add(new THREE.Mesh(sphere(o.core), cm));
      this.extras.push(cm);
    }
    if (kind === 'heavy') {
      const rm = new THREE.MeshBasicMaterial({ color: 0xe0aaff, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(o.radius * 1.25, 0.05, 6, 32), rm);
      this.group.add(ring);
      this.ring = ring;
      this.extras.push(rm, ring.geometry);
    }
    this.place();
    scene.add(this.group);
  }

  get mobile() { return this.kind === 'snake' || this.kind === 'orbit'; }
  get hitMeshes() { return [this.mesh]; }
  get position() { return this.group.position; }
  get headWorld() { return this.group.position.clone(); }
  get distance() { return Math.hypot(this.group.position.x, this.group.position.z); }

  place() {
    const [x, z] = polarToXZ(this.r, this.theta, this.s);
    this.group.position.set(x, this.y, z);
    this.group.updateMatrixWorld(true);
  }

  update(dt, speedMul) {
    this.age += dt;
    const slow = this.slowTime > 0 ? 0.5 : 1;
    this.slowTime = Math.max(0, this.slowTime - dt);
    const v = this.speed * speedMul * slow;
    if (this.sweepLeft > 0) {
      // 回旋弹：先绕着你转到侧后方，同时收拢到 12 米，再冲进来
      const dth = Math.min(this.sweepLeft, (v / Math.max(this.r, 4)) * dt);
      this.theta += dth * this.dir;
      this.sweepLeft -= dth;
      this.r += (12 - this.r) * Math.min(1, dt * 1.2);
    } else {
      this.r -= v * dt;
    }
    if (Math.abs(this.knockV) > 0.01) {
      this.r += this.knockV * dt;
      this.knockV *= Math.max(0, 1 - 6 * dt);
    }
    if (this.kind === 'snake') {
      const o = ORBS.snake;
      this.s = o.amp * Math.sin(2 * Math.PI * o.freq * this.age + this.phase) * Math.min(1, this.r / 8);
    }
    // 越近越接近眼睛高度
    const k = clamp(this.r / Math.max(this.r0, 1), 0, 1);
    this.y = 1.5 + (this.y0 - 1.5) * k;
    this.place();
    if (this.ring) this.ring.rotation.y += dt * 2;
    const f = this.flash > 0 ? (this.flash -= dt) * 8 : 0;
    this.mat.emissiveIntensity = 0.9 + f + 0.25 * Math.sin(this.age * 10);
    if (this.maxHp > 1) this.mat.color.setHex(this.def.color).multiplyScalar(0.4 + 0.6 * (this.hp / this.maxHp));
    return this.r <= PLAYER.hitRadius;
  }

  damage(n) {
    this.hp -= n;
    this.flash = 0.1;
    return this.hp <= 0;
  }

  knockback(strength) { this.knockV = strength * 0.3; }

  remove() {
    this.dead = true;
    this.scene.remove(this.group);
    this.mat.dispose();
    for (const m of this.extras) m.dispose();
  }
}

// ---------------- Boss 基类 ----------------

class Boss {
  constructor(id, scene, theta, spawn, geom) {
    const b = BOSSES[id];
    this.id = nextId++;
    this.bossId = id;
    this.isBoss = true;
    this.type = 'boss';
    this.def = { label: b.name, gold: b.gold, damage: 0, color: b.color, head: geom.weakR, body: geom.body };
    this.hp = b.hp;
    this.maxHp = b.hp;
    this.scene = scene;
    this.spawn = spawn;  // (kind, { r, theta, y, dir }) => 发射一个小球
    this.move = { mode: 'boss' };
    this.r = geom.r;
    this.theta = theta;
    this.s = 0;
    this.y = 0;
    this.bodyH = geom.body[1];
    this.age = 0;
    this.slowTime = 0;
    this.stun = 0;       // 踉跄 / 破绽：不移动、不攻击
    this.vuln = 0;       // 破绽：受到伤害 ×1.5
    this.charge = 0;     // 攻击前摇剩余时间
    this.timer = 2;      // 下一次攻击
    this.volley = 0;
    this.queue = [];     // 延迟发射的小球
    this.phaseIdx = 0;
    this.phaseChanged = false;
    this.flash = 0;
    this.dead = false;
    this.meshes = [];
    this.mats = [];
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  mat(color, emissive = 0.25) {
    const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: emissive, roughness: 0.55 });
    this.mats.push(m);
    return m;
  }

  // 加一个可被射中的部件。part: 'body' 或 'weak'（弱点，开放时按爆头算）
  part(geo, material, pos, kind = 'body', extra = {}) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(...pos);
    m.userData = { bot: this, part: kind === 'weak' ? 'armor' : 'body', weak: kind === 'weak', ...extra };
    this.group.add(m);
    this.meshes.push(m);
    return m;
  }

  // 弱点开 / 关：开放时 part = 'head'（等效爆头），关闭时是装甲（按身体算）
  setWeak(mesh, open) {
    mesh.userData.part = open ? 'head' : 'armor';
    mesh.material.emissive.setHex(open ? 0xfff3b0 : 0x222222);
    mesh.material.emissiveIntensity = open ? 1.2 + 0.4 * Math.sin(this.age * 14) : 0.2;
  }

  get mobile() { return false; }
  get hitMeshes() { return this.meshes; }
  get position() { return this.group.position; }
  get distance() { return Math.hypot(this.group.position.x, this.group.position.z); }
  get frac() { return this.hp / this.maxHp; }

  // 模拟瞄准用的「头」= 当前开放的弱点（没有开放的就瞄第一个弱点）
  get headWorld() {
    const weak = this.meshes.filter((m) => m.userData.weak);
    const open = weak.find((m) => m.userData.part === 'head') || weak[0] || this.meshes[0];
    return open.getWorldPosition(new THREE.Vector3());
  }

  get status() {
    if (this.vuln > 0) return '破绽！';
    if (this.stun > 0) return '踉跄';
    if (this.charge > 0) return '蓄力中';
    return '';
  }

  // 受到的伤害倍率：弱点 ×1；身体 ×0.5，持续开火 2 秒内升到 ×1（扫射的路线）；破绽期间再 ×1.5
  takeMul(head, run) {
    const body = BOSS.bodyMul + (1 - BOSS.bodyMul) * Math.min(1, (run ? run.sprayTime : 0) / BOSS.armorRamp);
    return (head ? 1 : body) * (this.vuln > 0 ? BOSS.vulnMul : 1);
  }

  damage(n) {
    this.hp -= n;
    this.flash = 0.1;
    return this.hp <= 0;
  }

  knockback() {}

  // 从 Boss 前方发射小球。dTheta：方位角偏移（扇形），dy：高度偏移
  fire(kind, { dTheta = 0, y = this.bodyH * 0.75, dir } = {}) {
    // 横移中的 Boss（终局）：把切向偏移折算成方位角，小球从它身上发出来
    this.spawn(kind, { r: Math.hypot(this.r, this.s) - 1.5, theta: this.theta + Math.atan2(this.s, this.r) + dTheta, y: this.y + y, dir });
  }

  fireLater(delay, kind, opts) {
    this.queue.push({ t: delay, kind, opts });
  }

  phaseOf() { return 0; }

  place() {
    const [x, z] = polarToXZ(this.r, this.theta, this.s);
    this.group.position.set(x, this.y, z);
    this.group.lookAt(0, this.y, 0);
    this.group.updateMatrixWorld(true);
  }

  update(dt, speedMul) {
    this.age += dt;
    const slow = this.slowTime > 0 ? 0.5 : 1;
    this.slowTime = Math.max(0, this.slowTime - dt);
    const sdt = dt * slow * speedMul;
    this.stun = Math.max(0, this.stun - dt);
    this.vuln = Math.max(0, this.vuln - dt);
    const ph = this.phaseOf();
    if (ph !== this.phaseIdx) { this.phaseIdx = ph; this.phaseChanged = true; }
    for (const q of this.queue) q.t -= sdt;
    for (const q of this.queue.filter((x) => x.t <= 0)) this.fire(q.kind, q.opts);
    this.queue = this.queue.filter((q) => q.t > 0);
    this.behave(sdt);
    this.place();
    const f = this.flash > 0 ? (this.flash -= dt) * 6 : 0;
    const glow = this.charge > 0 ? 0.8 : 0;
    for (const m of this.mats) if (!m.userData.weakMat) m.emissiveIntensity = 0.25 + f + glow;
    this.visuals();
    return false;
  }

  // 标准的「冷却 → 前摇 → 发射」节奏；子类实现 pattern() 和前摇开始 / 结束的效果
  tickAttack(dt, interval, windup) {
    if (this.stun > 0) return;
    if (this.charge > 0) {
      this.charge -= dt;
      if (this.charge <= 0) {
        this.charge = 0;
        this.volley++;
        this.pattern();
        this.timer = interval;
      }
      return;
    }
    this.timer -= dt;
    if (this.timer <= 0) this.charge = windup;
  }

  visuals() {}

  onWeakHit() { return null; }

  remove() {
    this.dead = true;
    this.scene.remove(this.group);
    for (const m of this.mats) m.dispose();
  }
}

// 弱点材质单独一份，不参与通用的前摇发光
function weakMat(boss, color = 0xfff3b0) {
  const m = boss.mat(color, 0.2);
  m.userData.weakMat = true;
  return m;
}

// ---------------- ① 守门炮台：点射 · 打断 ----------------

class GateBoss extends Boss {
  constructor(scene, theta, spawn) {
    super('gate', scene, theta, spawn, { r: 24, body: [3, 4.2, 3], weakR: 0.55 });
    const m = this.mat(this.def.color);
    this.part(new THREE.BoxGeometry(3.2, 2.4, 3.2), m, [0, 1.2, 0]);
    this.part(new THREE.BoxGeometry(1.8, 1.3, 1.8), m, [0, 3.05, 0]);
    this.part(new THREE.CylinderGeometry(0.32, 0.4, 1.6, 12).rotateX(Math.PI / 2), m, [0, 3.1, 1.3]);
    this.muzzle = this.part(sphere(0.55), weakMat(this), [0, 3.1, 2.25], 'weak');
    this.timer = 2.2;
  }

  phaseOf() { return this.frac < 0.5 ? 1 : 0; }

  behave(dt) {
    this.tickAttack(dt, this.phaseIdx ? 1.6 : 1.8, 0.9);
  }

  pattern() {
    const heavy = this.volley % 4 === 0;
    if (this.phaseIdx === 0) {
      if (heavy) this.fire('heavy', { y: 3.1 });
      else if (this.volley % 4 === 2) for (const d of [-0.06, 0.06]) this.fire('normal', { y: 3.1, dTheta: d });
      else this.fire('normal', { y: 3.1 });
    } else {
      if (heavy) this.fire('heavy', { y: 3.1 });
      for (const d of heavy ? [-0.07, 0.07] : [-0.07, 0, 0.07]) this.fire('normal', { y: 3.1, dTheta: d });
    }
  }

  visuals() { this.setWeak(this.muzzle, this.charge > 0 || this.stun > 0); }

  // 蓄力时打中炮口：打断这一轮，踉跄 1.2 秒
  onWeakHit() {
    if (this.charge <= 0) return null;
    this.charge = 0;
    this.stun = 1.2;
    this.timer = this.phaseIdx ? 1.6 : 1.8;
    return '打断！';
  }
}

// ---------------- ② 游隼：甩枪 · 破绽 ----------------

class FalconBoss extends Boss {
  constructor(scene, theta, spawn) {
    super('falcon', scene, theta, spawn, { r: 17, body: [2.2, 2.2, 2.2], weakR: 0.42 });
    this.y = 4.5;
    this.bodyH = 0.3; // 原点在机身中心（不是脚下）：「胸口」= 原点 + 0.6 × bodyH 要落在机身上
    const m = this.mat(this.def.color);
    this.part(new THREE.OctahedronGeometry(1.1), m, [0, 0, 0]);
    this.part(new THREE.BoxGeometry(4.4, 0.15, 1.0), m, [0, 0.1, -0.2]);
    this.eye = this.part(sphere(0.42), weakMat(this), [0, 0.15, 1.05], 'weak');
    this.dir = Math.random() < 0.5 ? -1 : 1;
    this.flip = rand(4, 7);
    this.eyeOpen = 0;
    this.timer = 1.8;
  }

  phaseOf() { return this.frac < 0.5 ? 1 : 0; }

  behave(dt) {
    this.eyeOpen = Math.max(0, this.eyeOpen - dt);
    if (this.stun > 0) return;
    this.flip -= dt;
    if (this.flip <= 0) { this.dir = -this.dir; this.flip = rand(4, 7); }
    this.theta += this.dir * (this.phaseIdx ? 0.45 : 0.3) * dt;
    this.tickAttack(dt, this.phaseIdx ? 1.9 : 2.3, 0.5);
  }

  pattern() {
    const fast = this.phaseIdx ? 3 : 2;
    if (this.volley % 2) {
      for (let i = 0; i < fast; i++) this.fireLater(i * 0.3, 'fast', { y: 0, dTheta: (i - 1) * 0.03 });
    } else {
      this.fire('orbit', { y: 0, dir: Math.random() < 0.5 ? -1 : 1 });
      if (this.phaseIdx) this.fireLater(0.2, 'fast', { y: 0 });
    }
    this.eyeOpen = 1.1;
  }

  visuals() { this.setWeak(this.eye, this.eyeOpen > 0 || this.vuln > 0); }

  // 眼睛张开时打中：破绽，停住 1.5 秒、受到伤害 +50%
  onWeakHit() {
    if (this.vuln > 0 || this.eyeOpen <= 0) return null;
    this.vuln = 1.5;
    this.stun = 1.5;
    this.eyeOpen = 0;
    this.charge = 0;
    return '破绽！';
  }
}

// ---------------- ③ 蜂巢：切换目标 · 拆除 ----------------

class HiveBoss extends Boss {
  constructor(scene, theta, spawn) {
    super('hive', scene, theta, spawn, { r: 25, body: [4, 6, 4], weakR: 0.75 });
    const m = this.mat(this.def.color);
    this.part(sphere(2), m, [0, 4.5, 0]);
    this.part(new THREE.CylinderGeometry(0.5, 0.8, 2.5, 10), m, [0, 1.25, 0]);
    // 三个发射舱：分裂弹 / 重弹 / 蛇形弹，各自有血量，打爆就不再发射这种小球
    const pods = [['split', [-3, 4.5, 0.5], 3.2, 1.2], ['heavy', [3, 4.5, 0.5], 4.6, 2.4], ['snake', [0, 7.4, 0.5], 2.6, 0.6]];
    this.pods = pods.map(([kind, pos, every, first]) => {
      const pod = { kind, x: pos[0], y: pos[1], every, timer: first, charge: 0, hp: 45, alive: true };
      pod.mesh = this.part(new THREE.BoxGeometry(1.5, 1.5, 1.5), weakMat(this, ORBS[kind].color), pos, 'weak', { pod });
      return pod;
    });
    this.eye = this.part(sphere(0.75), weakMat(this), [0, 4.5, 1.9], 'weak');
    this.timer = 2;
  }

  phaseOf() { return this.pods.every((p) => !p.alive) ? 1 : 0; }

  behave(dt) {
    if (this.stun > 0) return;
    for (const p of this.pods) {
      if (!p.alive) continue;
      if (p.charge > 0) {
        p.charge -= dt;
        if (p.charge <= 0) { this.fire(p.kind, { y: p.y, dTheta: p.x / this.r }); p.timer = p.every; }
      } else if ((p.timer -= dt) <= 0) p.charge = 0.6;
    }
    // 三个舱都拆掉后：核心张开，改发普通弹扇形
    if (this.phaseIdx) this.tickAttack(dt, 2.0, 0.7);
  }

  pattern() {
    for (const d of [-0.08, 0, 0.08]) this.fire('normal', { y: 4.5, dTheta: d });
  }

  get status() {
    if (this.stun > 0) return '踉跄';
    const left = this.pods.filter((p) => p.alive).length;
    return left ? `发射舱 ${left}/3` : '核心暴露';
  }

  visuals() {
    for (const p of this.pods) {
      if (!p.alive) continue;
      this.setWeak(p.mesh, true);
      // 舱的颜色 = 它发射的小球的颜色；前摇时发白
      p.mesh.material.emissive.setHex(p.charge > 0 ? 0xffffff : ORBS[p.kind].color);
    }
    this.setWeak(this.eye, this.phaseIdx === 1);
  }

  // 打中发射舱：扣舱的血，打爆就拆掉它
  onWeakHit(game, { mesh, dmg }) {
    const pod = mesh.userData.pod;
    if (!pod || !pod.alive) return null;
    pod.hp -= dmg;
    if (pod.hp > 0) return null;
    pod.alive = false;
    this.group.remove(pod.mesh);
    this.meshes = this.meshes.filter((m) => m !== pod.mesh);
    this.stun = 1;
    return `拆除：${ORBS[pod.kind].name}`;
  }
}

// ---------------- ④ 终局：跟枪 · 清屏 ----------------

class FinalBoss extends Boss {
  constructor(scene, theta, spawn) {
    super('final', scene, theta, spawn, { r: 20, body: [2, 5.4, 1.5], weakR: 0.5 });
    const m = this.mat(this.def.color);
    this.part(new THREE.BoxGeometry(2, 4, 1.5), m, [0, 2, 0]);
    this.part(new THREE.BoxGeometry(1.4, 1.4, 1.4), m, [0, 4.7, 0]);
    // 核心绕着身体转，转到身体后面时会被挡住
    this.core = this.part(sphere(0.5), weakMat(this), [0, 3, 1.7], 'weak');
    this.vs = 0;
    this.sdir = 1;
    this.hold = rand(0.5, 1.2);
    this.vy = 0;
    this.jumpT = rand(3, 5);
    this.clearCD = 0;
    this.timer = 2;
  }

  get mobile() { return true; }

  phaseOf() { return this.frac < 1 / 3 ? 2 : this.frac < 2 / 3 ? 1 : 0; }

  behave(dt) {
    this.clearCD = Math.max(0, this.clearCD - dt);
    const a = this.age * 1.6;
    this.core.position.set(Math.sin(a) * 1.7, 3, Math.cos(a) * 1.7);
    if (this.stun > 0) return;
    // ADAD 横移 + 偶尔跳跃，第三阶段更快
    const speed = [3.5, 4.5, 5.5][this.phaseIdx];
    this.hold -= dt;
    if (this.hold <= 0) { this.sdir = -this.sdir; this.hold = rand(0.5, 1.2); }
    if (Math.abs(this.s) > 6) this.sdir = -Math.sign(this.s);
    this.vs += clamp(this.sdir * speed - this.vs, -14 * dt, 14 * dt);
    this.s = clamp(this.s + this.vs * dt, -6.5, 6.5);
    if (this.y > 0 || this.vy > 0) {
      this.vy -= 20 * dt;
      this.y = Math.max(0, this.y + this.vy * dt);
      if (this.y === 0) this.vy = 0;
    } else if ((this.jumpT -= dt) <= 0) {
      this.vy = 9;
      this.y = 0.01;
      this.jumpT = rand(3, 5);
    }
    this.tickAttack(dt, [1.6, 1.35, 1.0][this.phaseIdx], 0.45);
  }

  pattern() {
    const v = this.volley;
    const fan = (kind, n = 3) => { for (let i = 0; i < n; i++) this.fire(kind, { dTheta: (i - (n - 1) / 2) * 0.07 }); };
    if (this.phaseIdx === 0) {
      if (v % 2) fan('normal'); else { this.fire('snake'); this.fireLater(0.25, 'snake'); }
    } else if (this.phaseIdx === 1) {
      [() => fan('normal'), () => this.fire('split'), () => { this.fire('orbit', { dir: 1 }); this.fire('orbit', { dir: -1 }); }, () => { this.fire('snake'); this.fireLater(0.25, 'snake'); }][v % 4]();
    } else {
      [() => fan('fast'), () => this.fire('heavy'), () => { this.fire('split'); this.fireLater(0.2, 'fast'); }, () => { this.fire('orbit'); this.fire('snake'); }][v % 4]();
    }
  }

  visuals() { this.setWeak(this.core, true); }

  // 打中核心：场上所有小球碎掉（4 秒冷却）
  onWeakHit(game) {
    if (this.clearCD > 0) return null;
    this.clearCD = 4;
    const n = game.shatterOrbs();
    return n ? `清屏 ×${n}` : null;
  }
}

const CLASSES = { gate: GateBoss, falcon: FalconBoss, hive: HiveBoss, final: FinalBoss };

export function createBoss(id, scene, theta, spawn) {
  return new CLASSES[id](scene, theta, spawn);
}
