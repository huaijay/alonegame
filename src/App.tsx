import { useEffect, useState } from 'react';
import type { GameConfig } from '@/lib/game/types';
import { GameStage } from '@/components/GameStage';
import { SetupScreen } from '@/components/SetupScreen';

type Theme = 'dark' | 'light';

const THEME_KEY = 'fxq:theme';

/**
 * 读取初始主题：优先使用本地记录，否则跟随系统偏好
 *
 * @returns 初始主题
 */
function readInitialTheme(): Theme {
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // 隐私模式下 localStorage 可能不可用，退回到系统偏好
  }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** 主题图标：太阳 / 月亮 */
function ThemeIcon({ theme }: { theme: Theme }) {
  return theme === 'dark' ? (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.2 5.2l1.7 1.7M17.1 17.1l1.7 1.7M18.8 5.2l-1.7 1.7M6.9 17.1l-1.7 1.7" strokeLinecap="round" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
      <path d="M20 14.4A8.4 8.4 0 0 1 9.6 4a8.6 8.6 0 1 0 10.4 10.4Z" />
    </svg>
  );
}

/** 应用入口：配置页与对局页之间切换，并管理深浅主题 */
export default function App() {
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  /** 将主题写到根节点并持久化 */
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      // 写入失败不影响当前会话的主题切换
    }
  }, [theme]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="flex items-center gap-3">
          <span className="logo-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="26" height="26">
              <path d="M16 3 L29 27 L16 22 L3 27 Z" fill="url(#logo-grad)" />
              <defs>
                <linearGradient id="logo-grad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#38e8ff" />
                  <stop offset="1" stopColor="#ff4fd8" />
                </linearGradient>
              </defs>
            </svg>
          </span>
          <div>
            <p className="eyebrow">AERO CHESS</p>
            <h1 className="app-title">自动飞行棋</h1>
          </div>
        </div>
        <div className="header-meta">
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
          >
            <ThemeIcon theme={theme} />
            {theme === 'dark' ? '浅色' : '深色'}
          </button>
          <span className="badge">AI · Expectimax</span>
          <span className="badge badge-dim">2-4 人自动对弈</span>
        </div>
      </header>

      {config ? (
        <GameStage config={config} onExit={() => setConfig(null)} />
      ) : (
        <SetupScreen onStart={setConfig} />
      )}
    </div>
  );
}
