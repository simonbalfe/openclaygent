FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb xauth \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
RUN npm init -y && npm install patchright
RUN npx patchright install --with-deps chromium
COPY server.mjs .
EXPOSE 9223
CMD ["xvfb-run", "-a", "--server-args=-screen 0 1920x1080x24", "node", "server.mjs"]
