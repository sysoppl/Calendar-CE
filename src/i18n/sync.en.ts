// English strings of how syncing and saving are reported: the status line, saved / not saved. Spread into `en`.
export const syncEn = {
  // The one line about the state of the calendars (sidebar, account card, header popover)
  'status.label': 'Status',
  'status.device': 'On this device',
  'status.synced.server': 'Synced with {name}',
  'status.synced.servers': 'Synced with your servers',
  'status.synced': 'Synced',
  'status.offline': "Offline - changes can't be saved",
  'status.password': 'Enter the password for {name} again',
  'status.unreachable': "Couldn't reach the server",
  'status.error': "Couldn't sync {name}",
  'status.retry': 'Try again',
  'status.syncing': 'Syncing…',
  'status.firstSync': 'Getting your calendars…',
  'status.refreshFailed': "Couldn't refresh: {error}",

  // Feedback on a change of the settings
  'save.saved': 'Saved',
  'save.localFailed': "Couldn't save on this device: the storage is full or blocked.",
  'save.reset': 'Settings reset',
  'save.undo': 'Undo',
  'save.calendarFailed': "Couldn't save the change to {name}: {error}",
  'save.accountRemoved': 'Account removed',

  // Settings → General, in groups
  'settings.group.format': 'Language and format',
  'settings.group.view': 'Calendar view',
  'settings.group.newEvents': 'New events',
  'settings.allSettings': 'All settings',

  // Settings → Appearance → text size
  'settings.textSize.system': 'Match the system text size',
  'settings.textSize.systemHint': 'Now {pct}%, as set in the system (up to {max}%).',

  // Settings → Notifications
  'settings.notificationsHintAndroid': 'Reminders arrive even when the app is closed.',
  'settings.notificationsHintWeb': 'Reminders appear while Calendar CE is open in the browser.',

  // The list of shortcuts: R
  'shortcuts.refresh': 'Refresh',
};
