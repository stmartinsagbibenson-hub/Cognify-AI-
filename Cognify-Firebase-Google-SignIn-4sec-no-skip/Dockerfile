FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    TRUST_PROXY=false \
    COOKIE_SECURE=true \
    DATABASE_PATH=/app/data/cognify.sqlite

COPY --chown=node:node package.json README.md .env.example ./*.mjs ./*.js ./*.html ./*.css ./*.svg ./
COPY --chown=node:node scripts ./scripts
RUN mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server.mjs"]
