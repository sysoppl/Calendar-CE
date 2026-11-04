import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import '@fontsource-variable/inter';
import './styles/index.css';
import { claimInstance } from './lib/instance';
import { LoadFailedScreen, OtherTabScreen } from './components/ui/OtherTabScreen';

// Only what is above loads before this page may run the app: the app's
// stores read what the device keeps as they load, and must not do that while
// another copy of the app is still changing it (see lib/instance.ts).
const isNative = Capacitor.isNativePlatform();

// Offline app shell for the installed web app (not needed inside Capacitor).
if (import.meta.env.PROD && !isNative && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

const container = document.getElementById('root')!;
let waiting: Root | null = null;

const instance = claimInstance({
  // The Android app is one copy by itself.
  ...(isNative ? { locks: null } : {}),
  onWaiting() {
    waiting = createRoot(container);
    waiting.render(
      <StrictMode>
        <OtherTabScreen onUseHere={() => instance.takeOver()} />
      </StrictMode>,
    );
  },
});

void instance.ready.then(async () => {
  let loaded: typeof import('./App');
  try {
    let i18n: typeof import('./i18n');
    [loaded, i18n] = await Promise.all([import('./App'), import('./i18n')]);
    // The first screen in the chosen language, not in English for a moment.
    await i18n.prepareLanguage();
  } catch (err) {
    // A chunk that did not arrive (no network, a release replaced it): never a blank page.
    console.error('Calendar could not load', err instanceof Error ? err.name : 'unknown');
    waiting?.unmount();
    createRoot(container).render(<LoadFailedScreen />);
    return;
  }
  const { App, ROOT_ERROR_OPTIONS } = loaded;
  waiting?.unmount();
  waiting = null;
  if (import.meta.env.DEV) {
    void import('./dev/seed').then(({ seedDemo }) => {
      (window as unknown as { __calendarSeed: typeof seedDemo }).__calendarSeed = seedDemo;
    });
  }
  // React's own error reports print the message, which can quote calendar data.
  createRoot(container, ROOT_ERROR_OPTIONS).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
