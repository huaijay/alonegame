import { createRoot } from 'react-dom/client';
import App from './app/App';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('找不到 #root 挂载点');

// 不使用 StrictMode：对局会话持有定时器，双挂载会导致播放状态被销毁
createRoot(root).render(<App />);
