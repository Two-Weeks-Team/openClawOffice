FROM node:25-alpine

RUN apk add --no-cache wget && corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build && chown -R node:node /app

ENV PORT=5179
ENV OPENCLAW_STATE_DIR=/app/.openclaw
ENV OPENCLAW_PROJECT_DIR=/app/openclaw
ENV OPENCLAW_GATEWAY_PORT=18789

USER node

EXPOSE 5179

CMD ["pnpm", "preview", "--host", "0.0.0.0", "--port", "5179"]
