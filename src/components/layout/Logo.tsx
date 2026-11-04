import { useT } from '@/i18n';
import { useDarkTheme } from '@/hooks/useDarkTheme';
import { logoDataUri } from '@/theme/logo';

/** The logo by palette, small drawing first: Paper in the light themes, Ink in the dark ones. */
const LOGOS = {
  paper: [logoDataUri({ palette: 'paper', small: true }), logoDataUri({ palette: 'paper', small: false })],
  ink: [logoDataUri({ palette: 'ink', small: true }), logoDataUri({ palette: 'ink', small: false })],
};

/** Sizes from here up show the whole month; below it the small drawing, whose days stay apart. */
const FULL_FROM = 40;

/** The app icon: the same static drawing as the tab icon and the installed app's, on ink in a dark theme. */
export function LogoMark({ size = 28 }: { size?: number }) {
  const dark = useDarkTheme();
  const src = LOGOS[dark ? 'ink' : 'paper'][size >= FULL_FROM ? 1 : 0];
  return <img src={src} width={size} height={size} alt="" className="shrink-0" />;
}

export function Logo() {
  const t = useT();
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <LogoMark />
      <span className="truncate text-[1.0625rem] font-semibold tracking-tight">{t('app.name')}</span>
    </div>
  );
}
