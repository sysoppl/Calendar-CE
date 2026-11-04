# Contributing to Calendar Community Edition

Thanks for helping! Bug reports, translations, fixes and features that fit a local-first calendar are all welcome.

## Before you start

- For anything bigger than a small fix, open an [issue](https://github.com/sysoppl/Calendar-CE/issues) first so
  we can agree on the approach before you spend time on it.
- This edition keeps calendars on the device or on CalDAV servers. Features that need a hosted backend of their
  own are out of scope.

## Setting up

```sh
npm ci
npm run dev          # http://localhost:5173
```

`window.__calendarSeed()` in the browser console of the dev server fills the calendar with sample data. For a
CalDAV server to test against, `docker compose --profile radicale up -d radicale` starts Radicale on
`http://127.0.0.1:5232/`.

## Before you open a pull request

```sh
npm run typecheck
npm test
npm run build
```

For Android changes also run `npm run android:sync` and `cd android && ./gradlew testDebugUnitTest`.

- Keep the change focused and add tests for new behaviour.
- **Interface text:** add every new key to `src/i18n/en.ts` (or the matching `*.en.ts` file) and to all other
  languages (`pl`, and `src/i18n/locales/<lang>.ts`). The tests check that all 10 languages have the same keys and
  placeholders. A machine translation is fine as a start; say so in the pull request.
- **Dependencies:** only with a licence compatible with the AGPL-3.0. Run `npm run licenses` to update
  `public/THIRD-PARTY-NOTICES.txt`.
- **Security:** CalDAV passwords never go into logs, and the DAV proxy's restrictions stay in place.
- **Encryption (`src/lib/crypto/`):** the protocol is shared with the hosted apps. Reviews, tests and clearer docs are
  welcome; a change that alters the bytes (and `vectors.json`) can't be merged on its own. Report weaknesses privately
  ([SECURITY.md](SECURITY.md)).

## Licence

By contributing you agree that your contribution is licensed under the
[GNU Affero General Public License, version 3 only](LICENSE) (AGPL-3.0-only), like the rest of the project.
