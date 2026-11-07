import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { viewportRegistry } from './render3d/viewportRegistry';
import { App } from './ui/App';
import './styles.css';

declare global {
  interface Window {
    /** Dev-only handle for measuring the viewport (e.g. __sv3d.current.measureRotation()). */
    __sv3d?: typeof viewportRegistry;
  }
}

if (import.meta.env.DEV) window.__sv3d = viewportRegistry;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
