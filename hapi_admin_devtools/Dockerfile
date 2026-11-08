FROM node:22.23.2-alpine3.24
# ssh-keygen -Y verify validates a fresh possession-of-private-key challenge.
RUN apk add --no-cache openssh-client
WORKDIR /app
COPY server.js identity.js /app/
COPY dashboard.html dashboard.js dashboard.css /app/
COPY protocols /app/protocols/
ENV NODE_ENV=production
CMD ["node", "/app/server.js"]
