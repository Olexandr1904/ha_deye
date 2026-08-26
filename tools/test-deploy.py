#!/usr/bin/env python3
"""
test-deploy.py — unit tests for deploy.py's YAML handling. No network, no SMB.
    python3 tools/test-deploy.py

The point of these: a re-deploy must never be able to lose the entity mapping a
human pinned in packages/deye_dashboard.yaml.
"""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('deploy', os.path.join(HERE, 'deploy.py'))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)

failures: list[str] = []
passed = 0


def check(name: str, cond: bool, detail: str = '') -> None:
    global passed
    if cond:
        passed += 1
    else:
        failures.append(f'{name}{": " + detail if detail else ""}')


ENTITIES = {'pvPower': 'sensor.inverter_pv_power', 'batterySoc': 'sensor.inverter_battery',
            'loadPower': 'sensor.inverter_load_power'}

full = deploy.build_package_yaml(ENTITIES, 12, '1.1.0', 'en')
check('the panel block is written', 'panel_custom:' in full and 'name: deye-dashboard' in full)
check('the module url carries the version', 'deye-dashboard.js?v=1.1.0' in full)
check('no iframe', 'embed_iframe: false' in full)
check('every entity is pinned', all(v in full for v in ENTITIES.values()))
check('the rating is written', 'ratedPowerKw: 12' in full)
check('the language is written', 'language: en' in full)
check('configuration.yaml is not touched', 'configuration.yaml' not in full)

kept = deploy.parse_config_block(full)
check('the config block is recognised', kept and kept[0].strip() == 'config:', repr(kept[:1]))
check('the block holds every line', len(kept) == 7, f'{len(kept)} lines')

# The case that used to destroy the mapping: a re-deploy with no --entities.
plain = deploy.build_package_yaml(None, None, '1.1.1', None, kept)
check('a re-deploy without --entities keeps the entities', all(v in plain for v in ENTITIES.values()))
check('a re-deploy keeps the rating', 'ratedPowerKw: 12' in plain)
check('a re-deploy keeps the language', 'language: en' in plain)
check('a re-deploy still updates the version', 'deye-dashboard.js?v=1.1.1' in plain and '1.1.0' not in plain)

# Values given on the command line replace the block instead of duplicating it.
replaced = deploy.build_package_yaml({'pvPower': 'sensor.other'}, None, '1.1.1', None, kept)
check('new values replace the old block', replaced.count('config:') == 1 and 'sensor.other' in replaced)
check('the replaced block drops what was not given again', 'sensor.inverter_load_power' not in replaced)

# A file with no config block at all, and a file with trailing content.
check('no block found in a bare package', deploy.parse_config_block(
    deploy.build_package_yaml(None, None, '1.1.0')) == [])
with_tail = full + '\n# a comment a human added\nsensor:\n  - platform: template\n'
tail_kept = deploy.parse_config_block(with_tail)
check('the block stops before the next top-level key', all('template' not in ln for ln in tail_kept))
check('a hand-added block is carried forward verbatim', tail_kept == kept)

# ── the cache trap: every relative import must carry the version ──
JS = """
import { DeyeDashboard } from './js/app.js';
import { VERSION } from './js/config.js';
import './js/side-effect.js';
export { thing } from './js/thing.js';
const mod = await import('./js/lazy.js');
const up = await import('../shared/util.js');
import { x } from './already.js?v=0.9.0';
const url = 'https://example.com/not-a-module.js';
"""

out, n = deploy.version_imports(JS, '1.2.3')
check('a static import is stamped', "'./js/app.js?v=1.2.3'" in out)
check('a second static import is stamped', "'./js/config.js?v=1.2.3'" in out)
check('a side-effect import is stamped', "'./js/side-effect.js?v=1.2.3'" in out)
check('a re-export is stamped', "'./js/thing.js?v=1.2.3'" in out)
check('a dynamic import is stamped', "'./js/lazy.js?v=1.2.3'" in out)
check('a parent-relative import is stamped', "'../shared/util.js?v=1.2.3'" in out)
check('an existing query is left alone', "'./already.js?v=0.9.0'" in out)
check('a bare URL in a string is not touched', "'https://example.com/not-a-module.js'" in out)
check('the count matches what was stamped', n == 6, f'{n}')
check('nothing is left unversioned', deploy.unversioned_imports(out) == [], str(deploy.unversioned_imports(out)))

twice, n2 = deploy.version_imports(out, '1.2.3')
check('stamping is idempotent', twice == out and n2 == 0, f'{n2} on the second pass')

# The real module graph, not a fixture: one missed specifier means a module
# loaded twice, with two copies of its state.
SRC = os.path.join(os.path.dirname(HERE), 'deye-dashboard')
js_files = []
for dirpath, dirnames, filenames in os.walk(SRC):
    dirnames[:] = [d for d in dirnames if not d.startswith('.')]
    js_files += [os.path.join(dirpath, f) for f in filenames if f.endswith('.js')]
check('the dashboard has the modules we expect', len(js_files) >= 15, f'{len(js_files)} files')
total = 0
missed = []
for path in js_files:
    with open(path, encoding='utf-8') as f:
        stamped_src, count = deploy.version_imports(f.read(), '9.9.9')
    total += count
    left = deploy.unversioned_imports(stamped_src)
    if left:
        missed.append((os.path.basename(path), left))
check('every relative import in the real sources gets stamped', missed == [], str(missed))
check('and there are plenty of them', total >= 40, f'{total} imports')

# Language is validated by argparse, not by string interpolation.
check('only known languages are offered', deploy.LANGUAGES == {'en', 'uk', 'auto'})

if failures:
    print(f'deploy.py: {len(failures)} of {passed + len(failures)} checks FAILED\n')
    for f in failures:
        print(f'  x {f}')
    sys.exit(1)
print(f'deploy.py: all {passed} checks passed')
