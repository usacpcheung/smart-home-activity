# Device Icon Assets

This directory stores catalog art for device icons at a resolution of **150 × 150 pixels**.

## Naming Convention
- Icon slugs defined in `data/catalog/devices.json` map to files named `<slug>.png` in this directory.
- During development we keep placeholder text files named `<slug>.txt`; replace each with a PNG that preserves the slug when art is ready.

## Integration Notes
- Editors and players should load icons using `assets/device-icons/<slug>.png`.
- When replacing the placeholders, ensure the final PNG assets remain 150 × 150 pixels to avoid layout issues.
