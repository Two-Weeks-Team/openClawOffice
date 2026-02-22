FROM node:22-alpine

RUN apk add --no-cache wget
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

ENV PORT=5179
ENV OPENCLAW_STATE_DIR=/app/.openclaw
ENV OPENCLAW_PROJECT_DIR=/app/openclaw
ENV OPENCLAW_GATEWAY_PORT=18789

EXPOSE 5179

CMD ["pnpm", "preview", "--host", "0.0.0.0", "--port", "5179"]
