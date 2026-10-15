// bot：从远处逼近玩家，碰到玩家造成伤害。命中判定只看射线是否打到模型。
// 移动拆成三个分量：径向（冲向玩家）、横向（沿出生方向的切线左右移动）、垂直（跳跃）。
// 横向移动不影响冲向玩家的速度，所以机动只让目标更难打，不改变它撞到你的时间。
import * as THREE from '../vendor/three.module.min.js';
import { BOTS, PLAYER, MOVEMENT } from './config.js';

const geoCache = new Map();
function cached(key, make) {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
}

const rand = (a, b) => a + Math.random() * (b - a);

let nextId = 1;

export class Bot {
  // move: { mode: 'none' | 'sine' | 'jump' | 'adad', amp, freq, ... }，由波次曲线决定
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

    // 径向距离 r、出生方向 u、切线方向 t、横向偏移 s、离地高度 y
    this.r = radius;
    this.u = new THREE.Vector2(Math.sin(angle), Math.cos(angle));
    this.t = new THREE.Vector2(this.u.y, -this.u.x);
    this.s = 0;
    this.y = 0;
    this.vy = 0;
    this.move = move;
    this.phase = Math.random() * Math.PI * 2;
    // ADAD 状态
    this.vs = 0;
    this.dir = Math.random() < 0.5 ? -1 : 1;
    this.hold = rand(MOVEMENT.adad.holdMin, MOVEMENT.adad.holdMax);
    // 跳跃状态
    this.jumpTimer = rand(MOVEMENT.jump.intervalMin, MOVEMENT.jump.intervalMax) * 0.6;
    this.crouch = 0;
    this.landLag = 0;

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
    this.group.add(this.body, this.head);
    this.extras = [];

    // 重甲兵：肩甲装饰，强调体型
    if (type === 'heavy') {
      const pad = new THREE.Mesh(
        cached('pad', () => new THREE.BoxGeometry(w + 0.4, 0.3, d + 0.2)),
        new THREE.MeshStandardMaterial({ color: 0x4a3f7a, roughness: 0.8 }),
      );
      pad.position.y = h - 0.2;
      pad.userData = { bot: this, part: 'body' };
      this.group.add(pad);
      this.extraHit = pad;
      this.extras.push(pad.material);
    }

    // 机动兵种的外观提示：脚下的色环（横移 = 青，跳跃 = 绿，ADAD = 品红）
    const markColor = { sine: 0x4cc9f0, jump: 0x80ed99, adad: 0xf72585 }[move.mode];
    if (markColor) {
      const ringMat = new THREE.MeshBasicMaterial({ color: markColor, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
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
  lateralLimit() {
    return this.move.amp * Math.min(1, this.r / MOVEMENT.convergeDistance);
  }

  updateLateral(dt) {
    const m = this.move;
    const limit = this.lateralLimit();
    if (m.mode === 'sine') {
      this.s = limit * Math.sin(2 * Math.PI * m.freq * this.age + this.phase);
    } else if (m.mode === 'adad') {
      const A = MOVEMENT.adad;
      this.hold -= dt;
      if (this.hold <= 0) {
        // 大多数时候反向，偶尔继续同向，防止节奏被完全背下来
        if (Math.random() < A.flipChance) this.dir = -this.dir;
        this.hold = rand(A.holdMin, A.holdMax);
      }
      // 到达边界必须折返
      if (this.s > limit) this.dir = -1;
      else if (this.s < -limit) this.dir = 1;
      // 有限加速度：变向前会先减速，玩家能看出来
      const target = this.dir * m.speed;
      const dv = target - this.vs;
      const maxDv = A.accel * dt;
      this.vs += Math.max(-maxDv, Math.min(maxDv, dv));
      this.s = Math.max(-limit, Math.min(limit, this.s + this.vs * dt));
    } else if (m.mode === 'none') {
      this.s = 0;
    }
  }

  updateJump(dt) {
    const J = MOVEMENT.jump;
    if (this.y > 0 || this.vy > 0) {
      this.vy -= J.gravity * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) {
        this.y = 0;
        this.vy = 0;
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
        this.vy = Math.sqrt(2 * J.gravity * this.move.height);
        this.y = 0.001;
        this.jumpTimer = rand(J.intervalMin, J.intervalMax);
      }
    }
  }

  place() {
    const p = this.group.position;
    p.set(this.u.x * this.r + this.t.x * this.s, this.y, this.u.y * this.r + this.t.y * this.s);
    const squash = 1 - 0.25 * this.crouch;
    this.body.scale.y = squash;
    this.body.position.y = (this.bodyH * squash) / 2;
    this.head.position.y = this.bodyH * squash + this.def.head * 1.05;
    this.group.lookAt(0, this.y, 0);
    this.group.updateMatrixWorld(true); // 让同一帧内的射线检测用到最新位置
  }

  update(dt, speedMul) {
    this.age += dt;
    const slow = this.slowTime > 0 ? 0.5 : 1;
    this.slowTime = Math.max(0, this.slowTime - dt);
    // 落地硬直：横向停住、前进减半，是奖励给玩家的输出窗口
    const lag = this.landLag > 0 ? 0.5 : 1;
    this.r -= this.speed * speedMul * slow * lag * dt;
    if (Math.abs(this.knockV) > 0.01) {
      this.r += this.knockV * dt;
      this.knockV *= Math.max(0, 1 - 6 * dt);
    }
    if (this.landLag <= 0) this.updateLateral(dt * slow);
    else this.vs = 0;
    if (this.move.mode === 'jump') this.updateJump(dt * slow);
    this.place();

    if (this.flash > 0) {
      this.flash -= dt;
      const k = Math.max(0, this.flash) * 6;
      this.bodyMat.emissiveIntensity = 0.25 + k;
      this.headMat.emissiveIntensity = 0.5 + k;
    }
    // 受伤后身体逐渐变暗，提示剩余血量
    const hpK = this.hp / this.maxHp;
    this.bodyMat.color.setHex(this.def.color).multiplyScalar(0.45 + 0.55 * hpK);
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
