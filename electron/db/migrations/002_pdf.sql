-- 002_pdf：books.format 增加 pdf。
-- SQLite 不能直接改 CHECK 约束，只能重建表；迁移执行器在重建期间临时关闭外键，
-- 否则 DROP TABLE books 会级联删掉 progress / annotations / search_chunks。
-- 重建后子表仍以 books 为父表，外键在迁移结束时校验。

CREATE TABLE books_new (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  author         TEXT NOT NULL DEFAULT '',
  format         TEXT NOT NULL CHECK (format IN ('epub', 'markdown', 'txt', 'pdf')),
  file_path      TEXT NOT NULL,
  sha256         TEXT NOT NULL UNIQUE,
  size           INTEGER NOT NULL,
  cover_path     TEXT,
  chapter_count  INTEGER NOT NULL DEFAULT 0,
  page_count     INTEGER NOT NULL DEFAULT 0,
  indexed_at     INTEGER,
  added_at       INTEGER NOT NULL,
  last_opened_at INTEGER,
  deleted_at     INTEGER
);

INSERT INTO books_new (
  id, title, author, format, file_path, sha256, size, cover_path,
  chapter_count, page_count, indexed_at, added_at, last_opened_at, deleted_at
)
SELECT
  id, title, author, format, file_path, sha256, size, cover_path,
  chapter_count, 0, indexed_at, added_at, last_opened_at, deleted_at
FROM books;

DROP TABLE books;
ALTER TABLE books_new RENAME TO books;
