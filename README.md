# Smart Home Activity (Data-driven, Editor + Player)

Static, front-end only mini-game for teaching IoT/smart-home design.
- **Editor**: build scenarios without coding (choose devices from catalog, upload background, mark anchors, define aims & rules). Export `scenario.json`.
- **Player**: students load a scenario and play (select + place devices, connect, submit; per-aim animations).

## Live Pages
- Editor: `editor.html`
- Player: `player.html?scenario=scenarios/case01/scenario.json`

## Folder Structure
- `/js/core/*` shared logic (catalog loader, schema, engine, storage, utils)
- `/js/editor/*` editor-specific modules
- `/js/player/*` player-specific modules
- `/data/catalog/devices.json` master device catalog (grouped by category)
- `/scenarios/<slug>/scenario.json` scenario definition (data-driven, reusable)
- `/scenarios/<slug>/background.(png|jpg|svg)` background referenced by the scenario

## Development
No build step. Just open with a static server (Apache, GitHub Pages, VS Code Live Server).
All files are same-origin; `fetch()` local JSON works.

## Core Ideas
- **Normalized anchor coords (0..1)** so any background scales.
- **Catalog-driven device pool** (teacher picks allowed devices; player gets distractors too).
- **Rules per "aim"**. Each aim evaluated separately on submit; success/fail animations over the stage.
- **Connect** button must be pressed before submit (configurable in scenario).

## Rule Expressions
- Rule checks now store a nested expression tree instead of a flat list. Each expression is a top-level group node:
  ```json
  {
    "type": "group",
    "operator": "and", // "and" | "or"
    "children": [
      { "type": "clause", "deviceId": "voice_assistant", "anchorId": "a1" },
      {
        "type": "group",
        "operator": "or",
        "children": [
          { "type": "clause", "deviceId": "smart_bulb", "anchorId": "a2" },
          { "type": "clause", "deviceId": "smart_strip", "anchorId": "a2" }
        ]
      }
    ]
  }
  ```
- Existing scenarios with flat `expression` arrays (or `requiredPlacements`) are migrated automatically when opened in the editor, and the engine still evaluates the legacy format for backwards compatibility.
- Nested groups correspond to parentheses in the editor UI: you can add clauses, add AND/OR subgroups, and wrap selected sibling clauses into a subgroup to build more complex logic.

## AI TODO Guidance
- Implement Editor stage: background load, zoom/pan optional, click to add anchors → list anchors → edit properties (label, type, accepts[], isDistractor).
- Implement device catalog UI: checkboxes by category → produces `allowedDeviceIds` + `distractorIds`.
- Implement aims & rules UI for the Step 1 sample (voice on/off, lux threshold).
- Implement export/import (JSON) and localStorage autosave.
- Implement Player runtime: parse scenario → render device list → render anchors → allow placement (no correctness hints) → Connect → Submit → evaluate each aim → play animations.
- Keep everything framework-free and <200KB total JS.

## Publishing (Apache)
Upload the whole folder (or a scenario subfolder) to your Apache web root. Ensure `.htaccess` is present for MIME/caching.

