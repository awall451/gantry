# Stock Caddy plus the Cloudflare DNS plugin, so Caddy can solve the ACME
# DNS-01 challenge itself (needed for wildcard certificates). Nothing else
# changes: same image, same entrypoint, one extra module.
FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/caddy-dns/cloudflare

FROM caddy:2-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
