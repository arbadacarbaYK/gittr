# gittr: upstream nsite-gateway + overlay (see README.md)
ARG NSITE_GATEWAY_REF=master
FROM denoland/deno:2.7.7 AS upstream

ARG NSITE_GATEWAY_REF
WORKDIR /src
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 --branch "${NSITE_GATEWAY_REF}" \
  https://github.com/hzrd149/nsite-gateway.git .

FROM denoland/deno:2.7.7 AS main
WORKDIR /app

COPY --from=upstream /src/deno.json /src/deno.lock /src/main.ts ./
COPY --from=upstream /src/src ./src
COPY --from=upstream /src/public ./public

COPY overlay/src/routes/status/index.ts ./src/routes/status/index.ts
COPY overlay/src/routes/status/manifests-json.tsx ./src/routes/status/manifests-json.tsx

RUN deno cache --frozen --unstable-kv main.ts

EXPOSE 3000
ENV NSITE_PORT="3000"

CMD ["run", "--frozen", "--cached-only", "--unstable-kv", "--allow-env", "--allow-net", "--allow-read", "--allow-write", "main.ts"]
