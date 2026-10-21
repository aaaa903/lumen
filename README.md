# Lumen

本地优先的阅读、标注与知识库桌面应用。导入 EPUB、PDF、Markdown、TXT，在书里划线批注，再把跨书的笔记、标签与全文检索汇成一个完全离线的知识库。

没有账号，没有云端，没有任何网络请求。书、标注、笔记都存在你自己的机器上。

> 状态：v0.2.0（V1 发布，2026-10-22）。官网 <https://aaaa903.github.io/lumen/>，安装包与免安装包见 [Release v0.2.0](https://github.com/aaaa903/lumen/releases/tag/v0.2.0)。

## 版本号

`package.json` 的 `version` 是唯一来源，界面、安装包与官网都从这里派生。

| 阶段 | 版本号 |
| --- | --- |
| M0 骨架 | `0.0.1` |
| M1 导入与阅读 | `0.0.2` |
| M2 标注 | `0.0.3` |
| M3 知识库 | `0.0.4` |
| 首次公开发布 | `0.1.0` |
| V1：PDF、滚动、导入即索引、库导出（当前） | `0.2.0` |

每个里程碑结束都要改 `version`、打 `v<version>` 标签，并同步 `PRD.md` §10 的状态。开发期里程碑只打标签，`0.1.0` 起才创建 Release。

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
| 书库 | 拖放导入 EPUB / PDF / Markdown / TXT，去重，封面网格，按最近阅读排序 |
| 阅读 | EPUB 分页或滚动、PDF 按页渲染、目录跳转、进度续读、字号与四套配色 |
| 标注 | 高亮、批注、书签；侧栏按章节列出；EPUB 按 CFI + 原文片段重锚，PDF 按页码 + 原文片段校验 |
| 知识库 | 导入即后台建索引、跨书全文搜索、标签筛选、独立笔记、导出 Markdown |
| 导出 | 单书 / 选区导出，以及整个书库按「一本书一个文件」导出 |

刻意没做：账号与同步、云存储、词典翻译、TTS、书评社区、DRM、MOBI/AZW3、遥测与崩溃上报。

## 技术选型

| 层 | 选择 | 理由 |
| --- | --- | --- |
| 桌面壳 | Electron | 与旧版一致，epub.js 依赖完整 Chromium 渲染 |
| 主进程 | TypeScript + Electron 内置 `node:sqlite` | 同一个 SQLite 3.53.4，自带 FTS5 与 trigram；无需原生模块编译，也不会 ABI 失配 |
| 渲染层 | React 19 + TypeScript strict + Vite（`electron-vite`） | 沿用旧版组件风格，主进程也能直接写 TS |
| EPUB 渲染 | `epub.js` | 不自研解析与分页 |
| PDF 渲染 | `pdfjs-dist` | 版式固定，epub.js 无法承担；worker 与 cMap 全部随应用分发，不联网 |
| Markdown / TXT | 转成内存 EPUB 后复用同一条渲染链路 | 旧版已验证；避免维护两套阅读器 |
| 批注编辑器 | Markdown 文本域 + 预览切换 | 不引入编辑器依赖，先保证写入与预览可用 |
| 测试 | Vitest | 覆盖定位重锚、章节切分、搜索语句构造、迁移执行 |

## 开发

```bash
npm install
npm run dev          # 同时起 Vite 与 Electron，渲染层热更新
npm run typecheck    # tsc --noEmit
npm run build        # 主进程、预加载、渲染层三份产物
npm test             # Vitest
npm run db:inspect   # 打开当前用户数据目录下的 lumen.db（只读）
npm run site:build   # 生成官网到 site/dist/
npm run pack:portable # 只打 portable.zip（本机开智能应用控制时用）
```

项目不包含原生模块：数据库用的是 Electron 自带的 `node:sqlite`，因此不需要 `node-gyp`、Visual Studio Build Tools，升级 Electron 也不会出现 ABI 失配。

国内网络下 `npm install` 可能很慢（连 npmjs 单个元数据请求就要数秒），可以换镜像：

```powershell
npm install --registry=https://registry.npmmirror.com
```

若 Electron 二进制没有下载成功（npm 11 会默认跳过部分安装脚本），手动补一次：

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
node node_modules/electron/install.js
```

## 打包与发布

```bash
npm run pack:dir      # 未压缩目录，用于本机排查
npm run pack:portable # 只生成 portable.zip，输出到 desktop-dist/
npm run pack          # NSIS 安装包 + portable.zip，输出到 desktop-dist/
npm run release:assets # 把产物大小与 SHA-256 回填 site/src/data/releases.json
npm run release:notes  # 用同一份数据生成 Release 说明
```

产物命名固定为 `Lumen-<version>-setup.exe` 与 `Lumen-<version>-portable.zip`，两者与 `SHA256SUMS.txt` 一起上传到 GitHub Releases。推送 `v*` 标签会触发 `.github/workflows/release.yml` 自动构建、创建 Release、回填 `releases.json` 并部署官网；只改官网时走 `.github/workflows/site.yml`。

安装包不做代码签名，Windows SmartScreen 会提示未知发布者；若系统开启了智能应用控制（Smart App Control），`setup.exe` 与单文件免安装版可能被直接拦截，此时使用 `Lumen-<version>-portable.zip`。彻底消除提示需要代码签名证书。

本机若开启了智能应用控制，electron-builder 在生成安装包时会尝试运行一个中间 exe 来导出卸载器，这一步会被拦截，表现为 `spawn UNKNOWN`。此时用 `npm run pack:portable` 只打免安装包；正式安装包交给 GitHub Actions 的 Windows runner 生成。

## 官网

`site/` 是零依赖静态站，由 `site/build.mjs` 读 `site/site.config.json` 与 `site/src/data/releases.json` 直接生成 HTML/CSS。没有前端框架、没有外部字体、没有统计脚本，下载按钮直接指向 GitHub Release 资产。

部署到 GitHub Pages 的一次性设置已完成：仓库 Settings → Pages → Source 选「GitHub Actions」，环境 `github-pages` 的部署策略同时允许 `main` 与 `v*` 标签。`site/site.config.json` 的 `owner` 已填 `aaaa903`；CI 会用 `GITHUB_REPOSITORY` 覆盖，本地预览直接读这一项。

## 数据位置

| 内容 | 位置 |
| --- | --- |
| 书籍原文件 | `<userData>/books/<id>.<ext>` |
| 数据库 | `<userData>/lumen.db`（WAL 模式，含 `-wal` / `-shm`） |
| 封面 | `<userData>/covers/<id>.<原扩展名>` |
| 界面偏好 | 渲染层 `localStorage`，键名统一 `lumen:` 前缀 |

`userData` 在 Windows 上为 `%APPDATA%/Lumen`。删除应用不会删除这个目录，卸载时保留数据。

## 许可

MIT。
