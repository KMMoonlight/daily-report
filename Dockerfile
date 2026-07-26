FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
# npm's cross-platform optional-dependency lock can omit Linux WASM
# packages when the lock was generated on macOS. `npm install` reconciles
# those platform entries inside the image while still honoring the lock.
RUN npm install --no-audit --no-fund
COPY . .
ARG SITE_URL
ENV SITE_URL=$SITE_URL
ENV PORT=8080
ENV AUTO_PUBLISH=false
RUN mkdir -p src/content/daily src/content/weekly .data .cache
RUN npm run build

VOLUME ["/app/src/content", "/app/.data", "/app/.cache"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD wget -q -O - http://127.0.0.1:8080/ >/dev/null || exit 1
CMD ["npm", "run", "container:start"]
