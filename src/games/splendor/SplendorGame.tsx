import { useState } from 'react';
import type { GameConfig } from './engine/types';
import { SetupScreen } from './ui/SetupScreen';
import { GameStage } from './ui/GameStage';
import './ui/splendor.css';

/** 璀璨宝石入口：开局配置与自动对弈舞台切换。 */
export default function SplendorGame() {
  const [config, setConfig] = useState<GameConfig | null>(null);
  return config ? (
    <GameStage config={config} onExit={() => setConfig(null)} />
  ) : (
    <SetupScreen onStart={setConfig} />
  );
}
