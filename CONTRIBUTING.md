# Contributing to Calendar CE

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

Every pull request gets the full test run in GitHub Actions (`.github/workflows/test.yml`): these commands, the
checks of the Gradle wrapper and the third-party notices, the Content-Security-Policy of the build and a start of the
server on it. The same run has to pass before a version tag gets its Docker image and its release.

- Keep the change focused and add tests for new behaviour.
- **Commit titles** follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`,
  `test:`, `ci:`, `chore:`, with an optional scope: `fix(proxy): ...`). The release notes are made from them.
- **Interface text:** add every new key to `src/i18n/en.ts` (or the matching `*.en.ts` file) and to all other
  languages (`pl`, and `src/i18n/locales/<lang>.ts`). The tests check that all 10 languages have the same keys and
  placeholders. A machine translation is fine as a start; say so in the pull request.
- **Dependencies:** only with a licence compatible with the AGPL-3.0. Run `npm run licenses` to update
  `public/THIRD-PARTY-NOTICES.txt`.
- **Security:** CalDAV passwords never go into logs, and the DAV proxy's restrictions stay in place.
- **Encryption (`src/lib/crypto/`):** the protocol is shared with the hosted apps. Reviews, tests and clearer docs are
  welcome; a change that alters the bytes (and `vectors.json`) can't be merged on its own. Report weaknesses privately
  ([SECURITY.md](SECURITY.md)).

## Licence and the CLA

Calendar CE is published under the [GNU Affero General Public License, version 3 only](LICENSE) (AGPL-3.0-only), and
so is everything merged into it.

Before your first pull request is merged, the CLA Assistant bot asks you to sign the
[Contributor License Agreement](CLA.md), once, by following the link in its comment. You keep the copyright in your
work. The agreement lets the maintainer also use your contribution in other editions of Calendar, such as the hosted
one, and it promises that what is merged here stays available under the AGPL-3.0 or another open-source licence.
