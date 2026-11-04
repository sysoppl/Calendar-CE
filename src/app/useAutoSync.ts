import { useEffect } from 'react';
import { startAutoSync } from '@/lib/autoSync';
import { useData } from '@/store/data';

/** Keeps the calendars up to date by themselves while the calendar is shown (lib/autoSync.ts). */
export function useAutoSync() {
  const hydrated = useData((s) => s.hydrated);
  useEffect(() => (hydrated ? startAutoSync() : undefined), [hydrated]);
}
