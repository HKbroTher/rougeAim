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
// 所有 Boss 都在你周围高速乱飞（随机航点，频繁变向）。攻击 = 施法：前摇结束后，小球直接在空中的随机位置生成
// （先出现 0.5 秒的预警光圈），而不是从 Boss 身上射出——盯着 Boss 按住左键挡不住它们。

const markerGeo = new Map();
function ringGeo(r) {
  const key = r.toFixed(2);
  if (!markerGeo.has(key)) markerGeo.set(key, new THREE.TorusGeometry(r, 0.06, 6, 24));
  return markerGeo.get(key);
}

class Boss {
  // fly：{ speed 飞行速度 m/s, hop [最短, 最长] 换航点间隔, r [近, 远], y [低, 高] }
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
    this.spawn = spawn;  // (kind, { r, theta, y, dir }) => 生成一个小球
    this.move = { mode: 'boss' };
    this.fly = geom.fly;
    this.bodyH = 0.3;    // 原点在机身中心：模拟瞄准的「胸口」= 原点 + 0.6 × bodyH
    this.p = new THREE.Vector3(Math.sin(theta) * geom.fly.r[1], (geom.fly.y[0] + geom.fly.y[1]) / 2, Math.cos(theta) * geom.fly.r[1]);
    this.vel = new THREE.Vector3();
    this.goal = this.p.clone();
    this.hop = 0;
    this.age = 0;
    this.slowTime = 0;
    this.stun = 0;       // 踉跄 / 破绽：不移动、不攻击
    this.vuln = 0;       // 破绽：受到伤害 ×1.5
    this.charge = 0;     // 施法前摇剩余时间
    this.timer = 2;      // 下一次施法
    this.volley = 0;
    this.queue = [];     // 已经出现预警光圈、等待生成的小球
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

  get mobile() { return true; }
  get hitMeshes() { return this.meshes; }
  get position() { return this.group.position; }
  get distance() { return Math.hypot(this.p.x, this.p.z); }
  get r() { return this.distance; }
  get theta() { return Math.atan2(this.p.x, this.p.z); }
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
    if (this.charge > 0) return '施法中';
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

  speedMul() { return 1; }

  // 乱飞：到点或到达就换一个随机航点（大多在附近，偶尔一次大跳），有限加速度，所以能看出它在变向
  flit(dt) {
    const F = this.fly;
    this.hop -= dt;
    if (this.hop <= 0 || this.p.distanceTo(this.goal) < 1) {
      const big = Math.random() < 0.25;
      const th = this.theta + (Math.random() - 0.5) * (big ? 3.2 : 1.6);
      const r = rand(F.r[0], F.r[1]);
      this.goal.set(Math.sin(th) * r, rand(F.y[0], F.y[1]), Math.cos(th) * r);
      this.hop = rand(F.hop[0], F.hop[1]);
    }
    const want = this.goal.clone().sub(this.p);
    const d = want.length();
    const speed = F.speed * this.speedMul();
    if (d > 0.01) want.multiplyScalar(Math.min(speed, d * 4) / d);
    const dv = want.sub(this.vel);
    const maxDv = speed * 4 * dt;
    if (dv.length() > maxDv) dv.setLength(maxDv);
    this.vel.add(dv);
    this.p.addScaledVector(this.vel, dt);
    const r = Math.hypot(this.p.x, this.p.z);
    if (r < F.r[0]) { this.p.x *= F.r[0] / r; this.p.z *= F.r[0] / r; } // 不贴脸
    this.p.y = clamp(this.p.y, F.y[0], F.y[1]);
  }

  // 施法：在空中随机位置生成 n 个小球。先出现预警光圈，0.5 秒（依次错开）后变成小球。
  // around：小球出现在哪个方向附近（默认 Boss 所在方向），spread：左右散开多少弧度（π = 整圈）
  cast(kind, n = 1, { around = this.theta, spread = 1.0, r = [11, 18], y = [1.2, 6], stagger = 0.12, dir } = {}) {
    const o = ORBS[kind];
    for (let i = 0; i < n; i++) {
      const at = { r: rand(r[0], r[1]), theta: around + (Math.random() * 2 - 1) * spread, y: rand(y[0], y[1]), dir };
      const mm = new THREE.MeshBasicMaterial({ color: o.color, transparent: true, opacity: 0.9 });
      const ring = new THREE.Mesh(ringGeo(o.radius * 1.7), mm);
      const [x, z] = polarToXZ(at.r, at.theta, 0);
      ring.position.set(x, at.y, z);
      ring.lookAt(0, 1.6, 0);
      this.scene.add(ring);
      this.queue.push({ t: 0.5 + i * stagger, kind, at, ring });
    }
  }

  phaseOf() { return 0; }

  place() {
    this.group.position.copy(this.p);
    this.group.lookAt(0, this.p.y, 0);
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
    // 预警光圈到时间 → 生成小球
    for (const q of this.queue) {
      q.t -= sdt;
      q.ring.scale.setScalar(0.6 + 0.4 * Math.abs(Math.sin(this.age * 12)));
      if (q.t <= 0) { this.dropRing(q); this.spawn(q.kind, q.at); }
    }
    this.queue = this.queue.filter((q) => q.t > 0);
    if (this.stun > 0) this.vel.multiplyScalar(Math.max(0, 1 - 8 * dt));
    else this.flit(sdt);
    if (this.stun > 0) this.p.addScaledVector(this.vel, sdt);
    this.behave(sdt);
    this.place();
    const f = this.flash > 0 ? (this.flash -= dt) * 6 : 0;
    const glow = this.charge > 0 ? 0.8 : 0;
    for (const m of this.mats) if (!m.userData.weakMat) m.emissiveIntensity = 0.25 + f + glow;
    this.visuals();
    return false;
  }

  dropRing(q) {
    this.scene.remove(q.ring);
    q.ring.material.dispose();
  }

  // 标准的「冷却 → 前摇 → 施法」节奏；子类实现 pattern()
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

  behave() {}

  visuals() {}

  onWeakHit() { return null; }

  remove() {
    this.dead = true;
    for (const q of this.queue) this.dropRing(q);
    this.queue = [];
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

// ---------------- ① 守门人：点射 · 打断 ----------------

class GateBoss extends Boss {
  constructor(scene, theta, spawn) {
    super('gate', scene, theta, spawn, { weakR: 0.55, body: [2.4, 2.4, 2.4], fly: { speed: 9, hop: [0.6, 1.3], r: [13, 21], y: [2, 6] } });
    const m = this.mat(this.def.color);
    this.part(new THREE.BoxGeometry(2.4, 2.0, 2.4), m, [0, 0, 0]);
    this.part(new THREE.BoxGeometry(3.6, 0.3, 0.8), m, [0, 0.4, -0.4]);
    this.muzzle = this.part(sphere(0.55), weakMat(this), [0, 0, 1.45], 'weak');
    this.timer = 2;
  }

  phaseOf() { return this.frac < 0.5 ? 1 : 0; }

  behave(dt) {
    this.tickAttack(dt, this.phaseIdx ? 2.1 : 2.5, 0.8);
  }

  // 教学 Boss：一次 1–2 个普通弹，离你远一点，偶尔一个重弹
  pattern() {
    const far = { r: [14, 20], spread: this.phaseIdx ? 1.1 : 0.7 };
    if (this.volley % 5 === 0) this.cast('heavy', 1, { ...far, spread: 0.5 });
    else this.cast('normal', this.phaseIdx || this.volley % 2 ? 2 : 1, far);
  }

  visuals() { this.setWeak(this.muzzle, this.charge > 0 || this.stun > 0); }

  // 施法前摇时打中核心：打断这一轮，踉跄 1.2 秒
  onWeakHit() {
    if (this.charge <= 0) return null;
    this.charge = 0;
    this.stun = 1.2;
    this.timer = this.phaseIdx ? 2.1 : 2.5;
    return '打断！';
  }
}

// ---------------- ② 游隼：甩枪 · 破绽 ----------------

class FalconBoss extends Boss {
  constructor(scene, theta, spawn) {
    super('falcon', scene, theta, spawn, { weakR: 0.42, body: [2.2, 2.2, 2.2], fly: { speed: 14, hop: [0.4, 0.9], r: [12, 20], y: [3, 8] } });
    const m = this.mat(this.def.color);
    this.part(new THREE.OctahedronGeometry(1.1), m, [0, 0, 0]);
    this.part(new THREE.BoxGeometry(4.4, 0.15, 1.0), m, [0, 0.1, -0.2]);
    this.eye = this.part(sphere(0.42), weakMat(this), [0, 0.15, 1.05], 'weak');
    this.eyeOpen = 0;
    this.timer = 1.8;
  }

  phaseOf() { return this.frac < 0.5 ? 1 : 0; }
  speedMul() { return this.phaseIdx ? 1.25 : 1; }

  behave(dt) {
    this.eyeOpen = Math.max(0, this.eyeOpen - dt);
    this.tickAttack(dt, this.phaseIdx ? 1.9 : 2.3, 0.5);
  }

  pattern() {
    if (this.volley % 2) this.cast('fast', this.phaseIdx ? 3 : 2, { spread: 1.4 });
    else {
      this.cast('orbit', 1, { spread: 0.6, dir: Math.random() < 0.5 ? -1 : 1 });
      if (this.phaseIdx) this.cast('fast', 1, { spread: 1.2 });
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
    super('hive', scene, theta, spawn, { weakR: 0.75, body: [4, 4, 4], fly: { speed: 7, hop: [0.8, 1.6], r: [15, 23], y: [3, 7] } });
    const m = this.mat(this.def.color);
    this.part(sphere(2), m, [0, 0, 0]);
    // 三个发射舱：分裂弹 / 重弹 / 蛇形弹，各自有血量，打爆就不再生成这种小球
    const pods = [['split', [-3, 0, 0.5], 3.2, 1.2], ['heavy', [3, 0, 0.5], 4.6, 2.4], ['snake', [0, 2.9, 0.5], 2.6, 0.6]];
    this.pods = pods.map(([kind, pos, every, first]) => {
      const pod = { kind, every, timer: first, charge: 0, hp: 45, alive: true };
      pod.mesh = this.part(new THREE.BoxGeometry(1.5, 1.5, 1.5), weakMat(this, ORBS[kind].color), pos, 'weak', { pod });
      return pod;
    });
    this.eye = this.part(sphere(0.75), weakMat(this), [0, 0, 1.9], 'weak');
    this.timer = 2;
  }

  phaseOf() { return this.pods.every((p) => !p.alive) ? 1 : 0; }
  speedMul() { return this.phaseIdx ? 1.6 : 1; }

  behave(dt) {
    if (this.stun > 0) return;
    for (const p of this.pods) {
      if (!p.alive) continue;
      if (p.charge > 0) {
        p.charge -= dt;
        if (p.charge <= 0) { this.cast(p.kind, 1, { spread: 1.1 }); p.timer = p.every; }
      } else if ((p.timer -= dt) <= 0) p.charge = 0.6;
    }
    // 三个舱都拆掉后：核心暴露，飞得更快，改成一次 3 个普通弹
    if (this.phaseIdx) this.tickAttack(dt, 2.0, 0.7);
  }

  pattern() { this.cast('normal', 3, { spread: 1.4 }); }

  get status() {
    if (this.stun > 0) return '踉跄';
    const left = this.pods.filter((p) => p.alive).length;
    return left ? `发射舱 ${left}/3` : '核心暴露';
  }

  visuals() {
    for (const p of this.pods) {
      if (!p.alive) continue;
      this.setWeak(p.mesh, true);
      // 舱的颜色 = 它生成的小球的颜色；前摇时发白
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
    super('final', scene, theta, spawn, { weakR: 0.5, body: [2, 5.4, 1.5], fly: { speed: 11, hop: [0.35, 0.8], r: [12, 20], y: [2.5, 7] } });
    const m = this.mat(this.def.color);
    this.part(new THREE.BoxGeometry(2, 4, 1.5), m, [0, 0, 0]);
    this.part(new THREE.BoxGeometry(1.4, 1.4, 1.4), m, [0, 2.7, 0]);
    // 核心绕着身体转，转到身体后面时会被挡住
    this.core = this.part(sphere(0.5), weakMat(this), [0, 1, 1.7], 'weak');
    this.clearCD = 0;
    this.timer = 2;
  }

  phaseOf() { return this.frac < 1 / 3 ? 2 : this.frac < 2 / 3 ? 1 : 0; }
  speedMul() { return [1, 1.25, 1.5][this.phaseIdx]; }

  behave(dt) {
    this.clearCD = Math.max(0, this.clearCD - dt);
    const a = this.age * 1.6;
    this.core.position.set(Math.sin(a) * 1.7, 1, Math.cos(a) * 1.7);
    this.tickAttack(dt, [1.6, 1.35, 1.0][this.phaseIdx], 0.45);
  }

  pattern() {
    const v = this.volley;
    if (this.phaseIdx === 0) {
      if (v % 2) this.cast('normal', 3, { spread: 1.2 }); else this.cast('snake', 2, { spread: 1.0 });
    } else if (this.phaseIdx === 1) {
      [() => this.cast('normal', 3, { spread: 1.5 }), () => this.cast('split', 1), () => this.cast('orbit', 2, { spread: Math.PI }), () => this.cast('snake', 2)][v % 4]();
    } else {
      [() => this.cast('fast', 3, { spread: Math.PI }), () => this.cast('heavy', 1), () => { this.cast('split', 1); this.cast('fast', 1, { spread: 1.5 }); }, () => { this.cast('orbit', 1, { spread: Math.PI }); this.cast('snake', 1); }][v % 4]();
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
