"""Mammouth catalog routing; no real credentials or profile writes."""
import importlib.util
import io
import json
from pathlib import Path
import unittest
import tempfile
import os
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('mammouth_control', Path(__file__).parents[1] / 'bridge/control.py')
assert spec and spec.loader
control = importlib.util.module_from_spec(spec)
spec.loader.exec_module(control)


class MammouthTest(unittest.TestCase):
    def test_public_catalog_is_separate_from_chat_base_and_never_receives_key(self):
        payload = {'data': [{'id': 'gpt-4.1'}, {'id': 'text-embedding-3-small'},
                            {'id': 'gpt-image-2'}, {'id': 'gemini-2.5-flash-image'},
                            {'id': 'gpt-4.1'}, {'id': ''}]}
        for base in ('https://api.mammouth.ai', 'https://api.mammouth.ai/v1/'):
            with self.subTest(base=base), patch('provider_save.endpoint.open_once', return_value=io.BytesIO(json.dumps(payload).encode())) as opened:
                models = control.HermesSessionControl()._provider_models(base, 'test-secret')
                self.assertEqual(opened.call_args.args[0].full_url, 'https://api.mammouth.ai/public/models')
                self.assertIsNone(opened.call_args.args[0].get_header('Authorization'))
                self.assertEqual(models, ['gpt-4.1'])


    def test_save_declares_catalog_for_hermes_restart_and_forces_chat_transport(self):
        config = {'unrelated': {'keep': True}}
        with tempfile.TemporaryDirectory() as home, patch.dict(os.environ, {'HERMES_HOME': home}), \
                patch('hermes_cli.config.load_config', return_value=config), \
                patch('hermes_cli.config.save_config') as saved, \
                patch('provider_save.endpoint.models', return_value=['gpt-4.1']):
            result = control.HermesSessionControl()._provider_save({
                'id': 'mammouth', 'label': 'Mammouth AI', 'baseUrl': 'https://api.mammouth.ai',
                'apiKey': 'test-not-a-real-key', 'defaultModel': ''})
            entry = saved.call_args.args[0]['providers']['mammouth']
            self.assertEqual(entry['base_url'], 'https://api.mammouth.ai/v1')
            self.assertEqual(entry['api_mode'], 'chat_completions')
            self.assertFalse(entry['discover_models'])
            self.assertEqual(entry['models'], ['gpt-4.1'])
            self.assertEqual(entry['default_model'], 'gpt-4.1')
            self.assertTrue(config['unrelated']['keep'])
            self.assertEqual(result['baseUrl'], entry['base_url'])
            self.assertNotIn('test-not-a-real-key', str(entry))
            from acp_adapter.model_catalog import _named_custom_provider_catalogs
            catalogs = _named_custom_provider_catalogs()
            self.assertTrue(any(('gpt-4.1', '') in models for _, _, models in catalogs), catalogs)


    def test_test_action_labels_public_discovery_as_not_authentication(self):
        import asyncio
        with patch('provider_save.endpoint.models', return_value=['gpt-4.1']):
            result = asyncio.run(control.HermesSessionControl().execute({
                'action': 'provider_test', 'baseUrl': 'https://api.mammouth.ai'}))
        self.assertTrue(result['ok'])
        self.assertTrue(result['catalogOnly'])

    def test_generic_endpoint_keeps_models_path_and_authentication(self):
        with patch('provider_save.endpoint.open_once', return_value=io.BytesIO(b'{"data":[{"id":"local-chat"}]}')) as opened:
            models = control.HermesSessionControl()._provider_models('http://localhost:11434/v1', 'test-key')
        self.assertEqual(models, ['local-chat'])
        self.assertEqual(opened.call_args.args[0].full_url, 'http://localhost:11434/v1/models')
        self.assertEqual(opened.call_args.args[0].get_header('Authorization'), 'Bearer test-key')

    def test_route_only_normalizes_the_official_api_root(self):
        for base in ('https://api.mammouth.ai', 'https://api.mammouth.ai/v1/'):
            self.assertEqual(control.provider_base_url(base), 'https://api.mammouth.ai/v1')
        for base in ('https://api.mammouth.ai.evil.test', 'http://api.mammouth.ai',
                     'https://api.mammouth.ai/proxy/v1', 'https://user@api.mammouth.ai',
                     'https://api.mammouth.ai:8443/v1'):
            self.assertFalse(control.mammouth_route(base))


    def test_failed_catalog_refresh_preserves_saved_models_and_manual_default(self):
        config = {'providers': {'mammouth': {'models': ['gpt-4.1'], 'key_env': 'MAMMOUTH_API_KEY'}}}
        with tempfile.TemporaryDirectory() as home, patch.dict(os.environ, {'HERMES_HOME': home}), \
                patch('hermes_cli.config.load_config', return_value=config), \
                patch('hermes_cli.config.save_config'), \
                patch('provider_save.endpoint.models', side_effect=RuntimeError('offline')):
            result = control.HermesSessionControl()._provider_save({
                'id': 'mammouth', 'baseUrl': 'https://api.mammouth.ai/v1', 'defaultModel': 'gpt-4.1'})
        self.assertIn('offline', result['warning'])
        self.assertEqual(config['providers']['mammouth']['models'], ['gpt-4.1'])
        self.assertEqual(config['providers']['mammouth']['key_env'], 'MAMMOUTH_API_KEY')
        self.assertEqual(config['providers']['mammouth']['default_model'], 'gpt-4.1')

    def test_bad_public_catalog_is_not_reported_as_success(self):
        import asyncio
        for payload in (b'{}', b'{"data":{}}', b'not-json'):
            with patch('provider_save.endpoint.open_once', return_value=io.BytesIO(payload)):
                result = asyncio.run(control.HermesSessionControl().execute({
                    'action': 'provider_test', 'baseUrl': 'https://api.mammouth.ai/v1'}))
            self.assertFalse(result['ok'])


if __name__ == '__main__':
    unittest.main()
