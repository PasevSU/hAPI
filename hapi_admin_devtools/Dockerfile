FROM node:22.23.2-alpine3.24
ARG BUILD_VERSION=0.2.0
ARG BUILD_ARCH=amd64
LABEL io.hass.version="${BUILD_VERSION}" io.hass.type="app" io.hass.arch="${BUILD_ARCH}"
# GnuPG validates detached OpenPGP signature challenges and exact GitHub certificate fingerprint.
RUN apk add --no-cache gnupg
WORKDIR /app
COPY server.js identity.js monitor.js github-verification.js release-gate.js /app/
COPY dashboard.html dashboard.js dashboard.css /app/
COPY protocols /app/protocols/
ENV NODE_ENV=production
CMD ["node", "/app/server.js"]
