# Lumen 技术设计

版本：0.4（M3 已实现，M4 进行中）
对应 PRD：0.4
最后更新：2026-10-21

本文描述**现状与下一步**。代码与本文冲突时，以代码为准并立即修正本文，不留「待更新」。

## 1. 目标与约束

必须满足：

1. 完全离线，启动后零外部网络请求，由主进程强制而非靠自觉。
2. 书、标注、笔记、索引都在本机 SQLite 与文件系统里，卸载不丢。
3. 渲染层不接触 Node：`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`。
4. 一条标注能经受排版变化，CFI 失效后仍能找回原文。
5. 中文全文搜索可用，不依赖在线服务或词典文件。

不做：自动更新、崩溃上报、云端索引、多窗口（除隐藏的索引窗口外）。

## 2. 技术栈

| 层 | 选择 | 版本基线 |
| --- | --- | --- |
| 桌面壳 | Electron | ≥ 44 |
| 主进程语言 | TypeScript（由 `electron-vite` 编译） | 与渲染层同一 `tsconfig` |
| 数据库 | Electron 内置 `node:sqlite` + FTS5 | 实测 SQLite 3.53.4，含 `trigram` 分词；无原生模块，不需要 ABI 重建 |
| 构建 | `electron-vite` + Vite | 主进程、预加载、渲染层三份产物 |
| 界面 | React 19 | 函数组件 + hooks |
| EPUB | `epub.js` | 0.3.x |
| 打包 | `electron-builder` | NSIS + portable |
| Markdown | `markdown-it` | 只做渲染，不做编辑；TXT / Markdown 转换也用它 |
| 批注编辑 | Markdown 文本域 + 编辑／预览切换 | M2 未引入 CodeMirror，保持零额外依赖；需要语法高亮时再评估 |
| 测试 | Vitest | 纯逻辑单测，不做 E2E |

### 2.1 新增依赖的理由

| 依赖 | 为什么不能用现有栈 | 体积（gzip） |
| --- | --- | --- |
| `electron-vite` | 主进程写 TS 需要一个打包步骤；比自建 `tsup + 重启脚本` 更少出错 | devDependency |
| `markdown-it` | 渲染批注与笔记，`epub.js` 自带的 XHTML 处理不适用；TXT / Markdown 转 EPUB 也复用 | ~30 KB |
| `dompurify` | Markdown 渲染结果必须消毒，避免书内 HTML 注入界面（M2 引入） | ~20 KB |
| `vitest` | 重锚与搜索语句构造必须有单测 | devDependency |

**不引入 `better-sqlite3`。** 它在 Windows 上需要 Visual Studio Build Tools 编译，本机与 CI 都没有；而 Electron 44 自带的 `node:sqlite` 是同一个 SQLite（3.53.4），已编入 FTS5 与 `trigram`，且不需要 ABI 重建。代价是 API 仍标记为实验阶段，因此全部数据库调用收在 `electron/db/open.ts` 与 `electron/db/repositories/` 内，将来换驱动只动这一层。

不引入：状态管理库（React 自带 `useReducer` 足够）、UI 组件库、CSS-in-JS、ORM、i18n 框架。

## 3. 进程与模块边界

```
┌──────────────────────── 主进程 ────────────────────────┐
│ 窗口与协议 · SQLite（唯一写入方） · 文件复制与删除      │
│ 网络拦截 · 导入解析（EPUB 元数据） · IPC 路由           │
└───────────────▲───────────────────────────┬────────────┘
                │ ipcRenderer.invoke        │
┌───────────────┴──── 预加载（contextBridge）┴───────────┐
│ 只暴露白名单方法，参数校验后转发；不暴露 ipcRenderer    │
└───────────────▲───────────────────────────┬────────────┘
                │ window.lumen.*            │
┌───────────────┴──────── 渲染层（React）────┴───────────┐
│ 书架 · 阅读器（epub.js）· 标注层 · 搜索 · 笔记 · 导出    │
│ 不读写文件、不读写数据库、不发网络请求                   │
└────────────────────────────────────────────────────────┘
```

硬边界：

- `node:sqlite` 只在 `electron/db/` 下出现；渲染层引用该模块会构建失败（CI 检查 `src/` 中不出现）。
- `epub.js` 只在 `src/reader/` 下出现。
- 渲染层通过 `lib/api.ts` 调用 `window.lumen`，组件不直接写 `window.lumen`。
- 网络拦截在 `session.defaultSession.webRequest`，白名单见 §12。

## 4. 目录结构（规划）

```
electron/
  main.ts                  应用入口：窗口、协议、单实例、网络拦截
  preload.ts               contextBridge 白名单
  ipc/
    register.ts            统一注册，错误统一包装
    handle.ts              入参校验与 Result 包装
    books.ts               导入、列表、读取、移除
    progress.ts            进度读写
    annotations.ts         标注增删改查
    notes.ts               独立笔记
    search.ts              索引写入、正文与标注检索
    tags.ts                标签管理与关联
    export.ts              标注导出、保存 Markdown
  db/
    open.ts                打开数据库、PRAGMA、迁移
    migrations/001_init.sql
    repositories/          books / progress / annotations / search / tags / notes
  library/
    import.ts              读取文件、算 hash、解析元数据、落盘
    epub-meta.ts           只读 container.xml + OPF 与封面
    paths.ts               相对 userData 的路径解析与越界防护
    errors.ts              导入错误码
  security/
    network.ts             请求拦截
shared/
  types.ts                 主进程与渲染层共用的类型
  text-book.ts             TXT / Markdown 解码、章节切分
  locator.ts               标注定位与重锚
  search-query.ts          检索语句构造、片段截取
  export.ts                标注 → Markdown（纯函数）
src/
  main.tsx                 React 挂载
  App.tsx                  路由：书架 / 阅读器 / 搜索 / 笔记
  library/                 书架、封面占位、导入入口
  reader/                  epub.js 生命周期、分页、目录、主题、索引器
  annotations/             选中工具条、高亮渲染、侧栏、批注编辑器、导出预览
  search/                  跨书搜索视图
  notes/                   独立笔记与标签管理
  lib/
    api.ts                 类型化 IPC 客户端
    format.ts              体积、百分比、相对时间
    prefs.ts               localStorage 偏好
    convert/               Markdown / TXT → 内存 EPUB
  global.d.ts              window.lumen 类型声明
  styles.css
docs/                      实施与官网提示词、FTS 实测结论
scripts/
  make-sample-library.mjs  生成 5 本书用于搜索与性能验证
  probe-fts.cjs            FTS5 trigram 实测（npm run probe:fts）
  db-inspect.cjs           只读查看当前数据库（npm run db:inspect）
  cdp-eval.mjs             在渲染层执行表达式（调试用，不提交临时脚本）
  cdp-console.mjs          收集渲染层控制台输出
  cdp-front.mjs            把窗口提到前台并检查 requestAnimationFrame
  make-icon.mjs            应用图标（M4）
build/                     打包图标（不进版本库）
site/                      官网（M4，独立 package）
```

## 5. 数据层

### 5.1 位置与 PRAGMA

- 路径：`app.getPath('userData')/lumen.db`
- 打开时设置：`journal_mode = WAL`、`synchronous = NORMAL`、`foreign_keys = ON`、`busy_timeout = 5000`、`temp_store = MEMORY`
- 版本号放在 `PRAGMA user_version`，与 `migrations/` 下的序号一致。

### 5.2 Schema（`001_init.sql`）

```sql
CREATE TABLE books (
  id            TEXT PRIMARY KEY,              -- 随机 id，不用自增，便于跨设备迁移
  title         TEXT NOT NULL,
  author        TEXT NOT NULL DEFAULT '',
  format        TEXT NOT NULL CHECK (format IN ('epub', 'markdown', 'txt')),
  file_path     TEXT NOT NULL,                 -- 相对 userData，换机后可重定位
  sha256        TEXT NOT NULL UNIQUE,
  size          INTEGER NOT NULL,
  cover_path    TEXT,
  chapter_count INTEGER NOT NULL DEFAULT 0,
  indexed_at    INTEGER,                       -- 空表示尚未建搜索索引
  added_at      INTEGER NOT NULL,
  last_opened_at INTEGER,
  deleted_at    INTEGER                        -- 非空 = 已移出书库，标注保留
);

CREATE TABLE progress (
  book_id   TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  locator   TEXT NOT NULL,                     -- JSON，见 §6.4
  percent   REAL NOT NULL DEFAULT 0,
  chapter   TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

CREATE TABLE annotations (
  id          TEXT PRIMARY KEY,
  book_id     TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  group_id    TEXT,                            -- 跨段落高亮的同组标识
  kind        TEXT NOT NULL CHECK (kind IN ('highlight', 'note', 'bookmark')),
  color       TEXT NOT NULL DEFAULT 'yellow',
  locator     TEXT NOT NULL,                   -- JSON，见 §6.4
  note_md     TEXT NOT NULL DEFAULT '',
  orphaned    INTEGER NOT NULL DEFAULT 0,      -- 1 = 位置失效，只保留原文
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);

CREATE INDEX idx_annotations_book ON annotations(book_id, deleted_at, created_at);
CREATE INDEX idx_annotations_orphan ON annotations(orphaned) WHERE orphaned = 1;

CREATE TABLE tags (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT 'slate',
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
```

约定：

- 所有时间为 Unix 毫秒整数。
- 所有 id 为 `crypto.randomUUID()`。
- 软删统一用 `deleted_at`，读路径默认过滤；只有「彻底删除」才 `DELETE`。
- 书被软删时，`annotations` 与 `notes` 不动；书被彻底删除时级联清理。
- `settings` 只存主进程需要读的项（如窗口状态、数据目录版本）；界面偏好留在 `localStorage`。

### 5.3 迁移

- 启动时读 `user_version`，按序执行未应用的 `migrations/NNN_*.sql`，每个文件包在一个事务里。
- 迁移只增不改：加列、加表、加索引；删列需要重建表并显式写数据搬迁。
- 执行前把数据库文件复制到 `userData/backups/lumen-v<old>-<timestamp>.db`，保留最近 3 份。
- `PRAGMA user_version` 从 1 起；数据库里 `user_version = 0` 视为新库。

### 5.4 文件存储

- 原文件：`userData/books/<bookId>.<ext>`。M1 的实现是一次性 `readFile` 到内存，同一份字节用于算 SHA-256、解析元数据与写盘；单文件上限 200 MB，避免读两遍。超过 200 MB 直接拒绝。
- 封面：`userData/covers/<bookId>.<原扩展名>`，M1 保存 EPUB 内原始图片字节，不做缩略图；书架按封面原始尺寸显示。缩放到 480 px 放到 M4 打包前评估。
- 删除书籍文件只在「彻底删除」时执行；默认移除只写 `deleted_at`，文件保留，重新导入时按 SHA-256 找回标注。

## 6. 关键流程

### 6.1 导入

```
渲染层选择文件 → 主进程逐份处理
  ├─ stat：空文件、非文件、超过 200 MB 直接拒绝
  ├─ 按扩展名判断格式，不支持的返回 UNSUPPORTED
  ├─ 一次性 readFile，计算 SHA-256
  ├─ 查 books.sha256；命中则返回 { status: 'duplicate', bookId }
  ├─ 按扩展名解析元数据
  │    ├─ epub：读 META-INF/container.xml → OPF → title/creator/cover
  │    ├─ md：front matter 的 title/author，否则第一个 `# 标题`，否则文件名
  │    └─ txt：文件名；编码按 UTF-8 → GBK 顺序探测
  ├─ 写入 books/<id>.<ext>，有封面则写 covers/<id>.<ext>
  ├─ INSERT books（失败时删掉刚写的文件）
  └─ 返回 { status: 'ok', book }
```

整批导入逐个返回，渲染层汇总「导入 N 本 / M 本已在书库 / K 本失败」。一本坏书不影响其他本。

限制：单文件 ≤ 200 MB，超过直接拒绝并说明；EPUB 必须含 `META-INF/container.xml` 与可解析 OPF，加密 EPUB 返回 `ENCRYPTED`。

### 6.2 打开一本书

```
books:list / books:get(bookId)
  ├─ 返回元数据与进度摘要（不返回二进制）
  ├─ books:readFile(bookId) → ArrayBuffer
  ├─ EPUB：ArrayBuffer → Blob → new ePub(blob)
  ├─ markdown/txt：解码 → 章节切分 → 内存 EPUB Blob → new ePub(blob)
  ├─ rendition.display(progress.locator?.cfi)（CFI 失效则退回首页）
  └─ 首屏稳定 1.2 秒后生成 locations，校准百分比（索引进 M3）
```

Markdown / TXT 的转换结果按 `bookId` 缓存在内存，最多 3 本（`src/lib/convert/text-epub.ts`）。书内容不可变（每次导入都是新 id），因此不需要失效逻辑。

### 6.3 阅读进度

- `relocated` 事件触发后 400 ms 防抖写入，避免每次翻页都写库。
- 退出阅读器与窗口关闭前强制 flush，否则最后一次翻页丢失。
- 百分比优先用 epub.js 的 locations 表；表尚未生成时按「章节序号 + 本章页码比例」估算，生成后校准一次。
- 进度不记录阅读时长，也不上报任何统计。

### 6.4 locator 结构

```ts
type Locator = {
  format: 'epub' | 'markdown' | 'txt'
  cfi: string | null          // epub.js 生成，可能为 null（书签以外的情况不写 null）
  href: string                // 章节相对路径，已归一化
  chapterIndex: number
  chapterTitle: string
  quote: string               // 选中原文，最长 500 字；书签为空串
  prefix: string              // 原文前 32 字，用于消歧
  suffix: string              // 原文后 32 字
  page: number                // 该章内页码，仅用于展示
  percent: number             // 全书百分比，0–1
}
```

`locator` 以 JSON 文本存库，读取时经 `shared/locator.ts` 的 `parseLocator` 校验（不引入 zod，手写校验只覆盖固定字段）；校验失败视为 `orphaned`，不抛错阻断整页渲染。标注的 `quote` 必填，书签写空串。

### 6.5 标注创建

```
选中文字 → Range
  ├─ 跨段落：按块级元素切分为多段，各自生成 locator，共用 groupId
  ├─ 单段：contents.cfiFromRange(range) 得到 cfi
  ├─ quote 取 range.toString()，prefix/suffix 从同一文本节点向前后取 32 字
  └─ INSERT annotations（kind = highlight，note_md 为空）
```

批注写入走 `annotations:update`，库里只存 Markdown 源；展示时才经 `markdown-it` 渲染并用 `dompurify` 消毒，不把渲染后的 HTML 入库。

### 6.6 重锚（核心）

打开一本书后，对本书所有未删除标注执行一次校验：

```
for each annotation:
  if annotation.orphaned: 跳过
  range = tryCfi(annotation.locator.cfi)
  if range 且 normalize(range.text).includes(normalize(quote)): 保留
  else:
    chapter = spine.get(href) ?? spine.get(chapterIndex)
    text = chapterText(chapter)
    candidates = 所有 quote 出现位置
    best = 按 prefix/suffix 相似度打分取最高
    if best.score >= 0.6:
        range = rangeFromOffsets(chapter, best.start, best.end)
        cfi = contents.cfiFromRange(range)
        写回 locator.cfi 与新 href
    else:
        UPDATE annotations SET orphaned = 1
```

约束：

- `normalize` 去掉空白差异（全角空格、连续空白、换行），不做繁简或标点转换。
- 打分用前后各 32 字的字符级 Jaccard 相似度，阈值 0.6；阈值是常量，见 §12。
- 重锚只写回成功的结果，不写回失败，避免把可能正确的旧 CFI 冲掉。
- 重锚在渲染完成后异步执行，不阻塞首屏；结果通过事件让侧栏刷新「位置失效」标记。

### 6.7 搜索索引

- 触发：打开一本书并完成首屏渲染后，空闲 2.5 秒自动开始；`indexedAt` 非空则跳过。没有手动「建立索引」按钮。
- 执行位置：渲染层（能拿到 epub.js 解析后的 DOM），逐章 `spine.get(i).load()` → `document.body.textContent`。
- 批量：累计 30 万字符提交一次；单章超过 50 万字符截断；单次 IPC 最多 500 块 / 500 万字符。
- 提交：`search:indexBegin` 清空旧块并把 `indexed_at` 置空 → 多次 `search:indexChunks`（单事务写入）→ `search:indexFinish` 写时间戳。FTS 由触发器同步。
- 章节标题取 TOC 中与 href 对应的标题，取不到时用 `第 N 节`。
- 索引中途失败或被取消时不写 `indexed_at`，下次打开重新索引。
- 重新导入同一本书（不同 sha256）视为新书，各自索引。

查询：

| 输入 | 语句 |
| --- | --- |
| 长度 ≥ 3 | `SELECT ... FROM search_fts JOIN search_chunks ON chunks.id = search_fts.rowid WHERE search_fts MATCH ? ORDER BY bm25(search_fts) LIMIT ?` |
| 长度 < 3（中文常见） | `... WHERE chunks.text LIKE ? ESCAPE '\\' ... LIMIT ?`，参数已是 `%词%` |

`MATCH` 的参数只由 `shared/search-query.ts` 生成：查询串内的 `"` 写成两个 `""`，整体包成 `"..."`，避免 FTS 语法注入；LIKE 的 `\`、`%`、`_` 逐个转义。命中片段在渲染层用 `makeSnippet` 截取并高亮，不使用 SQL 的 `snippet()`。

标注检索走普通 SQL（`locator` JSON 与 `note_md` 的 `LIKE`），标签过滤是 `annotation_tags` 的 `EXISTS` 子查询；结果按 `updated_at` 倒序。

已知代价（2026-10-21 实测，详见 `docs/probe-fts.md`）：50 万字语料下 trigram 表为普通表的 1.47 倍（语料重复度高，属乐观值），建索引 36 ms，3 字以上 `MATCH` 0.02–0.12 ms，2 字 `LIKE` 0.45–0.64 ms。因此短查询直接走 `LIKE`，不另建倒排；用真实书籍复核后若超过正文 3 倍，再考虑只索引标注所在章节。

### 6.8 导出

渲染层点「导出全部 / 导出所选」→ `export:bookAnnotations({ bookId, ids? })` 查标注并调用 `shared/export.ts` 的纯函数生成 Markdown → 弹出预览 → 用户选「保存为文件」或「复制」。「保存」再走 `app:saveText` 打开系统保存对话框并写盘，渲染层不碰文件系统。

排序按 `chapterIndex`，同章按 CFI；跨段落同组标注各自成段。空标注也生成带 front matter 的文件，明确写「这本书还没有标注」。

```markdown
---
title: 书名
author: 作者
exported_at: 2026-10-21T12:00:00.000Z
lumen_version: 0.0.4
---

# 书名

作者

## 第三章 标题

> 原文引用

批注正文（Markdown）

---
```

## 7. IPC 契约

统一返回：

```ts
type Ok<T> = { ok: true; data: T }
type Err = { ok: false; code: ErrorCode; message: string }  // message 为中文，含下一步建议
type Result<T> = Ok<T> | Err
```

| 通道 | 入参 | 返回 |
| --- | --- | --- |
| `app:versions` | — | `AppVersions` |
| `app:openUserData` | — | `null` |
| `app:pickFiles` | — | `string[]`（取消时为空数组） |
| `app:saveText` | `{ suggestedName, content }` | `{ path } \| null`（取消时 null） |
| `books:import` | `{ paths: string[] }` | `ImportResult[]` |
| `books:list` | — | `ShelfBook[]` |
| `books:get` | `{ id }` | `ShelfBook` |
| `books:readFile` | `{ id }` | `ArrayBuffer` |
| `books:readCover` | `{ id }` | `{ mime, data: ArrayBuffer } \| null` |
| `books:remove` | `{ id, purge?: boolean }` | `null` |
| `books:touch` | `{ id }` | `null` |
| `progress:get` | `{ bookId }` | `Progress \| null` |
| `progress:save` | `{ bookId, locator, percent, chapter }` | `null` |
| `annotations:list` | `{ bookId }` | `Annotation[]` |
| `annotations:create` | `CreateAnnotationInput` | `Annotation` |
| `annotations:update` | `{ id, color?, noteMd?, locator?, orphaned? }` | `Annotation` |
| `annotations:delete` | `{ id }` | `Annotation`（软删后的记录） |
| `annotations:restore` | `{ id }` | `Annotation` |
| `search:indexBegin` | `{ bookId }` | `null` |
| `search:indexChunks` | `{ bookId, chunks: IndexChunk[] }` | `null` |
| `search:indexFinish` | `{ bookId }` | `null` |
| `search:query` | `{ q, scope: 'text' \| 'annotations', tagId?, limit? }` | `SearchHit[]` |
| `tags:list` | — | `Tag[]` |
| `tags:create` | `{ name }` | `Tag` |
| `tags:rename` | `{ id, name }` | `Tag` |
| `tags:delete` | `{ id }` | `null` |
| `tags:merge` | `{ sourceId, targetId }` | `Tag` |
| `tags:forBook` | `{ bookId }` | `AnnotationTag[]` |
| `tags:setForAnnotation` | `{ annotationId, tagIds: string[] }` | `null` |
| `notes:list` | — | `Note[]` |
| `notes:save` | `{ id?, bookId, title, bodyMd }` | `Note` |
| `notes:delete` | `{ id }` | `null` |
| `export:bookAnnotations` | `{ bookId, ids?: string[] }` | `{ markdown, count }` |

错误码：`DUPLICATE`、`ENCRYPTED`、`UNSUPPORTED`、`TOO_LARGE`、`PARSE_FAILED`、`NOT_FOUND`、`DB_ERROR`、`IO_ERROR`、`INTERNAL`。渲染层按 `code` 决定下一步提示，不解析 `message`。

渲染层类型定义放在 `src/lib/api.ts`，主进程复用同一份 `shared/types.ts`（两个 `tsconfig` 都包含），避免两边各写一套；新增通道必须同时改 `electron/preload.ts` 的 `LumenApi` 实现。

## 8. 渲染层结构

```
App
├─ 顶栏              书架 / 搜索 / 笔记切换、导入、数据目录、版本号
├─ ShelfView          书库：网格、筛选、拖放导入、移除
├─ ReaderView
│  ├─ 顶栏            返回、书名、目录、标注、书签、排版设置
│  ├─ EpubCanvas      epub.js 挂载点 + 点击翻页层
│  ├─ TocDrawer       目录（递归展平、当前章高亮）
│  ├─ AnnotationRail  侧栏：按章节分组的全部标注、多选、导出
│  ├─ SelectionMenu   选中浮动工具条（四色高亮、批注、复制）
│  ├─ NoteEditor      Markdown 文本域 + 预览、标签、删除
│  └─ ExportDialog    导出预览、复制、保存
├─ SearchView         跨书搜索（正文 / 标注、标签过滤）
└─ NotesView          独立笔记与标签管理
```

状态策略：

- 全部用函数组件 + `useState`/`useCallback`，不引入全局 store；跨组件共享靠 props 与回调。
- 阅读器状态（`rendition`、`book`、当前 locator、选中状态）留在 `ReaderView` 内的 ref，不进 React 树，避免每次翻页导致整页重渲染。
- 跨视图通知只有三种：`refresh()` 重新拉取、`onExit` 回书架、`onIndexed` 更新书架索引标记。
- 搜索条件放在 `sessionStorage` 的 `lumen:search`，返回搜索页时保留输入；阅读偏好与上次打开的书在 `localStorage`。

## 9. 安全与隐私

| 项 | 做法 |
| --- | --- |
| 窗口 | `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`、`webviewTag: false` |
| 预加载 | 只暴露白名单方法；不暴露 `ipcRenderer`、`require`、`process` |
| 协议 | 生产用 `lumen://` 自定义协议加载 `dist`，避免 `file://` 源不稳定导致数据目录漂移 |
| 外链 | `setWindowOpenHandler` 一律 `deny`；`will-navigate` 只允许应用自身源；`shell.openExternal` 仅接受 `https:` |
| 网络 | `session.defaultSession.webRequest.onBeforeRequest` 白名单见 §12，其余 `cancel` 并写 `userData/logs/network.log` |
| CSP | `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'` |
| 书内 HTML | 在 iframe 内渲染，沙箱由 epub.js 控制；不向主窗口注入书内内容 |
| Markdown | 渲染后 `dompurify`，禁用 `<script>`、`<iframe>`、事件属性 |

## 10. 构建与打包

- `electron-vite build` 产出 `dist/main`、`dist/preload`、`dist/renderer`。
- `electron-builder` 配置在 `package.json` 的 `build` 字段：
  - `files`: `dist/**/*`、`package.json`
  - `win.target`: `nsis` + `zip`，均 x64；`nsis.oneClick: false`、`perMachine: false`、`allowToChangeInstallationDirectory: true`、`createDesktopShortcut: true`
  - 产物命名：`nsis.artifactName = Lumen-${version}-setup.${ext}`，`zip.artifactName = Lumen-${version}-portable.${ext}`
  - 中间目录 `../lumen-desktop-build/`（项目同级，避开编辑器和杀毒软件锁定 `.asar`），`npm run collect` 把 `.exe` 与 `.zip` 复制回仓库内 `desktop-dist/`
- 原生模块：**没有**。`node:sqlite` 随 Electron 一起分发，升级 Electron 时只需确认 `PRAGMA` 与 FTS5 仍可用（`npm run probe:fts` 会顺带打印 SQLite 版本）。
- 图标：`scripts/make-icon.mjs` 纯 Node 生成 `build/icon.ico` 与 `icon.png`，不引入图形库；`build/` 不进版本库。

## 11. 发布流水线

```
git tag v* → GitHub Actions（.github/workflows/release.yml）
  ├─ windows-latest：npm ci → typecheck → test → build → electron-builder --win
  ├─ 校验 tag 与 package.json version 相等
  ├─ 计算 SHA256SUMS.txt
  ├─ softprops/action-gh-release 创建 Release，上传 setup.exe / portable.zip / SHA256SUMS.txt
  ├─ 用 Release 资产信息生成 site/src/data/releases.json
  └─ 构建 site/ 并部署到 GitHub Pages（actions/deploy-pages）
```

- `releases.json` 是官网唯一数据源，字段见 `docs/WEBSITE_PROMPT.md`；首页、下载页、更新日志都从它读版本、大小与校验和。
- 开发期里程碑（`0.0.x`）只打 tag，不创建 Release；`0.1.0` 起才发布。
- Actions 使用 `GITHUB_TOKEN`，不配置任何第三方密钥。
- 发布前必须通过 PRD §9 清单；CI 只保证构建与单测，不跑 E2E。

## 12. 常量与配置

| 常量 | 值 | 位置 |
| --- | --- | --- |
| 应用版本 | `0.0.4`（M3 知识库），版本节奏见 PRD §1.2 | `package.json` |
| 数据库 schema 版本 | `1` | `PRAGMA user_version` |
| 单文件导入上限 | 200 MB | `electron/library/import.ts` |
| 内存 EPUB 缓存数量 | 3 | `src/lib/convert/text-epub.ts` |
| 进度写入防抖 | 400 ms | `src/reader/ReaderView.tsx` |
| 删除标注撤销窗口 | 5 s | `src/reader/ReaderView.tsx` |
| 重锚相似度阈值 | 0.6 | `shared/locator.ts` |
| quote 最大长度 | 500 字 | `shared/locator.ts` |
| 上下文长度 | 32 字 | `shared/locator.ts` |
| 搜索默认条数 | 50，上限 200 | `electron/ipc/search.ts` |
| 短查询 LIKE 阈值 | 查询长度 < 3 字符时走 `LIKE`，≥3 走 `MATCH` | `shared/search-query.ts` |
| 索引触发延迟 | 2.5 s 空闲 | `src/reader/ReaderView.tsx` |
| 索引批量 | 每批 30 万字符；单章截断 50 万字符 | `src/reader/indexer.ts` |
| 单次索引上限 | 500 块 / 500 万字符 | `electron/ipc/search.ts` |
| 标签名上限 | 40 字 | `electron/ipc/tags.ts` |
| 单条标注标签数上限 | 20 | `electron/ipc/tags.ts` |
| 笔记正文上限 | 50 万字符 | `electron/ipc/notes.ts` |
| 批注正文上限 | 20 万字符 | `electron/ipc/annotations.ts` |
| 迁移备份保留 | 3 份 | `electron/db/open.ts` |
| localStorage 前缀 | `lumen:` | `src/lib/prefs.ts`、`src/search/SearchView.tsx` |
| 允许的请求源 | `lumen:`、`devtools:`、`chrome-extension:`、`chrome-devtools:`、`data:`、`blob:`、`about:`；开发期加渲染服务器与其 WebSocket 源 | `electron/security/network.ts` |

## 13. 测试策略

| 对象 | 方式 |
| --- | --- |
| `shared/locator.ts` | 纯函数单测：quote/prefix/suffix 生成、归一化、Jaccard 打分、候选选择 |
| 章节切分与 Markdown 转换 | 输入固定文本，断言生成的章节数、标题、XHTML 结构 |
| 搜索语句构造 | 断言长查询、短查询、含引号与 `*` 的查询被正确转义 |
| 迁移执行 | 在内存数据库上从 0 迁到最新，断言表与索引存在 |
| 导出格式 | 固定标注集合 → 断言 Markdown 快照 |

不做 E2E：epub.js 的分页依赖真实 Chromium，改用 PRD §9 的清单手测，必要时用 `--remote-debugging-port` 走 CDP 抽查。

## 14. 已知限制与风险

| 限制 | 现状 | 后续 |
| --- | --- | --- |
| PDF | 不支持 | V1 引入 pdf.js，标注单独一套 locator（页码 + 矩形坐标） |
| 固定版式 EPUB | 不支持 | 不做 |
| 首次搜索前需要索引 | 打开一本书后才索引，未打开的书搜不到 | V1 做隐藏窗口批量索引 |
| trigram 索引体积 | 50 万字实测 1.47 倍（重复语料） | 用真实书复核，超 3 倍再改索引范围 |
| `node:sqlite` 处于实验阶段 | API 可能随 Node/Electron 版本变化 | 全部调用收在 `electron/db/`，升级 Electron 时跑 `probe:fts` 与冒烟 |
| 书内链接 | 脚注可能被翻页热区覆盖 | 扩大热区避让，见阅读器实现 |
| 代码签名 | 未签名 | 购买证书后设置 `CSC_LINK`，Actions 加签名步骤 |
| macOS | 未构建 | V1 视需要 |
