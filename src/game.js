// 主控制器：状态机（标题 → 战斗 → 遗物 → 商店 → … → 结算）、输入、射击与波次。
import * as THREE from '../vendor/three.module.min.js';
import { PLAYER, WEAPON, WAVES, ARENA, SETTLEMENT } from './config.js';
import { Bot } from './bots.js';
import { UI } from './ui.js';
import { createWorld } from './world.js';
import { initAudio, setVolume, sfx } from './audio.js';
import { loadSave, persist, resetSave, buyUpgrade, recordRun } from './meta.js';
import * as R from './run.js';

const DEBUG = new URLSearchParams(location.search).has('debug');

export class Game {
  constructor(canvas) {
    this.world = createWorld(canvas);
    this.camera = this.world.camera;
    this.ui = new UI((a, d) => this.onAction(a, d));
    this.save = loadSave();
    this.state = 'title';
    this.yaw = 0;
    this.pitch = 0;
    this.bots = [];
    this.run = null;
    this.firing = false;
    this.cooldown = 0;
    this.time = 0;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = WEAPON.range;
    this.center = new THREE.Vector2(0, 0);
    this.frustum = new THREE.Frustum();
    this.projM = new THREE.Matrix4();
    this.titleTab = 'play';
    this.timeScale = 1;
    this.autoAim = false; // 仅 ?debug 下用于自动化冒烟测试，正式玩法不存在
    this.bindInput(canvas);
    this.toTitle();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
    if (DEBUG) window.game = this;
  }

  // ---------------- 输入 ----------------

  bindInput(canvas) {
    document.addEventListener('mousemove', (e) => {
      if (this.state !== 'combat') return;
      if (!this.locked() && !DEBUG) return;
      const k = PLAYER.baseSensitivity * this.save.settings.sensitivity;
      this.yaw -= e.movementX * k;
      this.pitch -= e.movementY * k;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    });
    document.addEventListener('mousedown', (e) => {
      if (this.state !== 'combat') return;
      if (e.button === 0) this.firing = true;
      if (e.button === 2) this.tryFocus();
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('keydown', (e) => {
      if (this.state !== 'combat') return;
      if (e.code === 'KeyE' || e.code === 'Space') {
        e.preventDefault();
        this.tryFocus();
      }
    });
    document.addEventListener('pointerlockchange', () => {
      if (!this.locked() && this.state === 'combat' && !DEBUG) this.pause();
    });
    document.addEventListener('pointerlockerror', () => {
      if (this.state === 'combat' && !DEBUG) this.pause();
    });
    canvas.addEventListener('click', () => {
      if (this.state === 'combat' && !this.locked()) this.lock();
    });
  }

  locked() {
    return document.pointerLockElement === this.world.renderer.domElement;
  }

  lock() {
    if (DEBUG) return;
    try {
      const p = this.world.renderer.domElement.requestPointerLock();
      if (p && p.catch) p.catch(() => { if (this.state === 'combat') this.pause(); });
    } catch { /* 浏览器拒绝时玩家可再次点击 */ }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // ---------------- 界面动作 ----------------

  onAction(action, data) {
    initAudio(this.save.settings.volume);
    switch (action) {
      case 'tab':
        this.titleTab = data.tab;
        this.ui.title(this.save, this.titleTab);
        break;
      case 'start':
        this.startRun();
        break;
      case 'upgrade':
        if (buyUpgrade(this.save, data.id)) sfx.buy(); else sfx.deny();
        this.ui.title(this.save, this.titleTab);
        break;
      case 'setting': {
        const v = Number(data.value);
        this.save.settings[data.key] = v;
        persist(this.save);
        if (data.key === 'volume') { setVolume(v); document.getElementById('vol-val').textContent = `${Math.round(v * 100)}%`; }
        if (data.key === 'sensitivity') document.getElementById('sens-val').textContent = v.toFixed(2);
        break;
      }
      case 'resetSave':
        if (confirm('确定清空全部存档？')) { this.save = resetSave(); this.ui.title(this.save, this.titleTab); }
        break;
      case 'clearLog':
        this.save.shopLog = [];
        persist(this.save);
        this.ui.title(this.save, this.titleTab);
        break;
      case 'pickRelic':
        R.addRelic(this.run, data.id);
        sfx.buy();
        this.afterReward();
        break;
      case 'skipReward':
        this.afterReward();
        break;
      case 'buyHeal':
        this.shopResult(R.buyHeal(this.run, this.shop));
        break;
      case 'buyRelic':
        this.shopResult(R.buyRelic(this.run, this.shop, Number(data.slot)));
        break;
      case 'buyStardust':
        this.shopResult(R.buyStardust(this.run, this.shop));
        break;
      case 'leaveShop':
        R.closeShop(this.run, this.shop);
        this.shop = null;
        this.startWave();
        break;
      case 'resume':
        this.state = 'combat';
        this.ui.hideScreen();
        this.lock();
        break;
      case 'abandon':
        this.finish(false);
        break;
      case 'toTitle':
        this.toTitle();
        break;
      default:
        break;
    }
  }

  shopResult(ok) {
    if (ok) sfx.buy(); else sfx.deny();
    this.ui.shop(this.run, this.shop);
  }

  // ---------------- 流程 ----------------

  toTitle() {
    this.state = 'title';
    this.unlock();
    this.clearBots();
    this.ui.showHud(false);
    this.ui.title(this.save, this.titleTab);
  }

  startRun() {
    this.run = R.createRun(this.save);
    this.yaw = 0;
    this.pitch = 0;
    this.clearBots();
    if (this.run.extraChoice) {
      this.rewardContext = 'start';
      this.state = 'reward';
      this.ui.reward(this.run, R.rollRewardChoices(this.run), '开局补给 · 选择一个遗物');
    } else {
      this.startWave();
    }
  }

  startWave() {
    const run = this.run;
    const def = WAVES[run.waveIndex];
    R.startWave(run);
    // 生成出怪队列：类型打乱，间隔带随机抖动，角度限制在本波的扇区内
    const types = [];
    for (const [type, n] of Object.entries(def.count)) for (let i = 0; i < n; i++) types.push(type);
    for (let i = types.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [types[i], types[j]] = [types[j], types[i]];
    }
    // 扇区中心对准玩家当前朝向，后期波次 360°
    const center = this.yaw;
    const arc = (def.arc * Math.PI) / 180;
    let t = 1.6; // 开场准备时间
    this.spawnQueue = types.map((type) => {
      const item = { type, at: t, angle: center + Math.PI + (Math.random() - 0.5) * arc };
      t += def.interval * (0.6 + Math.random() * 0.8);
      return item;
    });
    this.waveTime = 0;
    this.waveDef = def;
    this.state = 'combat';
    this.firing = false;
    this.ui.hideScreen();
    this.ui.showHud(true);
    this.ui.renderRelicBar(run);
    this.ui.banner(def.name);
    this.lock();
  }

  endWave() {
    const run = this.run;
    run.waveIndex++;
    this.firing = false;
    run.focusTime = 0;
    if (run.waveIndex >= WAVES.length) {
      this.finish(true);
      return;
    }
    this.unlock();
    this.rewardContext = 'wave';
    this.state = 'reward';
    const choices = R.rollRewardChoices(run);
    if (!choices.length) { this.afterReward(); return; }
    this.ui.reward(run, choices, `${WAVES[run.waveIndex - 1].name} 清除 · 选择一个遗物`);
  }

  afterReward() {
    this.ui.renderRelicBar(this.run);
    if (this.rewardContext === 'start') {
      this.startWave();
      return;
    }
    this.state = 'shop';
    this.shop = R.openShop(this.run);
    this.ui.shop(this.run, this.shop);
  }

  pause() {
    this.state = 'paused';
    this.firing = false;
    this.ui.pause();
  }

  finish(victory) {
    const run = this.run;
    if (this.shop) { R.closeShop(run, this.shop); this.shop = null; }
    this.state = 'results';
    this.unlock();
    this.clearBots();
    this.ui.showHud(false);
    const s = run.stats;
    const settlement = {
      combo: Math.floor(run.maxCombo * SETTLEMENT.perMaxCombo),
      headshots: Math.floor(s.headshots * SETTLEMENT.perHeadshot),
      depth: run.waveIndex * SETTLEMENT.perWave,
      victory: victory ? SETTLEMENT.victoryBonus : 0,
      shop: run.stardustFromShop,
    };
    const stardust = Object.values(settlement).reduce((a, b) => a + b, 0);
    const reactions = this.reactions || [];
    const summary = {
      date: Date.now(),
      victory,
      waves: run.waveIndex,
      maxCombo: run.maxCombo,
      headshots: s.headshots,
      kills: s.kills,
      shots: s.shots,
      accuracy: s.shots ? s.hits / s.shots : 0,
      hsRate: s.hits ? s.headshots / s.hits : 0,
      reactionMs: reactions.length ? reactions.reduce((a, b) => a + b, 0) / reactions.length : null,
      goldEarned: s.goldEarned,
      stardust,
      relics: [...run.relics],
    };
    this.reactions = [];
    this.save.stardust += stardust;
    recordRun(this.save, summary, run.shopVisits);
    this.lastSummary = summary;
    this.ui.results(run, summary, settlement);
  }

  clearBots() {
    for (const b of this.bots) b.remove();
    this.bots = [];
    this.world.fx.clear();
  }

  // ---------------- 战斗 ----------------

  tryFocus() {
    if (R.activateFocus(this.run)) {
      sfx.focus();
      this.ui.banner('专注');
    }
  }

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000) * this.timeScale;
    this.last = now;
    if (this.state === 'combat') this.update(dt);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.world.fx.update(dt);
    this.world.renderer.render(this.world.scene, this.camera);
    requestAnimationFrame((t) => this.frame(t));
  }

  update(dt) {
    const run = this.run;
    this.waveTime += dt;
    this.time += dt;
    if (run.focusTime > 0) run.focusTime = Math.max(0, run.focusTime - dt);

    // 出怪
    const speedMul = this.waveDef.speedMul * R.enemySpeedMul(run);
    while (this.spawnQueue.length && this.spawnQueue[0].at <= this.waveTime) {
      const s = this.spawnQueue.shift();
      const bot = new Bot(s.type, this.world.scene, s.angle, ARENA.spawnRadius, speedMul);
      bot.spawnedAt = this.time;
      this.bots.push(bot);
    }

    if (this.autoAim) this.debugAim();
    this.camera.rotation.set(this.pitch, this.yaw, 0);

    // 视野检测：用于「甩枪反应」统计
    this.camera.updateMatrixWorld();
    this.projM.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projM);

    for (const bot of this.bots) {
      if (bot.dead) continue;
      if (bot.seenAt == null && this.frustum.containsPoint(bot.headWorld)) bot.seenAt = this.time;
      if (bot.update(dt, 1)) this.botReachedPlayer(bot);
    }
    this.bots = this.bots.filter((b) => !b.dead);

    // 射击
    this.cooldown -= dt;
    if (this.firing && this.cooldown <= 0 && this.state === 'combat') {
      this.shoot();
      this.cooldown = R.fireInterval(run, WEAPON.fireInterval);
    }

    if (this.state !== 'combat') return;
    this.ui.updateHud(run, `${this.waveDef.name} / ${WAVES.length}`, this.bots.length + this.spawnQueue.length);
    this.ui.drawRadar(this.bots, this.yaw);

    if (!this.spawnQueue.length && !this.bots.length) this.endWave();
  }

  shoot() {
    const run = this.run;
    run.stats.shots++;
    sfx.shot();
    this.raycaster.setFromCamera(this.center, this.camera);
    const meshes = this.bots.flatMap((b) => b.hitMeshes);
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    const muzzle = new THREE.Vector3(0.25, -0.25, -0.5).applyMatrix4(this.camera.matrixWorld);
    if (!hit) {
      const end = this.raycaster.ray.at(60, new THREE.Vector3());
      this.world.fx.tracer(muzzle, end, 0x8899bb);
      const res = R.registerMiss(run);
      if (res === 'broken') { sfx.comboBreak(); this.ui.comboBreak(); }
      else if (res === 'protected') this.floatCenter('专注保护', 'info');
      else if (res === 'safety') this.floatCenter('保险栓', 'info');
      else sfx.miss();
      return;
    }
    const { bot, part } = hit.object.userData;
    const head = part === 'head';
    this.world.fx.tracer(muzzle, hit.point, head ? 0xff9e00 : 0xffffff);
    if (bot.firstHitAt == null) {
      bot.firstHitAt = this.time;
      if (bot.seenAt != null) (this.reactions ||= []).push((this.time - bot.seenAt) * 1000);
    }
    R.registerHit(run, head);
    this.ui.hitmarker(head);
    if (head) sfx.headshot(); else sfx.hit();
    const dmg = WEAPON.damage * (head ? WEAPON.headshotMultiplier : 1);
    if (bot.damage(dmg)) this.killBot(bot, head);
    if (head && R.has(run, 'headblast')) this.headBlast(bot.position.clone(), bot);
  }

  killBot(bot, head) {
    if (bot.dead) return;
    const run = this.run;
    const gold = R.killGold(run, bot.def.gold);
    const pos = bot.headWorld;
    this.world.fx.burst(pos, bot.def.color, bot.type === 'heavy' ? 26 : 14);
    this.floatAt(pos, `+${gold}`, gold >= 10 ? 'gold big' : head ? 'gold head' : 'gold');
    sfx.kill();
    bot.remove();
    if (R.has(run, 'frostkill')) {
      for (const b of this.bots) if (!b.dead && b.position.distanceTo(bot.position) < 5) b.slowTime = 2;
      this.world.fx.shockwave(bot.position, 5, 0x9bf6ff);
    }
  }

  headBlast(center, source) {
    this.world.fx.shockwave(center, 3, 0xffd166);
    for (const b of [...this.bots]) {
      if (b === source || b.dead) continue;
      if (b.position.distanceTo(center) < 3 && b.damage(1)) this.killBot(b, false);
    }
  }

  botReachedPlayer(bot) {
    const run = this.run;
    const p = bot.position;
    // 受击方向（相对视线）：0 = 正前方
    const ang = Math.atan2(p.x, p.z);
    const rel = -(ang - this.yaw - Math.PI);
    bot.remove();
    const res = R.takeDamage(run, bot.def.damage);
    if (res.absorbed) { sfx.shield(); this.floatCenter('护盾抵挡', 'info'); }
    else { sfx.hurt(); this.ui.hurt(rel); }
    if (R.has(run, 'recoilarmor')) {
      for (const b of this.bots) if (!b.dead && b.distance < 8) b.knockback(36);
      this.world.fx.shockwave(new THREE.Vector3(0, 0, 0), 8, 0x4cc9f0);
    }
    if (res.dead) this.finish(false);
  }

  // ---------------- 辅助 ----------------

  floatAt(worldPos, text, cls) {
    const v = worldPos.clone().project(this.camera);
    if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) return;
    this.ui.floater(((v.x + 1) / 2) * window.innerWidth, ((1 - v.y) / 2) * window.innerHeight, text, cls);
  }

  floatCenter(text, cls) {
    this.ui.floater(window.innerWidth / 2, window.innerHeight / 2 + 60, text, cls);
  }

  // 仅调试：瞄准最近 bot 的头部，用于无人值守跑完整流程
  debugAim() {
    let best = null;
    for (const b of this.bots) if (!b.dead && (!best || b.distance < best.distance)) best = b;
    if (!best) { this.firing = false; return; }
    const h = best.headWorld.sub(this.camera.position);
    this.yaw = Math.atan2(-h.x, -h.z);
    this.pitch = Math.atan2(h.y, Math.hypot(h.x, h.z));
    this.firing = true;
  }
}

