# Pin a Node runtime that includes the required node:sqlite DatabaseSync API.
# The Home Assistant Supervisor can build this add-on without relying on the
# variable Node version available in a generic BUILD_FROM base image.
#
# Multi-arch: the official Node tarball is published for linux/amd64, linux/arm64 and
# linux/arm/v7, so the same Dockerfile builds on x86-64 servers, 64-bit Raspberry Pi OS
# (aarch64) and 32-bit Raspberry Pi OS (armv7). No --platform pin and no dependency
# install: every dependency is a Node built-in, which keeps the image architecture
# independent. armhf/armv6 (Pi Zero/1) has no Node 22 build and is not claimed in
# config.yaml. The base is plain Alpine ON PURPOSE (see below): the official `node:*`
# image ships npm, and npm's own packages are what Docker Scout reports as critical.
FROM alpine:3.24

# ── Node БЕЗ npm / npx / yarn / corepack ─────────────────────────────────
# Официалният `node:*` образ НОСИ npm със себе си. Този add-on няма нито една npm
# зависимост (всичко е вградено в Node), а Docker Scout отчита точно в тези пакети
# 2 critical + част от high (npm/tar 7.5.11, npm/brace-expansion, npm/ip-address) —
# код, който никога не се изпълнява в add-on-а. Дотук те се ТРИЕХА на по-късен слой;
# това оставя следа в историята на образа и скенерът продължаваше да ги вижда.
# Затова Node влиза от ОФИЦИАЛНИЯ musl tarball с изключени npm/npx/corepack: чуждите
# пакети не стигат до образа, вместо да се махат след това.
#
# Многоархивност: tarball-ът се избира по `apk --print-arch`, за да се билдва СЪЩИЯТ
# Dockerfile за linux/amd64, linux/arm64 и linux/arm/v7 (архитектурите в config.yaml).
# Закачената версия е нарочна: плаващ таг прави изданието невъзпроизводимо.
ARG NODE_VERSION=22.23.2

# 1. Пакетите на Alpine се вдигат до актуалните поправки. `--available` не е украса: без
#    него `apk upgrade` подминава пакети, чиято произходна група е сменена между изданията
#    на Alpine, а точно така излизат поправките за zlib/musl/openssl. Docker Scout отчита
#    в БАЗОВИЯ минирутфс (alpine:3.24.4) 7 поправими находки — zlib 1.3.2-r1
#    (CVE-2026-4738, critical), musl 1.2.6-r3 (CVE-2026-107891, high) и пет в openssl
#    3.5.9-r0; точно този слой ги вдига до версиите от хранилището. Версиите се печатат,
#    за да е видимо в лога на build-а какво е влязло в готовия образ.
RUN apk upgrade --no-cache --available \
 && (apk info -v zlib musl openssl libssl3 libcrypto3 || true) \
 && rm -rf /var/cache/apk/*

# 2. Node от официалния tarball, без пакетния мениджър на npm.
RUN set -eu; \
    case "$(apk --print-arch)" in \
      x86_64) node_arch=x64 ;; \
      aarch64) node_arch=arm64 ;; \
      armv7) node_arch=armv7l ;; \
      *) echo "unsupported architecture: $(apk --print-arch)" >&2; exit 1 ;; \
    esac; \
    apk add --no-cache --virtual .fetch curl xz; \
    curl -fsSLo /tmp/node.tar.xz "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}-musl.tar.xz"; \
    tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 --no-same-owner \
      --exclude='*/npm' --exclude='*/npx' --exclude='*/corepack'; \
    rm -f /tmp/node.tar.xz; \
    apk del .fetch; \
    rm -rf /var/cache/apk/*

WORKDIR /app
# Сигурност на слоя (0.69.87, преработено): находките на Docker Scout идваха от две места —
# базовите пакети на Alpine и npm, който базовият образ носи със себе си. Затова:
#   • пакетите на Alpine се вдигат до актуалните поправки (стъпка 1 горе);
#   • npm/npx/yarn/corepack НЕ се копират изобщо (стъпка 2) — няма какво да се трие.
# Това е проверено от `tests/docker-runtime.cjs`: той иска `apk upgrade` и изключен npm
# в tarball-а, а не „изтрит по-късно“ (изтриването оставя пакета в историята на слоя).
# Цената е, че build-ът не е байт-идентичен при повторение. Това е съзнателно (сигурност
# пред пълна възпроизводимост) и е записано в CHANGELOG.
# Всички локални модули, които server.js изисква (пряко или през друг модул).
# tests/docker-runtime.cjs проверява списъка срещу реалните require-и.
COPY integrity.js api-registry.js api-spec.js api-version.js audit-chain.js cabinet.js cases.js cms-sign.js config-profiles.js container.js core-store.js crypto-options.js directory.js download-access.js download-stream.js error-log.js event-bus.js export-manager.js export-rules.js file-crypto.js gateway-api.js generator.js instance-lock.js interpolate.js job-manager.js links.js load-control.js logger.js migration-bridge.js mirror-target.js notify.js observer.js ooxml.js package-crypto.js packager.js path-crypto.js paths.js pdf-writer.js pgp.js plugins.js portal-folder.js portal-access.js public-route-allowlist.js portal-policy.js portal-term.js portal-qr.js portal-view.js portal-integrity.js portal-skin.js pgp-tools.js pgp-sign.js content-id.js oidc.js decision-sensors.js layout.js preview.js process-guards.js public-gateway.js public-package.js qr-svg.js qrcode.js rbac.js readiness.js registry.js report-manifest.js report-package.js report-render.js report-stamp.js repository.js retention.js runtime-config.js secret-lock.js secret-links.js secret-page.js secret-view.js send.js server.js share-links.js shared-data.js signer.js sqlite-repository.js sqlite-store.js start.js storage-check.js storage-migrate.js storage-preflight.js storage-tree.js throttle.js tsa-client.js versioning.js virtual-storage.js visitor-intel.js workdir-crypto.js workdir-io.js workdir-migrate.js evidence-portal.js x509.js site-csp.js admin-api-spec.js problem.js idempotency.js respond.js webhooks.js event-stream.js worm.js exif.js forensic.js case-access.js /app/
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
