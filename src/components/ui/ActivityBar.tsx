import { useDelayed } from '@/hooks/useDelayed';

/**
 * A thin line along the top edge of its (positioned) parent while work goes
 * on that has no measure: a stretch of the accent runs across it, or it
 * breathes in place with reduced motion. Shows only once the work has taken
 * a moment, so quick work never flickers it.
 */
export function ActivityBar({ active, label, className = '' }: { active: boolean; label: string; className?: string }) {
  const shown = useDelayed(active);
  if (!shown) return null;
  return (
    <div role="progressbar" aria-label={label} className={`animate-fade pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden ${className}`}>
      <div className="animate-sweep bg-primary h-full w-2/5 rounded-full" />
    </div>
  );
}
