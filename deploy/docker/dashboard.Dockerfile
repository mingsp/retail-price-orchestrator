ARG NODE_BASE_IMAGE=node:22.14.0-bookworm-slim
ARG NGINX_BASE_IMAGE=nginx:1.27.3-alpine
FROM ${NODE_BASE_IMAGE} AS build

USER root
ENV NODE_ENV=development
ARG VITE_MASTER_BASE_URL
ENV VITE_MASTER_BASE_URL=$VITE_MASTER_BASE_URL
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@11.21.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY apps/master/package.json apps/master/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile --prod=false \
  && test -x apps/dashboard/node_modules/.bin/tsc \
  && test -x apps/dashboard/node_modules/.bin/vite
COPY apps/dashboard apps/dashboard
COPY packages/shared packages/shared
RUN test -n "$VITE_MASTER_BASE_URL" && pnpm --filter @retail-orchestrator/dashboard build

FROM ${NGINX_BASE_IMAGE} AS runtime
USER root
RUN rm -rf /usr/share/nginx/html/*
COPY deploy/docker/dashboard.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/dashboard/dist /usr/share/nginx/html
EXPOSE 80
