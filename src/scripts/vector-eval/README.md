# Local vector eligibility and model evaluation

This harness never imports the application database singleton. Source data comes
from a single SELECT per snapshot through `sqlite3 file:.../oracle.db?mode=ro`.
All snapshots, queries, caches, predictions and reports live in ignored `eval-out/`.
It never changes the production schema, queue, daemon or running servers.

## Vector eligibility

The canonical defaults are in `src/indexer/vector-eligibility.ts`:

- Include `ψ/memory/**`, `ψ/learn/**`, `ψ/inbox/handoff/**`, `ψ/inbox/handoffs/**`.
- Exclude `**/origin/**`, including origins above a project-prefixed ψ path.
- Include non-null `created_by != indexer` rows unless explicitly excluded.
  Null provenance follows the existing legacy-indexer convention.
- Production bulk-reindex jobs target only the registered `bge-m3` key.

`ORACLE_VECTOR_INCLUDE`, `ORACLE_VECTOR_EXCLUDE`, `ORACLE_VECTOR_MODELS` accept
comma-separated lists. Each replaces its default; an empty string disables that
list. Exclusions win over includes and DB-only provenance. Globs match both a
normalized ψ-relative path and (for exclusions) the full slash-normalized path.
Programmatic callers can pass `VectorEligibilityConfig`. This only affects the
bulk-reindex enqueue boundary; FTS storage still precedes it and indexes all text.
Explicit job APIs, watcher queues and existing pending jobs are unchanged.

```sh
bun src/scripts/vector-eval/dry-run.ts
bun src/scripts/vector-eval/run.ts --sample 6000
bun src/scripts/vector-eval/run.ts --sample 6000 --negative-control
bun src/scripts/vector-eval/run.ts --sample 6000 --queries eval-out/queries-shuffled.jsonl --negative-control
bun test --isolate src/scripts/vector-eval/__tests__/
```

The dry run compares a hypothetical full enqueue for the code's default registry
(`bge-m3`, `nomic`, `qwen3`) with the configured production keys; it does not inspect
protected on-disk model config or deduplicate against live jobs. Override the
registry with `--registered-models bge-m3,nomic,qwen3`. Documents mean distinct
tenant/source pairs; chunks mean active document IDs. It assumes each
active ID has FTS text, as the normal indexer guarantees.

The sample uses seeded reservoirs and round-robin allocation across learnings,
retros, study, handoffs and other eligible material. Scarce strata redistribute
slots. The snapshot is reused while its size, policy and format match; its SHA256
and timestamp are recorded in `eval-out/corpus-stats.json`.

Queries include 40 English excerpts, 40 Thai excerpts, 20 identifier queries and
at least 20 cross-language paraphrases. To supply curated cross-language queries,
write `eval-out/cross-language.jsonl` using the `Query` interface in `queries.ts`;
all labels must reference the saved corpus. Without that file the harness tries
local `qwen2.5:3b` translations. It never pulls a translation model. Inspect these
translations: they are an unjudged known-item proxy, not human relevance labels.

Embeddings use local Ollama only. Default batch 16; maximum 64. Samples are capped
at 6,000 for bounded memory. Models run serially and unload after each batch.
The input prefixes are recorded in `embeddings.ts`; bge-m3 follows the repository's
query/passage convention. Digest, prepared text and settings identify each cache
entry. Partial writes are atomically renamed. A cache hit issues no embed request.
The local tags request still verifies the current model revision on reruns.

Exact cosine, BM25 and RRF use full rankings. Prediction files retain the top 100;
metrics use the full rankings. The negative control permutes corpus IDs with a
fixed seed, preserving query text and label-set cardinalities. It requires FTS
control scores below 0.05 and reports all available model measurements separately.

Unavailable local services produce a partial report and exit 1. Missing optional
`qwen3-embedding:0.6b` is skipped. No model is downloaded automatically. RSS must
be observable through `ps` before live embedding; largest client/Ollama process
RSS is sampled, and further batches stop if it exceeds 4 GiB. This is a sampled
guard, not an operating-system hard memory cap. Throughput includes model loading
and cache I/O; a cached rerun must not be presented as cold embedding throughput.

Replace bge-m3 only after at least 5% relative overall nDCG@10 improvement with no
regression in Thai, Thai-to-English or English-to-Thai. Vector and hybrid decisions
are reported separately. Human judgements remain necessary before rollout.
