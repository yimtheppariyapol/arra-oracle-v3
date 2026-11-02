DROP TRIGGER IF EXISTS oracle_documents_fts_delete_sync;
--> statement-breakpoint
DROP TRIGGER IF EXISTS oracle_documents_fts_concepts_sync;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_fts_content_doc_id ON oracle_fts_content(c0);
--> statement-breakpoint
CREATE TRIGGER oracle_documents_fts_delete_sync
AFTER DELETE ON oracle_documents
BEGIN
  DELETE FROM oracle_fts
  WHERE rowid IN (SELECT id FROM oracle_fts_content WHERE c0 = OLD.id);
END;
--> statement-breakpoint
CREATE TRIGGER oracle_documents_fts_concepts_sync
AFTER UPDATE OF concepts ON oracle_documents
WHEN OLD.concepts IS NOT NEW.concepts
BEGIN
  UPDATE oracle_fts SET concepts = NEW.concepts
  WHERE rowid IN (SELECT id FROM oracle_fts_content WHERE c0 = NEW.id);
END;
