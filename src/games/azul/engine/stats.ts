import type { Seat } from './board';

const STORAGE_KEY = 'fxq:azul-stats:v1';

/** 本地累计胜率统计 */
export interface WinStats {
  games: number;
  /** 座位号 -> 胜场 */
  wins: Record<string, number>;
  /** 累计轮数，用于观察平均局长 */
  rounds: number;
}

const EMPTY: WinStats = { games: 0, wins: {}, rounds: 0 };

/**
 * 从 localStorage 读取累计统计
 *
 * @returns 统计数据；无记录或解析失败时返回空统计
 */
export function loadStats(): WinStats {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY, wins: {} };
    const parsed = JSON.parse(raw) as Partial<WinStats>;
    return {
      games: typeof parsed.games === 'number' ? parsed.games : 0,
      wins: parsed.wins && typeof parsed.wins === 'object' ? (parsed.wins as Record<string, number>) : {},
      rounds: typeof parsed.rounds === 'number' ? parsed.rounds : 0,
    };
  } catch {
    return { ...EMPTY, wins: {} };
  }
}

/**
 * 记录一局结果并写回 localStorage
 *
 * @param winner 获胜座位
 * @param rounds 本局轮数
 * @returns 更新后的累计统计
 */
export function recordResult(winner: Seat | null, rounds: number): WinStats {
  const stats = loadStats();
  stats.games += 1;
  stats.rounds += rounds;
  if (winner !== null) {
    const key = String(winner);
    stats.wins[key] = (stats.wins[key] ?? 0) + 1;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  } catch {
    // 隐私模式下写入失败不影响对局体验
  }
  return stats;
}

/** 清空累计统计 */
export function resetStats(): WinStats {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 忽略存储不可用
  }
  return { ...EMPTY, wins: {} };
}
