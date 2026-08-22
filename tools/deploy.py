#!/usr/bin/env python3
"""
deploy.py — copies the dashboard into the Home Assistant /config share over SMB
(the "Samba share" add-on).

Why a script and not Finder: on macOS access to a mounted network volume needs the
"Files and Folders -> Network volumes" permission, while a userspace SMB client
works without mounting anything at all.

    pip install smbprotocol

    # show what would happen, write nothing
    python3 tools/deploy.py --host homeassistant.local --user alex --password-file .smb --dry-run

    # copy the files and write the panel package
    python3 tools/deploy.py --host homeassistant.local --user alex --password-file .smb \
        --entities /tmp/mapping.json --rated-power 12

What it does:
  1. www/deye-dashboard/...          - panel files (creates directories as needed);
  2. packages/deye_dashboard.yaml    - the panel_custom block (configuration.yaml is
                                       left alone when it already has
                                       homeassistant: packages: !include_dir_named packages);
  3. no file is deleted, and the panel package is never allowed to lose settings:
     a re-deploy without --entities keeps the `config:` block already on the
     system instead of overwriting it, and always leaves a .bak beside it.

A Home Assistant restart is required afterwards: panel_custom is read at start-up only.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(REPO, 'deye-dashboard')
DEST = 'www/deye-dashboard'
PACKAGE = 'packages/deye_dashboard.yaml'
SKIP = {'.DS_Store'}


LANGUAGES = {'en', 'uk', 'auto'}


def parse_config_block(text: str) -> list[str]:
    """The `config:` block of an existing package, as raw lines (no reindenting).

    Re-deploying without --entities must not silently drop the mapping a human
    pinned earlier, so what is already on the system is carried forward.
    """
    lines = text.splitlines()
    out: list[str] = []
    inside = False
    for line in lines:
        if not inside:
            if line.strip() == 'config:':
                inside = True
                out.append(line)
            continue
        # The block ends at the first line that is not deeper than `config:`.
        if line.strip() and not line.startswith(' ' * 6):
            break
        out.append(line)
    while out and not out[-1].strip():
        out.pop()
    return out if len(out) > 1 else []


def build_package_yaml(entities: dict | None, rated_power: float | None, version: str,
                       language: str | None = None, keep_config: list[str] | None = None) -> str:
    lines = [
        '# Deye Dashboard - a local panel for the solar system.',
        f'# Files: /config/{DEST}/ (README.md and INSTALL.md live there too).',
        '# Picked up via homeassistant: packages: !include_dir_named packages',
        '# To remove the panel: delete this file and restart Home Assistant.',
        '',
        'panel_custom:',
        '  - name: deye-dashboard          # must match the custom element name',
        '    sidebar_title: Deye',
        '    sidebar_icon: mdi:solar-power-variant',
        '    url_path: deye-dashboard',
        f'    module_url: /local/deye-dashboard/deye-dashboard.js?v={version}',
        '    embed_iframe: false           # no iframe: the panel lives inside HA',
        '    require_admin: false',
    ]
    if keep_config and not (entities or rated_power or language):
        # Nothing new to write: preserve the block verbatim.
        lines.extend(keep_config)
        return '\n'.join(lines) + '\n'
    if entities or rated_power or language:
        lines.append('    config:')
        if language:
            lines.append(f'      language: {language}')
        if rated_power:
            lines.append(f'      ratedPowerKw: {rated_power:g}')
        if entities:
            lines.append('      entities:')
            for role, entity_id in entities.items():
                lines.append(f'        {role}: {entity_id}')
    return '\n'.join(lines) + '\n'


def local_files() -> list[tuple[str, str]]:
    """[(local path, path relative to www/deye-dashboard)]"""
    out = []
    for dirpath, dirnames, filenames in os.walk(SRC):
        dirnames[:] = [d for d in dirnames if not d.startswith('.')]
        rel_dir = os.path.relpath(dirpath, SRC)
        for name in sorted(filenames):
            if name.startswith('.') or name in SKIP:
                continue
            rel = name if rel_dir == '.' else f'{rel_dir}/{name}'
            out.append((os.path.join(dirpath, name), rel))
    return sorted(out, key=lambda x: x[1])


def read_version() -> str:
    path = os.path.join(SRC, 'js', 'config.js')
    with open(path, encoding='utf-8') as f:
        for line in f:
            if line.startswith('export const VERSION'):
                return line.split("'")[1]
    return '1.0.0'


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--host', default='homeassistant.local')
    ap.add_argument('--share', default='config')
    ap.add_argument('--user', required=True)
    ap.add_argument('--password-file', required=True, help='file containing the password (single line)')
    ap.add_argument('--entities', help='JSON {role: entity_id} to pin the mapping in the YAML')
    ap.add_argument('--rated-power', type=float, help='inverter rated power, kW')
    ap.add_argument('--language', choices=sorted(LANGUAGES), help='interface language')
    ap.add_argument('--no-package', action='store_true', help='files only, no panel_custom')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    files = local_files()
    version = read_version()
    entities = json.load(open(args.entities, encoding='utf-8')) if args.entities else None
    write_package = not args.no_package

    total = sum(os.path.getsize(p) for p, _ in files)
    print(f'source   : {SRC}')
    print(f'target   : \\\\{args.host}\\{args.share}\\{DEST}')
    print(f'files    : {len(files)} ({total / 1024:.0f} KB), version {version}')
    if entities:
        print(f'entities : {len(entities)} roles pinned in {PACKAGE}')
    if args.dry_run:
        for _, rel in files:
            print(f'  + {DEST}/{rel}')
        if write_package:
            preview = build_package_yaml(entities, args.rated_power, version, args.language)
            print(f'\n--- {PACKAGE} (without the settings already on the host) ---\n{preview}')
        return 0

    with open(args.password_file, encoding='utf-8') as f:
        password = f.read().strip()

    import smbclient
    import smbclient.path

    smbclient.ClientConfig(username=args.user, password=password)
    root = fr'\\{args.host}\{args.share}'

    def remote(path: str) -> str:
        return root + '\\' + path.replace('/', '\\')

    def ensure_dir(path: str) -> None:
        if not smbclient.path.exists(remote(path)):
            smbclient.mkdir(remote(path))

    ensure_dir('www')
    ensure_dir(DEST)
    for sub in sorted({os.path.dirname(rel) for _, rel in files if os.path.dirname(rel)}):
        ensure_dir(f'{DEST}/{sub}')

    for local, rel in files:
        with open(local, 'rb') as src, smbclient.open_file(remote(f'{DEST}/{rel}'), mode='wb') as dst:
            dst.write(src.read())
        print(f'  → {DEST}/{rel}')

    if write_package:
        ensure_dir('packages')
        existing = ''
        if smbclient.path.exists(remote(PACKAGE)):
            with smbclient.open_file(remote(PACKAGE), mode='r', encoding='utf-8') as f:
                existing = f.read()
        keep = parse_config_block(existing)
        package = build_package_yaml(entities, args.rated_power, version, args.language, keep)

        if keep and (entities or args.rated_power or args.language):
            print(f'  ! {PACKAGE} already carries a config: block — replacing it with the '
                  'values given on the command line')
        elif keep:
            print(f'  = {PACKAGE}: keeping the {len(keep) - 1} config lines already on the host')

        if existing and existing != package:
            # A copy of whatever was there, so a mistake is always recoverable.
            with smbclient.open_file(remote(PACKAGE + '.bak'), mode='w', encoding='utf-8', newline='') as f:
                f.write(existing)
            print(f'  → {PACKAGE}.bak (previous version)')
        if existing == package:
            print(f'  = {PACKAGE} unchanged')
        else:
            with smbclient.open_file(remote(PACKAGE), mode='w', encoding='utf-8', newline='') as f:
                f.write(package)
            print(f'  → {PACKAGE}')

    print('\nDone. Home Assistant must be RESTARTED: panel_custom is read at start-up.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
