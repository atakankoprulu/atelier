#!/bin/sh
# Claude Code hook olayını Atölye'ye iletir. Atölye dışında çalışırsa sessizce çıkar.
# Hiçbir şey yazdırmaz ve her zaman 0 ile çıkar: Claude'un akışını asla etkilemez.
[ -z "$ATOLYE_PORT" ] && { cat >/dev/null; exit 0; }
curl -s -m 1 -X POST -H 'Content-Type: application/json' \
  --data-binary @- "http://127.0.0.1:$ATOLYE_PORT/hook" >/dev/null 2>&1
exit 0
