// 主控制器：状态机（标题 → 战斗 → 强化三选一 → 商店 → … → 结算）、输入、射击、波次与强化效果。
import * as THREE from '../vendor/three.module.min.js';
import { PLAYER, WEAPON, WAVES, ARENA, SETTLEMENT, FOCUS, THREAT, MOVEMENT, KEEPSAKES, rollMove } from './config.js';
import { SCHOOLS } from './upgrades.js';
import { Bot } from './bots.js';
import { UI } from './ui.js';
import { createWorld } from './world.js';
import { initAudio, setVolume, sfx } from './audio.js';
import { loadSave, persist, resetSave, buyUpgrade, buyKeepsake, selectKeepsake, recordRun } from './meta.js';
import { META_UPGRADES } from './config.js';
import * as R from './run.js';
import { SimAimer, SKILLS } from './simaim.js';
import { gameSens, radPerCount, sensInSource } from './sens.js';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const NORENDER = DEBUG && params.has('norender'); // 平衡测试时跳过渲染以加速

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
    this.tmpFwd = new THREE.Vector3();
    this.tmpV = new THREE.Vector3();
    this.projM = new THREE.Matrix4();
    this.titleTab = 'play';
    this.timeScale = 1;
    this.worldScale = 1; // 子弹时间：只影响敌人、出怪与特效，不影响玩家
    this.autoAim = false; // 仅 ?debug 下用于自动化冒烟测试，正式玩法不存在
    this.yawHist = [];    // 甩枪大师：最近 0.4 秒的视角
    this.flickReady = false;
    this.rawStatus = 'unknown'; // 原始输入：on / unsupported / unknown
    this.applyView();
    this.bindInput(canvas);
    this.toTitle();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
    if (DEBUG) Object.assign(window, { game: this, SimAimer, SKILLS, META_UPGRADES });
  }

  // ---------------- 输入 ----------------

  bindInput(canvas) {
    document.addEventListener('mousemove', (e) => {
      if (this.state !== 'combat') return;
      if (!this.locked() && !DEBUG) return;
      const k = this.radPerCount;
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
      if (e.code === 'KeyR') this.tryReload(true);
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

  // 设置变化后刷新：每 count 弧度、FOV
  applyView() {
    const st = this.save.settings;
    this.radPerCount = radPerCount(gameSens(st));
    this.camera.fov = st.fov;
    this.camera.updateProjectionMatrix();
  }

  locked() {
    return document.pointerLockElement === this.world.renderer.domElement;
  }

  lock() {
    if (DEBUG) return;
    const el = this.world.renderer.domElement;
    const fail = () => { if (this.state === 'combat') this.pause(); };
    try {
      if (!this.save.settings.rawInput) {
        const p = el.requestPointerLock();
        if (p && p.catch) p.catch(fail);
        return;
      }
      // 原始输入：绕过系统的指针速度和加速（Chrome / Edge 支持）
      const p = el.requestPointerLock({ unadjustedMovement: true });
      if (!p || !p.then) { this.rawStatus = 'unknown'; return; }
      p.then(() => { this.rawStatus = 'on'; }).catch((e) => {
        if (e && e.name === 'NotSupportedError') {
          this.rawStatus = 'unsupported';
          const q = el.requestPointerLock();
          if (q && q.catch) q.catch(fail);
        } else fail();
      });
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
        this.ui.title(this.save, this.titleTab, this.rawStatus);
        break;
      case 'start':
        this.startRun();
        break;
      case 'upgrade':
        if (buyUpgrade(this.save, data.id)) sfx.buy(); else sfx.deny();
        this.ui.title(this.save, this.titleTab, this.rawStatus);
        break;
      case 'buyKeepsake':
        if (buyKeepsake(this.save, data.id)) sfx.buy(); else sfx.deny();
        this.ui.title(this.save, this.titleTab, this.rawStatus);
        break;
      case 'keepsake':
        selectKeepsake(this.save, data.id || null);
        this.ui.title(this.save, this.titleTab, this.rawStatus);
        break;
      case 'setting': {
        const st = this.save.settings;
        const v = data.key === 'rawInput' ? !!data.value : Number(data.value);
        if (typeof v === 'number' && !Number.isFinite(v)) break;
        // 正在输入时可能出现空值或 0，先不生效，避免视角转不动
        if ((data.key === 'sensInput' || data.key === 'dpi') && !(v > 0)) break;
        st[data.key] = v;
        persist(this.save);
        this.applyView();
        if (data.key === 'volume') { setVolume(v); document.getElementById('vol-val').textContent = `${Math.round(v * 100)}%`; }
        if (data.key === 'fov') document.getElementById('fov-val').textContent = `${v.toFixed(1)}°`;
        this.ui.refreshSensInfo(this.save, this.rawStatus);
        break;
      }
      case 'sensSource': {
        // 切换来源时把当前手感换算过去，保持转速不变
        const st = this.save.settings;
        const sens = gameSens(st);
        st.sensSource = data.id;
        st.sensInput = sensInSource(data.id, sens, st.dpi);
        persist(this.save);
        this.applyView();
        this.ui.title(this.save, this.titleTab, this.rawStatus);
        break;
      }
      case 'fovPreset':
        this.save.settings.fov = Number(data.value);
        persist(this.save);
        this.applyView();
        this.ui.title(this.save, this.titleTab, this.rawStatus);
        break;
      case 'resetSave':
        if (confirm('确定清空全部存档？')) { this.save = resetSave(); this.applyView(); this.ui.title(this.save, this.titleTab, this.rawStatus); }
        break;
      case 'clearLog':
        this.save.shopLog = [];
        persist(this.save);
        this.ui.title(this.save, this.titleTab, this.rawStatus);
        break;
      case 'pick':
        R.addUpgrade(this.run, data.id);
        sfx.buy();
        this.afterReward();
        break;
      case 'skipReward':
        this.afterReward();
        break;
      case 'buyHeal':
        this.shopResult(R.buyHeal(this.run, this.shop));
        break;
      case 'buyItem':
        this.shopResult(R.buyItem(this.run, this.shop, Number(data.slot)));
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
    this.ui.title(this.save, this.titleTab, this.rawStatus);
  }

  startRun() {
    this.run = R.createRun(this.save);
    this.yaw = 0;
    this.pitch = 0;
    this.reactions = [];
    this.clearBots();
    // 开局三选一：星尘工坊「开局补给」、遗物 3 级的流派三选一
    this.openingPicks = [];
    const run = this.run;
    const ks = KEEPSAKES.find((k) => k.id === run.keepsake);
    if (ks && ks.school && run.keepsakeLv >= 3) {
      this.openingPicks.push({ title: `${ks.name} · 选择一个${SCHOOLS[ks.school].name}强化`, opts: { school: ks.school } });
    }
    if (run.extraChoice) this.openingPicks.push({ title: '开局补给 · 选择一个强化', opts: {} });
    this.nextOpeningPick();
  }

  nextOpeningPick() {
    const next = this.openingPicks.shift();
    if (!next) { this.startWave(); return; }
    const choices = R.rollRewardChoices(this.run, 3, next.opts);
    if (!choices.length) { this.nextOpeningPick(); return; }
    this.rewardContext = 'start';
    this.state = 'reward';
    this.ui.reward(this.run, choices, next.title);
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
    const pincer = (def.mobility && def.mobility.pincer) || 0;
    this.spawnQueue = [];
    for (let i = 0; i < types.length; i++) {
      const angle = center + Math.PI + (Math.random() - 0.5) * arc;
      this.spawnQueue.push({ type: types[i], at: t, angle });
      // 夹击：下一个敌人同时出现在正对面（360° 波次才有）
      if (def.arc >= 360 && i + 1 < types.length && Math.random() < pincer) {
        this.spawnQueue.push({ type: types[++i], at: t, angle: angle + Math.PI });
      }
      t += def.interval * (0.6 + Math.random() * 0.8);
    }
    this.waveTime = 0;
    this.waveDef = def;
    this.state = 'combat';
    this.firing = false;
    this.worldScale = 1;
    this.yawHist = [];
    this.ui.hideScreen();
    this.ui.showHud(true);
    this.ui.renderUpgradeBar(run);
    this.ui.banner(def.name);
    this.lock();
  }

  endWave() {
    const run = this.run;
    R.logWaveEnd(run, true);
    R.finishWave(run);
    this.firing = false;
    this.ui.endCombatFx();
    if (run.waveIndex >= WAVES.length) {
      this.finish(true);
      return;
    }
    this.unlock();
    this.rewardContext = 'wave';
    this.state = 'reward';
    const choices = R.rollRewardChoices(run);
    if (!choices.length) { this.afterReward(); return; }
    this.ui.reward(run, choices, `${WAVES[run.waveIndex - 1].name} 清除 · 选择一个强化`);
  }

  afterReward() {
    this.ui.renderUpgradeBar(this.run);
    if (this.rewardContext === 'start') {
      this.nextOpeningPick();
      return;
    }
    this.run.rewardsTaken++;
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
    R.logWaveEnd(run, false);
    if (this.shop) { R.closeShop(run, this.shop); this.shop = null; }
    this.state = 'results';
    this.ui.endCombatFx();
    this.unlock();
    this.clearBots();
    this.ui.showHud(false);
    const s = run.stats;
    const settlement = {
      combo: Math.floor(SETTLEMENT.comboSqrt * Math.sqrt(run.maxCombo)),
      headshots: Math.floor(s.headshots * SETTLEMENT.perHeadshot),
      depth: run.waveIndex * SETTLEMENT.perWave,
      victory: victory ? SETTLEMENT.victoryBonus : 0,
      shop: run.stardustFromShop,
    };
    if (run.keepsake === 'blank') {
      settlement.blank = Math.round(0.25 * (settlement.combo + settlement.headshots + settlement.depth + settlement.victory));
    }
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
      moverAcc: s.moverHits + s.moverMisses >= 10 ? s.moverHits / (s.moverHits + s.moverMisses) : null,
      goldEarned: s.goldEarned,
      stardust,
      upgrades: Object.keys(run.ups),
      keepsake: run.keepsake,
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
      this.ui.banner('子弹时间');
    }
  }

  // manual：玩家主动按 R（战术换弹只对主动换弹生效）
  tryReload(manual = false) {
    const res = R.startReload(this.run, manual);
    if (res === 'instant') sfx.reloadDone();
    else if (res === 'started') sfx.reloadStart();
  }

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000) * this.timeScale;
    this.last = now;
    if (this.state === 'combat') this.update(dt);
    else this.worldScale = 1;
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.world.fx.update(dt * this.worldScale);
    if (!NORENDER) this.world.renderer.render(this.world.scene, this.camera);
    requestAnimationFrame((t) => this.frame(t));
  }

  // dt 为真实时间：玩家的转身、射速、换弹、子弹时间计时都用它；
  // wdt 为世界时间：敌人移动、出怪节奏、特效用它，子弹时间里会变慢。
  update(dt) {
    const run = this.run;
    // 子弹时间 / 时间债计时（真实时间）
    if (run.focusTime > 0) {
      run.focusTime = Math.max(0, run.focusTime - dt);
      if (run.focusTime === 0) this.onBulletTimeEnd();
    } else if (run.debtTime > 0) {
      run.debtTime = Math.max(0, run.debtTime - dt);
    }
    const target = run.focusTime > 0 ? R.bulletTimeScale(run) : run.debtTime > 0 ? 1.5 : 1;
    // 惯性：退出子弹时间时用 2 秒慢慢恢复
    const recovering = target > this.worldScale && run.focusTime <= 0 && R.has(run, 'inertia');
    const rate = recovering ? dt * (1 - FOCUS.timeScale) / 1.2 : dt / FOCUS.ramp;
    this.worldScale += Math.max(-rate, Math.min(rate, target - this.worldScale));
    const wdt = dt * this.worldScale;
    this.waveTime += wdt;
    this.time += dt;

    // 出怪
    const speedMul = this.waveDef.speedMul * R.enemySpeedMul(run);
    while (this.spawnQueue.length && this.spawnQueue[0].at <= this.waveTime) {
      const s = this.spawnQueue.shift();
      const bot = new Bot(s.type, this.world.scene, s.angle, ARENA.spawnRadius, speedMul, rollMove(this.waveDef, s.type));
      bot.spawnedAt = this.time;
      this.bots.push(bot);
    }

    if (this.autoAim) this.debugAim();
    if (this.sim) this.sim.update(dt);
    this.camera.rotation.set(this.pitch, this.yaw, 0);

    // 甩枪大师：0.4 秒内转身 ≥ 60°
    this.yawHist.push({ t: this.time, yaw: this.yaw });
    while (this.yawHist.length && this.yawHist[0].t < this.time - 0.4) this.yawHist.shift();
    this.flickReady = R.has(run, 'flickmaster') && this.yawHist.some((h) => Math.abs(h.yaw - this.yaw) >= Math.PI / 3);

    // 视野检测：用于「甩枪反应」统计
    this.camera.updateMatrixWorld();
    this.projM.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projM);

    // 闪避兵需要知道准星离它多近
    const fwd = this.camera.getWorldDirection(this.tmpFwd);
    const eye = this.camera.position;
    for (const bot of this.bots) {
      if (bot.dead) continue;
      if (bot.move.mode === 'dodge') {
        const p = bot.position;
        this.tmpV.set(p.x - eye.x, p.y + bot.bodyH * 0.7 - eye.y, p.z - eye.z).normalize();
        bot.aimAngle = Math.acos(Math.min(1, fwd.dot(this.tmpV)));
      }
      const visible = this.frustum.containsPoint(bot.headWorld);
      if (visible && bot.seenAt == null) bot.seenAt = this.time;
      if (!visible) bot.offscreenAt = this.time;
      // 压制火力：1 秒没被命中就恢复
      if (bot.suppress && this.time - bot.lastHitAt > 1) bot.suppress = 0;
      if (bot.update(wdt, 1 - 0.08 * (bot.suppress || 0))) { this.botReachedPlayer(bot); continue; }
      if (bot.burn) this.tickBurn(bot, wdt);
    }
    this.bots = this.bots.filter((b) => !b.dead);
    if (this.state !== 'combat') return;

    // 换弹与射击（真实时间）
    if (R.tickReload(run, dt)) sfx.reloadDone();
    this.cooldown -= dt;
    let fired = false;
    if (this.firing && this.cooldown <= 0 && !R.reloading(run) && run.ammo > 0) {
      this.shoot();
      fired = true;
      this.cooldown = R.fireInterval(run, WEAPON.fireInterval);
      if (run.ammo <= 0) this.tryReload(false);
    }
    R.tickHeat(run, dt, fired);

    if (this.state !== 'combat') return;
    this.ui.updateHud(run, `${this.waveDef.name} / ${WAVES.length}`, this.bots.length + this.spawnQueue.length, { flick: this.flickReady });
    this.ui.drawRadar(this.bots, this.yaw);
    this.ui.drawThreats(this.offscreenThreats(), this.time);

    if (!this.spawnQueue.length && !this.bots.length) this.endWave();
  }

  shoot() {
    const run = this.run;
    run.stats.shots++;
    run.ammo--;
    sfx.shot();
    this.raycaster.setFromCamera(this.center, this.camera);
    const meshes = this.bots.flatMap((b) => b.hitMeshes);
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    const muzzle = new THREE.Vector3(0.25, -0.25, -0.5).applyMatrix4(this.camera.matrixWorld);
    if (!hit) {
      const end = this.raycaster.ray.at(60, new THREE.Vector3());
      this.world.fx.tracer(muzzle, end, 0x8899bb);
      const near = this.nearestToCrosshair(0.09);
      if (near && near.mobile) run.stats.moverMisses++;
      const res = R.registerMiss(run);
      if (res === 'broken') { sfx.comboBreak(); this.ui.comboBreak(); }
      else if (res === 'safety') this.floatCenter('保险栓', 'info');
      else if (res === 'halved') { sfx.miss(); this.floatCenter('连杀减半', 'info'); }
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
    if (bot.mobile) run.stats.moverHits++;

    // 命中前的状态（用于伤害计算）
    const wasFull = bot.hp >= bot.maxHp;
    const flick = head && this.flickReady;
    const calm = R.has(run, 'calm') && run.idle >= 0.5;
    let execBonus = 0;
    if (head && R.has(run, 'execchain')) {
      const ec = run.execChain;
      ec.bonus = this.time - ec.at <= 1 && ec.botId !== bot.id ? Math.min(3, ec.bonus + 1) : 0;
      ec.botId = bot.id;
      ec.at = this.time;
      execBonus = ec.bonus;
    }
    // 连续命中同一目标
    const tr = run.track;
    if (tr.botId === bot.id) {
      tr.count++;
      const gap = this.time - tr.lastHit;
      if (gap < 0.3) tr.time += gap;
    } else {
      tr.botId = bot.id;
      tr.count = 1;
      tr.time = 0;
    }
    tr.lastHit = this.time;
    bot.hitsTaken = (bot.hitsTaken || 0) + 1;

    const dmg = this.shotDamage(bot, head, { flick, calm, execBonus });
    R.registerHit(run, head, { bonusCombo: flick ? 3 : 0 });
    this.ui.hitmarker(head);
    if (head) sfx.headshot(); else sfx.hit();
    if (flick) this.floatCenter('甩枪！', 'head');
    if (head) R.onHeadshotInBulletTime(run);
    if (run.bt) run.bt.hitBots.add(bot);

    if (R.has(run, 'suppress')) { bot.suppress = Math.min(5, tr.count); bot.lastHitAt = this.time; }
    if (R.has(run, 'trackshield') && !run.trackShieldUsed && tr.time >= 2) {
      run.trackShieldUsed = true;
      run.shield++;
      sfx.shield();
      this.floatCenter('跟枪护盾 +1', 'info');
    }
    const fullHeat = R.has(run, 'overheat') && run.heat >= 20;
    if (fullHeat) bot.burn = { left: 2, acc: 0 };

    if (bot.damage(dmg)) this.killBot(bot, { head, onetap: wasFull, fullHeat });
    if (head && R.has(run, 'headblast')) this.headBlast(bot.position.clone(), bot);
    if (head && R.has(run, 'pierce')) this.pierce(hit.point, this.raycaster.ray.direction.clone(), bot, dmg);
  }

  // 一发子弹的伤害。所有加成都只作用于已经命中的子弹
  shotDamage(bot, head, { flick = false, calm = false, execBonus = 0 } = {}) {
    const run = this.run;
    const guillotine = R.has(run, 'guillotine');
    if (!head && guillotine) return 0;
    let d = WEAPON.damage;
    if (head) d *= guillotine ? 4 : WEAPON.headshotMultiplier;
    if (head && R.has(run, 'lethal')) d += 1;
    if (head) d += execBonus;
    if (calm) d *= 2;
    if (flick) d *= 3;
    if (R.has(run, 'overheat')) d *= 1 + 0.04 * run.heat;
    if (R.has(run, 'rend') && run.track.count % 4 === 0) d *= 3;
    if (R.has(run, 'shred') && bot.type === 'heavy' && bot.hitsTaken >= 3) d += 1;
    return d;
  }

  // 穿颅弹：从命中点沿弹道继续，最多再穿 2 个目标；打到身体就停下
  pierce(from, dir, firstBot, shotDmg) {
    const run = this.run;
    const exclude = new Set([firstBot]);
    let origin = from.clone().addScaledVector(dir, 0.05);
    const rc = new THREE.Raycaster(origin, dir, 0, WEAPON.range);
    for (let n = 0; n < 2; n++) {
      rc.set(origin, dir);
      const meshes = this.bots.filter((b) => !b.dead && !exclude.has(b)).flatMap((b) => b.hitMeshes);
      const h = rc.intersectObjects(meshes, false)[0];
      if (!h) break;
      const { bot, part } = h.object.userData;
      const head = part === 'head';
      this.world.fx.tracer(origin, h.point, 0xffd166);
      const dmg = head ? Math.ceil(shotDmg * 0.75) : (R.has(run, 'guillotine') ? 0 : 1);
      R.registerHit(run, head, { extra: true });
      if (bot.damage(dmg)) this.killBot(bot, { head, indirect: true });
      exclude.add(bot);
      origin = h.point.clone().addScaledVector(dir, 0.05);
      if (!head) break;
    }
  }

  tickBurn(bot, wdt) {
    const burn = bot.burn;
    burn.acc += wdt;
    while (burn.acc >= 0.5 && burn.left > 0 && !bot.dead) {
      burn.acc -= 0.5;
      burn.left -= 0.5;
      this.world.fx.burst(bot.headWorld, 0xff6b35, 4, 2);
      if (bot.damage(1)) this.killBot(bot, { indirect: true });
    }
    if (burn.left <= 0) bot.burn = null;
  }

  // ctx：head 爆头击杀 / onetap 满血一枪打死 / indirect 爆炸穿透灼烧等间接击杀 / fullHeat 满热击杀
  killBot(bot, ctx = {}) {
    if (bot.dead) return;
    const run = this.run;
    let base = bot.def.gold + (MOVEMENT.goldBonus[bot.move.mode] || 0);
    if (ctx.onetap && R.has(run, 'bounty')) base += 2;
    const glance = ctx.head && R.has(run, 'glance') && bot.offscreenAt != null && this.time - bot.offscreenAt <= 1;
    const gold = R.killGold(run, base, glance ? 2 : 1);
    if (ctx.onetap && R.has(run, 'onetap')) R.refundAmmo(run, 2);
    if (ctx.indirect && R.has(run, 'aftershock')) R.addCombo(run, 2);
    R.onKillInBulletTime(run);
    const pos = bot.headWorld;
    this.world.fx.burst(pos, bot.def.color, bot.type === 'heavy' ? 26 : 14);
    this.floatAt(pos, `+${gold}`, gold >= 10 ? 'gold big' : ctx.head ? 'gold head' : 'gold');
    sfx.kill();
    bot.remove();
    if (ctx.fullHeat && R.has(run, 'molten')) {
      let near = null;
      for (const b of this.bots) {
        if (b.dead || b.burn) continue;
        const d = b.position.distanceTo(bot.position);
        if (d < 4 && (!near || d < near.d)) near = { b, d };
      }
      if (near) { near.b.burn = { left: 2, acc: 0 }; this.world.fx.shockwave(bot.position, 4, 0xff6b35); }
    }
  }

  onBulletTimeEnd() {
    const bt = R.endBulletTime(this.run);
    if (R.has(this.run, 'stasisround')) {
      for (const b of bt.hitBots) if (!b.dead) b.slowTime = Math.max(b.slowTime, 1);
    }
    if (this.run.debtTime > 0) this.floatCenter('时间债：敌人加速', 'warn');
  }

  headBlast(center, source) {
    this.world.fx.shockwave(center, 3, 0xffd166);
    for (const b of [...this.bots]) {
      if (b === source || b.dead) continue;
      if (b.position.distanceTo(center) < 3 && b.damage(1)) this.killBot(b, { indirect: true });
    }
  }

  botReachedPlayer(bot) {
    const run = this.run;
    const p = bot.position;
    // 受击方向（相对视线）：0 = 正前方
    const ang = Math.atan2(p.x, p.z);
    const rel = -(ang - this.yaw - Math.PI);
    bot.remove();
    const res = R.takeDamage(run, Math.round(bot.def.damage * (this.waveDef.damageMul || 1)));
    // 平衡分析用：记录被哪种 bot / 机动碰到
    const key = `${bot.type}:${bot.move.mode}`;
    (run.stats.hurtBy ||= {})[key] = (run.stats.hurtBy[key] || 0) + 1;
    if (res.absorbed) { sfx.shield(); this.floatCenter('护盾抵挡', 'info'); }
    else { sfx.hurt(); this.ui.hurt(rel); }
    if (R.has(run, 'recoilarmor')) {
      for (const b of this.bots) if (!b.dead && b.distance < 8) b.knockback(36);
      this.world.fx.shockwave(new THREE.Vector3(0, 0, 0), 8, 0x4cc9f0);
    }
    if (res.dead) this.finish(false);
  }

  // ---------------- 辅助 ----------------

  // 打空时离准星最近（角度小于 maxAngle 弧度）的 bot，用来估算「对移动目标的命中率」
  nearestToCrosshair(maxAngle) {
    const ray = this.raycaster.ray;
    const v = new THREE.Vector3();
    let best = null;
    let bestAng = maxAngle;
    for (const b of this.bots) {
      if (b.dead) continue;
      v.copy(b.position).setY(b.position.y + b.bodyH * 0.7).sub(ray.origin).normalize();
      const ang = Math.acos(Math.min(1, v.dot(ray.direction)));
      if (ang < bestAng) { bestAng = ang; best = b; }
    }
    return best;
  }

  offscreenThreats() {
    const out = [];
    const v = new THREE.Vector3();
    for (const b of this.bots) {
      if (b.dead) continue;
      const d = b.distance;
      if (d > THREAT.range) continue;
      v.set(b.position.x, 1, b.position.z);
      if (this.frustum.containsPoint(v)) continue;
      // 相对视线的水平角：0 = 正前，正数 = 右侧
      let rel = this.yaw + Math.PI - Math.atan2(b.position.x, b.position.z);
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      const k = 1 - Math.max(0, d - PLAYER.hitRadius) / (THREAT.range - PLAYER.hitRadius);
      out.push({ rel, k });
    }
    return out;
  }

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

