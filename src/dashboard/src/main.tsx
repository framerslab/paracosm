import { migrateLegacyKeyOverrides } from './hooks/useLastLaunchConfig';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './theme/tokens.css';

migrateLegacyKeyOverrides();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
