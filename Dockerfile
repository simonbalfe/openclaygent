FROM oven/bun:1 AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/open-apify/package.json ./packages/open-apify/package.json
COPY packages/open-search/package.json ./packages/open-search/package.json
COPY packages/open-extract/package.json ./packages/open-extract/package.json
RUN bun install --frozen-lockfile --production

FROM oven/bun:1
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/packages/open-search/node_modules ./packages/open-search/node_modules
COPY --from=dependencies /app/packages/open-extract/node_modules ./packages/open-extract/node_modules
COPY package.json ./
COPY src ./src
COPY packages/open-apify/package.json ./packages/open-apify/package.json
COPY packages/open-apify/src ./packages/open-apify/src
COPY packages/open-search/package.json ./packages/open-search/package.json
COPY packages/open-search/src ./packages/open-search/src
COPY packages/open-extract/package.json ./packages/open-extract/package.json
COPY packages/open-extract/src ./packages/open-extract/src
USER bun
EXPOSE 8080
ENTRYPOINT ["bun", "run", "src/api/index.ts"]
