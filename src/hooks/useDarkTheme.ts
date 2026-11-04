import { useSettings } from '@/store/settings';
import { themeById } from '@/theme/themes';
import { useMediaQuery } from '@/hooks/useMediaQuery';

/** Whether the theme in use is a dark one, as the root applies it (themeMode, the system's choice). */
export function useDarkTheme(): boolean {
  const themeMode = useSettings((s) => s.themeMode);
  const theme = useSettings((s) => s.theme);
  const lightTheme = useSettings((s) => s.lightTheme);
  const darkTheme = useSettings((s) => s.darkTheme);
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  return themeById(themeMode === 'system' ? (prefersDark ? darkTheme : lightTheme) : theme).dark;
}
