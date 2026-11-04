import { useEffect, useState } from 'react';
import { RotateCw } from 'lucide-react';
import { useT } from '@/i18n';
import { Button, Spinner } from './Button';
import { TOUCH_AREA } from './touch';

/** How long a start may take before the loading screen says that it is taking long. */
export const SLOW_START_MS = 15_000;

const reload = () => window.location.reload();

/**
 * The loading screen while the app opens what the device keeps. A start that
 * neither finishes nor fails (a store that never answers) would leave the
 * spinner for good: `SLOW_START_MS` after `since` a calm line under it says
 * so and offers Reload. It is not a failure, as the start may still finish;
 * then this screen goes, line and all. The spinner stays where it was.
 */
export function StartingScreen({ since, onReload = reload }: { since: number; onReload?: () => void }) {
  const t = useT();
  const [slow, setSlow] = useState(() => Date.now() - since >= SLOW_START_MS);
  useEffect(() => {
    if (slow) return;
    const timer = setTimeout(() => setSlow(true), Math.max(0, since + SLOW_START_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [since, slow]);

  return (
    <div className={`text-frame-weak grid h-full grid-rows-[1fr_auto_1fr] justify-items-center ${TOUCH_AREA}`}>
      <span />
      <Spinner size={28} />
      {/* Present from the start, so that a screen reader announces the line when it comes. */}
      <div role="status" className="self-start px-4 pt-6">
        {slow && (
          <div className="animate-fade flex flex-col items-center gap-3 text-center">
            <p className="text-frame-text text-pretty">{t('app.slowStart')}</p>
            <Button variant="frame" size="sm" icon={<RotateCw size={14} />} onClick={onReload}>
              {t('app.failure.reload')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
