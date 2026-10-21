// 只读查看当前用户数据目录下的数据库：npm run db:inspect
const { app } = require('electron')
const { DatabaseSync } = require('node:sqlite')
const { existsSync } = require('node:fs')
const { join } = require('node:path')

app.setName('Lumen')
app.setPath('userData', join(app.getPath('appData'), 'Lumen'))

app.whenReady().then(() => {
  const dbPath = join(app.getPath('userData'), 'lumen.db')
  if (!existsSync(dbPath)) {
    console.log(`数据库还不存在：${dbPath}`)
    console.log('先运行一次应用（npm run dev），首次启动会自动建库。')
    app.exit(1)
    return
  }

  const db = new DatabaseSync(dbPath, { readOnly: true })
  console.log(`数据库：${dbPath}`)
  console.log(`schema 版本：${db.prepare('PRAGMA user_version').get().user_version}`)
  console.log(`sqlite：${db.prepare('SELECT sqlite_version() AS v').get().v}`)

  const tables = db
    .prepare(
      "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()

  console.log('')
  for (const table of tables) {
    let count = -1
    try {
      count = db.prepare(`SELECT count(*) AS n FROM "${table.name}"`).get().n
    } catch {
      count = -1
    }
    const kind = table.type === 'view' ? '视图' : '表  '
    console.log(`${kind} ${table.name.padEnd(20)} ${count} 行`)
  }

  db.close()
  app.exit(0)
})
