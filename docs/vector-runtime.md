# Vector runtime mode

Arra keeps an FTS5 floor: `/api/search` always runs the local SQLite FTS leg, even when the vector layer is disabled or proxied. Vector failures must degrade to FTS5 results instead of making core search unavailable.

`/api/health` exposes the current vector runtime:

- `vectorMode: "embedded"` — local vector adapter is usable in this process.
- `vectorMode: "proxied"` — `VECTOR_URL` is set and vector requests are sent to a separate vector HTTP process.
- `vectorMode: "disabled"` — local vector is intentionally unavailable, for example CPU/AVX guard failure or a missing local vector index.

To split vector work out of the core server today, run a compatible vector HTTP service and start the core server with:

```bash
VECTOR_URL=http://127.0.0.1:48080 bun src/server.ts
```

With `VECTOR_URL` set, hybrid search still performs local FTS5 first and asks the vector service for the vector leg. If the proxy is down, search returns FTS5-only results with `vectorAvailable: false`.

Unconfigured installs keep `sqlite-vec`, preserving existing indexes. Select
LanceDB explicitly with `ORACLE_VECTOR_DB=lancedb` or set `collections[model].adapter` to
`"lancedb"` and its `dataPath` to a LanceDB directory in `vector-server.json`. Existing SQLite vectors are not copied
automatically: run the indexer for the selected backend to populate LanceDB.

Incremental indexing requires an embedder with an immutable `getIdentity()`
digest (Ollama supplies it via `/api/tags`). Providers or fallback chains without
that capability pause safely with jobs pending and attempts unchanged.
`bun src/scripts/index-model.ts bge-m3` queues and claims jobs using the daemon's
writer lock. If a daemon owns that model, the CLI waits up to 60 seconds and
leaves its queued work for the daemon on timeout. Stop the daemon first to run
the CLI as the writer. Embedding cache entries use float32 and a 1 GiB LRU
budget; old JSON entries are misses and are reclaimed by the same size budget.
