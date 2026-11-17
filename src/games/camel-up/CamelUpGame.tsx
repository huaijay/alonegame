import { useState } from 'react';
import type { GameConfig } from '@/games/camel-up/engine/types';
import { SetupScreen } from '@/games/camel-up/ui/SetupScreen';
import { GameStage } from '@/games/camel-up/ui/GameStage';
// 游戏专属样式：黄沙嘉年华主题（样式归属本游戏，不进全局）
import '@/games/camel-up/ui/camel-up.css';

/**
 * 骆驼大赛入口组件：配置页 ⇄ 对局页切换
 * @returns 未配置时渲染 SetupScreen，配置后渲染 GameStage
 */
export default function CamelUpGame() {
  const [config, setConfig] = useState<GameConfig | null>(null);
  return config ? (
    <GameStage config={config} onExit={() => setConfig(null)} />
  ) : (
    <SetupScreen onStart={setConfig} />
  );
}
