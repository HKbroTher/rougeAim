// 灵敏度换算测试：node tools/sens-tests.mjs
import { gameSens, cm360, equivalents, sensInSource, migrateSettings, radPerCount } from '../src/sens.js';

const close = (a, b, eps = 1e-3) => Math.abs(a - b) < eps;
const cases = [
  ['CS2 1.0 @800 DPI = 51.95 cm/360', close(cm360(gameSens({ sensSource: 'cs2', sensInput: 1 }), 800), 51.95, 0.01)],
  ['Valorant 0.314 ≈ CS2 1.0', close(gameSens({ sensSource: 'valorant', sensInput: 0.314 }), 0.999, 0.001)],
  ['CS2 2.0 → Valorant 0.629', close(equivalents(2).valorant, 0.6286)],
  ['cm/360 输入 51.95 @800 → CS2 1.0', close(gameSens({ sensSource: 'cm360', sensInput: 51.95, dpi: 800 }), 1, 0.001)],
  ['eDPI 不变：400×2 与 800×1 转一圈距离相同', close(cm360(2, 400), cm360(1, 800))],
  ['切换来源保持手感：CS2 1.5 → Valorant → CS2', close(gameSens({ sensSource: 'valorant', sensInput: sensInSource('valorant', 1.5, 800) }), 1.5, 0.005)],
  ['每 count 弧度 = 0.022° × 灵敏度', close(radPerCount(1), (0.022 * Math.PI) / 180, 1e-12)],
  ['旧存档倍率 1.0 → CS2 5.73（手感不变）', close(migrateSettings({ sensitivity: 1 }).sensInput, 5.73, 0.001)],
  ['新存档默认 CS2 1.0、FOV 73.74', (() => { const s = migrateSettings({}); return s.sensInput === 1 && s.fov === 73.74 && s.dpi === 800; })()],
];
let fail = 0;
for (const [name, ok] of cases) { if (!ok) fail++; console.log(`${ok ? '✓' : '✗'} ${name}`); }
console.log(`\n${cases.length - fail}/${cases.length} 通过`);
process.exit(fail ? 1 : 0);
