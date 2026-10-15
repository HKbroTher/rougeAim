// DOM 界面：HUD 与各个全屏界面。按钮通过 data-action 统一派发给 game。
import { UPGRADES, SCHOOLS, CAT_LABEL, BASE_MAX_LEVEL } from './upgrades.js';
import { META_UPGRADES, KEEPSAKES, BOTS, WAVES, FOCUS, SHOP, SETTLEMENT, WEAPON } from './config.js';
import { upgradeLevel, nextUpgradeCost, keepsakeLevel, nextKeepsakeCost, shopStats } from './meta.js';
import * as R from './run.js';

const $ = (id) => document.getElementById(id);

const KIND_LABEL = { stat: '宽容度', talent: '开局选择', unlock: '解锁' };
const SPEND_LABEL = { heal: '回血', upgrade: '强化', stardust: '星尘' };

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
      if (e.target.dataset.setting) onAction('setting', { key: e.target.dataset.setting, value: e.target.value });
    });
    this.lastMultClass = '';
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
  }

  // ---------------- 标题 / 局外 ----------------

  title(save, tab = 'play') {
    const tabs = [
      ['play', '开始'], ['workshop', '星尘工坊'], ['profile', '枪法档案'], ['tuning', '调参数据'], ['settings', '设置'],
    ];
    const body = {
      play: () => this.titlePlay(save),
      workshop: () => this.titleWorkshop(save),
      profile: () => this.titleProfile(save),
      tuning: () => this.titleTuning(save),
      settings: () => this.titleSettings(save),
    }[tab]();
    this.show(`
      <div class="card">
        <div class="row">
          <div class="grow">
            <h1>ROGUE<span style="color:var(--accent)">AIM</span><small>瞄准 × Roguelike 原型 v0.1</small></h1>
            <div class="dim small">bot 从四面八方冲来，碰到就扣血。你只能转身和开枪。</div>
          </div>
          <div class="stardust" style="font-size:22px">✦ ${save.stardust} 星尘</div>
        </div>
        <div class="tabs">${tabs.map(([id, n]) => `<button class="tab ${id === tab ? 'on' : ''}" data-action="tab" data-tab="${id}">${n}</button>`).join('')}</div>
        ${body}
      </div>`);
  }

  titlePlay(save) {
    const bots = Object.values(BOTS).map((b) => `<li><b>${b.label}</b> <span class="dim">— ${b.skill}</span></li>`).join('');
    return `
      <div class="cols">
        <div>
          <h3>操作</h3>
          <div class="keys">
            <kbd>鼠标</kbd><span>360° 转动视角（站在原地不能移动）</span>
            <kbd>左键</kbd><span>射击（按住连发）</span>
            <kbd>R</kbd><span>换弹（弹匣 ${WEAPON.magSize} 发，${WEAPON.reloadTime} 秒；打空弹匣会自动换弹）</span>
            <kbd>右键 / E / 空格</kbd><span>释放专注：${FOCUS.duration} 秒子弹时间，敌人减速到 ${Math.round(FOCUS.timeScale * 100)}%，你的转身、射速、换弹不受影响</span>
            <kbd>Esc</kbd><span>暂停</span>
          </div>
          <h3>规则</h3>
          <ul class="small" style="padding-left:18px;margin:0">
            <li>连续命中提升<b>倍率</b>，倍率越高击杀掉落金币越多。<b style="color:var(--danger)">打空一枪倍率清零</b>。</li>
            <li>爆头伤害 ×2，并额外 +1 连杀。打空的子弹同样消耗弹匣，换弹期间不能开火。</li>
            <li>共 ${WAVES.length} 波。每波后免费三选一<b>强化</b>，再进商店：<span class="goldtxt">回血 / 强化 / 星尘</span>。</li>
            <li>强化分三个流派：<b style="color:${SCHOOLS.head.color}">爆头</b>、<b style="color:${SCHOOLS.spray.color}">扫射</b>、<b style="color:${SCHOOLS.time.color}">子弹时间</b>，金色的<b class="goldtxt">核心强化</b>会改变规则。</li>
            <li>星尘是局外货币：买了这局变弱，下一局受益。越深的商店兑换越多。</li>
          </ul>
        </div>
        <div>
          <h3>敌人</h3>
          <ul class="small" style="padding-left:18px;margin:0">${bots}</ul>
          <h3>携带遗物</h3>
          ${this.keepsakePicker(save)}
          <h3>本局加成</h3>
          <div class="small dim">${this.metaSummary(save) || '暂无 —— 去星尘工坊看看'}</div>
          <div style="margin-top:22px"><button class="btn primary" data-action="start">开始一局</button></div>
          <p class="small dim">点击开始后会锁定鼠标。灵敏度可在「设置」里调整。</p>
        </div>
      </div>`;
  }

  keepsakePicker(save) {
    const owned = KEEPSAKES.filter((k) => keepsakeLevel(save, k.id) > 0);
    const btn = (id, label, title) => `<button class="tab ${save.keepsake === id ? 'on' : ''}" data-action="keepsake" data-id="${id || ''}" title="${title}">${label}</button>`;
    const cur = KEEPSAKES.find((k) => k.id === save.keepsake);
    const lvNow = cur ? keepsakeLevel(save, cur.id) : 0;
    return `<div class="row" style="gap:6px">${btn(null, '不携带', '')}${owned.map((k) => btn(k.id, `${k.icon} ${k.name} Lv${keepsakeLevel(save, k.id)}`, k.levels.join('；'))).join('')}</div>
      <div class="small dim" style="margin-top:6px">${cur ? cur.levels.slice(0, lvNow).map((t, i) => `Lv${i + 1}：${t}`).join('<br>') : '每局开局选 1 个遗物带进去。'}</div>`;
  }

  metaSummary(save) {
    return META_UPGRADES.filter((u) => upgradeLevel(save, u.id) > 0)
      .map((u) => `${u.name} Lv${upgradeLevel(save, u.id)}`)
      .join('　·　');
  }

  titleWorkshop(save) {
    const buyBtn = (action, id, cost) => (cost == null
      ? '<button class="btn" disabled>已满级</button>'
      : `<button class="btn" data-action="${action}" data-id="${id}" ${save.stardust < cost ? 'disabled' : ''}>✦ ${cost}</button>`);
    const keepsakes = KEEPSAKES.map((k) => {
      const lv = keepsakeLevel(save, k.id);
      const cost = nextKeepsakeCost(save, k);
      const school = k.school ? `<span class="kind" style="color:${SCHOOLS[k.school].color}">${SCHOOLS[k.school].name}</span>` : '';
      const lines = k.levels.map((t, i) => `<div class="small ${i < lv ? '' : 'dim'}">Lv${i + 1}：${t}</div>`).join('');
      return `<div class="upgrade"><div class="grow"><b>${k.icon} ${k.name}</b>${school}${lines}</div>
        <div class="lv">${lv}/${k.costs.length}</div>${buyBtn('buyKeepsake', k.id, cost)}</div>`;
    }).join('');
    const row = (u) => {
      const lv = upgradeLevel(save, u.id);
      return `<div class="upgrade">
        <div class="grow"><b>${u.name}</b><span class="kind ${u.kind}">${KIND_LABEL[u.kind]}</span>
          <div class="small dim">${u.desc}</div></div>
        <div class="lv">${lv}/${u.costs.length}</div>${buyBtn('upgrade', u.id, nextUpgradeCost(save, u))}</div>`;
    };
    return `<p class="small dim">局外成长以解锁为主；数值成长只给宽容度（血量、护盾），且有上限。</p>
      <h3>遗物（开局携带）</h3><div style="display:grid;gap:8px">${keepsakes}</div>
      <h3>解锁</h3><div style="display:grid;gap:8px">${META_UPGRADES.filter((u) => u.kind === 'unlock').map(row).join('')}</div>
      <h3>宽容度与开局选择</h3><div style="display:grid;gap:8px">${META_UPGRADES.filter((u) => u.kind !== 'unlock').map(row).join('')}</div>`;
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
        ${this.statCard('平均最高连杀', avg('maxCombo').toFixed(1), this.spark(series('maxCombo')))}
        ${this.statCard('历史最高连杀', best('maxCombo'))}
        ${this.statCard('最远到达', `第 ${best('waves')} 波`)}
      </div>
      <p class="small dim">曲线为全部记录（左旧右新）。甩枪反应 = bot 进入视野到你第一次命中它的时间，曲线越高代表越快。移动目标命中率 = 对带机动的 bot 的命中 /（命中 + 打在它附近的空枪）。</p>
      <h3>最近 ${last.length} 局</h3>
      <table><tr><th>时间</th><th>结果</th><th>波数</th><th>精准</th><th>爆头率</th><th>最高连杀</th><th>反应</th><th>星尘</th></tr>
      ${last.map((r) => `<tr><td>${new Date(r.date).toLocaleString()}</td><td>${r.victory ? '<span style="color:var(--good)">通关</span>' : '阵亡'}</td>
        <td>${r.waves}</td><td>${(r.accuracy * 100).toFixed(1)}%</td><td>${(r.hsRate * 100).toFixed(1)}%</td><td>${r.maxCombo}</td>
        <td>${r.reactionMs ? `${Math.round(r.reactionMs)}ms` : '—'}</td><td class="stardust">+${r.stardust}</td></tr>`).join('')}</table>`;
  }

  titleTuning(save) {
    const s = shopStats(save.shopLog);
    if (!s.visits) return '<p class="dim">还没有商店数据。这里会汇总你每次进商店时把金币花在了哪里，用来判断回血 / 强化 / 星尘的价格是否平衡。</p>';
    return `
      <p class="small dim">原型的核心验证问题：<b>玩家在商店里是否真的会在回血、强化、星尘之间犹豫？</b>如果总是选同一个，就去 <code>src/config.js</code> 的 SHOP 段调价。</p>
      ${this.spendBlock(s)}
      <h3>当前价格</h3>
      <div class="small">回血 ${SHOP.healBasePrice}（每买一次 +${SHOP.healPriceStep}）· 强化 基础 ${SHOP.upgradePrice.base}（每级 +${SHOP.upgradePrice.baseStep}）/ 流派 ${SHOP.upgradePrice.school} / 通用 ${SHOP.upgradePrice.general} / 经济 ${SHOP.upgradePrice.econ} / 核心 ${SHOP.upgradePrice.core} ·
        星尘 ${SHOP.stardustBasePrice}（每买一次 +${SHOP.stardustPriceStep}，兑换量 ${SHOP.stardustYieldBase}+${SHOP.stardustYieldPerDepth}×深度）。
        以上为第 0 层基础价，实际价格 ×(1 + ${SHOP.priceGrowth}×深度)。</div>
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
      <div class="legend small dim"><span class="c-heal"></span>回血 ${pct('heal').toFixed(0)}%<span class="c-relic"></span>强化 ${pct('upgrade').toFixed(0)}%<span class="c-star"></span>星尘 ${pct('stardust').toFixed(0)}%</div>
      <div class="small dim" style="margin-top:4px">买过的逛店占比：回血 ${visitPct('heal')}% · 强化 ${visitPct('upgrade')}% · 星尘 ${visitPct('stardust')}%</div>
      ${verdict}`;
  }

  titleSettings(save) {
    const st = save.settings;
    return `
      <div style="display:grid;gap:14px;margin-top:8px">
        <label class="row"><span style="width:90px">灵敏度</span><input type="range" min="0.2" max="3" step="0.05" value="${st.sensitivity}" data-setting="sensitivity" /><b id="sens-val">${Number(st.sensitivity).toFixed(2)}</b></label>
        <label class="row"><span style="width:90px">音量</span><input type="range" min="0" max="1" step="0.05" value="${st.volume}" data-setting="volume" /><b id="vol-val">${Math.round(st.volume * 100)}%</b></label>
      </div>
      <h3>存档</h3>
      <button class="btn danger" data-action="resetSave">清空全部存档（星尘、工坊、档案）</button>`;
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
      <div class="card">
        <h2>${title}</h2>
        <p class="dim small">免费三选一。强化只会奖励精准，不会替你瞄准。</p>
        <div class="choices">${choices.map((id) => this.upgradeCard(id, run, { action: 'pick' })).join('')}</div>
        <div class="row"><div class="grow small dim">已有强化：${this.upgradeList(run)}</div>
        <button class="btn ghost" data-action="skipReward">跳过</button></div>
      </div>`);
  }

  shop(run, shop) {
    const heal = R.healPrice(run);
    const full = run.hp >= run.maxHp;
    const sd = shop.sellsStardust;
    const sdPrice = R.stardustPrice(run);
    const sdYield = R.stardustYield(run);
    const nextWave = WAVES[run.waveIndex];
    const nextCount = Object.values(nextWave.count).reduce((a, b) => a + b, 0);
    this.show(`
      <div class="card">
        <div class="row">
          <h2 class="grow" style="margin:0">商店 <span class="dim small">（第 ${shop.number} 家）</span></h2>
          <div class="goldtxt" style="font-size:24px">● ${run.gold}</div>
        </div>
        <p class="small dim">生命 ${run.hp}/${run.maxHp}${run.shield ? ` · 护盾 ${run.shield}` : ''} · 下一波：${nextWave.name}，${nextCount} 个敌人</p>
        <div class="choices">
          <button class="item heal" data-action="buyHeal" ${run.gold < heal || full ? 'disabled' : ''}>
            <div class="icon">✚</div><div class="name">回血</div><div class="tag">本局已购 ${run.healBuys} 次</div>
            <div class="desc">恢复 ${R.healAmount(run)} 点生命。${R.has(run, 'clinic') ? '价格不再上涨。' : '每次购买后价格上涨。'}</div>
            <div class="price ${run.gold < heal ? 'no' : ''}">${full ? '满血' : `● ${heal}`}</div>
          </button>
          ${shop.items.map((it, i) => this.upgradeCard(it.id, run, { action: 'buyItem', slot: i, price: R.upgradePrice(run, it.id), gold: run.gold, sold: it.sold })).join('')}
          ${sd ? `<button class="item star" data-action="buyStardust" ${run.gold < sdPrice ? 'disabled' : ''}>
            <div class="icon">✦</div><div class="name">兑换星尘</div><div class="tag">局外货币 · 本局已兑 ${run.stardustBuys} 次</div>
            <div class="desc">获得 <span class="stardust">${sdYield} 星尘</span>，阵亡也保留。这局会变弱，下一局受益。
              <div class="small price-note" style="margin-top:6px">越深的商店兑换越多；同一局越买越贵。</div></div>
            <div class="price ${run.gold < sdPrice ? 'no' : ''}">● ${sdPrice}</div>
          </button>` : `<div class="item" style="opacity:.5"><div class="icon">✦</div><div class="name">本店不卖星尘</div></div>`}
        </div>
        <p class="small dim">已有强化：${this.upgradeList(run)}</p>
        <div class="row"><div class="grow small dim">本局已兑换星尘：<span class="stardust">${run.stardustFromShop}</span></div>
          <button class="btn primary" data-action="leaveShop">进入${nextWave.name}</button></div>
      </div>`);
  }

  pause() {
    this.show(`<div class="card" style="max-width:420px;text-align:center">
      <h2>已暂停</h2><p class="dim small">点击继续会重新锁定鼠标。</p>
      <div class="row" style="justify-content:center;margin-top:14px">
        <button class="btn primary" data-action="resume">继续</button>
        <button class="btn danger" data-action="abandon">放弃本局</button></div></div>`);
  }

  results(run, summary, settlement) {
    const visits = run.shopVisits.map((v) => {
      const buys = v.purchases.map((p) => `${p.kind === 'upgrade' ? UPGRADES[p.id].name : SPEND_LABEL[p.kind]}(${p.price})`).join('、') || '<span class="dim">什么都没买</span>';
      return `<tr><td>第 ${v.shop} 家</td><td>${v.hpIn}/${v.maxHp}</td><td>${v.goldIn}</td><td>${buys}</td><td>${v.goldOut}</td><td>${(v.timeMs / 1000).toFixed(1)}s</td></tr>`;
    }).join('');
    this.show(`
      <div class="card">
        <h2>${summary.victory ? '<span style="color:var(--good)">通关！</span>' : '<span style="color:var(--danger)">阵亡</span>'}
          <span class="dim small">到达 ${summary.waves}/${WAVES.length} 波</span></h2>
        <div class="stat-grid">
          ${this.statCard('最高连杀', summary.maxCombo)}
          ${this.statCard('爆头数', summary.headshots)}
          ${this.statCard('精准度', `${(summary.accuracy * 100).toFixed(1)}%`)}
          ${this.statCard('击杀', summary.kills)}
          ${this.statCard('甩枪反应', summary.reactionMs ? `${Math.round(summary.reactionMs)}ms` : '—')}
          ${this.statCard('移动目标命中率', summary.moverAcc != null ? `${(summary.moverAcc * 100).toFixed(1)}%` : '—')}
          ${this.statCard('获得星尘', `<span class="stardust">+${summary.stardust}</span>`)}
        </div>
        <h3>星尘结算</h3>
        <table>
          <tr><td>${SETTLEMENT.comboSqrt} × √最高连杀 ${summary.maxCombo}</td><td class="stardust">+${settlement.combo}</td></tr>
          <tr><td>爆头 ${summary.headshots} × ${SETTLEMENT.perHeadshot}</td><td class="stardust">+${settlement.headshots}</td></tr>
          <tr><td>到达深度 ${summary.waves} 波 × ${SETTLEMENT.perWave}</td><td class="stardust">+${settlement.depth}</td></tr>
          ${summary.victory ? `<tr><td>通关奖励</td><td class="stardust">+${settlement.victory}</td></tr>` : ''}
          ${settlement.blank ? `<tr><td>空白徽章 +25%</td><td class="stardust">+${settlement.blank}</td></tr>` : ''}
          <tr><td>商店兑换</td><td class="stardust">+${settlement.shop}</td></tr>
        </table>
        <h3>本局商店决策</h3>
        ${visits ? `<table><tr><th>商店</th><th>进店生命</th><th>进店金币</th><th>购买</th><th>剩余</th><th>停留</th></tr>${visits}</table>` : '<p class="dim small">本局没有进过商店。</p>'}
        <p class="small dim">强化：${this.upgradeList(run)}${run.keepsake ? ` · 遗物：${KEEPSAKES.find((k) => k.id === run.keepsake).name} Lv${run.keepsakeLv}` : ''}</p>
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
    const mult = R.multiplier(run);
    const multEl = $('mult');
    multEl.textContent = `${mult.toFixed(1)}x`;
    const cls = mult >= 4 ? 'max' : mult >= 2.5 ? 'hot' : '';
    if (cls !== this.lastMultClass && !multEl.classList.contains('break')) {
      multEl.classList.remove('hot', 'max');
      if (cls) multEl.classList.add(cls);
      this.lastMultClass = cls;
    }
    $('combo').textContent = `连杀 ${run.combo}`;
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
    $('relic-bar').innerHTML = Object.keys(run.ups).map((id) => {
      const u = UPGRADES[id];
      const color = u.school ? SCHOOLS[u.school].color : '';
      const lvTag = u.cat === 'base' ? `<sub>${run.ups[id]}</sub>` : '';
      return `<div class="relic-chip cat-${u.cat}" style="${color ? `border-color:${color}` : ''}" title="${u.name}：${u.desc}">${u.icon}${lvTag}</div>`;
    }).join('');
  }

  comboBreak() {
    const el = $('mult');
    el.classList.remove('break', 'hot', 'max');
    this.lastMultClass = '';
    void el.offsetWidth;
    el.classList.add('break');
    setTimeout(() => el.classList.remove('break'), 320);
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
