#!/bin/sh
# Forwards a Claude Code hook event to Atelier. Exits silently when run outside Atelier.
# Prints nothing and always exits 0, so it can never affect Claude's flow.
[ -z "$ATELIER_PORT" ] && { cat >/dev/null; exit 0; }
curl -s -m 1 -X POST -H 'Content-Type: application/json' \
  --data-binary @- "http://127.0.0.1:$ATELIER_PORT/hook" >/dev/null 2>&1
exit 0
