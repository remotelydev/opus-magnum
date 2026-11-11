# Horarium preview image: API + built reception UI in one process, filled with made-up demo data.
# Build from the repository root:
#   docker build -f apps/horarium/Dockerfile -t horarium-preview .
# Run (needs a PostgreSQL 16 database, empty or with demo data only):
#   docker run -p 8790:8790 -e DATABASE_URL=postgres://... horarium-preview
FROM node:22-slim

WORKDIR /repo
RUN corepack enable

# Only what Horarium needs from the monorepo.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/dentaplus-ui ./packages/dentaplus-ui
COPY apps/horarium ./apps/horarium

RUN pnpm install --frozen-lockfile --filter horarium... \
 && pnpm --filter horarium build

ENV NODE_ENV=production \
    TZ=Europe/Warsaw \
    HOST=0.0.0.0 \
    PORT=8790
EXPOSE 8790

WORKDIR /repo/apps/horarium
CMD ["sh", "preview/start.sh"]
