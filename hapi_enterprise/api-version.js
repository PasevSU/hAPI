'use strict';
// Версиониране на API (Фаза 2.5): v2 е текущ, v1 (legacy) продължава да работи,
// но е маркиран като deprecated чрез стандартни HTTP заглавки (RFC 8594 / draft).
const SUNSET = '2027-12-31';
const VERSION = { CURRENT: 'v2', LEGACY: 'v1' };

function headers(url) {
  const p = url && url.pathname || '';
  if (p.startsWith('/admin/api/v2')) {
    return { 'X-API-Version': VERSION.CURRENT };
  }
  // Публичната повърхност (gateway на add-on-а и HA-hosted адресът) е v1 и НЕ е deprecated.
  if (p.startsWith('/api/public/v1') || p.startsWith('/api/hapi_enterprise/public/v1')) {
    return { 'X-API-Version': VERSION.LEGACY };
  }
  if (p.startsWith('/admin/api') || p.startsWith('/api/v1')) {
    return { 'X-API-Version': VERSION.LEGACY, 'Deprecation': 'true', 'Sunset': SUNSET };
  }
  return {};
}

module.exports = { headers, SUNSET, VERSION };
