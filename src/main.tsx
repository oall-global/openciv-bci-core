import React from 'react';
import { createRoot } from 'react-dom/client';
import './tokens.css';
import './theme-colors.css';
import './palette-map.css';
import { applyTheme, installCanvasTheme, savedTheme } from './theme';
import App from './App';
import './styles.css';
import './workbench.css';
import './shell/system.css';
import './platform/macos.css';
if (window.neuro?.platform === 'darwin') document.documentElement.dataset.platform = 'darwin';
// Before the first render, so the window does not flash the other theme.
applyTheme(savedTheme());
installCanvasTheme();
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
