# RogueAim — 第一人称纯瞄准 × Roguelike 原型

站在原地、360° 转身，bot 从四面八方冲来，碰到就扣血。可以理解为「第一人称、完全靠手动瞄准的吸血鬼幸存者」：
连杀倍率决定金币，金币在商店里分给 **回血 / 强化 / 星尘（局外货币）**。

完整设计见 [docs/DESIGN.md](docs/DESIGN.md)。

## 运行

浏览器原型，不需要构建，Three.js 已放在 `vendor/`（可离线运行）。ES Module 不能用 `file://` 打开，需要起一个静态服务器：

```bash
python3 -m http.server 8000
# 打开 http://localhost:8000
```

### 在公共电脑 / 不能装软件的电脑上玩

- **网页版（推荐）**：开启 GitHub Pages 后，直接打开 <https://hkbrother.github.io/rougeAim/>。
  开启方法：仓库 Settings → Pages → Source 选 *Deploy from a branch*，分支选 `main`、目录选 `/ (root)` → Save，等 1–2 分钟。
- **单文件版**：下载 [`dist/rogueaim.html`](dist/rogueaim.html)（在 GitHub 上点文件 → 右上角下载按钮），双击用 Chrome / Edge / Firefox 打开即可，不需要网络和服务器。
  修改代码后用 `node tools/build-single.mjs` 重新生成。

存档（星尘、工坊、枪法档案）保存在浏览器的 localStorage 里，只留在这台电脑这个浏览器上。
无痕模式关掉窗口就会清空；在别人的电脑上玩完，可以在「设置」里清空存档。

## 操作

| 按键 | 作用 |
| --- | --- |
| 鼠标 | 360° 转动视角（锁定鼠标） |
| 左键 | 射击，按住可连发 |
| R | 换弹（弹匣 10 发、1.6 秒；打空弹匣自动换弹） |
| 右键 / E / 空格 | 释放「专注」：4 秒子弹时间，敌人减速到 30%，你的转身、射速、换弹不受影响 |
| Esc | 暂停 |

## 第一版原型包含

- 第一人称、Pointer Lock、射线命中判定，爆头 ×2 伤害并额外 +1 连杀
- 3 种 bot：普通兵（点射）、冲锋兵（甩枪）、重甲兵（跟枪）
- 弹匣与换弹：打空的子弹同样消耗弹药，乱扫会被换弹空窗惩罚
- 连杀倍率（每层 +0.1x，最高 4x，打空清零）、专注（子弹时间）、金币掉落
- 20 波敌人，数量、速度、出怪密度、扇区、兵种比例按公式平滑上升（`WAVE_CURVE`）
- 局内**强化**：基础 8 种（可升 3 级）、三个流派（爆头 / 扫射 / 子弹时间）各 3 套共 29 个流派强化 + 9 个核心强化、通用 4 种、经济 3 种。每波后免费三选一，核心强化以低概率混在其中（详见 docs/DESIGN.md §7）
- bot 机动：第 4 波起出现横移，第 6 波起跳跃，第 9 波起 ADAD，脚下色环提示机动种类；重甲兵永远直线
- 视野外的 bot 靠近时，屏幕边缘对应方向亮起红光，越近越亮
- 波次之间的商店：回血（越买越贵）、2 个流派 / 通用强化、1 个基础强化、偶尔 1 个经济强化、星尘（越买越贵、越深兑换越多）；所有价格 ×(1 + 0.12 × 深度)
- 结算界面：最高连杀、爆头、精准度、甩枪反应、星尘结算明细、**本局每次逛店的决策记录**
- 局外：开局携带 1 个**遗物**（猎手徽章 / 旧弹鼓 / 怀表 / 三棱镜 / 空白徽章，可升到 3 级）；星尘工坊（遗物升级、核心强化解锁、有上限的宽容度成长）；枪法档案；调参数据面板

## 原型的验证重点：商店是否让人犹豫

每次进商店都会记录：进店金币和血量、看到的价格、买了什么、什么时候买的、停留多久。
标题界面的 **「调参数据」** 汇总全部记录：

- 金币按金额流向回血 / 强化 / 星尘的比例
- 每次逛店的平均停留时间（越长说明越犹豫）
- 空手离开、平均剩余金币

如果某一项超过 70% 或从没人买，面板会给出提示。所有价格集中在 `src/config.js` 的 `SHOP` 段：

```js
healBasePrice: 25, healPriceStep: 15,          // 回血
upgradePrice: { base: 30, baseStep: 15, school: 55, general: 50, econ: 45, core: 95 }, // 强化
stardustBasePrice: 55, stardustPriceStep: 25,  // 星尘（比同档强化贵）
stardustYieldBase: 10, stardustYieldPerDepth: 8,
stardustShops: null,                           // 例如 [2, 4] = 只有第 2、4 家店卖星尘
```

建议的调参流程：自己或找人打 5–10 局 → 看「调参数据」→ 只改一个价格 → 清空商店日志 → 再打。

## 目录

```
index.html, style.css
src/config.js   所有可调数值（玩家、武器、连杀、专注、bot、波次、商店、结算、星尘工坊）
src/run.js      单局规则：倍率、专注、伤害、金币、商店定价与购买（不依赖渲染）
src/upgrades.js 强化定义（效果在 run.js / game.js）
src/meta.js     局外存档（localStorage）、商店日志统计
src/game.js     状态机、输入、射击、波次、强化效果（伤害计算、穿透、灼烧、子弹时间结束处理）
src/bots.js     bot 模型与移动
src/world.js    场景、相机、特效
src/ui.js       HUD 与所有界面
tools/smoke.mjs 冒烟测试：自动跑完整一局
tools/balance.mjs 平衡测试：模拟真人瞄准跑多局并统计（可指定流派）
tools/upgrade-tests.mjs 强化机制测试：逐个检查关键强化的效果
src/simaim.js   模拟真人瞄准（仅调试）
tools/build-single.mjs 打包成单文件 dist/rogueaim.html
vendor/         three.js r169（MIT）
```

## 调试与测试

- `?debug`：不强制锁定鼠标，并在控制台暴露 `window.game`
  - `game.autoAim = true`：自动瞄准，**仅用于自动化测试**，不是玩法的一部分
  - `game.timeScale = 2`：加速
- 冒烟测试（需要 Playwright）：

```bash
npm i -D playwright
python3 -m http.server 8000 &
node tools/smoke.mjs http://localhost:8000/?debug ./shots
```

平衡测试（模拟真人瞄准，见 docs/DESIGN.md §2.8）：

```bash
node tools/balance.mjs average 6 3 http://localhost:8000/        # 技能 局数 并行数
node tools/balance.mjs average 6 3 http://localhost:8000/ head   # 指定流派：head / spray / time / random
node tools/upgrade-tests.mjs "http://localhost:8000/?debug&norender"  # 强化机制测试
```

输出每档能打到第几波、每波平均掉血 / 命中 / 收入。改完 `WAVE_CURVE` 后用它看曲线是否合理。
指定流派时会解锁全部内容、携带该流派遗物 3 级，三选一和商店优先拿该流派，用来比较三个流派强度。

冒烟测试会用自动瞄准打完 20 波、每次商店兑换星尘，检查控制台没有报错并保存各界面截图。
