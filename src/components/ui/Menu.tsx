import {
  autoUpdate,
  flip,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
  FloatingPortal,
  type Placement,
} from '@floating-ui/react';
import { useEffect, useRef, useState, type ReactElement, type ReactNode, cloneElement, isValidElement } from 'react';
import { Check } from 'lucide-react';
import { useKeyboardUi } from '@/hooks/useKeyboardUi';
import { placedStyle, popIn } from './floating';

/** Open menus and pickers, oldest first: the Android back button closes the newest one before anything else. */
const openLayers: { close: () => void }[] = [];

/**
 * Closes the menu or picker opened last (for the Android back button, which
 * asks this before the dialogs: a menu may be open over one). False when
 * none is open.
 */
export function closeTopFloating(): boolean {
  const top = openLayers[openLayers.length - 1];
  if (!top) return false;
  top.close();
  return true;
}

/** Lets the back button close this menu or picker while `open`. */
export function useCloseOnBack(open: boolean, close: () => void): void {
  const ref = useRef(close);
  ref.current = close;
  useEffect(() => {
    if (!open) return;
    const entry = { close: () => ref.current() };
    openLayers.push(entry);
    return () => {
      openLayers.splice(openLayers.indexOf(entry), 1);
    };
  }, [open]);
}

export interface MenuItem {
  label: ReactNode;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  checked?: boolean;
  disabled?: boolean;
  /** The keyboard shortcut, shown only while a keyboard is there. */
  hint?: string;
  /** A count beside the label (tasks due); `badgeLabel` says what it counts to a screen reader. */
  badge?: number;
  badgeLabel?: string;
}

interface MenuProps {
  trigger: ReactElement<Record<string, unknown>>;
  items: (MenuItem | 'separator')[];
  placement?: Placement;
  minWidth?: number;
}

export function Menu({ trigger, items, placement = 'bottom-end', minWidth = 200 }: MenuProps) {
  const [open, setOpen] = useState(false);
  const keys = useKeyboardUi();
  useCloseOnBack(open, () => setOpen(false));
  const { refs, floatingStyles, context, isPositioned } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    middleware: [offset(6), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
    // Placed by left/top: the pop-in animation owns `transform` (see floating.ts).
    transform: false,
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([useClick(context), useDismiss(context), useRole(context, { role: 'menu' })]);

  const ref = refs.setReference;
  const triggerEl = isValidElement(trigger) ? cloneElement(trigger, { ref, ...getReferenceProps() }) : trigger;

  return (
    <>
      {triggerEl}
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={{ ...placedStyle(floatingStyles, isPositioned), minWidth }}
            className={`${popIn(isPositioned)} bg-bg-elevated border-border-weak shadow-elevated text-text z-[60] rounded-xl border py-1.5`}
            data-form-layer
            {...getFloatingProps()}
          >
            {items.map((item, i) =>
              item === 'separator' ? (
                <div key={i} className="bg-border-weak my-1.5 h-px" />
              ) : (
                <button
                  key={i}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                  className={`flex w-full items-center gap-3 px-4 py-2 text-left transition-colors disabled:opacity-50 pointer-coarse:min-h-11 ${
                    item.danger ? 'text-danger hover:bg-bg-weak' : 'hover:bg-bg-weak'
                  }`}
                >
                  {item.icon && <span className="text-text-weak flex w-4 justify-center">{item.icon}</span>}
                  <span className="flex-1">{item.label}</span>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="bg-primary text-primary-contrast flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[0.6875rem] font-bold tabular-nums">
                      <span aria-hidden={item.badgeLabel ? true : undefined}>{item.badge > 99 ? '99+' : item.badge}</span>
                      {item.badgeLabel && <span className="sr-only">{item.badgeLabel}</span>}
                    </span>
                  )}
                  {item.hint && keys && <kbd className="text-text-hint text-xs">{item.hint}</kbd>}
                  {item.checked && <Check size={16} className="text-primary" />}
                </button>
              ),
            )}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

/** A floating panel anchored to a trigger (used for pickers). */
export function Popover({
  trigger,
  children,
  placement = 'bottom-start',
}: {
  trigger: ReactElement<Record<string, unknown>>;
  children: ReactNode | ((close: () => void) => ReactNode);
  placement?: Placement;
}) {
  const [open, setOpen] = useState(false);
  useCloseOnBack(open, () => setOpen(false));
  const { refs, floatingStyles, context, isPositioned } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    middleware: [offset(6), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
    // Placed by left/top: the pop-in animation owns `transform` (see floating.ts).
    transform: false,
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([useClick(context), useDismiss(context), useRole(context, { role: 'dialog' })]);
  const triggerEl = cloneElement(trigger, { ref: refs.setReference, ...getReferenceProps() });
  return (
    <>
      {triggerEl}
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={placedStyle(floatingStyles, isPositioned)}
            className={`${popIn(isPositioned)} bg-bg-elevated border-border-weak shadow-elevated text-text z-[60] rounded-xl border`}
            data-form-layer
            {...getFloatingProps()}
          >
            {typeof children === 'function' ? children(() => setOpen(false)) : children}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
