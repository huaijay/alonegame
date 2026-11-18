import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import { PLAYER_NAMES } from '../engine/board';
import { describeMove } from '../engine/ai/search';
import { aiLevelFor } from '../engine/ai/levels';
import { bonusesOf, getLegalMoves, moveKey, paymentFor, tokenCount } from '../engine/rules';
import { GameSession } from '../engine/session';
import { GEM_COLORS } from '../engine/types';
import type { GameConfig, GameEvent, GameState, GemColor, Move, TokenColor } from '../engine/types';
import { DevelopmentCardView, NobleTile } from './DevelopmentCardView';
import { GemToken } from './GemToken';

interface GameStageProps {
  config: GameConfig;
  onExit: () => void;
}

const SPEEDS = [1, 2, 4] as const;
const TIERS = [3, 2, 1] as const;
const ROMANS = ['', 'I', 'II', 'III'];
const TIER_NAMES = ['', '矿脉', '工坊', '行会'];

/** 席位纹章：日、月、星、叶四种图形，配合席位专属底色即可视觉区分行动方。 */
function SeatSigil({ seat, small = false }: { seat: number; small?: boolean }) {
  const glyph = [
    <g key="sun"><circle cx="20" cy="20" r="7.5" />
      {Array.from({ length: 8 }, (_, i) => (
        <rect key={i} x="19" y="4" width="2" height="5" rx="1" transform={`rotate(${i * 45} 20 20)`} />
      ))}</g>,
    <g key="moon"><path d="M25 8 A13 13 0 1 0 25 32 A10.5 10.5 0 1 1 25 8 Z" /></g>,
    <g key="star"><path d="M20 5 L23.5 14.5 L34 16 L26.5 23.5 L28.5 34 L20 28.5 L11.5 34 L13.5 23.5 L6 16 L16.5 14.5 Z" /></g>,
    <g key="leaf"><path d="M20 34 C8 26 10 12 20 6 C30 12 32 26 20 34 Z" /></g>,
  ][seat];
  return (
    <svg className={'sp-sigil' + (small ? ' sp-sigil-small' : '')} viewBox="0 0 40 40"
      style={{ '--sp-accent': `var(--sp-seat-${seat})` } as CSSProperties} aria-hidden="true">
      <circle className="sp-sigil-ring" cx="20" cy="20" r="18.5" />
      {glyph}
    </svg>
  );
}

/** 事件图标：以图形符号替代文字分类，扫一眼即可分辨行动类型。 */
function EventGlyph({ kind }: { kind: GameEvent['kind'] }) {
  const glyph = {
    take: <path d="M12 5 L18 12 L12 19 L6 12 Z" />,
    double: <><path d="M9 6 L13 12 L9 18 L5 12 Z" /><path d="M15 6 L19 12 L15 18 L11 12 Z" /></>,
    reserve: <path d="M7 4 H17 V20 L12 15.5 L7 20 Z" />,
    buy: <><rect x="4" y="6" width="16" height="12" rx="2" /><path d="M12 9 L14.4 12 L12 15 L9.6 12 Z" /></>,
    noble: <path d="M5 17 L6.5 9 L10.5 13 L12 7 L13.5 13 L17.5 9 L19 17 Z M6 19 H18" />,
    finish: <path d="M6 4 V20 M6 5 H18 L14 9.5 L18 14 H6" />,
    discard: <path d="M15 6 A7 7 0 1 0 19 13 M15 3 L15 7.5 L10.5 7.5" />,
    pass: <path d="M6 12 H18" />,
  }[kind];
  return <svg className="sp-event-glyph" viewBox="0 0 24 24" aria-hidden="true">{glyph}</svg>;
}

/** 席位资产：永久折扣以叠牌呈现，实体筹码以微型宝石呈现，全部可视化。 */
function SeatAssets({ view, seat, discountOnly = false }: {
  view: GameState; seat: number; discountOnly?: boolean;
}) {
  const player = view.players[seat];
  const discounts = bonusesOf(player);
  return (
    <>
      <span className="sp-seat-stacks">
        {GEM_COLORS.filter((color) => discounts[color] > 0).map((color) => (
          <span key={color} className="sp-stack" data-color={color}>{discounts[color]}</span>
        ))}
        {GEM_COLORS.every((color) => discounts[color] === 0) ? <span className="sp-stack is-empty">—</span> : null}
      </span>
      {discountOnly ? null : (
        <span className="sp-seat-chips">
          {([...GEM_COLORS, 'gold'] as TokenColor[]).filter((color) => player.tokens[color] > 0).map((color) => (
            <GemToken key={color} color={color} size="xs" count={player.tokens[color]} />
          ))}
        </span>
      )}
    </>
  );
}

/**
 * 展示珠宝交易桌面及本局固定的 AI 强度，所有行动交由会话推进。
 * @param props 对局配置与退出回调
 * @returns 支持真人行动、观赛与回放的桌面
 */
export function GameStage({ config, onExit }: GameStageProps) {
  const session = useMemo(() => new GameSession(config), [config]);
  const aiLevel = aiLevelFor(config.aiStrength, config.playerCount);
  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [picked, setPicked] = useState<GemColor[]>([]);
  const [inspectedSeat, setInspectedSeat] = useState(config.humanSeat ?? 0);
  const [sideOpen, setSideOpen] = useState(true);

  useEffect(() => {
    session.start();
    return () => session.dispose();
  }, [session]);

  useEffect(() => {
    setPicked([]);
  }, [snap.state.turn]);

  const replaying = snap.replayIndex !== null;
  const frame = snap.replayIndex === null ? null : snap.frames[snap.replayIndex];
  const view: GameState = frame?.state ?? snap.state;
  const actingSeat = snap.state.current;
  const canAct = config.humanSeat !== null && config.humanSeat === actingSeat &&
    snap.state.phase === 'playing' && !replaying;
  const viewer = view.players[inspectedSeat];
  const legal = useMemo(() => getLegalMoves(snap.state), [snap.state]);
  const canDo = (move: Move) => legal.some((item) => moveKey(item) === moveKey(move));
  const canTake = picked.length > 0 && canDo({ kind: 'take', colors: picked });
  const aiThinking = snap.status === 'running' && !replaying && view.phase === 'playing' &&
    config.humanSeat !== view.current;

  const handleSelectGem = (color: GemColor) => {
    if (!canAct) return;
    setPicked((prev) => prev.includes(color) ? prev.filter((item) => item !== color) :
      prev.length < 3 ? [...prev, color] : prev);
  };

  const action = (move: Move) => {
    if (!canAct) return;
    session.humanMove(move);
    setPicked([]);
  };

  const statusText = view.phase === 'finished' ? '对局已结束'
    : replaying ? '历史回放 · 第 ' + view.turn + ' 手'
      : snap.status === 'paused' ? '已暂停 · 可单步推演'
        : canAct ? '轮到你了，从桌面选择行动'
          : '正在规划下一笔投资';

  return (
    <div className="splendor sp-game">
      <div className="sp-game-main">
        <header className="sp-table-header">
          <div className="sp-brand">
            <span className="sp-brand-gem" aria-hidden="true">
              <GemToken color="gold" size="sm" />
            </span>
            <div className="sp-brand-text">
              <span className="sp-eyebrow">SPLENDOR · GRAND EXCHANGE</span>
              <h2>璀璨宝石 <span className="sp-table-strength" title={aiLevel.description}>{aiLevel.label} AI</span></h2>
            </div>
          </div>
          <div className="sp-turn-banner" data-thinking={aiThinking} data-finished={view.phase === 'finished'}>
            <SeatSigil seat={view.current} small />
            <div className="sp-turn-copy">
              <strong>{view.phase === 'finished' ? '对局结束' : PLAYER_NAMES[view.current]}</strong>
              <small>{statusText}</small>
            </div>
            <span className="sp-turn-pill">目标 {view.rules.victoryPoints} VP · 第 {Math.floor(view.turn / view.players.length) + 1} 轮</span>
          </div>
        </header>

        <div className="sp-seat-row">
          {view.players.map((player, index) => (
            <button key={index} type="button" className="sp-seat" data-seat={index}
              data-active={view.phase === 'playing' && index === view.current}
              data-selected={inspectedSeat === index} data-winner={view.winners.includes(index)}
              data-human={config.humanSeat === index}
              onClick={() => setInspectedSeat(index)}>
              <SeatSigil seat={index} small />
              <span className="sp-seat-body">
                <span className="sp-seat-name">{PLAYER_NAMES[index]}</span>
                <SeatAssets view={view} seat={index} />
              </span>
              <span className="sp-seat-reserved">
                {player.reserved.map((card) => (
                  <span key={card.id} className="sp-mini-card" data-color={card.bonus}>{card.points || ''}</span>
                ))}
              </span>
              <span className="sp-seat-score">
                {view.winners.includes(index) ? <i className="sp-seat-crown">♛</i> : null}
                <b key={player.points} className="sp-score-num">{player.points}</b>
                <small>VP</small>
              </span>
            </button>
          ))}
        </div>

        {view.winners.length > 0 ? (
          <div className="sp-victory-banner"><span>♛</span>
            <b>{view.winners.map((seat) => PLAYER_NAMES[seat]).join('、')} 荣登首席</b>
            <small>{Math.max(...view.players.map((player) => player.points))} 声望 · 本局圆满结束</small>
          </div>
        ) : view.finalRound ? (
          <div className="sp-final-banner">✦ 已有商会达到 {view.rules.victoryPoints} 声望，本轮结束即结算最终名次 ✦</div>
        ) : null}

        <section className="sp-market-section">
          <div className="sp-market-stack">
            {TIERS.map((tier) => {
              const row = view.market[tier - 1];
              const deck = view.decks[tier - 1];
              const mayReserve = canAct && view.players[actingSeat].reserved.length < view.rules.reserveLimit;
              return (
                <div key={tier} className="sp-market-row" data-tier={tier}
                  style={{ '--sp-market-slots': view.rules.marketSize } as CSSProperties}>
                  <div className="sp-tier-head">
                    <span className="sp-tier-roman">{ROMANS[tier]}</span>
                    <span className="sp-tier-name">{TIER_NAMES[tier]}</span>
                  </div>
                  <button type="button" className="sp-deck" data-tier={tier} data-reservable={mayReserve}
                    disabled={!mayReserve || deck.length === 0}
                    onClick={() => action({ kind: 'reserve', tier, slot: null })}
                    title={mayReserve ? '从牌堆顶端盲抽一张预留' : '发展卡余量 ' + deck.length + ' 张'}>
                    <span className="sp-deck-count">{deck.length}</span>
                    {mayReserve ? <span className="sp-deck-hint">盲抽预留</span> : null}
                  </button>
                  {row.map((card, slot) => card ? (
                    <DevelopmentCardView key={card.id} card={card}
                      affordable={paymentFor(card, view.players[view.current]) !== null}
                      onBuy={canAct && canDo({ kind: 'buy', source: 'market', tier, slot }) ?
                        () => action({ kind: 'buy', source: 'market', tier, slot }) : undefined}
                      onReserve={mayReserve ? () => action({ kind: 'reserve', tier, slot }) : undefined}
                    />
                  ) : <div key={'empty-' + slot} className="sp-empty-card">售罄</div>)}
                </div>
              );
            })}
          </div>
        </section>

        <div className="sp-lower-board">
          <section className="sp-nobles-section">
            <div className="sp-nobles-row">
              {view.nobles.map((noble) => <NobleTile key={noble.id} noble={noble} />)}
              {view.nobles.length === 0 ? <span className="sp-empty-note">{view.rules.nobleCount === 0 ? '本局未启用贵族' : '贵族们已全部到访'}</span> : null}
            </div>
          </section>

          <section className="sp-vault-section">
            <div className="sp-bank-row">
              {GEM_COLORS.map((color) => (
                <div key={color} className="sp-bank-slot">
                  <GemToken color={color} count={view.bank[color]} size="md"
                    selected={picked.includes(color)} disabled={!canAct || view.bank[color] === 0}
                    onClick={() => handleSelectGem(color)} />
                  {canAct && view.bank[color] >= view.rules.doubleTakeMinimum ? (
                    <button type="button" className="sp-double-pill" title={'一次性领取两枚'}
                      onClick={() => action({ kind: 'double', color })}>×2</button>
                  ) : null}
                </div>
              ))}
              <div className="sp-bank-slot is-gold">
                <GemToken color="gold" count={view.bank.gold} size="md" />
              </div>
            </div>
            {canAct ? (
              <div className="sp-take-tray">
                <div className="sp-tray">
                  {[0, 1, 2].map((slot) => {
                    const color = picked[slot];
                    return (
                      <button type="button" key={slot} className="sp-tray-slot" data-filled={color !== undefined}
                        onClick={() => color ? handleSelectGem(color) : undefined}
                        aria-label={color ? '移除' : '空槽位'}>
                        {color ? <GemToken color={color} size="xs" /> : <i>＋</i>}
                      </button>
                    );
                  })}
                </div>
                <button type="button" className="sp-primary-button" disabled={!canTake}
                  onClick={() => action({ kind: 'take', colors: picked })}>
                  确认领取 →
                </button>
              </div>
            ) : null}
          </section>
        </div>

        <footer className="sp-controls">
          <div className="sp-controls-left">
            <button type="button" className="sp-control-primary" disabled={snap.status === 'finished' || replaying}
              onClick={() => session.toggle()}>{snap.status === 'running' ? 'Ⅱ 暂停' : '▶ 继续'}</button>
            <button type="button" disabled={snap.status === 'finished' || replaying || actingSeat === config.humanSeat}
              onClick={() => session.stepOnce()}>▷ 单步</button>
            <span className="sp-control-divider" />
            {SPEEDS.map((speed) => <button type="button" key={speed} data-active={snap.speed === speed}
              onClick={() => session.setSpeed(speed)}>{speed}×</button>)}
          </div>
          <div className="sp-controls-right">
            <button type="button" onClick={() => replaying ? session.closeReplay() : session.openReplay()}>
              {replaying ? '退出回放' : '◷ 回放'}</button>
            <button type="button" onClick={() => session.restart()}>↺ 重开</button>
            <button type="button" onClick={onExit}>⚙ 设定</button>
          </div>
        </footer>
        {replaying && frame ? (
          <div className="sp-replay">
            <button type="button" disabled={snap.replayIndex === 0}
              onClick={() => session.setReplayIndex((snap.replayIndex ?? 0) - 1)}>←</button>
            <input type="range" min={0} max={snap.frames.length - 1} value={snap.replayIndex ?? 0}
              onChange={(event) => session.setReplayIndex(Number(event.target.value))} aria-label="回放进度" />
            <button type="button" disabled={snap.replayIndex === snap.frames.length - 1}
              onClick={() => session.setReplayIndex((snap.replayIndex ?? 0) + 1)}>→</button>
            <span>{snap.replayIndex} / {snap.frames.length - 1}　{frame.label}</span>
          </div>
        ) : null}
      </div>

      <aside className={'sp-game-side' + (sideOpen ? '' : ' is-collapsed')}>
        <button className="sp-side-toggle" type="button" onClick={() => setSideOpen(!sideOpen)}
          aria-label={sideOpen ? '收起信息面板' : '展开信息面板'}>{sideOpen ? '›' : '‹'}</button>
        {sideOpen ? (
          <>
            <section className="sp-side-section sp-side-player">
              <div className="sp-side-heading">
                <SeatSigil seat={inspectedSeat} small />
                <div><h3>{PLAYER_NAMES[inspectedSeat]}</h3>
                  <small>{inspectedSeat === config.humanSeat ? '真人席位' : aiLevel.label + ' AI 商会'}</small></div>
                <span className="sp-side-vp"><b>{viewer.points}</b><small>VP</small></span>
              </div>
              <div className="sp-portfolio-label">永久折扣 <small>点亮发展卡</small></div>
              <div className="sp-bonus-inventory">
                {GEM_COLORS.map((color) => (
                  <span key={color} className={'sp-stack' + (bonusesOf(viewer)[color] === 0 ? ' is-empty' : '')}
                    data-color={color}>{bonusesOf(viewer)[color]}</span>
                ))}
              </div>
              <div className="sp-portfolio-label">宝石筹码 <small>上限 {view.rules.tokenLimit} 枚</small></div>
              <div className="sp-inventory">
                {([...GEM_COLORS, 'gold'] as TokenColor[]).filter((color) => viewer.tokens[color] > 0).map((color) => (
                  <GemToken key={color} color={color} size="sm" count={viewer.tokens[color]} />
                ))}
                {tokenCount(viewer.tokens) === 0 ? <span className="sp-empty-note">尚无筹码</span> : null}
              </div>
              <div className="sp-portfolio-label">预留卡 <small>{viewer.reserved.length}/{view.rules.reserveLimit}</small></div>
              <div className="sp-reserved-row">
                {viewer.reserved.map((card, slot) => (
                  <div key={card.id} className="sp-reserved-item" data-color={card.bonus}>
                    <GemToken color={card.bonus} size="xs" />
                    <span className="sp-reserved-vp">{card.points || '—'} VP</span>
                    <span className="sp-reserved-costs">
                      {GEM_COLORS.filter((color) => card.cost[color] > 0).map((color) => (
                        <em key={color} data-color={color}>{card.cost[color]}</em>
                      ))}
                    </span>
                    {canAct && inspectedSeat === actingSeat && canDo({ kind: 'buy', source: 'reserved', slot }) ? (
                      <button type="button" className="sp-reserved-buy" onClick={() => action({ kind: 'buy', source: 'reserved', slot })}>购入</button>
                    ) : null}
                  </div>
                ))}
                {!viewer.reserved.length ? <span className="sp-empty-note">暂无预留发展卡</span> : null}
              </div>
              {viewer.nobles.length ? (
                <>
                  <div className="sp-portfolio-label">到访贵族 <small>+{viewer.nobles.length * 3} VP</small></div>
                  <div className="sp-portfolio-nobles">
                    {viewer.nobles.map((noble) => <i key={noble.id} title={'贵族 ' + noble.id}>♛</i>)}
                  </div>
                </>
              ) : null}
            </section>

            <section className="sp-side-section sp-side-ai">
              <div className="sp-side-heading"><div><span className="sp-eyebrow">STRATEGY DESK</span><h3>AI 决策观察</h3></div>
                <span className="sp-ai-level" title={aiLevel.description}>{aiLevel.label}</span>
              </div>
              {snap.ai && snap.status !== 'finished' ? (
                <>
                  <p className="sp-ai-goal">{snap.ai.goal}</p>
                  <div className="sp-ai-candidates">
                    {snap.ai.candidates.slice(0, 5).map((candidate, index) => (
                      <div className="sp-ai-candidate" key={moveKey(candidate.move) + '-' + index} data-best={index === 0}>
                        <span className="sp-ai-rank">{String(index + 1).padStart(2, '0')}</span>
                        <span className="sp-ai-choice"><b>{describeMove(snap.state, candidate.move)}</b>
                          <small>{candidate.reason}</small></span>
                        <span className="sp-ai-value">{candidate.score.toFixed(1)}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : <p className="sp-empty-note">对局结束，决策已归档。</p>}
            </section>

            <section className="sp-side-section sp-side-events">
              <div className="sp-side-heading"><div><span className="sp-eyebrow">TRADE LEDGER</span><h3>商会记事簿</h3></div></div>
              <div className="sp-event-list">
                {snap.log.slice(0, 22).map((event, index) => (
                  <div className="sp-event" key={event.turn + '-' + index} data-kind={event.kind}>
                    <EventGlyph kind={event.kind} />
                    <div><b>{PLAYER_NAMES[event.player]}</b><p>{event.text}</p></div>
                  </div>
                ))}
                {snap.log.length === 0 ? <p className="sp-empty-note">交易所已经开市，等待第一笔成交。</p> : null}
              </div>
            </section>
          </>
        ) : null}
      </aside>
    </div>
  );
}
