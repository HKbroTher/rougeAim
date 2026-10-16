// 灵敏度与 FOV 换算。本游戏底层与 CS2 同一标准：每个鼠标 count 转 0.022° × 灵敏度，
// 所以「本游戏灵敏度」= CS2 灵敏度。其他游戏按每 count 角度换算。

export const YAW = {
  cs2: 0.022,      // CS2 / Source：0.022° / count
  valorant: 0.07,  // Valorant：0.07° / count
};

export const GAME_YAW = YAW.cs2;

// 垂直 FOV 预设（16:9）：CS2 水平 106.26°，Valorant 水平 103°
export const FOV_PRESETS = {
  cs2: { name: 'CS2', vfov: 73.74 },
  valorant: { name: 'Valorant', vfov: 70.53 },
};

// 旧版本灵敏度（每像素 0.0022 弧度 × 倍率）换算成 CS2 单位
const LEGACY_DEG_PER_COUNT = (0.0022 * 180) / Math.PI;

// 设置 → 本游戏灵敏度（= CS2 单位）
// source：'cs2' | 'valorant' | 'cm360'（直接输入转一圈的厘米数，需要 DPI）
export function gameSens({ sensSource, sensInput, dpi }) {
  const v = Number(sensInput) || 0;
  if (sensSource === 'valorant') return (v * YAW.valorant) / GAME_YAW;
  if (sensSource === 'cm360') return v > 0 && dpi > 0 ? (360 * 2.54) / (GAME_YAW * dpi * v) : 0;
  return v;
}

// 本游戏灵敏度 → 某个来源下的输入值（切换来源时保持手感不变）
export function sensInSource(source, sens, dpi) {
  if (source === 'valorant') return +((sens * GAME_YAW) / YAW.valorant).toFixed(3);
  if (source === 'cm360') return +cm360(sens, dpi).toFixed(1);
  return +sens.toFixed(3);
}

// 本游戏灵敏度 → 每个 count 转多少弧度
export function radPerCount(sens) {
  return (GAME_YAW * sens * Math.PI) / 180;
}

// 转一整圈需要移动多少厘米
export function cm360(sens, dpi) {
  return sens > 0 && dpi > 0 ? (360 / (GAME_YAW * sens * dpi)) * 2.54 : Infinity;
}

// 本游戏灵敏度 → 各游戏的等效灵敏度
export function equivalents(sens) {
  return {
    cs2: (sens * GAME_YAW) / YAW.cs2,
    valorant: (sens * GAME_YAW) / YAW.valorant,
  };
}

// 旧存档迁移：保持原来的手感不变
export function migrateSettings(st) {
  if (st.sensInput == null) {
    const legacy = Number(st.sensitivity);
    st.sensSource = 'cs2';
    st.sensInput = Number.isFinite(legacy) && legacy > 0 ? +((legacy * LEGACY_DEG_PER_COUNT) / GAME_YAW).toFixed(3) : 1.0;
  }
  delete st.sensitivity;
  if (st.dpi == null) st.dpi = 800;
  if (st.fov == null) st.fov = FOV_PRESETS.cs2.vfov;
  if (st.rawInput == null) st.rawInput = true;
  return st;
}
