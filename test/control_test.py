import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('radcode_control', Path(__file__).parents[1] / 'bridge/control.py')
control = importlib.util.module_from_spec(spec)
spec.loader.exec_module(control)

class CapabilitiesTest(unittest.TestCase):
    def test_codex_uses_installed_model_specific_ladder(self):
        from agent.reasoning_effort import codex_supported_efforts
        for model in ('gpt-5.4', 'gpt-6-astra'):
            result = control.EffortCatalog().resolve('openai-codex', model)
            self.assertEqual(result['values'], list(codex_supported_efforts(model)))
        self.assertNotIn('none', control.EffortCatalog().resolve('openai-codex', 'gpt-6-astra')['values'])

    def test_unknown_provider_does_not_invent_capabilities(self):
        result = control.EffortCatalog().resolve('not-a-real-provider', 'unknown-model')
        self.assertEqual(result['values'], [])
        self.assertIn('Unknown', result['note'])

    def test_mistral_native_ladder_is_none_and_high(self):
        """Live probe 2026-10-23: every other level returns HTTP 400 listing [high, none]."""
        result = control.EffortCatalog().resolve('mistral', 'mistral-large-4')
        self.assertEqual(result['values'], ['none', 'high'])
        self.assertIn('Mistral', result['note'])

    def test_mistral_on_ollama_cloud_uses_the_wider_cloud_ladder(self):
        via_provider = control.EffortCatalog().resolve('ollama-cloud', 'mistral-large-4')
        self.assertEqual(via_provider['values'], ['none', 'low', 'medium', 'high'])
        via_host = control.EffortCatalog().resolve('whatever', 'mistral-large-4', base_url='https://ollama.com/v1')
        self.assertEqual(via_host['values'], ['none', 'low', 'medium', 'high'])

    def test_mistral_clamping_never_offers_a_rejected_level(self):
        for requested in ('minimal', 'low', 'medium', 'xhigh', 'max', 'ultra'):
            self.assertEqual(control.clamp_mistral(requested, cloud=False), 'high')
        self.assertEqual(control.clamp_mistral('none', cloud=False), 'none')
        self.assertEqual(control.clamp_mistral('max', cloud=True), 'high')

    def test_mistral_note_names_the_wire_gap_until_the_profile_is_installed(self):
        result = control.EffortCatalog().resolve('mistral', 'mistral-large-4')
        # Without hermes-plugin/mistral loaded, Hermes has no profile and drops the field entirely.
        from providers import get_provider_profile
        if get_provider_profile('mistral') is None:
            self.assertIn('hermes-plugin/mistral', result['note'])

    def test_output_filters_credentials(self):
        result = control.public_info({'model':'x','provider':'p','api_key':'NEVER-RETURN','credential_hint':'NEVER-RETURN','reasoning_effort':'high'}, {})
        self.assertNotIn('NEVER-RETURN', str(result))
        self.assertEqual(result['effort'], 'high')

if __name__ == '__main__': unittest.main()


class RenameTest(unittest.IsolatedAsyncioTestCase):
    async def test_rename_requests_title_and_rejects_blank(self):
        # The helper must refuse an empty title before it ever reaches the gateway.
        with self.assertRaises(ValueError):
            await control.HermesSessionControl()._rename('local-x', '   ')
        with self.assertRaises(ValueError):
            await control.HermesSessionControl()._rename('local-x', None)

    def test_rename_operation_is_metadata_not_a_generation_fence(self):
        # `/title` cannot be used from ACP (transient session), so rename must go through
        # session.mutate; the fenced set must not include it or a stale generation would refuse it.
        source = (Path(__file__).parents[1] / 'bridge/control.py').read_text()
        self.assertIn("operation='rename'", source)
        self.assertNotIn("'/title", source)
