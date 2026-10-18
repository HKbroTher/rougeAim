// 冒烟测试：用调试模式自动瞄准跑完一整局，检查流程与控制台错误。
// 用法：在项目根目录 `python3 -m http.server 8000`，然后 `node tools/smoke.mjs [url] [截图目录]`
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:8000/?debug';
const shots = process.argv[3] || '.';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(url);
await page.waitForFunction(() => window.game);
await page.screenshot({ path: `${shots}/01-title.png` });
await page.click('[data-action=start]');
await page.evaluate(() => { game.autoAim = true; game.timeScale = 3; });

let shopShot = false;
let combatShot = false;
for (let i = 0; i < 3000; i++) {
  const state = await page.evaluate(() => game.state);
  if (state === 'combat' && !combatShot && (await page.evaluate(() => game.bots.length)) > 3) {
    await page.screenshot({ path: `${shots}/02-combat.png` });
    combatShot = true;
  }
  if (state === 'reward') {
    await page.click('[data-action=pick]');
  } else if (state === 'shop') {
    if (!shopShot) { await page.screenshot({ path: `${shots}/03-shop.png` }); shopShot = true; }
    const rr = await page.$('[data-action=rerollShop]:not([disabled])');
    if (rr) await rr.click();
    const buy = await page.$('[data-action=buyGood]:not([disabled]), [data-action=buyItem]:not([disabled])');
    if (buy) await buy.click();
    await page.click('[data-action=leaveShop]');
  } else if (state === 'results') {
    break;
  }
  await page.waitForTimeout(500);
}
const summary = await page.evaluate(() => {
  const { upgrades, ...s } = game.lastSummary || {};
  return {
    state: game.state,
    summary: s,
    upgrades: upgrades?.join(','),
    shops: game.save.shopLog.map((v) => `#${v.shop} 金币${v.goldIn} 生命${v.hpIn}/${v.maxHp}`),
  };
});
await page.screenshot({ path: `${shots}/04-results.png` });
await page.click('[data-action=toTitle]');
await page.click('[data-action=tab][data-tab=tuning]');
await page.screenshot({ path: `${shots}/05-tuning.png` });
await page.click('[data-action=tab][data-tab=profile]');
await page.screenshot({ path: `${shots}/06-profile.png` });
console.log(JSON.stringify(summary, null, 2));
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
process.exit(summary.state === 'results' && !errors.length ? 0 : 1);
