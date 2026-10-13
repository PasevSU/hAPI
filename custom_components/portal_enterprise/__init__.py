"""hAPI Enterprise Home Assistant integration.

Provides two opt-in features:

1. A fail-closed HTTP bridge for token-protected portal APIs (YAML configured):
   portal_enterprise:
     backend_url: http://<addon-hostname>:8099
   Only portal-scoped read and download requests are forwarded. Admin APIs are
   never proxied by this bridge.

2. Telemetry sensors configured through the UI (config/options flow), polling
   the add-on admin API with a user-supplied admin token.
"""
from __future__ import annotations

import logging
import re
from datetime import timedelta
from pathlib import Path

from aiohttp import ClientError, web
from homeassistant.components.http import HomeAssistantView
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import (
    CONF_BACKEND_URL,
    CONF_SCAN_INTERVAL,
    CONF_TOKEN,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
    PLATFORMS,
)
from .coordinator import PortalEnterpriseCoordinator

_LOGGER = logging.getLogger(__name__)

_ALLOWED = re.compile(r"^p/([a-z0-9][a-z0-9-]{0,62})(?:/(?:files(?:/[a-f0-9]{24}(?:/download)?)?|manifest|openapi\.json))?$")

async def async_setup(hass, config):
    settings = config.get(DOMAIN, {})
    backend = settings.get("backend_url", "")
    # Fail closed: never proxy to an arbitrary host from a user request.
    if not isinstance(backend, str) or not re.fullmatch(r"http://[a-zA-Z0-9_.-]+:[0-9]{2,5}", backend):
        if isinstance(backend, str) and backend.strip():
            _LOGGER.warning(
                "Ignoring invalid portal_enterprise backend_url in "
                "configuration.yaml; configure the integration from the UI instead"
            )
        # Returning True keeps UI-driven (config flow) setup working even when
        # no legacy YAML bridge is configured.
        return True

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


def _entry_settings(entry: ConfigEntry) -> tuple[str, str, int]:
    """Resolve effective settings, with options overriding data."""
    settings = {**entry.data, **entry.options}
    backend_url = str(settings.get(CONF_BACKEND_URL, "")).strip().rstrip("/")
    token = str(settings.get(CONF_TOKEN, "")).strip()
    try:
        scan_interval = int(settings.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL))
    except (TypeError, ValueError):
        scan_interval = DEFAULT_SCAN_INTERVAL
    return backend_url, token, scan_interval


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up the integration from a config entry."""
    backend_url, token, scan_interval = _entry_settings(entry)
    coordinator = PortalEnterpriseCoordinator(hass, backend_url, token, scan_interval)
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator
    await coordinator.async_config_entry_first_refresh()
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    if unload_ok := await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
    return unload_ok


async def async_update_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Handle an options update by refreshing the coordinator in place."""
    backend_url, token, scan_interval = _entry_settings(entry)
    data = hass.data.setdefault(DOMAIN, {}).get(entry.entry_id)
    if not isinstance(data, PortalEnterpriseCoordinator):
        return
    data.backend_url = backend_url
    data.token = token
    data.update_interval = timedelta(seconds=scan_interval)
    await data.async_request_refresh()
