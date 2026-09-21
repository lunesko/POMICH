# Redis realtime scaling (prep)

POMICH realtime (`bot/realtime.py`) is **in-process** today — correct for a
single uvicorn worker behind nginx.

## When to add Redis

- You need `uvicorn --workers N` (N>1), or
- Multiple app containers behind a load balancer.

## Plan

1. Uncomment / merge `deploy/redis.compose.snippet.yml` into
   `docker-compose.production.yml`.
2. Set `REDIS_URL=redis://pomich-redis:6379/0`.
3. Replace local `_CHANNELS` fan-out with Redis pub/sub (keep the same
   `publish_*` / `subscribe` API so routers stay unchanged).
4. Keep `/internal/metrics` exposing subscriber counts via Redis
   `PUBSUB NUMSUB`.

Until then: **do not** scale uvicorn workers — SSE/WS will miss events.
