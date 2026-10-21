# Lumen

本地优先的阅读、标注与知识库桌面应用。导入 EPUB、Markdown、TXT，在书里划线批注，再把跨书的笔记、标签与全文检索汇成一个完全离线的知识库。

没有账号，没有云端，没有任何网络请求。书、标注、笔记都存在你自己的机器上。

> 状态：v0.1 规划中。本仓库是重写版，逐步取代旧仓库 v0.2 的纯阅读器；在功能对齐之前，旧版本仍是可用的正式版。

## 文档

| 文档 | 内容 |
| --- | --- |
| [PRD.md](./PRD.md) | 产品定位、目标用户、功能需求与验收场景、版本路线图、明确不做的事 |
| [TECH_DESIGN.md](./TECH_DESIGN.md) | 进程边界、数据结构、关键流程、IPC 契约、打包与发布、常量表、已知限制 |
| [AGENTS.md](./AGENTS.md) | 给 AI／协作者：命令、代码地图、硬性约定、踩过的坑、自检清单 |
| [docs/IMPLEMENTATION_PROMPT.md](./docs/IMPLEMENTATION_PROMPT.md) | 分阶段实施提示词，可直接交给 AI 执行 |
| [docs/WEBSITE_PROMPT.md](./docs/WEBSITE_PROMPT.md) | 官网（GitHub Pages）的提示词与验收标准 |

## 范围

MVP 做四件事：**读得进去、划得下来、搜得到、带得走**。

| 模块 | 内容 |
| --- | --- |
| 书库 | 拖放导入 EPUB / Markdown / TXT，去重，封面网格，按最近阅读排序 |
| 阅读 | 分页渲染、目录跳转、进度续读、字号与三套配色 |
| 标注 | 高亮、批注、书签；侧栏按章节列出；CFI 失效时按原文片段重新定位 |
| 知识库 | 跨书全文搜索、标签筛选、独立笔记、导出 Markdown |

刻意没做：账号与同步、云存储、词典翻译、TTS、书评社区、DRM、MOBI/AZW3、遥测与崩溃上报。

## 技术选型

| 层 | 选择 | 理由 |
| --- | --- | --- |
| 桌面壳 | Electron | 与旧版一致，epub.js 依赖完整 Chromium 渲染 |
| 主进程 | TypeScript + `better-sqlite3` | 同步 API 简单可靠，SQLite 自带 FTS5 与 trigram 分词，中文可搜子串 |
| 渲染层 | React 19 + TypeScript strict + Vite（`electron-vite`） | 沿用旧版组件风格，主进程也能直接写 TS |
| EPUB 渲染 | `epub.js` | 不自研解析与分页 |
| Markdown / TXT | 转成内存 EPUB 后复用同一条渲染链路 | 旧版已验证；避免维护两套阅读器 |
| 批注编辑器 | CodeMirror 6 | 轻量、可控、无网络资源 |
| 测试 | Vitest | 覆盖定位重锚、章节切分、搜索语句构造、迁移执行 |

## 开发

```bash
npm install
npm run dev          # 同时起 Vite 与 Electron，渲染层热更新
npm run typecheck    # tsc --noEmit
npm run build        # 主进程、预加载、渲染层三份产物
npm test             # Vitest
npm run db:inspect   # 打开当前用户数据目录下的 lumen.db（只读）
```

`better-sqlite3` 是原生模块，`npm install` 后会针对 Electron 的 ABI 重建；换 Node 版本或升级 Electron 后需要重新执行 `npm rebuild`。

## 打包与发布

```bash
npm run pack:dir     # 未压缩目录，用于本机排查
npm run pack         # NSIS 安装包 + portable.zip，输出到 desktop-dist/
```

产物命名固定为 `Lumen-<version>-setup.exe` 与 `Lumen-<version>-portable.zip`，两者与 `SHA256SUMS.txt` 一起上传到 GitHub Releases。推送 `v*` 标签会触发 GitHub Actions 自动构建并发布；官网（GitHub Pages）读取同一份 `releases.json` 渲染下载页。

安装包不做代码签名，Windows SmartScreen 会提示未知发布者；若系统开启了智能应用控制（Smart App Control），`setup.exe` 与单文件免安装版可能被直接拦截，此时使用 `Lumen-<version>-portable.zip`。彻底消除提示需要代码签名证书。

## 数据位置

| 内容 | 位置 |
| --- | --- |
| 书籍原文件 | `<userData>/books/<id>.<ext>` |
| 数据库 | `<userData>/lumen.db`（WAL 模式，含 `-wal` / `-shm`） |
| 封面缩略图 | `<userData>/covers/<id>.jpg` |
| 界面偏好 | 渲染层 `localStorage`，键名统一 `lumen:` 前缀 |

`userData` 在 Windows 上为 `%APPDATA%/Lumen`。删除应用不会删除这个目录，卸载时保留数据。

## 许可

MIT。
