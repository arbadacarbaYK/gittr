# gittr Pages gateway — built from arbadacarbaYK/nsite-gateway `master` (production fork).
#
# Sources are in `gateway-src/` (gitignored). deploy-nsite-gateway.sh copies your local
# clone (default: ../nsite-gateway-pr on branch gittr-pages) before `docker build`.
# After pushing that branch to GitHub, you can switch this Dockerfile to `git clone` only.

FROM denoland/deno:2.7.7 AS main
WORKDIR /app

COPY gateway-src/ ./

RUN test -f main.ts || (echo "Missing gateway-src/ — run deploy-nsite-gateway.sh" && exit 1) \
  && deno cache --frozen --unstable-kv main.ts

EXPOSE 3000
ENV NSITE_PORT="3000"

CMD ["run", "--frozen", "--cached-only", "--unstable-kv", "--allow-env", "--allow-net", "--allow-read", "--allow-write", "main.ts"]
