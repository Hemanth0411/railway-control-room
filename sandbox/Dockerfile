# Small on purpose: the Sandbox exists to be started, watched and stopped, so start-up
# time matters more than anything else it could do.
FROM node:22-alpine

WORKDIR /app
COPY server.mjs ./

ENV NODE_ENV=production

# Documentation only. Railway injects PORT at runtime and the server reads it.
EXPOSE 3000

# Drop root. The image runs a single unprivileged process.
USER node

CMD ["node", "server.mjs"]
