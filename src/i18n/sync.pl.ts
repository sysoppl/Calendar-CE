import type { syncEn } from './sync.en';

export const syncPl: Record<keyof typeof syncEn, string> = {
  'status.label': 'Stan',
  'status.device': 'Na tym urządzeniu',
  'status.synced.server': 'Zsynchronizowano z: {name}',
  'status.synced.servers': 'Zsynchronizowano z serwerami',
  'status.synced': 'Zsynchronizowano',
  'status.offline': 'Offline - nie można zapisać zmian',
  'status.password': 'Wpisz ponownie hasło do: {name}',
  'status.unreachable': 'Brak połączenia z serwerem',
  'status.error': 'Nie udało się zsynchronizować: {name}',
  'status.retry': 'Spróbuj ponownie',
  'status.syncing': 'Synchronizowanie…',
  'status.firstSync': 'Pobieranie kalendarzy…',
  'status.refreshFailed': 'Nie udało się odświeżyć: {error}',

  'save.saved': 'Zapisano',
  'save.localFailed': 'Nie udało się zapisać na tym urządzeniu: pamięć jest pełna lub zablokowana.',
  'save.reset': 'Przywrócono ustawienia domyślne',
  'save.undo': 'Cofnij',
  'save.calendarFailed': 'Nie udało się zapisać zmiany w „{name}”: {error}',
  'save.accountRemoved': 'Usunięto konto',

  'settings.group.format': 'Język i format',
  'settings.group.view': 'Widok kalendarza',
  'settings.group.newEvents': 'Nowe wydarzenia',
  'settings.allSettings': 'Wszystkie ustawienia',

  'settings.textSize.system': 'Rozmiar tekstu jak w systemie',
  'settings.textSize.systemHint': 'Teraz {pct}%, zgodnie z ustawieniem systemu (maks. {max}%).',

  'settings.notificationsHintAndroid': 'Przypomnienia przychodzą także przy zamkniętej aplikacji.',
  'settings.notificationsHintWeb': 'Przypomnienia pojawiają się, gdy Kalendarz jest otwarty w przeglądarce.',

  'shortcuts.refresh': 'Odśwież',
};
