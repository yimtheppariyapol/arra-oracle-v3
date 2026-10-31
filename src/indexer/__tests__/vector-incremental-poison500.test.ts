import { expect, test } from 'bun:test';
import { incrementalHarness } from './vector-incremental-harness.ts';

test('a per-input HTTP 500 consumes only the bad job retry budget while healthy inputs commit', async () => {
  const h = await incrementalHarness();
  try {
    for (let i = 0; i < 5; i++) { h.put(`d${i}`, i === 2 ? 'POISON' : `ok-${i}`); h.enqueue(`d${i}`); }
    const embed = h.embedder.embed;
    const requests: string[][] = [];
    h.embedder.embed = async (texts, type) => {
      requests.push([...texts]);
      if (texts.includes('POISON')) throw new Error('Ollama API error (500): unsupported value: NaN');
      return embed(texts, type);
    };
    let pauses = 0;
    let stopped = false;
    await h.run({ onPause: () => { pauses++; stopped = true; }, isShuttingDown: () => stopped,
      onEvent: (event) => { if (event.type === 'idle') stopped = true; } });
    expect(pauses).toBe(0);
    expect(requests.slice(0, 2)).toEqual([['ok-0', 'ok-1', 'POISON', 'ok-3', 'ok-4'], ['health check']]);
    expect((await h.store.listDocumentIds()).sort()).toEqual(['d0', 'd1', 'd3', 'd4']);
    expect(h.sqlite.query('SELECT status, attempts FROM indexing_jobs WHERE doc_id = ?').get('d2'))
      .toEqual({ status: 'error', attempts: 1 });
    for (let attempt = 2; attempt <= 3; attempt++) {
      h.sqlite.exec("UPDATE indexing_jobs SET finished_at = 0 WHERE doc_id = 'd2'");
      await h.run();
      expect(h.sqlite.query('SELECT status, attempts FROM indexing_jobs WHERE doc_id = ?').get('d2'))
        .toEqual({ status: 'error', attempts: attempt });
    }
    expect(h.sqlite.query("SELECT count(*) AS n FROM indexing_jobs WHERE status = 'done' AND attempts = 1").get())
      .toEqual({ n: 4 });
  } finally { await h.close(); }
}, 10000);
