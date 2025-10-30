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
- `/assets/audio/*.mp3` placeholder text files for audio cues; replace locally with real MP3 or WAV clips (keep the filenames) before deploying sound
- `/assets/device-icons/*.txt` placeholder markers for UI icons; swap in production SVG/PNG assets while preserving filenames referenced by scenarios

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

## Current Capabilities

### Editor
- **Scenario staging.** The stage loader in [`js/editor/image-stage.js`](js/editor/image-stage.js) supports uploading a background image, normalizes anchor coordinates, and exposes zoom/pan controls.
- **Anchor authoring.** [`js/editor/editor-app.js`](js/editor/editor-app.js) wires together the anchor toolbar, property sidebar, and drag handles so authors can add, label, and configure accepted devices for each anchor.
- **Device catalog curation.** The catalog manager in [`js/editor/catalog-panel.js`](js/editor/catalog-panel.js) lets teachers choose the allowed devices and optional distractors from the shared catalog data.
- **Aims & rules workflow.** [`js/editor/aims-rules.js`](js/editor/aims-rules.js) provides nested AND/OR rule authoring with grouping, clause editing, and inline validation tied to the scenario data.
- **Persistence.** Drafts autosave to `localStorage`, and authors can import/export complete `scenario.json` files directly from the UI.

### Player
- **Scenario playback.** [`js/player/player-app.js`](js/player/player-app.js) loads the exported scenario, renders anchors, and provides the drag-and-drop placement workflow the editor describes.
- **Connection & submission flow.** The runtime enforces the optional Connect step before Submit, evaluates each aim against the authored rules, and plays the corresponding success/failure animations.
- **Device toolbox.** Players receive the curated device list (plus distractors) defined in the scenario data, with category filters that mirror the editor’s catalog settings.

## Roadmap
- Accessibility and mobile layout polishing for both editor and player screens.
- Optional audio cues & icons: replace the placeholder files in `/assets/audio` and `/assets/device-icons` with production-ready assets, then update the runtime to load the new media.
- Automated regression checks for rule evaluation and autosave flows.

## Publishing (Apache)
Upload the whole folder (or a scenario subfolder) to your Apache web root. Ensure `.htaccess` is present for MIME/caching.

