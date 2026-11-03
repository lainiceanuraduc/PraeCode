"""Proves the bundled Mistral provider profile puts reasoning_effort on the wire.

No network and no edits to the user's Hermes config: the profile is registered in-process and the
real ChatCompletionsTransport kwargs builder is exercised.
"""
import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).parents[1]
PLUGIN = ROOT / 'hermes-plugin' / 'mistral' / '__init__.py'


def load_plugin():
    spec = importlib.util.spec_from_file_location('radcode_mistral_plugin', PLUGIN)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class MistralWireTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.plugin = load_plugin()
        from agent.transports.chat_completions import ChatCompletionsTransport
        from providers import get_provider_profile
        cls.transport = ChatCompletionsTransport()
        cls.profile = get_provider_profile('mistral')
        assert cls.profile is not None, 'Mistral profile did not register'

    def kwargs(self, effort, enabled=True):
        cfg = {'enabled': enabled} if effort is None else {'enabled': enabled, 'effort': effort}
        built = self.transport.build_kwargs(
            'mistral-large-4', [{'role': 'user', 'content': 'hi'}], None,
            base_url='https://api.mistral.ai/v1', provider_name='mistral', provider_profile=self.profile,
            reasoning_config=cfg, supports_reasoning=False, model_lower='mistral-large-4',
        )
        return built.get('reasoning_effort'), built.get('extra_body')

    def test_declares_only_the_supported_levels(self):
        self.assertEqual(list(self.profile.supported_reasoning_efforts('mistral-large-4')),
                         ['low', 'medium', 'high'])

    def test_sends_top_level_reasoning_effort_and_clamps_everything_else(self):
        expected = {'none': 'low', 'minimal': 'low', 'low': 'low', 'medium': 'medium',
                    'high': 'high', 'xhigh': 'high', 'max': 'high', 'ultra': 'high'}
        for requested, level in expected.items():
            effort, extra = self.kwargs(requested)
            self.assertEqual(effort, level, requested)
            self.assertFalse(extra, 'Mistral must not receive a nested reasoning object')

    def test_unset_effort_and_disable_both_omit_the_field(self):
        self.assertIsNone(self.kwargs(None)[0])
        # Large 4 has no "off" level, so a disable drops the field instead of sending one it rejects.
        self.assertIsNone(self.kwargs('high', enabled=False)[0])


if __name__ == '__main__':
    unittest.main()
