-- FTS5 id is UNINDEXED in the inverted index. Its content shadow table is
-- an ordinary SQLite table: c0=id, c1=content, id=FTS rowid. This B-tree
-- supports exact id lookups, including punctuation-only ids and duplicates.
-- SQLite maintains it automatically for every FTS writer.
CREATE INDEX idx_fts_content_doc_id ON oracle_fts_content (c0);
