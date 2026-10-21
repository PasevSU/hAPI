# Pin a Node runtime that includes the required node:sqlite DatabaseSync API.
# The Home Assistant Supervisor can build this add-on without relying on the
# variable Node version available in a generic BUILD_FROM base image.
FROM node:22.16.0-alpine3.21
WORKDIR /app
# Всички локални модули, които server.js изисква (пряко или през друг модул).
# tests/docker-runtime.cjs проверява списъка срещу реалните require-и.
COPY admin.js admin.html api-registry.js api-spec.js api-version.js audit-chain.js cabinet.js cases.js config-profiles.js container.js core-store.js directory.js download-access.js error-log.js event-bus.js export-manager.js export-rules.js file-crypto.js gateway-api.js job-manager.js load-control.js migration-bridge.js notify.js ooxml.js packager.js pdf-writer.js pgp.js plugins.js portal.css portal.html portal.js preview.js public-gateway.js qrcode.js rbac.js registry.js report-manifest.js report-render.js repository.js retention.js run.sh runtime-config.js server.js signer.js sqlite-repository.js sqlite-store.js storage-check.js storage-migrate.js storage-preflight.js storage-tree.js versioning.js virtual-storage.js /app/
COPY fonts /app/fonts/
RUN chmod 0755 /app/run.sh && node -e 'if(!require("node:sqlite").DatabaseSync)process.exit(1)'
EXPOSE 8098 8099
CMD ["/app/run.sh"]
