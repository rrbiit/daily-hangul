/* ════════════════════════════════════════════════════════════════
   check-examples.js — 例句回归校验脚本（无 DOM，纯 Node）
   用法：node scripts/check-examples.js

   检查范围：所有已注册教材（data-books.js + 全部 data-*.js）的
   单词例句与语法例句。

   检查项：
   1. 每个手写词（w.ex 存在）恰好 4 句 —— 项目硬标准「每词 4 句」
   2. 每条例句的 kr / cn 均非空
   3. 例句不含裸자모（孤立韩文字母，说明数据损坏）
   4. 不含已知错误句式：
      - 词组被名词化（[가-힣]다를 / [가-힣]하다를，如「이를 닦다를」）
      - 어제/오늘/내일 误加 -에（第5课语法规则：这些词后不加 -에）
   5. 同一词 / 同一语法卡片内例句不重复（防复制粘贴事故）

    ── 生成器兜底词审计（无 w.ex 的词）──
    6. 无手写例句的词：抽样调用生成器（3 次），检查输出非空 + 结构性错误
       （词组名词化 / 裸자모 / 어제·오늘·내일 误加 -에）——补上原盲区，
       让 697 个生成器词也进入校验范围
    7. 输出「每课手写覆盖率」报告（手写 X/共 Y），未完成的课可视化，
       便于逐课推进手写工程（覆盖率不达标仅提示，不判失败）

   退出码：0 = 全部通过；1 = 发现问题（含生成器兜底词的结构性错误）。
   ════════════════════════════════════════════════════════════════ */
'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const ROOT = path.resolve(__dirname, '..')

// 已知遗留：延世2 第1/7/8/9/10课的 49 个词组/惯用语词，手写于「每词 3 句」旧标准时期，
// 现全站标准为每词 4 句。这些词计入报告（legacyThree）但不判失败，待逐课扩展到 4 句。
// 键格式：bookId|课号|kr（与下方检查脚本同款拼接）。
const LEGACY_THREE = new Set([])

// 1. 加载应用基础层 + 全部教材数据文件
const ctx = { __FILES__: [] }
vm.createContext(ctx)
vm.runInContext(fs.readFileSync(path.join(ROOT, 'data-books.js'), 'utf8'), ctx)
const dataFiles = fs.readdirSync(ROOT).filter(f => /^data-(?!books\.js).*\.js$/.test(f)).sort()
for (const f of dataFiles) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx)
}
// 生成器兜底词审计需要 generateExample（utils.js）→ 一并加载进沙箱
vm.runInContext(fs.readFileSync(path.join(ROOT, 'utils.js'), 'utf8'), ctx)
ctx.__FILES__ = dataFiles
ctx.__LEGACY = LEGACY_THREE

// 2. 在沙箱内执行检查（数据绑定在上下文里，避免跨脚本访问 let/const 的问题）
const result = vm.runInContext(`
  (function () {
    const problems = []
    const legacyThree = []
    let wordTotal = 0, handTotal = 0, grammarExampleTotal = 0

    // 每个词 + 词内例句的去重集合
    for (const book of BOOKS) {
      for (const lessonKey in book.vocab) {
        const ws = book.vocab[lessonKey]
        for (const w of ws) {
          wordTotal++
          if (w.ex && w.ex.length > 0) {
            handTotal++
            const tag = '[' + book.bookId + ' 第' + lessonKey + '课] ' + w.kr
            if (w.ex.length !== 4) {
              const key = book.bookId + '|' + lessonKey + '|' + w.kr
              if (__LEGACY.has(key)) legacyThree.push(tag + '：' + w.ex.length + ' 句（遗留，待扩展为 4 句）')
              else problems.push(tag + '：手写例句 ' + w.ex.length + ' 句，标准应为 4 句')
            }
            const seen = new Set()
            w.ex.forEach((e, i) => {
              if (!e.kr || !String(e.kr).trim()) problems.push(tag + ' 第' + (i + 1) + '条：缺 kr')
              if (!e.cn || !String(e.cn).trim()) problems.push(tag + ' 第' + (i + 1) + '条：缺 cn')
              if (!e.kr) return
              const kr = e.kr
              if (seen.has(kr)) problems.push(tag + ' 第' + (i + 1) + '条例句重复：' + kr)
              seen.add(kr)
              if (/[\\u1100-\\u11FF\\u3130-\\u318F]/.test(kr)) {
                problems.push(tag + ' 例句含裸자모：' + kr)
              }
              if (/([가-힣])(다|하다)를/.test(kr)) {
                problems.push(tag + ' 例句疑似词组被名词化（…다/하다+를）：' + kr)
              }
              if (/(어제|오늘|내일)에/.test(kr)) {
                problems.push(tag + ' 例句违反「어제/오늘/내일 不加 -에」：' + kr)
              }
            })
          }
        }
      }
      // 语法例句
      for (const lessonKey in book.grammar) {
        const cards = book.grammar[lessonKey]
        if (!Array.isArray(cards)) continue
        cards.forEach((g, gi) => {
          const tag = '[' + book.bookId + ' 语法第' + lessonKey + '课 #' + (gi + 1) + ']'
          const seen = new Set()
          const exs = Array.isArray(g.examples) ? g.examples : []
          exs.forEach((e, ei) => {
            grammarExampleTotal++
            if (!e.kr || !String(e.kr).trim()) problems.push(tag + ' 第' + (ei + 1) + '条例句：缺 kr')
            if (!e.cn || !String(e.cn).trim()) problems.push(tag + ' 第' + (ei + 1) + '条例句：缺 cn')
            if (!e.kr) return
            const kr = e.kr
            if (seen.has(kr)) problems.push(tag + ' 第' + (ei + 1) + '条例句重复：' + kr)
            seen.add(kr)
            if (/[\\u1100-\\u11FF\\u3130-\\u318F]/.test(kr)) {
              problems.push(tag + ' 例句含裸자모：' + kr)
            }
            if (/([가-힣])(다|하다)를/.test(kr)) {
              problems.push(tag + ' 例句疑似词组被名词化：' + kr)
            }
            if (/(어제|오늘|내일)에/.test(kr)) {
              problems.push(tag + ' 例句违反「어제/오늘/내일 不加 -에」：' + kr)
            }
          })
        })
      }
    }

    // ── 生成器兜底词审计：无手写例句的词，抽样生成器输出（补原盲区）──
    const genProblems = []
    const coverage = []  // 每课手写覆盖率 { book, lesson, total, hand, gen }
    for (const book of BOOKS) {
      for (const lessonKey in book.vocab) {
        const ws = book.vocab[lessonKey]
        let hand = 0
        for (const w of ws) {
          if (w.ex && w.ex.length > 0) { hand++; continue }
          const tag = '[' + book.bookId + ' 第' + lessonKey + '课·生成器] ' + w.kr
          let gotAny = false
          // 生成器随机取模板 → 抽 3 次，尽量覆盖到会随机撞出的病句
          for (let s = 0; s < 3; s++) {
            const gen = generateExample(w) || []
            if (gen.length === 0) continue
            gotAny = true
            gen.forEach(function (e, i) {
              if (!e.kr || !String(e.kr).trim()) genProblems.push(tag + ' 第' + (i + 1) + '条：缺 kr')
              if (!e.kr) return
              if (/[\\u1100-\\u11FF\\u3130-\\u318F]/.test(e.kr)) genProblems.push(tag + ' 生成器例句含裸자모：' + e.kr)
              if (/([가-힣])(다|하다)를/.test(e.kr)) genProblems.push(tag + ' 生成器例句疑似词组被名词化（…다/하다+를）：' + e.kr)
              if (/(어제|오늘|내일)에/.test(e.kr)) genProblems.push(tag + ' 生成器例句违反「어제/오늘/내일 不加 -에」：' + e.kr)
            })
          }
          if (!gotAny) genProblems.push(tag + '：生成器无输出（该词类无模板且未手写，例句会缺失）')
        }
        coverage.push({ book: book.bookId, lesson: lessonKey, total: ws.length, hand: hand, gen: ws.length - hand })
      }
    }

    return {
      books: BOOKS.length,
      dataFiles: __FILES__,
      wordTotal: wordTotal,
      handTotal: handTotal,
      grammarExampleTotal: grammarExampleTotal,
      legacyThree: legacyThree,
      problems: problems,
      genProblems: genProblems,
      coverage: coverage
    }
  })()
`, ctx)

// 3. 输出
console.log('── 例句回归校验 ───────────────────────────────')
console.log('教材数            : ' + result.books)
console.log('数据文件          : ' + result.dataFiles.join(', '))
console.log('单词总数          : ' + result.wordTotal)
console.log('手写词数(有 ex)   : ' + result.handTotal)
console.log('语法例句总数      : ' + result.grammarExampleTotal)
console.log('')

if (result.legacyThree.length > 0) {
  console.log('ℹ️ 已知遗留（' + result.legacyThree.length + ' 个词仍为 3 句，待扩展为 4 句，不影响判定）：')
  result.legacyThree.forEach(function (p, i) {
    console.log('  · ' + p)
  })
  console.log('')
}

// 每课手写覆盖率（生成器兜底可视化：手写工程逐课推进的进度表）
console.log('── 手写例句覆盖率 ──────────────────────────────')
result.coverage.forEach(function (c) {
  var pct = c.total > 0 ? Math.round(c.hand / c.total * 100) : 100
  var flag = c.hand === c.total ? '✅' : ('⚠️ 待手写 ' + c.gen + ' 词')
  console.log('  [' + c.book + ' 第' + c.lesson + '课] ' + c.hand + '/' + c.total + ' (' + pct + '%) ' + flag)
})
console.log('')

var allProblems = result.problems.concat(result.genProblems)
if (allProblems.length === 0) {
  console.log('✅ 通过：无违反 4 句标准的词，生成器兜底词无结构性错误，无损坏例句。')
  process.exit(0)
}

console.log('❌ 发现 ' + allProblems.length + ' 个问题：')
allProblems.forEach(function (p, i) {
  console.log('  ' + (i + 1) + '. ' + p)
})
process.exit(1)
