// Calendars kept on this device: the risk to accept, what can delete them,
// the one-file backup and its reminder (lib/deviceStorage.ts, lib/backup.ts),
// and the home screen widgets' messages in the app (lib/widgets.ts).
export const storageEn = {
  'settings.section.backup': 'Backup',

  // Once, when calendars are first kept on this device
  'storage.risk.title': 'Kept only on this device',
  'storage.risk.body': 'Your calendars and task lists are kept only on this device. There is no other copy anywhere, so if they are deleted here, nobody can bring them back.',
  'storage.risk.backup': 'Save a backup now and then: one file that brings everything back. The app reminds you when the last one gets old (Settings › Backup).',
  'storage.risk.own': 'You keep your calendars on this device at your own risk.',
  'storage.risk.accept': 'I accept the risks',
  'storage.risk.other': 'Keep them elsewhere',

  // Once, above the calendar: what deletes them
  'storage.notice.title': 'Calendars on this device can be lost',
  'storage.notice.intro': 'They are deleted for good when:',
  'storage.notice.outro': 'A backup file brings them back.',
  'storage.notice.close': 'Close',
  'storage.risk.web.clear': "this browser's data is cleared (history, cookies and site data)",
  'storage.risk.web.private': 'the app runs in a private or incognito window and the window is closed',
  'storage.risk.web.space': 'the browser frees up space because the device runs low on storage',
  'storage.risk.web.unused': 'the browser removes the data of sites not visited for a while (on iPhone and iPad after 7 days, unless the app is on the Home Screen)',
  'storage.risk.web.browser': 'the browser or its profile is removed or reset; another browser or device does not see them at all',
  'storage.risk.uninstall': 'the app is uninstalled',
  'storage.risk.android.clear': "the app's storage is cleared in the system settings (Apps › Calendar CE › Storage)",
  'storage.risk.android.newPhone': "you move to a new phone: the system's own backup does not copy them",
  'storage.risk.device': 'the device is lost, broken or reset to factory settings',

  // The backup file
  'backup.file.name': 'Calendar CE backup',
  'backup.saved': 'Backup saved',
  'backup.downloaded': 'Backup file downloaded',
  'backup.saveFailed': 'The backup could not be saved. Try again, or choose another place.',
  'backup.unreadable': 'Not in the backup, because it could not be read on this device: {names}',

  // The reminder above the calendar
  'backup.due.never': 'No backup of your calendars yet.',
  'backup.due.since': 'Last backup: {date}. Time for a new one.',
  'backup.due.later': 'Remind me later',
  'backup.due.action': 'Back up',

  // Settings › Backup
  'backup.intro':
    'A backup is one file with every calendar and task list kept on this device, all their events and tasks, your subscribed and holiday calendars, and your settings. Calendars on a CalDAV server are kept there and are not part of it.',
  'backup.group.file': 'Backup file',
  'backup.make': 'Back up',
  'backup.make.hint': 'The file is not encrypted: keep it somewhere safe.',
  'backup.make.button': 'Back up now',
  'backup.last': 'Last backup: {date}.',
  'backup.last.none': 'No backup saved on this device yet.',
  'backup.restore': 'Restore',
  'backup.restore.hint': 'Brings back the calendars of a backup file. Nothing on this device is deleted.',
  'backup.restore.button': 'Choose a backup file',
  'backup.reminder': 'Backup reminder',
  'backup.reminder.hint': 'A notice above the calendar asks for a new backup once the last one is this old. Only while calendars are kept on this device.',
  'backup.reminder.off': 'Off',
  'backup.reminder.every': 'Every {n} days',
  'backup.reminder.custom': 'Custom',
  'backup.reminder.customLabel': 'Days between backups',
  'backup.reminder.days': 'days',

  // Restoring
  'backup.restore.title': 'Restore a backup',
  'backup.restore.made': 'Made on',
  'backup.restore.calendars': 'Calendars and task lists',
  'backup.restore.items': 'Events and tasks',
  'backup.restore.generated': 'Subscribed and holiday calendars',
  'backup.restore.damaged': 'Unreadable items, left out',
  'backup.restore.empty': 'There is nothing in this backup to restore.',
  'backup.restore.merge': 'Nothing on this device is deleted. An event or task in the file replaces the same one here; everything else is added.',
  'backup.restore.settings': 'Restore the settings too',
  'backup.restore.go': 'Restore',
  'backup.restore.progress': 'Restoring',
  'backup.restore.count': '{done} of {total}',
  'backup.restored': 'Backup restored',
  'backup.restoreFailed': 'Restoring stopped: {reason}',
  'backup.feedsFailed': 'Not added, as they could not be reached now: {names}. Subscribe to them again later.',
  'backup.error.notBackup': 'This file is not a Calendar CE backup.',
  'backup.error.newer': 'This backup was made by a newer version of the app. Update the app, then restore it.',
  'backup.error.damaged': 'This backup file is damaged and cannot be read.',
  'backup.error.tooLarge': 'This file is too large to be a backup.',
  'backup.error.read': 'The file could not be read.',
  'welcome.restore': 'Restore from a backup file',

  // Saving files, and the home screen widgets
  'files.saveFailed': 'The file could not be saved.',
  'widget.missing': 'This item is no longer in the calendar.',
};
