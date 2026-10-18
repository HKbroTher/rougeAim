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

  const near = (a, b) => Math.abs(a - b) < 1e-9;

  // ---- 伤害模型 ----
  let run = fresh({});
  check('基础：身体 2、爆头 ×1.5 = 3', g.shotDamage(dummy(), false) === 2 && g.shotDamage(dummy(), true) === 3);
  run = fresh({ guillotine: 1 });
  check('断头台：爆头 ×3 = 6（一枪普通兵）', g.shotDamage(dummy(), true) === 6, g.shotDamage(dummy(), true));
  check('断头台：身体 −50%', g.shotDamage(dummy(), false) === 1);
  run = fresh({ precision: 1, lethal: 1 });
  check('精确打击 + 致命精度 + 处刑链 2：2×2.25+1.5+2', near(g.shotDamage(dummy(), true, { execBonus: 2 }), 8));
  run = fresh({});
  check('静心 ×2 + 甩枪 ×2：爆头 3×2×2', g.shotDamage(dummy(), true, { calm: true, flick: true }) === 12);
  run = fresh({}, { keepsake: 'hunter', keepsakeLv: 1 });
  check('猎手徽章：爆头倍率 +0.25', near(g.shotDamage(dummy(), true), 3.5));
  run = fresh({ hollow: 1 });
  check('空尖弹：身体 ×1.5 = 3（两枪普通兵）', g.shotDamage(dummy(), false) === 3);

  // ---- 火力评级 ----
  run = fresh({});
  R.onDamage(run, 6, true);
  check('评级：伤害 + 击杀加进度（6+2）', run.rating.points === 8 && run.rating.tier === 0);
  R.onDamage(run, 14, false);
  check('评级：满 20 升到 C，溢出保留', run.rating.tier === 1 && run.rating.points === 2, JSON.stringify(run.rating));
  R.registerMiss(run);
  check('评级：打空只扣 0.5，不清零', run.rating.tier === 1 && run.rating.points === 1.5);
  R.takeDamage(run, 10);
  check('评级：被碰到降一级', run.rating.tier === 0 && run.rating.points === 12, JSON.stringify(run.rating));
  run.rating.idle = 0;
  R.tickRating(run, 1);
  check('评级：1.2 秒内不回落', run.rating.points === 12);
  R.tickRating(run, 1);
  check('评级：之后每秒回落 6', near(run.rating.points, 12 - 6 * 0.8), run.rating.points);
  run = fresh({ steady: 1 });
  R.onDamage(run, 10, false);
  R.registerMiss(run);
  R.tickRating(run, 5);
  check('稳定火力：不回落、打空不扣', run.rating.points === 10);
  run = fresh({ safety: 1 }, { rating: { tier: 2, points: 5, idle: 0, peak: 2 } });
  R.takeDamage(run, 10);
  check('保险栓：每波第一次被碰到不降级', run.rating.tier === 2);
  R.takeDamage(run, 10);
  check('保险栓：第二次照常降级', run.rating.tier === 1);
  run = fresh({}, { rating: { tier: 3, points: 0, idle: 0, peak: 3 } });
  check('评级 A：金币 ×1.65', R.killGold(run, 10) === 17);
  run = fresh({});
  R.onDamage(run, 10, false);
  check('专注按伤害充能（10 × 0.35）', near(run.focus, 3.5), run.focus);

  // ---- 扫射流：按持续开火时间，打空不打断 ----
  run = fresh({ drum: 1, mag: 2 });
  check('弹鼓 + 弹匣 2 级 = 28', R.magSize(run) === 28, R.magSize(run));
  check('弹鼓换弹 3.2 秒', near(R.baseReloadTime(run), 3.2));
  run = fresh({ tacreload: 1 });
  run.ammo = 6;
  check('战术换弹：剩一半手动换弹瞬间完成', R.startReload(run, true) === 'instant' && run.ammo === 10);
  run.ammo = 0;
  R.startReload(run, false);
  check('战术换弹：打空后换弹 ×2', near(run.reloadLeft, 3.2), run.reloadLeft);
  run = fresh({ overheat: 1 });
  for (let i = 0; i < 30; i++) R.tickFire(run, 0.1, true);
  check('过热：持续开火 2 秒满 20 层', run.heat === 20);
  check('过热：满层伤害 ×1.6', near(g.shotDamage(dummy(), false), 3.2));
  R.registerMiss(run);
  check('过热：打空不掉热度', run.heat === 20);
  R.tickFire(run, 0.4, false);
  R.tickFire(run, 0.5, false);
  check('过热：停火 0.5 秒后每秒 −8 层', near(run.heat, 20 - 8 * 0.5), run.heat);
  run = fresh({ beltfeed: 1 });
  run.ammo = 3;
  for (let i = 0; i < 8; i++) R.tickFire(run, 0.1, true);
  check('弹链：持续开火 0.8 秒返还 2 发', run.ammo === 5, run.ammo);
  run = fresh({ spinup: 1 });
  const i0 = R.fireInterval(run, 0.14);
  for (let i = 0; i < 30; i++) R.tickFire(run, 0.1, true);
  check('预热：持续开火后射速最多 +40%', near(i0 / R.fireInterval(run, 0.14), 1.4));
  R.tickFire(run, 0.5, false);
  check('预热：松手 0.4 秒后清零', run.sprayTime === 0);
  run = fresh({ rend: 1 });
  check('撕裂：第 3 发命中 ×2.5', g.shotDamage({ ...dummy(), hitsTaken: 3 }, false) === 5 && g.shotDamage({ ...dummy(), hitsTaken: 4 }, false) === 2);
  run = fresh({ shred: 1 });
  check('碎甲：重甲兵第 2 次命中起 (2+1)×1.5', g.shotDamage({ ...dummy('heavy'), hitsTaken: 2 }, false) === 4.5);

  // ---- 子弹时间流 ----
  run = fresh({ stasis: 1 }, { focus: 20 });
  R.activateFocus(run);
  check('时停：1.2 秒、世界静止', run.focusTime === 1.2 && R.bulletTimeScale(run) === 0);
  run = fresh({ timedebt: 1 }, { focus: 6 });
  check('时间债：25% 即可释放', R.canActivateFocus(run));
  R.activateFocus(run);
  check('时间债：时长按比例 = 1.2 秒', near(run.focusTime, 1.2), run.focusTime);
  R.endBulletTime(run);
  check('时间债：结束后敌人加速同样时长', near(run.debtTime, 1.2));
  run = fresh({ fragment: 1 });
  check('碎片化：专注上限减半、时长减半', R.focusMax(run) === 10 && R.focusDuration(run) === 2);
  run = fresh({ afterglow: 1 }, { focus: 20 });
  R.activateFocus(run);
  for (let i = 0; i < 30; i++) R.onKillInBulletTime(run);
  check('余韵：最多延长 2 秒', near(run.focusTime, 6), run.focusTime);
  run = fresh({ timebank: 1 }, { focus: 20 });
  R.activateFocus(run);
  R.onDamage(run, 25, false);
  check('时间余量：每 10 伤害 +0.15 秒', near(run.focusTime, 4.3), run.focusTime);
  run = fresh({ echo: 1 }, { focus: 20 });
  R.activateFocus(run);
  for (let i = 0; i < 3; i++) R.onKillInBulletTime(run);
  R.endBulletTime(run);
  check('回响：击杀 ≥3 返还 30% 专注', near(run.focus, 6), run.focus);
  run = fresh({ highlight: 1 }, { focus: 20 });
  R.activateFocus(run);
  R.onDamage(run, 41, false);
  const tierBefore = run.rating.tier;
  R.endBulletTime(run);
  check('高光时刻：一次子弹时间 ≥40 伤害，评级 +1', run.rating.tier === tierBefore + 1);
  run = fresh({ freezeframe: 1 }, { focus: 20 });
  R.activateFocus(run);
  check('定格：子弹时间中伤害 +40%', near(g.shotDamage(dummy(), false), 2.8));
  run = fresh({ timeslit: 1 }, { focus: 20 });
  R.activateFocus(run);
  run.ammo = 0;
  check('时间缝隙：子弹时间中换弹瞬间完成', R.startReload(run, false) === 'instant');
  run = fresh({ overclock: 1 }, { focus: 20 });
  const before = R.fireInterval(run, 0.14);
  R.activateFocus(run);
  check('加速世界：子弹时间射速 +30%', near(before / R.fireInterval(run, 0.14), 1.3));

  // ---- 命盘 ----
  const meta = await import('./src/meta.js');
  const save0 = JSON.parse(JSON.stringify(g.save));
  g.save.stardust = 5000;
  g.save.deck = { unlocked: ['v_body', 'h_aim', 's_mag', 't_flow'], active: [], capacityLv: 0 };
  check('命盘：未解锁的卡不能装备', !meta.toggleCard(g.save, 'v_heart'));
  check('命盘：解锁花星尘', meta.unlockCard(g.save, 'v_heart') && g.save.stardust === 5000 - 150);
  for (const id of ['v_shield', 'e_supply', 'e_stake', 'e_fate', 'w_revive']) meta.unlockCard(g.save, id);
  ['v_heart', 'v_shield', 'e_supply', 'e_stake'].forEach((id) => meta.toggleCard(g.save, id));
  check('命盘：心力上限 10 装不下第 5 张', !meta.toggleCard(g.save, 'e_fate') && meta.deckUsed(g.save) === 9);
  meta.buyCapacity(g.save);
  check('命盘：心力 +2 后可以装备', meta.deckCapacity(g.save) === 12 && meta.toggleCard(g.save, 'e_fate'));
  check('觉醒卡：四邻都装备 → 不屈生效', meta.activeCards(g.save).has('w_revive'));
  check('觉醒卡：不能手动装备', !meta.toggleCard(g.save, 'w_revive'));
  run = fresh({});
  check('卡牌生效：生命 +30、护盾 1、金币 25、骰子 +1', run.maxHp === 130 && run.shield === 1 && run.gold === 25 && run.rerolls === 3);
  run.shield = 0;
  run.hp = 5;
  const res = R.takeDamage(run, 50);
  check('不屈：致命伤害复活到 50%（一局一次）', res.revived && run.hp === 65);
  run.hp = 5;
  check('不屈：第二次照常死亡', R.takeDamage(run, 50).dead);
  meta.toggleCard(g.save, 'v_shield');
  check('觉醒卡：卸下一张邻卡就失效', !meta.activeCards(g.save).has('w_revive'));
  g.save.deck.unlocked.push('h_pierce');
  check('解锁卡牌即把核心加入奖池', meta.unlockedUpgrades(g.save).includes('pierce'));
  Object.assign(g.save, save0);
  // 旧存档迁移：工坊花费和遗物升级退还星尘
  localStorage.setItem('rougeaim.save.v1', JSON.stringify({ stardust: 10, upgrades: { vitality: 2, unlock_pierce: 1 }, keepsakes: { hunter: 3, drum: 1, watch: 1, prism: 1 }, settings: { volume: 0.3 } }));
  const migrated = meta.loadSave();
  check('旧存档迁移：退还 120+240+200+200+300 星尘', migrated.stardust === 10 + 1060 && migrated.version === 2, migrated.stardust);
  check('旧存档迁移：遗物保留、等级归一', migrated.keepsakes.prism === 1 && migrated.keepsakes.hunter === 1 && !migrated.upgrades);
  localStorage.removeItem('rougeaim.save.v1');

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
  run = fresh({}, { keepsake: 'watch', keepsakeLv: 1 });
  let guaranteed = 0;
  for (let i = 0; i < 100; i++) if (R.rollRewardChoices(run).some((id) => UPGRADES[id].school === 'time')) guaranteed++;
  check('怀表：第一次三选一保底子弹时间流', guaranteed === 100, guaranteed);

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
  run = fresh({ pierce: 1, guillotine: 1 });
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
  const hps = line.map((b) => (b.dead ? 0 : b.hp));
  check('穿颅弹：爆头打死第一个，后面两个各受 ×0.75 爆头伤害', hps.join() === '0,1.5,1.5', hps);
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
