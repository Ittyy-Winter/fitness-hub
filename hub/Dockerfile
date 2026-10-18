# Built from the repo root (compose: context ., dockerfile hub/Dockerfile) so the image can
# carry db/migrations, which the hub applies at startup.

# Exercise names come from openGym's own catalogue at the pinned version. openGym is AGPL,
# so the derived file is generated here rather than committed to this MIT repo.
FROM node:24.22.0-alpine AS catalogue
ARG OPENGYM_VERSION
RUN apk add --no-cache git
RUN git clone -q --depth 1 --filter=blob:none --sparse --branch "v${OPENGYM_VERSION}" \
      https://github.com/DuarteSantos8/openGym.git /opengym \
 && git -C /opengym sparse-checkout set catalogue/exercises
WORKDIR /build
COPY hub/scripts/build-opengym-catalogue.ts scripts/
RUN mkdir -p src/sources && node scripts/build-opengym-catalogue.ts /opengym/catalogue/exercises

# The dashboard PWA, served by hub-api at fit.<domain>.
FROM node:24.22.0-alpine AS dashboard
ARG CLAUDE_PROJECT_URL=
ARG GYM_URL=
WORKDIR /dashboard
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY dashboard/ ./
RUN VITE_CLAUDE_PROJECT_URL="$CLAUDE_PROJECT_URL" VITE_GYM_URL="$GYM_URL" npm run build

FROM node:24.22.0-alpine
ENV NODE_ENV=production
WORKDIR /app/hub
COPY hub/package.json hub/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY db/migrations /app/db/migrations
COPY hub/src ./src
COPY --from=catalogue /build/src/sources/opengym-exercises.json ./src/sources/
COPY --from=dashboard /dashboard/dist ./public
USER node
CMD ["node", "src/worker.ts"]
