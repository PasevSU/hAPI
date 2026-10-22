'use strict';
// ДЕМО данни за GUI-я. Живеят в JS, за да работи интерфейсът и през file://
// (без сървър и без fetch). `manifest.example.json` остава каноничното копие
// за тестовете — при промяна на манифеста се обновяват и двете.
//
// Версията: браузърът не може да прочете `config.yaml`, затова тя стои тук и е
// единственият източник за GUI-я (не се твърди на ръка в HTML-а или в панелите).
// `tests/ui-version.cjs` пази съответствието с `hapi_enterprise/config.yaml` и с
// `custom_components/hapi_enterprise/manifest.json` при всяко пускане на пакета.
window.HAPI_VERSION = '0.69.17';

window.HAPI_DATA = {
  manifest: {
    schemaVersion: 1,
    profile: 'forensic-full',
    page: { format: 'A4', orientation: 'portrait', marginsMm: [15, 15, 15, 15] },
    branding: { organization: 'PasevSU DEV', logo: 'brand/logo.png', qr: true },
    print: { pageNumbers: true, headerFooter: true, footerNote: 'NO TRUST — VERIFY EVERYTHING' },
    blocks: [
      { id: 'start', type: 'rfc3161-start', locked: true, label: 'RFC 3161 START' },
      {
        id: 'title',
        type: 'title',
        label: 'Титул & заглавна страница',
        value: 'ОТЧЕТ ЗА КРИМИНАЛИСТИЧЕН АНАЛИЗ',
        subtitle: 'PasevSU DEV — Enterprise Solution',
      },
      {
        id: 'sys',
        type: 'metadata',
        label: 'Системна информация',
        items: [
          { key: 'Операционна система', value: 'Windows 11 Pro' },
          { key: 'Хост', value: 'PASEVSU-DEV' },
          { key: 'Издаден от', value: 'hAPI Enterprise' },
        ],
      },
      {
        id: 'users',
        type: 'table',
        label: 'Потребителска информация',
        source: 'records:1001',
        columns: ['name', 'position', 'email'],
      },
      {
        id: 'storage',
        type: 'table',
        label: 'Обем / Съхранение',
        source: 'records:2000',
        columns: ['volume', 'file_system', 'size'],
      },
      {
        id: 'hashes',
        type: 'hash-table',
        label: 'Hash таблица',
        algorithms: ['CRC32', 'MD5', 'SHA1', 'SHA256', 'SHA512'],
      },
      {
        id: 'meta',
        type: 'table',
        label: 'Метаданни',
        source: 'variables:2000',
        columns: ['field', 'value', 'type'],
      },
      {
        id: 'proc',
        type: 'text',
        label: 'Процесна информация',
        value:
          'Всички операции по отчета са в обхвата между RFC 3161 START и RFC 3161 STOP. Без реален TSA отговор времевият печат не се издава.',
      },
      {
        id: 'sign',
        type: 'signature',
        label: 'Подпис на издателя',
        hint: 'SHA-256 — издава се само при реално генериране',
      },
      { id: 'qr', type: 'qr', label: 'QR код', value: 'https://example.invalid/report' },
      { id: 'stop', type: 'rfc3161-stop', locked: true, label: 'RFC 3161 STOP' },
    ],
  },
  portals: [
    {
      slug: 'chronoseal-vault',
      title: 'ChronoSeal-Vault',
      visibility: 'private',
      files: [
        { id: 'f1', name: 'protokol-2026-114.pdf', size: 1048576, topic: 'Дело 2026-114', category: 'Доказателства', group: 'Том 1' },
        { id: 'f2', name: 'dokazatelstvo-A.pdf', size: 734003, topic: 'Дело 2026-114', category: 'Доказателства', group: 'Том 1' },
        { id: 'f3', name: 'pokazaniya.docx', size: 184320, topic: 'Дело 2026-114', category: 'Показания' },
        { id: 'f4', name: 'README.txt', size: 1024 },
      ],
    },
    {
      slug: 'dew21-documents',
      title: 'DEW21 — документи',
      visibility: 'private',
      files: [
        { id: 'd1', name: 'dogovor-2026.pdf', size: 512000, topic: 'Договори', category: '2026' },
        { id: 'd2', name: 'faktura-0001.pdf', size: 96000, topic: 'Фактури', category: '2026' },
      ],
    },
    {
      slug: 'forensic-2026-114',
      title: 'Forensic — дело 2026-114',
      visibility: 'private',
      files: [
        { id: 'e1', name: 'hash-report.pdf', size: 289000, topic: 'Дело 2026-114', category: 'Експертизи' },
        { id: 'e2', name: 'chain-of-custody.json', size: 4096, topic: 'Дело 2026-114', category: 'Верига' },
      ],
    },
    {
      slug: 'public-notices',
      title: 'Public notices',
      visibility: 'public',
      files: [{ id: 'p1', name: 'notice-2026-01.pdf', size: 65536, topic: 'Публикации' }],
    },
  ],
  defaultBaseUrl: 'http://homeassistant.local:8099',
};

// Демо контакти (същата структура като /admin/api/directory → contacts).
window.HAPI_DATA.contacts = [
  {
    id: 'c1',
    email: 'maria.ivanova@example.bg',
    fields: {
      name: 'Мария Иванова',
      organization: 'Иванова Консулт ООД',
      department: 'Правен отдел',
      phone: '+359 88 123 4567',
      city: 'София',
      country: 'България',
    },
    createdAt: '2026-09-30T08:00:00.000Z',
  },
  {
    id: 'c2',
    email: 'office@dew21.example',
    fields: {
      name: 'DEW21 — канцелария',
      organization: 'DEW21 GmbH',
      department: 'Документооборот',
      phone: '+49 231 555 0100',
      city: 'Дортмунд',
      country: 'Германия',
    },
    createdAt: '2026-10-02T09:30:00.000Z',
  },
  {
    id: 'c3',
    email: 'expert@forensic.example',
    fields: {
      name: 'д-р Петър Стоянов',
      organization: 'Forensic Lab',
      department: 'Експертизи',
      phone: '+359 2 987 6543',
      city: 'Пловдив',
      country: 'България',
    },
    createdAt: '2026-10-05T10:15:00.000Z',
  },
];
window.HAPI_DATA.portals[0].contactId = 'c1';
window.HAPI_DATA.portals[1].contactId = 'c2';
window.HAPI_DATA.portals[2].contactId = 'c3';

// Демо дела (cases) — същата структура като /admin/api/cases.
window.HAPI_DATA.cases = [
  {
    id: 'k1',
    number: '2026-114',
    title: 'Дело 2026-114 — доказателства',
    category: 'Правни дела',
    subject: 'посещение на лице',
    contactId: 'c1',
    extras: [
      { key: 'Съд', value: 'Софийски градски съд' },
      { key: 'Статус', value: 'в ход' },
    ],
    createdAt: '2026-09-28T08:00:00.000Z',
  },
  {
    id: 'k2',
    number: 'DEW-2026-07',
    title: 'DEW21 — договор 2026',
    category: 'Договори',
    subject: 'доставка на документи',
    contactId: 'c2',
    extras: [{ key: 'Клиент №', value: 'DEW-4410' }],
    createdAt: '2026-10-01T09:00:00.000Z',
  },
  {
    id: 'k3',
    number: 'EXP-2026-114',
    title: 'Експертиза към дело 2026-114',
    category: 'Експертизи',
    subject: 'експертен доклад',
    contactId: 'c3',
    extras: [{ key: 'Водещ експерт', value: 'д-р Петър Стоянов' }],
    createdAt: '2026-10-04T10:30:00.000Z',
  },
];
window.HAPI_DATA.portals[0].caseId = 'k1';
window.HAPI_DATA.portals[1].caseId = 'k2';
window.HAPI_DATA.portals[2].caseId = 'k3';
