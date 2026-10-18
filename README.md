# RogueAim — 第一人称纯瞄准 × Roguelike 原型

站在原地、360° 转身，bot 从四面八方冲来，碰到就扣血。可以理解为「第一人称、完全靠手动瞄准的吸血鬼幸存者」：
**火力评级**（D → S）决定金币倍率，金币花在卡戎的商店里：**治疗 / 强化 / 星尘（局外货币）**；星尘在**命盘**里解锁卡牌。

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

存档（星尘、命盘、枪法档案）保存在浏览器的 localStorage 里，只留在这台电脑这个浏览器上。
无痕模式关掉窗口就会清空；在别人的电脑上玩完，可以在「设置」里清空存档。

## 操作

| 按键 | 作用 |
| --- | --- |
| 鼠标 | 360° 转动视角（锁定鼠标） |
| 左键 | 射击，按住可连发 |
| R | 换弹（弹匣 10 发、1.6 秒；打空弹匣自动换弹） |
| 右键 / E / 空格 | 释放「专注」：4 秒子弹时间，敌人减速到 30%，你的转身、射速、换弹不受影响 |
| Esc | 暂停 |

## 灵敏度：直接沿用 CS2 / Valorant 的设置

本游戏底层和 CS2 同一标准（每个鼠标 count 转 0.022° × 灵敏度），所以**本游戏灵敏度 = CS2 灵敏度**。
在「设置」里选按哪个游戏填：

| 来源 | 换算 |
| --- | --- |
| CS2 | 原样填写 |
| Valorant | 自动 × 3.1818（0.07 ÷ 0.022） |
| cm/360 | 直接填转一圈的厘米数，需要填 DPI |

填 DPI 后会实时显示 cm/360、CS2 / Valorant 等效灵敏度和 eDPI。FOV 有「匹配 CS2（垂直 73.74°）」「匹配 Valorant（70.53°）」两个预设。
Chrome / Edge 下默认开启原始输入；要和原游戏完全一致，Windows 指针速度保持第 6 格并关闭「提高指针精确度」。
旧存档的灵敏度会自动换算，手感不变。换算公式和测试见 `src/sens.js`、`tools/sens-tests.mjs`。

## 第一版原型包含

- 第一人称、Pointer Lock、射线命中判定；身体 2 点伤害，爆头 ×1.5
- 3 种 bot：普通兵 6 血（点射）、冲锋兵 3 血（甩枪）、重甲兵 30 血（跟枪）
- 弹匣与换弹：打空的子弹同样消耗弹药，乱扫会被换弹空窗惩罚
- **火力评级** D/C/B/A/S：按造成的伤害和击杀上升，打空只扣一点，停火会回落，被碰到降一级；金币倍率 ×1.0 → ×2.0
- 专注（按伤害充能，释放子弹时间）、金币掉落
- 20 波敌人，数量、速度、出怪密度、扇区、兵种比例按公式平滑上升（`WAVE_CURVE`）
- 局内**强化**：基础 9 种（可升 3 级）、三个流派各 3 套——爆头流（单发伤害）、扫射流（持续火力，按持续开火时间叠加，打空不打断）、子弹时间流（爆发窗口），共 34 个流派强化 + 9 个核心强化、通用 4 种、经济 3 种（详见 docs/DESIGN.md §7）
- bot 机动（脚下色环区分）：横移、急停冲刺、环绕（会绕到身后）、跳跃 / 二段跳、冲锋兵扑击、闪避（被准星压住会侧闪）、ADAD，外加正前正后的夹击出怪；所有突然动作都有可读的前摇。重甲兵永远直线
- 视野外的 bot 靠近时，屏幕边缘对应方向亮起红光，越近越亮
- 每波免费三选一强化；**卡戎商店**在每个区域结束（第 5、10、15 波后）出现，卖强化、治疗、生命之心、星尘；区域内随机出现**卡戎之井**，卖便宜的临时道具。**命运骰**（开局 2 个、每区域 +1）可以刷新三选一和商店，卡戎商店也能花金币刷新
- 结算界面：最高评级、爆头、精准度、甩枪反应、星尘结算明细、**本局每次逛店的决策记录**
- 局外：**命盘**（参考 Hades 2 的塔罗牌）——5×5 共 25 张卡，星尘解锁、每张可升 3 级（第 4 级要星核）；心力最高 24 而卡牌总消耗 52，只能带一半不到；4 张觉醒卡各有两条觉醒路线：上下左右的卡全装，或各自的特殊条件（心力恰好用满 / 只带 ≤4 张 / 局内打到 S / 覆盖五类）；开局携带 1 个**遗物**；枪法档案；调参数据面板
- 界面：CRT 复古终端风格（扫描线、荧光、像素字体，战斗中关闭扫描线）

## 原型的验证重点：商店是否让人犹豫

每次进商店都会记录：进店金币和血量、看到的价格、买了什么、什么时候买的、停留多久。
标题界面的 **「调参数据」** 汇总全部记录：

- 金币按金额流向治疗 / 强化 / 星尘的比例
- 每次逛店的平均停留时间（越长说明越犹豫）
- 空手离开、平均剩余金币

如果某一项超过 70% 或从没人买，面板会给出提示。所有价格集中在 `src/config.js` 的 `SHOP` 段：

```js
healBasePrice: 25, healPriceStep: 15,          // 回血
upgradePrice: { base: 55, baseStep: 18, school: 72, general: 64, econ: 55, core: 118 }, // 之后每 3 波 +1 倍
goldReroll: { base: 20, step: 20 },           // 卡戎商店金币刷新
stardustBasePrice: 70, stardustPriceStep: 30,  // 星尘
stardustYieldBase: 10, stardustYieldPerDepth: 8,
```

建议的调参流程：自己或找人打 5–10 局 → 看「调参数据」→ 只改一个价格 → 清空商店日志 → 再打。

## 目录

```
index.html, style.css
src/config.js   所有可调数值（玩家、武器、火力评级、专注、bot、波次、商店、结算、命盘、遗物）
src/run.js      单局规则：火力评级、专注、伤害、金币、商店定价与购买（不依赖渲染）
src/upgrades.js 强化定义（效果在 run.js / game.js）
src/meta.js     局外存档（localStorage）、命盘、旧存档迁移、商店日志统计
src/game.js     状态机、输入、射击、波次、强化效果（伤害计算、穿透、灼烧、子弹时间结束处理）
src/bots.js     bot 模型与移动
src/world.js    场景、相机、特效
src/ui.js       HUD 与所有界面
tools/smoke.mjs 冒烟测试：自动跑完整一局
tools/balance.mjs 平衡测试：模拟真人瞄准跑多局并统计（可指定流派）
tools/upgrade-tests.mjs 强化机制测试：逐个检查关键强化的效果
tools/sens-tests.mjs 灵敏度换算测试（node tools/sens-tests.mjs，不需要浏览器）
src/sens.js     灵敏度 / FOV 换算
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
node tools/balance.mjs expert 6 2 http://localhost:8000/ spray spray  # 第 6 个参数是打法：default / precision / spray
node tools/upgrade-tests.mjs "http://localhost:8000/?debug&norender"  # 强化机制测试
```

输出每档能打到第几波、每波平均掉血 / 命中 / 收入。改完 `WAVE_CURVE` 后用它看曲线是否合理。
指定流派时会解锁命盘全部卡牌（不装备）、携带该流派遗物，三选一和商店优先拿该流派，用来比较三个流派强度。
爆头流默认用点射型打法（几乎只瞄头），扫射流默认用扫射型（瞄身体、按住不放）。

冒烟测试会用自动瞄准跑完一整局（到阵亡或通关），检查控制台没有报错并保存各界面截图。
