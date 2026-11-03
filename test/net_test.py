"""A credential must never follow a redirect to another host."""
import http.server
import importlib.util
import threading
from pathlib import Path
import unittest

BRIDGE = Path(__file__).parents[1] / 'bridge'


def load(name):
    spec = importlib.util.spec_from_file_location(name, BRIDGE / f'{name}.py')
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


net = load('net')


class _Recorder:
    """Tiny HTTP server that records what it received."""

    def __init__(self, handler_factory):
        self.seen = []
        outer = self

        class Handler(handler_factory):
            def log_message(self, *args):
                pass

            def do_GET(self):
                outer.seen.append({'path': self.path, 'auth': self.headers.get('Authorization')})
                self.respond()

        self.server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
        self.port = self.server.server_port
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


class RedirectTest(unittest.TestCase):
    def test_bearer_header_never_reaches_a_redirect_target(self):
        import urllib.request

        class Target(http.server.BaseHTTPRequestHandler):
            def respond(self):
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(b'{"data": [{"id": "leaked"}]}')

        target = _Recorder(Target)

        class Redirect(http.server.BaseHTTPRequestHandler):
            def respond(self):
                self.send_response(302)
                self.send_header('Location', f'http://127.0.0.1:{target.port}/v1/models')
                self.end_headers()

        redirect = _Recorder(Redirect)
        try:
            request = urllib.request.Request(f'http://127.0.0.1:{redirect.port}/v1/models',
                                             headers={'Authorization': 'Bearer SECRET'})
            with self.assertRaises(Exception) as caught:
                with net.open_once(request, timeout=5) as response:
                    response.read()
            self.assertIn('302', str(caught.exception))
            self.assertEqual(target.seen, [], 'the redirect target must never be contacted')
            self.assertEqual(len(redirect.seen), 1)
            self.assertEqual(redirect.seen[0]['auth'], 'Bearer SECRET')
        finally:
            redirect.close()
            target.close()

    def test_provider_probe_reports_a_redirect_instead_of_following_it(self):
        control = load('control')

        class Redirect(http.server.BaseHTTPRequestHandler):
            def respond(self):
                self.send_response(301)
                self.send_header('Location', 'http://127.0.0.1:9/v1/models')
                self.end_headers()

        server = _Recorder(Redirect)
        try:
            with self.assertRaises(RuntimeError) as caught:
                control.HermesSessionControl()._provider_models(f'http://127.0.0.1:{server.port}/v1', 'SECRET')
            message = str(caught.exception)
            self.assertIn('redirect', message.lower())
            self.assertNotIn('SECRET', message)
        finally:
            server.close()


if __name__ == '__main__':
    unittest.main()
