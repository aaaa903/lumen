# Lumen 技术设计

版本：0.12（V1 功能完成：v0.4.0 为 V1 最终版本，进入维护）
对应 PRD：0.12
最后更新：2026-10-22

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
| PDF | `pdfjs-dist` | 5.7.x，worker 与 cMap 随应用分发，不联网 |
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
| `pdfjs-dist` | PDF 版式固定，epub.js 无法渲染；pdf.js 是唯一维护活跃、含文字层与书签大纲的纯 JS 实现（V1 引入） | 渲染包 ~300 KB gzip，worker 与 cMap 另行分发 |
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
- `epub.js` 只在 `src/reader/` 下出现；`pdfjs-dist` 只在 `src/reader/PdfViewer.tsx` 里出现。
- 渲染层通过 `lib/api.ts` 调用 `window.lumen`，组件不直接写 `window.lumen`。
- 网络拦截在 `session.defaultSession.webRequest`，白名单见 §12。
- 索引不占前台：`electron/indexer.ts` 排队，隐藏窗口加载同一份渲染产物（`?worker=index`）执行 `src/reader/IndexWorker.tsx`，主进程只存队列状态、租约与重试次数。
- PDF 的元数据（标题、作者、页数）由渲染层用 pdf.js 读出后经 `books:updateMeta` 回填；主进程不引入第二套 PDF 解析器。

## 4. 目录结构（规划）

```
electron/
  main.ts                  应用入口：窗口、协议、单实例、网络拦截
  window-state.ts          窗口尺寸/位置/最大化的记忆
  preload.ts               contextBridge 白名单
  ipc/
    register.ts            统一注册，错误统一包装
    handle.ts              入参校验与 Result 包装
    books.ts               导入、列表、读取、移除、PDF 元数据回填
    open-files.ts          「用 Lumen 打开」与第二实例的文件转交
    progress.ts            进度读写
    annotations.ts         标注增删改查
    notes.ts               独立笔记
    search.ts              索引写入、正文与标注检索
    indexer.ts             后台索引任务通道（领取 / 归还 / 完成）
    tags.ts                标签管理与关联
    export.ts              标注导出、库导出、保存 Markdown
  indexer.ts               索引队列、隐藏窗口生命周期、租约与重试
  db/
    open.ts                打开数据库、PRAGMA、迁移、外键校验
    migrations/001_init.sql
    migrations/002_pdf.sql books.format 增加 pdf、books.page_count
    migrations/003_search_chunks.sql 清空旧索引，等待按段落重建
    repositories/          books / progress / annotations / search / tags / notes / settings
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
  references.ts            批注引用的解析、标签替换与展示文案
  export.ts                标注 → Markdown（纯函数）
src/
  main.tsx                 React 挂载；`?worker=index` 时挂载索引窗口
  App.tsx                  路由：书架 / 阅读器 / 搜索 / 笔记
  library/                 书架、封面占位、导入入口、移除确认
  settings/                设置对话框（数据目录、版本、清空数据、库导出）
  reader/                  epub.js 生命周期、分页/滚动、目录、主题、索引器
    PdfViewer.tsx          pdf.js 渲染、页码进度、PDF 标注与目录
    ReaderSearch.tsx       书内搜索面板：检索当前书、跳转命中
    IndexWorker.tsx        隐藏窗口里的索引循环
    indexer.ts             逐章取正文、分批提交
    toc.ts                 目录归一化与 spine 兜底
  annotations/             选中工具条、高亮渲染、侧栏、批注编辑器、导出预览
  search/                  跨书搜索视图
  search/Snippet.tsx       检索片段：标出命中词
  notes/                   独立笔记与标签管理
  lib/
    api.ts                 类型化 IPC 客户端
    format.ts              体积、百分比、相对时间
    note-markdown.ts       批注 Markdown 渲染，含引用链接
    prefs.ts               localStorage 偏好（含 `lumen:reader-flow`）
    convert/               Markdown / TXT → 内存 EPUB
  global.d.ts              window.lumen 类型声明
  styles.css
docs/                      实施与官网提示词、FTS 实测结论
scripts/
  make-sample-library.mjs  生成 6 本测试书（含 PDF）用于搜索与性能验证
  copy-pdfjs-assets.mjs    把 pdf.js 的 cMap 与标准字体复制到 public/pdfjs/
  probe-fts.cjs            FTS5 trigram 实测（npm run probe:fts）
  db-inspect.cjs           只读查看当前数据库（npm run db:inspect）
  cdp-eval.mjs             在渲染层执行表达式（调试用，不提交临时脚本）
  cdp-console.mjs          收集渲染层控制台输出
  cdp-front.mjs            把窗口提到前台并检查 requestAnimationFrame
  make-icon.mjs            应用图标
  collect-desktop.mjs      把当前版本产物复制到 desktop-dist/
  release-assets.mjs       计算 SHA-256、写 SHA256SUMS.txt、回填 releases.json
  release-notes.mjs        由 releases.json 生成 Release 说明
public/pdfjs/              pdf.js 的 cmaps 与 standard_fonts（不进版本库，predev / prebuild 生成）
build/                     打包图标（不进版本库）
site/
  build.mjs                零依赖静态站生成器（读配置与 releases.json）
  site.config.json         owner / repo / tagline
  src/styles.css           站点样式，CSS 变量 + 深浅色
  src/site.js              仅做校验和复制
  src/assets/              截图与图标（本地文件）
  src/data/releases.json   版本、说明、资产大小与 SHA-256（唯一数据源）
.github/workflows/
  release.yml              推 v* 标签：构建 → Release → 官网 → Pages
  site.yml                 只改官网时的 Pages 部署
```

## 5. 数据层

### 5.1 位置与 PRAGMA

- 路径：`app.getPath('userData')/lumen.db`
- 打开时设置：`journal_mode = WAL`、`synchronous = NORMAL`、`foreign_keys = ON`、`busy_timeout = 5000`、`temp_store = MEMORY`
- 版本号放在 `PRAGMA user_version`，与 `migrations/` 下的序号一致。

### 5.2 Schema（`001_init.sql` + `002_pdf.sql` + `003_search_chunks.sql`）

`001_init.sql` 建全部核心表；`002_pdf.sql` 重建 `books`，把 `format` 的枚举扩到 `pdf` 并加 `page_count`；`003_search_chunks.sql` 不改表结构，清空旧索引并把非 PDF 书的 `indexed_at` 置空，让后台按段落级规则重建。下面是迁移后的现状：

```sql
CREATE TABLE books (
  id            TEXT PRIMARY KEY,              -- 随机 id，不用自增，便于跨设备迁移
  title         TEXT NOT NULL,
  author        TEXT NOT NULL DEFAULT '',
  format        TEXT NOT NULL CHECK (format IN ('epub', 'markdown', 'txt', 'pdf')),
  file_path     TEXT NOT NULL,                 -- 相对 userData，换机后可重定位
  sha256        TEXT NOT NULL UNIQUE,
  size          INTEGER NOT NULL,
  cover_path    TEXT,
  chapter_count INTEGER NOT NULL DEFAULT 0,
  page_count    INTEGER NOT NULL DEFAULT 0,    -- 仅 PDF 使用，首次打开回填
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
- `books.sha256` 有 `UNIQUE` 约束，软删的行仍占着这个哈希。因此导入去重只查 `deleted_at IS NULL`；同一文件命中软删记录时恢复原行（清空 `deleted_at`），不新建，否则要么违反唯一约束，要么让标注与进度失去归属。
- `settings` 只存主进程需要读的项（如窗口状态、数据目录版本）；界面偏好留在 `localStorage`。

### 5.3 迁移

- 启动时读 `user_version`，按序执行未应用的 `migrations/NNN_*.sql`，每个文件包在一个事务里。
- 迁移只增不改：加列、加表、加索引；删列需要重建表并显式写数据搬迁。
- 执行前把数据库文件复制到 `userData/backups/lumen-v<old>-<timestamp>.db`，保留最近 3 份。
- `PRAGMA user_version` 从 1 起；数据库里 `user_version = 0` 视为新库。
- 需要重建表的迁移（当前只有 `002_pdf`）在事务外临时 `PRAGMA foreign_keys = OFF`，否则 `DROP TABLE books` 会按 `ON DELETE CASCADE` 清空 `progress`、`annotations`、`search_chunks`。迁移结束立即恢复外键，并跑 `PRAGMA foreign_key_check`；有违例就抛错停止启动，不带病写数据。
- `002_pdf` 先把旧表数据复制到 `books_new`（`page_count` 填 0），再删旧表、改名。子表的外键仍指向表名 `books`，重建后无需改动。
- `003_search_chunks` 是纯数据迁移：`DELETE FROM search_chunks` 后把非 PDF 书的 `indexed_at` 置空。旧库里的一块是一整章，书内搜索只能报每章第一处；清空后由启动扫描重新排队，按段落重建。书、标注、进度与笔记都不动。

### 5.4 文件存储

- 原文件：`userData/books/<bookId>.<ext>`。M1 的实现是一次性 `readFile` 到内存，同一份字节用于算 SHA-256、解析元数据与写盘；单文件上限 200 MB，避免读两遍。超过 200 MB 直接拒绝。
- 封面：`userData/covers/<bookId>.<原扩展名>`，M1 保存 EPUB 内原始图片字节，不做缩略图；书架按封面原始尺寸显示。缩放到 480 px 放到 M4 打包前评估。
- 删除书籍文件只在「彻底删除」时执行；默认移除只写 `deleted_at`，文件保留。恢复有两条路：书架底部「已移除」分组直接清空 `deleted_at`，或重新导入同一文件时按 SHA-256 命中并恢复原行，标注、进度与笔记都接回。

## 6. 关键流程

### 6.1 导入

```
渲染层选择文件 → 主进程逐份处理
  ├─ stat：空文件、非文件、超过 200 MB 直接拒绝
  ├─ 按扩展名判断格式，不支持的返回 UNSUPPORTED
  ├─ 一次性 readFile，计算 SHA-256
  ├─ 查 books.sha256（只查未移出的行）；命中则返回 { status: 'duplicate', bookId }
  ├─ 查同一哈希的软删记录；命中则清空 deleted_at、返回 { status: 'restored', book }
  │    └─ 标注、进度、笔记与上次打开位置原样接回；已有索引的不重新排队
  ├─ 按扩展名解析元数据
  │    ├─ epub：读 META-INF/container.xml → OPF → title/creator/cover
  │    ├─ pdf：先用文件名；标题、作者、页数等首次打开后由 pdf.js 回填
  │    ├─ md：front matter 的 title/author，否则第一个 `# 标题`，否则文件名
  │    └─ txt：文件名；编码按 UTF-8 → GBK 顺序探测
  ├─ 写入 books/<id>.<ext>，有封面则写 covers/<id>.<ext>
  ├─ INSERT books（失败时删掉刚写的文件）
  └─ 返回 { status: 'ok', book }
```

整批导入逐个返回，渲染层汇总「导入 N 本 / 恢复 M 本 / K 本已在书库 / J 本失败」。一本坏书不影响其他本。

限制：单文件 ≤ 200 MB，超过直接拒绝并说明；EPUB 必须含 `META-INF/container.xml` 与可解析 OPF，加密 EPUB 返回 `ENCRYPTED`。PDF 只在导入时按扩展名识别，真正能否打开由首次阅读时的 pdf.js 判断并给出错误；加密 PDF 提示「有密码，暂不支持打开」。

导入成功后：EPUB / Markdown / TXT 立即 `indexer.enqueue(bookId)`；PDF 不参与全文检索，直接写 `indexed_at`，避免书架一直显示「未索引」。

### 6.2 打开一本书

```
books:list / books:get(bookId)
  ├─ 返回元数据与进度摘要（不返回二进制）
  ├─ books:readFile(bookId) → ArrayBuffer
  ├─ EPUB：ArrayBuffer → Blob → new ePub(blob)
  ├─ markdown/txt：解码 → 章节切分 → 内存 EPUB Blob → new ePub(blob)
  ├─ pdf：ArrayBuffer → pdf.js getDocument → 逐页 canvas + 文字层
  ├─ EPUB：rendition.display(progress.locator?.cfi)（CFI 失效则退回首页）
  ├─ PDF：滚到 progress.locator.page（页码越界则回第一页）
  └─ 首屏稳定 1.2 秒后生成 locations，校准百分比（索引由后台窗口负责）
```

Markdown / TXT 的转换结果按 `bookId` 缓存在内存，最多 3 本（`src/lib/convert/text-epub.ts`）。书内容不可变（每次导入都是新 id），因此不需要失效逻辑。

滚动模式不换渲染链路：仍在 `epub.js` 里，把 `renderTo` 的 `flow` 设为 `scrolled-doc`；切换时调用 `rendition.flow()` 重排，进度、目录、CFI 与标注全部继续有效。翻页键在滚动模式下改为对 epub.js 内部容器 `scrollBy` 一屏，到章底再 `next()`。

### 6.3 阅读进度

- `relocated` 事件触发后 400 ms 防抖写入，避免每次翻页都写库。
- 退出阅读器与窗口关闭前强制 flush，否则最后一次翻页丢失。
- 百分比优先用 epub.js 的 locations 表；表尚未生成时按「章节序号 + 本章页码比例」估算，生成后校准一次。
- 进度不记录阅读时长，也不上报任何统计。

### 6.4 locator 结构

```ts
type Locator = {
  format: 'epub' | 'markdown' | 'txt' | 'pdf'
  cfi: string | null          // epub.js 生成；PDF 与书签为 null
  href: string                // 章节相对路径；PDF 为 page-<n>
  chapterIndex: number
  chapterTitle: string
  quote: string               // 选中原文，最长 500 字；书签为空串
  prefix: string              // 原文前 32 字，用于消歧
  suffix: string              // 原文后 32 字
  page: number                // EPUB 为章内页码；PDF 为绝对页码
  percent: number             // 全书百分比，0–1
}
```

`locator` 以 JSON 文本存库，读取时经 `shared/locator.ts` 的 `parseLocator` 校验（不引入 zod，手写校验只覆盖固定字段）；校验失败视为 `orphaned`，不抛错阻断整页渲染。标注的 `quote` 必填，书签写空串。

PDF 不存矩形坐标：坐标随缩放与窗口宽度变化，存下来也会失效。高亮每次渲染页面时，用 `quote` 在该页文字层里重新查找区间并画上方块。

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

PDF 的校验换一种方式（没有 CFI 可用）：

```
for each annotation (最多前 200 条):
  page = annotation.locator.page
  if page 超出总页数: 标记 orphaned
  text = 该页文字层的纯文本
  if normalize(text).includes(normalize(quote)): 保留
  else: 标记 orphaned
```

只读前 200 条是为了打开上千条标注的书时不卡住；超出的条目不校验，保持原状。扫描件没有文字层，`quote` 必然对不上，会标记失效——这是已知限制，不做 OCR。

### 6.7 搜索索引

索引不再由阅读器顺带完成，而是导入即排队、由隐藏窗口执行：

```
导入成功 / 打开未索引的书 / 启动时扫描
  └─ indexer.enqueue(bookId)（主进程去重，PDF 忽略）
       └─ 需要时创建隐藏窗口 lumen://app/index.html?worker=index
            └─ IndexWorker 循环 indexer:next → 领任务（带 180 s 租约）
                 ├─ books:get → 非 PDF → loadBookAsEpub → new ePub
                 ├─ 逐章 spine.get(i).load() → chunkParagraphs(body) 按块级元素切段
                 └─ search:indexBegin → 分批 search:indexChunks → search:indexFinish
            └─ indexer:complete(bookId, ok) → 主进程通知所有界面窗口刷新书架
```

- 队列：主进程内存 `Set` 去重，`MAX_ATTEMPTS = 2`；失败后 4 s 重试一次，仍失败就等下次启动。
- 租约：领到任务 180 s 内没有完成报告（窗口崩溃、页面冻结、热更新丢回调）就收回重排，避免书架永远「未索引」。
- 归还：索引窗口卸载（React StrictMode 双跑、HMR）前调用 `indexer:release`，任务原样回队且不计重试次数。
- 空闲：队列为空 20 s 后关闭隐藏窗口；主窗口关闭时立即销毁，避免进程多留。
- 批量：累计 30 万字符提交一次；单次 IPC 最多 500 块 / 500 万字符。
- 切块：按 `p` / `h1`–`h6` / `li` / `blockquote` / `pre` / `dd` / `dt` / `td` / `th` / `figcaption` / `div` 等块级元素切段，行内标签不拆开；单块超过 2000 字再等分。一块对应一条 `search_chunks`，因此同一章的多处命中能分别列出。
- 迁移：`003_search_chunks` 清空旧的一章一块索引，启动扫描按新规则重建；重建期间书内搜索只覆盖已写入的部分，界面会提示。
- 提交：`search:indexBegin` 清空旧块并把 `indexed_at` 置空 → 多次 `search:indexChunks`（单事务写入）→ `search:indexFinish` 写时间戳。FTS 由触发器同步。
- 章节标题取 TOC 中与 href 对应的标题，取不到时用 `第 N 节`。
- 中途失败或被取消时不写 `indexed_at`，任务失败后重试；PDF 导入时直接写 `indexed_at`，不进入队列。
- 重新导入同一本书（不同 sha256）视为新书，各自索引。

查询：

| 输入 | 语句 |
| --- | --- |
| 长度 ≥ 3 | `SELECT ... FROM search_fts JOIN search_chunks ON chunks.id = search_fts.rowid WHERE search_fts MATCH ? AND b.deleted_at IS NULL ORDER BY bm25(search_fts) LIMIT ?` |
| 长度 < 3（中文常见） | `... WHERE chunks.text LIKE ? ESCAPE '\\' ... LIMIT ?`，参数已是 `%词%` |
| 限定一本书（书内搜索） | 同上，额外加 `AND chunks.book_id = ?`；排序改为 `chapter_index ASC, id ASC`，按阅读顺序排列，不再按相关度 |

`MATCH` 的参数只由 `shared/search-query.ts` 生成：查询串内的 `"` 写成两个 `""`，整体包成 `"..."`，避免 FTS 语法注入；LIKE 的 `\`、`%`、`_` 逐个转义。命中片段在渲染层用 `makeSnippet` 截取并高亮，不使用 SQL 的 `snippet()`。`search:query` 的 `bookId` 可空：为空表示整库，非空时只查这本书，供书内搜索使用；整库结果带 `snippet / matchStart / matchLength`，跳转时同时用片段与命中词定位。

标注检索走普通 SQL（`locator` JSON 与 `note_md` 的 `LIKE`），标签过滤是 `annotation_tags` 的 `EXISTS` 子查询；结果按 `updated_at` 倒序。

已知代价（2026-10-21 实测，详见 `docs/probe-fts.md`）：50 万字语料下 trigram 表为普通表的 1.47 倍（语料重复度高，属乐观值），建索引 36 ms，3 字以上 `MATCH` 0.02–0.12 ms，2 字 `LIKE` 0.45–0.64 ms。因此短查询直接走 `LIKE`，不另建倒排；用真实书籍复核后若超过正文 3 倍，再考虑只索引标注所在章节。

### 6.8 导出

渲染层点「导出全部 / 导出所选」→ `export:bookAnnotations({ bookId, ids? })` 查标注并调用 `shared/export.ts` 的纯函数生成 Markdown → 弹出预览 → 用户选「保存为文件」或「复制」。「保存」再走 `app:saveText` 打开系统保存对话框并写盘，渲染层不碰文件系统。

排序按 `chapterIndex`，同章按 CFI；跨段落同组标注各自成段。空标注也生成带 front matter 的文件，明确写「这本书还没有标注」。

批注里的引用 `[[ann:<id>]]` 在导出时替换成「章节 + 原文片段」（默认截 40 字）。解析用的标注池默认是本次导出的条目；只导出勾选的几条时，调用方必须把整本书的标注作为 `referencePool` 传进来，否则勾选范围外的目标会被误判成已删除。目标确实不存在时写「引用的标注已不存在」，导出文件不因此中断。

库导出（`export:library`）：不经过预览。用户选一个目录，主进程在其中新建 `Lumen-标注-YYYYMMDD-HHmm/`，遍历未删除的书，跳过没有标注的，按书名生成 `<书名>.md`；文件名非法字符替换为 `_`，同名追加 ` (2)`。任何一次写盘失败都整体报 `IO_ERROR` 并提示换目录，不静默跳过。

```markdown
---
title: 书名
author: 作者
exported_at: 2026-10-21T12:00:00.000Z
lumen_version: 0.4.0
---

# 书名

作者

## 第三章 标题

> 原文引用

批注正文（Markdown）

---
```

### 6.9 PDF 阅读与标注

```
PdfViewer 挂载
  ├─ api.readBookFile(bookId) → Uint8Array
  ├─ pdf.js getDocument（worker 走本地 asset，cMap / standard_fonts 走 public/pdfjs/）
  ├─ 建与总页数等长的占位页；按视口 ±700 px 懒渲染 canvas + TextLayer
  ├─ 页码 = 第一个 offsetTop 不超过视口顶部的页；进度按 page / numPages
  ├─ 目录 = pdf.getOutline() → 递归展平 → 目标解析成页码，href 记为 page-<n>
  ├─ 元数据：info.Title / info.Author → books:updateMeta（只允许改 PDF）
  └─ 标注：quote 在该页文字层里 findBestQuote → Range.getClientRects → 绝对定位方块
```

- 缩放 60%–220%，改变宽度时取消未完成的 `RenderTask`、清空旧画布，按新宽度重排并保持当前页在视口内。
- 配色沿用四套主题；夜间模式用 CSS 滤镜反转页面，扫描件可能偏暗，设置面板里有说明。
- 选中只允许在同一页内：跨页选择直接提示「请分两次选」。`quote` 取 `range.toString()` 归一化后的文本，`prefix` / `suffix` 从该页文字层取 32 字。
- 书签记当前页码；侧栏点击标注会滚到对应页。
- 进度 400 ms 防抖写入，退出前 flush；`books.page_count` 与标题作者一起回填，书架不再显示「未命名」。

### 6.10 书内搜索

```
阅读器顶栏「搜索」/ Ctrl+F → ReaderSearch 面板
  ├─ 输入 ≥ 2 字 → 260 ms 防抖 → search:query({ q, scope: 'text', bookId, limit: 80 })
  ├─ 结果按 chapter_index 排 → 片段用 <mark> 标出命中词
  └─ 点击
       ├─ locateQuote：spine.get(href) 取章节 → 加载 DOM → findBestQuote(全文, 片段)
       ├─ findQuoteWithin：在片段区间里再找命中词，避免重复词贴到第一处
       ├─ cfiFromOffsets → rendition.display(cfi)；失败退回章节开头
       └─ annotations.highlight(cfi, ...) 临时标黄，6 秒后 remove
```

- 只对 EPUB / Markdown / TXT 开放；PDF 不参与全文索引，按钮不显示。
- `indexedAt` 为空时仍可搜，但面板提示「还在后台建索引，只能搜到已写入的部分」。
- 关闭面板不改变阅读位置；`Esc` 先关面板，再退出阅读器。输入框内不触发翻页键。

### 6.11 标注引用（双向链接）

批注正文里用 `[[ann:<annotation-id>]]` 表示引用，不新增数据库字段，也不建引用表。

- 写入：`NoteEditor` 的「引用标注」列出本书其它标注，可按原文、章节、批注筛选；选中后在光标处插入标记。
- 展示：`src/lib/note-markdown.ts` 给 `markdown-it` 加一条行内规则，把标记渲染成带 `data-annotation-id` 的站内链接；标签文字是「章节 + 原文片段」。外链与图片仍在 `DOMPurify` 白名单外。
- 反向引用：`ReaderView` 扫描本书全部 `noteMd`，得到「目标 id → 引用它的批注」，侧栏显示「引用 N / 被引 N」，编辑器列出引用者；点击跳转前先把当前草稿落库，避免切换丢失。
- 删除目标：不级联删除引用；展示改为「引用的标注已不存在」，导出同样写这句话。
- 导出：见 §6.8，引用换成可读标签。

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
| `books:listRemoved` | — | `ShelfBook[]`（只列软删的书，按移出时间倒序） |
| `books:restore` | `{ id }` | `ShelfBook`（清空 `deleted_at`；未索引的书重新排队） |
| `books:get` | `{ id }` | `ShelfBook` |
| `books:readFile` | `{ id }` | `ArrayBuffer` |
| `books:readCover` | `{ id }` | `{ mime, data: ArrayBuffer } \| null` |
| `books:updateMeta` | `{ id, title?, author?, pageCount? }` | `ShelfBook`（只接受 PDF） |
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
| `indexer:request` | `{ bookId }` | `null`（去重后排入后台队列） |
| `indexer:next` | — | `IndexerJob \| null`（隐藏窗口领取任务） |
| `indexer:release` | `{ bookId }` | `null`（归还任务，不计重试） |
| `indexer:complete` | `{ bookId, ok }` | `null`（主进程广播 `indexer:indexed`） |
| `search:query` | `{ q, scope: 'text' \| 'annotations', tagId?, bookId?, limit? }` | `SearchHit[]` |
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
| `export:library` | — | `{ path, files } \| null`（取消时 null） |
| `app:openFiles`（主进程 → 渲染层） | `string[]` | — |
| `indexer:indexed`（主进程 → 渲染层） | `bookId: string` | — |

错误码：`DUPLICATE`、`ENCRYPTED`、`UNSUPPORTED`、`TOO_LARGE`、`PARSE_FAILED`、`NOT_FOUND`、`DB_ERROR`、`IO_ERROR`、`INTERNAL`。渲染层按 `code` 决定下一步提示，不解析 `message`。

渲染层类型定义放在 `src/lib/api.ts`，主进程复用同一份 `shared/types.ts`（两个 `tsconfig` 都包含），避免两边各写一套；新增通道必须同时改 `electron/preload.ts` 的 `LumenApi` 实现。

## 8. 渲染层结构

```
App
├─ 顶栏              书架 / 搜索 / 笔记切换、导入、数据目录、版本号
├─ ShelfView          书库：网格、筛选、拖放导入、移除
├─ ReaderView（EPUB / Markdown / TXT）
│  ├─ 顶栏            返回、书名、目录、标注、书签、排版设置
│  ├─ EpubCanvas      epub.js 挂载点 + 点击翻页层（分页 / 滚动）
│  ├─ TocDrawer       目录（递归展平、当前章高亮）
│  ├─ ReaderSearch    书内搜索（Ctrl+F，检索当前书并跳转）
│  ├─ AnnotationRail  侧栏：按章节分组的全部标注、多选、导出
│  ├─ SelectionMenu   选中浮动工具条（四色高亮、批注、复制）
│  ├─ NoteEditor      Markdown 文本域 + 预览、标签、删除
│  └─ ExportDialog    导出预览、复制、保存
├─ PdfViewer（PDF）   缩放、懒渲染、页码进度、目录、同一套标注侧栏
├─ IndexWorker        隐藏窗口专用：循环领任务、建索引后回报
├─ SearchView         跨书搜索（正文 / 标注、标签过滤），片段由 Snippet 标出命中词
└─ NotesView          独立笔记与标签管理
```

索引窗口与主界面共用 `src/main.tsx` 入口：查询参数 `worker=index` 时只挂载 `IndexWorker`，其余情况挂载 `App`。它不渲染任何可见内容，也不订阅界面状态。

状态策略：

- 全部用函数组件 + `useState`/`useCallback`，不引入全局 store；跨组件共享靠 props 与回调。
- 阅读器状态（`rendition`、`book`、当前 locator、选中状态）留在 `ReaderView` / `PdfViewer` 内的 ref，不进 React 树，避免每次翻页导致整页重渲染。
- 跨视图通知只有四种：`refresh()` 重新拉取、`onExit` 回书架、`onIndexed` 更新书架索引标记、窗口间 `indexer:indexed` 广播。
- 搜索条件放在 `sessionStorage` 的 `lumen:search`，返回搜索页时保留输入；阅读偏好（含分页 / 滚动）、上次打开的书在 `localStorage`。

## 9. 安全与隐私

| 项 | 做法 |
| --- | --- |
| 窗口 | `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`、`webviewTag: false` |
| 预加载 | 只暴露白名单方法；不暴露 `ipcRenderer`、`require`、`process` |
| 协议 | 生产用 `lumen://` 自定义协议加载 `dist`，避免 `file://` 源不稳定导致数据目录漂移 |
| 外链 | `setWindowOpenHandler` 一律 `deny`；`will-navigate` 只允许应用自身源；`shell.openExternal` 仅接受 `https:` |
| 网络 | `session.defaultSession.webRequest.onBeforeRequest` 白名单见 §12，其余 `cancel` 并写 `userData/logs/network.log` |
| CSP | `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; form-action 'none'; frame-src 'none'; base-uri 'none'` |
| 书内 HTML | 在 iframe 内渲染，沙箱由 epub.js 控制；不向主窗口注入书内内容 |
| Markdown | 渲染后 `dompurify`，禁用 `<script>`、`<iframe>`、事件属性 |

## 10. 构建与打包

- `electron-vite build` 产出 `dist/main`、`dist/preload`、`dist/renderer`。
- `predev` / `prebuild` 先跑 `scripts/copy-pdfjs-assets.mjs`：把 `pdfjs-dist` 的 `cmaps/` 与 `standard_fonts/` 复制到 `public/pdfjs/`，Vite 再原样带进 `dist/renderer/pdfjs/`。这两份资源不进版本库，缺了它们中文等非嵌入字体的 PDF 会显示方块或取不到文字。
- pdf.js 的 worker 由 Vite 打包成独立 `.mjs` 资产（`pdf.worker.min-*.mjs`），`GlobalWorkerOptions.workerSrc` 指向它；CSP 的 `worker-src 'self' blob:` 不能删。
- 渲染层入口会把 `pdfjs-dist` 一并打进主 chunk（约 1.3 MB），构建时的 chunk 体积警告可忽略；不为它单独拆包，避免首屏多一次请求。
- `electron-builder` 配置在 `package.json` 的 `build` 字段：
  - `files`: `dist/**/*`、`package.json`
  - `win.target`: `nsis` + `zip`，均 x64；`nsis.oneClick: false`、`perMachine: false`、`allowToChangeInstallationDirectory: true`、`createDesktopShortcut: true`
  - 产物命名：`nsis.artifactName = Lumen-${version}-setup.${ext}`；`win.artifactName = Lumen-${version}-portable.${ext}`（zip 没有独立配置段，用平台级命名，NSIS 再覆盖）
  - 中间目录 `../lumen-next-desktop-build/`（与项目目录同名，避开编辑器和杀毒软件锁定 `.asar`；同时避免与并列存放的旧 lumen 仓库共用产物目录），`npm run collect` 只把**当前版本**的产物复制回仓库内 `desktop-dist/`，并跳过只有几百 KB 的卸载器中间文件
  - `npm run pack:portable` 只打 zip：本机开启智能应用控制时，electron-builder 需要运行一个临时 exe 来导出卸载器，这一步会被拦截（`spawn UNKNOWN`），安装包交给 CI 生成
- 原生模块：**没有**。`node:sqlite` 随 Electron 一起分发，升级 Electron 时只需确认 `PRAGMA` 与 FTS5 仍可用（`npm run probe:fts` 会顺带打印 SQLite 版本）。
- 图标：`scripts/make-icon.mjs` 纯 Node 生成 `build/icon.ico` 与 `icon.png`，不引入图形库；`build/` 不进版本库。

## 11. 发布流水线

```
git tag v* → .github/workflows/release.yml（windows-latest）
  ├─ npm ci → 校验 tag 与 package.json version 相等
  ├─ typecheck → test → build → electron-builder --win（NSIS + zip）
  ├─ npm run collect：只收当前版本产物到 desktop-dist/
  ├─ npm run release:assets：写 SHA256SUMS.txt，回填 releases.json 的 name/size/sha256
  ├─ npm run release:notes：由同一份 releases.json 生成 Release 说明
  ├─ softprops/action-gh-release：上传 setup.exe / portable.zip / SHA256SUMS.txt
  ├─ npm run site:build（CI 环境缺少资产信息会直接失败）
  └─ upload-pages-artifact → deploy-pages（environment: github-pages）
```

- `site/src/data/releases.json` 是官网唯一数据源：首页、下载页、更新日志都从它读版本、大小与校验和；`site/build.mjs` 在 `CI` 环境下发现最新版本缺少 `size` 或 `sha256` 会以非零码退出，避免发布半成品站点。
- 下载地址不写死在 JSON 里：构建时用 `GITHUB_REPOSITORY`（本地回落到 `site/site.config.json` 的 `owner`/`repo`）拼出 `releases/download/<tag>/<name>`。
- 打包脚本带 `--publish never`：发布只由 `softprops/action-gh-release` 完成。若省略，tag 构建时 electron-builder 会尝试自己发布并要求 `GH_TOKEN`，整步以「GitHub Personal Access Token is not set」失败。
- `npm run pack` 先执行 `npm run icon`：CI 没有 `build/` 目录，不生成图标会静默退回默认 Electron 图标。
- Release 创建后，流水线把回填过的 `site/src/data/releases.json` 提交回 `main`（提交信息 `chore: 回填 v* 资产信息`）。否则之后单独部署官网会显示上一份校验和，与线上资产不一致（本地构建与 CI 构建的哈希必然不同）。
- Pages 环境 `github-pages` 的部署分支策略必须同时允许 `main` 与 `v*` 标签；只允许分支时，tag 触发的部署会被「Tag ... is not allowed to deploy to github-pages due to environment protection rules」拒绝。
- 只改官网时由 `.github/workflows/site.yml` 在 `main` 分支的 `site/**` 变更上单独构建并部署，不必打标签。
- 仓库一次性设置：Settings → Pages → Source 选「GitHub Actions」。
- 开发期里程碑（`0.0.x`）只打 tag，不创建 Release；`0.1.0` 起才发布。
- Actions 使用 `GITHUB_TOKEN`，未配置任何签名凭据。`CSC_IDENTITY_AUTO_DISCOVERY=false` 阻止 electron-builder 自动探测本机证书，避免 CI 在找不到证书时打包失败。接入签名（优先 SignPath Foundation，见 PRD §3.5）时应删掉这一行，改为先把产物上传到签名服务、下载签名后的文件再继续打包。
- 发布前必须通过 PRD §9 清单；CI 只保证构建与单测，不跑 E2E。

## 12. 常量与配置

| 常量 | 值 | 位置 |
| --- | --- | --- |
| 应用版本 | `0.4.0`（V1 最终版本），版本节奏见 PRD §1.2 | `package.json` |
| 数据库 schema 版本 | `3` | `PRAGMA user_version` |
| 单文件导入上限 | 200 MB | `electron/library/import.ts` |
| 内存 EPUB 缓存数量 | 3 | `src/lib/convert/text-epub.ts` |
| 进度写入防抖 | 400 ms | `src/reader/ReaderView.tsx` |
| 删除标注撤销窗口 | 5 s | `src/reader/ReaderView.tsx` |
| 重锚相似度阈值 | 0.6 | `shared/locator.ts` |
| quote 最大长度 | 500 字 | `shared/locator.ts` |
| 上下文长度 | 32 字 | `shared/locator.ts` |
| 搜索默认条数 | 50，上限 200 | `electron/ipc/search.ts` |
| 短查询 LIKE 阈值 | 查询长度 < 3 字符时走 `LIKE`，≥3 走 `MATCH` | `shared/search-query.ts` |
| 索引触发 | 导入成功、打开未索引的书、启动扫描三处排队 | `electron/indexer.ts` |
| 索引重试上限 | 2 次；失败 4 s 后重试 | `electron/indexer.ts` |
| 索引任务租约 | 180 s | `electron/indexer.ts` |
| 索引窗口空闲关闭 | 20 s | `electron/indexer.ts` |
| 索引窗口轮询 | 空闲 1.2 s，出错 2 s | `src/reader/IndexWorker.tsx` |
| 索引批量 | 每批 30 万字符；单块上限 2000 字 | `src/reader/indexer.ts` |
| 书内搜索条数 / 最短查询 | 80 条 / 2 字 | `src/reader/ReaderSearch.tsx` |
| 书内搜索防抖 | 260 ms | `src/reader/ReaderSearch.tsx` |
| 搜索命中临时高亮 | 6 s | `src/reader/ReaderView.tsx` |
| 引用选择器条数上限 | 8 条 | `src/annotations/NoteEditor.tsx` |
| 引用标签原文长度 | 侧栏 30 字，导出 40 字 | `shared/references.ts`、`shared/export.ts` |
| PDF 缩放范围 | 0.6–2.2，步长 0.15 | `src/reader/PdfViewer.tsx` |
| PDF 标注校验上限 | 200 条 | `src/reader/PdfViewer.tsx` |
| PDF 进度防抖 | 400 ms | `src/reader/PdfViewer.tsx` |
| PDF 预渲染距离 | 视口上下各 700 px | `src/reader/PdfViewer.tsx` |
| 单次索引上限 | 500 块 / 500 万字符 | `electron/ipc/search.ts` |
| 标签名上限 | 40 字 | `electron/ipc/tags.ts` |
| 单条标注标签数上限 | 20 | `electron/ipc/tags.ts` |
| 笔记正文上限 | 50 万字符 | `electron/ipc/notes.ts` |
| 批注正文上限 | 20 万字符 | `electron/ipc/annotations.ts` |
| 迁移备份保留 | 3 份 | `electron/db/open.ts` |
| localStorage 前缀 | `lumen:` | `src/lib/prefs.ts`、`src/search/SearchView.tsx` |
| 调试端口 | `LUMEN_DEBUG_PORT`，未设置则不开放 CDP | `electron/main.ts` |
| 调试数据目录 | `LUMEN_USER_DATA`，覆盖 `userData`，仅用于隔离测试 | `electron/main.ts` |
| 官网数据源 | `site/src/data/releases.json`（`latest` + `releases[]`） | `site/build.mjs` |
| 官网页面 | `/`、`/download/`、`/changelog/`、`/privacy/`、`/faq/`、`404.html` | `site/build.mjs` |
| 官网外部请求 | 0（无字体、无统计、无 CDN） | `site/src` |
| 允许的请求源 | `lumen:`、`devtools:`、`chrome-extension:`、`chrome-devtools:`、`data:`、`blob:`、`about:`；开发期加渲染服务器与其 WebSocket 源 | `electron/security/network.ts` |

## 13. 测试策略

| 对象 | 方式 |
| --- | --- |
| `shared/locator.ts` | 纯函数单测：quote/prefix/suffix 生成、归一化、Jaccard 打分、候选选择、区间内定位 |
| `shared/references.ts` | 引用标记解析、去重、标签替换、目标缺失时的兜底文案 |
| 章节切分与 Markdown 转换 | 输入固定文本，断言生成的章节数、标题、XHTML 结构 |
| 搜索语句构造 | 断言长查询、短查询、含引号与 `*` 的查询被正确转义 |
| 迁移执行 | 在内存数据库上从 0 迁到最新，断言表与索引存在；`002_pdf` 断言 `format` 接受 `pdf`、`page_count` 存在；`003_search_chunks` 断言索引清空且非 PDF 书回到未索引 |
| 导出格式 | 固定标注集合 → 断言 Markdown 快照；含引用时断言替换成章节与原文标签 |

不做 E2E：epub.js 的分页依赖真实 Chromium，改用 PRD §9 的清单手测，必要时用 `--remote-debugging-port` 走 CDP 抽查。

## 14. 已知限制与风险

| 限制 | 现状 | 后续 |
| --- | --- | --- |
| PDF | 支持阅读、目录、书签与同页标注；不参与全文检索 | 书内搜索与 OCR 另议 |
| PDF 跨页选择 | 不支持，提示分两次选 | 需要多页区间模型，收益低 |
| 扫描件 PDF | 没有文字层，不能选中与标注 | 不做 OCR |
| 固定版式 EPUB | 不支持 | 不做 |
| 首次搜索前需要索引 | 导入即排队，但大书仍需几十秒 | 索引进度条与失败重试入口 |
| 索引升级到段落级 | `003_search_chunks` 会清空旧索引，重建完成前书内搜索不完整 | 启动扫描自动补齐；界面提示「还在建索引」 |
| 书内搜索范围 | 只覆盖 EPUB / Markdown / TXT；PDF 不参与全文索引 | PDF 全文检索与 OCR 另议 |
| 标注引用 | 引用关系只存在批注 Markdown 里，删除目标不级联 | 显示「引用的标注已不存在」，导出同样写明；需要统计或图谱时再建引用表 |
| trigram 索引体积 | 50 万字实测 1.47 倍（重复语料） | 用真实书复核，超 3 倍再改索引范围 |
| `node:sqlite` 处于实验阶段 | API 可能随 Node/Electron 版本变化 | 全部调用收在 `electron/db/`，升级 Electron 时跑 `probe:fts` 与冒烟 |
| 滚动模式的内部容器 | 通过 `rendition.manager.container` 访问 epub.js 内部对象 | epub.js 升级时若改名，退回键盘翻页并记录 |
| 书内链接 | 脚注可能被翻页热区覆盖 | 扩大热区避让，见阅读器实现 |
| 代码签名 | 未签名：SmartScreen 提示未知发布者，智能应用控制可能拦截 `setup.exe` | 优先申请 SignPath Foundation 的免费开源签名，其次购买 OV 证书并设置 `CSC_LINK`；见 PRD §3.5 |
| 本机打包 NSIS | 开启智能应用控制时，卸载器导出步骤被拦截（`spawn UNKNOWN`） | `npm run pack:portable` 只打 zip；安装包由 CI 生成 |
| macOS | 未构建 | 见 PRD §3.5，没有排期 |
