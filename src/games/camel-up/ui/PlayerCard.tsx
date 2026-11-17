import type { CSSProperties } from 'react';
import { CAMEL_META, SEAT_META } from '@/games/camel-up/engine/board';
import type { Seat } from '@/games/camel-up/engine/board';
import type { PlayerState } from '@/games/camel-up/engine/types';

interface PlayerCardProps {
  seat: Seat;
  player: PlayerState;
  /** 是否为当前行动玩家 */
  active: boolean;
  winner: boolean;
}

/**
 * 座位卡：金币盘 + 名字徽标 + 筹码行（腿注片 / 金币片 / 手牌 / 地形块）
 * 行动中带座位色呼吸光晕，胜者切换金色徽标。
 */
export function PlayerCard({ seat, player, active, winner }: PlayerCardProps) {
  const meta = SEAT_META[seat];

  return (
    <div
      className="cmp-player"
      data-active={active}
      data-winner={winner}
      style={{ '--seat-color': meta.color } as CSSProperties}
    >
      <div className="cmp-coin" title={`${meta.name}资金 ${player.coins} EP`}>
        <span>{player.coins}</span>
      </div>
      <div className="cmp-player-body">
        <div className="cmp-player-head">
          <span className="cmp-player-name">{meta.name}</span>
          {winner ? <span className="cmp-badge cmp-badge-gold">冠军</span> : null}
          {active && !winner ? <span className="cmp-badge cmp-badge-live">行动中</span> : null}
        </div>
        <div className="cmp-chips">
          {player.legTickets.map((ticket, index) => (
            <span key={index} className="cmp-chip" title={`${CAMEL_META[ticket.color].name}腿注`}>
              <i className="cmp-chip-dot" style={{ background: CAMEL_META[ticket.color].color } as CSSProperties} />
              {ticket.value}
            </span>
          ))}
          {player.pyramidTickets > 0 ? (
            <span className="cmp-chip" title="金字塔金币片">金币片 ×{player.pyramidTickets}</span>
          ) : null}
          <span className="cmp-chip" title="手中押注牌">手牌 {player.hand.length}</span>
          <span className="cmp-chip cmp-chip-muted" title="沙漠地形块">
            {player.desert.pos === null ? '地形块在手' : `地形块 · 第 ${player.desert.pos + 1} 格`}
          </span>
        </div>
      </div>
    </div>
  );
}
