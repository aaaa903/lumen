# AGENTS.md

给在本仓库工作的 AI／人类协作者的作业说明。读完这一页应当能直接改代码而不破坏既有行为。

## 项目是什么

Lumen：本地优先的阅读、标注与知识库桌面应用（Windows，Electron）。导入 EPUB / Markdown / TXT，阅读、高亮、批注、书签，跨书全文搜索，导出 Markdown。

无账号、无云端、零网络请求。产品边界见 [PRD.md](./PRD.md)，实现细节见 [TECH_DESIGN.md](./TECH_DESIGN.md)。

当前状态：**M4（0.1.0）实现完成，待推送 `v0.1.0` 标签**——导入 EPUB / Markdown / TXT、书架、epub.js 分页、目录、进度续读、排版与配色、高亮批注书签、侧栏、重锚、跨书全文搜索、标签、独立笔记、导出 Markdown、打包配置与官网均可用。动手前先看 `docs/IMPLEMENTATION_PROMPT.md` 的里程碑顺序；V1（0.2.0，PDF 等）尚未开始。

## 命令

```bash
npm install        # 安装依赖（无原生模块，不需要编译工具链）
npm run dev        # Vite + Electron 窗口，渲染层热更新
npm run typecheck  # tsc --noEmit，提交前必须过
npm test           # Vitest 单测
npm run build      # 主进程 / 预加载 / 渲染层三份产物
npm run pack:dir   # 未压缩目录，本机排查用
npm run pack:portable  # 只打 portable.zip（智能应用控制会拦截 NSIS 中间步骤）
npm run pack       # NSIS 安装包 + portable.zip → desktop-dist/
npm run release:assets # 回填产物大小与 SHA-256 到 site/src/data/releases.json
npm run release:notes  # 由 releases.json 生成 Release 说明
npm run site:build # 生成官网到 site/dist/
npm run db:inspect # 只读打开当前用户数据目录下的 lumen.db，排查数据用
node scripts/make-sample-library.mjs   # 生成 5 本测试书（含 50 万字）
```

调试渲染层：先设 `LUMEN_DEBUG_PORT=9223`（PowerShell 用 `$env:LUMEN_DEBUG_PORT='9223'`）再 `npm run dev`，然后通过 CDP 连 `http://127.0.0.1:9223/json/list` 检查页面与数据库状态。需要隔离数据时设 `LUMEN_USER_DATA=<临时目录>`，不要在调试清空、迁移这类操作时动真实书库。仓库内的 `scripts/cdp-eval.mjs` 可执行一小段渲染层表达式：把表达式写进临时文件，运行 `node scripts/cdp-eval.mjs <文件>`；`cdp-console.mjs` 收集控制台输出，`cdp-front.mjs` 截取页面。临时脚本不要提交。

没有 E2E 框架。改动阅读器或标注行为后，按 PRD §9 清单手测关键几条，并在回复里说明测了哪些。桌面端可加 `--remote-debugging-port=9223` 用 CDP 检查渲染层与 IndexedDB / SQLite 状态。

## 代码地图

| 文件 | 职责 | 什么时候改 |
| --- | --- | --- |
| `electron/main.ts` | 窗口、单实例、`lumen://` 协议、网络拦截接线 | 改桌面行为；不放业务逻辑 |
| `electron/window-state.ts` | 窗口尺寸、位置、最大化的记忆与写回 | 改窗口行为 |
| `electron/preload.ts` | `contextBridge` 白名单 | 新增 IPC 通道时必须同步 |
| `electron/ipc/*.ts` | 通道注册、参数校验、错误包装；`open-files.ts` 处理「用 Lumen 打开」与第二实例转交 | 改接口契约（同时改 `shared/types.ts`） |
| `electron/db/open.ts` | 打开数据库、PRAGMA、迁移执行、备份 | 改 schema 版本或迁移策略 |
| `electron/db/migrations/*.sql` | 迁移脚本，只增不改 | 加表、加列、加索引 |
| `electron/db/repositories/*.ts` | 全部 SQL（`books` / `progress` / `annotations` / `search` / `tags` / `notes` / `settings`） | 改查询；不要把 SQL 写到别处 |
| `electron/library/import.ts` | 导入编排：一次性读取、SHA-256、去重、写文件、元数据、封面 | 改导入流程 |
| `electron/library/paths.ts` | 相对 userData 的路径解析与越界防护 | 改文件落点 |
| `shared/text-book.ts` | TXT / Markdown 解码、章节切分、元数据 | 改文本格式支持（必须加单测） |
| `src/lib/convert/*` | Markdown / TXT → 内存 EPUB 与缓存 | 改格式转换 |
| `electron/library/epub-meta.ts` | 只读 container.xml + OPF | 扩元数据（如语言、出版日期） |
| `electron/security/network.ts` | 请求白名单与日志 | 调整允许的源（谨慎） |
| `shared/types.ts` | 主进程与渲染层共用的类型 | 改数据形状 |
| `shared/locator.ts` | locator 的生成、校验、重锚打分 | 改标注定位（必须加单测） |
| `shared/search-query.ts` | MATCH / LIKE 参数生成、片段截取 | 改搜索（必须加单测） |
| `shared/export.ts` | 标注 → Markdown 的纯函数 | 改导出格式 |
| `src/reader/*` | epub.js 生命周期、分页、目录、主题、进度、索引器 | 改阅读体验 |
| `src/annotations/*` | 选中工具条、高亮渲染、侧栏、批注编辑器 | 改标注交互 |
| `src/library/*` | 书架网格、导入入口、移除确认 | 改书架呈现 |
| `src/settings/SettingsDialog.tsx` | 数据目录、版本信息、清空数据 | 改设置项（不要新增一级入口） |
| `src/search/*`、`src/notes/*` | 搜索、笔记与标签视图 | 改知识库 |
| `src/lib/api.ts` | 类型化 IPC 客户端，唯一调用 `window.lumen` 的地方 | 新增通道 |
| `shared/export.ts` | 标注导出 Markdown（纯函数） | 改导出格式 |
| `src/styles.css` | 全部样式，含配色变量 | 任何视觉调整 |
| `scripts/release-assets.mjs` | 计算产物 SHA-256、写 `SHA256SUMS.txt`、回填 `releases.json` | 改发布流程或产物命名 |
| `scripts/release-notes.mjs` | 由 `releases.json` 生成 Release 说明 | 改发布文案 |
| `scripts/collect-desktop.mjs` | 只复制当前版本产物到 `desktop-dist/` | 改产物目录或命名 |
| `site/` | 官网：`build.mjs` 零依赖生成静态页，`src/` 放样式、脚本与截图，`src/data/releases.json` 是唯一数据源 | 改官网；不要引入框架或外部资源 |
| `.github/workflows/` | `release.yml`（打标签发布）、`site.yml`（只改官网时部署） | 改 CI |
| `docs/` | 实施提示词与官网提示词 | 改交付方式 |

约定：组件不直接调 `window.lumen`；`node:sqlite` 不出现在 `src/`；`epub.js` 只出现在 `src/reader/`；书内 XHTML 拼接只出现在 `src/lib/convert/`。

## 硬性约定

1. **TypeScript strict**，不使用 `any`。确需绕过第三方类型时写局部断言并加注释说明原因。
2. **不引入 UI 组件库、CSS-in-JS、状态管理库、ORM**。样式写在 `src/styles.css`，用 CSS 变量 + 类名。
3. **不新增运行时依赖**，除非无法用现有栈在 50 行内解决。新增依赖要说明理由、体积与替代方案。`electron`、`electron-builder`、`electron-vite`、`vitest` 只进 `devDependencies`。
4. **界面文案与代码注释用中文**，标点用全角；文案克制，不用感叹号；错误信息要给出下一步（例如「文件无法解析，确认它是未加密的 EPUB」）。
5. **函数组件 + hooks**，不写 class 组件。跨组件共享用 props 与回调，不引入 context。
6. **渲染层不碰 Node**，不 `require`、不读文件、不发网络请求。所有 IO 走 IPC。
7. **所有 SQL 参数化**，不拼字符串；搜索的 `MATCH` 参数必须走 `shared/search-query.ts` 的转义函数。
8. **时间统一 Unix 毫秒整数**，id 统一 `crypto.randomUUID()`。
9. **官网零外部依赖**：不引入框架、字体 CDN、统计脚本；下载链接只能指向 GitHub Release 资产。版本、大小、校验和只从 `site/src/data/releases.json` 读，不在页面里手写。

## 数据层规则

- schema 变更必须：新建 `migrations/NNN_*.sql` + 提升 `PRAGMA user_version` + 在 `docs` 与本文同步。老数据兼容优先，宁加列不删列。
- 迁移前自动备份数据库到 `userData/backups/`，保留最近 3 份。
- 读路径默认过滤 `deleted_at IS NOT NULL` 的行；软删是默认，物理删除只发生在「彻底删除」与文件清理。
- 所有写事务走 `withTransaction(db, fn)`（`electron/db/open.ts`）；不要在业务代码里散落 `BEGIN` / `COMMIT`。
- `db.exec()` 只用于迁移脚本与 `PRAGMA`；带参数的语句一律 `prepare().run/get/all`。
- FTS 的 `MATCH` 参数只允许由 `shared/search-query.ts` 生成，禁止在调用点拼字符串。
- 删书分两种：`books:remove({ purge: false })` 只写 `deleted_at`，标注与笔记保留；`purge: true` 才级联删除并删源文件。
- 书籍原文件不存进数据库，只存相对路径；读写路径不要整本读进内存（除 epub.js 需要的 Blob）。
- 进度写入必须防抖（400 ms）并 `flush` 后再退出阅读器，否则最后一次翻页丢失。
- 新增 `localStorage` key 用 `lumen:` 前缀，并在 TECH_DESIGN §12 登记。

## 使用 epub.js 的硬约束（旧版踩过的坑，仍然适用）

| 规则 | 原因 |
| --- | --- |
| 不要为拿元数据 `new ePub()` 再 `destroy()` | 与内部 `opened.then(...resources.replaceCss())` 竞态，抛 `Cannot read properties of undefined (reading 'replaceCss')`。元数据走 `epub-meta.ts` |
| 主题在 `renderTo` 之后注册/选择 | 过早调用作用到不存在的 contents |
| 主题规则一律带 `!important`，只给 `html` 设背景、`body` 设透明 | 书内 CSS 特异性不可知，否则浅色书在夜间模式仍是白底 |
| `rendition.resize()` 必须传显式 `clientWidth/clientHeight` | 不传会沿用旧尺寸，缩窗后正文被裁 |
| 判断分页正常看 `currentLocation().start.displayed.page/total`，不看 iframe 宽度 | epub.js 会把一章排成多列并把 iframe 撑宽 |
| `destroy()` 先 rendition 再 book，各自 `try/catch` | 未渲染完成时销毁会抛 |
| 键盘要注册两处：`window` 与 `hooks.content` | 焦点在 iframe 内时事件不冒泡到父窗口 |
| 所有 `await` 之后检查 `disposed` | React 19 StrictMode 双跑 effect + 切书重挂载 |
| `rendition.display()` 入参走 `normalizeHref` 后的相对路径 | 目录 href 可能带锚点、URL 编码或相对 nav 文档 |
| TXT / Markdown 必须经内存 EPUB 转换，不能把原始字节交给 `ePub()` | 原始字节不是 ZIP，epub.js 会一直等不到 `book.ready` |
| Electron 的 `webPreferences.backgroundThrottling` 必须为 `false` | 窗口被遮挡时 `requestAnimationFrame` 暂停，分页永远停在「正在排版…」 |

## 标注相关的硬约束

- 一条标注必须同时写 `cfi` 与 `quote` / `prefix` / `suffix`；`cfi` 允许为 `null`（书签），不允许「有 cfi 无 quote」的高亮。
- 重锚失败只置 `orphaned = 1`，不删除标注、不覆盖旧 cfi。
- 重锚写回 cfi 时必须在 `rendition.display()` 完成后、且 `contents` 可用时进行。
- 跨段落高亮按块级元素拆分，共用 `group_id`；删除一条时按 `group_id` 整组询问。
- 批注只存 Markdown 源，渲染时 `markdown-it` + `dompurify`；不要把渲染后的 HTML 入库。

## 改动自检（结束前逐条确认）

- [ ] `npm run typecheck` 无输出
- [ ] `npm test` 通过
- [ ] `npm run build` 成功
- [ ] 手测：导入 → 打开 → 翻 3 页 → 高亮 → 写批注 → 返回 → 重启回到同位置且高亮仍在
- [ ] 若改了标注定位：跑一次「外部改写文件后重锚」场景
- [ ] 若改了搜索：测两字中文、英文单词、含引号查询、空结果
- [ ] 若改了数据模型：旧库可迁移，或写清楚不兼容与迁移方式
- [ ] 若改了桌面壳：`npm run pack` 成功（本机开智能应用控制时改用 `pack:portable`，安装包看 CI），安装版与 portable.zip 都能启动并读到同一份数据
- [ ] 若改了官网：`npm run site:build` 成功，断网打开无外部请求，下载链接与校验和指向最新版本
- [ ] 若完成一个里程碑：改 `package.json` 的 `version`、更新 PRD §10 状态、打 `v<version>` 标签
- [ ] 若改了行为：同步更新 PRD / TECH_DESIGN 对应章节
- [ ] 回复里说明改了什么、怎么验证、有哪些已知取舍

## 故障排查

| 现象 | 处理 |
| --- | --- |
| 启动报 `Cannot find module 'node:sqlite'` | 用了过旧的 Electron 或外部 Node 运行脚本；确认 Electron ≥ 44，脚本用 `npx electron scripts/xxx.cjs` 跑 |
| `npm install` 卡在下载 Electron | 设置 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 后执行 `node node_modules/electron/install.js` |
| 数据库写入报 `SQLITE_BUSY` | 有第二个进程占用；确认单实例锁生效，检查是否遗留的 dev 窗口 |
| 搜索中文无结果 | 确认 `search_chunks` 有数据（`books.indexed_at` 非空）、FTS 表存在、查询长度 < 3 时走了 LIKE 分支 |
| 标注位置漂移 | 看该条 `quote` 是否为空、`orphaned` 是否为 1，重锚打分是否低于 0.6 |
| 打包后白屏 | 检查 `lumen://` 协议的路径解析与 `dist/renderer` 是否存在 |
| 窗口缩小时正文被裁 | 检查 `rendition.resize` 是否传了显式尺寸、`ResizeObserver` 是否还在 |
| 打包报 `EPERM/EBUSY: rename/unlink` | 输出目录或 `.asar` 被编辑器/杀毒/索引服务占用：关闭正在运行的应用；中间产物放在项目同级 `../lumen-desktop-build/` |
| 打包报 `spawn UNKNOWN`（NSIS 阶段） | 本机智能应用控制拦截了 electron-builder 用于导出卸载器的临时 exe：改用 `npm run pack:portable`，正式安装包交给 CI |
| 官网下载按钮 404 | `site/site.config.json` 的 `owner` 是否填对；CI 用 `GITHUB_REPOSITORY` 覆盖。Release 资产名必须与 `releases.json` 一致 |
| 官网构建报「资产信息不完整」 | `releases.json` 缺少 `size` / `sha256`：先跑 `npm run release:assets`，或等发布工作流回填 |
| Smart App Control 拦截 `setup.exe` | 未签名；改用 `Lumen-<version>-portable.zip`。不要为此关闭 Smart App Control |
| 网络日志出现外部请求 | 立即定位来源，补进白名单以外的拦截测试；不允许以「只是开发期」为由放行 |

## 明确不要做

- 不要加后端、账号、云同步、遥测、崩溃上报、自动更新。
- 不要引入外部字体、CDN、在线词典、AI 接口。
- 不要自研 EPUB 解析或重写分页引擎。
- 不要为了做 PDF 而提前抽象「通用文档模型」；V1 再说。
- 不要在渲染层加载 `node:sqlite`，也不要开 `nodeIntegration`、关 `contextIsolation`。
- 不要把业务逻辑塞进 `electron/main.ts`。
- 不要把 `dist/`、`desktop-dist/`、`site/dist/`、`release-notes.md`、`../lumen-desktop-build/`、`build/icon.*`、`node_modules/`、`public/sample-library/` 提交进版本库。
- 不要在没有单测的情况下改 `shared/locator.ts` 或搜索转义逻辑。

## 文档同步规则

| 改动 | 需要更新 |
| --- | --- |
| 用户可见功能 / 流程 / 文案 | `PRD.md` 对应功能表与验收清单 |
| 数据结构、常量、流程、第三方库 | `TECH_DESIGN.md` 对应章节与 §12 |
| 命令、约束、坑位 | 本文件 |
| 新增文件 / 目录 | 本文件「代码地图」与 `TECH_DESIGN.md` §4 |
| 桌面壳、打包、产物命名 | `PRD.md` F7、`TECH_DESIGN.md` §10 / §11、`README.md` |
| 官网结构、`releases.json` 字段 | `docs/WEBSITE_PROMPT.md` |

文档与代码冲突时，以代码为准并立即修正文档，不留「待更新」。
