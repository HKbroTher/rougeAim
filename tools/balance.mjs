// 平衡测试：用「模拟真人瞄准」跑若干局，统计能打到第几波、每波掉多少血、命中率。
// 用法：python3 -m http.server 8000 &
//       node tools/balance.mjs [技能=average] [局数=6] [并行=3] [url=http://localhost:8000/]
// 技能：novice / average / expert（见 src/simaim.js）
import { chromium } from 'playwright';

const [skill = 'average', runsArg = '6', parArg = '3', base = 'http://localhost:8000/'] = process.argv.slice(2);
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
  await page.evaluate((sk) => {
    game.timeScale = 4;
    game.startRun();
    game.sim = new SimAimer(game, SKILLS[sk]);
  }, skill);
  for (let guard = 0; guard < 20000; guard++) {
    const state = await page.evaluate(() => game.state);
    if (state === 'results') break;
    if (state === 'reward') {
      await page.evaluate(() => {
        const btns = [...document.querySelectorAll('[data-action=pickRelic]')];
        btns[Math.floor(Math.random() * btns.length)].click();
      });
    } else if (state === 'shop') {
      // 简单的「普通玩家」购物策略：血量 < 60% 先回血，然后买得起的遗物，钱多再换星尘
      await page.evaluate(() => {
        const r = game.run;
        const click = (sel) => { const b = document.querySelector(sel); if (b && !b.disabled) { b.click(); return true; } return false; };
        for (let k = 0; k < 4 && r.hp / r.maxHp < 0.6; k++) if (!click('[data-action=buyHeal]')) break;
        for (const b of document.querySelectorAll('[data-action=buyRelic]')) if (!b.disabled) { b.click(); break; }
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
console.log(`\n技能 ${skill}，${RUNS} 局`);
console.log(`死亡波次：${waves.map((w) => (w > 20 ? '通关' : w)).join(', ')}（平均 ${avg(waves).toFixed(1)}）`);
console.log(`命中率 ${pct(avg(results.map((r) => r.acc)))}，爆头率 ${pct(avg(results.map((r) => r.hs)))}，移动目标命中率 ${pct(avg(results.map((r) => r.moverAcc).filter((v) => v != null)))}`);
console.log(`平均最高连杀 ${avg(results.map((r) => r.maxCombo)).toFixed(0)}，平均星尘 ${avg(results.map((r) => r.stardust)).toFixed(0)}`);
console.log('\n波 | 到达局数 | 平均掉血 | 平均命中 | 平均收入');
for (let w = 1; w <= 20; w++) {
  const rows = results.map((r) => r.log.find((l) => l.wave === w)).filter(Boolean);
  if (!rows.length) break;
  console.log(`${String(w).padStart(2)} | ${String(rows.length).padStart(4)} | ${avg(rows.map((x) => x.lost)).toFixed(0).padStart(6)} | ${pct(avg(rows.map((x) => x.acc).filter((v) => v != null))).padStart(6)} | ${avg(rows.map((x) => x.gold)).toFixed(0).padStart(5)}`);
}
