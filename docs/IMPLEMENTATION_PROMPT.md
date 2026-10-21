# 实施提示词

把本文件整体交给 AI，并说明当前要做的里程碑（M0–M4）。每次只做一个里程碑，做完停下来等验收，不要一口气铺开。

---

## 角色

你是一名资深 Electron + React + TypeScript 工程师，负责把 Lumen 从零实现出来。你遵守仓库里的 `AGENTS.md`、`PRD.md`、`TECH_DESIGN.md`，三者冲突时优先级为：PRD（做什么）> TECH_DESIGN（怎么做）> AGENTS（怎么写）。

## 项目

Lumen 是一个 Windows 桌面应用：本地优先的阅读、标注与知识库。导入 EPUB / Markdown / TXT，阅读、高亮、批注、书签，跨书全文搜索，导出 Markdown。完全离线，无账号，无遥测，零外部网络请求。

已确定的决策，不要重新讨论：

- 产品名 Lumen；仓库独立新建，旧版阅读器不动
- 许可证 MIT
- 安装包托管在 GitHub Releases，官网用 GitHub Pages
- 分发形态：NSIS 安装包 + `portable.zip`，两者都提供

## 技术约束

- Electron ≥ 44，`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`
- 主进程 TypeScript，由 `electron-vite` 构建；渲染层 React 19 + Vite
- 数据库用 Electron 内置 `node:sqlite`，只在主进程使用；WAL；`PRAGMA user_version` 管理迁移；事务统一走 `withTransaction`
- 全文搜索用 FTS5 `trigram` 分词
- EPUB 用 `epub.js`；Markdown / TXT 转内存 EPUB 复用同一渲染链路
- 批注编辑器 CodeMirror 6；Markdown 渲染 `markdown-it` + `dompurify`
- 测试 Vitest，只测纯逻辑
- 不引入 UI 组件库、状态管理库、ORM、CSS-in-JS

## 硬性要求

1. `npm run typecheck`、`npm test`、`npm run build` 必须全部通过后才算完成一个里程碑。
2. 所有 SQL 参数化；所有 IPC 入参在主进程校验。
3. 界面文案与注释用中文，全角标点，错误信息给出下一步。
4. 渲染层代码里不得出现 `require`、`fs`、`node:sqlite`、`process`。
5. 不发起任何外部网络请求；主进程的请求拦截器必须在 M0 就位。
6. 每完成一个里程碑，同步更新 `PRD.md` / `TECH_DESIGN.md` / `AGENTS.md` 中受影响的内容，并在回复里列出改了哪些文档。
7. 不要为了「以后可能用到」提前抽象。PDF、双向链接、批量索引都不在 MVP。

## 里程碑

### M0 骨架（先做这个）

交付：

- 初始化 `package.json`、`tsconfig.json`、`electron.vite.config.ts`、`.gitignore`
- `electron/main.ts`：单实例、`lumen://` 协议、窗口、`backgroundThrottling: false`
- `electron/preload.ts` + `src/lib/api.ts`：只开 `app:versions` 一条通道，证明链路可用
- `electron/db/open.ts` + `migrations/001_init.sql`：建库、PRAGMA、迁移备份
- `electron/security/network.ts`：请求白名单与日志
- `src/App.tsx`：空书架 + 版本号
- `scripts/make-sample-library.mjs`：生成 5 本测试书（EPUB / Markdown / UTF-8 TXT / GBK TXT / 大文件）
- `docs/probe-fts.md`：写 200 行以内原型，实测中文 trigram 的命中率与索引体积，给出结论

验收：`npm run dev` 打开窗口显示版本号；数据库文件生成；断网启动无外部请求日志；`docs/probe-fts.md` 有明确结论。

### M1 导入与阅读

交付：

- `books:import` 全流程：hash、去重、复制、元数据、封面
- 书架网格、拖放导入、排序、移除
- 阅读器：epub.js 生命周期、分页、目录、章节切换、字号与配色
- 进度读写与续读
- Markdown / TXT → 内存 EPUB

验收：PRD §8 场景 1、2、8 通过。

### M2 标注

交付：

- 选中工具条、高亮、批注编辑器、书签
- 侧栏按章节分组、点击跳转
- `shared/locator.ts` 与重锚，含单测
- 删除与 5 秒撤销

验收：PRD §8 场景 3、4、7 通过。

### M3 知识库

交付：

- 索引器（打开后空闲触发）、`search_chunks` 写入
- 搜索视图：跨书、分组、片段高亮、跳转
- 标注搜索、标签、独立笔记
- 导出 Markdown

验收：PRD §8 场景 5、6 通过。

### M4 打包与发布

交付：

- `electron-builder` 配置，产物命名 `Lumen-<version>-setup.exe` / `Lumen-<version>-portable.zip`
- `scripts/make-icon.mjs`、`build/` 资源
- GitHub Actions：tag 触发构建、上传 Release、生成 `SHA256SUMS.txt`、回填 `releases.json`、部署 GitHub Pages
- `scripts/release-assets.mjs`、`scripts/release-notes.mjs`、`.github/workflows/release.yml` / `site.yml`
- 官网（另见 `docs/WEBSITE_PROMPT.md`）
- README 补齐安装、数据位置、Smart App Control 与官网部署说明

验收：PRD §8 场景 9 通过；`npm run pack` 在干净机器上能装、能卸、卸载保留数据。

## 交付方式

- 每个里程碑：先给出改动文件清单，再改代码，最后给出验证命令与结果。
- 不要修改 `node_modules` 里的第三方源码。
- 遇到无法在本仓库内解决的平台问题（如 Electron 二进制下载失败、`node:sqlite` 在某版本不可用），先给出诊断与两条备选方案，再等确认。
- 回复里必须包含：改了什么、怎么验证的、已知取舍、下一步。

## 验收场景（原文，来自 PRD §8）

1. 新机器安装 → 书架空状态 → 拖入一本 EPUB → 封面与书名正确 → 打开可直接阅读。
2. 读到第 7 章某页 → 关闭应用 → 重新启动 → 书架显示该书 34% → 打开回到同一页。
3. 选中一句 → 高亮 → 写批注 → 侧栏出现记录 → 点击记录跳回原文 → 重启后高亮仍在。
4. 用外部工具改写 EPUB 内部文件名后重新导入 → 打开 → 原标注按片段重新贴合，位置误差不超过一段。
5. 五本书中搜索同一个两字词 → 结果按书分组 → 点击任一条跳回原文命中位置。
6. 导出某本书的标注 → Markdown 含书名、章节、引用、批注 → 在 Obsidian 中渲染正常。
7. 从书架移除一本书 → 标注仍在（书库「已移除」分组可见）→ 重新导入同一文件 → 标注回到原文。
8. 断网 → 完成上述全部流程 → 主进程日志无任何外部请求。
9. 安装到自定义目录 → 桌面快捷方式可用 → 卸载后 `%APPDATA%/Lumen` 仍在。
