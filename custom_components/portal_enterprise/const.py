"""Constants for the hAPI Enterprise Home Assistant integration."""

DOMAIN = "portal_enterprise"
NAME = "hAPI Enterprise"

PLATFORMS = ["sensor"]

CONF_BACKEND_URL = "backend_url"
CONF_TOKEN = "token"
CONF_SCAN_INTERVAL = "scan_interval"

DEFAULT_SCAN_INTERVAL = 60
MIN_SCAN_INTERVAL = 10
MAX_SCAN_INTERVAL = 86400

# The admin API (`/admin/api/sensors`) is served on the ingress admin listener.
SENSORS_PATH = "/admin/api/sensors"
