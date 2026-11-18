/** 宝石颜色：永久折扣与卡牌费用均不含黄金。 */
export const GEM_COLORS = ['white', 'blue', 'green', 'red', 'black'] as const;
export type GemColor = (typeof GEM_COLORS)[number];
export type TokenColor = GemColor | 'gold';
export type Tier = 1 | 2 | 3;

export type Gems = Record<GemColor, number>;
export type Tokens = Gems & { gold: number };

export interface DevelopmentCard {
  id: string;
  tier: Tier;
  bonus: GemColor;
  points: number;
  cost: Gems;
}

export interface Noble {
  id: string;
  points: number;
  requirement: Gems;
}

export interface Player {
  tokens: Tokens;
  cards: DevelopmentCard[];
  reserved: DevelopmentCard[];
  nobles: Noble[];
  points: number;
}

/** 可自定义的对局规则；由开局配置解析为完整快照，确保重开与回放一致。 */
export interface GameRules {
  /** 达到目标声望后触发本轮结束 */
  victoryPoints: number;
  /** 单人最多持有的实体筹码数（含黄金） */
  tokenLimit: number;
  /** 单人最多预留的发展卡数量 */
  reserveLimit: number;
  /** 每阶市场正面展示的发展卡数量 */
  marketSize: number;
  /** 开局可到访的贵族数量 */
  nobleCount: number;
  /** 每一种普通颜色的银行初始筹码数 */
  gemSupply: number;
  /** 银行初始黄金通配筹码数 */
  goldSupply: number;
  /** 双取同色前，银行至少需要的该色筹码数 */
  doubleTakeMinimum: number;
}

/** AI 档位决定本局所有电脑商会的规划强度，真人席位不受影响。 */
export type AiStrength = 'easy' | 'normal' | 'hard' | 'expert';

export interface GameConfig {
  /** 本局固定的 AI 强度；未指定时采用标准档。 */
  aiStrength?: AiStrength;
  playerCount: 2 | 3 | 4;
  seed: number;
  turnDelayMs: number;
  /** null 表示全 AI 演示；否则指定真人席位。 */
  humanSeat: number | null;
  /** 可覆盖经典规则；缺省时完全遵守基础版。 */
  rules?: Partial<GameRules>;
}

export interface GameState {
  /** 本局固定规则快照，不随后续 UI 配置变化。 */
  rules: Readonly<GameRules>;
  players: Player[];
  bank: Tokens;
  decks: [DevelopmentCard[], DevelopmentCard[], DevelopmentCard[]];
  market: [(DevelopmentCard | null)[], (DevelopmentCard | null)[], (DevelopmentCard | null)[]];
  nobles: Noble[];
  current: number;
  turn: number;
  finalRound: boolean;
  phase: 'playing' | 'finished';
  winners: number[];
}

export type Move =
  | { kind: 'take'; colors: GemColor[]; returns?: TokenColor[] }
  | { kind: 'double'; color: GemColor; returns?: TokenColor[] }
  | { kind: 'reserve'; tier: Tier; slot: number | null; returns?: TokenColor[] }
  | { kind: 'buy'; source: 'market'; tier: Tier; slot: number; nobleId?: string }
  | { kind: 'buy'; source: 'reserved'; slot: number; nobleId?: string }
  | { kind: 'pass' };

export interface GameEvent {
  player: number;
  kind: Move['kind'] | 'noble' | 'finish' | 'discard';
  text: string;
  turn: number;
}

export interface MoveResult {
  state: GameState;
  events: GameEvent[];
}
