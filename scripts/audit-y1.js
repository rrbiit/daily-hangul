/* ════════════════════════════════════════════════════════════════
   audit-y1.js — 延世1 每课「越级词」审计脚本（无 DOM，纯 Node）
   用法：node scripts/audit-y1.js [课号]
         node scripts/audit-y1.js        # 全部 10 课
         node scripts/audit-y1.js 3      # 只看第 3 课

   背景：项目内容标准是「学到哪就用哪些」——Y1 第 n 课的例句只能
   使用 Y1 第 1..n 课已学词汇（+ 少量超基础例外词）。本脚本对每课
   每个手写例句做 substring 匹配，找出「本课还没学」的词。

   判定规则：
   - 第 n 课的禁用集 = Y1 第 n+1..10 课全部词 + 延世2 全部词
   - 排除词条自身的词（如 김치 例句里的 김치）
   - 输出命中（含命中词来源），供人工复查：
     * 复合词子串误报（如 산 ← 계산、하늘 ← 하늘색）
     * 超基础例外词（밥/물/책/노래/커피/사람/정말/한국어 等）

   退出码：0（脚本只报告，不判失败——误报需人工确认）。
   ════════════════════════════════════════════════════════════════ */
'use strict'

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const ROOT = path.resolve(__dirname, '..')
const ONLY_LESSON = process.argv[2] ? Number(process.argv[2]) : null

// 加载全部教材数据
const ctx = {}
vm.createContext(ctx)
vm.runInContext(fs.readFileSync(path.join(ROOT, 'data-books.js'), 'utf8'), ctx)
const dataFiles = fs.readdirSync(ROOT).filter(f => /^data-(?!books\.js).*\.js$/.test(f)).sort()
for (const f of dataFiles) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx)
}

const result = vm.runInContext(`
  (function () {
    const y1 = BOOKS.find(function (b) { return b.bookId === 'yonsei1' })
    const y2 = BOOKS.find(function (b) { return b.bookId === 'yonsei2' })
    if (!y1 || !y2) return { error: '缺少 yonsei1 / yonsei2 教材' }

    // 每课词表（仅名词/动词/形容词/副词等实词，排除语法卡）
    const lessonWords = {}
    const lessonOrder = Object.keys(y1.vocab).map(Number).sort(function (a, b) { return a - b })
    lessonOrder.forEach(function (n) {
      lessonWords[n] = y1.vocab[n].map(function (w) { return w.kr })
    })
    // Y2 全部词
    const y2Words = []
    Object.keys(y2.vocab).forEach(function (n) {
      y2.vocab[n].forEach(function (w) { y2Words.push(w.kr) })
    })

    // 第 n 课禁用集：Y1 第 n+1..10 课词 + Y2 全部词
    function bannedFor (n) {
      const set = new Set()
      lessonOrder.forEach(function (m) {
        if (m > n) lessonWords[m].forEach(function (w) { set.add(w) })
      })
      y2Words.forEach(function (w) { set.add(w) })
      return Array.from(set)
    }
    // 词 → 来源标签（Y1L几 / Y2）
    const sourceOf = {}
    lessonOrder.forEach(function (n) {
      lessonWords[n].forEach(function (w) {
        if (!sourceOf[w]) sourceOf[w] = 'Y1L' + n
      })
    })
    y2Words.forEach(function (w) {
      if (!sourceOf[w]) sourceOf[w] = 'Y2'
    })

    const hits = []
    lessonOrder.forEach(function (n) {
      if (${ONLY_LESSON ? 'n !== ' + ONLY_LESSON : 'false'}) return
      const banned = bannedFor(n)
      y1.vocab[n].forEach(function (w) {
        if (!w.ex) return
        w.ex.forEach(function (e) {
          const kr = e.kr || ''
          banned.forEach(function (bw) {
            if (bw === w.kr) return          // 词条自身不算
            if (kr.indexOf(bw) !== -1) {
              hits.push({
                lesson: n,
                word: w.kr,
                sentence: kr,
                banned: bw,
                source: sourceOf[bw]
              })
            }
          })
        })
      })
    })

    return { lessonOrder: lessonOrder, hits: hits }
  })()
`, ctx)

if (result.error) {
  console.error(result.error)
  process.exit(1)
}

console.log('── 延世1 每课越级词审计 ────────────────────────────')
if (ONLY_LESSON) console.log('仅检查第 ' + ONLY_LESSON + ' 课')
console.log('')

if (result.hits.length === 0) {
  console.log('✅ 无越级词命中（不含词条自身）。')
  process.exit(0)
}

let lastLesson = null
result.hits.forEach(function (h, i) {
  if (h.lesson !== lastLesson) {
    console.log('')
    console.log('【第' + h.lesson + '课】')
    lastLesson = h.lesson
  }
  console.log('  ' + h.word + '：' + h.sentence)
  console.log('      ↑ 含越级词「' + h.banned + '」（' + h.source + '）')
})
console.log('')
console.log('共 ' + result.hits.length + ' 处命中。请人工复查：复合词子串误报、超基础例外词可忽略。')
