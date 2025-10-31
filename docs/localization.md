# Localization Guide

## English source catalog
- `i18n/en.json` contains every user-facing string grouped by feature (`index`, `editor`, `player`, etc.).
- Keys mirror the module or UI surface that owns the copy so engineers can find usages quickly.
- Keep this file as the canonical reference when updating or auditing text.

## Add a new locale
1. Copy `i18n/en.json` to `i18n/<locale>.json` (for example, `i18n/es.json`).
2. Translate the **values only**. Preserve the key structure so modules can resolve the same paths.
3. Leave every placeholder from the table below intact. Replace only the surrounding prose.
4. Commit the new locale file or, if it should stay private, store it under a name or folder matched by the ignore rules below.

## Register the locale code
When the runtime initializes i18n (see `js/core/i18n.js`), include the new locale code in the configuration:
```js
import { initI18n } from './js/core/i18n.js';

initI18n({
  defaultLocale: 'en',
  availableLocales: ['en', '<locale>']
});
```
If you maintain your own bootstrap script, make sure it passes the same locale list to `initI18n` so the catalog can be fetched.

## Placeholder reference
| Placeholder | Meaning |
| --- | --- |
| `{limit}` | Maximum number of aims allowed in the editor. |
| `{id}` | Anchor identifier inserted into default labels. |
| `{reason}` | Detailed upload failure explanation. |
| `{title}` | Scenario title displayed in upload, storage, or status messages. |
| `{slot}` | Numeric storage slot displayed after saving a scenario. |
| `{name}` | Ruleset label used in lock messages. |
| `{state}` | Ruleset lock state (`active` / `inactive`). |
| `{label}` | Ruleset name shown in activation messages. |
| `{device}` | Device display name in placement feedback. |
| `{anchor}` | Anchor display name in placement feedback. |
| `{verb}` | Connection verb (`connected` / `disconnected`). |
| `{lockMessage}` | Secondary text describing ruleset lock state. |
| `{summary}` | Comma-separated list of selected rulesets. |
| `{url}` | Scenario URL that failed to load. |
| `{error}` | Error string from failed scenario loading. |
| `{passed}` | Number of aims satisfied during evaluation. |
| `{total}` | Total number of aims evaluated. |
| `{details}` | Optional parenthetical explaining incorrect ruleset selections. |
| `{labels}` | Human-readable list of ruleset names (missing or unexpected). |

Placeholders use single braces (`{token}`) because `js/core/i18n.js` interpolates them at runtime.

## Private locale files
Teams can keep internal or in-progress translations out of version control by placing them under `i18n/private/` or naming them `*.local.json`. Both patterns are ignored by Git (see `.gitignore`).
