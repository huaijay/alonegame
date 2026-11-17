import { isDeepStrictEqual } from 'node:util';
import { startNextRound } from '../../src/games/azul/engine/rules.ts';

function comparable(state) {
  return {
    ...state,
    round: 0,
    factories: state.factories.map((plate) => [...plate]).sort((a, b) => {
      for (let color = 0; color < 5; color += 1) {
        if (a[color] !== b[color]) return a[color] - b[color];
      }
      return 0;
    }),
    players: state.players.map((board) => ({ ...board, floor: [...board.floor].sort((a, b) => a - b) })),
  };
}

/**
 * 用正式补盘与完整对象比较独立判断弃砖是否返回原局面。
 * @param state 行动前状态
 * @param move 待判断的合法行动
 * @param after 带动画正式规则给出的行动后状态
 * @returns 供应确定且除展示轮数/工厂编号外完全相同时为真
 */
export function repeatsPosition(state, move, after) {
  if (move.row !== -1 || after.phase !== 'roundEnd') return false;
  const pool = after.bag.map((count, color) => count + after.discard[color]);
  // 项目补盘先汇总抽到的五色数量再按色切盘；全池抽完或单色时没有随机未知量。
  if (pool.reduce((sum, count) => sum + count, 0) > state.factoryCount * 4
    && pool.filter((count) => count > 0).length > 1) return false;
  const next = startNextRound(after);
  return next.phase === 'placing' && isDeepStrictEqual(comparable(state), comparable(next));
}
