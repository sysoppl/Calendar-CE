/** Selects in a settings row share a minimum width so the column lines up; on a phone, where they sit under their label, they take the whole width. */
export const SELECT = 'field w-auto min-w-[11rem] max-w-full max-sm:w-full';

/**
 * A select at the end of its label's line on a phone too (`SettingRow
 * inline`), only for short values ("4 days", "07:00", "Week"). On a phone
 * they all take the same width, so both their edges line up down the page;
 * from `sm` on they are drawn like the others.
 */
export const SELECT_INLINE = 'field w-36 shrink-0 sm:w-auto sm:min-w-[11rem] sm:max-w-full';
