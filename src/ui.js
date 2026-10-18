// DOM 界面：HUD 与各个全屏界面。按钮通过 data-action 统一派发给 game。
import { UPGRADES, SCHOOLS, CAT_LABEL, BASE_MAX_LEVEL } from './upgrades.js';
import { KEEPSAKES, BOTS, WAVES, FOCUS, SHOP, SETTLEMENT, WEAPON, WELL, WELL_ITEMS, RATING, CARDS, CARD_CATS, DECK_SIZE, DECK_CAPACITY } from './config.js';
import { keepsakeLevel, shopStats, cardUnlocked, cardEquipped, cardAwake, deckCapacity, deckUsed, nextCapacityCost, activeCards } from './meta.js';
import * as R from './run.js';
import { gameSens, cm360, equivalents, GAME_YAW, FOV_PRESETS } from './sens.js';

const $ = (id) => document.getElementById(id);

const TIER = (i) => RATING.tiers[i] || RATING.tiers[0];
const tierBadge = (i) => (i == null ? '—' : `<b style="color:${TIER(i).color}">${TIER(i).id}</b>`);
const SPEND_LABEL = { heal: '治疗', upgrade: '强化', stardust: '星尘', reroll: '刷新', well: '临时道具' };

export class UI {
  constructor(onAction) {
    this.screen = $('screen');
    this.hud = $('hud');
    this.radar = $('radar').getContext('2d');
    this.screen.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (el && !el.disabled) onAction(el.dataset.action, el.dataset);
    });
    this.screen.addEventListener('input', (e) => {
      const t = e.target;
      if (t.dataset.setting) onAction('setting', { key: t.dataset.setting, value: t.type === 'checkbox' ? t.checked : t.value });
    });
    this.lastTier = null;
  }

  show(html) {
    this.screen.innerHTML = html;
    this.screen.hidden = false;
    this.screen.scrollTop = 0;
  }

  hideScreen() {
    this.screen.hidden = true;
    this.screen.innerHTML = '';
  }

  // 视野外近身威胁：在屏幕边缘对应方向画红光。rel = 相对视线的角度，正数在右；k = 0..1 的危险程度
  drawThreats(threats, time) {
    const cv = $('threat');
    const W = window.innerWidth;
    const H = window.innerHeight;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const c = cv.getContext('2d');
    c.clearRect(0, 0, W, H);
    if (!threats.length) return;
    const cx = W / 2;
    const cy = H / 2;
    const rad = Math.min(W, H) * 0.45;
    for (const { rel, k } of threats) {
      // 方向映射到屏幕边缘：正前 = 上，正后 = 下，右 = 右
      const sx = Math.sin(rel);
      const sy = -Math.cos(rel);
      const scale = Math.min(cx / Math.max(1e-3, Math.abs(sx)), cy / Math.max(1e-3, Math.abs(sy)));
      const x = cx + sx * scale;
      const y = cy + sy * scale;
      const pulse = 0.75 + 0.25 * Math.sin(time * (6 + 10 * k));
      const a = Math.min(0.85, 0.25 + 0.6 * k) * pulse;
      const g = c.createRadialGradient(x, y, 0, x, y, rad * (0.6 + 0.4 * k));
      g.addColorStop(0, `rgba(255, 30, 55, ${a})`);
      g.addColorStop(1, 'rgba(255, 30, 55, 0)');
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
    }
  }

  endCombatFx() {
    this.drawThreats([], 0);
    $('view').classList.remove('slowmo');
    $('focus-overlay').classList.remove('on');
  }

  showHud(on) {
    this.hud.hidden = !on;
    this.lastTier = null;
  }

  // ---------------- 标题 / 局外 ----------------

  title(save, tab = 'play', rawStatus = 'unknown') {
    this.rawStatus = rawStatus;
    const tabs = [
      ['play', '开始'], ['deck', '命盘'], ['profile', '枪法档案'], ['tuning', '调参数据'], ['settings', '设置'],
    ];
    const body = {
      play: () => this.titlePlay(save),
      deck: () => this.titleDeck(save),
      profile: () => this.titleProfile(save),
      tuning: () => this.titleTuning(save),
      settings: () => this.titleSettings(save),
    }[tab]();
    const refund = save.refunded ? `<div class="ok-box">命盘取代了星尘工坊：旧工坊和遗物升级的花费已全部退还，共 <span class="stardust">✦ ${save.refunded}</span>。</div>` : '';
    save.refunded = 0;
    this.show(`
      <div class="card crt title-card">
        <div class="boot small">&gt; ROGUEAIM.EXE — 瞄准训练终端 v0.2<span class="cursor">█</span></div>
        <div class="row title-head">
          <div class="grow">
            <h1 class="logo" data-text="ROGUEAIM">ROGUE<span>AIM</span></h1>
            <div class="subtitle">第一人称纯瞄准 × ROGUELIKE　//　只能转身和开枪</div>
          </div>
          <div class="stardust big-num">✦ ${save.stardust}<small>星尘</small></div>
        </div>
        <nav class="menu">${tabs.map(([id, n]) => `<button class="tab ${id === tab ? 'on' : ''}" data-action="tab" data-tab="${id}">${n}</button>`).join('')}</nav>
        ${refund}
        <div class="screen-body">${body}</div>
      </div>`);
  }

  titlePlay(save) {
    const bots = Object.values(BOTS).map((b) => `<li><b>${b.label}</b> <span class="dim">— ${b.hp} 血，${b.skill}</span></li>`).join('');
    const tiers = RATING.tiers.map((t) => `<b style="color:${t.color}">${t.id}</b> ×${t.gold}`).join('　');
    return `
      <div class="cols">
        <div>
          <h3>操作</h3>
          <div class="keys">
            <kbd>鼠标</kbd><span>360° 转动视角（站在原地不能移动）</span>
            <kbd>左键</kbd><span>射击（按住连发）</span>
            <kbd>R</kbd><span>换弹（弹匣 ${WEAPON.magSize} 发，${WEAPON.reloadTime} 秒；打空弹匣会自动换弹）</span>
            <kbd>右键 / E / 空格</kbd><span>释放专注：${FOCUS.duration} 秒子弹时间，敌人减速到 ${Math.round(FOCUS.timeScale * 100)}%</span>
            <kbd>Esc</kbd><span>暂停</span>
          </div>
          <h3>规则</h3>
          <ul class="small rules">
            <li>身体 ${WEAPON.damage} 点伤害，爆头 ×${WEAPON.headshotMultiplier}。普通兵 ${BOTS.normal.hp} 血：3 发身体或 2 发爆头。</li>
            <li><b>火力评级</b>随造成的伤害和击杀上升，决定金币倍率：${tiers}。打空只扣一点进度；停火太久会回落；<b style="color:var(--danger)">被碰到降一级</b>。</li>
            <li>共 ${WAVES.length} 波。每波后免费三选一<b>强化</b>；区域结束（第 ${SHOP.shopAfter.join('、')} 波后）进<span class="goldtxt">卡戎商店</span>，路上可能遇到卡戎之井。</li>
            <li>三个流派：<b style="color:${SCHOOLS.head.color}">爆头</b>（单发伤害）、<b style="color:${SCHOOLS.spray.color}">扫射</b>（持续火力）、<b style="color:${SCHOOLS.time.color}">子弹时间</b>（爆发窗口），金色的<b class="goldtxt">核心强化</b>会改变规则。</li>
            <li>星尘是局外货币，在<b>命盘</b>里解锁和装备卡牌。</li>
          </ul>
        </div>
        <div>
          <h3>敌人</h3>
          <ul class="small rules">${bots}</ul>
          <h3>携带遗物</h3>
          ${this.keepsakePicker(save)}
          <h3>命盘（${deckUsed(save)} / ${deckCapacity(save)} 心力）</h3>
          <div class="small dim">${this.deckSummary(save) || '还没有装备卡牌 —— 去「命盘」看看'}</div>
          <div style="margin-top:22px"><button class="btn primary blink-hover" data-action="start">▶ 开始一局</button></div>
          <p class="small dim">点击开始后会锁定鼠标。灵敏度可在「设置」里调整。</p>
        </div>
      </div>`;
  }

  keepsakePicker(save) {
    const owned = KEEPSAKES.filter((k) => keepsakeLevel(save, k.id) > 0);
    const btn = (id, label, title) => `<button class="tab ${save.keepsake === id ? 'on' : ''}" data-action="keepsake" data-id="${id || ''}" title="${title}">${label}</button>`;
    const cur = KEEPSAKES.find((k) => k.id === save.keepsake);
    return `<div class="row" style="gap:6px">${btn(null, '不携带', '')}${owned.map((k) => btn(k.id, `${k.icon} ${k.name}`, k.desc)).join('')}</div>
      <div class="small dim" style="margin-top:6px">${cur ? cur.desc : '每局开局选 1 个遗物带进去。更多遗物在「命盘」页购买。'}</div>`;
  }

  deckSummary(save) {
    const act = activeCards(save);
    return CARDS.filter((c) => act.has(c.id)).map((c) => `<span style="color:${CARD_CATS[c.cat].color}">${c.icon}</span> ${c.name}`).join('　');
  }

  // 命盘：5×5 卡牌。点击未解锁的卡 = 花星尘解锁；点击已解锁的卡 = 装备 / 卸下
  titleDeck(save) {
    const cap = deckCapacity(save);
    const used = deckUsed(save);
    const capCost = nextCapacityCost(save);
    const grid = [];
    for (let r = 0; r < DECK_SIZE; r++) for (let c = 0; c < DECK_SIZE; c++) grid.push(CARDS.find((x) => x.pos[0] === r && x.pos[1] === c));
    const tiles = grid.map((card) => {
      const cat = CARD_CATS[card.cat];
      const unlocked = cardUnlocked(save, card.id);
      const wake = card.cat === 'wake';
      const on = wake ? cardAwake(save, card) : cardEquipped(save, card.id);
      const fits = used + card.cost <= cap;
      let state; let action; let foot;
      if (!unlocked) {
        state = 'locked';
        action = 'unlockCard';
        foot = `<span class="stardust">✦ ${card.unlock}</span> 解锁`;
      } else if (wake) {
        state = on ? 'on awake' : 'dormant';
        action = '';
        foot = on ? '已觉醒' : '未觉醒';
      } else {
        state = on ? 'on' : fits ? 'off' : 'off nofit';
        action = 'toggleCard';
        foot = on ? '已装备' : fits ? '点击装备' : '心力不足';
      }
      const pips = wake ? '<span class="pip-wake">0</span>' : '◆'.repeat(card.cost);
      const disabled = (!unlocked && save.stardust < card.unlock) || (unlocked && wake) ? 'disabled' : '';
      const extra = [card.needText ? `条件：${card.needText}` : '', card.unlockText || ''].filter(Boolean).map((t) => `<div class="cond">${t}</div>`).join('');
      return `<button class="deck-card ${state}" style="--cc:${cat.color}" data-action="${action}" data-id="${card.id}" ${disabled}>
        <div class="dc-top"><span class="dc-cost">${pips}</span><span class="dc-cat">${cat.name}</span></div>
        <div class="dc-icon">${card.icon}</div>
        <div class="dc-name">${card.name}</div>
        <div class="dc-desc">${card.desc}${extra}</div>
        <div class="dc-foot">${foot}</div>
      </button>`;
    }).join('');
    const ks = KEEPSAKES.map((k) => {
      const own = keepsakeLevel(save, k.id) > 0;
      const school = k.school ? `<span class="kind" style="color:${SCHOOLS[k.school].color}">${SCHOOLS[k.school].name}</span>` : '';
      return `<div class="upgrade"><div class="grow"><b>${k.icon} ${k.name}</b>${school}<div class="small dim">${k.desc}</div></div>
        ${own ? '<button class="btn" disabled>已拥有</button>' : `<button class="btn" data-action="buyKeepsake" data-id="${k.id}" ${save.stardust < k.cost ? 'disabled' : ''}>✦ ${k.cost}</button>`}</div>`;
    }).join('');
    return `
      <div class="row deck-head">
        <div class="grow">
          <div class="small dim">心力 ${used} / ${cap}（上限 ${DECK_CAPACITY.base + DECK_CAPACITY.step * DECK_CAPACITY.costs.length}）</div>
          <div class="grasp">${Array.from({ length: cap }, (_, i) => `<span class="${i < used ? 'full' : ''}"></span>`).join('')}</div>
        </div>
        ${capCost == null ? '<button class="btn" disabled>心力已满</button>' : `<button class="btn" data-action="buyCapacity" ${save.stardust < capCost ? 'disabled' : ''}>心力 +${DECK_CAPACITY.step}　✦ ${capCost}</button>`}
      </div>
      <p class="small dim">星尘解锁卡牌；装备的卡总消耗（◆）不能超过心力上限。<b style="color:${CARD_CATS.wake.color}">觉醒卡</b>不占心力，解锁后只要相邻的指定卡牌都已装备就自动生效。解锁带「核心」的卡牌会让对应的强化进入奖池（不需要装备）。</p>
      <div class="deck-grid">${tiles}</div>
      <h3>遗物（开局携带 1 个）</h3><div style="display:grid;gap:8px">${ks}</div>`;
  }

  titleProfile(save) {
    const runs = save.runs;
    if (!runs.length) return '<p class="dim">还没有记录。打一局之后这里会显示你的枪法曲线。</p>';
    const series = (key) => runs.map((r) => r[key]).filter((v) => v != null);
    const last = runs.slice(-15).reverse();
    const best = (k) => Math.max(...series(k));
    const avg = (k) => { const s = series(k); return s.length ? s.reduce((a, b) => a + b, 0) / s.length : 0; };
    const reactions = series('reactionMs');
    return `
      <div class="stat-grid">
        ${this.statCard('精准度', `${(avg('accuracy') * 100).toFixed(1)}%`, this.spark(series('accuracy')))}
        ${this.statCard('爆头率', `${(avg('hsRate') * 100).toFixed(1)}%`, this.spark(series('hsRate')))}
        ${this.statCard('甩枪反应', reactions.length ? `${Math.round(avg('reactionMs'))}ms` : '—', this.spark(reactions.map((v) => -v)))}
        ${this.statCard('移动目标命中率', series('moverAcc').length ? `${(avg('moverAcc') * 100).toFixed(1)}%` : '—', this.spark(series('moverAcc')))}
        ${this.statCard('平均评级', series('avgTier').length ? tierBadge(Math.round(avg('avgTier'))) : '—', this.spark(series('avgTier')))}
        ${this.statCard('历史最高评级', series('peakTier').length ? tierBadge(best('peakTier')) : '—')}
        ${this.statCard('最远到达', `第 ${best('waves')} 波`)}
      </div>
      <p class="small dim">曲线为全部记录（左旧右新）。甩枪反应 = bot 进入视野到你第一次命中它的时间，曲线越高代表越快。移动目标命中率 = 对带机动的 bot 的命中 /（命中 + 打在它附近的空枪）。</p>
      <h3>最近 ${last.length} 局</h3>
      <table><tr><th>时间</th><th>结果</th><th>波数</th><th>精准</th><th>爆头率</th><th>最高评级</th><th>反应</th><th>星尘</th></tr>
      ${last.map((r) => `<tr><td>${new Date(r.date).toLocaleString()}</td><td>${r.victory ? '<span style="color:var(--good)">通关</span>' : '阵亡'}</td>
        <td>${r.waves}</td><td>${(r.accuracy * 100).toFixed(1)}%</td><td>${(r.hsRate * 100).toFixed(1)}%</td><td>${tierBadge(r.peakTier)}</td>
        <td>${r.reactionMs ? `${Math.round(r.reactionMs)}ms` : '—'}</td><td class="stardust">+${r.stardust}</td></tr>`).join('')}</table>`;
  }

  titleTuning(save) {
    const s = shopStats(save.shopLog);
    if (!s.visits) return '<p class="dim">还没有商店数据。这里会汇总你每次进商店时把金币花在了哪里，用来判断治疗 / 强化 / 星尘的价格是否平衡。</p>';
    return `
      <p class="small dim">原型的核心验证问题：<b>玩家在商店里是否真的会在回血、强化、星尘之间犹豫？</b>如果总是选同一个，就去 <code>src/config.js</code> 的 SHOP 段调价。</p>
      ${this.spendBlock(s)}
      <h3>当前价格</h3>
      <div class="small">回血 ${SHOP.healBasePrice}（每买一次 +${SHOP.healPriceStep}）· 强化 基础 ${SHOP.upgradePrice.base}（每级 +${SHOP.upgradePrice.baseStep}）/ 流派 ${SHOP.upgradePrice.school} / 通用 ${SHOP.upgradePrice.general} / 经济 ${SHOP.upgradePrice.econ} / 核心 ${SHOP.upgradePrice.core} ·
        星尘 ${SHOP.stardustBasePrice}（每买一次 +${SHOP.stardustPriceStep}，兑换量 ${SHOP.stardustYieldBase}）· 金币刷新 ${SHOP.goldReroll.base} 起。
        以上为第 3 波前后的价格，之后每 3 波 +1 倍。卡戎商店在第 ${SHOP.shopAfter.join('、')} 波后出现；卡戎之井在其余波次后以 ${Math.round(WELL.chance * 100)}% 概率出现。</div>
      <div style="margin-top:14px"><button class="btn danger" data-action="clearLog">清空商店日志</button></div>`;
  }

  spendBlock(s) {
    const pct = (k) => (s.totalSpend ? (s.spend[k] / s.totalSpend) * 100 : 0);
    const visitPct = (k) => ((s.visitsWith[k] / s.visits) * 100).toFixed(0);
    let verdict = '';
    const dominant = ['heal', 'upgrade', 'stardust'].find((k) => pct(k) > 70);
    const never = ['heal', 'upgrade', 'stardust'].filter((k) => s.visitsWith[k] === 0);
    if (s.visits < 5) verdict = '<div class="ok-box">样本还少（< 5 次逛店），多打几局再下结论。</div>';
    else if (dominant) verdict = `<div class="warn-box">${Math.round(pct(dominant))}% 的金币流向了「${SPEND_LABEL[dominant]}」。考虑提高它的价格，或降低其他选项的价格。</div>`;
    else if (never.length) verdict = `<div class="warn-box">从没买过：${never.map((k) => SPEND_LABEL[k]).join('、')}。它可能太贵或收益不明显。</div>`;
    else verdict = '<div class="ok-box">三种去向都有人买，没有一项占绝对主导。</div>';
    return `
      <div class="stat-grid">
        ${this.statCard('逛店次数', s.visits)}
        ${this.statCard('平均停留', `${s.avgTimeSec.toFixed(1)}s`)}
        ${this.statCard('平均剩余金币', s.avgLeftover.toFixed(0))}
        ${this.statCard('空手离开', `${visitPct('nothing')}%`)}
      </div>
      <div class="small">金币去向（按金额）</div>
      <div class="bar3"><div class="c-heal" style="width:${pct('heal')}%"></div><div class="c-relic" style="width:${pct('upgrade')}%"></div><div class="c-star" style="width:${pct('stardust')}%"></div></div>
      <div class="legend small dim"><span class="c-heal"></span>治疗 ${pct('heal').toFixed(0)}%<span class="c-relic"></span>强化 ${pct('upgrade').toFixed(0)}%<span class="c-star"></span>星尘 ${pct('stardust').toFixed(0)}%</div>
      <div class="small dim" style="margin-top:4px">买过的逛店占比：治疗 ${visitPct('heal')}% · 强化 ${visitPct('upgrade')}% · 星尘 ${visitPct('stardust')}%</div>
      ${verdict}`;
  }

  titleSettings(save) {
    const st = save.settings;
    const src = st.sensSource;
    const srcBtn = (id, label) => `<button class="tab ${src === id ? 'on' : ''}" data-action="sensSource" data-id="${id}">${label}</button>`;
    const inputLabel = { cs2: 'CS2 灵敏度', valorant: 'Valorant 灵敏度', cm360: 'cm/360（厘米）' }[src];
    const fovBtn = (k) => `<button class="tab ${Math.abs(st.fov - FOV_PRESETS[k].vfov) < 0.05 ? 'on' : ''}" data-action="fovPreset" data-value="${FOV_PRESETS[k].vfov}">匹配 ${FOV_PRESETS[k].name}（${FOV_PRESETS[k].vfov}°）</button>`;
    return `
      <h3>灵敏度</h3>
      <div class="row" style="gap:6px"><span class="small dim" style="width:90px">按哪个游戏填</span>${srcBtn('cs2', 'CS2')}${srcBtn('valorant', 'Valorant')}${srcBtn('cm360', 'cm/360')}</div>
      <div style="display:grid;gap:12px;margin-top:12px">
        <label class="row"><span style="width:130px">${inputLabel}</span><input class="num" type="number" min="0" step="${src === 'cm360' ? 0.5 : 0.001}" value="${st.sensInput}" data-setting="sensInput" /></label>
        <label class="row"><span style="width:130px">鼠标 DPI</span><input class="num" type="number" min="50" step="50" value="${st.dpi}" data-setting="dpi" />
          <span class="small dim">${src === 'cm360' ? 'cm/360 模式下 DPI 会影响实际转速' : '只用于计算 cm/360，不影响实际转速'}</span></label>
      </div>
      <div id="sens-info" class="sens-info">${this.sensInfo(save)}</div>
      <h3>视野（FOV）</h3>
      <div class="row" style="gap:6px">${fovBtn('cs2')}${fovBtn('valorant')}</div>
      <label class="row" style="margin-top:10px"><span style="width:130px">垂直 FOV</span><input type="range" min="55" max="100" step="0.5" value="${st.fov}" data-setting="fov" /><b id="fov-val">${Number(st.fov).toFixed(1)}°</b></label>
      <p class="small dim">灵敏度匹配的是转一圈的距离；FOV 决定目标在屏幕上的大小和移动速度。两者都和原游戏一致，手感才接近。</p>
      <h3>输入</h3>
      <label class="row"><input type="checkbox" ${st.rawInput ? 'checked' : ''} data-setting="rawInput" /><span>原始输入（绕过系统指针速度和加速，Chrome / Edge 支持）</span></label>
      <div class="small dim" id="raw-status" style="margin-top:4px">${this.rawStatusText(st)}</div>
      <p class="small dim">要和 CS2 / Valorant 完全一致：Windows 指针速度保持默认第 6 格，关闭「提高指针精确度」，显示缩放尽量用 100%。</p>
      <h3>声音</h3>
      <label class="row"><span style="width:130px">音量</span><input type="range" min="0" max="1" step="0.05" value="${st.volume}" data-setting="volume" /><b id="vol-val">${Math.round(st.volume * 100)}%</b></label>
      <h3>存档</h3>
      <button class="btn danger" data-action="resetSave">清空全部存档（星尘、命盘、档案）</button>`;
  }

  sensInfo(save) {
    const st = save.settings;
    const sens = gameSens(st);
    if (!(sens > 0)) return '<span style="color:var(--danger)">请输入大于 0 的数值</span>';
    const eq = equivalents(sens);
    const cm = cm360(sens, st.dpi);
    return `<div class="stat-grid" style="margin:10px 0 0">
        ${this.statCard('cm/360', `${cm.toFixed(1)} cm`)}
        ${this.statCard('CS2 等效', eq.cs2.toFixed(3))}
        ${this.statCard('Valorant 等效', eq.valorant.toFixed(3))}
        ${this.statCard('eDPI（CS2）', Math.round(eq.cs2 * st.dpi))}
      </div>
      <div class="small dim">每个鼠标 count 转 ${(GAME_YAW * sens).toFixed(4)}°（本游戏与 CS2 同一标准：0.022° × 灵敏度）。</div>`;
  }

  rawStatusText(st) {
    if (!st.rawInput) return '已关闭：使用系统处理后的鼠标移动。';
    return {
      on: '✓ 上次锁定鼠标时原始输入已生效。',
      unsupported: '⚠ 当前浏览器不支持原始输入，已退回普通模式，请按下方说明调整系统设置。',
      unknown: '开始游戏、锁定鼠标后会尝试启用。',
    }[this.rawStatus || 'unknown'];
  }

  refreshSensInfo(save, rawStatus) {
    this.rawStatus = rawStatus;
    const el = $('sens-info');
    if (el) el.innerHTML = this.sensInfo(save);
    const raw = $('raw-status');
    if (raw) raw.textContent = this.rawStatusText(save.settings);
  }

  statCard(k, v, extra = '') {
    return `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div>${extra}</div>`;
  }

  spark(values, w = 120, h = 26) {
    if (values.length < 2) return '';
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`).join(' ');
    return `<svg class="spark" width="${w}" height="${h}"><polyline points="${pts}" fill="none" stroke="#4cc9f0" stroke-width="2"/></svg>`;
  }

  // ---------------- 局内界面 ----------------

  upgradeCard(id, run, { action, slot, price, gold, sold } = {}) {
    const u = UPGRADES[id];
    const level = R.lv(run, id);
    const school = u.school ? SCHOOLS[u.school] : null;
    const cls = ['item', `cat-${u.cat}`, u.curse ? 'curse' : '', sold ? 'sold' : ''].join(' ');
    let tag = CAT_LABEL[u.cat];
    if (school) tag = `<span style="color:${school.color}">${school.name} · ${u.set}</span> · ${tag}`;
    if (u.cat === 'base') tag += ` · Lv${level} → Lv${level + 1}（最高 ${BASE_MAX_LEVEL}）`;
    if (u.curse) tag += ' · 诅咒';
    const priceHtml = price != null ? `<div class="price ${gold < price ? 'no' : ''}">${sold ? '已售出' : `● ${price}`}</div>` : '';
    const disabled = sold || (price != null && gold < price) ? 'disabled' : '';
    return `<button class="${cls}" data-action="${action}" data-id="${id}" data-slot="${slot ?? ''}" data-school="${u.school || ''}" data-cat="${u.cat}" ${disabled}>
      <div class="icon">${u.icon}</div><div class="name">${u.name}</div><div class="tag">${tag}</div>
      <div class="desc">${u.desc}</div>${priceHtml}</button>`;
  }

  upgradeList(run) {
    const ids = Object.keys(run.ups);
    if (!ids.length) return '无';
    return ids.map((id) => `${UPGRADES[id].name}${UPGRADES[id].cat === 'base' ? ` Lv${run.ups[id]}` : ''}`).join('、');
  }

  reward(run, choices, title) {
    this.show(`
      <div class="card crt">
        <h2>${title}</h2>
        <p class="dim small">免费三选一。强化只会奖励精准，不会替你瞄准。</p>
        <div class="choices">${choices.map((id) => this.upgradeCard(id, run, { action: 'pick' })).join('')}</div>
        <div class="row"><div class="grow small dim">已有强化：${this.upgradeList(run)}</div>
        <button class="btn" data-action="rerollReward" ${run.rerolls > 0 ? '' : 'disabled'}>🎲 命运骰刷新（剩 ${run.rerolls}）</button>
        <button class="btn ghost" data-action="skipReward">跳过</button></div>
      </div>`);
  }

  goodCard(run, shop, g, i) {
    const price = R.goodPrice(run, shop, g.id);
    const ok = R.canBuyGood(run, shop, i);
    let icon; let name; let desc; let cls = 'heal';
    if (shop.kind === 'well') {
      const w = WELL_ITEMS[g.id];
      [icon, name, desc] = [w.icon, w.name, w.desc];
      cls = g.id === 'dice' ? 'star' : 'well';
    } else if (g.id === 'heal') {
      [icon, name, desc] = ['🍖', '治疗', `恢复 ${R.healAmount(run)} 点生命。可以连续买，${R.has(run, 'clinic') ? '价格不再上涨。' : '越买越贵（整局累计）。'}`];
    } else if (g.id === 'heart') {
      [icon, name, desc] = ['❤', '生命之心', `生命上限 +${SHOP.heartHp}，并回复 ${SHOP.heartHp}。每家店限一个。`];
    } else {
      [icon, name, desc] = ['✦', '兑换星尘', `获得 <span class="stardust">${R.stardustYield(run)} 星尘</span>（局外货币），阵亡也保留。越深越划算，同一局越买越贵。`];
      cls = 'star';
    }
    const full = (g.id === 'heal' || g.id === 'ration') && run.hp >= run.maxHp;
    const label = g.sold ? '已售出' : full ? '满血' : `● ${price}`;
    return `<button class="item ${cls} ${g.sold ? 'sold' : ''}" data-action="buyGood" data-slot="${i}" data-kind="${g.id}" ${ok ? '' : 'disabled'}>
      <div class="icon">${icon}</div><div class="name">${name}</div><div class="desc">${desc}</div>
      <div class="price ${run.gold < price ? 'no' : ''}">${label}</div></button>`;
  }

  // 卡戎商店 / 卡戎之井
  shop(run, shop) {
    const isShop = shop.kind === 'shop';
    const nextWave = WAVES[run.waveIndex];
    const nextCount = Object.values(nextWave.count).reduce((a, b) => a + b, 0);
    const goldReroll = isShop ? R.goldRerollPrice(run, shop) : null;
    const temps = run.temp.map((t) => `${WELL_ITEMS[t.id].name}（剩 ${t.waves} 波）`).join('、');
    this.show(`
      <div class="card crt">
        <div class="row">
          <h2 class="grow" style="margin:0">${isShop ? '⚖ 卡戎商店' : '⛲ 卡戎之井'}</h2>
          <div class="stardust" style="font-size:18px;margin-right:16px">🎲 ${run.rerolls}</div>
          <div class="goldtxt" style="font-size:24px">● ${run.gold}</div>
        </div>
        <p class="small dim">${isShop ? '区域结束。强化、生命之心、治疗、星尘。' : '路边的小摊：便宜的临时道具，每件只能买一次。'}
          生命 ${run.hp}/${run.maxHp}${run.shield ? ` · 护盾 ${run.shield}` : ''} · 下一波：${nextWave.name}，${nextCount} 个敌人</p>
        <div class="choices">
          ${shop.items.map((it, i) => this.upgradeCard(it.id, run, { action: 'buyItem', slot: i, price: R.upgradePrice(run, it.id), gold: run.gold, sold: it.sold })).join('')}
          ${shop.goods.map((g, i) => this.goodCard(run, shop, g, i)).join('')}
        </div>
        <div class="row" style="margin-bottom:10px">
          <button class="btn" data-action="rerollShop" data-token="1" ${run.rerolls > 0 ? '' : 'disabled'}>🎲 命运骰刷新（剩 ${run.rerolls}）</button>
          ${isShop ? `<button class="btn" data-action="rerollShop" data-token="0" ${run.gold < goldReroll ? 'disabled' : ''}>⟳ 金币刷新 ● ${goldReroll}</button>` : ''}
          <span class="small dim">只刷新没买的${isShop ? '强化' : '道具'}。${isShop ? `金币刷新每次涨价，本店已刷新 ${shop.goldRerolls} 次。` : ''}</span>
        </div>
        ${temps ? `<p class="small" style="color:var(--gold)">生效中：${temps}</p>` : ''}
        <p class="small dim">已有强化：${this.upgradeList(run)}</p>
        <div class="row"><div class="grow small dim">本局已兑换星尘：<span class="stardust">${run.stardustFromShop}</span></div>
          <button class="btn primary" data-action="leaveShop">进入${nextWave.name}</button></div>
      </div>`);
  }

  pause() {
    this.show(`<div class="card crt" style="max-width:420px;text-align:center">
      <h2>已暂停</h2><p class="dim small">点击继续会重新锁定鼠标。</p>
      <div class="row" style="justify-content:center;margin-top:14px">
        <button class="btn primary" data-action="resume">继续</button>
        <button class="btn danger" data-action="abandon">放弃本局</button></div></div>`);
  }

  results(run, summary, settlement) {
    const visits = run.shopVisits.map((v) => {
      const buys = v.purchases.map((p) => `${p.kind === 'upgrade' ? UPGRADES[p.id].name : p.kind === 'well' ? WELL_ITEMS[p.id].name : p.token ? '命运骰刷新' : SPEND_LABEL[p.kind]}${p.price ? `(${p.price})` : ''}`).join('、') || '<span class="dim">什么都没买</span>';
      return `<tr><td>${v.kind === 'well' ? '卡戎之井' : '卡戎商店'}（第 ${v.wave} 波后）</td><td>${v.hpIn}/${v.maxHp}</td><td>${v.goldIn}</td><td>${buys}</td><td>${v.goldOut}</td><td>${(v.timeMs / 1000).toFixed(1)}s</td></tr>`;
    }).join('');
    this.show(`
      <div class="card crt">
        <h2>${summary.victory ? '<span style="color:var(--good)">通关！</span>' : '<span style="color:var(--danger)">阵亡</span>'}
          <span class="dim small">到达 ${summary.waves}/${WAVES.length} 波</span></h2>
        <div class="stat-grid">
          ${this.statCard('最高评级', tierBadge(summary.peakTier))}
          ${this.statCard('爆头数', summary.headshots)}
          ${this.statCard('精准度', `${(summary.accuracy * 100).toFixed(1)}%`)}
          ${this.statCard('击杀', summary.kills)}
          ${this.statCard('甩枪反应', summary.reactionMs ? `${Math.round(summary.reactionMs)}ms` : '—')}
          ${this.statCard('移动目标命中率', summary.moverAcc != null ? `${(summary.moverAcc * 100).toFixed(1)}%` : '—')}
          ${this.statCard('获得星尘', `<span class="stardust">+${summary.stardust}</span>`)}
        </div>
        <h3>星尘结算</h3>
        <table>
          <tr><td>火力评级：每波结束时的评级（D=0 … S=4）累计 ${run.ratingScore} × ${SETTLEMENT.perTierWave}</td><td class="stardust">+${settlement.rating}</td></tr>
          <tr><td>击杀 ${summary.kills} × ${SETTLEMENT.perKill}</td><td class="stardust">+${settlement.kills}</td></tr>
          <tr><td>到达深度 ${summary.waves} 波 × ${SETTLEMENT.perWave}</td><td class="stardust">+${settlement.depth}</td></tr>
          ${summary.victory ? `<tr><td>通关奖励</td><td class="stardust">+${settlement.victory}</td></tr>` : ''}
          ${settlement.blank ? `<tr><td>空白徽章 +25%</td><td class="stardust">+${settlement.blank}</td></tr>` : ''}
          ${settlement.star ? `<tr><td>星之觉醒 +15%</td><td class="stardust">+${settlement.star}</td></tr>` : ''}
          <tr><td>商店兑换</td><td class="stardust">+${settlement.shop}</td></tr>
        </table>
        <h3>本局商店决策</h3>
        ${visits ? `<table><tr><th>商店</th><th>进店生命</th><th>进店金币</th><th>购买</th><th>剩余</th><th>停留</th></tr>${visits}</table>` : '<p class="dim small">本局没有进过商店。</p>'}
        <p class="small dim">强化：${this.upgradeList(run)}${run.keepsake ? ` · 遗物：${KEEPSAKES.find((k) => k.id === run.keepsake).name}` : ''}</p>
        <div class="row" style="margin-top:16px">
          <button class="btn primary" data-action="start">再来一局</button>
          <button class="btn" data-action="toTitle">返回标题</button>
        </div>
      </div>`);
  }

  // ---------------- HUD ----------------

  updateHud(run, waveLabel, enemiesLeft, extra = {}) {
    $('hp-fill').style.width = `${(run.hp / run.maxHp) * 100}%`;
    $('hp-text').textContent = `${Math.ceil(run.hp)} / ${run.maxHp}`;
    $('shield').innerHTML = '<span></span>'.repeat(run.shield);
    $('gold-val').textContent = run.gold;
    $('wave-label').textContent = waveLabel;
    $('enemies-left').textContent = `剩余敌人 ${enemiesLeft}`;
    // 火力评级：字母 + 进度条 + 金币倍率；升降级时闪一下
    const rt = run.rating;
    const t = TIER(rt.tier);
    const box = $('rating-box');
    if (rt.tier !== this.lastTier) {
      const up = this.lastTier != null && rt.tier > this.lastTier;
      const down = this.lastTier != null && rt.tier < this.lastTier;
      $('rating').textContent = t.id;
      box.style.setProperty('--tc', t.color);
      box.classList.remove('up', 'down');
      void box.offsetWidth;
      if (up) box.classList.add('up');
      if (down) box.classList.add('down');
      this.lastTier = rt.tier;
    }
    $('rating-fill').style.width = `${Math.min(1, rt.points / t.need) * 100}%`;
    $('rating-gold').textContent = `金币 ×${R.goldMultiplier(run)}`;
    box.classList.toggle('decay', rt.idle > RATING.decayDelay && rt.points > 0 && !R.has(run, 'steady'));
    const fw = $('focus-wrap');
    const active = run.focusTime > 0;
    const ready = R.canActivateFocus(run);
    $('focus-fill').style.width = active ? `${(run.focusTime / Math.max(0.01, run.focusTotal)) * 100}%` : `${(run.focus / R.focusMax(run)) * 100}%`;
    fw.classList.toggle('ready', ready);
    fw.classList.toggle('active', active);
    $('focus-hint').textContent = active ? `${R.has(run, 'stasis') ? '时停' : '子弹时间'} ${run.focusTime.toFixed(1)}s`
      : run.debtTime > 0 ? `时间债：敌人加速 ${run.debtTime.toFixed(1)}s`
        : ready ? '子弹时间就绪：右键 / E / 空格' : '专注充能中（命中充能）';
    $('focus-overlay').classList.toggle('on', active);
    $('view').classList.toggle('slowmo', active);
    const mag = R.magSize(run);
    const rl = R.reloading(run);
    $('ammo-val').textContent = rl ? '—' : run.ammo;
    $('ammo-max').textContent = mag;
    $('ammo').classList.toggle('low', !rl && run.ammo <= Math.ceil(mag * 0.3));
    const hint = $('ammo-hint');
    hint.textContent = rl ? `换弹中 ${run.reloadLeft.toFixed(1)}s` : 'R 换弹';
    hint.classList.toggle('reloading', rl);
    const ring = $('reload-ring');
    ring.classList.toggle('on', rl);
    if (rl) ring.style.setProperty('--p', 1 - run.reloadLeft / Math.max(0.01, run.reloadTotal));
    const heat = $('heat');
    heat.hidden = !R.has(run, 'overheat');
    if (!heat.hidden) {
      $('heat-fill').style.width = `${(run.heat / 20) * 100}%`;
      heat.classList.toggle('full', run.heat >= 20);
    }
    $('crosshair').classList.toggle('flick', !!extra.flick);
    $('vignette').classList.toggle('low', run.hp / run.maxHp < 0.3);
  }

  renderUpgradeBar(run) {
    const temps = run.temp.map((t) => `<div class="relic-chip temp" title="${WELL_ITEMS[t.id].name}：${WELL_ITEMS[t.id].desc}（剩 ${t.waves} 波）">${WELL_ITEMS[t.id].icon}<sub>${t.waves}</sub></div>`).join('');
    $('relic-bar').innerHTML = temps + Object.keys(run.ups).map((id) => {
      const u = UPGRADES[id];
      const color = u.school ? SCHOOLS[u.school].color : '';
      const lvTag = u.cat === 'base' ? `<sub>${run.ups[id]}</sub>` : '';
      return `<div class="relic-chip cat-${u.cat}" style="${color ? `border-color:${color}` : ''}" title="${u.name}：${u.desc}">${u.icon}${lvTag}</div>`;
    }).join('');
  }

  hitmarker(head) {
    const el = $('hitmarker');
    el.style.color = head ? '#ff9e00' : '#ffffff';
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  hurt(angleRad) {
    const v = $('vignette');
    v.classList.add('hit');
    setTimeout(() => v.classList.remove('hit'), 60);
    const d = $('hurtdir');
    d.style.transform = `rotate(${angleRad}rad)`;
    d.classList.add('on');
    setTimeout(() => d.classList.remove('on'), 80);
  }

  floater(x, y, text, cls = 'gold') {
    const el = document.createElement('div');
    el.className = `floater ${cls}`;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.textContent = text;
    $('floaters').appendChild(el);
    setTimeout(() => el.remove(), 900);
  }

  banner(text) {
    const el = $('banner');
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  // 雷达：上方 = 视线方向
  drawRadar(bots, yaw, range = 32) {
    const c = this.radar;
    const W = 180;
    const mid = W / 2;
    const scale = (mid - 8) / range;
    c.clearRect(0, 0, W, W);
    // 视野扇形
    c.fillStyle = 'rgba(76,201,240,0.08)';
    c.beginPath();
    c.moveTo(mid, mid);
    c.arc(mid, mid, mid - 4, -Math.PI / 2 - 0.78, -Math.PI / 2 + 0.78);
    c.closePath();
    c.fill();
    c.strokeStyle = 'rgba(255,77,109,0.35)';
    c.beginPath();
    c.arc(mid, mid, 3.6 * scale, 0, Math.PI * 2);
    c.stroke();
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    for (const b of bots) {
      const p = b.position;
      let sx = p.x * rx + p.z * rz;
      let sy = p.x * fx + p.z * fz;
      const d = Math.hypot(sx, sy);
      if (d > range) { sx *= range / d; sy *= range / d; }
      c.fillStyle = `#${b.def.color.toString(16).padStart(6, '0')}`;
      c.beginPath();
      c.arc(mid + sx * scale, mid - sy * scale, b.type === 'heavy' ? 5 : 3.5, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = '#fff';
    c.beginPath();
    c.moveTo(mid, mid - 6);
    c.lineTo(mid - 4, mid + 4);
    c.lineTo(mid + 4, mid + 4);
    c.fill();
  }
}
