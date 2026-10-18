// 强化机制测试：逐个检查关键强化的效果是否符合设计稿（docs/DESIGN.md §7）。
// 用法：python3 -m http.server 8000 &  node tools/upgrade-tests.mjs [url]
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:8000/?debug&norender';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url);
await page.waitForFunction(() => window.game);

const results = await page.evaluate(async () => {
  const out = [];
  const check = (name, cond, detail = '') => out.push({ name, ok: !!cond, detail: String(detail) });
  const R = await import('./src/run.js');
  const { UPGRADES } = await import('./src/upgrades.js');
  const { Bot } = await import('./src/bots.js');
  const g = window.game;

  const fresh = (ups = {}, extra = {}) => {
    g.startRun();
    const run = g.run;
    run.ups = { ...ups };
    Object.assign(run, extra);
    run.ammo = R.magSize(run);
    return run;
  };
  const dummy = (type = 'normal') => ({ type, hp: 10, maxHp: 10, hitsTaken: 0 });

  // ---- 爆头流 ----
  let run = fresh({ guillotine: 1 });
  check('断头台：爆头 4 伤害', g.shotDamage(dummy(), true) === 4, g.shotDamage(dummy(), true));
  check('断头台：身体 0 伤害', g.shotDamage(dummy(), false) === 0);
  run = fresh({ lethal: 1 });
  check('致命精度 + 处刑链 2：爆头 2+1+2', g.shotDamage(dummy(), true, { execBonus: 2 }) === 5);
  run = fresh({});
  check('静心 ×2 + 甩枪 ×3：爆头 2×2×3', g.shotDamage(dummy(), true, { calm: true, flick: true }) === 12);
  run = fresh({}, { keepsake: 'hunter', keepsakeLv: 1 });
  R.registerHit(run, true);
  check('猎手徽章：爆头 +3 连杀', run.combo === 3, run.combo);

  // ---- 扫射流 ----
  run = fresh({ drum: 1, mag: 2 });
  check('弹鼓 + 弹匣 2 级 = 28', R.magSize(run) === 28, R.magSize(run));
  check('弹鼓换弹 3.2 秒', Math.abs(R.baseReloadTime(run) - 3.2) < 1e-9);
  run = fresh({ tacreload: 1 });
  run.ammo = 6;
  check('战术换弹：剩一半手动换弹瞬间完成', R.startReload(run, true) === 'instant' && run.ammo === 10);
  run.ammo = 0;
  R.startReload(run, false);
  check('战术换弹：打空后换弹 ×2', Math.abs(run.reloadLeft - 3.2) < 1e-9, run.reloadLeft);
  run = fresh({ gambler: 1 }, { combo: 10 });
  check('赌徒之心：打空连杀减半', R.registerMiss(run) === 'halved' && run.combo === 5);
  R.registerHit(run, false);
  check('赌徒之心：命中增长减半', run.combo === 5.5, run.combo);
  run = fresh({ overheat: 1 });
  for (let i = 0; i < 25; i++) R.registerHit(run, false);
  check('过热：最多 20 层', run.heat === 20);
  check('过热：满层伤害 ×1.8', Math.abs(g.shotDamage(dummy(), false) - 1.8) < 1e-9);
  R.registerMiss(run);
  check('过热：打空 −5 层', run.heat === 15);
  run = fresh({ beltfeed: 1 });
  run.ammo = 3;
  for (let i = 0; i < 6; i++) R.registerHit(run, false);
  check('弹链：连续命中 6 次返还 1 发', run.ammo === 4, run.ammo);
  run = fresh({ rend: 1 });
  run.track.count = 4;
  check('撕裂：第 4 次连续命中 ×3', g.shotDamage(dummy(), false) === 3);
  run = fresh({ shred: 1 });
  check('碎甲：重甲兵第 3 次命中起 +1', g.shotDamage({ ...dummy('heavy'), hitsTaken: 3 }, false) === 2);

  // ---- 子弹时间流 ----
  run = fresh({ stasis: 1 }, { focus: 20 });
  R.activateFocus(run);
  check('时停：1.2 秒、世界静止', run.focusTime === 1.2 && R.bulletTimeScale(run) === 0);
  run = fresh({ timedebt: 1 }, { focus: 6 });
  check('时间债：25% 即可释放', R.canActivateFocus(run));
  R.activateFocus(run);
  check('时间债：时长按比例 = 1.2 秒', Math.abs(run.focusTime - 1.2) < 1e-9, run.focusTime);
  R.endBulletTime(run);
  check('时间债：结束后敌人加速同样时长', Math.abs(run.debtTime - 1.2) < 1e-9);
  run = fresh({ fragment: 1 });
  check('碎片化：专注上限减半、时长减半', R.focusMax(run) === 10 && R.focusDuration(run) === 2);
  run = fresh({ afterglow: 1 }, { focus: 20 });
  R.activateFocus(run);
  for (let i = 0; i < 30; i++) R.onKillInBulletTime(run);
  check('余韵：最多延长 2 秒', Math.abs(run.focusTime - 6) < 1e-9, run.focusTime);
  run = fresh({ echo: 1 }, { focus: 20 });
  R.activateFocus(run);
  for (let i = 0; i < 4; i++) R.onKillInBulletTime(run);
  R.endBulletTime(run);
  check('回响：击杀 ≥4 返还 25% 专注', Math.abs(run.focus - 5) < 1e-9, run.focus);
  run = fresh({ timeslit: 1 }, { focus: 20 });
  R.activateFocus(run);
  run.ammo = 0;
  check('时间缝隙：子弹时间中换弹瞬间完成', R.startReload(run, false) === 'instant');
  run = fresh({ overclock: 1 }, { focus: 20 });
  const before = R.fireInterval(run, 0.14);
  R.activateFocus(run);
  check('加速世界：子弹时间射速 +20%', Math.abs(before / R.fireInterval(run, 0.14) - 1.2) < 1e-9);

  // ---- 基础强化 ----
  run = fresh({});
  const hp0 = run.maxHp;
  R.addUpgrade(run, 'vigor');
  R.addUpgrade(run, 'vigor');
  check('体魄 2 级：生命上限 +20', run.maxHp === hp0 + 20 && run.ups.vigor === 2);
  run = fresh({ guard: 2 }, { shield: 0 });
  R.startWave(run);
  R.startWave(run);
  check('护盾 2 级：每波补到 2 层，不跨波累积', run.shield === 2, run.shield);

  // ---- 三选一规则 ----
  run = fresh({});
  run.waveIndex = 2;
  check('第 3 波之前不出核心', R.coreChance(run) === 0);
  run.waveIndex = 5;
  run.wavesSinceCore = 3;
  check('核心概率 4% + 3%×3 = 13%', Math.abs(R.coreChance(run) - 0.13) < 1e-9);
  run.unlocked = [];
  let dup = 0;
  let locked = 0;
  let needs = 0;
  let cores = 0;
  for (let i = 0; i < 400; i++) {
    const c = R.rollRewardChoices(run);
    if (new Set(c).size !== c.length) dup++;
    for (const id of c) {
      const u = UPGRADES[id];
      if (u.locked) locked++;
      if (u.requires) needs++;
      if (u.cat === 'core') cores++;
    }
  }
  check('三选一无重复', dup === 0);
  check('未解锁的强化不出现', locked === 0, locked);
  check('缺少前置的配套不出现（如散热片）', needs === 0, needs);
  check('核心会出现，且比例接近 13%', cores > 60 && cores < 260, `${cores}/1200`);
  run = fresh({}, { keepsake: 'prism', keepsakeLv: 1 });
  let prismOk = 0;
  for (let i = 0; i < 100; i++) {
    const c = R.rollRewardChoices(run);
    const cats = c.map((id) => UPGRADES[id].school || UPGRADES[id].cat);
    if (new Set(cats).size === 3) prismOk++;
  }
  check('三棱镜：三个选项类别不同', prismOk === 100, prismOk);
  run = fresh({});
  const only = R.rollRewardChoices(run, 3, { school: 'spray' });
  check('流派三选一只出该流派', only.length === 3 && only.every((id) => UPGRADES[id].school === 'spray'), only);
  run = fresh({}, { keepsake: 'watch', keepsakeLv: 2 });
  let guaranteed = 0;
  for (let i = 0; i < 100; i++) if (R.rollRewardChoices(run).some((id) => UPGRADES[id].school === 'time')) guaranteed++;
  check('怀表 2 级：第一次三选一保底子弹时间流', guaranteed === 100, guaranteed);

  // ---- 商店（卡戎） ----
  run = fresh({});
  run.waveIndex = 5;
  check('第 5 波后是卡戎商店', R.isShopWave(run));
  run.waveIndex = 4;
  check('区域内不是卡戎商店', !R.isShopWave(run));
  run.waveIndex = 1;
  let wells = 0;
  for (let i = 0; i < 100; i++) if (R.rollWell(run)) wells++;
  check('第 2 波之前不出卡戎之井', wells === 0);
  run = fresh({}, { gold: 2000 });
  run.waveIndex = 5;
  let shop = R.openShop(run, 'shop');
  check('卡戎商店：2 个强化 + 1 个基础强化', shop.items.length === 3 && UPGRADES[shop.items[2].id].cat === 'base', shop.items.map((x) => x.id));
  check('卡戎商店：治疗、生命之心、星尘', shop.goods.map((g) => g.id).join() === 'heal,heart,stardust');
  R.buyItem(run, shop, 0);
  const soldId = shop.items[0].id;
  const p1 = R.goldRerollPrice(run, shop);
  R.rerollShop(run, shop, false);
  check('金币刷新：已买的格子保留', shop.items[0].id === soldId && shop.items[0].sold);
  check('金币刷新：每次涨价', R.goldRerollPrice(run, shop) > p1, `${p1} → ${R.goldRerollPrice(run, shop)}`);
  const dice0 = run.rerolls;
  check('命运骰刷新：消耗 1 个骰子', R.rerollShop(run, shop, true) && run.rerolls === dice0 - 1);
  run.rerolls = 0;
  check('没有骰子不能用骰子刷新', !R.rerollShop(run, shop, true));
  const maxHp0 = run.maxHp;
  R.buyGood(run, shop, 1);
  check('生命之心：上限 +15 且每家店限一个', run.maxHp === maxHp0 + 15 && shop.goods[1].sold);
  run = fresh({}, { gold: 2000 });
  run.waveIndex = 4;
  shop = R.openShop(run, 'well');
  check('卡戎之井：3 件不同的临时道具', shop.goods.length === 3 && new Set(shop.goods.map((g) => g.id)).size === 3);
  check('卡戎之井：不能用金币刷新', !R.rerollShop(run, shop, false));
  shop.goods[0] = { id: 'wrath', sold: false };
  R.buyGood(run, shop, 0);
  check('怒火药剂：伤害 ×1.2，持续 2 波', R.tempDamageMul(run) === 1.2 && run.temp[0].waves === 2);
  R.finishWave(run);
  R.finishWave(run);
  check('临时效果到期后消失', R.tempDamageMul(run) === 1);
  run = fresh({});
  const startDice = run.rerolls;
  run.waveIndex = 4;
  R.finishWave(run);
  check('进入新区域 +1 命运骰', run.rerolls === startDice + 1, run.rerolls);

  // ---- 场景：穿颅弹 ----
  run = fresh({ pierce: 1 });
  g.clearBots();
  g.spawnQueue = [];
  g.waveDef = { name: 't', speedMul: 1 };
  g.state = 'combat';
  const line = [5, 8, 11].map((d) => {
    const b = new Bot('normal', g.world.scene, Math.PI, d, 0);
    b.place();
    g.bots.push(b);
    return b;
  });
  const headY = line[0].headWorld.y;
  g.yaw = 0;
  g.pitch = Math.atan2(headY - 1.6, 5);
  g.camera.rotation.set(g.pitch, g.yaw, 0);
  g.camera.updateMatrixWorld();
  g.shoot();
  const killed = line.filter((b) => b.dead).length;
  check('穿颅弹：一发爆头穿死 3 个排成一线的普通兵', killed === 3, killed);
  check('穿透命中不计入命中统计', run.stats.hits === 1 && run.stats.shots === 1);
  g.clearBots();
  g.state = 'title';
  return out;
});

let fail = 0;
for (const r of results) {
  if (!r.ok) fail++;
  console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : `  （实际：${r.detail}）`}`);
}
console.log(`\n${results.length - fail}/${results.length} 通过${errors.length ? `\n页面错误：\n${errors.join('\n')}` : ''}`);
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
