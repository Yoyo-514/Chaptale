import '@/styles/index.scss';
import '@unocss/reset/normalize.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'virtual:uno.css';
import App from './App.tsx';

const root = createRoot(document.getElementById('root')!);

root.render(
  <StrictMode>
    <App />
  </StrictMode>
);
