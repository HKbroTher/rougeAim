// 平衡测试：用「模拟真人瞄准」跑若干局，统计能打到第几波、每波掉多少血、命中率。
// 用法：python3 -m http.server 8000 &
//       node tools/balance.mjs [技能=average] [局数=6] [并行=3] [url=http://localhost:8000/] [流派] [打法]
// 技能：novice / average / expert（见 src/simaim.js）
// 流派：head / spray / time / random。给出流派时会解锁命盘全部卡牌（不装备）、携带该流派遗物，
//       三选一和商店优先拿该流派（random = 全部解锁、随机拿，用来做全强化的冒烟测试）。
// 打法：default / precision（点射，几乎只瞄头）/ spray（扫射，瞄身体按住不放）。
//       不填时：爆头流用 precision，扫射流用 spray，其余用 default。
import { chromium } from 'playwright';

const [skill = 'average', runsArg = '6', parArg = '3', base = 'http://localhost:8000/', school = '', styleArg = ''] = process.argv.slice(2);
const style = styleArg || { head: 'precision', spray: 'spray' }[school] || 'default';
const RUNS = Number(runsArg);
const PAR = Number(parArg);
const url = `${base}?debug&norender`;

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist'] });

async function playOne(i) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url);
  await page.waitForFunction(() => window.game);
  await page.evaluate(({ sk, school, style }) => {
    game.timeScale = 4;
    if (school) {
      // 解锁命盘全部卡牌（不装备），携带对应流派遗物
      game.save.deck.unlocked = CARDS.map((c) => c.id);
      const ks = { head: 'hunter', spray: 'drum', time: 'watch' }[school];
      game.save.keepsake = ks || null;
    }
    window.__school = school;
    game.startRun();
    game.sim = new SimAimer(game, SKILLS[sk], style);
  }, { sk: skill, school, style });
  for (let guard = 0; guard < 20000; guard++) {
    const state = await page.evaluate(() => game.state);
    if (state === 'results') break;
    if (state === 'reward') {
      await page.evaluate(() => {
        const btns = [...document.querySelectorAll('[data-action=pick]')];
        const pref = btns.filter((b) => b.dataset.school === window.__school);
        const pool = pref.length ? pref : btns;
        // 没有本流派的选项时，有骰子就刷新一次
        if (window.__school && window.__school !== 'random' && !pref.length && game.run.rerolls > 0 && !window.__rr) { window.__rr = true; game.onAction('rerollReward', {}); return; }
        window.__rr = false;
        pool[Math.floor(Math.random() * pool.length)].click();
      });
    } else if (state === 'shop') {
      // 简单的「普通玩家」购物策略：治疗到 70%；尽量买强化（优先本流派），没有想要的就用骰子 / 金币刷新一次；
      // 卡戎之井买护盾和增益；最后有余钱买生命之心和星尘
      await page.evaluate(() => {
        const r = game.run;
        const q = (sel) => [...document.querySelectorAll(sel)].filter((b) => !b.disabled);
        for (let k = 0; k < 4 && r.hp / r.maxHp < 0.7; k++) {
          const h = q('[data-action=buyGood][data-kind=heal]')[0] || q('[data-action=buyGood][data-kind=ration]')[0];
          if (!h) break;
          h.click();
        }
        let rerolled = false;
        for (let k = 0; k < 4; k++) {
          const items = q('[data-action=buyItem]');
          const want = items.find((b) => b.dataset.school === window.__school) || items.find((b) => b.dataset.cat === 'base') || items[0];
          if (want) { want.click(); continue; }
          const left = document.querySelectorAll('[data-action=buyItem]:not(.sold)').length;
          const rr = q('[data-action=rerollShop][data-token="1"]')[0] || q('[data-action=rerollShop][data-token="0"]')[0];
          if (!rerolled && left && rr) { rr.click(); rerolled = true; continue; }
          break;
        }
        for (const kind of ['aegis', 'wrath', 'greed', 'dice', 'surge', 'ammo', 'heart', 'stardust']) {
          const b = q(`[data-action=buyGood][data-kind=${kind}]`)[0];
          if (b) b.click();
        }
        game.onAction('leaveShop', {});
      });
    }
    await page.waitForTimeout(250);
  }
  const res = await page.evaluate(() => {
    const r = game.run;
    const s = game.lastSummary;
    return {
      waves: s.waves, victory: s.victory, acc: s.accuracy, hs: s.hsRate, moverAcc: s.moverAcc,
      peakTier: s.peakTier, avgTier: s.avgTier, dmg: r.stats.damage, stardust: s.stardust, reloads: r.stats.reloads,
      hurtBy: r.stats.hurtBy || {},
      ups: Object.entries(r.ups).map(([id, l]) => (l > 1 ? `${id}${l}` : id)).join(' '),
      log: r.waveLog.map((w) => ({
        wave: w.wave,
        lost: (w.start.hp - (w.end?.hp ?? 0)),
        acc: w.end && w.end.shots - w.start.shots ? (w.end.hits - w.start.hits) / (w.end.shots - w.start.shots) : null,
        gold: w.end ? w.end.gold - w.start.gold : 0,
      })),
      shops: r.shopVisits.map((v) => ({ merchant: v.kind, wave: v.wave, goldIn: v.goldIn, bought: v.purchases.filter((p) => p.kind === 'upgrade').length, left: v.goldOut, prices: v.offered.items })),
    };
  });
  await ctx.close();
  if (errors.length) console.error(`run ${i} errors:`, errors);
  process.stderr.write(`  run ${i + 1}: 到达第 ${res.waves} 波${res.victory ? '（通关）' : ''}，命中 ${(res.acc * 100).toFixed(0)}%\n`);
  return res;
}

const results = [];
let next = 0;
await Promise.all(Array.from({ length: PAR }, async () => {
  while (next < RUNS) {
    const i = next++;
    results.push(await playOne(i));
  }
}));
await browser.close();

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const pct = (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(0)}%` : '—');
const waves = results.map((r) => r.victory ? 21 : r.waves + 1); // 死在第几波（通关记 21）
console.log(`\n技能 ${skill}${school ? `，流派 ${school}` : ''}，打法 ${style}，${RUNS} 局`);
for (const r of results) console.log(`  强化：${r.ups}`);
console.log(`死亡波次：${waves.map((w) => (w > 20 ? '通关' : w)).join(', ')}（平均 ${avg(waves).toFixed(1)}）`);
console.log(`命中率 ${pct(avg(results.map((r) => r.acc)))}，爆头率 ${pct(avg(results.map((r) => r.hs)))}，移动目标命中率 ${pct(avg(results.map((r) => r.moverAcc).filter((v) => v != null)))}`);
const T = 'DCBAS';
console.log(`平均评级 ${T[Math.round(avg(results.map((r) => r.avgTier)))]}（${avg(results.map((r) => r.avgTier)).toFixed(2)}），最高评级 ${results.map((r) => T[r.peakTier]).join('')}，平均星尘 ${avg(results.map((r) => r.stardust)).toFixed(0)}`);
const hurt = {};
for (const r of results) for (const [k, v] of Object.entries(r.hurtBy)) hurt[k] = (hurt[k] || 0) + v;
const hurtTotal = Object.values(hurt).reduce((a, b) => a + b, 0) || 1;
console.log(`被碰到的来源（共 ${hurtTotal} 次）：${Object.entries(hurt).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round((v / hurtTotal) * 100)}%`).join('，')}`);
// 商店：按出现顺序统计（shop = 卡戎商店，well = 卡戎之井）；「可买」只对卡戎商店有意义
const byShop = {};
for (const r of results) r.shops.forEach((sh, i) => { (byShop[i + 1] ||= []).push(sh); });
for (const [n, arr] of Object.entries(byShop)) {
  const up = arr.filter((x) => x.prices.length);
  const avgPrice = avg(up.flatMap((x) => x.prices));
  const types = {};
  for (const x of arr) types[x.merchant] = (types[x.merchant] || 0) + 1;
  console.log(`第 ${n} 次商店（${arr.length} 局，平均第 ${avg(arr.map((x) => x.wave)).toFixed(1)} 波后，${Object.entries(types).map(([k, v]) => `${k}×${v}`).join(' ')}）：进店金币 ${avg(arr.map((x) => x.goldIn)).toFixed(0)}` +
    (up.length ? `，强化均价 ${avgPrice.toFixed(0)}，可买 ${(avg(up.map((x) => x.goldIn)) / avgPrice).toFixed(2)} 个，实际买 ${avg(up.map((x) => x.bought)).toFixed(2)} 个` : '') + `，剩 ${avg(arr.map((x) => x.left)).toFixed(0)}`);
}
console.log('\n波 | 到达局数 | 平均掉血 | 平均命中 | 平均收入');
for (let w = 1; w <= 20; w++) {
  const rows = results.map((r) => r.log.find((l) => l.wave === w)).filter(Boolean);
  if (!rows.length) break;
  console.log(`${String(w).padStart(2)} | ${String(rows.length).padStart(4)} | ${avg(rows.map((x) => x.lost)).toFixed(0).padStart(6)} | ${pct(avg(rows.map((x) => x.acc).filter((v) => v != null))).padStart(6)} | ${avg(rows.map((x) => x.gold)).toFixed(0).padStart(5)}`);
}
