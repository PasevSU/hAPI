"""Opt-in Home Assistant HTTP bridge for token-protected portal APIs.

Configuration.yaml example:
portal_enterprise:
  backend_url: http://<addon-hostname>:8099

Only portal-scoped read and download requests are forwarded. Admin APIs are never proxied.
"""
from __future__ import annotations
import re
from pathlib import Path
from urllib.parse import quote
from aiohttp import ClientError, web
from homeassistant.components.http import HomeAssistantView
from homeassistant.helpers.aiohttp_client import async_get_clientsession

DOMAIN = "portal_enterprise"
_ALLOWED = re.compile(r"^p/([a-z0-9][a-z0-9-]{0,62})(?:/(?:files(?:/[a-f0-9]{24}(?:/download)?)?|manifest|openapi\.json))?$")

async def async_setup(hass, config):
    settings = config.get(DOMAIN, {})
    backend = settings.get("backend_url", "")
    # Fail closed: never proxy to an arbitrary host from a user request.
    if not isinstance(backend, str) or not re.fullmatch(r"http://[a-zA-Z0-9_.-]+:[0-9]{2,5}", backend):
        return False

    class PortalAPI(HomeAssistantView):
        url = "/api/portal_enterprise/v1/{tail:.*}"
        name = "api:portal_enterprise:public"
        requires_auth = False  # Explicit portal API key authorization is enforced by the Node backend.

        async def get(self, request, tail):
            if not _ALLOWED.fullmatch(tail):
                raise web.HTTPNotFound()
            # No HA Authorization header is forwarded. Portal key is sent as a separate header.
            portal_key = request.headers.get("X-Portal-Key", "")
            file_key = request.headers.get("X-File-Key", "")
            if not portal_key or len(portal_key) > 512 or len(file_key) > 512:
                raise web.HTTPUnauthorized()
            headers = {"Authorization": "Bearer " + portal_key}
            if file_key:
                headers["X-File-Key"] = file_key
            # Preserve resumable downloads end-to-end. The Node backend validates ranges.
            if request.headers.get("Range"):
                headers["Range"] = request.headers["Range"]
            if request.headers.get("If-Range"):
                headers["If-Range"] = request.headers["If-Range"]
            url = backend + "/api/v1/" + tail
            # Query params are forwarded only for pagination/filtering; portal_token is deliberately not accepted.
            allowed = {"q", "limit", "offset", "order", "direction", "category", "group", "topic", "tag"}
            params = [(k, v) for k, v in request.query.items() if k in allowed]
            session = async_get_clientsession(hass)
            try:
                async with session.get(url, headers=headers, params=params, timeout=120, allow_redirects=False) as upstream:
                    content_type = upstream.headers.get("Content-Type", "application/octet-stream")
                    response = web.StreamResponse(status=upstream.status, headers={
                        "Content-Type": content_type,
                        "Cache-Control": "no-store",
                        "X-Content-Type-Options": "nosniff",
                        "Referrer-Policy": "no-referrer",
                    })
                    for field in ("Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified"):
                        if upstream.headers.get(field):
                            response.headers[field] = upstream.headers[field]
                    if upstream.headers.get("Content-Disposition"):
                        response.headers["Content-Disposition"] = upstream.headers["Content-Disposition"]
                    await response.prepare(request)
                    async for chunk in upstream.content.iter_chunked(65536):
                        await response.write(chunk)
                    await response.write_eof()
                    return response
            except (ClientError, TimeoutError):
                raise web.HTTPBadGateway()

    class PortalPage(HomeAssistantView):
        url = "/api/portal_enterprise/portal/{slug}"
        name = "api:portal_enterprise:page"
        requires_auth = False

        async def get(self, request, slug):
            if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,62}", slug):
                raise web.HTTPNotFound()
            # This page contains no credentials. The browser sends the fragment token
            # in X-Portal-Key; backend validates it on every catalog/download request.
            content = (Path(__file__).parent / "portal.html").read_text(encoding="utf-8")
            return web.Response(text=content, content_type="text/html", headers={
                "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
                "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
                "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
            })

    class PortalAsset(HomeAssistantView):
        url = "/api/portal_enterprise/assets/{asset}"
        name = "api:portal_enterprise:asset"
        requires_auth = False

        async def get(self, request, asset):
            if asset not in ("portal.js", "portal.css"):
                raise web.HTTPNotFound()
            content = (Path(__file__).parent / asset).read_text(encoding="utf-8")
            return web.Response(text=content, content_type="application/javascript" if asset.endswith(".js") else "text/css", headers={
                "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
            })

    hass.http.register_view(PortalPage())
    hass.http.register_view(PortalAsset())
    hass.http.register_view(PortalAPI())
    return True
