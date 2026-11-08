# Одитни събития — каталог

> **Генериран документ.** Версия на кода: **0.69.204**. Пише се от
> `node scripts/audit-events.cjs`, проверява се от `tests/audit-events.cjs`.
> Списъкът се чете от самите извиквания на `audit(...)` в `hapi_enterprise/` — ръчна
> редакция се губи при следващото генериране.

Общо: **188** събития, излъчвани от **19** файла.
От тях **9** не спазват конвенцията „малки букви с точки“ (наследство — виж §3).

## 1. Събития по име

| Събитие | Къде се излъчва |
| ------- | --------------- |
| `attachment.create` | `hapi_enterprise/server.js` |
| `attachment.delete` | `hapi_enterprise/server.js` |
| `attachment.download` | `hapi_enterprise/server.js` |
| `audit.export` | `hapi_enterprise/server.js` |
| `auth.login` | `hapi_enterprise/server.js` |
| `auth.login_failed` | `hapi_enterprise/server.js` |
| `auth.oidc.denied` | `hapi_enterprise/routes/oidc.js` |
| `auth.oidc.failed` | `hapi_enterprise/routes/oidc.js` |
| `auth.oidc.login` | `hapi_enterprise/routes/oidc.js` |
| `auth.oidc.start` | `hapi_enterprise/routes/oidc.js` |
| `backup.mirror.created` | `hapi_enterprise/server.js` |
| `backup.mirror.mismatch` | `hapi_enterprise/server.js` |
| `backup.schedule.run` | `hapi_enterprise/server.js` |
| `backup.schedule.updated` | `hapi_enterprise/server.js` |
| `cabinet.convert` | `hapi_enterprise/server.js` |
| `cabinet.create` | `hapi_enterprise/server.js` |
| `cabinet.delete` | `hapi_enterprise/server.js` |
| `cabinet.folder` | `hapi_enterprise/server.js` |
| `cabinet.rename` | `hapi_enterprise/server.js` |
| `cabinet.save` | `hapi_enterprise/server.js` |
| `cabinet.upload` | `hapi_enterprise/server.js` |
| `case.add` | `hapi_enterprise/server.js` |
| `case.remove` | `hapi_enterprise/server.js` |
| `case.update` | `hapi_enterprise/server.js` |
| `config.profile.applied` | `hapi_enterprise/server.js` |
| `config.profile.deleted` | `hapi_enterprise/server.js` |
| `config.profile.saved` | `hapi_enterprise/server.js` |
| `core.group.create` | `hapi_enterprise/server.js` |
| `core.group.delete` | `hapi_enterprise/server.js` |
| `core.group.update` | `hapi_enterprise/server.js` |
| `core.migrate` | `hapi_enterprise/server.js` |
| `core.record.associate` | `hapi_enterprise/server.js` |
| `core.record.create` | `hapi_enterprise/server.js` |
| `core.record.delete` | `hapi_enterprise/server.js` |
| `core.record.detach` | `hapi_enterprise/server.js` |
| `core.record.update` | `hapi_enterprise/server.js` |
| `database_backup_created` | `hapi_enterprise/server.js` |
| `database_restored` | `hapi_enterprise/server.js` |
| `directory.conflict.resolve` | `hapi_enterprise/server.js` |
| `directory.contact.add` | `hapi_enterprise/server.js` |
| `directory.ingest` | `hapi_enterprise/server.js` |
| `directory.organization.add` | `hapi_enterprise/server.js` |
| `directory.organization.remove` | `hapi_enterprise/server.js` |
| `directory.organization.update` | `hapi_enterprise/server.js` |
| `directory.rule.add` | `hapi_enterprise/server.js` |
| `directory.rule.remove` | `hapi_enterprise/server.js` |
| `evidence-portal.deploy` | `hapi_enterprise/server.js` |
| `evidence.assign` | `hapi_enterprise/routes/evidence.js` |
| `exif.compare` | `hapi_enterprise/routes/forensic.js` |
| `exif.read` | `hapi_enterprise/routes/forensic.js` |
| `file.copy` | `hapi_enterprise/routes/file-transfer.js` |
| `file.delete` | `hapi_enterprise/server.js` |
| `file.delete.refused` | `hapi_enterprise/server.js` |
| `file.download` | `hapi_enterprise/server.js` |
| `file.download.admin` | `hapi_enterprise/server.js` |
| `file.hashes` | `hapi_enterprise/server.js` |
| `file.key.create` | `hapi_enterprise/server.js` |
| `file.key.revoke` | `hapi_enterprise/server.js` |
| `file.lock` | `hapi_enterprise/server.js` |
| `file.metadata` | `hapi_enterprise/server.js` |
| `file.mirror.failed` | `hapi_enterprise/server.js` |
| `file.mirror.locked` | `hapi_enterprise/server.js` |
| `file.mirror.restored` | `hapi_enterprise/server.js` |
| `file.move` | `hapi_enterprise/routes/file-transfer.js` |
| `file.policy` | `hapi_enterprise/server.js` |
| `file.policy.bulk` | `hapi_enterprise/server.js` |
| `file.register.storage` | `hapi_enterprise/server.js` |
| `file.rename` | `hapi_enterprise/server.js` |
| `file.send.access` | `hapi_enterprise/server.js` |
| `file.send.create` | `hapi_enterprise/server.js` |
| `file.send.denied` | `hapi_enterprise/server.js` |
| `file.send.download` | `hapi_enterprise/server.js` |
| `file.send.revoke` | `hapi_enterprise/server.js` |
| `file.sign` | `hapi_enterprise/server.js` |
| `file.unlock` | `hapi_enterprise/server.js` |
| `file.upload` | `hapi_enterprise/server.js` |
| `file.version.download` | `hapi_enterprise/server.js` |
| `file.version.restore` | `hapi_enterprise/server.js` |
| `file.version.upload` | `hapi_enterprise/server.js` |
| `folder.api` | `hapi_enterprise/server.js` |
| `forensic.analyze` | `hapi_enterprise/routes/forensic.js` |
| `gateway.download` | `hapi_enterprise/server.js` |
| `gateway.download.denied` | `hapi_enterprise/server.js` |
| `generator.template.delete` | `hapi_enterprise/routes/generator.js` |
| `generator.template.save` | `hapi_enterprise/routes/generator.js` |
| `html.project.register` | `hapi_enterprise/server.js` |
| `html.project.unregister` | `hapi_enterprise/server.js` |
| `html.publish` | `hapi_enterprise/server.js` |
| `idempotency.conflict` | `hapi_enterprise/idempotency.js` |
| `idempotency.replay` | `hapi_enterprise/idempotency.js` |
| `integrity.failed` | `hapi_enterprise/routes/portal-qr.js` |
| `integrity.verify` | `hapi_enterprise/server.js` |
| `link.check` | `hapi_enterprise/routes/link-check.js` |
| `note.create` | `hapi_enterprise/server.js` |
| `note.delete` | `hapi_enterprise/server.js` |
| `note.update` | `hapi_enterprise/server.js` |
| `notify.dispatch` | `hapi_enterprise/server.js` |
| `package.build` | `hapi_enterprise/server.js` |
| `package.download` | `hapi_enterprise/server.js` |
| `package.public.build` | `hapi_enterprise/server.js` |
| `package.public.download` | `hapi_enterprise/server.js` |
| `package.settings` | `hapi_enterprise/server.js` |
| `package.signing.fallback` | `hapi_enterprise/server.js` |
| `package.verify` | `hapi_enterprise/server.js` |
| `pgp.bundle.import` | `hapi_enterprise/server.js` |
| `pgp.key.add` | `hapi_enterprise/server.js` |
| `pgp.key.import` | `hapi_enterprise/server.js` |
| `pgp.key.remove` | `hapi_enterprise/server.js` |
| `pgp.keyring.reload` | `hapi_enterprise/routes/pgp-keyring.js` |
| `pgp.paths.seal` | `hapi_enterprise/routes/pgp-keyring.js` |
| `pgp.sign` | `hapi_enterprise/pgp-sign.js` |
| `pgp.signatures.download` | `hapi_enterprise/routes/pgp-keyring.js` |
| `pgp.workdir.seal` | `hapi_enterprise/routes/pgp-keyring.js` |
| `portal.access.denied` | `hapi_enterprise/server.js` |
| `portal.acl.update` | `hapi_enterprise/routes/portal-tokens.js` |
| `portal.api.generate` | `hapi_enterprise/server.js` |
| `portal.api.remove` | `hapi_enterprise/server.js` |
| `portal.close` | `hapi_enterprise/routes/portal-archive.js` |
| `portal.delete` | `hapi_enterprise/routes/portal-archive.js` |
| `portal.delete.refused` | `hapi_enterprise/routes/portal-archive.js` |
| `portal.file.open` | `hapi_enterprise/routes/portal-storage.js` |
| `portal.merge` | `hapi_enterprise/server.js` |
| `portal.order.open` | `hapi_enterprise/routes/portal-storage.js` |
| `portal.purge` | `hapi_enterprise/routes/portal-archive.js` |
| `portal.restore` | `hapi_enterprise/routes/portal-archive.js` |
| `portal.session.issue` | `hapi_enterprise/routes/portal-tokens.js` |
| `portal.token.create` | `hapi_enterprise/routes/portal-tokens.js` |
| `portal.token.denied` | `hapi_enterprise/routes/portal-tokens.js` |
| `portal.token.revoke` | `hapi_enterprise/routes/portal-tokens.js` |
| `portal.tree` | `hapi_enterprise/server.js` |
| `portal.tree.api` | `hapi_enterprise/server.js` |
| `portal.tree.comment` | `hapi_enterprise/server.js` |
| `portal.tree.file.download` | `hapi_enterprise/routes/portal-storage.js` |
| `portal.tree.folder` | `hapi_enterprise/routes/folders.js` |
| `portal.tree.folder.delete` | `hapi_enterprise/routes/folders.js` |
| `portal.tree.folder.meta` | `hapi_enterprise/routes/folders.js` |
| `portal.tree.upload` | `hapi_enterprise/server.js` |
| `portal.update` | `hapi_enterprise/server.js` |
| `qr_artifact_created` | `hapi_enterprise/server.js` |
| `qr_artifact_revoked` | `hapi_enterprise/server.js` |
| `qr.archive.download` | `hapi_enterprise/routes/portal-storage.js` |
| `qr.archive.verify.failed` | `hapi_enterprise/routes/portal-qr.js` |
| `qr.archived` | `hapi_enterprise/routes/portal-qr.js` |
| `qr.blocked` | `hapi_enterprise/routes/portal-qr.js` |
| `qr.blocked.view` | `hapi_enterprise/routes/portal-storage.js` |
| `qr.restore.refused` | `hapi_enterprise/routes/portal-qr.js` |
| `qr.restored` | `hapi_enterprise/routes/portal-qr.js` |
| `report.package` | `hapi_enterprise/routes/reports.js` |
| `report.render` | `hapi_enterprise/routes/reports.js` |
| `report.sign` | `hapi_enterprise/routes/reports.js` |
| `report.tsa.` | `hapi_enterprise/routes/reports.js` |
| `retention.run` | `hapi_enterprise/server.js` |
| `retention.scheduled` | `hapi_enterprise/server.js` |
| `rfc3161.` | `hapi_enterprise/routes/reports.js` |
| `rfc3161.pruned` | `hapi_enterprise/server.js` |
| `secret.create` | `hapi_enterprise/server.js` |
| `secret.reveal` | `hapi_enterprise/server.js` |
| `secret.revoke` | `hapi_enterprise/server.js` |
| `sensors.settings` | `hapi_enterprise/server.js` |
| `sensors.visitor.forget` | `hapi_enterprise/server.js` |
| `settings_changed` | `hapi_enterprise/server.js` |
| `storage.check.failed` | `hapi_enterprise/server.js` |
| `storage.mirror.verify` | `hapi_enterprise/server.js` |
| `taxonomy.add` | `hapi_enterprise/server.js` |
| `taxonomy.remove` | `hapi_enterprise/server.js` |
| `url.revoke-all` | `hapi_enterprise/server.js` |
| `url.sign` | `hapi_enterprise/server.js` |
| `user.create` | `hapi_enterprise/server.js` |
| `user.delete` | `hapi_enterprise/server.js` |
| `user.update` | `hapi_enterprise/server.js` |
| `variable.add` | `hapi_enterprise/server.js` |
| `variable.remove` | `hapi_enterprise/server.js` |
| `variable.update` | `hapi_enterprise/server.js` |
| `webhook.created` | `hapi_enterprise/routes/webhooks.js` |
| `webhook.deleted` | `hapi_enterprise/routes/webhooks.js` |
| `webhook.disabled` | `hapi_enterprise/routes/webhooks.js` |
| `webhook.enabled` | `hapi_enterprise/routes/webhooks.js` |
| `webhook.exhausted` | `hapi_enterprise/webhooks.js` |
| `webhook.queued` | `hapi_enterprise/webhooks.js` |
| `webhook.removed` | `hapi_enterprise/webhooks.js` |
| `webhook.test` | `hapi_enterprise/webhooks.js` |
| `worm.seal.failed` | `hapi_enterprise/routes/portal-qr.js` |
| `worm.seal.missing` | `hapi_enterprise/worm.js` |
| `worm.sealed` | `hapi_enterprise/worm.js` |
| `worm.sealed.copy` | `hapi_enterprise/worm.js` |
| `worm.vault.problems` | `hapi_enterprise/worm.js` |
| `worm.vault.restored` | `hapi_enterprise/worm.js` |
| `worm.verify.failed` | `hapi_enterprise/worm.js` |

## 2. Защо това е договор, а не списък

Одитната верига е hash-chained: всеки ред носи `prevHash` на предишния, така че подмяна
или изтриване се вижда без доверена трета страна. Името на събитието е ключът, по който
проверяващият търси „кой е натиснал Изтрий“, затова то не бива да се сменя тихо — смяна на
име е промяна в договора и се записва в CHANGELOG.

## 3. Имена извън конвенцията (наследство)

Тези имена са от по-ранни версии и остават, за да не се чупят съществуващи вериги.
Нови събития се добавят само във формата `област.действие`.

| Събитие | Къде се излъчва |
| ------- | --------------- |
| `database_backup_created` | `hapi_enterprise/server.js` |
| `database_restored` | `hapi_enterprise/server.js` |
| `evidence-portal.deploy` | `hapi_enterprise/server.js` |
| `qr_artifact_created` | `hapi_enterprise/server.js` |
| `qr_artifact_revoked` | `hapi_enterprise/server.js` |
| `report.tsa.` | `hapi_enterprise/routes/reports.js` |
| `rfc3161.` | `hapi_enterprise/routes/reports.js` |
| `settings_changed` | `hapi_enterprise/server.js` |
| `url.revoke-all` | `hapi_enterprise/server.js` |
