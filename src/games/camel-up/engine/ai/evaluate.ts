import { FINISH_INDEX } from '../board';
import { rankOf } from '../rules';
import { CAMEL_COUNT, RACE_PAYOUTS, WRONG_BET_PENALTY } from '../types';
import type { CamelColor, GameState } from '../types';

/** 局面评估的分项得分（单位：EP），用于 AI 决策解释面板。 */
export interface EvaluationBreakdown {
  /** 现有金币 */
  coins: number;
  /** 手中腿部押注片的期望净收益 */
  legTickets: number;
  /** 金币片确定收益（每张 +1） */
  pyramid: number;
  /** 已放置押注牌的期望净收益 */
  raceBets: number;
  /** 手牌的期权价值 */
  hand: number;
  /** 地形块上板的期望触发收益 */
  desert: number;
  total: number;
}

/** 终局胜负分值，按规则给出的 winner 判断（金币并列已裁决） */
export const WIN_VALUE = 1_000_000;

// 手牌尚未兑现，只计小期权价值，避免把可选押注高估成确定收益
const HAND_CARD_VALUE = 1;
// 单峰骆驼本腿最多还剩一颗自己的骰子，前进 1-3 格等概率
const DIE_ADVANCE = 3;
/** 本腿剩余骰子的期望位移：摇到 1-3 点等概率，均值 2 */
const EXPECTED_DIE_ADVANCE = (1 + DIE_ADVANCE) / 2;
/**
 * 全场押注概率的软化温度（格）：距终点权重按 exp(-剩余距离 / 温度) 归一。
 * why：若改按「当前名次」取固定概率，名次互换会让估值阶跃 0.2，
 * 于是「不摇骰、维持名次」比摇骰估值更高，AI 会靠搬地形块无限拖延；
 * 距离是连续量，掷骰带来的估值变化平滑，不会系统性奖励拖延。
 */
const RACE_DISTANCE_TEMPERATURE = 4;

/** 本腿剩余骰的完整组合枚举结果 */
interface LegExpectation {
  /** 每峰骆驼腿末拿第一的概率 */
  first: number[];
  /** 每峰骆驼腿末拿第二的概率 */
  second: number[];
  /** 每位玩家地形块在本腿剩余骰中的期望触发收益（EP） */
  tileIncome: number[];
}

// 腿末分布只取决于赛道叠放、剩余骰与地形块；同一局面在搜索里会反复估值，故做记忆化
const LEG_CACHE_LIMIT = 8192;
const legCache = new Map<string, LegExpectation>();

/** 每峰骆驼当前所在格号（按栈底到栈顶扫描赛道，堆叠不改变所在格） */
function camelPositions(state: GameState): number[] {
  const positions = new Array<number>(CAMEL_COUNT).fill(0);
  for (let pos = 0; pos <= FINISH_INDEX; pos += 1) {
    for (const color of state.stacks[pos]) positions[color] = pos;
  }
  return positions;
}

/** 名次反查表：骆驼色 → 名次（0 起） */
function placeIndexOf(rank: readonly CamelColor[]): number[] {
  const place = new Array<number>(CAMEL_COUNT).fill(0);
  rank.forEach((color, index) => {
    place[color] = index;
  });
  return place;
}

/**
 * 全部出手顺序的全排列上限：≤3 颗时精确枚举（3! = 6）。
 * why：4-5 颗时全排列 × 点数组合达到 1944 / 29160 次推演，单次估值 2-30ms，
 * 搜索在腿初几乎无法展开；实测 4-5 颗改用下方分层抽样后，摇骰前后的腿注期望差
 * 已从 3 EP（单顺序模型）压到 0.09 EP 以内，不足以支撑拖延套利。
 */
const EXACT_ORDER_LIMIT = 3;

/**
 * 模拟用的出手顺序集合。
 *
 * why：叠放让出手顺序影响结果——在下面的骆驼先摇会把它背上的骆驼一起带走，
 * 拆栈时机直接决定谁能反超。若模型固定用某一种顺序（例如按骰子列表顺序），
 * 摇骰前的期望就不等于「先摇任意一颗」后的条件期望：模型误以为
 * 下层骆驼总能先走、叠驼永不拆开，于是把「不摇骰、保留腿注」估得虚高，
 * AI 便靠不推进游戏的行动无限拖延。
 * 「均匀随机挑一颗来摇」等价于对全部 k! 种顺序取平均；骰子多时用
 * 正向/逆向自然顺序的全部轮转做分层抽样，每颗骰子恰好当两次先手，
 * 首阶分布与真实一致，残留偏差只来自二阶以上的顺序相关。
 *
 * @param count 剩余骰数
 * @returns 下标排列列表
 */
function moverOrders(count: number): number[][] {
  const natural = Array.from({ length: count }, (_, index) => index);
  if (count <= 1) return [natural];
  if (count <= EXACT_ORDER_LIMIT) {
    const orders: number[][] = [];
    const current: number[] = [];
    const used = new Array<boolean>(count).fill(false);
    const build = (): void => {
      if (current.length === count) {
        orders.push([...current]);
        return;
      }
      for (let index = 0; index < count; index += 1) {
        if (used[index]) continue;
        used[index] = true;
        current.push(index);
        build();
        current.pop();
        used[index] = false;
      }
    };
    build();
    return orders;
  }
  const orders: number[][] = [];
  for (const base of [natural, [...natural].reverse()]) {
    for (let shift = 0; shift < count; shift += 1) {
      orders.push(base.map((_, index) => base[(index + shift) % count]));
    }
  }
  return orders;
}

/**
 * 枚举本腿剩余骰子的「出手顺序 × 颜色 × 点数」组合，逐个按规则模拟移动、叠驼携带与地形块触发，
 * 统计腿末名次分布与地形块期望收入；骆驼踏上终点线即定格本腿（真实规则：比赛随即结束）。
 *
 * why：旧的两两独立近似有两个方向性错误——叠在同伴背上的骆驼被误判成能越过同伴，
 * 且「其余名次」概率被下限收口后，不确定性越大估值越乐观；两者叠加让
 * 「保留未兑现腿注、不摇骰」永远比摇骰估值高，AI 便反复搬地形块把对局拖死。
 * 逐颗骰展开、对出手顺序取平均（见 moverOrders）且把地形块触发一并模拟后，
 * 摇骰前期望与摇骰后的条件期望一致，套利空间消失，
 * 摇骰的确定收益（金币片）才能稳定胜出。
 *
 * @param state 当前局面
 * @param positions 可复用的格号缓冲（长度 CAMEL_COUNT）
 * @param ties 可复用的叠放序缓冲（同格内越小越靠上）
 * @param firstCount 输出：拿第一的组合计数（结束后归一为概率）
 * @param secondCount 输出：拿第二的组合计数（结束后归一为概率）
 * @param tileCount 输出：地形块触发次数按玩家累计（结束后归一为期望）
 */
function enumerateLegExpectation(
  state: GameState,
  positions: Int8Array,
  ties: Float64Array,
  firstCount: Float64Array,
  secondCount: Float64Array,
  tileCount: Float64Array,
): void {
  const movers = state.diceRemaining;
  const basePos = camelPositions(state);
  const baseTie = placeIndexOf(rankOf(state));
  // 每格最多一块（规则禁止相邻），-1 表示无块
  const tileOwner = new Int8Array(FINISH_INDEX).fill(-1);
  const tileMirage = new Uint8Array(FINISH_INDEX);
  state.players.forEach((player, owner) => {
    const desert = player.desert;
    if (desert.pos === null || desert.pos >= FINISH_INDEX) return;
    tileOwner[desert.pos] = owner;
    tileMirage[desert.pos] = desert.face === 'mirage' ? 1 : 0;
  });

  const orders = moverOrders(movers.length);
  // 三进制里程表：第 i 位是第 i 颗剩余骰的点数 1-3
  const steps = new Int8Array(movers.length);
  const combos = DIE_ADVANCE ** movers.length;
  const unit: number[] = [];
  // 单位成员标记：placeUnit 要跳过随行骆驼，用标记位比 Array.includes 快得多
  const inUnit = new Uint8Array(CAMEL_COUNT);

  /** 让整单位落到 destPos：onTop 落顶，否则插入堆叠底部 */
  const placeUnit = (destPos: number, onTop: boolean): void => {
    let minTie = Number.POSITIVE_INFINITY;
    let maxTie = Number.NEGATIVE_INFINITY;
    for (let other = 0; other < CAMEL_COUNT; other += 1) {
      if (positions[other] !== destPos || inUnit[other] === 1) continue;
      if (ties[other] < minTie) minTie = ties[other];
      if (ties[other] > maxTie) maxTie = ties[other];
    }
    // 落顶取比所有驻留者更小的叠放序；插底取更大的，两者都保持单位内部上下顺序
    const base = onTop
      ? (minTie === Number.POSITIVE_INFINITY ? 0 : minTie) - unit.length
      : (maxTie === Number.NEGATIVE_INFINITY ? 0 : maxTie) + 1;
    for (let index = 0; index < unit.length; index += 1) {
      positions[unit[index]] = destPos;
      ties[unit[index]] = base + index;
    }
  };

  /** color 是否排在 other 之前（格号大者在前，同格叠放序小者在前） */
  const ahead = (color: number, other: number): boolean =>
    positions[color] > positions[other] ||
    (positions[color] === positions[other] && ties[color] < ties[other]);

  for (const order of orders) {
    steps.fill(1);
    for (let combo = 0; combo < combos; combo += 1) {
      positions.set(basePos);
      ties.set(baseTie);

      // 该顺序下逐颗骰推进；骆驼一旦踏上终点线，本腿立即定格（真实规则：比赛随即结束）
      for (const moverIndex of order) {
        const color = movers[moverIndex];
        const from = positions[color];
        // 移动单位 = 该驼及它背上的全部骆驼（同格、叠放序更靠上），按叠放序升序排列
        unit.length = 0;
        for (let other = 0; other < CAMEL_COUNT; other += 1) {
          if (positions[other] !== from || ties[other] > ties[color]) continue;
          let at = unit.length;
          while (at > 0 && ties[unit[at - 1]] > ties[other]) {
            unit[at] = unit[at - 1];
            at -= 1;
          }
          unit[at] = other;
        }
        for (let index = 0; index < unit.length; index += 1) inUnit[unit[index]] = 1;

        let dest = from + steps[moverIndex];
        if (dest > FINISH_INDEX) dest = FINISH_INDEX;
        placeUnit(dest, true);

        // 地形块触发：落到块格立即 ±1 并给块主 +1；相邻格无块，不会二次触发
        if (dest < FINISH_INDEX && tileOwner[dest] >= 0) {
          tileCount[tileOwner[dest]] += 1;
          const mirage = tileMirage[dest] === 1;
          dest = mirage ? dest - 1 : Math.min(dest + 1, FINISH_INDEX);
          placeUnit(dest, !mirage);
        }
        for (let index = 0; index < unit.length; index += 1) inUnit[unit[index]] = 0;
        if (dest === FINISH_INDEX) break;
      }

      // 只统计前两名：一次扫描维护「最前」与「次前」
      let best = 0;
      let second = -1;
      for (let color = 1; color < CAMEL_COUNT; color += 1) {
        if (ahead(color, best)) {
          second = best;
          best = color;
        } else if (second < 0 || ahead(color, second)) {
          second = color;
        }
      }
      firstCount[best] += 1;
      if (second >= 0) secondCount[second] += 1;

      // 三进制进位
      for (let i = 0; i < steps.length; i += 1) {
        if (steps[i] < DIE_ADVANCE) {
          steps[i] += 1;
          break;
        }
        steps[i] = 1;
      }
    }
  }

  const total = combos * orders.length;
  for (let color = 0; color < CAMEL_COUNT; color += 1) {
    firstCount[color] /= total;
    secondCount[color] /= total;
  }
  for (let owner = 0; owner < tileCount.length; owner += 1) tileCount[owner] /= total;
}

/**
 * 本腿剩余骰的期望（带记忆化）：赛道叠放、剩余骰与地形块相同即复用同一结果。
 *
 * @param state 当前局面
 * @returns 腿末名次概率与各地形块的期望触发收益
 */
function legExpectation(state: GameState): LegExpectation {
  let key = state.diceRemaining.join(',') + '|';
  for (const stack of state.stacks) key += stack.join('') + ',';
  key += '|';
  for (const player of state.players) {
    const desert = player.desert;
    key +=
      desert.pos === null
        ? '-'
        : String.fromCharCode(65 + desert.pos, desert.face === 'oasis' ? 48 : 49);
  }

  const cached = legCache.get(key);
  if (cached !== undefined) return cached;

  const firstCount = new Float64Array(CAMEL_COUNT);
  const secondCount = new Float64Array(CAMEL_COUNT);
  const tileCount = new Float64Array(state.players.length);
  enumerateLegExpectation(
    state,
    new Int8Array(CAMEL_COUNT),
    new Float64Array(CAMEL_COUNT),
    firstCount,
    secondCount,
    tileCount,
  );
  const expectation: LegExpectation = {
    first: Array.from(firstCount),
    second: Array.from(secondCount),
    tileIncome: Array.from(tileCount),
  };

  if (legCache.size >= LEG_CACHE_LIMIT) legCache.clear();
  legCache.set(key, expectation);
  return expectation;
}

/**
 * 全场押注的命中概率：按各峰骆驼距终点还需前进的格数做指数软化，
 * 分别给出「夺冠」与「垫底」的概率。
 *
 * 距终点按「当前格号 + 本腿剩余骰的期望位移」折算。why：若只看当前格号，
 * 还有骰可摇的骆驼会被系统性低估，玩家摇到它时估值才突然跳涨，
 * 「先不摇」又成了套利；把期望位移提前计入后，摇骰前后的期望一致。
 *
 * @param camelPos 各峰骆驼当前格号
 * @param hasDie 各峰骆驼本腿是否还有骰子
 * @returns win / lose 两个按骆驼色索引的概率表
 */
function raceProbabilities(
  camelPos: readonly number[],
  hasDie: readonly boolean[],
): { win: number[]; lose: number[] } {
  const win: number[] = [];
  const lose: number[] = [];
  let winSum = 0;
  let loseSum = 0;
  for (let color = 0; color < camelPos.length; color += 1) {
    const projected = camelPos[color] + (hasDie[color] ? EXPECTED_DIE_ADVANCE : 0);
    const remaining = Math.max(0, FINISH_INDEX - projected);
    const winWeight = Math.exp(-remaining / RACE_DISTANCE_TEMPERATURE);
    const loseWeight = Math.exp(remaining / RACE_DISTANCE_TEMPERATURE);
    win.push(winWeight);
    lose.push(loseWeight);
    winSum += winWeight;
    loseSum += loseWeight;
  }
  return {
    win: win.map((weight) => weight / winSum),
    lose: lose.map((weight) => weight / loseSum),
  };
}

/**
 * 每位玩家押注牌的期望净收益：同色牌按「全局放置先后」占据 8/5/3/2/1 档位，
 * 与终局结算完全同序；命中概率取距终点的平滑模型，错注罚 1。
 *
 * @param state 当前局面
 * @param camelPos 各峰骆驼当前格号
 * @param hasDie 各峰骆驼本腿是否还有骰子
 * @returns 按玩家序号排列的押注牌期望净收益
 */
function raceBetValues(
  state: GameState,
  camelPos: readonly number[],
  hasDie: readonly boolean[],
): number[] {
  const totals = new Array<number>(state.players.length).fill(0);
  const probability = raceProbabilities(camelPos, hasDie);
  for (const target of ['winner', 'loser'] as const) {
    const pile = target === 'winner' ? state.winnerPile : state.loserPile;
    const chance = target === 'winner' ? probability.win : probability.lose;
    // 每色已用档位数：先放者拿大头，必须连同对手的牌一起推进
    const used = new Array<number>(CAMEL_COUNT).fill(0);
    for (const bet of pile) {
      const slot = used[bet.color];
      used[bet.color] = slot + 1;
      const hit = chance[bet.color];
      const payout = RACE_PAYOUTS[Math.min(slot, RACE_PAYOUTS.length - 1)];
      totals[bet.player] += hit * payout - (1 - hit) * WRONG_BET_PENALTY;
    }
  }
  return totals;
}

/**
 * 一次算出全部玩家的评估分项与总分：腿末分布与押注档位只算一遍，
 * 供搜索叶子估值与决策解释面板共用同一口径。
 *
 * @param state 当前局面
 * @returns 按玩家序号排列的评估分项
 */
export function breakdownsOf(state: GameState): EvaluationBreakdown[] {
  const camelPos = camelPositions(state);

  const hasDie: boolean[] = new Array(CAMEL_COUNT).fill(false);
  for (const color of state.diceRemaining) hasDie[color] = true;

  // 腿注或地形块都没有时无需付出枚举代价（枚举是本文件最重的一步）
  const needsLegModel =
    state.players.some((player) => player.legTickets.length > 0) ||
    state.players.some((player) => player.desert.pos !== null);
  const expectation = needsLegModel ? legExpectation(state) : null;
  const raceBets = raceBetValues(state, camelPos, hasDie);

  return state.players.map((player, index) => {
    // 腿注期望：领先得票面、第二得 +1、其余 -1（概率来自剩余骰的完整组合枚举）
    let legTickets = 0;
    if (expectation !== null) {
      for (const ticket of player.legTickets) {
        const lead = expectation.first[ticket.color];
        const runnerUp = expectation.second[ticket.color];
        // 枚举结果精确求和为 1，Math.max 只兜浮点误差
        const rest = Math.max(0, 1 - lead - runnerUp);
        legTickets += lead * ticket.value + runnerUp - rest * WRONG_BET_PENALTY;
      }
    }

    const breakdown: EvaluationBreakdown = {
      coins: player.coins,
      legTickets,
      pyramid: player.pyramidTickets,
      raceBets: raceBets[index],
      hand: player.hand.length * HAND_CARD_VALUE,
      desert: expectation === null ? 0 : expectation.tileIncome[index],
      total: 0,
    };
    breakdown.total =
      breakdown.coins +
      breakdown.legTickets +
      breakdown.pyramid +
      breakdown.raceBets +
      breakdown.hand +
      breakdown.desert;
    return breakdown;
  });
}

/**
 * 计算某玩家的评估分项与总分。
 *
 * @param state 当前局面
 * @param player 玩家序号
 * @returns 分项得分与总分
 */
export function breakdownOf(state: GameState, player: number): EvaluationBreakdown {
  return breakdownsOf(state)[player];
}

/**
 * 全体玩家的收益向量（Max-n / 期望值口径）：终局按 winner 给出决胜分，
 * 竞速中按各分项合成。每位玩家在搜索中最大化自己的分量。
 *
 * @param state 当前局面
 * @returns 按玩家序号排列的收益向量
 */
export function evaluateAll(state: GameState): number[] {
  if (state.phase === 'gameEnd') {
    // 终局时押注牌与腿注片都已折算进金币，只需比较金币与胜负决胜分
    return state.players.map(
      (player, index) => (state.winner === state.seats[index] ? WIN_VALUE : 0) + player.coins,
    );
  }
  return breakdownsOf(state).map((breakdown) => breakdown.total);
}
