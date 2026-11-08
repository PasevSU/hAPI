# Промени в hAPI Enterprise

Тази версия: **0.69.201**. Пълната история е в [CHANGELOG.md](https://github.com/PasevSU/hAPI/blob/main/CHANGELOG.md).

## 0.69.201

- **Документацията в add-on пакета вече описва новата карта на портала.** `hapi_enterprise/ui/README.md`
  е част от издадения архив (201 файла) и още описваше махнатия блок „Достъп и QR код“: блок
  `data-block="link"`, `#pf-portal-qr`, `#pf-open-portal`, `#pf-refresh-access`,
  `#pf-qr-download`, `#pf-qr-print`, `#pf-open-folder`. Сега разделът „Карта на портала“ описва
  действителния код: бутон `[data-qr-portal]` в заглавния ред (последен, тоест горе вдясно),
  панелче `[data-qr-pop]` с `position: absolute; right: var(--sp-4)` и връзка
  `.pf-qr-pop-link` към публичния портал; действията са в `.pf-portal-head-actions`.
  Същото е поправено и в ръководството `documentation/08_USER_GUIDES/portals-contacts-cases.md`
  (§2а и списъкът с действия по файла). Поведение не се променя — само текстове.
- **`KNOWN_DEFECTS.md`**: добавен е DEF-45 (картата на портала — блокът е махнат, QR кодът е
  бутон и връзка), затворен при 0.69.200.
