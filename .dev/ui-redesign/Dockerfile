# Pin a Node runtime that includes the required node:sqlite DatabaseSync API.
# The Home Assistant Supervisor can build this add-on without relying on the
# variable Node version available in a generic BUILD_FROM base image.
FROM node:22.16.0-alpine3.21
WORKDIR /app
COPY sqlite-store.js qrcode.js ooxml.js pdf-writer.js cabinet.js directory.js job-manager.js server.js runtime-config.js audit-chain.js rbac.js error-log.js config-profiles.js storage-check.js load-control.js storage-preflight.js storage-migrate.js admin.js admin.html portal.html portal.js portal.css run.sh /app/
COPY fonts /app/fonts/
RUN chmod 0755 /app/run.sh && node -e 'if(!require("node:sqlite").DatabaseSync)process.exit(1)'
EXPOSE 8098 8099
CMD ["/app/run.sh"]
