"""One-shot HTTP that refuses redirects.

A caller that attaches an `Authorization` header must not be redirected: urllib copies request
headers onto the follow-up request, so an endpoint could answer `302` to another host and receive the
credential. Every outbound request in this bridge therefore uses `open_once`, where a 3xx is surfaced
as an `HTTPError` instead of being followed.
"""
import urllib.error
import urllib.request


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """`redirect_request` returning None makes urllib raise HTTPError(code) for any 3xx."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D401 - protocol hook
        return None

_OPENER = urllib.request.build_opener(_NoRedirect)


def open_once(request, timeout=15):
    """Open exactly the URL in `request`; never a redirect target."""
    return _OPENER.open(request, timeout=timeout)


def describe_http_error(exc):
    """A short, credential-free description for a failed request."""
    if isinstance(exc, urllib.error.HTTPError):
        return f'HTTP {exc.code} from {getattr(exc, "url", "") or "endpoint"}'
    return str(exc)
