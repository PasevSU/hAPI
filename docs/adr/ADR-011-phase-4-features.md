# ADR-011: Решения за feature-ите от Фаза 4 (обработка на документи + QR/споделяне)

- **Status:** Accepted
- **Дата:** 2026-10-12

## Контекст
Фаза 4 добавя обработка на документи (предпреглед, thumbnails, версиониране,
водни знаци, PDF изображения/таблици, xlsx/pptx извличане) и QR/виртуална папка
(брандирана landing страница, отмяна/изтичане, изпращане чрез HA notify). Фаза 1–3
вече покриваха ядрото (store, registry, multi-tenancy, HMAC-SHA256). Документите
`08-master-plan-v5.0.md` (§8, §9, §9.1) и `10-phase-4-gap-closure.md` задават обхвата.

Изключено по решение на потребителя: генератор на документи (template engine) и
квалифицирани подписи (PKCS#7/CAdES/timestamping).

## Решение
Всеки Phase 4 feature е реализиран като интерфейс/модул, а не hard-coded:

- **Предпреглед (4.3)** — `preview.js` генерира версиониран предпреглед; конфиг
  `preview.enabled` го изключва; лимити (`maxPreviewBytes`, `previewTimeoutMs`)
  предотвратяват DoS.
- **PDF изображения + таблици** — `pdf-writer.js` поддържа блокове `image`
  (JPEG-only, DCTDecode XObject) и `table`; невалидните типове се отхвърлят с грешка.
- **Версиониране (4.3)** — `versioning` върху файловете; rollback през историята.
- **Шифроване at rest (4.2)** — AES-256-GCM по избор (`fileCrypto`), `x-file-encrypt`.
- **Retention + одит (4.2)** — `retention.js` (preview/apply, `fileAction`
  `disable`|`delete`) + `GET /admin/api/audit/export` (json/csv).
- **QR landing (4.4)** — `GET /qr/{qrId}` чете `manifest.json` от артефактната
  директория; `htmlEsc` против XSS; метаданните (organization/project/campaign)
  идват от runtime config.
- **QR отмяна/изтичане (4.4)** — `DELETE /admin/api/qr-artifacts/{qrId}` с rollback
  (`runtime.removeArtifacts`).
- **Изпращане (4.4)** — `notify.js` транспортира през HA Supervisor core API
  (`http://supervisor/core/api/services/{domain}/{service}`, Bearer `SUPERVISOR_TOKEN`);
  активира се само при `SUPERVISOR_TOKEN`; endpoint се заменя през `HAPI_NOTIFY_ENDPOINT`
  (тества се с mock).

## Последици
- Плюс: всеки feature е изключваем/сменяем, с интерфейс, със събитие (Event Bus/audit),
  с миграция+rollback и изолиран тест — изпълнен §9.1.
- Минус: малко повече модулна индирекция (например notify endpoint абстракция).

## Checklist за гъвкавост (§9.1)
- [x] Изключва се през config? — `preview.enabled`, `retention.enabled`, `SUPERVISOR_TOKEN`.
- [x] Заменя се с алтернатива? — notify endpoint, preview engine, storage (Repository).
- [x] Има интерфейс, не конкретна имплементация? — да (модули + интерфейси).
- [x] Излъчва събитие? — audit (`cabinet.upload`, `file.upload`, `qr.revoke` и др.).
- [x] Има миграция с rollback? — `runtime.removeArtifacts`, версиониране, retention apply.
- [x] Документиран е в ADR? — да (настоящият ADR + §9.1 матрица).
- [x] Тестван изолирано? — `office-processing.cjs`, `qr-dispatch.cjs`, `retention-audit.cjs`.
