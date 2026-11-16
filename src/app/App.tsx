import { useEffect, useState } from 'react';
import { GAMES } from './registry';

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

/**
 * 从 URL hash 解析当前激活的游戏 id（如 #/ludo）
 *
 * @returns 游戏 id；无 hash 或 id 未注册时返回 null（回到大厅）
 */
function readActiveGameId(): string | null {
  const match = /^#\/([a-z0-9-]+)$/.exec(window.location.hash);
  return match?.[1] ?? null;
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

/** 应用外壳：游戏大厅与各游戏之间切换，统一管理深浅主题 */
export default function App() {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);
  const [activeId, setActiveId] = useState<string | null>(readActiveGameId);

  /** 将主题写到根节点并持久化 */
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      // 写入失败不影响当前会话的主题切换
    }
  }, [theme]);

  /** 监听浏览器前进/后退，保证 hash 与大厅状态同步 */
  useEffect(() => {
    const onHashChange = () => setActiveId(readActiveGameId());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const active = GAMES.find((game) => game.id === activeId) ?? null;

  /** 打开游戏：写入 hash，刷新或分享链接后仍停留在对应游戏 */
  const openGame = (id: string) => {
    window.location.hash = '#/' + id;
    setActiveId(id);
  };

  /** 返回大厅：清除 hash 并同步状态 */
  const backToLobby = () => {
    window.history.pushState(null, '', window.location.pathname + window.location.search);
    setActiveId(null);
  };

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
            <p className="eyebrow">{active ? active.eyebrow : 'GAME HUB'}</p>
            <h1 className="app-title">{active ? active.name : '游戏中心'}</h1>
          </div>
        </div>
        <div className="header-meta">
          {active && (
            <button type="button" className="theme-toggle" onClick={backToLobby}>
              ← 返回大厅
            </button>
          )}
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
          >
            <ThemeIcon theme={theme} />
            {theme === 'dark' ? '浅色' : '深色'}
          </button>
          {active ? (
            active.badges.map((badge, index) => (
              <span key={badge} className={index === 0 ? 'badge' : 'badge badge-dim'}>
                {badge}
              </span>
            ))
          ) : (
            <span className="badge badge-dim">AI 对弈合集</span>
          )}
        </div>
      </header>

      {active ? (
        <active.component />
      ) : (
        <section className="lobby">
          {GAMES.map((game) => (
            <button
              key={game.id}
              type="button"
              className="lobby-card"
              onClick={() => openGame(game.id)}
            >
              <p className="eyebrow">{game.eyebrow}</p>
              <h2 className="lobby-card-title">{game.name}</h2>
              <p className="lobby-card-desc">{game.description}</p>
              <div className="lobby-card-tags">
                {game.badges.map((badge) => (
                  <span key={badge} className="badge badge-dim">
                    {badge}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </section>
      )}
    </div>
  );
}
