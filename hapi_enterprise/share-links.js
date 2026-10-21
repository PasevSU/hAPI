'use strict';
// Share links за портал: NFC/QR таг за Home Assistant Companion + universal link.
//
// Форматите НЕ са измислени тук — двата шаблона са дословно от официалната
// документация на приложението (companion.home-assistant.io → Universal Links,
// NFC & QR Tags):
//   • таг — `https://www.home-assistant.io/tag/<tag id>`; Android/iOS разпознават
//     адреса и изпращат id-то към инстанцията, която вдига събитие `tag_scanned`.
//     Автоматизацията решава какво да прави (отваряне, нотификация, действие).
//   • universal link — `https://www.home-assistant.io/ios/nfc/?url=<адрес за URL
//     handler>`; отваря приложението и подава адреса на URL handler-а.
//
// Затова `nfc.write` по подразбиране е ТАГЪТ: той е документиран и работи на двете
// платформи, докато universal link-ът зависи от URL handler-а на приложението.
const TAG_BASE = 'https://www.home-assistant.io/tag/';
const UNIVERSAL_BASE = 'https://www.home-assistant.io/ios/nfc/?url=';
const DOCS = 'https://companion.home-assistant.io/docs/integrations/universal-links';
const crypto = require('node:crypto');

// Tag id-то трябва да е стабилно (един и същ стикер при всяко генериране) и да минава
// през URL без екраниране. Кирилица и интервали не се допускат — затова остава само
// `[a-z0-9-]`, а накрая слагаме кратък хеш от ИСТИНСКИЯ slug: без него „Дело 2026“ и
// „Договор 2026“ дават едно и също `hapi-2026` и сканирането на единия стикер щеше да
// вдига автоматизацията на другия.
function tagId(slug) {
  const raw = String(slug == null ? '' : slug).trim();
  const normalized = raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  const digest = crypto.createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 8);
  return ('hapi-' + (normalized || 'portal')).slice(0, 55) + '-' + digest;
}

function tagUrl(id) {
  return TAG_BASE + encodeURIComponent(id);
}

function universalUrl(target) {
  return UNIVERSAL_BASE + encodeURIComponent(String(target == null ? '' : target));
}

// YAML низ в двойни кавички: обратната наклонена черта и кавичката се екранират,
// управляващите знаци се махат — иначе генерираната автоматизация не се парсва.
function yamlString(value) {
  return (
    '"' +
    String(value == null ? '' : value)
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"') +
    '"'
  );
}

// Готова автоматизация за `tag_scanned`: човекът я поставя в automations.yaml или
// я въвежда през UI редактора. Действието е нотификация с линка — очевидно и лесно
// заменимо с каквото реално му трябва.
function automation({ tagId: id, title, url }) {
  const name = String(title || 'портал');
  return [
    '# hAPI: сканиран таг отваря портала (постави в automations.yaml).',
    'alias: ' + yamlString('hAPI — ' + name),
    'description: ' + yamlString('Сканиран NFC таг или QR код на hAPI (' + id + ').'),
    'trigger:',
    '  - platform: tag',
    '    tag_id: ' + yamlString(id),
    'action:',
    '  - service: persistent_notification.create',
    '    data:',
    '      title: ' + yamlString('hAPI — ' + name),
    '      message: ' + yamlString(url),
    'mode: single',
  ].join('\n');
}

/**
 * Сглобява всички share адреси за един портал.
 * @param {{slug:string, title?:string, landingUrl:string}} input
 */
function build({ slug, title, landingUrl } = {}) {
  const id = tagId(slug);
  const landing = String(landingUrl || '');
  return {
    tag: { id, url: tagUrl(id), event: 'tag_scanned' },
    universal: { target: landing, url: universalUrl(landing) },
    nfc: {
      // Какво се записва на стикера (Settings → Companion App → NFC Cards → Write).
      write: tagUrl(id),
      mode: 'tag',
      // Алтернативата отваря приложението през URL handler-а; зависи от приложението,
      // затова не е default.
      alternative: universalUrl(landing),
    },
    automation: automation({ tagId: id, title, url: landing }),
    docs: DOCS,
  };
}

module.exports = { build, tagId, tagUrl, universalUrl, automation, yamlString, TAG_BASE, UNIVERSAL_BASE, DOCS };
