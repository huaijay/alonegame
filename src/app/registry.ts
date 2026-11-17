import type { ComponentType } from 'react';
import LudoGame from '@/games/ludo/LudoGame';
import AzulGame from '@/games/azul/AzulGame';
import CamelUpGame from '@/games/camel-up/CamelUpGame';
import SplendorGame from '@/games/splendor/SplendorGame';

/** 大厅可展示的游戏条目 */
export interface GameEntry {
  /** URL hash 标识（#/id），需与 src/games 下的目录名一致 */
  id: string;
  /** 游戏名称 */
  name: string;
  /** 名称上方的英文小字 */
  eyebrow: string;
  /** 大厅卡片里的一句话简介 */
  description: string;
  /** 特性徽标 */
  badges: string[];
  /** 游戏入口组件（全局主题与返回大厅由外壳统一处理） */
  component: ComponentType;
}

/** 已接入大厅的游戏：新游戏在自己的 src/games/<id> 目录完成后，在此追加一条即可 */
export const GAMES: GameEntry[] = [
  {
    id: 'ludo',
    name: '自动飞行棋',
    eyebrow: 'AERO CHESS',
    description: '2-4 人 AI 自动对弈，Expectimax 决策，完整回放与胜率统计。',
    badges: ['AI · Expectimax', '2-4 人自动对弈'],
    component: LudoGame,
  },
  {
    id: 'azul',
    name: '花砖物语',
    eyebrow: 'AZUL TILES',
    description: '2-4 人 AI 自动对弈花砖物语，Max-n 决策，图案行上墙与轮末结算完整呈现。',
    badges: ['AI · Max-n', '2-4 人自动对弈'],
    component: AzulGame,
  },
  {
    id: 'camel-up',
    name: '骆驼大赛',
    eyebrow: 'CAMEL UP',
    description: '2-8 人 AI 自动对弈骆驼大赛，Expectimax 决策，腿注、地形块与总冠押注完整呈现。',
    badges: ['AI · Expectimax', '2-8 人自动对弈'],
    component: CamelUpGame,
  },
  {
    id: 'splendor',
    name: '璀璨宝石',
    eyebrow: 'SPLENDOR',
    description: '2-4 人宝石商会博弈：90 张发展卡、贵族拜访、AI 自动决策与可选真人入局。',
    badges: ['AI · 经济策略', '2-4 人 · 可参与'],
    component: SplendorGame,
  },
];
