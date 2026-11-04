import { useEffect } from 'react';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { useData } from '@/store/data';
import { useSettings } from '@/store/settings';
import { applyTheme, themeById } from '@/theme/themes';
import { applyFont, fontById } from '@/theme/fonts';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { refreshSystemFontScale, useTextScale } from '@/hooks/useTextScale';
import { useDictionaryCount, useLang } from '@/i18n';
import { isNative } from '@/lib/platform';
import { tellBackground } from '@/lib/display';

/** Applies theme, font, shape, density and text size to the document. */
export function useAppearance() {
  const { themeMode, theme, lightTheme, darkTheme, accentColor, density, shape, fontFamily } = useSettings();
  const scale = useTextScale();
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const lang = useLang();
  useEffect(() => {
    const id = themeMode === 'system' ? (prefersDark ? darkTheme : lightTheme) : theme;
    const def = themeById(id);
    applyTheme(def, accentColor);
    if (isNative) {
      // The system bars take the frame's colour: light icons on a dark theme, dark ones on a light theme
      // (every light theme has a light frame). Until the page gets here, the window's theme keeps them
      // light (android/app/src/main/res/values/styles.xml).
      void StatusBar.setStyle({ style: def.dark ? Style.Dark : Style.Light }).catch(() => {});
      void StatusBar.setBackgroundColor({ color: def.tokens.frameBg }).catch(() => {});
      // And the app paints the frame colour behind the page, so that no light window shows below it
      // while the keyboard slides in (src/lib/display.ts).
      tellBackground(def.tokens.frameBg);
    }
  }, [themeMode, theme, lightTheme, darkTheme, accentColor, prefersDark]);
  useEffect(() => applyFont(fontById(fontFamily)), [fontFamily]);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.density = density;
    root.dataset.shape = shape;
    root.style.setProperty('--font-scale', String(scale));
    root.lang = lang;
  }, [density, shape, scale, lang]);
  // The system's font size: read at start, and again when the app comes back
  // to the front, since it may have been changed in the system's settings.
  useEffect(() => {
    void refreshSystemFontScale();
    if (!isNative) return;
    const resume = CapApp.addListener('resume', () => void refreshSystemFontScale());
    return () => void resume.then((h) => h.remove());
  }, []);
  // Holiday names follow the interface language, once its dictionary is there.
  const dictionaries = useDictionaryCount();
  useEffect(() => useData.getState().refreshHolidayCalendars(), [lang, dictionaries]);
  useEffect(() => {
    // An installed app takes its name from the manifest, which has one per language.
    document.querySelector('link[rel="manifest"]')?.setAttribute('href', lang === 'pl' ? '/manifest.pl.webmanifest' : '/manifest.webmanifest');
  }, [lang]);
}
