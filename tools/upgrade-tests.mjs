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
  const THREE = await import('./vendor/three.module.min.js');
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
  run = fresh({ adrenaline: 1 });
  run.hp = 50;
  for (let i = 0; i < 30; i++) R.tickFire(run, 1, true);
  check('肾上腺素：持续开火每秒回 1，每波最多 12', near(run.hp, 62), run.hp);
  run = fresh({ emergency: 1 });
  run.shield = 0;
  R.takeDamage(run, 70);
  check('应急护盾：生命降到 40% 以下获得 2 层护盾', run.shield === 2);
  run.shield = 0;
  R.takeDamage(run, 5);
  check('应急护盾：每波一次', run.shield === 0);
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

  run = fresh({ trackshield: 1 });
  check('跟枪护盾：按本波持续开火时间算', run.waveFireTime === 0 && 'waveFireTime' in run);
  // 名字不重名：命盘卡牌 vs 局内强化
  {
    const cfg0 = await import('./src/config.js');
    const upNames = new Set(Object.values(UPGRADES).map((u) => u.name));
    const clash = cfg0.CARDS.filter((c) => upNames.has(c.name)).map((c) => c.name);
    check('命盘卡牌和局内强化没有重名', clash.length === 0, clash);
  }

  // ---- 子弹时间流 ----
  run = fresh({ stasis: 1 }, { focus: 20 });
  R.activateFocus(run);
  check('时停：1.2 秒、世界静止', run.focusTime === 1.2 && R.bulletTimeScale(run) === 0);
  run = fresh({ blink: 1 }, { focus: 5 });
  check('瞬时：攒满 1 格（25%）就能释放', R.canActivateFocus(run));
  R.activateFocus(run);
  check('瞬时：一格 = 1 秒子弹时间', near(run.focusTime, 1) && near(run.focus, 0), run.focusTime);
  run.focus = 10;
  R.activateFocus(run);
  check('瞬时：子弹时间中继续释放 → 延长 1 秒', near(run.focusTime, 2) && near(run.focus, 5), run.focusTime);
  R.endBulletTime(run);
  check('子弹时间结束后没有任何后续效果', run.bt === null && !('debtTime' in run));
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
  run = fresh({ timeblade: 1 }, { focus: 20 });
  R.activateFocus(run);
  check('时之刃：子弹时间中爆头伤害 +70%', near(g.shotDamage(dummy(), true), 5.1));
  const timeUps = Object.entries(UPGRADES).filter(([, u]) => u.school === 'time').map(([, u]) => u.desc).join('');
  check('时间流强化里没有「结束后」的效果', !/结束(后|时)/.test(timeUps));
  run = fresh({ reloadmoment: 1 }, { focus: 20 });
  run.ammo = 0;
  R.startReload(run, false);
  R.activateFocus(run);
  check('装填时刻：释放子弹时间时弹匣立刻装满', run.ammo === 10 && !R.reloading(run));
  run = fresh({ freezeframe: 1 }, { focus: 20 });
  R.activateFocus(run);
  check('定格：子弹时间中伤害 +50%', near(g.shotDamage(dummy(), false), 3));
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
  const cfg = await import('./src/config.js');
  const save0 = JSON.parse(JSON.stringify(g.save));
  const totalCost = cfg.CARDS.reduce((a, c) => a + c.cost, 0);
  const maxCap = cfg.DECK_CAPACITY.base + cfg.DECK_CAPACITY.step * cfg.DECK_CAPACITY.costs.length;
  check('取舍：满心力（30）只能装下不到 60% 的卡', maxCap === 30 && maxCap < totalCost * 0.6, `${maxCap} / ${totalCost}`);
  const dupLv = cfg.CARDS.filter((c) => new Set(c.vals).size !== c.vals.length).map((c) => c.name);
  check('每张卡四个等级的数值都不同', dupLv.length === 0, dupLv);
  let allDust = cfg.CARDS.reduce((a, c) => a + c.unlock, 0) + cfg.DECK_CAPACITY.costs.reduce((a, b) => a + b, 0);
  let allCores = 0;
  for (const c of cfg.CARDS) for (let l = 2; l <= 4; l++) { const x = cfg.cardUpgradeCost(c, l); allDust += x.dust; allCores += x.cores; }
  check('全部解锁 + 升满 + 心力满：≤ 6000 星尘、≤ 15 星核', allDust <= 6000 && allCores <= 15, `${allDust} / ${allCores}`);
  check('每张觉醒卡只有一个条件', cfg.CARDS.filter((c) => c.cat === 'wake').every((c) => ['adjAll', 'row', 'adjOne', 'few'].includes(c.wake)));
  g.save.stardust = 5000;
  g.save.cores = 0;
  g.save.deck = { unlocked: ['v_body', 'h_aim', 's_mag', 't_flow'], active: [], levels: {}, capacityLv: 0 };
  check('命盘：未解锁的卡不能装备', !meta.toggleCard(g.save, 'v_death'));
  check('命盘：解锁花星尘', meta.unlockCard(g.save, 'v_death') && g.save.stardust === 5000 - 90);
  for (const id of ['v_shield', 'e_supply', 'e_stake', 'e_fate', 'w_full', 'w_few', 'w_star', 'w_rank', 'h_pierce', 's_heat', 'v_aid', 'e_star', 't_stasis', 't_debt']) meta.unlockCard(g.save, id);
  // 升级
  check('升级：1 → 2 级花星尘', meta.upgradeCard(g.save, 'v_body') && meta.cardLevel(g.save, 'v_body') === 2);
  meta.upgradeCard(g.save, 'v_body');
  check('升级：消耗 1 的卡升到第 4 级不要星核', meta.upgradeCard(g.save, 'v_body') && meta.cardLevel(g.save, 'v_body') === 4);
  check('升级：最多 4 级', !meta.upgradeCard(g.save, 'v_body'));
  meta.upgradeCard(g.save, 'v_death'); meta.upgradeCard(g.save, 'v_death');
  check('升级：消耗 ≥3 的卡第 4 级要星核', !meta.upgradeCard(g.save, 'v_death'));
  g.save.cores = 1;
  check('升级：有星核就能升到 4 级', meta.upgradeCard(g.save, 'v_death') && g.save.cores === 0);
  g.save.deck.levels.v_death = 1;
  const W = (id) => meta.wakeState(g.save, meta.cardById(id));
  // 独行：装备不超过 4 张
  ['v_body', 'v_death', 'e_stake', 'v_shield'].forEach((id) => meta.toggleCard(g.save, id));
  check('独行：装备 4 张时觉醒', W('w_few') === 'awake');
  meta.toggleCard(g.save, 'e_fate');
  check('独行：第 5 张装上就失效', W('w_few') === 'dormant');
  check('觉醒卡：不能手动装备', !meta.toggleCard(g.save, 'w_full'));
  // 同心：第 1 行其余 4 张全部装备
  g.save.deck.capacityLv = 10;
  ['h_aim', 'h_pierce', 's_heat'].forEach((id) => meta.toggleCard(g.save, id));
  check('同心：第 1 行还差一张时不觉醒', W('w_full') === 'dormant');
  meta.toggleCard(g.save, 's_mag');
  check('同心：第 1 行其余 4 张全装 → 觉醒', W('w_full') === 'awake');
  // 凯旋：上下左右相邻的卡全部装备
  ['e_supply', 't_stasis'].forEach((id) => meta.toggleCard(g.save, id));
  check('凯旋：相邻还差一张时不觉醒', W('w_rank') === 'dormant');
  meta.toggleCard(g.save, 't_debt');
  check('凯旋：相邻三张全装 → 觉醒', W('w_rank') === 'awake');
  // 群星：相邻至少一张
  check('群星：相邻有一张（借来的时间）就觉醒', W('w_star') === 'awake');
  meta.toggleCard(g.save, 't_debt');
  check('群星：相邻一张都没有 → 不觉醒', W('w_star') === 'dormant');
  meta.toggleCard(g.save, 'e_star');
  check('群星：换成另一张相邻的（观星者）也觉醒', W('w_star') === 'awake');
  const act = [...meta.activeCards(g.save)];
  check('觉醒卡不会重复计入', act.length === new Set(act).size);
  // 生效
  g.save.deck.active = [];
  g.save.deck.capacityLv = 0;
  ['v_body', 'v_death', 'e_stake', 'v_shield', 'e_fate'].forEach((id) => meta.toggleCard(g.save, id));
  run = fresh({});
  check('卡牌按等级生效：生命 +50（4 级）、没有开局护盾、金币 20、骰子 +2', run.maxHp === 150 && run.shield === 0 && run.gold === 20 && run.rerolls === 4, `${run.maxHp} ${run.shield} ${run.gold} ${run.rerolls}`);
  run.hp = 5;
  const res = R.takeDamage(run, 50);
  check('死亡抗拒 1 级：复活 1 次，回到 50%', res.revived && run.hp === Math.round(run.maxHp * 0.5), run.hp);
  run.hp = 5;
  run.iframe = 0; // 装着喘息，跳过无敌时间
  check('死亡抗拒 1 级：第二次照常死亡', R.takeDamage(run, 50).dead);
  g.save.deck.levels.v_death = 3;
  run = fresh({});
  let revs = 0;
  for (let k = 0; k < 4; k++) { run.hp = 5; run.iframe = 0; if (R.takeDamage(run, 50).revived) revs++; }
  check('死亡抗拒 3 级：复活 3 次', revs === 3 && run.hp === 0, revs);
  g.save.deck.levels.v_death = 1;
  // 独行：区域结束随机激活卡（装备 4 张，独行觉醒）
  meta.toggleCard(g.save, 'e_fate');
  run = fresh({});
  const had = run.cards.size;
  run.waveIndex = 4;
  R.finishWave(run);
  check('独行：打完区域激活 1 张没带的卡', run.cards.size === had + 1 && run.lastGifted.length === 1 && !cfg.CARDS.find((c) => c.id === run.lastGifted[0]).opening, run.lastGifted);
  // 凯旋：觉醒即生效
  g.save.deck.active = [];
  g.save.deck.capacityLv = 10;
  ['e_supply', 't_stasis', 't_debt'].forEach((id) => meta.toggleCard(g.save, id));
  run = fresh({});
  check('凯旋：击杀金币 +15%', R.killGold(run, 20) === 23);
  g.save.deck.unlocked.push('h_flick');
  check('解锁卡牌即把核心加入奖池', meta.unlockedUpgrades(g.save).includes('momentum') && meta.unlockedUpgrades(g.save).includes('flickmaster'));
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

  // ---- Boss 战 ----
  {
    const cfgB = await import('./src/config.js');
    const { createBoss, Orb } = await import('./src/boss.js');
    check('Boss 波：第 5/10/15/20 波', [5, 10, 15, 20].every((n) => cfgB.WAVES[n - 1].boss) && cfgB.WAVES.filter((w) => w.boss).length === 4);
    const spawned = [];
    const spawnFn = (kind, o) => spawned.push(kind);
    const gate = createBoss('gate', g.world.scene, Math.PI, spawnFn);
    const runB = fresh({});
    runB.sprayTime = 0;
    check('Boss：弱点 ×1、身体 ×0.5', gate.takeMul(true, runB) === 1 && gate.takeMul(false, runB) === 0.5);
    runB.sprayTime = 1;
    check('Boss：持续开火 1 秒，身体 ×0.75', near(gate.takeMul(false, runB), 0.75));
    runB.sprayTime = 5;
    check('Boss：持续开火 2 秒以上，身体 ×1', gate.takeMul(false, runB) === 1);
    gate.charge = 0.5;
    gate.visuals();
    check('守门人：施法前摇时核心开放（按爆头算）', gate.muzzle.userData.part === 'head');
    check('守门人：前摇时打核心 → 打断 + 踉跄', gate.onWeakHit(g, {}) === '打断！' && gate.charge === 0 && gate.stun > 0);
    check('守门人：不在前摇时打核心没有效果', gate.onWeakHit(g, {}) === null);
    gate.stun = 0; gate.charge = 0; gate.timer = 0.01;
    for (let i = 0; i < 55; i++) gate.update(1 / 60, 1);
    check('守门人：施法后先出现预警光圈，还没生成小球', gate.queue.length >= 2 && spawned.length === 0, `${gate.queue.length} / ${spawned.length}`);
    const ringAt = gate.queue[0].at;
    for (let i = 0; i < 60; i++) gate.update(1 / 60, 1);
    check('守门人：0.5 秒后光圈变成小球', spawned.length >= 2 && gate.queue.length === 0, spawned);
    check('小球在空中生成，不在 Boss 身上', Math.abs(ringAt.r - gate.r) > 0.5 || Math.abs(ringAt.theta - gate.theta) > 0.05);
    let path = 0;
    for (let i = 0; i < 120; i++) { const p0 = gate.position.clone(); gate.update(1 / 60, 1); path += gate.position.distanceTo(p0); }
    check('Boss 一直在乱飞（2 秒内飞行 > 10 米）', path > 10, path.toFixed(1));
    gate.remove();
    const falcon = createBoss('falcon', g.world.scene, Math.PI, spawnFn);
    check('游隼：眼睛没张开时打中没效果', falcon.onWeakHit(g, {}) === null);
    falcon.eyeOpen = 0.5;
    check('游隼：眼睛张开时打中 → 破绽，伤害 ×1.5', falcon.onWeakHit(g, {}) === '破绽！' && falcon.takeMul(true, runB) === 1.5);
    falcon.remove();
    const hive = createBoss('hive', g.world.scene, Math.PI, spawnFn);
    const pod = hive.pods[0];
    hive.onWeakHit(g, { mesh: pod.mesh, dmg: 30 });
    check('蜂巢：打发射舱扣舱的血', pod.alive && pod.hp === 15);
    check('蜂巢：打爆发射舱 → 拆除', hive.onWeakHit(g, { mesh: pod.mesh, dmg: 30 }).startsWith('拆除') && !pod.alive && !hive.hitMeshes.includes(pod.mesh));
    hive.pods.forEach((p2) => { p2.alive = false; });
    hive.update(1 / 60, 1);
    check('蜂巢：三个舱都拆掉 → 核心暴露', hive.phaseIdx === 1 && hive.eye.userData.part === 'head');
    hive.remove();
    run = fresh({});
    run.unlocked = ['momentum', 'flickmaster', 'overheat', 'suppress', 'stasis', 'blink'];
    const loot = R.rollRewardChoices(run, 3, { core: true });
    check('Boss 战利品：三个都是核心强化', loot.length === 3 && loot.every((id) => UPGRADES[id].cat === 'core'), loot);

    // 场景：小球、分裂弹、终局清屏
    run = fresh({});
    g.clearBots(); g.spawnQueue = []; g.waveDef = { name: 't', speedMul: 1 }; g.state = 'combat';
    g.yaw = 0; g.pitch = 0;
    const aimAt = (pos) => { const d = pos.clone().sub(g.camera.position); g.yaw = Math.atan2(-d.x, -d.z); g.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z)); g.camera.rotation.set(g.pitch, g.yaw, 0); g.camera.updateMatrixWorld(); };
    const orb = new Orb('normal', g.world.scene, { r: 8, theta: Math.PI, y: 1.6 });
    g.bots.push(orb);
    aimAt(orb.position);
    g.nextShotT = 0;
    g.fireAt(g.time, g.yaw, g.pitch);
    check('小球：一枪打碎，不掉金币', orb.dead && run.gold === 0 && run.stats.orbs === 1);
    const sp = new Orb('split', g.world.scene, { r: 8, theta: Math.PI, y: 1.6 });
    g.bots = [sp];
    aimAt(sp.position.clone().add(new THREE.Vector3(0.4, 0, 0)));
    g.nextShotT = 0;
    g.fireAt(g.time, g.yaw, g.pitch);
    check('分裂弹：打外壳 → 裂成 3 个碎片', sp.dead && g.bots.filter((b) => b.kind === 'shard').length === 3);
    const sp2 = new Orb('split', g.world.scene, { r: 8, theta: Math.PI, y: 1.6 });
    g.clearBots(); g.bots = [sp2];
    aimAt(sp2.position);
    g.nextShotT = 0;
    g.fireAt(g.time, g.yaw, g.pitch);
    check('分裂弹：打核心 → 直接消失', sp2.dead && g.bots.filter((b) => !b.dead && b.isOrb).length === 0);
    g.clearBots();
    for (let i = 0; i < 4; i++) g.bots.push(new Orb('normal', g.world.scene, { r: 10 + i, theta: Math.PI + i * 0.3, y: 2 }));
    const fin = createBoss('final', g.world.scene, Math.PI, () => {});
    check('终局：打核心 → 场上小球全碎（4 秒冷却）', fin.onWeakHit(g) === '清屏 ×4' && fin.onWeakHit(g) === null);
    fin.remove();
    g.clearBots();

    // ---- sub-tick ----
    run = fresh({});
    run.ammo = 99;
    g.clearBots(); g.spawnQueue = []; g.state = 'combat'; g.waveDef = { name: 't', speedMul: 1 };
    g.bots = [new Bot('normal', g.world.scene, 0, 200, 0)]; // 远处不动的敌人，防止这一波直接结束
    g.nextShotT = 0;
    g.firing = true;
    for (let i = 0; i < 20; i++) g.update(0.05); // 20fps 跑 1 秒
    g.firing = false;
    check('sub-tick：20fps 下 1 秒按住连发打出 8 发（0.14 秒间隔不被凑整到帧）', run.stats.shots === 8, run.stats.shots);
    run.stats.shots = 0;
    g.nextShotT = 0;
    check('sub-tick：点击时立刻开枪，不等下一帧', g.fireAt(g.time + 0.01, g.yaw, g.pitch) && run.stats.shots === 1);
    check('sub-tick：射击间隔内再点不会多打', !g.fireAt(g.time + 0.05, g.yaw, g.pitch) && run.stats.shots === 1);
    g.clearBots();
    g.state = 'title';
  }

  // ---- 开发者作弊码 ----
  {
    const sd = g.save.stardust;
    const cs = g.save.cores || 0;
    g.cheat();
    check('作弊码：+99999 星尘、+99999 星核', g.save.stardust === sd + 99999 && g.save.cores === cs + 99999);
    g.save.stardust = sd; g.save.cores = cs;
  }

  // ---- 场景：处决势头 / 零损耗 / 喘息 ----
  const scene = (ups, extra = {}) => {
    const r2 = fresh(ups, extra);
    g.clearBots(); g.spawnQueue = []; g.waveDef = { name: 't', speedMul: 1, damageMul: 1 }; g.state = 'combat';
    return r2;
  };
  const shootHead = (b) => {
    const h = b.headWorld.sub(g.camera.position);
    g.yaw = Math.atan2(-h.x, -h.z); g.pitch = Math.atan2(h.y, Math.hypot(h.x, h.z));
    g.camera.rotation.set(g.pitch, g.yaw, 0); g.camera.updateMatrixWorld();
    g.shoot();
  };
  run = scene({ momentum: 1, guillotine: 1 });
  const m1 = new Bot('normal', g.world.scene, Math.PI, 6, 0); m1.place();
  const m2 = new Bot('heavy', g.world.scene, Math.PI + 0.6, 8, 0); m2.place();
  g.bots.push(m1, m2);
  shootHead(m1);
  check('处决势头：爆头击杀后开启 1.5 秒窗口', m1.dead && run.momentumUntil > g.time);
  shootHead(m2);
  check('处决势头：下一发爆头 ×2（重甲兵 30 → 18）', m2.hp === 18, m2.hp);
  check('处决势头：用掉后窗口关闭', run.momentumUntil < g.time);
  g.clearBots();
  run = scene({ nowaste: 1 }, { focus: 20 });
  R.activateFocus(run);
  g.bots.push(new Bot('normal', g.world.scene, 0, 200, 0));
  const ammo0 = run.ammo;
  g.yaw = 0; g.pitch = 0; g.camera.rotation.set(0, 0, 0); g.camera.updateMatrixWorld();
  g.shoot();
  check('零损耗：子弹时间中打空不消耗弹药', run.ammo === ammo0 && run.stats.misses === 1);
  g.clearBots();
  g.save.deck = { unlocked: ['v_shield'], active: ['v_shield'], levels: {}, capacityLv: 0 };
  run = scene({});
  R.takeDamage(run, 10);
  const hpA = run.hp;
  check('喘息：受伤后 0.5 秒内不再受伤', R.takeDamage(run, 10).iframe && run.hp === hpA);
  run.iframe = 0;
  R.takeDamage(run, 10);
  check('喘息：时间过了照常受伤', run.hp === hpA - 10);
  g.save.deck = save0.deck;
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
