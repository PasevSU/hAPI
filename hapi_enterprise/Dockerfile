# Pin a Node runtime that includes the required node:sqlite DatabaseSync API.
# The Home Assistant Supervisor can build this add-on without relying on the
# variable Node version available in a generic BUILD_FROM base image.
#
# Multi-arch: the official `node:*` image is published for linux/amd64, linux/arm64 and
# linux/arm/v7, so the same Dockerfile builds on x86-64 servers, 64-bit Raspberry Pi OS
# (aarch64) and 32-bit Raspberry Pi OS (armv7). No --platform pin and no npm dependency:
# every dependency is a Node built-in. armhf/armv6 (Pi Zero/1) has no Node 22 build and is
# not claimed in config.yaml.
#
# ── ДВА ЕТАПА: npm НЕ СТИГА ДО ГОТОВИЯ ОБРАЗ ───────────────────────────────────────────
# Етап 1 е официалният `node:*` образ — той носи npm, npx и corepack. От него се взема
# САМО един файл: бинарникът `node`. Етап 2 е чист Alpine и не наследява нищо друго, тоест
# пакетите на npm не съществуват нито във файловата система, нито в историята на слоевете
# (точно това отчиташе Docker Scout: npm/tar 7.5.11, npm/brace-expansion, npm/ip-address —
# код, който никога не се изпълнява в add-on-а).
#
# Защо НЕ tarball от nodejs.org (опит от 0.69.211): адресите
# `node-vX-linux-<arch>-musl.tar.xz` НЕ съществуват за официалните издания — build-ът падаше
# с `curl: (22) 404` и на трите архитектури. Официалните Docker образи се строят за musl
# (Alpine) за всички три архитектури, затова бинарникът се взема оттам.
# Закачената версия е нарочна: плаващ таг прави изданието невъзпроизводимо.
ARG NODE_VERSION=22.23.2
FROM node:${NODE_VERSION}-alpine AS node

# Тагът е САМО `major.minor` (`alpine:3.24`), без кръпка. Четири порти го изискват точно
# така — `tests/docker-runtime.cjs`, `tests/ha-compatibility.cjs`, `tests/ha-support-matrix.cjs`,
# `tests/raspberrypi-compat.cjs` (`/^alpine:\d+\.\d+$/`) — защото кръпката се вдига от
# `apk upgrade --available` по-долу, а не от тага. Опитът от 0.69.222 с `alpine:3.24.5`
# даде 4 червени теста и паднал `verify-release` S04 при зелен код.
FROM alpine:3.24

# 1. Пакетите на Alpine се вдигат до актуалните поправки. `--available` не е украса: без
#    него `apk upgrade` подминава пакети, чиято произходна група е сменена между изданията
#    на Alpine, а точно така излизат поправките за zlib/musl/openssl. Docker Scout отчита
#    в БАЗОВИЯ минирутфс (alpine:3.24.4) 7 поправими находки — zlib 1.3.2-r1
#    (CVE-2026-4738, critical), musl 1.2.6-r3 (CVE-2026-107891, high) и пет в openssl
#    3.5.9-r0; точно този слой ги вдига до версиите от хранилището. Версиите се печатат,
#    за да е видимо в лога на build-а какво е влязло в готовия образ.
#    `libstdc++` е нужно на САМИЯ Node: официалният Alpine бинарник е динамично свързан
#    с него (без него `node` пада с „Error loading shared library libstdc++.so.6“).
RUN apk upgrade --no-cache --available \
 && apk add --no-cache libstdc++ \
 && (apk info -v zlib musl openssl libssl3 libcrypto3 libstdc++ || true) \
 && rm -rf /var/cache/apk/*

# 2. Node: ЕДИН файл от етап 1 — без npm, npx, corepack, без node_modules.
COPY --from=node /usr/local/bin/node /usr/local/bin/node

WORKDIR /app
# Сигурност на слоя: находките на Docker Scout идваха от две места — базовите пакети на
# Alpine и npm, който официалният Node образ носи със себе си. Затова:
#   • пакетите на Alpine се вдигат до актуалните поправки (стъпка 1 горе);
#   • от етап 1 се копира САМО бинарникът `node` (стъпка 2) — npm, npx и corepack
#     остават в изхвърления етап, тоест не съществуват в готовия образ.
# Пази го `tests/docker-runtime.cjs`: той иска точно едно `COPY --from=node`, което сочи
# само `/usr/local/bin/node`, и никакво копиране на `node_modules`/`npm`.
# Цената е, че build-ът не е байт-идентичен при повторение (заради `apk upgrade`). Това е
# съзнателно (сигурност пред пълна възпроизводимост) и е записано в CHANGELOG.
# Всички локални модули, които server.js изисква (пряко или през друг модул).
# tests/docker-runtime.cjs проверява списъка срещу реалните require-и.
COPY integrity.js api-registry.js api-spec.js api-version.js audit-chain.js body.js cabinet.js cases.js cms-sign.js config-profiles.js container.js core.js core-store.js crypto-options.js directory.js download-access.js download-stream.js error-log.js event-bus.js export-manager.js export-rules.js file-crypto.js gateway-api.js generator.js instance-lock.js interpolate.js job-manager.js links.js load-control.js logger.js migration-bridge.js mirror-target.js module-folder.js notify.js observer.js ooxml.js option-spec.js package-crypto.js packager.js page-version.js path-crypto.js paths.js pdf-writer.js pgp.js plugins.js portal-folder.js portal-access.js public-route-allowlist.js portal-policy.js portal-term.js portal-qr.js portal-view.js portal-links.js portal-integrity.js portal-skin.js pgp-tools.js pgp-sign.js content-id.js oidc.js decision-sensors.js layout.js preview.js process-guards.js public-gateway.js public-package.js qr-svg.js qrcode.js rbac.js readiness.js registry.js report-manifest.js report-package.js report-render.js report-stamp.js repository.js retention.js runtime-config.js secret-lock.js secret-links.js secret-page.js secret-view.js send.js server.js server-modules.js share-links.js shared-data.js signer.js sqlite-repository.js sqlite-store.js start.js static-etag.js storage-check.js storage-migrate.js storage-preflight.js storage-tree.js throttle.js tsa-client.js versioning.js virtual-storage.js visitor-intel.js workdir-crypto.js workdir-io.js workdir-migrate.js evidence-portal.js x509.js site-csp.js admin-api-spec.js problem.js idempotency.js respond.js webhooks.js event-stream.js worm.js exif.js forensic.js case-access.js /app/
# Целият публичен портал (страница, скрипт, стилове, речник) живее в своя папка —
# така се сменя дизайнът и опциите, без да се пипа останалият код на add-on-а.
COPY portal /app/portal/
COPY fonts /app/fonts/
COPY rules /app/rules/
# Версията на add-on-а се чете от ТОЗИ файл (единственият източник на истина), за да
# може работещият add-on да каже коя версия е — вместо да я твърди ръчно поддържан низ.
# Supervisor строи от същото копие, така че няма как да се разминат.
COPY config.yaml /app/config.yaml
# Манифестът за цялост: `start.js` сверява SHA-256 на критичните файлове с него при старт.
# Строи се при изданието от `scripts/integrity-manifest.cjs`; без него сверката се пропуска
# СЪС съобщение в лога, а не тихо.
COPY integrity-manifest.json /app/integrity-manifest.json
# Enterprise Control Center (статика, сервира се на /ui/...). Build context-ът на
# Supervisor е ТАЗИ папка, затова UI-ят задължително живее вътре в нея.
COPY ui /app/ui/
# HTTP компонентите (routes/*.js): всеки поема свой дял от API-то, за да не расте
# `server.js` като монолит. Без този ред сървърът не стартира (MODULE_NOT_FOUND).
COPY routes /app/routes/
# Компонентите на сървъра (`server_module/*.js`): зареждат се ВСИЧКИ по име, без твърдо
# вписан списък (server-modules.js). Липсва ли папката, стартът спира с ясна грешка, а не
# с 404 на публичната страница.
COPY server_module /app/server_module/
COPY core_module /app/core_module/
# Evidence View порталът (QR): копира се в <HA config>/www/hapi/data при старт.
COPY evidence-portal /app/evidence-portal/
# PasevSU Document Generator (статика, сервира се на /generator/).
COPY generator /app/generator/
# No shell script and no chmod: the entrypoint is plain Node (start.js), so the
# image needs neither a POSIX shell layer nor an executable bit. The build fails
# early if the pinned runtime lacks node:sqlite DatabaseSync.
RUN node -e 'if(typeof require("node:sqlite").DatabaseSync!=="function")process.exit(1)'
EXPOSE 8098 8099 8088
CMD ["node", "/app/start.js"]
