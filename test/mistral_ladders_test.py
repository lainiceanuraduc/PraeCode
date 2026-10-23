"""Per-model Mistral ladders: the catalog, and what the plugin actually puts on the wire."""
import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).parents[1]
PLUGIN = ROOT / 'hermes-plugin' / 'mistral'

spec = importlib.util.spec_from_file_location('radcode_control', ROOT / 'bridge/control.py')
control = importlib.util.module_from_spec(spec)
spec.loader.exec_module(control)

# The plugin imports `providers`/`agent`, which exist inside Hermes' runtime (this suite runs there).
sys.path.insert(0, str(PLUGIN))
ladders = importlib.import_module('mistral_ladders')


def catalog(model, provider='mistral', base=''):
    return control.EffortCatalog().resolve(provider, model, base)


class LadderTableTest(unittest.TestCase):
    def test_two_level_family(self):
        for model in ('mistral-large-4', 'mistral-medium-latest', 'mistral-small-latest',
                      'magistral-medium-latest', 'mistral-vibe-cli-latest'):
            self.assertEqual(ladders.efforts_for_model(model), ('none', 'high'), model)

    def test_glm_on_mistral_has_no_off_switch(self):
        for model in ('zai-glm-5', 'zai-glm-5-3', 'zai-glm-5-3-flash', 'zai-glm-latest'):
            self.assertEqual(ladders.efforts_for_model(model), ('low', 'high', 'max'), model)

    def test_glm_52_accepts_the_full_ladder(self):
        for model in ('glm-5-2', 'zai-glm-5-2'):
            self.assertIn('xhigh', ladders.efforts_for_model(model), model)
            self.assertIn('none', ladders.efforts_for_model(model), model)

    def test_reasoning_disabled_family_is_empty_not_two_level(self):
        for model in ('mistral-large-latest', 'mistral-large-2512', 'ministral-8b-latest',
                      'codestral-latest', 'mistral-code-latest', 'voxtral-small-latest'):
            self.assertEqual(ladders.efforts_for_model(model), (), model)

    def test_large_latest_is_large_3_and_differs_from_large_4(self):
        self.assertEqual(ladders.efforts_for_model('mistral-large-latest'), ())
        self.assertEqual(ladders.efforts_for_model('mistral-large-4'), ('none', 'high'))

    def test_unknown_id_is_none_not_empty(self):
        self.assertIsNone(ladders.efforts_for_model('mistral-large-5'))
        self.assertIsNone(ladders.efforts_for_model(''))

    def test_vendor_prefix_is_stripped(self):
        self.assertEqual(ladders.efforts_for_model('mistralai/mistral-large-4'), ('none', 'high'))


class CatalogPerModelTest(unittest.TestCase):
    def test_catalog_follows_the_table(self):
        self.assertEqual(catalog('zai-glm-5-3')['values'], ['low', 'high', 'max'])
        self.assertEqual(catalog('glm-5-2')['values'],
                         ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
        self.assertEqual(catalog('ministral-8b-latest')['values'], [])

    def test_disabled_model_says_why(self):
        note = catalog('mistral-large-latest')['note']
        self.assertIn('no reasoning controls', note)

    def test_unverified_model_offers_nothing_on_the_native_route(self):
        result = catalog('mistral-large-5')
        self.assertEqual(result['values'], [])
        self.assertIn('not been verified', result['note'])

    def test_glm_through_a_custom_base_url_on_mistral_is_still_mistral(self):
        # A session may report provider "custom" with the Mistral host; the route decides.
        self.assertEqual(catalog('zai-glm-5-3', 'custom', 'https://api.mistral.ai/v1')['values'],
                         ['low', 'high', 'max'])


class PluginWireTest(unittest.TestCase):
    """What matters on the wire: an unsupported level must be omitted, never sent."""

    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location('radcode_mistral_plugin', PLUGIN / '__init__.py')
        cls.plugin = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.plugin)
        cls.profile = cls.plugin.MistralProfile(name='mistral')

    def extras(self, model, effort=None, enabled=None):
        cfg = {}
        if effort is not None:
            cfg['effort'] = effort
        if enabled is not None:
            cfg['enabled'] = enabled
        return self.profile.build_api_kwargs_extras(reasoning_config=cfg, model=model)[1]

    def test_disabled_model_never_receives_the_field(self):
        for model in ('ministral-8b-latest', 'codestral-latest', 'mistral-large-latest'):
            self.assertEqual(self.extras(model, effort='high'), {}, model)
            self.assertEqual(self.extras(model, effort='none'), {}, model)
            self.assertEqual(self.extras(model, enabled=False), {}, model)

    def test_two_level_model_sends_only_none_or_high(self):
        self.assertEqual(self.extras('mistral-large-4', effort='high'), {'reasoning_effort': 'high'})
        # Hermes' clamp never silently disables reasoning: a request for an unavailable low level
        # lands on the nearest *enabled* level (high), not on "none".
        self.assertEqual(self.extras('mistral-large-4', effort='low'), {'reasoning_effort': 'high'})
        # An explicit disable is honoured, because "none" is a real level on this model.
        self.assertEqual(self.extras('mistral-large-4', enabled=False), {'reasoning_effort': 'none'})

    def test_glm_never_receives_none(self):
        # 'none' is not a level on this route, so it lands on the model's floor (low) rather than
        # being sent raw; an explicit disable is dropped because the field cannot express it.
        self.assertEqual(self.extras('zai-glm-5-3', effort='none'), {'reasoning_effort': 'low'})
        self.assertEqual(self.extras('zai-glm-5-3', enabled=False), {})
        self.assertEqual(self.extras('zai-glm-5-3', effort='max'), {'reasoning_effort': 'max'})

    def test_capability_declaration_matches_the_table(self):
        self.assertEqual(self.profile.supported_reasoning_efforts('ministral-8b-latest'), ())
        self.assertEqual(self.profile.supported_reasoning_efforts('zai-glm-5-3'), ('low', 'high', 'max'))
        self.assertEqual(self.profile.supported_reasoning_efforts('mistral-large-4'), ('none', 'high'))
