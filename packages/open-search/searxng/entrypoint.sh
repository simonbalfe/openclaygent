#!/bin/sh
set -e

template=/usr/local/share/openclaygent/searxng-settings.yml
target=/etc/searxng/settings.yml

mkdir -p /etc/searxng
cp -f "$template" "$target"

if [ -n "$EVOMI_USERNAME" ] && [ -n "$EVOMI_PASSWORD" ] && [ -n "$EVOMI_GATEWAY" ] && python /searxng-proxy-check.py; then
  cat >> "$target" <<YAML
  proxies:
    all://:
      - http://$EVOMI_USERNAME:$EVOMI_PASSWORD@$EVOMI_GATEWAY
YAML
  echo "[searxng-wrapper] Evomi residential proxy enabled for outgoing engine requests"
elif [ -n "$EVOMI_USERNAME" ] || [ -n "$EVOMI_PASSWORD" ] || [ -n "$EVOMI_GATEWAY" ]; then
  echo "[searxng-wrapper] Evomi proxy unavailable; outgoing engine requests go direct"
else
  echo "[searxng-wrapper] no Evomi creds set; outgoing engine requests go direct"
fi

exec /usr/local/searxng/entrypoint.sh "$@"
