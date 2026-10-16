// bot：从远处逼近玩家，碰到玩家造成伤害。命中判定只看射线是否打到模型。
// 位置由三部分组成：径向距离 r（冲向玩家）、绕玩家的方位角 θ（环绕兵会转动）、
// 切线方向的横向偏移 s（横移 / ADAD / 闪避），再加上离地高度 y（跳跃）。
// 所有突然的动作（闪避、冲刺、扑击、起跳）都有可读的前摇：玩家能看出来、能预判。
import * as THREE from '../vendor/three.module.min.js';
import { BOTS, PLAYER, MOVEMENT } from './config.js';

const geoCache = new Map();
function cached(key, make) {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
}

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 机动种类 → 脚下色环颜色
export const MOVE_COLORS = {
  sine: 0x4cc9f0,    // 横移：青
  jump: 0x80ed99,    // 跳跃：绿
  adad: 0xf72585,    // ADAD：品红
  dodge: 0xffd166,   // 闪避：黄
  orbit: 0xffffff,   // 环绕：白
  stutter: 0xfb8500, // 急停冲刺：橙
  lunge: 0xff2d55,   // 扑击：红
};

let nextId = 1;

export class Bot {
  // move: { mode, amp, ... }，由波次曲线决定（见 config.js rollMove）
  constructor(type, scene, angle, radius, speedMul, move = { mode: 'none' }) {
    const def = BOTS[type];
    this.id = nextId++;
    this.type = type;
    this.def = def;
    this.hp = def.hp;
    this.maxHp = def.hp;
    this.speed = def.speed * speedMul;
    this.scene = scene;
    this.slowTime = 0;
    this.knockV = 0; // 径向击退速度
    this.dead = false;
    this.flash = 0;
    this.age = 0;
    this.move = move;
    this.aimAngle = Math.PI; // 准星与它的夹角，由 game 每帧写入（闪避兵用）

    this.r = radius;
    this.theta = angle;
    this.u = new THREE.Vector2();
    this.t = new THREE.Vector2();
    this.setAngle(angle);
    this.s = 0;
    this.vs = 0;
    this.y = 0;
    this.vy = 0;
    this.phase = Math.random() * Math.PI * 2;
    this.crouch = 0;
    this.lean = 0;     // 前摇时的侧倾（闪避方向提示）
    this.glow = 0;     // 前摇时的发光（0..1）
    // ADAD
    this.dir = Math.random() < 0.5 ? -1 : 1;
    this.hold = rand(MOVEMENT.adad.holdMin, MOVEMENT.adad.holdMax);
    // 跳跃
    this.jumpTimer = rand(MOVEMENT.jump.intervalMin, MOVEMENT.jump.intervalMax) * 0.6;
    this.landLag = 0;
    this.secondJump = false;
    // 闪避
    this.aimedFor = 0;
    this.dodge = { phase: 'idle', t: 0, dir: 1, cooldown: rand(0.3, 0.8), count: 0 };
    // 环绕
    this.orbitDir = Math.random() < 0.5 ? -1 : 1;
    // 急停冲刺
    this.stutter = { phase: 'walk', t: rand(0.6, 1.4) };
    // 扑击
    this.lunge = { phase: 'approach', t: 0, at: rand(MOVEMENT.lunge.distMin, MOVEMENT.lunge.distMax) };

    const [w, h, d] = def.body;
    this.bodyH = h;
    this.group = new THREE.Group();
    this.bodyMat = new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 0.25, roughness: 0.6 });
    this.headMat = new THREE.MeshStandardMaterial({ color: def.headColor, emissive: def.headColor, emissiveIntensity: 0.5, roughness: 0.4 });
    this.body = new THREE.Mesh(cached(`b${type}`, () => new THREE.BoxGeometry(w, h, d)), this.bodyMat);
    this.body.position.y = h / 2;
    this.head = new THREE.Mesh(cached(`h${type}`, () => new THREE.SphereGeometry(def.head, 20, 14)), this.headMat);
    this.head.position.y = h + def.head * 1.05;
    this.body.userData = { bot: this, part: 'body' };
    this.head.userData = { bot: this, part: 'head' };
    this.rig = new THREE.Group(); // 侧倾只作用于身体，不影响脚下色环
    this.rig.add(this.body, this.head);
    this.group.add(this.rig);
    this.extras = [];

    // 重甲兵：肩甲装饰，强调体型
    if (type === 'heavy') {
      const pad = new THREE.Mesh(
        cached('pad', () => new THREE.BoxGeometry(w + 0.4, 0.3, d + 0.2)),
        new THREE.MeshStandardMaterial({ color: 0x4a3f7a, roughness: 0.8 }),
      );
      pad.position.y = h - 0.2;
      pad.userData = { bot: this, part: 'body' };
      this.rig.add(pad);
      this.extraHit = pad;
      this.extras.push(pad.material);
    }

    const markColor = MOVE_COLORS[move.mode];
    if (markColor) {
      const ringMat = new THREE.MeshBasicMaterial({ color: markColor, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(cached('mark', () => new THREE.RingGeometry(0.45, 0.6, 24)), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.03;
      this.group.add(ring);
      this.mark = ring;
      this.extras.push(ringMat);
    }

    this.place();
    scene.add(this.group);
  }

  setAngle(a) {
    this.theta = a;
    this.u.set(Math.sin(a), Math.cos(a));
    this.t.set(this.u.y, -this.u.x);
  }

  get mobile() {
    return this.move.mode !== 'none';
  }

  get hitMeshes() {
    return this.extraHit ? [this.head, this.body, this.extraHit] : [this.head, this.body];
  }

  get position() {
    return this.group.position;
  }

  get headWorld() {
    return this.head.getWorldPosition(new THREE.Vector3());
  }

  get distance() {
    return Math.hypot(this.group.position.x, this.group.position.z);
  }

  // 靠近玩家时横向幅度逐渐收拢，保证最后一定会撞上来，也避免贴脸绕圈
  converge() {
    return Math.min(1, this.r / MOVEMENT.convergeDistance);
  }

  // ---------------- 径向：急停冲刺、扑击会改变前进速度 ----------------

  radialMul(dt) {
    const m = this.move.mode;
    if (m === 'stutter') {
      const S = MOVEMENT.stutter;
      const st = this.stutter;
      st.t -= dt;
      if (st.phase === 'walk' && st.t <= 0) { st.phase = 'stop'; st.t = rand(S.stopMin, S.stopMax); }
      else if (st.phase === 'stop' && st.t <= 0) { st.phase = 'wind'; st.t = S.windup; }
      else if (st.phase === 'wind' && st.t <= 0) { st.phase = 'sprint'; st.t = S.sprint; }
      else if (st.phase === 'sprint' && st.t <= 0) { st.phase = 'walk'; st.t = rand(S.walkMin, S.walkMax); }
      this.crouch = st.phase === 'wind' ? 1 - st.t / S.windup : 0;
      this.glow = st.phase === 'wind' ? 0.6 : 0;
      return { walk: 1, stop: S.stopSpeed, wind: S.stopSpeed, sprint: S.sprintSpeed }[st.phase];
    }
    if (m === 'lunge') {
      const L = MOVEMENT.lunge;
      const lg = this.lunge;
      if (lg.phase === 'approach' && this.r <= lg.at) { lg.phase = 'wind'; lg.t = L.windup; }
      if (lg.phase === 'wind') {
        lg.t -= dt;
        this.crouch = 1 - Math.max(0, lg.t) / L.windup;
        this.glow = 1;
        if (lg.t <= 0) { lg.phase = 'lunge'; this.crouch = 0; this.glow = 0; }
        return 0;
      }
      return lg.phase === 'lunge' ? L.speed : 1;
    }
    return 1;
  }

  // ---------------- 横向 ----------------

  updateLateral(dt) {
    const m = this.move;
    const k = this.converge();
    if (m.mode === 'sine') {
      this.s = m.amp * k * Math.sin(2 * Math.PI * m.freq * this.age + this.phase);
    } else if (m.mode === 'adad') {
      const A = MOVEMENT.adad;
      const limit = m.amp * k;
      this.hold -= dt;
      if (this.hold <= 0) {
        // 大多数时候反向，偶尔继续同向，防止节奏被完全背下来
        if (Math.random() < A.flipChance) this.dir = -this.dir;
        this.hold = rand(A.holdMin, A.holdMax);
      }
      if (this.s > limit) this.dir = -1;
      else if (this.s < -limit) this.dir = 1;
      // 有限加速度：变向前会先减速，玩家能看出来
      const dv = this.dir * m.speed - this.vs;
      this.vs += clamp(dv, -A.accel * dt, A.accel * dt);
      this.s = clamp(this.s + this.vs * dt, -limit, limit);
    } else if (m.mode === 'dodge') {
      this.updateDodge(dt, k);
    } else if (m.mode === 'jump' && this.vs) {
      // 二段跳的横向冲量，落地前逐渐衰减
      this.s = clamp(this.s + this.vs * dt, -3 * k - 0.01, 3 * k + 0.01);
      this.vs *= Math.max(0, 1 - 2.5 * dt);
    } else if (m.mode !== 'jump') {
      this.s = 0;
    }
  }

  // 闪避兵：被准星压住一小段时间后，前摇 → 侧闪 → 冷却。
  // 它只对「准星停在它身上」做反应，所以快速甩枪可以在它反应之前打中。
  updateDodge(dt, k) {
    const D = MOVEMENT.dodge;
    const dg = this.dodge;
    const base = this.move.amp * k * Math.sin(2 * Math.PI * 0.5 * this.age + this.phase) * 0.35;
    this.aimedFor = this.aimAngle < D.aimAngle ? this.aimedFor + dt : Math.max(0, this.aimedFor - dt * 2);
    dg.cooldown -= dt;
    if (dg.phase === 'idle') {
      this.lean = 0;
      this.glow = 0;
      if (this.aimedFor >= D.aimTime && dg.cooldown <= 0 && dg.count < D.maxDodges && k > 0.3) {
        dg.phase = 'wind';
        dg.t = D.windup;
        // 往远离中线的反方向闪，避免闪出可见范围太远
        dg.dir = Math.abs(this.s) > 1 ? -Math.sign(this.s) : (Math.random() < 0.5 ? -1 : 1);
      }
      this.s += (base - this.s) * Math.min(1, dt * 1.5); // 闪完慢慢回到原来的节奏
    } else if (dg.phase === 'wind') {
      dg.t -= dt;
      this.lean = dg.dir;
      this.glow = 1;
      if (dg.t <= 0) { dg.phase = 'dash'; dg.t = D.dashTime; }
    } else if (dg.phase === 'dash') {
      dg.t -= dt;
      this.s += dg.dir * (D.dashDist / D.dashTime) * dt;
      this.lean = dg.dir * 0.6;
      this.glow = 0;
      if (dg.t <= 0) {
        dg.phase = 'idle';
        dg.cooldown = D.cooldown;
        dg.count++;
        this.aimedFor = 0;
      }
    }
    this.s = clamp(this.s, -D.maxOffset * k - 0.01, D.maxOffset * k + 0.01);
  }

  // ---------------- 环绕：绕着玩家转，可能转到你身后 ----------------

  updateOrbit(dt) {
    const O = MOVEMENT.orbit;
    let w = (this.move.tangential / Math.max(this.r, 1)) * this.orbitDir;
    w = clamp(w, -O.maxAngular, O.maxAngular);
    if (this.r < O.slowRadius) w *= this.r / O.slowRadius; // 贴近时放慢，最后一段直线冲过来
    this.setAngle(this.theta + w * dt);
  }

  // ---------------- 跳跃 / 二段跳 ----------------

  updateJump(dt) {
    const J = MOVEMENT.jump;
    if (this.y > 0 || this.vy > 0) {
      const wasRising = this.vy > 0;
      this.vy -= J.gravity * dt;
      this.y += this.vy * dt;
      // 二段跳：在最高点再跳一次，并带一个横向冲量
      if (this.move.doubleJump && !this.secondJump && wasRising && this.vy <= 0) {
        this.secondJump = true;
        this.vy = Math.sqrt(2 * J.gravity * this.move.height * 0.6);
        this.vs = (Math.random() < 0.5 ? -1 : 1) * J.doubleJumpSide;
      }
      if (this.y <= 0) {
        this.y = 0;
        this.vy = 0;
        this.vs = 0;
        this.landLag = J.landLag;
      }
      return;
    }
    if (this.landLag > 0) { this.landLag -= dt; return; }
    this.jumpTimer -= dt;
    if (this.jumpTimer <= J.crouchTime) {
      // 起跳前下蹲预警
      this.crouch = 1 - Math.max(0, this.jumpTimer) / J.crouchTime;
      if (this.jumpTimer <= 0) {
        this.crouch = 0;
        this.secondJump = false;
        this.vy = Math.sqrt(2 * J.gravity * this.move.height);
        this.y = 0.001;
        this.jumpTimer = rand(J.intervalMin, J.intervalMax);
      }
    }
  }

  place() {
    const p = this.group.position;
    p.set(this.u.x * this.r + this.t.x * this.s, this.y, this.u.y * this.r + this.t.y * this.s);
    const squash = 1 - 0.25 * clamp(this.crouch, 0, 1);
    this.body.scale.y = squash;
    this.body.position.y = (this.bodyH * squash) / 2;
    this.head.position.y = this.bodyH * squash + this.def.head * 1.05;
    this.rig.rotation.z = -0.35 * this.lean;
    this.group.lookAt(0, this.y, 0);
    this.group.updateMatrixWorld(true); // 让同一帧内的射线检测用到最新位置
  }

  update(dt, speedMul) {
    this.age += dt;
    const slow = this.slowTime > 0 ? 0.5 : 1;
    this.slowTime = Math.max(0, this.slowTime - dt);
    const sdt = dt * slow;
    // 落地硬直：横向停住、前进减半，是奖励给玩家的输出窗口
    const lag = this.landLag > 0 ? 0.5 : 1;
    this.r -= this.speed * speedMul * slow * lag * this.radialMul(sdt) * dt;
    if (Math.abs(this.knockV) > 0.01) {
      this.r += this.knockV * dt;
      this.knockV *= Math.max(0, 1 - 6 * dt);
    }
    if (this.landLag <= 0) this.updateLateral(sdt);
    if (this.move.mode === 'jump') this.updateJump(sdt);
    if (this.move.mode === 'orbit') this.updateOrbit(sdt);
    this.place();

    // 受击闪白 / 前摇发光
    const hitK = this.flash > 0 ? Math.max(0, (this.flash -= dt)) * 6 : 0;
    this.bodyMat.emissiveIntensity = 0.25 + hitK + this.glow * 0.9;
    this.headMat.emissiveIntensity = 0.5 + hitK;
    // 受伤后身体逐渐变暗，提示剩余血量；前摇时偏白
    const hpK = this.hp / this.maxHp;
    this.bodyMat.color.setHex(this.def.color).multiplyScalar(0.45 + 0.55 * hpK);
    if (this.glow > 0) this.bodyMat.emissive.setHex(this.move.mode === 'lunge' ? 0xff2d55 : 0xffffff);
    else this.bodyMat.emissive.setHex(this.def.color);
    return this.r <= 0 || this.distance <= PLAYER.hitRadius;
  }

  damage(n) {
    this.hp -= n;
    this.flash = 0.12;
    return this.hp <= 0;
  }

  knockback(strength) {
    this.knockV = strength;
  }

  remove() {
    this.dead = true;
    this.scene.remove(this.group);
    this.bodyMat.dispose();
    this.headMat.dispose();
    for (const m of this.extras) m.dispose();
  }
}
