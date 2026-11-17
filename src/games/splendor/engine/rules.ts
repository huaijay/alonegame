import { emptyGems, emptyTokens, GEM_NAMES, PLAYER_NAMES } from './board';
import { DEVELOPMENT_CARDS, NOBLES } from './cards';
import { resolveGameRules } from './config';
import { createRng, shuffled } from './rng';
import { GEM_COLORS } from './types';
import type {
  DevelopmentCard, GameEvent, GameRules, GameState, GemColor, Gems, Move, MoveResult, Noble,
  Player, Tier, TokenColor, Tokens,
} from './types';

/** 计算全部六类实体筹码的数量；卡牌提供的永久折扣不参与上限计算。 */
export function tokenCount(tokens: Tokens): number {
  return GEM_COLORS.reduce((sum, color) => sum + tokens[color], tokens.gold);
}

/** 根据持有的发展卡统计五色永久折扣。 */
export function bonusesOf(player: Player): Gems {
  const bonuses = emptyGems();
  for (const card of player.cards) bonuses[card.bonus] += 1;
  return bonuses;
}

/** 返回购卡的最小真实筹码支付方案；无力支付时返回 null。 */
export function paymentFor(card: DevelopmentCard, player: Player): Tokens | null {
  const discounts = bonusesOf(player);
  const payment = emptyTokens();
  for (const color of GEM_COLORS) {
    const due = Math.max(0, card.cost[color] - discounts[color]);
    payment[color] = Math.min(due, player.tokens[color]);
    payment.gold += due - payment[color];
  }
  return payment.gold <= player.tokens.gold ? payment : null;
}

/** 不修改输入，克隆一局比赛的全部可变容器。卡牌定义本身是只读值。 */
export function cloneState(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      tokens: { ...player.tokens },
      cards: [...player.cards],
      reserved: [...player.reserved],
      nobles: [...player.nobles],
    })),
    bank: { ...state.bank },
    decks: state.decks.map((cards) => [...cards]) as GameState['decks'],
    market: state.market.map((cards) => [...cards]) as GameState['market'],
    nobles: [...state.nobles],
    winners: [...state.winners],
  };
}

/** 通过种子洗牌，按经典规则或自定义选项创建两到四人的璀璨宝石开局。 */
export function createInitialState(
  playerCount: 2 | 3 | 4,
  seed = 42,
  overrides: Partial<GameRules> = {},
): GameState {
  const rules = resolveGameRules(playerCount, overrides);
  const rng = createRng(seed);
  const bank = emptyTokens();
  for (const color of GEM_COLORS) bank[color] = rules.gemSupply;
  bank.gold = rules.goldSupply;

  const decks: GameState['decks'] = [
    shuffled(DEVELOPMENT_CARDS.filter((card) => card.tier === 1), rng),
    shuffled(DEVELOPMENT_CARDS.filter((card) => card.tier === 2), rng),
    shuffled(DEVELOPMENT_CARDS.filter((card) => card.tier === 3), rng),
  ];
  const market = decks.map((deck) => deck.splice(0, rules.marketSize)) as GameState['market'];
  const nobles = shuffled(NOBLES, rng).slice(0, rules.nobleCount);
  return {
    rules,
    players: Array.from({ length: playerCount }, () => ({
      tokens: emptyTokens(), cards: [], reserved: [], nobles: [], points: 0,
    })),
    bank, decks, market, nobles,
    current: 0, turn: 0, finalRound: false, phase: 'playing', winners: [],
  };
}

/** 生成所有满足三色各一枚规则的组合；不足三色时只能拿取全部可用颜色。 */
export function takeColorChoices(bank: Tokens): GemColor[][] {
  const available = GEM_COLORS.filter((color) => bank[color] > 0);
  if (available.length <= 3) return available.length === 0 ? [] : [available];
  const choices: GemColor[][] = [];
  for (let i = 0; i < available.length - 2; i += 1) {
    for (let j = i + 1; j < available.length - 1; j += 1) {
      for (let k = j + 1; k < available.length; k += 1) {
        choices.push([available[i], available[j], available[k]]);
      }
    }
  }
  return choices;
}

/** 罗列当前行动方的全部基础合法动作（超额筹码退还可由动作附带选择）。 */
export function getLegalMoves(state: GameState): Move[] {
  if (state.phase === 'finished') return [];
  const player = state.players[state.current];
  const moves: Move[] = [];
  for (const colors of takeColorChoices(state.bank)) moves.push({ kind: 'take', colors });
  for (const color of GEM_COLORS) {
    // 经典版至少有 4 枚才能双取；自定义模式按本局阈值判定。
    if (state.bank[color] >= state.rules.doubleTakeMinimum) moves.push({ kind: 'double', color });
  }
  for (let tierIndex = 0; tierIndex < 3; tierIndex += 1) {
    const tier = (tierIndex + 1) as Tier;
    state.market[tierIndex].forEach((card, slot) => {
      if (card !== null && paymentFor(card, player)) {
        moves.push({ kind: 'buy', source: 'market', tier, slot });
      }
      if (card !== null && player.reserved.length < state.rules.reserveLimit) {
        moves.push({ kind: 'reserve', tier, slot });
      }
    });
    if (state.decks[tierIndex].length > 0 && player.reserved.length < state.rules.reserveLimit) {
      moves.push({ kind: 'reserve', tier, slot: null });
    }
  }
  player.reserved.forEach((card, slot) => {
    if (paymentFor(card, player)) moves.push({ kind: 'buy', source: 'reserved', slot });
  });
  // 极端局面下若无合法行动，允许跳过，防止 AI 会话无法推进。
  if (moves.length === 0) moves.push({ kind: 'pass' });
  return moves;
}

/** 不含可选的退筹/贵族选择，只比较动作主体，供合法性判断及高亮。 */
export function moveKey(move: Move): string {
  switch (move.kind) {
    case 'take': return 'take:' + [...move.colors].sort().join(',');
    case 'double': return 'double:' + move.color;
    case 'reserve': return 'reserve:' + move.tier + ':' + String(move.slot);
    case 'buy': return 'buy:' + move.source + ':' + (move.source === 'market' ? move.tier + ':' : '') + move.slot;
    case 'pass': return 'pass';
  }
}

/** 自动选择多余筹码：优先保留黄金及靠近可见购卡需求的宝石。 */
function automaticReturns(state: GameState, player: Player, count: number): TokenColor[] {
  const discounts = bonusesOf(player);
  const targets = [
    ...state.market.flatMap((row) => row.filter((card): card is DevelopmentCard => card !== null)),
    ...player.reserved,
  ];
  const relevance = (color: TokenColor): number => {
    if (color === 'gold') return 100;
    const needs = targets.map((card) => Math.max(0, card.cost[color] - discounts[color]));
    const best = Math.max(0, ...needs.map((need) => Math.min(need, player.tokens[color])));
    return best * 4 - Math.max(0, player.tokens[color] - best) * 3;
  };
  const returns: TokenColor[] = [];
  const working = { ...player.tokens };
  for (let i = 0; i < count; i += 1) {
    const candidates: TokenColor[] = [...GEM_COLORS, 'gold'];
    candidates.sort((a, b) => relevance(a) - relevance(b) || working[b] - working[a]);
    const selected = candidates.find((color) => working[color] > 0);
    if (selected === undefined) throw new Error('无可退回的筹码');
    working[selected] -= 1;
    returns.push(selected);
  }
  return returns;
}

/** 应用手动指定或默认退还方案，并强制执行本局的筹码持有上限。 */
function settleTokenLimit(state: GameState, player: Player, requested?: TokenColor[]): TokenColor[] {
  const excess = Math.max(0, tokenCount(player.tokens) - state.rules.tokenLimit);
  const returns = requested ?? automaticReturns(state, player, excess);
  if (returns.length !== excess) throw new Error('退回筹码数量不符合 ' + state.rules.tokenLimit + ' 枚上限');
  const available = { ...player.tokens };
  for (const color of returns) {
    if (!(color in available) || available[color] <= 0) throw new Error('无法退回未持有的筹码');
    available[color] -= 1;
  }
  player.tokens = available;
  for (const color of returns) state.bank[color] += 1;
  return returns;
}

/** 计算当前满足条件、可在回合结束免费拜访的贵族。 */
export function eligibleNobles(state: GameState, player: Player): Noble[] {
  const discounts = bonusesOf(player);
  return state.nobles.filter((noble) => GEM_COLORS.every((color) => discounts[color] >= noble.requirement[color]));
}

/** 按声望最高、同分发展卡最少的规则返回全部并列获胜者。 */
export function determineWinners(players: Player[]): number[] {
  const maxPoints = Math.max(...players.map((player) => player.points));
  const candidates = players.map((player, index) => ({ player, index }))
    .filter(({ player }) => player.points === maxPoints);
  const fewestCards = Math.min(...candidates.map(({ player }) => player.cards.length));
  return candidates.filter(({ player }) => player.cards.length === fewestCards).map(({ index }) => index);
}

/** 应用一项合法行动，产生新状态和详细中文事件；非法动作抛出错误。 */
export function applyMove(state: GameState, move: Move): MoveResult {
  if (!getLegalMoves(state).some((legal) => moveKey(legal) === moveKey(move))) {
    throw new Error('当前回合不允许此行动：' + moveKey(move));
  }
  const next = cloneState(state);
  const seat = next.current;
  const player = next.players[seat];
  const events: GameEvent[] = [];
  const event = (kind: GameEvent['kind'], text: string) => {
    events.push({ player: seat, kind, text, turn: state.turn + 1 });
  };
  let requestedReturns: TokenColor[] | undefined;
  switch (move.kind) {
    case 'take': {
      for (const color of move.colors) {
        player.tokens[color] += 1;
        next.bank[color] -= 1;
      }
      requestedReturns = move.returns;
      event('take', '领取 ' + move.colors.map((color) => GEM_NAMES[color]).join('、'));
      break;
    }
    case 'double': {
      player.tokens[move.color] += 2;
      next.bank[move.color] -= 2;
      requestedReturns = move.returns;
      event('double', '领取 2 枚' + GEM_NAMES[move.color]);
      break;
    }
    case 'reserve': {
      const index = move.tier - 1;
      const [card] = move.slot === null
        ? next.decks[index].splice(0, 1)
        : next.market[index].splice(move.slot, 1, next.decks[index].shift() ?? null);
      if (!card) throw new Error('目标发展卡不存在');
      player.reserved.push(card);
      if (next.bank.gold > 0) {
        next.bank.gold -= 1;
        player.tokens.gold += 1;
      }
      requestedReturns = move.returns;
      event('reserve', '预留 ' + move.tier + ' 阶发展卡' + (next.bank.gold >= 0 && player.tokens.gold > state.players[seat].tokens.gold ? '，获得 1 枚黄金' : ''));
      break;
    }
    case 'buy': {
      const card = move.source === 'market'
        ? next.market[move.tier - 1][move.slot]
        : player.reserved[move.slot];
      if (!card) throw new Error('待购买发展卡不存在');
      const payment = paymentFor(card, player);
      if (!payment) throw new Error('筹码不足');
      for (const color of [...GEM_COLORS, 'gold'] as TokenColor[]) {
        player.tokens[color] -= payment[color];
        next.bank[color] += payment[color];
      }
      if (move.source === 'market') {
        next.market[move.tier - 1].splice(move.slot, 1, next.decks[move.tier - 1].shift() ?? null);
      } else {
        player.reserved.splice(move.slot, 1);
      }
      player.cards.push(card);
      player.points += card.points;
      event('buy', '购入 ' + card.tier + ' 阶' + GEM_NAMES[card.bonus] + '工坊' +
        (card.points ? '，获得 ' + card.points + ' 声望' : '，永久折扣 +1'));
      break;
    }
    case 'pass':
      event('pass', '没有可执行的行动，跳过本回合');
      break;
  }
  if (move.kind === 'take' || move.kind === 'double' || move.kind === 'reserve') {
    const returned = settleTokenLimit(next, player, requestedReturns);
    if (returned.length) event('discard', '超过 ' + next.rules.tokenLimit + ' 枚上限，归还 ' + returned.map((color) =>
      color === 'gold' ? '黄金' : GEM_NAMES[color]).join('、'));
  }

  const visitors = eligibleNobles(next, player);
  if (visitors.length) {
    const chosenId = move.kind === 'buy' ? move.nobleId : undefined;
    const chosen = chosenId === undefined ? visitors[0] : visitors.find((noble) => noble.id === chosenId);
    if (!chosen) throw new Error('指定的贵族尚未达到拜访条件');
    next.nobles.splice(next.nobles.findIndex((noble) => noble.id === chosen.id), 1);
    player.nobles.push(chosen);
    player.points += chosen.points;
    event('noble', '贵族 ' + chosen.id + ' 到访，额外获得 3 声望');
  }

  if (player.points >= next.rules.victoryPoints && !next.finalRound) {
    next.finalRound = true;
    event('finish', '达到 ' + next.rules.victoryPoints + ' 声望！本轮所有人走完后结算');
  }
  next.turn += 1;
  next.current = (seat + 1) % next.players.length;
  if (next.finalRound && next.current === 0) {
    next.phase = 'finished';
    next.winners = determineWinners(next.players);
    event('finish', '本局结束 · ' + next.winners.map((index) => PLAYER_NAMES[index]).join('、') + ' 获胜');
  }
  return { state: next, events };
}

/** 仅推进游戏局面，供 AI 和批量模拟使用。 */
export function applyMoveState(state: GameState, move: Move): GameState {
  return applyMove(state, move).state;
}
