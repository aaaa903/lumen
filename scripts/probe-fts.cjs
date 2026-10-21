// FTS5 trigram 原型：在 Electron 的 Node 运行时里跑，测的就是应用实际使用的 SQLite。
// 用法：npm run probe:fts
// 结果写入 docs/probe-fts.json，人工整理进 docs/probe-fts.md。
const { app } = require('electron')
const { DatabaseSync } = require('node:sqlite')
const { mkdirSync, rmSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { performance } = require('node:perf_hooks')

const WORK_DIR = join(__dirname, '..', '.probe-fts')
const CHARS_TARGET = 500_000
const SENTENCES = [
  '灯光落在纸页上，像一层薄薄的、温热的灰。',
  '他把书翻到上次停下的地方，那里夹着一张旧车票。',
  '窗外的雨下得很轻，几乎听不见，只有玻璃上缓慢移动的水痕。',
  '有些句子需要读三遍，不是因为难，而是因为舍不得往下读。',
  '书架最上层那本一直没有拆封，塑封的边缘已经泛黄。',
  '他忽然想起很多年前的一间图书馆，木地板踩上去会响。',
  '故事里的人也在读书，这件事让他觉得安心。',
  '茶凉了，他又倒了一杯，然后继续读下去。',
  '夜很深的时候，文字会变得像水一样，从眼睛里流过去。',
  '他在页边写下两个字：记住。',
  'reading is a quiet room with a window that never closes',
  'the library closes at dusk but the lamp stays on',
]

function buildCorpus() {
  const chunks = []
  let total = 0
  let index = 0
  while (total < CHARS_TARGET) {
    const sentences = []
    for (let i = 0; i < 40; i += 1) {
      sentences.push(SENTENCES[(index * 7 + i * 3) % SENTENCES.length])
    }
    const text = sentences.join('')
    chunks.push({
      bookId: `book-${index % 5}`,
      chapterIndex: index,
      chapterTitle: `第${index + 1}章`,
      text,
    })
    total += text.length
    index += 1
  }
  return chunks
}

function pageBytes(db) {
  const pageSize = db.prepare('PRAGMA page_size').get().page_size
  const pageCount = db.prepare('PRAGMA page_count').get().page_count
  return pageSize * pageCount
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function timeQuery(fn, runs = 5) {
  fn() // 预热
  const samples = []
  let last
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now()
    last = fn()
    samples.push(performance.now() - started)
  }
  return { ms: Number(median(samples).toFixed(2)), hits: last }
}

function run() {
  rmSync(WORK_DIR, { recursive: true, force: true })
  mkdirSync(WORK_DIR, { recursive: true })

  const corpus = buildCorpus()
  const chars = corpus.reduce((sum, chunk) => sum + chunk.text.length, 0)
  const results = {
    generatedAt: new Date().toISOString(),
    runtime: `Electron ${process.versions.electron} / Node ${process.versions.node}`,
    corpus: { chars, chunks: corpus.length },
    sizes: {},
    insert: {},
    queries: {},
  }

  // 对照组：同样的文本，只有普通表，没有全文索引。
  const plain = new DatabaseSync(join(WORK_DIR, 'plain.db'))
  plain.exec('CREATE TABLE chunks (id INTEGER PRIMARY KEY, book_id TEXT, chapter_index INTEGER, text TEXT)')
  results.sqlite = plain.prepare('SELECT sqlite_version() AS v').get().v
  const plainInsert = plain.prepare('INSERT INTO chunks (book_id, chapter_index, text) VALUES (?, ?, ?)')
  let started = performance.now()
  plain.exec('BEGIN')
  for (const chunk of corpus) plainInsert.run(chunk.bookId, chunk.chapterIndex, chunk.text)
  plain.exec('COMMIT')
  results.insert.plainMs = Number((performance.now() - started).toFixed(1))
  results.sizes.plainTableBytes = pageBytes(plain)
  plain.close()

  // 实验组：与正式 schema 一致的结构 + FTS5 trigram。
  const db = new DatabaseSync(join(WORK_DIR, 'fts.db'))
  db.exec('PRAGMA journal_mode = WAL')
  db.exec(`
    CREATE TABLE search_chunks (
      id INTEGER PRIMARY KEY,
      book_id TEXT NOT NULL,
      chapter_index INTEGER NOT NULL,
      chapter_title TEXT NOT NULL DEFAULT '',
      href TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE search_fts USING fts5(
      text, content = 'search_chunks', content_rowid = 'id', tokenize = 'trigram'
    );
    CREATE TRIGGER chunks_ai AFTER INSERT ON search_chunks BEGIN
      INSERT INTO search_fts(rowid, text) VALUES (new.id, new.text);
    END;
  `)

  const insert = db.prepare(
    'INSERT INTO search_chunks (book_id, chapter_index, chapter_title, text) VALUES (?, ?, ?, ?)',
  )
  started = performance.now()
  db.exec('BEGIN')
  for (const chunk of corpus) {
    insert.run(chunk.bookId, chunk.chapterIndex, chunk.chapterTitle, chunk.text)
  }
  db.exec('COMMIT')
  results.insert.ftsMs = Number((performance.now() - started).toFixed(1))
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  results.sizes.ftsTableBytes = pageBytes(db)
  results.sizes.ratio = Number((results.sizes.ftsTableBytes / results.sizes.plainTableBytes).toFixed(2))

  const matchStmt = db.prepare('SELECT count(*) AS hits FROM search_fts WHERE search_fts MATCH ?')
  const likeStmt = db.prepare('SELECT count(*) AS hits FROM search_chunks WHERE text LIKE ?')

  const cases = [
    { name: '中文 2 字：灯光', mode: 'like', q: '灯光' },
    { name: '中文 2 字：书店', mode: 'like', q: '书店' },
    { name: '中文 3 字：旧车票', mode: 'match', q: '旧车票' },
    { name: '中文 4 字：木地板', mode: 'match', q: '木地板' },
    { name: '中文 6 字：玻璃上缓慢', mode: 'match', q: '玻璃上缓慢' },
    { name: '英文单词：library', mode: 'match', q: 'library' },
    { name: '不存在的词：鲸鱼骨', mode: 'match', q: '鲸鱼骨' },
  ]

  for (const item of cases) {
    const entry = {}
    if (item.mode === 'match') {
      entry.match = timeQuery(() => matchStmt.get(item.q).hits)
    }
    entry.like = timeQuery(() => likeStmt.get(`%${item.q}%`).hits)
    results.queries[item.name] = entry
  }

  // 2 字查询在 MATCH 下的实际行为（trigram 要求至少 3 字），决定是否必须走 LIKE 兜底。
  results.queries['MATCH 2 字行为'] = { match: { ms: 0, hits: matchStmt.get('灯光').hits } }

  const rankStmt = db.prepare(
    `SELECT c.chapter_index, bm25(search_fts) AS score
     FROM search_fts JOIN search_chunks c ON c.id = search_fts.rowid
     WHERE search_fts MATCH ? ORDER BY bm25(search_fts) LIMIT 10`,
  )
  const rankStarted = performance.now()
  const ranked = rankStmt.all('旧车票')
  results.rank = { ms: Number((performance.now() - rankStarted).toFixed(2)), rows: ranked.length }

  const snippetStmt = db.prepare(
    `SELECT snippet(search_fts, 0, '<mark>', '</mark>', '…', 12) AS s
     FROM search_fts WHERE search_fts MATCH ? LIMIT 1`,
  )
  results.snippet = snippetStmt.get('旧车票').s

  db.close()

  // 与无索引表的 LIKE 对比，量化「不建索引也能搜」的代价。
  const plainDb = new DatabaseSync(join(WORK_DIR, 'plain.db'), { readOnly: true })
  const plainLike = plainDb.prepare('SELECT count(*) AS hits FROM chunks WHERE text LIKE ?')
  results.queries['对照组 LIKE（无索引）'] = { like: timeQuery(() => plainLike.get('%灯光%').hits) }
  plainDb.close()

  mkdirSync(join(__dirname, '..', 'docs'), { recursive: true })
  writeFileSync(join(__dirname, '..', 'docs', 'probe-fts.json'), JSON.stringify(results, null, 2))

  console.log(`SQLite ${results.sqlite}（${results.runtime}）`)
  console.log(`语料：${chars.toLocaleString()} 字，${corpus.length} 个章节块`)
  console.log(
    `体积：普通表 ${(results.sizes.plainTableBytes / 1024 / 1024).toFixed(2)} MB，trigram ${(results.sizes.ftsTableBytes / 1024 / 1024).toFixed(2)} MB（${results.sizes.ratio} 倍）`,
  )
  console.log(`写入：普通表 ${results.insert.plainMs} ms，trigram ${results.insert.ftsMs} ms`)
  console.table(
    Object.fromEntries(
      Object.entries(results.queries).map(([name, value]) => [
        name,
        {
          'MATCH ms': value.match ? value.match.ms : '-',
          'MATCH 命中': value.match ? value.match.hits : '-',
          'LIKE ms': value.like ? value.like.ms : '-',
          'LIKE 命中': value.like ? value.like.hits : '-',
        },
      ]),
    ),
  )
  console.log(`排序查询：${results.rank.ms} ms，返回 ${results.rank.rows} 行`)
  console.log(`片段：${results.snippet}`)
  console.log('结果已写入 docs/probe-fts.json')
}

app.whenReady().then(() => {
  let code = 0
  try {
    run()
  } catch (error) {
    console.error('[probe-fts] 失败', error)
    code = 1
  }
  app.exit(code)
})
