// 场景、相机与简单特效（粒子、爆炸环、弹道）。
import * as THREE from '../vendor/three.module.min.js';
import { PLAYER, ARENA } from './config.js';

export function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0e17);
  scene.fog = new THREE.Fog(0x0b0e17, 30, 70);

  const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 200);
  camera.rotation.order = 'YXZ';
  camera.position.set(0, PLAYER.eyeHeight, 0);

  scene.add(new THREE.HemisphereLight(0x8fb3ff, 0x1a1020, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(10, 20, 6);
  scene.add(sun);

  // 地面 + 网格，提供运动参照
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(80, 64),
    new THREE.MeshStandardMaterial({ color: 0x151a2a, roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const grid = new THREE.GridHelper(160, 80, 0x2a3350, 0x1c2238);
  grid.position.y = 0.01;
  scene.add(grid);

  // 出怪圈与玩家受击圈
  const ring = (r, color, opacity) => {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(r - 0.08, r, 96),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.02;
    scene.add(m);
    return m;
  };
  ring(ARENA.spawnRadius, 0x3a4570, 0.5);
  const dangerRing = ring(PLAYER.hitRadius + 2.5, 0xff3355, 0.25);

  // 远处四个方向的彩色立柱，帮助 360° 定向
  const pillarColors = [0x4cc9f0, 0xf72585, 0x80ed99, 0xffd166];
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const p = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 14, 1.2),
      new THREE.MeshStandardMaterial({ color: pillarColors[i], emissive: pillarColors[i], emissiveIntensity: 0.35 }),
    );
    p.position.set(Math.sin(a) * -48, 7, Math.cos(a) * -48);
    scene.add(p);
  }

  const fx = createFx(scene);

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', resize);

  return { THREE, renderer, scene, camera, fx, dangerRing };
}

function createFx(scene) {
  const particles = [];
  const rings = [];
  const tracers = [];
  const pGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);

  function burst(pos, color, count = 14, speed = 6) {
    const mat = new THREE.MeshBasicMaterial({ color });
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(pGeo, mat);
      m.position.copy(pos);
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5)
        .normalize()
        .multiplyScalar(speed * (0.5 + Math.random()));
      scene.add(m);
      particles.push({ m, v, life: 0.6 + Math.random() * 0.3 });
    }
  }

  function shockwave(pos, radius, color = 0xffd166) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1, 48),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(pos.x, 0.15, pos.z);
    scene.add(m);
    rings.push({ m, radius, life: 0.35, max: 0.35 });
  }

  function tracer(from, to, color) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 }));
    scene.add(line);
    tracers.push({ line, life: 0.06 });
  }

  function update(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      p.v.y -= 15 * dt;
      p.m.position.addScaledVector(p.v, dt);
      if (p.m.position.y < 0.05) { p.m.position.y = 0.05; p.v.multiplyScalar(0.5); }
      if (p.life <= 0) { scene.remove(p.m); particles.splice(i, 1); }
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.life -= dt;
      const k = 1 - r.life / r.max;
      r.m.scale.setScalar(0.2 + k * r.radius);
      r.m.material.opacity = 0.9 * (1 - k);
      if (r.life <= 0) { scene.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); rings.splice(i, 1); }
    }
    for (let i = tracers.length - 1; i >= 0; i--) {
      const t = tracers[i];
      t.life -= dt;
      if (t.life <= 0) { scene.remove(t.line); t.line.geometry.dispose(); t.line.material.dispose(); tracers.splice(i, 1); }
    }
  }

  function clear() {
    for (const p of particles) scene.remove(p.m);
    for (const r of rings) scene.remove(r.m);
    for (const t of tracers) scene.remove(t.line);
    particles.length = rings.length = tracers.length = 0;
  }

  return { burst, shockwave, tracer, update, clear };
}
