# Pin a Node runtime that includes the required node:sqlite DatabaseSync API.
# The Home Assistant Supervisor can build this add-on without relying on the
# variable Node version available in a generic BUILD_FROM base image.
#
# Multi-arch: this official tag publishes linux/amd64, linux/arm64 and linux/arm/v7,
# so the same Dockerfile builds on x86-64 servers, 64-bit Raspberry Pi OS (aarch64)
# and 32-bit Raspberry Pi OS (armv7). No --platform pin, no apk packages and no npm
# install: every dependency is a Node built-in, which keeps the image architecture
# independent. armhf/armv6 (Pi Zero/1) has no Node 22 build and is not claimed in
# config.yaml.
FROM node:22.16.0-alpine3.21
WORKDIR /app
# Всички локални модули, които server.js изисква (пряко или през друг модул).
# tests/docker-runtime.cjs проверява списъка срещу реалните require-и.
COPY api-registry.js api-spec.js api-version.js audit-chain.js cabinet.js cases.js cms-sign.js config-profiles.js container.js core-store.js directory.js download-access.js download-stream.js error-log.js event-bus.js export-manager.js export-rules.js file-crypto.js gateway-api.js generator.js instance-lock.js interpolate.js job-manager.js links.js load-control.js logger.js migration-bridge.js notify.js observer.js ooxml.js package-crypto.js packager.js pdf-writer.js pgp.js plugins.js portal.css portal.html portal.js preview.js process-guards.js public-gateway.js public-package.js qrcode.js rbac.js readiness.js registry.js report-manifest.js report-package.js report-render.js report-stamp.js repository.js retention.js runtime-config.js secret-lock.js secret-links.js secret-page.js secret-view.js send.js server.js share-links.js shared-data.js signer.js sqlite-repository.js sqlite-store.js start.js storage-check.js storage-migrate.js storage-preflight.js storage-tree.js throttle.js tsa-client.js versioning.js virtual-storage.js visitor-intel.js evidence-portal.js x509.js portal-i18n.js admin-api-spec.js /app/
COPY fonts /app/fonts/
COPY rules /app/rules/
# Версията на add-on-а се чете от ТОЗИ файл (единственият източник на истина), за да
# може работещият add-on да каже коя версия е — вместо да я твърди ръчно поддържан низ.
# Supervisor строи от същото копие, така че няма как да се разминат.
COPY config.yaml /app/config.yaml
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
