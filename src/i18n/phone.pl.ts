import type { phoneEn } from './phone.en';

export const phonePl: Record<keyof typeof phoneEn, string> = {
  'nav.moreOverdue': 'Więcej, zaległe zadania',
  'nav.dueCount': 'Do zrobienia: {n}',

  'nav.dayCount': 'Liczba dni',

  'editor.participantsHintTouch': 'Po wpisaniu adresu należy dotknąć Dodaj',
  'editor.addParticipant': 'Dodaj',
};
