import { CAMEL_META, DESERT_FORBIDDEN_POS, FINISH_INDEX, TRACK_SPACES } from './board';
import type { Seat } from './board';
import {
  CAMEL_COUNT,
  LEG_TICKET_VALUES,
  RACE_PAYOUTS,
  START_COINS,
  WRONG_BET_PENALTY,
} from './types';
import type {
  CamelColor,
  DesertState,
  GameState,
  LegTicket,
  Move,
  MoveResult,
  MoveStep,
  PlayerState,
  RaceBet,
  RaceBetTarget,
  RollOutcome,
} from './types';

/** 创建空玩家状态：五色押注牌各一张，地形块在手 */
function createPlayerState(startCoins: number): PlayerState {
  return {
    coins: startCoins,
    legTickets: [],
    pyramidTickets: 0,
    hand: [0, 1, 2, 3, 4] as CamelColor[],
    desert: { pos: null, face: 'oasis' },
  };
}

/** 复制玩家状态，供快照与结算取得独占可写副本。 */
function clonePlayerState(player: PlayerState): PlayerState {
  return {
    coins: player.coins,
    legTickets: player.legTickets.map((ticket) => ({ ...ticket })),
    pyramidTickets: player.pyramidTickets,
    hand: [...player.hand],
    desert: { ...player.desert },
  };
}

/**
 * 深拷贝对局状态，生成相互独立的动画或回放快照。
 * @param state 原始局面
 * @returns 所有数组与玩家状态都独立的新局面
 */
export function cloneState(state: GameState): GameState {
  return {
    ...state,
    seats: [...state.seats],
    players: state.players.map(clonePlayerState),
    stacks: state.stacks.map((stack) => [...stack]),
    legStacks: state.legStacks.map((stack) => [...stack]),
    diceRemaining: [...state.diceRemaining],
    diceValues: [...state.diceValues],
    winnerPile: state.winnerPile.map((bet) => ({ ...bet })),
    loserPile: state.loserPile.map((bet) => ({ ...bet })),
  };
}

/**
 * 当前骆驼名次（第 1 名在前）：按格号降序，同格内堆叠顶部优先。
 * 终点线桶（下标 FINISH_INDEX）视为最前。
 * @param state 当前局面
 * @returns 骆驼色序列，从领先到最后
 */
export function rankOf(state: GameState): CamelColor[] {
  const order: CamelColor[] = [];
  for (let pos = FINISH_INDEX; pos >= 0; pos -= 1) {
    const stack = state.stacks[pos];
    // 堆叠中越靠上的骆驼名次越靠前
    for (let i = stack.length - 1; i >= 0; i -= 1) order.push(stack[i]);
  }
  return order;
}

/**
 * 创建一局初始状态：按骰子结果把五峰骆驼放上赛道 1-3 格并堆叠。
 * 无随机源时使用确定性布局（便于测试与预览），有随机源时掷出 1-3 并随机决定同格堆叠顺序。
 *
 * @param seats 参与座位（2-8 个）
 * @param rng 随机源；缺省时初始布局确定
 * @param startCoins 每位玩家的开局资金；缺省为规则默认值
 */
export function createInitialState(seats: Seat[], rng?: () => number, startCoins: number = START_COINS): GameState {
  // 确定性布局的固定骰点：黄橙蓝绿白 → 1 2 3 2 1，同格按色号自底向顶
  const deterministic: readonly number[] = [1, 2, 3, 2, 1];
  const stacks: CamelColor[][] = Array.from({ length: FINISH_INDEX + 1 }, () => []);
  for (let color = 0; color < CAMEL_COUNT; color += 1) {
    const value = rng ? 1 + Math.floor(rng() * 3) : deterministic[color];
    stacks[value - 1].push(color as CamelColor);
  }
  if (rng) {
    // 规则允许同格骆驼任意堆叠；用随机源洗乱保证各色起跑优势均等
    for (const stack of stacks) {
      for (let i = stack.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [stack[i], stack[j]] = [stack[j], stack[i]];
      }
    }
  }
  return {
    seats: [...seats],
    players: seats.map(() => createPlayerState(startCoins)),
    stacks,
    legStacks: Array.from({ length: CAMEL_COUNT }, () => [...LEG_TICKET_VALUES]),
    diceRemaining: [0, 1, 2, 3, 4] as CamelColor[],
    diceValues: [null, null, null, null, null],
    pyramidRemaining: 5,
    winnerPile: [],
    loserPile: [],
    current: 0,
    leg: 1,
    phase: 'racing',
    winner: null,
  };
}

/**
 * 计算地形块的合法落格：空格、非第 1 格、不与任何其他地形块相邻。
 * 地形块每腿只能放置一次，上板后一直留到腿末收回，因此已上板时没有可放置目标。
 *
 * @param state 当前局面
 * @param player 行动玩家序号
 * @returns 可放置的格号升序列表（已上板则为空）
 */
export function desertTargetsOf(state: GameState, player: number): number[] {
  if (state.players[player].desert.pos !== null) return [];
  const others: number[] = [];
  for (const p of state.players) {
    if (p.desert.pos !== null) others.push(p.desert.pos);
  }
  const targets: number[] = [];
  for (let pos = DESERT_FORBIDDEN_POS + 1; pos < TRACK_SPACES; pos += 1) {
    if (state.stacks[pos].length > 0) continue;
    // 目标格须无块且不与任何他块相邻（±1 即相邻；第 1 格恒无块，无需环绕判定）
    if (others.some((other) => other === pos || Math.abs(other - pos) === 1)) continue;
    targets.push(pos);
  }
  return targets;
}

/**
 * 计算当前玩家的全部合法行动，按 legBet → desert → roll → raceBet 稳定排序。
 *
 * @param state 当前对局状态（须处于 racing 阶段）
 * @returns 合法行动列表
 */
export function getLegalMoves(state: GameState): Move[] {
  const moves: Move[] = [];
  for (let color = 0; color < CAMEL_COUNT; color += 1) {
    if (state.legStacks[color].length > 0) moves.push({ kind: 'legBet', color: color as CamelColor });
  }
  for (const pos of desertTargetsOf(state, state.current)) {
    moves.push({ kind: 'desert', pos, face: 'oasis' });
    moves.push({ kind: 'desert', pos, face: 'mirage' });
  }
  if (state.pyramidRemaining > 0) moves.push({ kind: 'roll' });
  const hand = state.players[state.current].hand;
  for (const target of ['winner', 'loser'] as const) {
    for (const color of hand) moves.push({ kind: 'raceBet', target, color });
  }
  return moves;
}

/**
 * 掷出一颗骰子：从塔中剩余骰子里等概率摇出颜色，点数等概率 1-3。
 * 随机只经由传入的随机源（createRng 产物），保证同种子可复现。
 *
 * @param state 当前局面
 * @param rng 随机源
 * @returns 摇出的骰色与点数
 */
export function drawRollOutcome(state: GameState, rng: () => number): RollOutcome {
  const remaining = state.diceRemaining;
  const color = remaining[Math.floor(rng() * remaining.length)];
  const value = (1 + Math.floor(rng() * 3)) as RollOutcome['value'];
  return { color, value };
}

/**
 * 枚举掷骰的全部可能结果及概率，供 AI 机会节点与统计共用（单一口径）。
 * @param state 当前局面
 * @returns 结果与概率列表（色等概率 × 点数等概率 1-3）
 */
export function rollOutcomes(state: GameState): { outcome: RollOutcome; prob: number }[] {
  const count = state.diceRemaining.length;
  const list: { outcome: RollOutcome; prob: number }[] = [];
  for (const color of state.diceRemaining) {
    for (const value of [1, 2, 3] as const) {
      list.push({ outcome: { color, value }, prob: 1 / (count * 3) });
    }
  }
  return list;
}

// ---------------------------------------------------------------- 移动结算

/** 找到某峰骆驼所在格与其堆叠下标 */
function findCamel(state: GameState, color: CamelColor): { pos: number; index: number } {
  for (let pos = 0; pos <= FINISH_INDEX; pos += 1) {
    const index = state.stacks[pos].indexOf(color);
    if (index >= 0) return { pos, index };
  }
  throw new Error(`找不到骆驼 ${CAMEL_META[color].name}`);
}

/** 骆驼单位落地：正常落顶；海市蜃楼后退时整单位插入堆叠底部 */
function landUnit(state: GameState, unit: CamelColor[], dest: number, under: boolean): void {
  state.stacks[dest] = under ? [...unit, ...state.stacks[dest]] : [...state.stacks[dest], ...unit];
}

/**
 * 解析一次掷骰的骆驼移动（含地形块触发的附加移动），就地修改副本并记录步骤。
 * @param next 可写状态副本
 * @param player 掷骰玩家序号
 * @param outcome 掷骰结果
 * @param steps 可选的呈现步骤数组
 */
function resolveRoll(
  next: GameState,
  player: number,
  outcome: RollOutcome,
  steps?: MoveStep[],
): void {
  // 1. 摇出骰子：骰子出塔，点数记到骰面供棋盘展示
  const dieIndex = next.diceRemaining.indexOf(outcome.color);
  next.diceRemaining.splice(dieIndex, 1);
  next.diceValues[outcome.color] = outcome.value;
  if (steps) steps.push({ kind: 'dieRoll', player, ...outcome, after: cloneState(next) });

  // 2. 骆驼移动：移动驼连同其背上全部骆驼一起前进，身下的留在原地
  const { pos: from, index } = findCamel(next, outcome.color);
  const carried = next.stacks[from].slice(index + 1);
  next.stacks[from] = next.stacks[from].slice(0, index);
  const unit: CamelColor[] = [outcome.color, ...carried];
  // 越过终点线的步数作废：骆驼停在终点线桶，比赛随即结束
  const to = Math.min(from + outcome.value, FINISH_INDEX);
  landUnit(next, unit, to, false);
  if (steps) steps.push({ kind: 'camelMove', player, color: outcome.color, from, to, carried, after: cloneState(next) });

  // 3. 地形块触发：落在块格上的骆驼单位立即 ±1 格，块主得 1 EP
  if (to < FINISH_INDEX) {
    for (let owner = 0; owner < next.players.length; owner += 1) {
      const desert = next.players[owner].desert;
      if (desert.pos !== to) continue;
      next.players[owner].coins += 1;
      // 移动单位此刻位于块格堆叠顶部；拆出它与先到的驻留单位，只移动它
      const stack = next.stacks[to];
      next.stacks[to] = stack.slice(0, stack.length - unit.length);
      // 绿洲向前跳顶；海市蜃楼向后且整单位插入下方堆叠底部
      const under = desert.face === 'mirage';
      const dest = under ? to - 1 : Math.min(to + 1, FINISH_INDEX);
      landUnit(next, unit, dest, under);
      if (steps) {
        steps.push({
          kind: 'desertTrigger',
          player,
          owner,
          color: outcome.color,
          face: desert.face,
          gained: 1,
          after: cloneState(next),
        });
      }
      // 相邻格不得再有地形块，附加移动不会二次触发
      break;
    }
  }
}

/**
 * 某张腿部押注片在给定名次下的收益：领先驼按票面（5/3/2）、第二名 +1、其余 -1。
 * 腿末结算与 AI 评估共用同一口径。
 *
 * @param ticket 押注片
 * @param rank 当前骆驼名次（第 1 名在前）
 * @returns 该片的金币收益（可为负）
 */
export function legTicketGain(ticket: LegTicket, rank: readonly CamelColor[]): number {
  const place = rank.indexOf(ticket.color);
  return place === 0 ? ticket.value : place === 1 ? 1 : -1;
}

/** 押注牌堆的单张结算结果 */
export interface RaceBetPayout {
  player: number;
  target: RaceBetTarget;
  color: CamelColor;
  correct: boolean;
  gained: number;
}

/**
 * 计算总冠/末名押注牌堆的全部结算明细（不修改状态）：
 * 按放置先后核对，命中真实领先/垫底驼的牌依次得 8/5/3/2/1（其余命中各得 1），
 * 错注每张罚 1。终局结算与 AI 评估共用同一口径。
 *
 * @param state 当前局面（须已确定名次）
 * @returns 每张牌的结算明细，按牌堆放置顺序
 */
export function raceBetPayouts(state: GameState): RaceBetPayout[] {
  const rank = rankOf(state);
  const answer: Record<RaceBetTarget, CamelColor> = {
    winner: rank[0],
    loser: rank[rank.length - 1],
  };
  const payouts: RaceBetPayout[] = [];
  for (const target of ['winner', 'loser'] as const) {
    const pile = target === 'winner' ? state.winnerPile : state.loserPile;
    // correctIndex 决定命中牌的奖金档位：先放者拿大头
    let correctIndex = 0;
    for (const bet of pile) {
      const correct = bet.color === answer[target];
      const gained = correct
        ? RACE_PAYOUTS[Math.min(correctIndex, RACE_PAYOUTS.length - 1)]
        : -WRONG_BET_PENALTY;
      if (correct) correctIndex += 1;
      payouts.push({ player: bet.player, target, color: bet.color, correct, gained });
    }
  }
  return payouts;
}

/**
 * 腿末结算：按名次结算每位玩家的押注片与金币片；金币不为负。全部玩家各记一步。
 *
 * @param next 可写状态副本
 * @param steps 可选的呈现步骤数组
 */
function settleLeg(next: GameState, steps?: MoveStep[]): void {
  const rank = rankOf(next);
  for (let player = 0; player < next.players.length; player += 1) {
    const state = next.players[player];
    let tickets = 0;
    for (const ticket of state.legTickets) tickets += legTicketGain(ticket, rank);
    const pyramid = state.pyramidTickets;
    const gained = tickets + pyramid;
    state.coins = Math.max(0, state.coins + gained);
    if (steps) steps.push({ kind: 'legScore', player, tickets, pyramid, gained, after: cloneState(next) });
  }
}

/**
 * 开启新腿：押注片、金币片与骰子复位，地形块回到各自主人手中。
 * @param next 可写状态副本
 * @param player 掷出本腿最后一骰的玩家（日志归属）
 * @param steps 可选的呈现步骤数组
 */
function resetLeg(next: GameState, player: number, steps?: MoveStep[]): void {
  next.legStacks = Array.from({ length: CAMEL_COUNT }, () => [...LEG_TICKET_VALUES]);
  next.diceRemaining = [0, 1, 2, 3, 4] as CamelColor[];
  next.diceValues = [null, null, null, null, null];
  next.pyramidRemaining = 5;
  for (const p of next.players) {
    p.legTickets = [];
    p.pyramidTickets = 0;
    p.desert.pos = null;
  }
  next.leg += 1;
  if (steps) steps.push({ kind: 'legReset', player, leg: next.leg, after: cloneState(next) });
}

/**
 * 终局押注结算：按 raceBetPayouts 的明细给各玩家入账（金币不为负），每张牌记一步。
 *
 * @param next 可写状态副本
 * @param steps 可选的呈现步骤数组
 */
function settleRaceBets(next: GameState, steps?: MoveStep[]): void {
  for (const payout of raceBetPayouts(next)) {
    const player = next.players[payout.player];
    player.coins = Math.max(0, player.coins + payout.gained);
    if (steps) {
      steps.push({
        kind: 'raceScore',
        player: payout.player,
        target: payout.target,
        color: payout.color,
        correct: payout.correct,
        gained: payout.gained,
        after: cloneState(next),
      });
    }
  }
}

/** 最多金币者获胜；金币并列时玩家序号更小者胜（先手 tie-break） */
function winnerOf(players: readonly PlayerState[], seats: readonly Seat[]): Seat {
  let best = 0;
  for (let player = 1; player < players.length; player += 1) {
    if (players[player].coins > players[best].coins) best = player;
  }
  return seats[best];
}

/** 同一结算流程可选择记录动画；无 steps 时不创建事件对象或完整快照。 */
function applyMoveCore(
  state: GameState,
  move: Move,
  outcome?: RollOutcome,
  steps?: MoveStep[],
): GameState {
  const player = state.current;
  const next = cloneState(state);

  switch (move.kind) {
    case 'legBet': {
      // getLegalMoves 只给出仍有余票的色，堆顶票价必存在
      const value = next.legStacks[move.color].splice(0, 1)[0];
      next.players[player].legTickets.push({ color: move.color, value });
      if (steps) steps.push({ kind: 'legBet', player, color: move.color, value, after: cloneState(next) });
      break;
    }
    case 'desert': {
      const desert: DesertState = next.players[player].desert;
      // 每腿仅一次：合法行动只会从「在手中」时给出放置选项
      desert.pos = move.pos;
      desert.face = move.face;
      if (steps) steps.push({ kind: 'desert', player, pos: move.pos, face: move.face, after: cloneState(next) });
      break;
    }
    case 'raceBet': {
      const hand = next.players[player].hand;
      hand.splice(hand.indexOf(move.color), 1);
      const bet: RaceBet = { player, color: move.color };
      (move.target === 'winner' ? next.winnerPile : next.loserPile).push(bet);
      if (steps) steps.push({ kind: 'raceBet', player, target: move.target, color: move.color, after: cloneState(next) });
      break;
    }
    case 'roll': {
      // 未显式给出结果时使用确定性默认（第一颗剩余骰、点数 1），供测试与搜索复用同一结算口径
      const result = outcome ?? { color: next.diceRemaining[0], value: 1 as const };
      next.pyramidRemaining -= 1;
      next.players[player].pyramidTickets += 1;
      if (steps) steps.push({ kind: 'pyramid', player, after: cloneState(next) });
      resolveRoll(next, player, result, steps);
      break;
    }
  }

  // 回合轮转到下一位玩家（腿末开新腿也由其开始，等价于规则中的起始标记传递）
  next.current = (player + 1) % next.players.length;

  if (next.stacks[FINISH_INDEX].length > 0) {
    // 有骆驼越过终点线：先做最后一腿结算，再结算总冠/末名押注并终局
    settleLeg(next, steps);
    settleRaceBets(next, steps);
    next.phase = 'gameEnd';
    next.winner = winnerOf(next.players, next.seats);
  } else if (next.pyramidRemaining === 0) {
    // 骰子塔摇空：本腿结束，结算后立即复位开新腿
    settleLeg(next, steps);
    resetLeg(next, player, steps);
  }
  return next;
}

/**
 * 应用一次行动，并记录逐步呈现快照（腿末与终局结算随行动自动完成）。
 * @param state 行动前的局面
 * @param move 选定的合法行动
 * @param outcome 掷骰结果；仅 roll 行动使用，缺省时按确定性默认
 * @returns 结算后的新状态与逐步呈现步骤
 */
export function applyMove(state: GameState, move: Move, outcome?: RollOutcome): MoveResult {
  const steps: MoveStep[] = [];
  return { state: applyMoveCore(state, move, outcome, steps), steps };
}

/**
 * 应用合法行动并结算，省去动画快照（AI 树搜索与批量模拟使用）。
 * @param state 行动前的局面
 * @param move 选定的合法行动
 * @param outcome 掷骰结果；仅 roll 行动使用，缺省时按确定性默认
 * @returns 不修改输入的下一局面
 */
export function applyMoveState(state: GameState, move: Move, outcome?: RollOutcome): GameState {
  return applyMoveCore(state, move, outcome);
}


