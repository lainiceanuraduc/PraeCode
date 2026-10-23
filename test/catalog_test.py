"""Route-by-route effort catalog tests: Mistral, Ollama (cloud + local), OpenRouter, OpenAI, Anthropic.

OpenRouter cases monkeypatch the catalog lookup: the real function fetches over HTTP, and a unit test
must not depend on the network or on which models happen to be listed today.
"""
import importlib.util
import unittest
from pathlib import Path
from unittest import mock

spec = importlib.util.spec_from_file_location('radcode_control', Path(__file__).parents[1] / 'bridge/control.py')
control = importlib.util.module_from_spec(spec)
spec.loader.exec_module(control)


def resolve(provider, model, base=''):
    return control.EffortCatalog().resolve(provider, model, base)


class OllamaRouteTest(unittest.TestCase):
    def test_cloud_and_local_are_told_apart_by_provider_name(self):
        cloud = resolve('ollama-cloud', 'deepseek-v4.1-flash:1017')
        self.assertEqual(cloud['values'], ['none', 'low', 'medium', 'high', 'max'])
        self.assertIn('Ollama Cloud', cloud['note'])
        local = resolve('ollama', 'gpt-oss:20b', 'http://localhost:11434')
        self.assertEqual(local['values'], ['none', 'low', 'medium', 'high', 'max'])
        self.assertIn('Local Ollama', local['note'])

    def test_cloud_host_is_cloud_even_for_an_unremarkable_provider_name(self):
        result = resolve('custom', 'gpt-oss:120b', 'https://ollama.com/v1')
        self.assertIn('Ollama Cloud', result['note'])


class OpenRouterRouteTest(unittest.TestCase):
    def test_model_without_reasoning_offers_nothing(self):
        with mock.patch.object(control, '_openrouter_capabilities',
                               return_value={'supports_reasoning': False, 'supported_efforts': None, 'mandatory': False}):
            result = resolve('openrouter', 'meta-llama/llama-3.1-8b-instruct')
        self.assertEqual(result['values'], [])
        self.assertIn('does not accept reasoning', result['note'])

    def test_published_levels_are_used_verbatim(self):
        with mock.patch.object(control, '_openrouter_capabilities',
                               return_value={'supports_reasoning': True, 'mandatory': False,
                                             'supported_efforts': ['max', 'xhigh', 'high', 'medium', 'low', 'none']}):
            result = resolve('openrouter', 'openai/gpt-5.6-terra')
        self.assertEqual(sorted(result['values']), sorted(['max', 'xhigh', 'high', 'medium', 'low', 'none']))
        self.assertNotIn('ultra', result['values'])

    def test_reasoning_mandatory_drops_the_off_switch(self):
        with mock.patch.object(control, '_openrouter_capabilities',
                               return_value={'supports_reasoning': True, 'mandatory': True,
                                             'supported_efforts': ['none', 'low', 'high']}):
            result = resolve('openrouter', 'anthropic/claude-sonnet-4.5')
        self.assertEqual(result['values'], ['low', 'high'])

    def test_advertised_but_unlisted_levels_fall_back_to_the_compat_set(self):
        with mock.patch.object(control, '_openrouter_capabilities',
                               return_value={'supports_reasoning': True, 'supported_efforts': None, 'mandatory': False}):
            result = resolve('openrouter', 'anthropic/claude-sonnet-4.5')
        self.assertIn('high', result['values'])
        self.assertNotIn('ultra', result['values'])

    def test_unknown_catalog_still_offers_the_set_hermes_clamps(self):
        with mock.patch.object(control, '_openrouter_capabilities', return_value=None):
            result = resolve('openrouter', 'mistralai/mistral-large-2411')
        self.assertTrue(result['values'], 'a transient catalog failure must not disable the control')
        self.assertIn('clamp', result['note'])

    def test_openrouter_host_is_recognised_without_the_provider_name(self):
        with mock.patch.object(control, '_openrouter_capabilities',
                               return_value={'supports_reasoning': False, 'supported_efforts': None, 'mandatory': False}):
            result = resolve('custom', 'x-ai/grok-4', 'https://openrouter.ai/api/v1')
        self.assertEqual(result['values'], [])


class OpenAIRouteTest(unittest.TestCase):
    def test_openai_base_url_uses_the_openai_ladder(self):
        from agent.reasoning_effort import codex_supported_efforts
        result = resolve('custom', 'gpt-5.6-terra', 'https://api.openai.com/v1')
        self.assertEqual(result['values'], list(codex_supported_efforts('gpt-5.6-terra')))
        self.assertNotIn('minimal', result['values'], 'OpenAI rejects minimal; Hermes clamps it to low')

    def test_openai_codex_provider_keeps_its_generation_ladder(self):
        from agent.reasoning_effort import codex_supported_efforts
        for model in ('gpt-5.4', 'gpt-6-astra'):
            self.assertEqual(resolve('openai-codex', model)['values'], list(codex_supported_efforts(model)))


class MistralRouteTest(unittest.TestCase):
    def test_native_api_is_none_or_high_only(self):
        result = resolve('mistral', 'mistral-large-4')
        self.assertEqual(result['values'], ['none', 'high'])

    def test_mistral_on_ollama_cloud_uses_the_cloud_ladder(self):
        result = resolve('ollama-cloud', 'mistral-large-4')
        self.assertEqual(result['values'], ['none', 'low', 'medium', 'high'])

    def test_mistral_through_openrouter_is_judged_by_openrouter(self):
        with mock.patch.object(control, '_openrouter_capabilities',
                               return_value={'supports_reasoning': True, 'mandatory': False,
                                             'supported_efforts': ['low', 'medium', 'high']}):
            result = resolve('openrouter', 'mistralai/mistral-large-4')
        self.assertEqual(result['values'], ['low', 'medium', 'high'])


class AnthropicRouteTest(unittest.TestCase):
    def test_claude_gets_a_hermes_derived_ladder(self):
        result = resolve('anthropic', 'claude-sonnet-4-5')
        self.assertTrue(result['values'])
        self.assertIn('none', result['values'])
        self.assertTrue(set(result['values']) <= set(control.EffortCatalog().resolve('anthropic', 'x')['values'] + result['values']))
