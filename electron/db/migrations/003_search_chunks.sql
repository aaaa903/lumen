-- 003_search_chunks：检索改为段落级索引。
-- 旧库里的块是一整章，书内搜索因此「一章只报第一处命中」。
-- 清空索引并让 indexed_at 归零，应用下次启动时由后台索引窗口按新规则重建；
-- PDF 不参与全文检索，保持原值。标注、进度与笔记都不受影响。

DELETE FROM search_chunks;

UPDATE books SET indexed_at = NULL WHERE format != 'pdf';
