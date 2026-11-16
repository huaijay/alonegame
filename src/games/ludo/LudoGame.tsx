import { useState } from 'react';
import type { GameConfig } from '@/games/ludo/engine/types';
import { GameStage } from '@/games/ludo/ui/GameStage';
import { SetupScreen } from '@/games/ludo/ui/SetupScreen';

/**
 * 飞行棋游戏入口：负责配置页与对局页之间的切换。
 * 全局主题与返回大厅由应用外壳（src/app）统一管理。
 */
export default function LudoGame() {
  const [config, setConfig] = useState<GameConfig | null>(null);

  return config ? (
    <GameStage config={config} onExit={() => setConfig(null)} />
  ) : (
    <SetupScreen onStart={setConfig} />
  );
}
