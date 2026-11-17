import type { Seat } from './board';

/** 骆驼色编码：0 黄 1 橙 2 蓝 3 绿 4 白 */
export type CamelColor = 0 | 1 | 2 | 3 | 4;

/** 参赛骆驼数量 */
export const CAMEL_COUNT = 5;

/** 骰子面值：每颗骰子为 1-3 各两面，等概率 */
export type DieValue = 1 | 2 | 3;

/** 一次掷骰的显式结果：随机只发生在会话层，规则核心只消费结果 */
export interface RollOutcome {
  color: CamelColor;
  value: DieValue;
}

/** 地形块面：绿洲（骆驼单位前进一格）/ 海市蜃楼（后退一格并钻入下方） */
export type DesertFace = 'oasis' | 'mirage';

/** 地形块状态；pos 为 null 表示在玩家手中未上板 */
export interface DesertState {
  pos: number | null;
  face: DesertFace;
}

/** 腿部押注金币片（票面 5/3/2，堆叠自顶向底） */
export interface LegTicket {
  color: CamelColor;
  value: number;
}

/** 每色腿部押注片的初始堆叠（自顶向底：先拿者得 5） */
export const LEG_TICKET_VALUES: readonly number[] = [5, 3, 2];

/** 总冠/末名押注牌堆中的一张明注牌 */
export interface RaceBet {
  player: number;
  color: CamelColor;
}

/** 押注牌堆方向 */
export type RaceBetTarget = 'winner' | 'loser';

/** 终局押注结算顺序：按放置先后 8/5/3/2/1，其余正确牌各得 1 */
export const RACE_PAYOUTS: readonly number[] = [8, 5, 3, 2, 1];

/** 错误押注牌的罚金（金币不足时豁免，不为负） */
export const WRONG_BET_PENALTY = 1;

/** 开局资金（埃及镑） */
export const START_COINS = 3;

/** 玩家个人状态 */
export interface PlayerState {
  coins: number;
  /** 本腿持有的腿部押注片 */
  legTickets: LegTicket[];
  /** 本腿持有的金字塔金币片数量 */
  pyramidTickets: number;
  /** 手中未打出的总冠/末名押注牌（每色一张开局） */
  hand: CamelColor[];
  /** 沙漠地形块；pos 为 null 表示在手中 */
  desert: DesertState;
}

/** 对局阶段：竞速中 / 终局 */
export type GamePhase = 'racing' | 'gameEnd';

/** 一局游戏的完整状态（所有变更返回新对象） */
export interface GameState {
  seats: Seat[];
  /** players[玩家序号] = 玩家状态 */
  players: PlayerState[];
  /** stacks[格号] = 该格骆驼堆叠（自底向顶）；下标 FINISH_INDEX 为终点线桶 */
  stacks: CamelColor[][];
  /** legStacks[骆驼色] = 该色腿部押注片堆叠（自顶向底） */
  legStacks: number[][];
  /** 骰子塔中尚未摇出的骰子颜色 */
  diceRemaining: CamelColor[];
  /** diceValues[骆驼色] = 本腿已摇出的点数（null 表示仍在塔中） */
  diceValues: (DieValue | null)[];
  /** 金字塔金币片剩余张数 */
  pyramidRemaining: number;
  /** 总冠军押注牌堆（按放置先后排列，先放者在前） */
  winnerPile: RaceBet[];
  /** 总末名押注牌堆（按放置先后排列，先放者在前） */
  loserPile: RaceBet[];
  /** 当前行动玩家序号（对应 seats 下标） */
  current: number;
  /** 当前腿序号（从 1 开始） */
  leg: number;
  phase: GamePhase;
  /** 获胜座位，未结束为 null */
  winner: Seat | null;
}

/** 候选动作显式建模：AI 输出与玩家操作走同一类型 */
export type Move =
  /** 拿走某色腿部押注片堆顶的一张 */
  | { kind: 'legBet'; color: CamelColor }
  /** 放置自己的地形块到 pos 格，面朝 face（每腿仅一次，腿末收回手中） */
  | { kind: 'desert'; pos: number; face: DesertFace }
  /** 拿走一张金字塔金币片并摇出一颗骰子移动骆驼 */
  | { kind: 'roll' }
  /** 打出手中一张押注牌到总冠或总末名牌堆 */
  | { kind: 'raceBet'; target: RaceBetTarget; color: CamelColor };

/** 呈现步骤联合类型：每步携带完成后的完整状态快照，供会话逐步推进 */
export type MoveStep =
  | { kind: 'legBet'; player: number; color: CamelColor; value: number; after: GameState }
  | { kind: 'desert'; player: number; pos: number; face: DesertFace; after: GameState }
  | { kind: 'pyramid'; player: number; after: GameState }
  | { kind: 'dieRoll'; player: number; color: CamelColor; value: DieValue; after: GameState }
  | {
      kind: 'camelMove';
      player: number;
      color: CamelColor;
      from: number;
      to: number;
      /** 随同移动的背上骆驼（自底向顶，不含移动驼自身） */
      carried: CamelColor[];
      after: GameState;
    }
  | {
      kind: 'desertTrigger';
      player: number;
      /** 地形块持有者 */
      owner: number;
      color: CamelColor;
      face: DesertFace;
      gained: number;
      after: GameState;
    }
  | {
      kind: 'legScore';
      player: number;
      /** 腿部押注片净收益 */
      tickets: number;
      /** 金字塔金币片收益 */
      pyramid: number;
      gained: number;
      after: GameState;
    }
  | { kind: 'legReset'; player: number; leg: number; after: GameState }
  | { kind: 'raceBet'; player: number; target: RaceBetTarget; color: CamelColor; after: GameState }
  | {
      kind: 'raceScore';
      player: number;
      target: RaceBetTarget;
      color: CamelColor;
      correct: boolean;
      gained: number;
      after: GameState;
    };

/** 一次行动的结算结果（含腿末与终局自动结算的全部步骤） */
export interface MoveResult {
  state: GameState;
  steps: MoveStep[];
}

/** 对局配置 */
export interface GameConfig {
  /** 参与座位（2-8 个，按座位号升序） */
  seats: Seat[];
  /** 每步呈现的基础停顿（毫秒） */
  turnDelayMs: number;
  /** AI 向前搜索的玩家行动数 */
  aiDepth: number;
  /** 随机种子 */
  seed: number;
  /** 每位玩家的开局资金（埃及镑） */
  startCoins: number;
}
