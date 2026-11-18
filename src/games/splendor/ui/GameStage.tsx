import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import { PLAYER_NAMES } from '../engine/board';
import { describeMove } from '../engine/ai/search';
import { aiLevelFor } from '../engine/ai/levels';
import { bonusesOf, getLegalMoves, moveKey, paymentFor } from '../engine/rules';
import { GameSession } from '../engine/session';
import { GEM_COLORS } from '../engine/types';
import type { GameConfig, GameEvent, GameState, GemColor, Move, TokenColor } from '../engine/types';
import { DevelopmentCardView, NobleChip, NobleTile } from './DevelopmentCardView';
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
function SeatAssets({ view, seat }: { view: GameState; seat: number }) {
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
      <span className="sp-seat-chips">
        {([...GEM_COLORS, 'gold'] as TokenColor[]).filter((color) => player.tokens[color] > 0).map((color) => (
          <GemToken key={color} color={color} size="xs" count={player.tokens[color]} />
        ))}
      </span>
    </>
  );
}

/**
 * 展示珠宝交易桌面及本局固定的 AI 强度，所有行动交由会话推进。
 * 布局自上而下：贵族 → 卡市 → 宝石银行 → 对手席位 → 玩家操作区。
 * @param props 对局配置与退出回调
 * @returns 支持真人行动、观赛与回放的桌面
 */
export function GameStage({ config, onExit }: GameStageProps) {
  const session = useMemo(() => new GameSession(config), [config]);
  const aiLevel = aiLevelFor(config.aiStrength, config.playerCount);
  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [picked, setPicked] = useState<GemColor[]>([]);
  const [sideOpen, setSideOpen] = useState(true);
  // 玩家档案以悬浮气泡展示：记录触发元素几何用于锚定，不撑开侧栏布局
  const [fileAnchor, setFileAnchor] = useState<
    { inspectedSeat: number; cx: number; top: number; bottom: number } | null>(null);
  const inspectedSeat = fileAnchor?.inspectedSeat ?? null;

  useEffect(() => {
    session.start();
    return () => session.dispose();
  }, [session]);

  useEffect(() => {
    setPicked([]);
  }, [snap.state.turn]);

  /** 点击席位切换悬浮档案：记录触发元素几何，气泡贴着它弹出。 */
  const toggleFile = (seat: number, el: HTMLElement) => {
    if (fileAnchor?.inspectedSeat === seat) { setFileAnchor(null); return; }
    const rect = el.getBoundingClientRect();
    setFileAnchor({
      inspectedSeat: seat,
      cx: rect.left + rect.width / 2,
      top: rect.top,
      bottom: rect.bottom,
    });
  };

  // 点浮层外部关闭：席位与自己的头部除外，它们由 onClick 负责切换
  useEffect(() => {
    if (!fileAnchor) return;
    const close = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('.sp-file-pop') || target.closest('.sp-seat, .sp-my-head')) return;
      setFileAnchor(null);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [fileAnchor]);

  const replaying = snap.replayIndex !== null;
  const frame = snap.replayIndex === null ? null : snap.frames[snap.replayIndex];
  const view: GameState = frame?.state ?? snap.state;
  const actingSeat = snap.state.current;
  const humanSeat = config.humanSeat;
  const canAct = humanSeat !== null && humanSeat === actingSeat &&
    snap.state.phase === 'playing' && !replaying;
  const legal = useMemo(() => getLegalMoves(snap.state), [snap.state]);
  const canDo = (move: Move) => legal.some((item) => moveKey(item) === moveKey(move));
  const aiThinking = snap.status === 'running' && !replaying && view.phase === 'playing' &&
    (humanSeat === null || humanSeat !== view.current);
  const human = humanSeat === null ? null : view.players[humanSeat];
  const humanBonuses = human ? bonusesOf(human) : null;

  // 双取模式以两个相同颜色的槽位预显示，与单张/三张一样都等「确认领取」才真正执行。
  const doublePicked = picked.length === 2 && picked[0] === picked[1];
  const canTake = doublePicked ? canDo({ kind: 'double', color: picked[0] })
    : picked.length === 3 ? canDo({ kind: 'take', colors: picked }) : false;

  const handleSelectGem = (color: GemColor) => {
    if (!canAct) return;
    setPicked((prev) => {
      // 已预选双取时锁定槽位：点同色取消，点异色不响应，避免拼出非法组合。
      if (prev.length === 2 && prev[0] === prev[1]) return prev[0] === color ? [] : prev;
      return prev.includes(color) ? prev.filter((item) => item !== color)
        : prev.length < 3 ? [...prev, color] : prev;
    });
  };

  const handleDouble = (color: GemColor) => {
    if (!canAct) return;
    setPicked([color, color]);
  };

  const removeSlot = (slot: number) => {
    setPicked((prev) => prev.filter((_, index) => index !== slot));
  };

  const action = (move: Move) => {
    if (!canAct) return;
    session.humanMove(move);
    setPicked([]);
  };

  const confirmTake = () => {
    if (!canAct || !canTake) return;
    action(doublePicked ? { kind: 'double', color: picked[0] } : { kind: 'take', colors: picked });
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

        <section className="sp-nobles-section">
          <div className="sp-nobles-row">
            {view.nobles.map((noble) => <NobleTile key={noble.id} noble={noble} />)}
            {view.nobles.length === 0 ? <span className="sp-empty-note">{view.rules.nobleCount === 0 ? '本局未启用贵族' : '贵族们已全部到访'}</span> : null}
          </div>
        </section>

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
                  <div className="sp-deck" data-tier={tier}
                    title={'发展卡余量 ' + deck.length + ' 张'}>
                    <span className="sp-deck-count">{deck.length}</span>
                  </div>
                  {row.map((card, slot) => card ? (
                    <DevelopmentCardView key={card.id} card={card}
                      affordable={paymentFor(card, view.players[view.current]) !== null}
                      onBuy={canAct && canDo({ kind: 'buy', source: 'market', tier, slot }) ?
                        () => action({ kind: 'buy', source: 'market', tier, slot }) : undefined}
                      onReserve={mayReserve && canDo({ kind: 'reserve', tier, slot }) ?
                        () => action({ kind: 'reserve', tier, slot }) : undefined}
                    />
                  ) : <div key={'empty-' + slot} className="sp-empty-card">售罄</div>)}
                </div>
              );
            })}
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
                  <button type="button" className="sp-double-pill" title={'预选两枚，确认后领取'}
                    onClick={() => handleDouble(color)}>×2</button>
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
                      onClick={() => color ? removeSlot(slot) : undefined}
                      aria-label={color ? '移除' : '空槽位'}>
                      {color ? <GemToken color={color} size="xs" /> : <i>＋</i>}
                    </button>
                  );
                })}
              </div>
              <button type="button" className="sp-primary-button" disabled={!canTake}
                onClick={confirmTake}>
                确认领取 →
              </button>
            </div>
          ) : null}
        </section>

        {view.winners.length > 0 ? (
          <div className="sp-victory-banner"><span>♛</span>
            <b>{view.winners.map((seat) => PLAYER_NAMES[seat]).join('、')} 荣登首席</b>
            <small>{Math.max(...view.players.map((player) => player.points))} 声望 · 本局圆满结束</small>
          </div>
        ) : view.finalRound ? (
          <div className="sp-final-banner">✦ 已有玩家达到 {view.rules.victoryPoints} 声望，本轮结束即结算最终名次 ✦</div>
        ) : null}

        <div className="sp-seat-row">
          {view.players.map((player, index) => humanSeat === index ? null : (
            <button type="button" key={index} className="sp-seat" data-seat={index}
              data-active={view.phase === 'playing' && index === view.current}
              data-winner={view.winners.includes(index)}
              data-selected={inspectedSeat === index}
              onClick={(event) => toggleFile(index, event.currentTarget)}
              title="查看该玩家的完整档案">
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
              {player.nobles.length ? (
                <span className="sp-seat-nobles" title={'已拜访贵族 +' + player.nobles.length * 3 + ' 分'}>
                  {player.nobles.map((noble) => <NobleChip key={noble.id} noble={noble} />)}
                </span>
              ) : null}
              <span className="sp-seat-score">
                {view.winners.includes(index) ? <i className="sp-seat-crown">♛</i> : null}
                <b key={player.points} className="sp-score-num">{player.points}</b>
                <small>VP</small>
              </span>
            </button>
          ))}
        </div>

        {human && humanBonuses ? (
          <section className="sp-my-desk" data-active={canAct} data-winner={view.winners.includes(humanSeat ?? -1)}>
            <button type="button" className="sp-my-head"
              data-selected={inspectedSeat === humanSeat}
              onClick={(event) => toggleFile(humanSeat ?? 0, event.currentTarget)}
              title="查看你的完整档案">
              <SeatSigil seat={humanSeat ?? 0} small />
              <div className="sp-my-title">
                <strong>{PLAYER_NAMES[humanSeat ?? 0]}<i className="sp-my-tag">你</i></strong>
                <small>{view.phase === 'finished' ? '对局已结束'
                  : canAct ? '轮到你了：拿筹码、购卡或锁定近卡'
                    : snap.status === 'paused' ? '已暂停 · 可单步推演' : '等待其他玩家…'}</small>
              </div>
              {human.nobles.length ? (
                <span className="sp-my-nobles" title={'已拜访贵族 +' + human.nobles.length * 3 + ' 分'}>
                  {human.nobles.map((noble) => <NobleChip key={noble.id} noble={noble} />)}
                </span>
              ) : null}
              {view.winners.includes(humanSeat ?? -1) ? <i className="sp-seat-crown">♛</i> : null}
              <span className="sp-my-vp"><b>{human.points}</b><small>VP</small></span>
            </button>
            {/* 折扣卡与筹码同色列对齐：上排是永久折扣叠牌，下排是同色实体筹码，便于心算差距 */}
            <div className="sp-my-columns">
              {GEM_COLORS.map((color) => (
                <div key={color} className="sp-my-column">
                  <span className={'sp-stack' + (humanBonuses[color] === 0 ? ' is-empty' : '')}
                    data-color={color} title="永久折扣">{humanBonuses[color]}</span>
                  <GemToken color={color} size="sm" count={human.tokens[color]} />
                </div>
              ))}
              <div className="sp-my-column is-gold">
                <span className="sp-stack is-empty">—</span>
                <GemToken color="gold" size="sm" count={human.tokens.gold} />
              </div>
            </div>
            <div className="sp-my-reserved">
              <div className="sp-portfolio-label">预留发展卡
                <small>{human.reserved.length}/{view.rules.reserveLimit} · 只差 1 枚筹码时可锁定并获黄金</small></div>
              <div className="sp-reserved-row">
                {human.reserved.map((card, slot) => (
                  <div key={card.id} className="sp-reserved-item" data-color={card.bonus}>
                    <GemToken color={card.bonus} size="xs" />
                    <span className="sp-reserved-vp">{card.points || '—'} VP</span>
                    <span className="sp-reserved-costs">
                      {GEM_COLORS.filter((color) => card.cost[color] > 0).map((color) => (
                        <em key={color} data-color={color}>{card.cost[color]}</em>
                      ))}
                    </span>
                    {canAct && canDo({ kind: 'buy', source: 'reserved', slot }) ? (
                      <button type="button" className="sp-reserved-buy"
                        onClick={() => action({ kind: 'buy', source: 'reserved', slot })}>购入</button>
                    ) : null}
                  </div>
                ))}
                {!human.reserved.length ? <span className="sp-empty-note">暂无预留发展卡</span> : null}
              </div>
            </div>
          </section>
        ) : null}

        <footer className="sp-controls">
          <div className="sp-controls-left">
            <button type="button" className="sp-control-primary" disabled={snap.status === 'finished' || replaying}
              onClick={() => session.toggle()}>{snap.status === 'running' ? 'Ⅱ 暂停' : '▶ 继续'}</button>
            <button type="button" disabled={snap.status === 'finished' || replaying || actingSeat === humanSeat}
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
              <div className="sp-side-heading"><div><span className="sp-eyebrow">TRADE LEDGER</span><h3>交易记事簿</h3></div></div>
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

      {/* 悬浮玩家档案：锚定在触发席位旁的气泡，不参与文档流、不撑高任何面板 */}
      {fileAnchor ? (() => {
        const fileSeat = fileAnchor.inspectedSeat;
        const player = view.players[fileSeat];
        const stacks = bonusesOf(player);
        const popWidth = 384;
        // 触发元素在页面上半部时气泡朝下弹出，否则朝上（席位都位于页面下半部）
        const placeAbove = fileAnchor.top > window.innerHeight * 0.45;
        const maxHeight = placeAbove
          ? fileAnchor.top - 24
          : window.innerHeight - fileAnchor.bottom - 24;
        return (
          <div className="sp-file-pop" style={{
            left: Math.min(Math.max(12, fileAnchor.cx - popWidth / 2), window.innerWidth - popWidth - 12),
            maxHeight,
            ...(placeAbove
              ? { bottom: window.innerHeight - fileAnchor.top + 10 }
              : { top: fileAnchor.bottom + 10 }),
          } as CSSProperties}>
            <div className="sp-file-head">
              <div><span className="sp-eyebrow">PLAYER FILE</span><h3>{PLAYER_NAMES[fileSeat]} 档案</h3></div>
              <button type="button" className="sp-file-close"
                onClick={() => setFileAnchor(null)} aria-label="关闭玩家档案">✕</button>
            </div>
            <div className="sp-player-file">
              <div className="sp-file-vp-breakdown">
                <span className="sp-file-seat"><SeatSigil seat={fileSeat} small />{PLAYER_NAMES[fileSeat]}</span>
                <b className="sp-file-total">{player.points}<small>VP</small></b>
              </div>
              <dl className="sp-file-vp-split">
                <div><dt>发展卡 {player.cards.length} 张</dt><dd>+{player.cards.reduce((sum, card) => sum + card.points, 0)} 分</dd></div>
                <div><dt>贵族 {player.nobles.length} 位</dt><dd>+{player.nobles.length * 3} 分</dd></div>
              </dl>
              <div className="sp-file-label">已购发展卡</div>
              {player.cards.length ? (
                <ul className="sp-file-cards">
                  {[3, 2, 1].map((tier) => player.cards.filter((card) => card.tier === tier).map((card) => (
                    <li key={card.id} className="sp-file-card" data-color={card.bonus}>
                      <GemToken color={card.bonus} size="xs" />
                      <span className="sp-file-card-name">{ROMANS[tier]} 阶 · {TIER_NAMES[tier]}</span>
                      <b>{card.points || '—'} 分</b>
                    </li>
                  )))}
                </ul>
              ) : <p className="sp-empty-note">尚未购入任何发展卡。</p>}
              <div className="sp-file-label">拜访贵族</div>
              {player.nobles.length ? (
                <div className="sp-file-nobles">
                  {player.nobles.map((noble) => (
                    <span key={noble.id} className="sp-file-noble" title={noble.id}>
                      <NobleChip noble={noble} /><b>+3</b>
                    </span>
                  ))}
                </div>
              ) : <p className="sp-empty-note">还未赢得贵族到访。</p>}
              {player.reserved.length ? (
                <>
                  <div className="sp-file-label">预留卡 {player.reserved.length} 张</div>
                  <div className="sp-file-reserved">
                    {player.reserved.map((card) => (
                      <span key={card.id} className="sp-mini-card" data-color={card.bonus}>{card.points || ''}</span>
                    ))}
                  </div>
                </>
              ) : null}
              <div className="sp-file-label">资产</div>
              <div className="sp-file-tokens">
                {([...GEM_COLORS, 'gold'] as TokenColor[]).map((color) => (
                  <GemToken key={color} color={color} size="xs" count={player.tokens[color]} />
                ))}
              </div>
              <div className="sp-file-label">永久折扣</div>
              <div className="sp-file-stacks">
                {GEM_COLORS.map((color) => (
                  <span key={color} className={'sp-stack' + (stacks[color] === 0 ? ' is-empty' : '')}
                    data-color={color}>{stacks[color]}</span>
                ))}
              </div>
            </div>
          </div>
        );
      })() : null}
    </div>
  );
}
