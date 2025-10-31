# Localization Guide

## English source catalog
- `i18n/en.json` contains every user-facing string grouped by feature (`index`, `editor`, `player`, etc.).
- Keys mirror the module or UI surface that owns the copy so engineers can find usages quickly.
- Keep this file as the canonical reference when updating or auditing text.

## Localization checklist
1. Copy `i18n/en.json` to `i18n/<locale>.json` (for example, `i18n/es.json`).
2. Rename the file so the basename matches the locale code you plan to ship (`es`, `fr-CA`, etc.).
3. Translate the **values only**. Preserve the key structure so modules can resolve the same paths.
4. Keep every placeholder exactly as it appears (see the examples below). Replace only the surrounding prose.
5. Add the locale code to the initialization configuration so the runtime can fetch the new catalog.
6. Run `scripts/check_locales.py` to confirm the new file carries every key that exists in English.
7. Commit the new locale file or, if it should stay private, store it under a name or folder matched by the ignore rules below.

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
| `{clip}` | Audio clip label shown in playback warnings. |
| `{issue}` | Audio error reason (missing path, unsupported type, etc.). |
| `{source}` | Audio file path or URL that failed to load or buffer. |

Placeholders use single braces (`{token}`) because `js/core/i18n.js` interpolates them at runtime. If a string contains double braces (`{{token}}`), treat the entire token—including both braces—as immutable because another formatter will resolve it later.

### Placeholder examples
```json
"common": {
  "status": {
    "deviceReady": "{{device}} is ready to use.",
    "scenarioCount": "{{count}} scenarios available."
  }
}
```

The Spanish translation should keep both placeholder tokens intact:

```json
"common": {
  "status": {
    "deviceReady": "{{device}} está listo para usar.",
    "scenarioCount": "Hay {{count}} escenarios disponibles."
  }
}
```

Only translate the prose around `{{device}}` and `{{count}}`; the runtime (or templating layer) swaps the placeholders with live values.

## Check for missing keys
Use the helper script to confirm every non-English catalog includes the same set of keys as the source file:

```bash
python scripts/check_locales.py
```

Run it whenever you add new strings or before handing the files to translators. The script exits with an error code and lists the missing paths so you can patch the gaps quickly. Pass `--catalog-dir` or `--default-locale` if your project layout differs from the defaults.

## Private locale files
Teams can keep internal or in-progress translations out of version control by placing them under `i18n/private/` or naming them `*.local.json`. Both patterns are ignored by Git (see `.gitignore`).
