ARG NODE_BASE_IMAGE=node:22.14.0-bookworm-slim
FROM ${NODE_BASE_IMAGE} AS build

USER root
ENV NODE_ENV=development
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@11.21.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/master/package.json apps/master/package.json
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile --prod=false \
  && test -x packages/shared/node_modules/.bin/tsc \
  && test -x apps/master/node_modules/.bin/tsc
COPY apps/master apps/master
COPY packages/shared packages/shared
COPY scripts/lib/category-union-evidence.mjs scripts/lib/category-union-evidence.mjs
COPY scripts/lib/category-union-evidence.d.mts scripts/lib/category-union-evidence.d.mts
RUN pnpm --filter @retail-orchestrator/shared exec tsc \
  && pnpm --filter @retail-orchestrator/master build \
  && node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('packages/shared/package.json','utf8'));p.main='dist/index.js';p.types='dist/index.d.ts';p.exports={'.':{types:'./dist/index.d.ts',import:'./dist/index.js',default:'./dist/index.js'}};delete p.scripts;delete p.devDependencies;fs.writeFileSync('packages/shared/runtime-package.json',JSON.stringify(p,null,2)+'\n')"

FROM ${NODE_BASE_IMAGE} AS runtime

ARG RETAIL_RADAR_VERSION=0.2.0
ARG RETAIL_RADAR_GIT_SHA=unknown
ARG RETAIL_RADAR_BUILT_AT=unknown
ARG RETAIL_RADAR_SCHEMA_VERSION=2026-08-17-p0.1

USER root
ENV NODE_ENV=production
ENV RETAIL_RADAR_VERSION=${RETAIL_RADAR_VERSION}
ENV RETAIL_RADAR_GIT_SHA=${RETAIL_RADAR_GIT_SHA}
ENV RETAIL_RADAR_BUILT_AT=${RETAIL_RADAR_BUILT_AT}
ENV RETAIL_RADAR_SCHEMA_VERSION=${RETAIL_RADAR_SCHEMA_VERSION}
WORKDIR /app

RUN find /app -mindepth 1 -maxdepth 1 -exec rm -rf {} + \
  && (getent group retailradar >/dev/null || groupadd --system --gid 10001 retailradar) \
  && (id -u retailradar >/dev/null 2>&1 || useradd --system --uid 10001 --gid retailradar --home-dir /app retailradar)
COPY --from=build --chown=retailradar:retailradar /workspace/node_modules ./node_modules
COPY --from=build --chown=retailradar:retailradar /workspace/apps/master/node_modules ./apps/master/node_modules
COPY --from=build --chown=retailradar:retailradar /workspace/apps/master/package.json ./apps/master/package.json
COPY --from=build --chown=retailradar:retailradar /workspace/apps/master/dist ./apps/master/dist
COPY --from=build --chown=retailradar:retailradar /workspace/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=retailradar:retailradar /workspace/packages/shared/runtime-package.json ./packages/shared/package.json

USER retailradar
EXPOSE 17890
CMD ["node", "apps/master/dist/index.js"]
