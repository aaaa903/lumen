# 官网提示词

官网是下载入口，不是营销页。用户在 GitHub Releases 看到产物，在官网看清「这是什么、装哪个、数据在哪」，然后下载离开。

---

## 角色

你是一名前端工程师，负责为 Lumen 做一个完全静态的官网，部署到 GitHub Pages。站点不使用后端、不接第三方服务、不加载任何外部资源。

## 产品事实（写文案时以这些为准，不要编造）

- Lumen：Windows 桌面应用，本地优先的阅读、标注与知识库
- 支持导入 EPUB、PDF、Markdown、TXT
- 功能：分页与滚动阅读、PDF 按页渲染、目录、进度续读、高亮、批注、书签、导入即后台索引、跨书全文搜索、标签、独立笔记、单书与整库导出 Markdown
- 完全离线：无账号、无云同步、无遥测、无自动更新检查
- 数据位置：`%APPDATA%/Lumen`，卸载不删除
- 免费、开源，MIT 许可
- 安装包未做代码签名：可能触发 SmartScreen「未知发布者」；系统开启智能应用控制时用 `portable.zip`

不要写：用户量、评分、媒体评价、「最强大的」「颠覆」这类无法证实的表述。

## 技术栈

- 静态站点生成：`site/build.mjs`，零依赖、纯 Node 输出 HTML/CSS/少量 JS（不引入 Astro 或其他框架）
- 样式：手写 CSS，CSS 变量管理配色，复用应用内的四套配色语义
- 无 UI 框架、无 Tailwind、无字体 CDN、无分析脚本、无 cookie
- 图标全部内联 SVG 或本地文件

## 页面

| 路径 | 内容 |
| --- | --- |
| `/` | 一句话定位、截图（本地图片）、三个功能点、下载按钮、数据在本机的说明 |
| `/download/` | 最新版本、两种产物对比（安装包 / 免安装包）、系统要求、校验和、历史版本 |
| `/changelog/` | 按版本倒序的更新日志，数据来自 `releases.json` |
| `/privacy/` | 明确列出「不收集什么」与「数据存在哪里」，一页说完 |
| `/faq/` | 安装被拦截、卸载是否删数据、支持哪些格式、能否同步、如何备份 |

导航：首页 / 下载 / 更新日志 / 隐私 / FAQ，右侧一个 GitHub 仓库链接。

## 数据源

站点只读一份 `site/src/data/releases.json`，由发布流水线生成并随构建提交：

```json
{
  "latest": "0.3.0",
  "releases": [
    {
      "version": "0.3.0",
      "tag": "v0.3.0",
      "date": "2026-10-22",
      "notes": ["书内搜索", "标注引用", "段落级索引"],
      "assets": {
        "setup": {
          "name": "Lumen-0.3.0-setup.exe",
          "url": "https://github.com/<owner>/lumen/releases/download/v0.3.0/Lumen-0.3.0-setup.exe",
          "size": 118000000,
          "sha256": "…"
        },
        "portable": {
          "name": "Lumen-0.3.0-portable.zip",
          "url": "https://github.com/<owner>/lumen/releases/download/v0.3.0/Lumen-0.3.0-portable.zip",
          "size": 140000000,
          "sha256": "…"
        }
      }
    }
  ]
}
```

要求：

- 页面构建时读取这份 JSON，`latest` 指向的条目的两个资产都必须存在，缺失时构建失败。
- 版本列表同时给出 GitHub Releases 的链接，避免站点成为唯一入口。
- 校验和按 `sha256` 展示前 16 位，提供整串复制的按钮（纯前端 `navigator.clipboard`）。

## 交互与样式

- 首屏不依赖 JS；下载按钮是普通 `<a>`，直接指向 GitHub Releases 资产地址。
- 移动端单列，桌面端最大宽度 880 px。
- 深色模式跟随 `prefers-color-scheme`，不提供手动开关。
- 无动画库；只允许 150 ms 以内的颜色与透明度过渡。
- 正文字号 16–18 px，行高 1.75；中文优先，英文术语保留原文。

## 构建与部署

- `site/` 不引入依赖，`npm run site:build` 输出 `site/dist`
- GitHub Pages 通过 Actions 部署：`actions/upload-pages-artifact` + `actions/deploy-pages`
- 所有站内链接使用相对路径，避免部署到 `https://<owner>.github.io/lumen/` 时资源 404
- 仓库 Settings → Pages → Source 选「GitHub Actions」
- 若以后绑定自定义域名，加 `CNAME` 并在 README 记录

## 发布流水线衔接

`v*` 标签触发的主流程：

1. 构建并上传安装包、`portable.zip`、`SHA256SUMS.txt` 到 Release
2. 用 Release 资产信息更新 `site/src/data/releases.json`
3. 构建站点并部署到 GitHub Pages
4. 任一步失败则整个工作流失败，不发布半成品站点

## 验收标准

- [ ] 断网打开已缓存的页面，内容完整，无控制台报错
- [ ] DevTools 网络面板：除本站资源外零请求（无字体、无统计、无头像）
- [ ] 首页下载按钮指向最新 Release 的两个资产，链接可点开
- [ ] `/download/` 的版本号、文件大小、校验和与 Release 一致
- [ ] 手机宽度 375 px 下无横向滚动
- [ ] 深色与浅色模式文字对比度满足 WCAG AA
- [ ] `noopener noreferrer` 覆盖全部外链
- [ ] Lighthouse：Performance ≥ 95、Accessibility ≥ 95、Best Practices ≥ 95
- [ ] 站点源码中不出现 `gtag`、`analytics`、`plausible`、第三方字体域名

## 需要你确认的边界

实现前只问一次，不要逐页追问：

1. 仓库的 `owner` 与仓库名（决定资产 URL 与 `base`）。默认 `<owner>/lumen`。
2. 是否需要自定义域名。默认不绑定。
3. 截图由谁提供。默认先用应用界面截图占位，路径 `site/src/assets/screenshot-*.png`，不生成假 UI。
