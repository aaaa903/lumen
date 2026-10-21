-- 001_init：首版结构。时间为 Unix 毫秒，id 为 UUID 文本。
-- 删除一律先软删（deleted_at），只有「彻底删除」才物理删除。

CREATE TABLE books (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  author         TEXT NOT NULL DEFAULT '',
  format         TEXT NOT NULL CHECK (format IN ('epub', 'markdown', 'txt')),
  file_path      TEXT NOT NULL,
  sha256         TEXT NOT NULL UNIQUE,
  size           INTEGER NOT NULL,
  cover_path     TEXT,
  chapter_count  INTEGER NOT NULL DEFAULT 0,
  indexed_at     INTEGER,
  added_at       INTEGER NOT NULL,
  last_opened_at INTEGER,
  deleted_at     INTEGER
);

CREATE TABLE progress (
  book_id    TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  locator    TEXT NOT NULL,
  percent    REAL NOT NULL DEFAULT 0,
  chapter    TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

CREATE TABLE annotations (
  id         TEXT PRIMARY KEY,
  book_id    TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  group_id   TEXT,
  kind       TEXT NOT NULL CHECK (kind IN ('highlight', 'note', 'bookmark')),
  color      TEXT NOT NULL DEFAULT 'yellow',
  locator    TEXT NOT NULL,
  note_md    TEXT NOT NULL DEFAULT '',
  orphaned   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX idx_annotations_book ON annotations(book_id, deleted_at, created_at);
CREATE INDEX idx_annotations_orphan ON annotations(orphaned) WHERE orphaned = 1;

CREATE TABLE tags (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  color      TEXT NOT NULL DEFAULT 'slate',
  created_at INTEGER NOT NULL
);

CREATE TABLE annotation_tags (
  annotation_id TEXT NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
  tag_id        TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (annotation_id, tag_id)
);

CREATE TABLE notes (
  id         TEXT PRIMARY KEY,
  book_id    TEXT REFERENCES books(id) ON DELETE SET NULL,
  title      TEXT NOT NULL DEFAULT '',
  body_md    TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE search_chunks (
  id            INTEGER PRIMARY KEY,
  book_id       TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_index INTEGER NOT NULL,
  chapter_title TEXT NOT NULL DEFAULT '',
  href          TEXT NOT NULL DEFAULT '',
  text          TEXT NOT NULL
);

CREATE INDEX idx_chunks_book ON search_chunks(book_id, chapter_index);

CREATE VIRTUAL TABLE search_fts USING fts5(
  text,
  content = 'search_chunks',
  content_rowid = 'id',
  tokenize = 'trigram'
);

CREATE TRIGGER chunks_ai AFTER INSERT ON search_chunks BEGIN
  INSERT INTO search_fts(rowid, text) VALUES (new.id, new.text);
END;

CREATE TRIGGER chunks_ad AFTER DELETE ON search_chunks BEGIN
  INSERT INTO search_fts(search_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;

CREATE TRIGGER chunks_au AFTER UPDATE ON search_chunks BEGIN
  INSERT INTO search_fts(search_fts, rowid, text) VALUES ('delete', old.id, old.text);
  INSERT INTO search_fts(rowid, text) VALUES (new.id, new.text);
END;

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
