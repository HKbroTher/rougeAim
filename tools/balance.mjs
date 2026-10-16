// 平衡测试：用「模拟真人瞄准」跑若干局，统计能打到第几波、每波掉多少血、命中率。
// 用法：python3 -m http.server 8000 &
//       node tools/balance.mjs [技能=average] [局数=6] [并行=3] [url=http://localhost:8000/] [流派]
// 技能：novice / average / expert（见 src/simaim.js）
// 流派：head / spray / time / random。给出流派时会解锁全部内容，携带该流派遗物 3 级，
//       三选一和商店优先拿该流派（random = 全部解锁、随机拿，用来做全强化的冒烟测试）。
import { chromium } from 'playwright';

const [skill = 'average', runsArg = '6', parArg = '3', base = 'http://localhost:8000/', school = ''] = process.argv.slice(2);
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
  await page.evaluate(({ sk, school }) => {
    game.timeScale = 4;
    if (school) {
      // 解锁全部内容，携带对应流派遗物 3 级
      for (const u of META_UPGRADES) game.save.upgrades[u.id] = u.costs.length;
      const ks = { head: 'hunter', spray: 'drum', time: 'watch' }[school];
      game.save.keepsakes = { ...game.save.keepsakes, ...(ks ? { [ks]: 3 } : {}) };
      game.save.keepsake = ks || null;
    }
    window.__school = school;
    game.startRun();
    game.sim = new SimAimer(game, SKILLS[sk]);
  }, { sk: skill, school });
  for (let guard = 0; guard < 20000; guard++) {
    const state = await page.evaluate(() => game.state);
    if (state === 'results') break;
    if (state === 'reward') {
      await page.evaluate(() => {
        const btns = [...document.querySelectorAll('[data-action=pick]')];
        const pref = btns.filter((b) => b.dataset.school === window.__school);
        const pool = pref.length ? pref : btns;
        pool[Math.floor(Math.random() * pool.length)].click();
      });
    } else if (state === 'shop') {
      // 简单的「普通玩家」购物策略：血量 < 60% 先回血，然后买得起的强化，钱多再换星尘
      await page.evaluate(() => {
        const r = game.run;
        const click = (sel) => { const b = document.querySelector(sel); if (b && !b.disabled) { b.click(); return true; } return false; };
        for (let k = 0; k < 4 && r.hp / r.maxHp < 0.6; k++) if (!click('[data-action=buyHeal]')) break;
        const items = [...document.querySelectorAll('[data-action=buyItem]')].filter((b) => !b.disabled);
        const want = items.find((b) => b.dataset.school === window.__school) || (window.__school && window.__school !== 'random' ? items.find((b) => b.dataset.cat === 'base') : items[0]);
        if (want) want.click();
        const sd = document.querySelector('[data-action=buyStardust]');
        if (sd && !sd.disabled && r.gold > 1.6 * Number(sd.querySelector('.price').textContent.replace(/\D/g, ''))) sd.click();
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
      maxCombo: s.maxCombo, stardust: s.stardust, reloads: r.stats.reloads,
      hurtBy: r.stats.hurtBy || {},
      ups: Object.entries(r.ups).map(([id, l]) => (l > 1 ? `${id}${l}` : id)).join(' '),
      log: r.waveLog.map((w) => ({
        wave: w.wave,
        lost: (w.start.hp - (w.end?.hp ?? 0)),
        acc: w.end && w.end.shots - w.start.shots ? (w.end.hits - w.start.hits) / (w.end.shots - w.start.shots) : null,
        gold: w.end ? w.end.gold - w.start.gold : 0,
      })),
      shops: r.shopVisits.map((v) => v.goldIn),
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
console.log(`\n技能 ${skill}${school ? `，流派 ${school}` : ''}，${RUNS} 局`);
for (const r of results) console.log(`  强化：${r.ups}`);
console.log(`死亡波次：${waves.map((w) => (w > 20 ? '通关' : w)).join(', ')}（平均 ${avg(waves).toFixed(1)}）`);
console.log(`命中率 ${pct(avg(results.map((r) => r.acc)))}，爆头率 ${pct(avg(results.map((r) => r.hs)))}，移动目标命中率 ${pct(avg(results.map((r) => r.moverAcc).filter((v) => v != null)))}`);
console.log(`平均最高连杀 ${avg(results.map((r) => r.maxCombo)).toFixed(0)}，平均星尘 ${avg(results.map((r) => r.stardust)).toFixed(0)}`);
const hurt = {};
for (const r of results) for (const [k, v] of Object.entries(r.hurtBy)) hurt[k] = (hurt[k] || 0) + v;
const hurtTotal = Object.values(hurt).reduce((a, b) => a + b, 0) || 1;
console.log(`被碰到的来源（共 ${hurtTotal} 次）：${Object.entries(hurt).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round((v / hurtTotal) * 100)}%`).join('，')}`);
console.log('\n波 | 到达局数 | 平均掉血 | 平均命中 | 平均收入');
for (let w = 1; w <= 20; w++) {
  const rows = results.map((r) => r.log.find((l) => l.wave === w)).filter(Boolean);
  if (!rows.length) break;
  console.log(`${String(w).padStart(2)} | ${String(rows.length).padStart(4)} | ${avg(rows.map((x) => x.lost)).toFixed(0).padStart(6)} | ${pct(avg(rows.map((x) => x.acc).filter((v) => v != null))).padStart(6)} | ${avg(rows.map((x) => x.gold)).toFixed(0).padStart(5)}`);
}
