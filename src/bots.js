// bot：从远处直线逼近玩家，碰到玩家造成伤害。命中判定只看射线是否打到模型。
import * as THREE from '../vendor/three.module.min.js';
import { BOTS, PLAYER } from './config.js';

const geoCache = new Map();
function cached(key, make) {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
}

let nextId = 1;

export class Bot {
  constructor(type, scene, angle, radius, speedMul) {
    const def = BOTS[type];
    this.id = nextId++;
    this.type = type;
    this.def = def;
    this.hp = def.hp;
    this.maxHp = def.hp;
    this.speed = def.speed * speedMul;
    this.scene = scene;
    this.slowTime = 0;
    this.knock = new THREE.Vector3();
    this.dead = false;
    this.flash = 0;

    const [w, h, d] = def.body;
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
    }

    this.group.position.set(Math.sin(angle) * radius, 0, Math.cos(angle) * radius);
    scene.add(this.group);
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

  update(dt, speedMul) {
    const p = this.group.position;
    const dist = Math.hypot(p.x, p.z) || 1;
    const slow = this.slowTime > 0 ? 0.5 : 1;
    this.slowTime = Math.max(0, this.slowTime - dt);
    const step = this.speed * speedMul * slow * dt;
    p.x -= (p.x / dist) * step;
    p.z -= (p.z / dist) * step;
    // 击退速度衰减
    if (this.knock.lengthSq() > 0.001) {
      p.addScaledVector(this.knock, dt);
      this.knock.multiplyScalar(Math.max(0, 1 - 6 * dt));
    }
    this.group.lookAt(0, 0, 0);
    this.group.updateMatrixWorld(true); // 让同一帧内的射线检测用到最新位置

    if (this.flash > 0) {
      this.flash -= dt;
      const k = Math.max(0, this.flash) * 6;
      this.bodyMat.emissiveIntensity = 0.25 + k;
      this.headMat.emissiveIntensity = 0.5 + k;
    }
    // 受伤后身体逐渐变暗，提示剩余血量
    const hpK = this.hp / this.maxHp;
    this.bodyMat.color.setHex(this.def.color).multiplyScalar(0.45 + 0.55 * hpK);
    return dist <= PLAYER.hitRadius;
  }

  damage(n) {
    this.hp -= n;
    this.flash = 0.12;
    return this.hp <= 0;
  }

  knockback(strength) {
    const p = this.group.position;
    const dist = Math.hypot(p.x, p.z) || 1;
    this.knock.set((p.x / dist) * strength, 0, (p.z / dist) * strength);
  }

  remove() {
    this.dead = true;
    this.scene.remove(this.group);
    this.bodyMat.dispose();
    this.headMat.dispose();
  }
}
