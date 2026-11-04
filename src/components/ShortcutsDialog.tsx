import { useUi } from '@/store/ui';
import { useT, type MessageKey } from '@/i18n';
import { Modal } from '@/components/ui/Modal';

const GROUPS: { title: MessageKey; items: { keys: string[]; label: MessageKey }[] }[] = [
  {
    title: 'shortcuts.navigation',
    items: [
      { keys: ['T'], label: 'shortcuts.today' },
      { keys: ['←', '→'], label: 'shortcuts.prevNext' },
      { keys: ['J', 'K'], label: 'shortcuts.prevNext' },
      { keys: ['D', 'W', 'M', 'Y', 'A'], label: 'shortcuts.views' },
      { keys: ['X'], label: 'shortcuts.customView' },
      { keys: ['1', '–', '6'], label: 'shortcuts.viewNumbers' },
    ],
  },
  {
    title: 'shortcuts.actions',
    items: [
      { keys: ['N'], label: 'shortcuts.newEvent' },
      { keys: ['Shift', 'N'], label: 'shortcuts.newTask' },
      { keys: ['E'], label: 'shortcuts.editEvent' },
      { keys: ['Del'], label: 'shortcuts.deleteEvent' },
      { keys: ['/'], label: 'shortcuts.search' },
      { keys: ['G'], label: 'shortcuts.tasks' },
      // Everything is kept up to date by itself; R asks for it at once.
      { keys: ['R'], label: 'shortcuts.refresh' },
      { keys: ['S'], label: 'shortcuts.settings' },
      { keys: ['Ctrl', 'Enter'], label: 'shortcuts.save' },
      { keys: ['Esc'], label: 'shortcuts.close' },
      { keys: ['?'], label: 'shortcuts.help' },
    ],
  },
];

export function ShortcutList() {
  const t = useT();
  return (
    <div className="grid gap-6 py-2 sm:grid-cols-2">
      {GROUPS.map((g) => (
        <section key={g.title}>
          <h3 className="text-text-weak mb-2 text-xs font-semibold tracking-wide uppercase">{t(g.title)}</h3>
          <ul className="flex flex-col gap-2">
            {g.items.map((item, i) => (
              <li key={i} className="flex items-center justify-between gap-4">
                <span>{t(item.label)}</span>
                <span className="flex shrink-0 gap-1">
                  {item.keys.map((k) => (
                    <kbd key={k} className="bg-bg-weak border-border-weak min-w-6 rounded-md border px-1.5 py-0.5 text-center font-mono text-xs">
                      {k}
                    </kbd>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function ShortcutsDialog() {
  const open = useUi((s) => s.shortcutsOpen);
  const setOpen = useUi((s) => s.setShortcutsOpen);
  const t = useT();
  return (
    <Modal open={open} onClose={() => setOpen(false)} title={t('shortcuts.title')} size="lg">
      <ShortcutList />
    </Modal>
  );
}
