import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 官网构建：零依赖、纯静态。
 * 输入 site/site.config.json 与 site/src/data/releases.json，输出 site/dist。
 * 不请求任何外部资源；下载按钮直接指向 GitHub Releases 资产。
 */

const SITE_DIR = dirname(fileURLToPath(import.meta.url))
const SRC = join(SITE_DIR, 'src')
const DIST = join(SITE_DIR, 'dist')

const config = JSON.parse(readFileSync(join(SITE_DIR, 'site.config.json'), 'utf8'))
const releases = JSON.parse(readFileSync(join(SRC, 'data', 'releases.json'), 'utf8'))
const repository = process.env['GITHUB_REPOSITORY'] ?? ''
const [envOwner, envRepo] = repository.split('/')
const owner = envOwner || config.owner
const repo = envRepo || config.repo
const repoUrl = `https://github.com/${owner}/${repo}`
const latest = releases.releases.find((item) => item.version === releases.latest)

if (!latest) {
  console.error(`releases.json 的 latest（${releases.latest}）没有对应条目`)
  process.exit(1)
}

for (const release of releases.releases) {
  for (const key of ['setup', 'portable']) {
    const asset = release.assets?.[key]
    if (!asset) continue
    if (!asset.url) {
      asset.url = `${repoUrl}/releases/download/${release.tag}/${asset.name}`
    }
  }
}

const missing = ['setup', 'portable'].filter((key) => {
  const asset = latest.assets?.[key]
  return !asset || !asset.name || !asset.sha256 || !asset.size
})

if (process.env['CI'] && missing.length > 0) {
  console.error(`最新版本的资产信息不完整：${missing.join('、')}`)
  process.exit(1)
}

if (missing.length > 0) {
  console.warn(`提示：最新版本还缺资产信息（${missing.join('、')}），本地构建继续。`)
}

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const formatSize = (bytes) => {
  if (!bytes) return '构建后生成'
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

const setup = latest.assets?.setup
const portable = latest.assets?.portable
const setupUrl = setup?.url ?? repoUrl
const portableUrl = portable?.url ?? repoUrl
// 本地还没跑过完整打包时，安装包信息为空；首页主按钮先落到已有的产物上，避免死链
const hasSetup = Boolean(setup?.size && setup?.sha256)
const primaryUrl = hasSetup ? setupUrl : portableUrl
const primaryAsset = hasSetup ? setup : portable
const primaryLabel = hasSetup ? '下载安装包' : '下载免安装包'

const pages = {
  home: { title: 'Lumen · 本地优先的阅读、标注与知识库', description: config.tagline },
  download: { title: '下载 · Lumen', description: '下载 Lumen 安装包或免安装包。' },
  changelog: { title: '更新日志 · Lumen', description: 'Lumen 每个版本的变化。' },
  privacy: { title: '隐私 · Lumen', description: 'Lumen 不收集什么，数据存在哪里。' },
  faq: { title: '常见问题 · Lumen', description: '安装、数据、格式与备份的常见问题。' },
  notFound: { title: '页面不存在 · Lumen', description: '没有找到这个页面。' },
}

const relative = (page, path = '') => {
  const depth = page === 'home' || page === 'notFound' ? 0 : 1
  const prefix = depth === 0 ? './' : '../'
  return `${prefix}${path}`
}

const navItems = [
  ['home', '首页', ''],
  ['download', '下载', 'download/'],
  ['changelog', '更新日志', 'changelog/'],
  ['privacy', '隐私', 'privacy/'],
  ['faq', 'FAQ', 'faq/'],
]

const iconGithub = `<svg viewBox="0 0 16 16" aria-hidden="true" width="15" height="15"><path fill="currentColor" d="M8 0C3.58 0 0 3.64 0 8.13c0 3.59 2.29 6.64 5.47 7.72.4.07.55-.18.55-.39 0-.19-.01-.82-.01-1.49-2.01.38-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.59 1.23.83.72 1.23 1.87.88 2.33.67.07-.53.28-.88.51-1.08-1.78-.2-3.65-.9-3.65-4.01 0-.89.31-1.61.82-2.18-.08-.2-.36-1.03.08-2.14 0 0 .67-.22 2.2.83a7.3 7.3 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.05 2.2-.83 2.2-.83.44 1.11.16 1.94.08 2.14.51.57.82 1.29.82 2.18 0 3.12-1.87 3.81-3.66 4.01.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.47.55.39A8.13 8.13 0 0 0 16 8.13C16 3.64 12.42 0 8 0Z"/></svg>`

function layout(page, body) {
  const meta = pages[page]
  const isHome = page === 'home'
  const href = (target) => relative(page, target)
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(meta.title)}</title>
  <meta name="description" content="${escapeHtml(meta.description)}">
  <meta name="theme-color" content="#f6f2ea" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#161310" media="(prefers-color-scheme: dark)">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(meta.title)}">
  <meta property="og:description" content="${escapeHtml(meta.description)}">
  <meta property="og:image" content="${href('assets/shelf.png')}">
  <link rel="icon" href="${href('assets/icon.svg')}" type="image/svg+xml">
  <link rel="stylesheet" href="${href('styles.css')}">
  <script src="${href('site.js')}" defer></script>
</head>
<body${isHome ? ' class="is-home"' : ''}>
  <a class="skip" href="#main">跳到正文</a>
  <header class="site-head">
    <a class="brand" href="${href('')}" aria-label="Lumen 首页">
      <img src="${href('assets/icon.svg')}" width="28" height="28" alt="">
      <span>Lumen</span>
    </a>
    <nav aria-label="主导航">
      ${navItems
        .map(
          ([key, label, path]) =>
            `<a href="${href(path)}"${page === key ? ' aria-current="page"' : ''}>${label}</a>`,
        )
        .join('\n      ')}
    </nav>
    <a class="repo-link" href="${repoUrl}" target="_blank" rel="noopener noreferrer">${iconGithub}<span>GitHub</span></a>
  </header>
  <main id="main">
${body}
  </main>
  <footer class="site-foot">
    <div>
      <p class="foot-brand">Lumen</p>
      <p>本地优先的阅读、标注与知识库。书和笔记都属于你。</p>
    </div>
    <div class="foot-links">
      <a href="${href('download/')}">下载</a>
      <a href="${href('changelog/')}">更新日志</a>
      <a href="${href('privacy/')}">隐私</a>
      <a href="${href('faq/')}">FAQ</a>
      <a href="${repoUrl}" target="_blank" rel="noopener noreferrer">GitHub</a>
      <a href="${repoUrl}/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">MIT 许可</a>
    </div>
    <p class="foot-note">© ${new Date().getFullYear()} Lumen · 不登录 · 不联网 · 不上报</p>
  </footer>
</body>
</html>`
}

function releaseNotes(release) {
  return release.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('\n')
}

const homeBody = (() => {
  const shot = relative('home', 'assets/reader-rail.png')
  return `    <section class="hero">
      <div class="hero-copy">
        <p class="eyebrow">Windows 桌面应用 · 完全离线</p>
        <h1>把一本书读完，<br>并把读到的内容留下来。</h1>
        <p class="lead">Lumen 把阅读、标注与笔记放回同一个窗口。导入 EPUB、Markdown 或 TXT，划线、写批注、跨书搜索，再把整理好的内容导出到自己的笔记系统。</p>
        <div class="cta-row">
          <a class="button primary" href="${primaryUrl}">${primaryLabel}<span class="button-meta">v${latest.version} · ${formatSize(primaryAsset?.size)}</span></a>
          <a class="button" href="${relative('home', 'download/')}">其他下载方式</a>
        </div>
        <p class="fineprint">免费 · 开源 · MIT · 无需账号</p>
      </div>
      <figure class="hero-shot">
        <img src="${shot}" width="1024" height="756" alt="Lumen 阅读器，正文中高亮了三处，右侧是本书标注侧栏">
        <figcaption>阅读、标注与章节侧栏在同一个窗口里。</figcaption>
      </figure>
    </section>

    <section class="principles" aria-label="三个原则">
      <div><strong>本地优先</strong><span>书、标注、索引都在本机，断网也能用。</span></div>
      <div><strong>一套定位</strong><span>标注同时保存 CFI 与原文，换排版也能找回。</span></div>
      <div><strong>随时带走</strong><span>标注导出 Markdown，进 Obsidian、Typora 都行。</span></div>
    </section>

    <section class="features">
      <article class="feature">
        <p class="feature-kicker">读</p>
        <h2>像纸书一样翻页</h2>
        <p>EPUB 由 epub.js 分页；Markdown 与 TXT 先转成内存 EPUB，走同一条渲染链路。目录、章节切换、进度续读、字号、行距、页边距与四套配色都在阅读器里。</p>
        <ul>
          <li>记住每本书读到哪一页，书架显示百分比</li>
          <li>白纸、米黄、灰绿、夜间四套配色</li>
          <li>键盘翻页，焦点在正文里也不会失效</li>
        </ul>
      </article>
      <article class="feature">
        <p class="feature-kicker">划</p>
        <h2>划线之后还能找到</h2>
        <p>选中文字就能高亮、写批注或加书签。每条标注同时保存位置与原文片段；文件被重新排版后，按片段重新贴合，失败时标记「位置失效」而不是悄悄丢掉。</p>
        <ul>
          <li>四色高亮，跨段落自动拆分</li>
          <li>批注用 Markdown 写，编辑与预览切换</li>
          <li>侧栏按章节聚合，点击跳回原文</li>
        </ul>
      </article>
      <article class="feature">
        <p class="feature-kicker">找</p>
        <h2>把五本书一起搜</h2>
        <p>正文索引用 SQLite FTS5 的 trigram 分词，两字中文按子串匹配；标注与批注随时可查。标签用来分类，独立笔记不绑定书也能写。</p>
        <ul>
          <li>结果按书与章节分组，命中词高亮</li>
          <li>搜索范围可切到标注，支持标签过滤</li>
          <li>选中若干条标注，导出或复制 Markdown</li>
        </ul>
      </article>
    </section>

    <section class="split">
      <div class="split-copy">
        <p class="eyebrow">从读到写</p>
        <h2>搜索不是终点，出处才是。</h2>
        <p>在搜索里点一条结果，Lumen 会打开对应的书并定位到那一段。标注与笔记共用同一个数据目录，半年后重读，位置还在。</p>
        <a class="text-link" href="${relative('home', 'download/')}">下载后导入一本试试</a>
      </div>
      <figure class="shot">
        <img src="${relative('home', 'assets/search.png')}" width="1024" height="756" loading="lazy" alt="Lumen 的跨书搜索，结果按书分组并高亮命中词">
      </figure>
    </section>

    <section class="split reverse">
      <div class="split-copy">
        <p class="eyebrow">笔记与标签</p>
        <h2>写给自己的那部分，也留在这里。</h2>
        <p>独立笔记可以关联到一本书，也可以完全不关联。标签既能标在标注上，也能在笔记页统一改名、合并与删除。</p>
      </div>
      <figure class="shot">
        <img src="${relative('home', 'assets/notes.png')}" width="1024" height="756" loading="lazy" alt="Lumen 的笔记页，左侧是笔记列表与标签，右侧是 Markdown 编辑区">
      </figure>
    </section>

    <section class="privacy-band">
      <div>
        <p class="eyebrow">数据在本机</p>
        <h2>没有账号，也没有服务器。</h2>
        <p>所有数据在 <code>%APPDATA%\\Lumen</code>：书是明文文件，标注与索引在 SQLite 里。卸载应用不会删除这个目录，备份时整目录复制即可。</p>
      </div>
      <ul class="check-list">
        <li>不做登录、云同步、遥测与崩溃上报</li>
        <li>主进程拦截全部外部请求，外部链接只交给系统浏览器</li>
        <li>更新只在官网或 GitHub Releases 手动下载</li>
      </ul>
    </section>

    <section class="download-band">
      <div>
        <p class="eyebrow">v${latest.version}</p>
        <h2>装一个，开始读。</h2>
        <p>安装包支持自定义目录与桌面快捷方式；不想安装就用免安装包。</p>
      </div>
      <div class="download-actions">
        <a class="button primary" href="${setupUrl}">安装包<span class="button-meta">${formatSize(setup?.size)}</span></a>
        <a class="button" href="${portableUrl}">免安装包<span class="button-meta">${formatSize(portable?.size)}</span></a>
      </div>
    </section>`
})()

const downloadBody = `    <section class="page-head">
      <p class="eyebrow">下载</p>
      <h1>Lumen v${latest.version}</h1>
      <p class="lead">Windows 10 / 11（x64）。安装包与免安装包使用同一份数据目录，换着用不会丢书。</p>
      <p class="page-meta">发布于 ${escapeHtml(latest.date)} · <a href="${repoUrl}/releases/tag/${latest.tag}" target="_blank" rel="noopener noreferrer">在 GitHub 查看本次发布</a></p>
    </section>

    <section class="download-grid">
      <article class="download-card recommended">
        <p class="card-kicker">推荐</p>
        <h2>安装包</h2>
        <p>NSIS 安装程序。可以改安装目录，创建桌面快捷方式，卸载时保留用户数据。</p>
        <p class="file-name">${escapeHtml(setup?.name ?? 'Lumen-setup.exe')}</p>
        <p class="file-size">${formatSize(setup?.size)}</p>
        <a class="button primary full" href="${setupUrl}">下载安装包</a>
        <details class="checksum">
          <summary>SHA-256 校验和</summary>
          <code>${escapeHtml(setup?.sha256 || '构建后生成')}</code>
          <button type="button" class="copy" data-copy="${escapeHtml(setup?.sha256 ?? '')}">复制完整校验和</button>
        </details>
      </article>

      <article class="download-card">
        <p class="card-kicker">免安装</p>
        <h2>便携包</h2>
        <p>解压后直接运行 <code>Lumen.exe</code>。适合受限电脑，或系统开启智能应用控制、拦截安装包的情况。</p>
        <p class="file-name">${escapeHtml(portable?.name ?? 'Lumen-portable.zip')}</p>
        <p class="file-size">${formatSize(portable?.size)}</p>
        <a class="button full" href="${portableUrl}">下载免安装包</a>
        <details class="checksum">
          <summary>SHA-256 校验和</summary>
          <code>${escapeHtml(portable?.sha256 || '构建后生成')}</code>
          <button type="button" class="copy" data-copy="${escapeHtml(portable?.sha256 ?? '')}">复制完整校验和</button>
        </details>
      </article>
    </section>

    <section class="notice">
      <h2>安装包没有代码签名</h2>
      <p>Windows SmartScreen 可能提示「未知发布者」；系统开启智能应用控制（Smart App Control）时，安装包甚至会被直接拦截。此时请下载免安装包，解压后运行。彻底消除提示需要代码签名证书，当前版本没有购买。</p>
    </section>

    <section class="prose">
      <h2>系统要求</h2>
      <ul>
        <li>Windows 10 或 Windows 11，64 位</li>
        <li>8 GB 内存即可流畅阅读；书库很大时建议 16 GB</li>
        <li>约 300 MB 磁盘空间，另加书籍与索引占用</li>
        <li>不需要网络，不需要账号，不需要安装运行库</li>
      </ul>

      <h2>校验下载</h2>
      <p>在 PowerShell 里对下载的文件执行：</p>
      <pre><code>Get-FileHash .\\${escapeHtml(setup?.name ?? 'Lumen-setup.exe')} -Algorithm SHA256</code></pre>
      <p>输出应与本页展示的校验和一致。每个版本的校验和也写在 GitHub Release 的 <code>SHA256SUMS.txt</code> 里。</p>

      <h2>历史版本</h2>
      ${releases.releases
        .map(
          (release) => `<p class="history-row"><span>v${escapeHtml(release.version)}</span><span>${escapeHtml(release.date)}</span><a href="${repoUrl}/releases/tag/${release.tag}" target="_blank" rel="noopener noreferrer">Release</a></p>`,
        )
        .join('\n      ')}
    </section>`

const changelogBody = `    <section class="page-head">
      <p class="eyebrow">更新日志</p>
      <h1>每个版本改了什么</h1>
      <p class="lead">只列用户能感知的变化；实现细节在仓库的提交记录里。</p>
    </section>
    <section class="timeline">
      ${releases.releases
        .map(
          (release) => `<article class="release">
        <header>
          <h2>v${escapeHtml(release.version)}</h2>
          <time datetime="${escapeHtml(release.date)}">${escapeHtml(release.date)}</time>
        </header>
        <ul>${releaseNotes(release)}</ul>
        <p class="release-links"><a href="${repoUrl}/releases/tag/${release.tag}" target="_blank" rel="noopener noreferrer">GitHub Release</a><a href="${relative('changelog', 'download/')}">下载</a></p>
      </article>`,
        )
        .join('\n      ')}
    </section>`

const privacyBody = `    <section class="page-head">
      <p class="eyebrow">隐私</p>
      <h1>不收集，也不上传。</h1>
      <p class="lead">Lumen 没有服务器。这一页只说明两件事：不收集什么，数据在哪里。</p>
    </section>
    <section class="prose two-col">
      <div>
        <h2>不收集什么</h2>
        <ul>
          <li>没有账号、邮箱、手机号，也没有登录入口</li>
          <li>没有使用统计、页面埋点、崩溃上报</li>
          <li>没有自动更新检查；版本更新靠手动下载</li>
          <li>没有在线书源、词典、翻译、AI 摘要</li>
          <li>不加载任何第三方字体、脚本、图片或 CDN</li>
        </ul>
      </div>
      <div>
        <h2>数据在哪里</h2>
        <p>全部在 <code>%APPDATA%\\Lumen</code>：</p>
        <ul>
          <li><code>books/</code>：导入的书籍原文件，明文保存</li>
          <li><code>lumen.db</code>：标注、笔记、进度与全文索引</li>
          <li><code>covers/</code>：从 EPUB 提取的封面</li>
          <li><code>logs/</code>：仅记录被拦截的外部请求与启动错误</li>
        </ul>
      </div>
    </section>
    <section class="notice">
      <h2>卸载与备份</h2>
      <p>卸载应用不会删除 <code>%APPDATA%\\Lumen</code>。要备份，退出 Lumen 后复制整个目录；要彻底清除，卸载后再手动删除该目录。卸载程序不会替你删数据。</p>
    </section>
    <section class="notice">
      <h2>网络边界</h2>
      <p>主进程安装了请求拦截器：除应用自身的 <code>lumen://</code> 协议与开发期本地服务器外，所有请求都会被取消并写入日志。外链只允许 <code>https:</code>，交给系统浏览器打开，不在应用内加载。</p>
    </section>`

const faqItems = [
  [
    '安装时被 SmartScreen 或智能应用控制拦截',
    '安装包没有代码签名。先点「更多信息 → 仍要运行」；如果系统开启了智能应用控制，安装包可能被直接拦截，此时下载免安装包，解压后运行 Lumen.exe。不要为了安装而关闭智能应用控制，关闭后需要重装系统才能恢复。',
  ],
  [
    '卸载会删除我的书和笔记吗',
    '不会。卸载只移除程序文件，%APPDATA%\\Lumen 会保留。要彻底清除数据，卸载后手动删除这个目录。',
  ],
  [
    '支持哪些格式',
    'EPUB、Markdown（.md / .markdown）与 TXT。TXT 支持 UTF-8 与 GBK，按行切分章节；Markdown 的首个一级标题会作为书名。PDF 在下一个版本。',
  ],
  [
    '为什么有的书搜不到',
    '正文搜索依赖索引：一本书第一次打开后，空闲 2.5 秒会自动建立索引。没打开过的书不会出现在正文搜索结果里；标注与批注不受影响，随时可查。',
  ],
  [
    '能在多台电脑之间同步吗',
    '不能。Lumen 不做账号与云同步。迁移时退出应用，把 %APPDATA%\\Lumen 整个目录复制到新机器同一位置即可。',
  ],
  [
    '怎么备份',
    '退出 Lumen 后复制 %APPDATA%\\Lumen 整个目录。恢复时把它放回同一路径再启动。数据库使用 WAL 模式，运行中复制可能得到不一致的快照，所以务必先退出。',
  ],
  [
    '标注会不会因为换排版而错位',
    '每条标注同时保存 CFI 与原文片段、前后文。CFI 失效时按片段重新查找，相似度低于阈值会标记「位置失效」，保留原文供你手动处理，不会贴到错误段落。',
  ],
  [
    '为什么安装包这么大',
    'Lumen 用 Electron，安装包里含 Chromium 与 Node 运行时，这是离线渲染 EPUB 与本地 SQLite 的代价。安装包约 100 MB 出头，便携包略大。',
  ],
]

const faqBody = `    <section class="page-head">
      <p class="eyebrow">FAQ</p>
      <h1>安装、数据与格式</h1>
      <p class="lead">先看这里；没有答案就去 GitHub 提 issue。</p>
    </section>
    <section class="faq">
      ${faqItems
        .map(
          ([question, answer]) => `<details>
        <summary>${escapeHtml(question)}</summary>
        <p>${escapeHtml(answer)}</p>
      </details>`,
        )
        .join('\n      ')}
    </section>
    <section class="notice">
      <h2>还找不到答案</h2>
      <p>在 <a href="${repoUrl}/issues" target="_blank" rel="noopener noreferrer">GitHub Issues</a> 描述现象、Windows 版本与复现步骤。不要附上整本书，附一小段能复现的文本即可。</p>
    </section>`

const notFoundBody = `    <section class="page-head">
      <p class="eyebrow">404</p>
      <h1>这一页不存在</h1>
      <p class="lead">链接可能写错了，或者页面已经搬走。</p>
      <p><a class="button" href="${relative('notFound')}">回到首页</a></p>
    </section>`

const built = {
  'index.html': layout('home', homeBody),
  'download/index.html': layout('download', downloadBody),
  'changelog/index.html': layout('changelog', changelogBody),
  'privacy/index.html': layout('privacy', privacyBody),
  'faq/index.html': layout('faq', faqBody),
  '404.html': layout('notFound', notFoundBody),
}

rmSync(DIST, { recursive: true, force: true })
mkdirSync(DIST, { recursive: true })

for (const [file, html] of Object.entries(built)) {
  const target = join(DIST, file)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, html, 'utf8')
}

cpSync(join(SRC, 'styles.css'), join(DIST, 'styles.css'))
cpSync(join(SRC, 'site.js'), join(DIST, 'site.js'))
cpSync(join(SRC, 'assets'), join(DIST, 'assets'), { recursive: true })
mkdirSync(join(DIST, 'data'), { recursive: true })
writeFileSync(
  join(DIST, 'data', 'releases.json'),
  `${JSON.stringify(releases, null, 2)}\n`,
  'utf8',
)

console.log(`官网已生成：${DIST}`)
console.log(`版本：v${latest.version}，下载地址前缀：${repoUrl}`)
if (owner === 'OWNER') {
  console.warn('注意：site/site.config.json 的 owner 仍是占位符，下载链接尚不可用。')
}
