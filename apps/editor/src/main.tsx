import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { registerServiceWorker } from './lib/pwa.js';
import './styles.css';

// 한 번 열어 두면 인터넷 없이도 열리게 한다. 실패해도 앱은 그대로 돈다.
registerServiceWorker();

const root = document.getElementById('root');
if (!root) throw new Error('#root 를 찾을 수 없습니다');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
