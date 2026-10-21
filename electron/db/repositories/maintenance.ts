import { withTransaction, type Db } from '../open'

/**
 * 清空全部阅读数据：书、进度、标注、标签、笔记与全文索引。
 * 保留 settings（窗口位置）与日志；调用方负责删除 books/、covers/ 下的文件。
 */
export function clearLibrary(db: Db): void {
  withTransaction(db, () => {
    // 先删块，FTS 由触发器同步；再按依赖顺序删其余表。
    db.exec('DELETE FROM search_chunks')
    db.exec('DELETE FROM annotation_tags')
    db.exec('DELETE FROM annotations')
    db.exec('DELETE FROM notes')
    db.exec('DELETE FROM tags')
    db.exec('DELETE FROM progress')
    db.exec('DELETE FROM books')
  })
}
