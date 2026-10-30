"""Live check of the 0.1.33 Mistral discovery: docs vs API vs shipped seed."""
import json, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'hermes-plugin' / 'mistral'))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'bridge'))

import mistral_ladders as L

# The ladders the docs state, for the models the user linked.
DOCS = {
    'mistral-large-4': ('low', 'medium', 'high'),
    'mistral-large-4-0': ('low', 'medium', 'high'),
    'mistral-small-2603': ('none', 'high'),
    'mistral-small-latest': ('none', 'high'),
    'zai-glm-5-3': ('low', 'high', 'max'),
    'zai-glm-5-3-flash': ('low', 'high', 'max'),
    'deepseek-v4-1-flash-1017': ('none', 'low', 'high', 'xhigh', 'max'),
}
# Reasoning-off families the docs name.
DOCS_OFF = ('mistral-large-latest', 'codestral-latest', 'ministral-8b-latest', 'voxtral-small-latest')

failures = []
for model, expected in DOCS.items():
    got = L.static_ladder(model)
    if got != expected:
        failures.append(f'{model}: seed {got} != docs {expected}')
    else:
        print(f'ok   {model:28} seed={got}')
for model in DOCS_OFF:
    got = L.static_ladder(model)
    if got != ():
        failures.append(f'{model}: seed {got} != docs (no reasoning field)')
    else:
        print(f'ok   {model:28} seed=() (field omitted)')

# The refusal parser must read the list and never the rejected value.
CASES = [
    ("reasoning_effort none is not supported for this model, supported values: "
     "[<ReasoningEffort.high: 'high'>, <ReasoningEffort.low: 'low'>, <ReasoningEffort.medium: 'medium'>]",
     ('low', 'medium', 'high')),
    ("reasoning_effort='xhigh' is not supported for this model. Must be one of "
     "(<ReasoningEffort.none: 'none'>, <ReasoningEffort.high: 'high'>)", ('none', 'high')),
    ("reasoning_effort 'minimal' is not supported for this model; supported values: "
     "['none', 'low', 'high', 'xhigh', 'max']", ('none', 'low', 'high', 'xhigh', 'max')),
    ('{"message":"reasoning_effort is not enabled for this model"}', ()),
    ('{"message":"something else entirely"}', None),
]
for body, expected in CASES:
    got = L.parse_refusal(body)
    if got != expected:
        failures.append(f'parse_refusal -> {got}, expected {expected} for {body[:50]}')
    else:
        print(f'ok   parse_refusal {str(expected):44}')

# A cached discovery must win over the seed, and a stale one must not.
home = Path('/tmp/praecode-cache-test')
import shutil
shutil.rmtree(home, ignore_errors=True)
L.save_cache_entry('mistral-large-4', ('none', 'high'), 'probe', str(home))
assert L.efforts_for_model('mistral-large-4', str(home)) == ('none', 'high'), 'cache must win over the seed'
assert L.efforts_for_model('mistral-large-4', str(home), ) is not None
print('ok   cache overrides the seed')
payload = json.loads(L.cache_path(str(home)).read_text())
payload['models']['mistral-large-4']['checkedAt'] = time.time() - L.CACHE_TTL_SECONDS - 10
L.cache_path(str(home)).write_text(json.dumps(payload))
assert L.efforts_for_model('mistral-large-4', str(home)) == ('low', 'medium', 'high'), 'a stale entry must fall back to the seed'
print('ok   stale cache falls back to the seed')
L.cache_path(str(home)).write_text('{"version": 99, "models": {"mistral-large-4": {"levels": [], "checkedAt": 1e12}}}')
assert L.efforts_for_model('mistral-large-4', str(home)) == ('low', 'medium', 'high'), 'an unknown schema must be ignored'
print('ok   unknown cache schema is ignored')
shutil.rmtree(home, ignore_errors=True)

print()
if failures:
    print('FAILURES:')
    for f in failures:
        print(' -', f)
    sys.exit(1)
print('All doc/API/seed/cache checks passed.')
