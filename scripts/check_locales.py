#!/usr/bin/env python3
"""Compare locale catalogs against the English source."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Dict, Iterable, Tuple


def flatten_catalog(data: Dict, prefix: Tuple[str, ...] = ()) -> Dict[str, object]:
    """Return a dictionary mapping dotted paths to leaf values."""
    flat: Dict[str, object] = {}

    def _walk(node: object, parts: Tuple[str, ...]) -> None:
        if isinstance(node, dict):
            for key, value in node.items():
                _walk(value, parts + (str(key),))
        else:
            flat['.'.join(parts)] = node

    _walk(data, prefix)
    return flat


def load_catalog(path: Path) -> Dict:
    with path.open('r', encoding='utf-8') as handle:
        return json.load(handle)


def find_missing_keys(reference: Dict[str, object], candidate: Dict[str, object]) -> Iterable[str]:
    ref_keys = set(reference.keys())
    cand_keys = set(candidate.keys())
    return sorted(ref_keys - cand_keys)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--catalog-dir',
        default='i18n',
        help='Directory containing locale JSON files (default: %(default)s).',
    )
    parser.add_argument(
        '--default-locale',
        default='en',
        help='Locale code that serves as the canonical source (default: %(default)s).',
    )
    args = parser.parse_args()

    catalog_dir = Path(args.catalog_dir).resolve()
    default_path = catalog_dir / f'{args.default_locale}.json'

    if not default_path.exists():
        print(f'! Default catalog {default_path} does not exist.')
        return 1

    reference_catalog = flatten_catalog(load_catalog(default_path))

    locale_files = sorted(
        path for path in catalog_dir.glob('*.json')
        if path.name != default_path.name
    )

    if not locale_files:
        print('No additional locale catalogs to compare.')
        return 0

    exit_code = 0
    for locale_path in locale_files:
        candidate_catalog = flatten_catalog(load_catalog(locale_path))
        missing = list(find_missing_keys(reference_catalog, candidate_catalog))
        if missing:
            exit_code = 1
            print(f'Locale "{locale_path.stem}" is missing {len(missing)} key(s):')
            for key in missing:
                print(f'  - {key}')
        else:
            print(f'Locale "{locale_path.stem}" is up-to-date.')

    if exit_code:
        print('\nRun this script after adding new keys to alert translators about missing strings.')
    return exit_code


if __name__ == '__main__':
    raise SystemExit(main())
