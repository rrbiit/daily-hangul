// 通用例句审核脚本：dump 指定教材、指定课的例句（手写 or 生成器）
// 用法：
//   node scripts/dump.js <bookId> <lessonNum>          # 默认：只看"无手写例句"的词，打印生成器输出（手写审核工作流）
//   node scripts/dump.js <bookId> <lessonNum> --all     # 全部词都看：手写词标 [已有手写N句]，无手写词打印生成器输出
//   node scripts/dump.js <bookId> <lessonNum> --hand    # 只看手写词
// 示例：
//   node scripts/dump.js yonsei2 1        # 延世2 第1课待手写词的生成器例句（开工前审核病句清单）
//   node scripts/dump.js yonsei2 1 --all  # 延世2 第1课全词例句总览
//
// 设计说明：每课手写前先 dump 出生成器例句 → 把病句/语义错的词列入手写清单 →
// 手写完成后跑 node scripts/check-examples.js 回归（无手写词的生成器输出也会被检查）。
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const ROOT = path.resolve(__dirname, '..')

const [bookId, lessonNum, flag] = process.argv.slice(2)
if (!bookId || !lessonNum) {
  console.error('用法: node scripts/dump.js <bookId> <lessonNum> [--all|--hand]')
  console.error('例:   node scripts/dump.js yonsei2 1')
  process.exit(1)
}
const mode = flag === '--all' ? 'all' : flag === '--hand' ? 'hand' : 'auto' // auto=只看无手写词

const ctx = {}
vm.createContext(ctx)
vm.runInContext(fs.readFileSync(path.join(ROOT, 'data-books.js'), 'utf8'), ctx)
const dataFiles = fs.readdirSync(ROOT).filter(f => /^data-(?!books\.js).*\.js$/.test(f)).sort()
for (const f of dataFiles) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx)
}
// 生成器例句审核需要 generateExample（utils.js）→ 一并加载进沙箱
vm.runInContext(fs.readFileSync(path.join(ROOT, 'utils.js'), 'utf8'), ctx)

const out = vm.runInContext(`
  (function () {
    var mode = '${mode}'  // auto=只看无手写词 / all=全部 / hand=只看手写词
    // 把目标书设为当前书（generateExample 不依赖书状态，此处仅为保证 getCurrentBook 语义正确）
    var book = BOOKS.find(function (b) { return b.bookId === '${bookId}' })
    if (!book) return '未找到教材: ${bookId}（已注册: ' + BOOKS.map(function(b){return b.bookId}).join(', ') + '）'
    APP_STATE.currentBookId = book.bookId
    bindBookGlobals()
    var lesson = book.lessons.find(function (l) { return String(l.num) === '${lessonNum}' })
    if (!lesson) return '未找到第${lessonNum}课（本教材共 ' + book.lessons.length + ' 课）'
    var words = book.vocab[lesson.num] || []
    var lines = []
    var hand = 0
    words.forEach(function (w) {
      var hasHand = !!(w.ex && w.ex.length)
      if (hasHand) hand++
      if (mode === 'hand' && !hasHand) return
      if (mode === 'auto' && hasHand) return
      lines.push('### ' + w.kr + '（' + w.cn + ' · ' + w.pos + ' · ' + (w.stars || 0) + '星）')
      if (hasHand) {
        w.ex.forEach(function (e) { lines.push('  ✍ ' + e.kr + ' / ' + e.cn) })
      } else {
        var gen = generateExample(w) || []
        if (!gen.length) {
          lines.push('  ⚠️（生成器无输出——该词类无模板且未手写）')
        } else {
          gen.forEach(function (g) { lines.push('  ⚙ ' + g.kr + ' / ' + g.cn) })
        }
      }
    })
    lines.push('')
    lines.push('—— ' + book.bookTag + ' 第${lessonNum}课 · ' + lesson.title + '（' + lesson.kr + '）· 共 ' + words.length + ' 词 · 手写 ' + hand + ' 词 · 待手写 ' + (words.length - hand) + ' 词')
    return lines.join(String.fromCharCode(10))
  })()
`, ctx)

console.log(out)
