/* ════════════════════════════════════════════════════════════════
   test-quiz.js — 阶段2：测验接入易混词后的集成验证
   用法：node scripts/test-quiz.js
   覆盖：题目结构携带词 key / 易混词干扰项注入 / A→B 记录（选择+听写）/
         听写"很接近"记录混淆但不改判分 / 听音→中文保留 / 听音→韩语新增 /
         普通题与辨析题并存 / 多教材隔离
   通过 = 打印 PASS 摘要并退出码 0；失败 = 打印 FAIL 详情并退出码 1
   ════════════════════════════════════════════════════════════════ */
'use strict'
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const ROOT = path.resolve(__dirname, '..')

let passed = 0, failed = 0
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg) }
  else { failed++; console.log('  ✗ FAIL: ' + msg) }
}

// ─── 最小 DOM 桩（供 quizAnswer / dictSubmit 使用）───
function fakeEl() {
  return {
    style: {},
    classList: { add() {}, remove() {}, contains() { return false }, toggle() {} },
    textContent: '', innerHTML: '', value: '', disabled: false,
    setAttribute() {}, getAttribute() { return null },
    appendChild() {}, querySelectorAll() { return [] }, querySelector() { return null }, focus() {}
  }
}
function makeDom() {
  const els = {}
  return {
    getElementById(id) { if (!els[id]) els[id] = fakeEl(); return els[id] },
    querySelectorAll(sel) {
      if (sel === '#quiz-options .quiz-option') {
        if (!els.__opts) els.__opts = [fakeEl(), fakeEl(), fakeEl(), fakeEl()]
        return els.__opts
      }
      return []
    },
    createElement() { return fakeEl() }
  }
}

// ─── 上下文（模拟浏览器：localStorage + DOM + 基础工具 + 各模块）───
const storageMap = {}
const ctx = {
  console,
  Date, JSON,
  Math: Object.create(Math),          // 独立 Math，测试可安全替换 random
  localStorage: {
    getItem: k => (k in storageMap ? storageMap[k] : null),
    setItem: (k, v) => { storageMap[k] = String(v) },
    removeItem: k => { delete storageMap[k] },
  },
  document: makeDom(),
  setTimeout: () => 0,                // 自动跳题/自动播放不执行，保证测试确定性
  clearTimeout: () => {},
  setInterval: () => 0,
  clearInterval: () => {},
  // index.html 内联基础工具（测试桩）
  lsGet: () => '',
  lsSet: () => {},
  setKeys: s => { const a = []; s.forEach(v => a.push(v)); return a },
  showPage: () => {},
  // app.js 提供的全局（浏览器里由 app.js 定义；测验答对计数依赖它们）
  srs: {},
  markMastered: () => {},
  saveUserData: () => {},
  markStudyDay: () => {},
  hideNav: () => {},
  showNav: () => {},
  showAppDialog: () => {},
  addQuizSummary: () => {},
  unmarkMastered: () => {},
  getStudyDay: () => '2026-01-01',
  updateHomeStats: () => {},
}
vm.createContext(ctx)
const FILES = ['data-books.js', 'data-yonsei1.js', 'data-yonsei2.js', 'utils.js', 'confusion.js', 'quiz.js']
FILES.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx))

// 测试辅助（vm 内全局函数）
vm.runInContext(`
  function testKeyOf(bookId, kr) {
    for (var i = 0; i < BOOKS.length; i++) {
      var b = BOOKS[i]
      if (b.bookId !== bookId) continue
      var nums = Object.keys(b.vocab || {})
      for (var n = 0; n < nums.length; n++) {
        var ws = b.vocab[nums[n]] || []
        for (var k = 0; k < ws.length; k++) if (ws[k].kr === kr) return bookId + '|' + nums[n] + '|' + kr
      }
    }
    return null
  }
  function testBind(bookId) { APP_STATE.currentBookId = bookId; bindBookGlobals() }
  function testSetMode(mode) { quizMode = mode }
  function testSetCount(n) { quizCount = n }
  function testReset() { quizQuestions = []; quizIndex = 0; quizAnswered = false; quizAnswers = []; quizErrors = [] }
  function testPool() {
    var pool = []
    LESSONS.forEach(function (l) {
      (VOCAB[l.num] || []).forEach(function (w) {
        var item = {}; for (var k in w) if (w.hasOwnProperty(k)) item[k] = w[k]
        item.lessonNum = l.num
        pool.push(item)
      })
    })
    return pool
  }
  function testPoolOf(krs) {
    var pool = []
    LESSONS.forEach(function (l) {
      (VOCAB[l.num] || []).forEach(function (w) {
        if (krs.indexOf(w.kr) >= 0) {
          var item = {}; for (var k in w) if (w.hasOwnProperty(k)) item[k] = w[k]
          item.lessonNum = l.num
          pool.push(item)
        }
      })
    })
    return pool
  }
  function testItemByKey(key) {
    var parts = key.split('|')
    var ws = VOCAB[parts[1]] || []
    for (var i = 0; i < ws.length; i++) if (ws[i].kr === parts.slice(2).join('|')) {
      var item = {}; for (var k in ws[i]) if (ws[i].hasOwnProperty(k)) item[k] = ws[i][k]
      item.lessonNum = Number(parts[1])
      return item
    }
    return null
  }
`, ctx)

// 强制/恢复 Math.random
function forceRandom(v) { ctx.Math.random = () => v }
function restoreRandom() { ctx.Math.random = Math.random }

// Node 侧包装（vm 内辅助函数）
function testBind(b) { vm.runInContext("testBind('" + b + "')", ctx) }
function testSetMode(m) { vm.runInContext("testSetMode('" + m + "')", ctx) }
function testSetCount(n) { vm.runInContext('testSetCount(' + n + ')', ctx) }
function testReset() { vm.runInContext('testReset()', ctx) }

testBind('yonsei1')
testSetCount(10)
testReset()
console.log('── A. 题目结构携带词 key（kr-cn）──')
restoreRandom()
forceRandom(0.0)   // 确定性：总是注入易混词
let qs = vm.runInContext('generateQuizQuestions(testPool())', ctx)
ok(qs.length === 10, '生成 10 题')
let structOk = qs.every(q =>
  q.targetKey && String(q.targetKey).indexOf('yonsei1|') === 0 &&
  Array.isArray(q.options) && q.options.length === 4 &&
  Array.isArray(q.optionKeys) && q.optionKeys.length === 4 &&
  q.correctIdx >= 0 && q.correctIdx <= 3 &&
  q.options[q.correctIdx] === q.word.cn &&
  q.optionKeys[q.correctIdx] === q.targetKey
)
ok(structOk, '每题携带 targetKey + optionKeys，正确项 key 对齐，选项为中文释义')
ok(qs.every(q => new Set(q.options).size === 4), '每题 4 个选项无显示重复')
const y1KeySet = vm.runInContext(`(function () {
  var s = {}
  Object.keys(VOCAB).forEach(function (n) { (VOCAB[n] || []).forEach(function (w) { s['yonsei1|' + n + '|' + w.kr] = 1 }) })
  return s
})()`, ctx)
ok(qs.every(q => q.optionKeys.every(k => y1KeySet[k])), '所有选项 key 均为延世1 真实词条')

console.log('── B. 听写题结构（dict）──')
testSetMode('dict')
forceRandom(0.0)
qs = vm.runInContext('generateQuizQuestions(testPool())', ctx)
ok(qs.length === 10 && qs.every(q => q.options.length === 0 && q.correctIdx === -1 && q.targetKey), '听写题无选项但携带 targetKey')
testSetMode('kr-cn')

console.log('── C. 易混词进入选项（kr-cn 中文干扰 + listen-kr 韩语干扰）──')
const K = {
  ssa: vm.runInContext("testKeyOf('yonsei1','싸다')", ctx),
  sa:  vm.runInContext("testKeyOf('yonsei1','사다')", ctx),
  sseu:vm.runInContext("testKeyOf('yonsei1','쓰다')", ctx),
  biss:vm.runInContext("testKeyOf('yonsei1','비싸다')", ctx),
  irum:vm.runInContext("testKeyOf('yonsei1','이름')", ctx),
  kga: vm.runInContext("testKeyOf('yonsei1','가다')", ctx),
  kod: vm.runInContext("testKeyOf('yonsei1','오다')", ctx),
  kbo: vm.runInContext("testKeyOf('yonsei1','보다')", ctx),
}
ok(K.ssa && K.sa && K.sseu && K.biss && K.irum && K.kga && K.kod && K.kbo, '测试词 key 齐备')
forceRandom(0.0)
// 小词池：保证 싸다 一定出现在题目序列中（不依赖大池随机抽样）
const ssaPool = vm.runInContext("testPoolOf(['싸다','사다','쓰다','비싸다','이름'])", ctx)
ctx.ssaPool = ssaPool
qs = vm.runInContext('generateQuizQuestions(ssaPool)', ctx)
const ssaQ = qs.find(q => q.targetKey === K.ssa)
ok(!!ssaQ, '题目序列包含 싸다 题')
ok(ssaQ.options.includes('便宜'), '싸다 题正确选项 = 便宜')
const partnerCnHit = ssaQ.options.filter(t => ['买', '写', '苦', '贵'].indexOf(t) >= 0)
ok(partnerCnHit.length > 0, '싸다 题干扰项包含易混伙伴的中文（' + partnerCnHit.join('/') + '）')

testSetMode('listen-kr')
forceRandom(0.0)
qs = vm.runInContext('generateQuizQuestions(ssaPool)', ctx)
const ssaQ2 = qs.find(q => q.targetKey === K.ssa)
ok(!!ssaQ2 && ssaQ2.options.includes('싸다'), '听音→韩语 题正确选项 = 싸다 词形')
const partnerKrHit = ssaQ2.options.filter(t => ['사다', '쓰다', '비싸다'].indexOf(t) >= 0)
ok(partnerKrHit.length > 0, '听音→韩语 题干扰项包含相似词形（' + partnerKrHit.join('/') + '）')
testSetMode('kr-cn')

console.log('── D. 普通题与辨析题并存（不全是易混题）──')
forceRandom(0.0)
qs = vm.runInContext('generateQuizQuestions(ssaPool)', ctx)
const ssaQ3 = qs.find(q => q.targetKey === K.ssa)
const partnersSet = vm.runInContext(`(function () {
  var s = {}
  getConfusionPartners('${K.ssa}').forEach(function (p) { s[p.key] = 1 })
  return s
})()`, ctx)
ok(ssaQ3.optionKeys.filter(k => k !== K.ssa && partnersSet[k]).length <= 2, '易混伙伴注入上限 2 个（不喧宾夺主）')
const normalOpts = ssaQ3.optionKeys.filter(k => k !== K.ssa && !partnersSet[k])
ok(normalOpts.length > 0, '싸다 题存在非易混伙伴的普通干扰项（' + normalOpts.length + ' 个）——普通随机成分保留')
forceRandom(0.99)   // 不注入
qs = vm.runInContext('generateQuizQuestions(testPool())', ctx)
ok(qs.length === 10 && qs.every(q => q.options.length === 4 && q.optionKeys.length === 4), '关闭注入时普通随机题正常生成')
restoreRandom()

console.log('── E. 选择题 A→B 记录（quizAnswer 路径）──')
vm.runInContext('clearConfusions()', ctx)
testReset()
forceRandom(0.0)
qs = vm.runInContext('generateQuizQuestions(ssaPool)', ctx)
const eQ = qs.find(q => q.targetKey === K.ssa)
const eIdx = eQ.options.indexOf('买')
ok(eIdx >= 0, '싸다 题的选项包含 사다 的中文（买）')
if (eIdx >= 0) {
  // 用含 '买' 的 싸다 题跑一次真实判分路径
  vm.runInContext(`quizQuestions = [${JSON.stringify(eQ)}]; quizIndex = 0; quizAnswered = false; quizAnswers = []; quizErrors = []`, ctx)
  vm.runInContext(`quizAnswer(${eIdx})`, ctx)
  const rec = vm.runInContext('quizAnswers[0]', ctx)
  ok(rec && rec.correct === false && rec.targetKey === K.ssa && rec.selectedKey === K.sa, '答错时记录 targetKey=싸다、selectedKey=사다')
  const pers = vm.runInContext('getPersonalPairs("yonsei1")', ctx)
  ok(pers.length === 1 && pers[0].ba === 1, '已记录个人混淆 싸다→사다（ba=1，方向正确）')
  ok(vm.runInContext('quizErrors.length === 1', ctx) === true, '错题照常进入 quizErrors（易错本/SRS 路径不变）')
}
restoreRandom()

console.log('── F. 无关选择只记答错、不记混淆（quizAnswer 路径）──')
vm.runInContext('clearConfusions()', ctx)
const fWord = vm.runInContext(`testItemByKey('${K.ssa}')`, ctx)
const fQ = { word: fWord, targetKey: K.ssa, options: ['便宜', '买', '名字', '写'], optionKeys: [K.ssa, K.sa, K.irum, K.sseu], correctIdx: 0 }
vm.runInContext(`quizQuestions = [${JSON.stringify(fQ)}]; quizIndex = 0; quizAnswered = false; quizAnswers = []; quizErrors = []`, ctx)
vm.runInContext('quizAnswer(2)', ctx)   // 选 이름（完全无关）
const fRec = vm.runInContext('quizAnswers[0]', ctx)
ok(fRec && fRec.correct === false && fRec.selectedKey === K.irum, '选无关词 → 答错记录 selectedKey=이름')
ok(vm.runInContext('getPersonalPairs("yonsei1").length === 0', ctx) === true, '无关选择不产生任何混淆关系')
ok(vm.runInContext('quizErrors.length === 1', ctx) === true, '无关选择仍照常记入错题')

console.log('── G. 听写记录实际输入词（不改判分）──')
testSetMode('dict')
// G1：打错成另一个真实词（싸다 → 输入 사다）→ 判错 + 记录混淆
vm.runInContext('clearConfusions()', ctx)
const g1Word = vm.runInContext(`testItemByKey('${K.ssa}')`, ctx)
vm.runInContext(`quizQuestions = [{ word: ${JSON.stringify(g1Word)}, targetKey: '${K.ssa}', options: [], optionKeys: [], correctIdx: -1 }]; quizIndex = 0; quizAnswered = false; quizAnswers = []; quizErrors = []`, ctx)
ctx.document.getElementById('quiz-dict-field').value = '사다'
vm.runInContext('dictSubmit()', ctx)
let gRec = vm.runInContext('quizAnswers[0]', ctx)
ok(gRec && gRec.correct === false && gRec.matchedKey === K.sa, '输入 사다 → 判错，matchedKey=사다')
ok(vm.runInContext('getPersonalPairs("yonsei1").length === 1', ctx) === true, '已记录 싸다→사다 混淆')

// G2："很接近"（비싸다 → 输入 싸다）→ 中性第三态（不算对、不算错）+ 同时记录混淆
vm.runInContext('clearConfusions()', ctx)
const g2Word = vm.runInContext(`testItemByKey('${K.biss}')`, ctx)
vm.runInContext(`quizQuestions = [{ word: ${JSON.stringify(g2Word)}, targetKey: '${K.biss}', options: [], optionKeys: [], correctIdx: -1 }]; quizIndex = 0; quizAnswered = false; quizAnswers = []; quizErrors = []; quizScore = 0`, ctx)
ctx.document.getElementById('quiz-dict-field').value = '싸다'
vm.runInContext('dictSubmit()', ctx)
gRec = vm.runInContext('quizAnswers[0]', ctx)
ok(gRec && gRec.correct === false && gRec.close === true, '비싸다 输入 싸다 → 中性：不算对（correct=false，close=true）')
ok(vm.runInContext('quizScore', ctx) === 0 && vm.runInContext('quizErrors.length', ctx) === 0, '很接近 → 不计分、不进错题')
ok(gRec && gRec.matchedKey === K.ssa, '同时记录 matchedKey=싸다（潜在混淆信号）')
const g2Pers = vm.runInContext('getPersonalPairs("yonsei1")', ctx)
ok(g2Pers.length === 1 && g2Pers[0].ab === 1, '已记录 비싸다→싸다 混淆（ab=1），且不改变判分')

// G3：单纯拼写错误（乱码）→ 判错 + 不记混淆
vm.runInContext('clearConfusions()', ctx)
const g3Word = vm.runInContext(`testItemByKey('${K.ssa}')`, ctx)
vm.runInContext(`quizQuestions = [{ word: ${JSON.stringify(g3Word)}, targetKey: '${K.ssa}', options: [], optionKeys: [], correctIdx: -1 }]; quizIndex = 0; quizAnswered = false; quizAnswers = []; quizErrors = []`, ctx)
ctx.document.getElementById('quiz-dict-field').value = 'ㅁㄴㅇㄹ'
vm.runInContext('dictSubmit()', ctx)
gRec = vm.runInContext('quizAnswers[0]', ctx)
ok(gRec && gRec.correct === false && gRec.matchedKey === null, '乱码 → 判错，不匹配任何词（matchedKey=null）')
ok(vm.runInContext('getPersonalPairs("yonsei1").length === 0', ctx) === true, '乱码不产生混淆记录')
testSetMode('kr-cn')

console.log('── H. 听音→中文保留 & 听音→韩语新增 ──')
testSetMode('listen')
forceRandom(0.99)
qs = vm.runInContext('generateQuizQuestions(testPool())', ctx)
ok(qs.every(q => q.options[q.correctIdx] === q.word.cn && q.optionKeys[q.correctIdx] === q.targetKey), '听音→中文：选项仍为中文释义，key 齐全')
testSetMode('listen-kr')
qs = vm.runInContext('generateQuizQuestions(testPool())', ctx)
ok(qs.every(q => q.options[q.correctIdx] === q.word.kr && q.optionKeys[q.correctIdx] === q.targetKey), '听音→韩语：选项为韩语词形，key 齐全')
restoreRandom()
testSetMode('kr-cn')

console.log('── I. 多教材隔离（quiz 层）──')
vm.runInContext('clearConfusions()', ctx)
testBind('yonsei2')
forceRandom(0.0)
qs = vm.runInContext('generateQuizQuestions(testPool())', ctx)
ok(qs.length === 10 && qs.every(q =>
  String(q.targetKey).indexOf('yonsei2|') === 0 &&
  q.optionKeys.every(k => String(k).indexOf('yonsei2|') === 0)
), '延世2 生成的题目 key 全部为 yonsei2 前缀，无延世1 泄漏')
// 延世2 内记录一条混淆，确认不串到延世1
const y2Ssa = vm.runInContext("testKeyOf('yonsei2','싸다')", ctx)
const y2Sa = vm.runInContext("testKeyOf('yonsei2','사다')", ctx)
vm.runInContext(`recordConfusion('${y2Ssa}', '${y2Sa}')`, ctx)
ok(vm.runInContext('getPersonalPairs("yonsei2").length === 1', ctx) === true, '延世2 混淆记录只属于 yonsei2')
ok(vm.runInContext('getPersonalPairs("yonsei1").length === 0', ctx) === true, '延世1 不受影响（完全隔离）')
testBind('yonsei1')
restoreRandom()

console.log('── J. 伙伴排序：个人混淆优先于预设候选 ──')
vm.runInContext('clearConfusions()', ctx)
const partnersPre = vm.runInContext(`getConfusionPartners('${K.ssa}')`, ctx)
ok(partnersPre.length > 0 && partnersPre[0].key === K.sa, '无个人记录时，jamo 相似度把 사다（紧音对 ㅆ/ㅅ）排到预设候选第一')
vm.runInContext(`recordConfusion('${K.ssa}', '${K.sa}')`, ctx)
vm.runInContext(`recordConfusion('${K.ssa}', '${K.sa}')`, ctx)   // 权重 2，活跃
const partners = vm.runInContext(`getConfusionPartners('${K.ssa}')`, ctx)
ok(partners.length > 0 && partners[0].key === K.sa && partners[0].kind === 'personal', '个人混淆（사다, weight=2）排在预设候选之前')

console.log('── K. 动态权重：次数 × 时间衰减 × 连续答对渐进折扣 ──')
const wk3 = vm.runInContext(`(function () {
  var now = Date.now()
  return {
    fresh: pairWeight({ ab: 2, ba: 1, last: now, resolvedStreak: 0 }),       // 3
    resolve1: pairWeight({ ab: 2, ba: 1, last: now, resolvedStreak: 1 }),    // 3×0.85=2.55
    resolve5: pairWeight({ ab: 2, ba: 1, last: now, resolvedStreak: 5 }),    // 3×0.85^5≈1.331
    resolve50: pairWeight({ ab: 2, ba: 1, last: now, resolvedStreak: 50 }),  // 仍 > 0
    decay100: pairWeight({ ab: 2, ba: 1, last: now - 100 * 86400000, resolvedStreak: 0 }) // < 0.5
  }
})()`, ctx)
ok(wk3.fresh === 3, '基础权重 = 混淆次数 3（实际 ' + wk3.fresh + '）')
ok(wk3.resolve1 === 2.55, '连续答对 1 次 → 3×0.85=2.55（渐进降低，非一次清零）')
ok(wk3.resolve5 === 1.331, '连续答对 5 次 → 3×0.85^5≈1.331（逐渐降低）')
ok(wk3.resolve50 > 0, '连续答对 50 次 → 权重仍 > 0（不永久消失）')
ok(wk3.decay100 > 0 && wk3.decay100 < 0.5, '100 天未出现 → 时间衰减到 <0.5（' + wk3.decay100 + '，仍 >0）')

console.log('── L. 辨析题插槽：高权重个人混淆对进入，间隔放置，普通题仍占多数 ──')
vm.runInContext('clearConfusions()', ctx)
for (let li = 0; li < 4; li++) vm.runInContext(`recordConfusion('${K.ssa}', '${K.sa}')`, ctx)   // weight 4
forceRandom(0.0)   // 确定性：加权采样取第一个、放置间隔 = 2
qs = vm.runInContext('generateQuizQuestions(ssaPool)', ctx)
const idxSsa = qs.findIndex(q => q.targetKey === K.ssa)
const idxSa = qs.findIndex(q => q.targetKey === K.sa)
ok(idxSsa >= 0 && idxSa >= 0, '高权重个人混淆对（싸다↔사다）进入辨析题')
ok(Math.abs(idxSsa - idxSa) === 2, '辨析对间隔 2 题（不机械相邻）')
ok(qs.length === ssaPool.length, '总题数与词池一致（' + qs.length + ' 题）')
restoreRandom()

console.log('── M. 加权采样：权重高的混淆对出现更多（统计验证）──')
vm.runInContext('clearConfusions()', ctx)
for (let mi = 0; mi < 4; mi++) vm.runInContext(`recordConfusion('${K.ssa}', '${K.sa}')`, ctx)    // weight 4
for (let mi = 0; mi < 3; mi++) vm.runInContext(`recordConfusion('${K.sseu}', '${K.kbo}')`, ctx)   // weight 3
for (let mi = 0; mi < 2; mi++) vm.runInContext(`recordConfusion('${K.kga}', '${K.kod}')`, ctx)    // weight 2
restoreRandom()
let m1 = 0, m2 = 0, m3 = 0, maxPairsSeen = 0
for (let ri = 0; ri < 300; ri++) {
  const runQs = vm.runInContext('generateQuizQuestions(testPool())', ctx)
  const keys = runQs.map(q => q.targetKey)
  const has = k => keys.indexOf(k) >= 0
  let n = 0
  if (has(K.ssa) && has(K.sa)) { m1++; n++ }
  if (has(K.sseu) && has(K.kbo)) { m2++; n++ }
  if (has(K.kga) && has(K.kod)) { m3++; n++ }
  if (n > maxPairsSeen) maxPairsSeen = n
}
ok(m1 > m2 && m2 > m3, '权重 4 的对出现 ' + m1 + ' 次 > 权重 3（' + m2 + '）> 权重 2（' + m3 + '）')
ok(maxPairsSeen <= 2, '一局最多 2 个辨析对（实际最大 ' + maxPairsSeen + '）——20% 题量上限生效')

console.log('── N. 连续答对渐进降权（答题路径接线）+ 答错回升 ──')
vm.runInContext('clearConfusions()', ctx)
for (let ni = 0; ni < 4; ni++) vm.runInContext(`recordConfusion('${K.ssa}', '${K.sa}')`, ctx)   // weight 4
forceRandom(0.0)   // 个人伙伴 → 注入概率 0.8 → 0<0.8 必注入
qs = vm.runInContext('generateQuizQuestions(ssaPool)', ctx)
const nQ = qs.find(q => q.targetKey === K.ssa)
ok(nQ && nQ.contrastKeys.indexOf(K.sa) >= 0, '싸다 题注入 사다 并记录 contrastKeys')
let wBefore = vm.runInContext('getPersonalPairs("yonsei1")[0].weight', ctx)
ok(wBefore === 4, '初始权重 4')
for (let ci = 0; ci < 5; ci++) {
  vm.runInContext(`quizQuestions = [${JSON.stringify(nQ)}]; quizIndex = 0; quizAnswered = false; quizAnswers = []; quizErrors = []`, ctx)
  vm.runInContext(`quizAnswer(${nQ.correctIdx})`, ctx)   // 答对（区分了 사다）
}
const wAfter = vm.runInContext('getPersonalPairs("yonsei1")[0]', ctx)
ok(wAfter.resolvedStreak === 5, '连续答对 5 次 → resolvedStreak=5')
ok(wAfter.weight < wBefore && wAfter.weight > 0, '权重从 4 渐进降到 ' + wAfter.weight + '（>0，不一次清零）')
ok(wAfter.weight === Math.round(4 * Math.pow(0.85, 5) * 1000) / 1000, '权重 = 4×0.85^5 ≈ ' + wAfter.weight + '（公式精确）')
// 答错一次 → 混淆次数 +1、连续答对清零 → 权重回升
vm.runInContext(`quizQuestions = [${JSON.stringify(nQ)}]; quizIndex = 0; quizAnswered = false; quizAnswers = []; quizErrors = []`, ctx)
vm.runInContext(`quizAnswer(${nQ.options.indexOf('买')})`, ctx)
const wBack = vm.runInContext('getPersonalPairs("yonsei1")[0]', ctx)
ok(wBack.weight === 5 && wBack.resolvedStreak === 0, '答错一次 → 权重回升到 5、连续答对清零（最近答错 → 高权重）')
restoreRandom()

console.log('── O. 避免霸占：超高超重对也最多占用 2 题 ──')
vm.runInContext('clearConfusions()', ctx)
for (let oi = 0; oi < 50; oi++) vm.runInContext(`recordConfusion('${K.ssa}', '${K.sa}')`, ctx)   // weight 50
forceRandom(0.0)
qs = vm.runInContext('generateQuizQuestions(ssaPool)', ctx)
const ssaCount = qs.filter(q => q.targetKey === K.ssa).length
const saCount = qs.filter(q => q.targetKey === K.sa).length
ok(ssaCount === 1 && saCount === 1, 'weight=50 的超高对每词也只出现 1 次（不霸占整局）')
const normalCount = qs.filter(q => q.targetKey !== K.ssa && q.targetKey !== K.sa).length
ok(normalCount >= qs.length - 2, '普通题仍占多数（' + normalCount + '/' + qs.length + '）')
restoreRandom()

console.log('── P. 时间衰减：长期未出现 → 退出辨析题位但存储保留 ──')
const stale = vm.runInContext(`(function () {
  var p = { ab: 3, ba: 0, last: Date.now() - 100 * 86400000, resolvedStreak: 0 }
  var w = pairWeight(p)
  return { weight: w, eligible: w >= CONFUSION_ACTIVE_MIN_WEIGHT }
})()`, ctx)
ok(stale.weight > 0 && stale.weight < 0.5, '100 天未出现 → 权重 ' + stale.weight + '（>0 且低于辨析门槛 0.5）')
ok(stale.eligible === false, '权重不足 → 不占用辨析题位（getActivePersonalPairs 过滤）')

console.log('── Q. 听写模式共享同一套辨析对规划 ──')
vm.runInContext('clearConfusions()', ctx)
for (let qi = 0; qi < 4; qi++) vm.runInContext(`recordConfusion('${K.ssa}', '${K.sa}')`, ctx)
testSetMode('dict')
forceRandom(0.0)
qs = vm.runInContext('generateQuizQuestions(ssaPool)', ctx)
const qIdxSsa = qs.findIndex(q => q.targetKey === K.ssa)
const qIdxSa = qs.findIndex(q => q.targetKey === K.sa)
ok(qIdxSsa >= 0 && qIdxSa >= 0 && Math.abs(qIdxSsa - qIdxSa) === 2, '听写模式：辨析对近邻出现（间隔 2）')
ok(qs.every(q => q.options.length === 0 && q.contrastKeys.length === 0), '听写题无选项、无 contrastKeys（判分逻辑不变）')
testSetMode('kr-cn')
restoreRandom()

console.log('── R. 多教材隔离：活跃个人混淆对按书过滤 ──')
testBind('yonsei2')
ok(vm.runInContext('getActivePersonalPairs("yonsei2").length === 0', ctx) === true, '延世2 无个人混淆对 → 无辨析题（延世1 的记录不串书）')
testBind('yonsei1')
ok(vm.runInContext('getActivePersonalPairs("yonsei1").length >= 1', ctx) === true, '延世1 的个人混淆对正常存在')

console.log('── S. 测验答对累计 → 自动已掌握（quizCorrect）──')
// 构造 싸다（yonsei1）的确定题目：正确选项 0，干扰项 1（사다 中文"买"）
const sWord = vm.runInContext(`testItemByKey('${K.ssa}')`, ctx)
const sQ = { word: sWord, targetKey: K.ssa, options: ['便宜', '买', '写', '名字'], optionKeys: [K.ssa, K.sa, K.sseu, K.irum], correctIdx: 0, contrastKeys: [] }
function sAnswer(correct) {
  vm.runInContext(`quizQuestions = [${JSON.stringify(sQ)}]; quizIndex = 0; quizAnswered = false; quizAnswers = []; quizErrors = []`, ctx)
  vm.runInContext(`quizAnswer(${correct ? sQ.correctIdx : 1})`, ctx)
}
function sGet(key) { return vm.runInContext(`srs['${key}'] || null`, ctx) }
function sMastered(key) {
  return vm.runInContext(`(function(){ var it = testItemByKey('${key}'); return it ? isMastered(it, it.lessonNum) : false })()`, ctx)
}
function sReset() {
  vm.runInContext('srs = {}', ctx)
  vm.runInContext('quizAutoMasteredKeys = []', ctx)
  vm.runInContext('clearConfusions()', ctx)
}

// S1: 正常累计（答对 4 次 → 自动已掌握）
sReset()
for (let s1i = 0; s1i < 4; s1i++) sAnswer(true)
let s1d = sGet(K.ssa)
ok(s1d && s1d.quizCorrect === 4, '答对 4 次 → 累计次数 = 4（1→2→3→4）')
ok(s1d && s1d.lv === 4, '答对 4 次 → 自动变为已掌握（lv=4）')
ok(sMastered(K.ssa) === true, 'isMastered 判定为已掌握')
ok(vm.runInContext('quizAutoMasteredKeys.length', ctx) === 1, '本局自动掌握记录 1 个词')

// S2: 答错不清零、不增加
sReset()
sAnswer(true)   // 1
sAnswer(false)  // 答错 → 仍 1
sAnswer(true)   // 2
sAnswer(false)  // 答错 → 仍 2
ok(sGet(K.ssa).quizCorrect === 2 && sGet(K.ssa).lv !== 4, '对/错/对/错 → 次数 2，答错不增加也不清零')
sAnswer(true)   // 3
sAnswer(true)   // 4 → 已掌握
ok(sGet(K.ssa).quizCorrect === 4 && sGet(K.ssa).lv === 4, '继续答对到 4 → 自动已掌握（答错未影响累计）')

// S3: 封顶 4，不重复累计（不会出现 5/4）
sReset()
for (let s3i = 0; s3i < 6; s3i++) sAnswer(true)
ok(sGet(K.ssa).quizCorrect === 4, '答对 6 次 → 次数封顶 4（不出现 5/4）')
ok(sGet(K.ssa).lv === 4 && sMastered(K.ssa) === true, '已掌握状态保持')
ok(vm.runInContext('quizAutoMasteredKeys.length', ctx) === 1, '只记录 1 次自动掌握（不重复处理）')

// S4: 多教材隔离（延世1 与延世2 的 싸다 互不影响）
sReset()
for (let s4i = 0; s4i < 4; s4i++) sAnswer(true)   // 延世1 싸다 → 已掌握
const y2SsaKey = vm.runInContext("testKeyOf('yonsei2','싸다')", ctx)
ok(!!y2SsaKey && y2SsaKey !== K.ssa, '延世2 也有 싸다（key 不同，天然隔离）')
ok(sGet(y2SsaKey) === null, '延世2 싸다 无任何记录（不受延世1 影响）')
if (y2SsaKey) {
  testBind('yonsei2')
  const s4y2Word = vm.runInContext(`testItemByKey('${y2SsaKey}')`, ctx)
  vm.runInContext(`quizQuestions = [{ word: ${JSON.stringify(s4y2Word)}, targetKey: '${y2SsaKey}', options: ['便宜','买','写','名字'], optionKeys: ['${y2SsaKey}','${K.sa}','${K.sseu}','${K.irum}'], correctIdx: 0, contrastKeys: [] }]; quizIndex = 0; quizAnswered = false; quizAnswers = []; quizErrors = []`, ctx)
  vm.runInContext('quizAnswer(0)', ctx)   // 延世2 싸다 答对 1 次
  const s4y2d = sGet(y2SsaKey)
  ok(s4y2d && s4y2d.quizCorrect === 1 && s4y2d.lv !== 4, '延世2 싸다 答对 1 次 → 1/4，未掌握')
  ok(sGet(K.ssa) && sGet(K.ssa).quizCorrect === 4 && sGet(K.ssa).lv === 4, '延世1 싸다 保持 4 次已掌握（互不串扰）')
  testBind('yonsei1')
}

// S5: 已手动掌握 → 继续答题不冲突、不重复处理
sReset()
vm.runInContext(`srs['${K.ssa}'] = { lv: 4, due: Date.now() + 21 * 86400000, ease: 2.5, n: 1, badCount: 0 }`, ctx)   // 模拟手动标记
sAnswer(true)
let s5d = sGet(K.ssa)
ok(s5d && s5d.lv === 4 && s5d.quizCorrect === 1, '手动掌握后答对 → 状态不破坏，次数从 1 开始累计')
ok(vm.runInContext('quizAutoMasteredKeys.length', ctx) === 0, '已掌握的词不触发"自动掌握"（本来已掌握）')
for (let s5i = 0; s5i < 3; s5i++) sAnswer(true)   // 次数到 4
s5d = sGet(K.ssa)
ok(s5d && s5d.quizCorrect === 4 && s5d.lv === 4, '次数到 4 时已掌握状态保持（不重复标记）')
ok(vm.runInContext('quizAutoMasteredKeys.length', ctx) === 0, '不产生重复的自动掌握记录')

// S6: 方案A —— 被现有规则降级后，再答对自动恢复
sReset()
for (let s6i = 0; s6i < 4; s6i++) sAnswer(true)   // 自动掌握
ok(sMastered(K.ssa) === true, '前置：答对 4 次已掌握')
vm.runInContext(`var d6 = srs['${K.ssa}']; d6.lv = 3`, ctx)   // 模拟测验答错降级（persistQuizRecord 现有行为）
ok(sMastered(K.ssa) === false, '降级后回到未掌握（现有降级行为保留）')
sAnswer(true)   // 再答对 → 方案A 恢复
ok(sGet(K.ssa).lv === 4 && sMastered(K.ssa) === true, '再答对一次 → 自动恢复已掌握（方案A）')
ok(vm.runInContext('quizAutoMasteredKeys.length', ctx) === 1, '恢复计入本局自动掌握记录')

// S7: 听写"很接近"也计入答对
testSetMode('dict')
sReset()
const s7Word = vm.runInContext(`testItemByKey('${K.biss}')`, ctx)
vm.runInContext(`quizQuestions = [{ word: ${JSON.stringify(s7Word)}, targetKey: '${K.biss}', options: [], optionKeys: [], correctIdx: -1 }]; quizIndex = 0; quizAnswered = false; quizAnswers = []; quizErrors = []`, ctx)
ctx.document.getElementById('quiz-dict-field').value = '싸다'   // 비싸다 → 싸다：很接近 → 中性第三态
vm.runInContext('dictSubmit()', ctx)
const s7rec = sGet(K.biss)
ok(s7rec == null || s7rec.quizCorrect === undefined, '听写"很接近"不计入答对次数（中性第三态，不累计掌握）')
ok(s7rec != null && s7rec.closeCount === 1, '听写"很接近"记录接近次数 closeCount=1（只记不显示，不影响掌握判定）')
testSetMode('kr-cn')

// S8: 次数随 srs 一起持久化（saveUserData 写入的数据包含 quizCorrect，刷新/重开不丢）
sReset()
vm.runInContext('saveUserData = function () { __savedSrs = JSON.parse(JSON.stringify(srs)) }', ctx)
for (let s8i = 0; s8i < 3; s8i++) sAnswer(true)
const savedBlob = vm.runInContext('__savedSrs', ctx)
ok(savedBlob && savedBlob[K.ssa] && savedBlob[K.ssa].quizCorrect === 3, '保存的数据包含累计答对次数（3 次答对 → 存储 3/4）')

// S9: 已掌握的词答对 → 不再显示「x/4 · 再答对 N 次自动掌握」进度文案（学习页/刷卡已掌握的词 quizCorrect 为 0，
//     旧行为会显示误导性的「1/4」；修复后已掌握词答对不显示任何进度）
sReset()
vm.runInContext(`srs['${K.ssa}'] = { lv: 4, due: Date.now() + 21 * 86400000, ease: 2.5, n: 1, badCount: 0 }`, ctx)   // 模拟手动标记已掌握
vm.runInContext("document.getElementById('quiz-feedback').innerHTML = ''", ctx)   // 清掉前序测试遗留（模拟浏览器逐题清空反馈区）
sAnswer(true)
let s9fb = vm.runInContext("document.getElementById('quiz-feedback').innerHTML", ctx)
ok(s9fb.indexOf('再答对') === -1 && s9fb.indexOf('1/4') === -1, '已掌握的词答对 → 不显示进度文案（无 1/4）')
ok(vm.runInContext('quizAutoMasteredKeys.length', ctx) === 0, '已掌握的词不触发"自动掌握"（保持掌握）')
// 降级回未掌握后答对 → 恢复显示 x/4 进度（规则自洽）
vm.runInContext(`srs['${K.ssa}'].lv = 3; srs['${K.ssa}'].quizCorrect = 0`, ctx)
vm.runInContext("document.getElementById('quiz-feedback').innerHTML = ''", ctx)
sAnswer(true)
s9fb = vm.runInContext("document.getElementById('quiz-feedback').innerHTML", ctx)
ok(s9fb.indexOf('再答对') !== -1, '降级回未掌握后答对 → 正常显示「再答对 x 次自动掌握」进度')

console.log('── V. 写义模式（✍️ 写义：中文判分 + 批量提交）──')
// V1: cnAnswerMatch 判分纯函数（宽容一档：义项拆分 + 去括号 + 归一化 + L1 包含）
ok(vm.runInContext("cnAnswerMatch('先生','先生/女士')", ctx) === true, '多义项：填「先生」对')
ok(vm.runInContext("cnAnswerMatch('女士','先生/女士')", ctx) === true, '多义项：填「女士」对')
ok(vm.runInContext("cnAnswerMatch('什么','什么（修饰语）')", ctx) === true, '去括号注释：填「什么」对')
ok(vm.runInContext("cnAnswerMatch('什么？','什么（修饰语）')", ctx) === true, '标点归一：填「什么？」对')
ok(vm.runInContext("cnAnswerMatch('购买','买')", ctx) === true, 'L1 包含：答案「买」填「购买」对')
ok(vm.runInContext("cnAnswerMatch('买','购买')", ctx) === false, '反向不做：答案「购买」填「买」错')
ok(vm.runInContext("cnAnswerMatch('','家人')", ctx) === false, '空输入判错')
ok(vm.runInContext("cnAnswerMatch('喝','吃/喝（敬语）')", ctx) === true, '义项拆分+去括号：填「喝」对')

// V2: 写义题目结构（无选项，携带 targetKey）
testSetMode('write')
const v2qs = vm.runInContext('generateQuizQuestions(testPool())', ctx)
ok(v2qs.length === 10, '写义生成 10 题')
ok(v2qs.every(q => q.options.length === 0 && q.correctIdx === -1 && !!q.targetKey), '写义题无选项、携带 targetKey')

// V3: 逐题即判（对 2 错 1，空行算错，答对走自动掌握链路，已判行重复判不生效）
const vQ = [
  { word: { kr: '싸다', cn: '便宜', pos: '形容词', lessonNum: 6 }, targetKey: 'yonsei1|6|싸다', options: [], optionKeys: [], correctIdx: -1, contrastKeys: [] },
  { word: { kr: '가족', cn: '家人', pos: '名词', lessonNum: 2 }, targetKey: 'yonsei1|2|가족', options: [], optionKeys: [], correctIdx: -1, contrastKeys: [] },
  { word: { kr: '학교', cn: '学校', pos: '名词', lessonNum: 3 }, targetKey: 'yonsei1|3|학교', options: [], optionKeys: [], correctIdx: -1, contrastKeys: [] },
]
vm.runInContext("srs = {}; quizMode = 'write'; quizQuestions = " + JSON.stringify(vQ) + "; quizIndex = 0; quizScore = 0; quizErrors = []; quizAnswers = []; quizAutoMasteredKeys = []; quizWriteRevealed = []", ctx)
vm.runInContext("document.getElementById('quiz-write-input-0').value = '便宜'", ctx)
vm.runInContext("document.getElementById('quiz-write-input-1').value = '家人'", ctx)
vm.runInContext('quizWriteJudgeRow(0)', ctx)   // 判对
vm.runInContext('quizWriteJudgeRow(1)', ctx)   // 判对
vm.runInContext('quizWriteJudgeRow(2)', ctx)   // 空 → 判错；全部判完 → 自动出结果
ok(vm.runInContext('quizScore', ctx) === 2, '逐题判分：对 2 错 1')
ok(vm.runInContext('quizErrors.length', ctx) === 1 && vm.runInContext('quizErrors[0] && quizErrors[0].kr', ctx) === '학교', '空行判错进错题（학교）')
ok(vm.runInContext('quizAnswers[0].correct === true && quizAnswers[2].correct === false', ctx) === true, 'quizAnswers 就地反馈标记正确')
ok(vm.runInContext("srs['yonsei1|6|싸다'] && srs['yonsei1|6|싸다'].quizCorrect === 1 && srs['yonsei1|2|가족'] && srs['yonsei1|2|가족'].quizCorrect === 1", ctx) === true, '答对计入自动掌握累计（quizCorrect=1）')
ok(vm.runInContext('quizWriteAllJudged()', ctx) === true, '全部判完（quizWriteAllJudged）')
vm.runInContext('quizWriteJudgeRow(0)', ctx)
ok(vm.runInContext('quizScore', ctx) === 2, '已判行重复判分不生效')

// V4: 想不起来 → 立即记错进错题（即使填了正确字）
vm.runInContext("srs = {}; quizMode = 'write'; quizQuestions = " + JSON.stringify(vQ) + "; quizIndex = 0; quizScore = 0; quizErrors = []; quizAnswers = []; quizAutoMasteredKeys = []; quizWriteRevealed = []", ctx)
vm.runInContext("document.getElementById('quiz-write-input-0').value = '便宜'", ctx)
vm.runInContext("document.getElementById('quiz-write-input-1').value = '家人'", ctx)
vm.runInContext('quizWriteDontKnow(1)', ctx)
ok(vm.runInContext('quizAnswers[1].correct === false', ctx) === true, '想不起来 → 立即记错（即使填了正确字）')
ok(vm.runInContext('quizErrors.length', ctx) === 1, '想不起来 → 立即进错题')
vm.runInContext('quizWriteJudgeRow(0)', ctx)
vm.runInContext('quizWriteJudgeRow(2)', ctx)
ok(vm.runInContext('quizScore', ctx) === 1, '想不起来行不计分')

// V5: 最后一行回车 → 判该行 → 全部判完自动出结果（发音由 onfocus 统一驱动：点击输入框也发音）
vm.runInContext("srs = {}; quizMode = 'write'; quizQuestions = " + JSON.stringify(vQ) + "; quizIndex = 0; quizScore = 0; quizErrors = []; quizAnswers = []; quizAutoMasteredKeys = []; quizWriteRevealed = []", ctx)
vm.runInContext("document.getElementById('quiz-write-input-0').value = '便宜'", ctx)
vm.runInContext("document.getElementById('quiz-write-input-1').value = '家人'", ctx)
vm.runInContext('quizWriteJudgeRow(0)', ctx)   // 前两行先判
vm.runInContext('quizWriteJudgeRow(1)', ctx)
vm.runInContext("quizWriteKey({ key: 'Enter', preventDefault: function(){} }, 2)", ctx)   // 最后一行（index 2）回车 → 判分
ok(vm.runInContext('quizWriteAllJudged()', ctx) === true, '最后一行回车 → 全部判完')
ok(vm.runInContext('quizScore', ctx) === 2, '判分：对 2 错 1（最后一行空）')
testSetMode('kr-cn')

console.log('── T. 词数不足 → 毛玻璃确认弹窗 ──')
// 用 testItemByKey 构造确定词数的池（testPoolOf 会跨课重复收集，词数不确定）
const tW1 = vm.runInContext(`testItemByKey('${K.ssa}')`, ctx)
const tW2 = vm.runInContext(`testItemByKey('${K.sa}')`, ctx)
const tW3 = vm.runInContext(`testItemByKey('${K.sseu}')`, ctx)
const tPool3 = [tW1, tW2, tW3]
// T1: 1~3 词池也能正常出题（干扰项取自全教材，不依赖筛选池）
let tqs = vm.runInContext(`generateQuizQuestions(${JSON.stringify(tPool3)})`, ctx)
ok(tqs.length === 3 && tqs.every(q => q.options.length === 4), '3 词池 → 3 题、每题 4 选项（干扰项取自全教材）')
tqs = vm.runInContext(`generateQuizQuestions(${JSON.stringify([tW1])})`, ctx)
ok(tqs.length === 1 && tqs[0].options.length === 4, '1 词池 → 1 题、4 选项（极限小池也可测）')

// T2: 不足 4 词 → 显示确认弹窗
vm.runInContext(`showQuizLowOverlay(${JSON.stringify(tPool3)})`, ctx)
ok(vm.runInContext("document.getElementById('quiz-low-overlay').style.display", ctx) === 'flex', '不足 4 词 → 显示确认弹窗')
ok(vm.runInContext("document.getElementById('quiz-low-title').textContent", ctx) === '只剩 3 个词', '弹窗标题 = 只剩 3 个词')
ok(vm.runInContext("document.getElementById('quiz-low-start').textContent", ctx) === '开始 3 题', '主按钮 = 开始 3 题')
ok(vm.runInContext("document.getElementById('quiz-low-ghost').style.display", ctx) === '', '1~3 词时显示「先不测」按钮')

// T3: 确认后以小词池开局（题数 = 实际词数）
vm.runInContext('quizLowStart()', ctx)
ok(vm.runInContext("document.getElementById('quiz-play').style.display", ctx) === 'block', '确认后进入答题区')
ok(vm.runInContext('quizQuestions.length', ctx) === 3, '本轮共 3 题')
ok(vm.runInContext("document.getElementById('quiz-low-overlay').style.display", ctx) === 'none', '弹窗已关闭')

// T4: 0 词 → 引导弹窗（不可开始）
vm.runInContext('showQuizNoWordsOverlay()', ctx)
ok(vm.runInContext("document.getElementById('quiz-low-title').textContent", ctx) === '没有可测的词啦', '0 词 → 引导弹窗标题')
ok(vm.runInContext("document.getElementById('quiz-low-ghost').style.display", ctx) === 'none', '0 词时隐藏「先不测」按钮')

console.log('── U. 退出测验确认 → 通用毛玻璃弹窗 ──')
// 桩：捕获 showAppDialog 调用（模拟通用弹窗）
vm.runInContext('__dlg = null', ctx)
vm.runInContext('showAppDialog = function (opts) { __dlg = opts }', ctx)
// 构造进行中的测验（已答 1 题）
vm.runInContext(`quizQuestions = [${JSON.stringify(sQ)}]; quizIndex = 0; quizAnswered = true; quizAnswers = [{ correct: true, selectedIdx: 0 }]; quizScore = 1; quizErrors = []`, ctx)
vm.runInContext('exitQuizWithConfirm()', ctx)
const uDlg = vm.runInContext('__dlg', ctx)
ok(uDlg && uDlg.title === '退出测验？', '退出测验 → 弹确认弹窗')
ok(uDlg && uDlg.confirmText === '退出' && uDlg.cancelText === '继续答题', '弹窗按钮文案 = 退出 / 继续答题')
ok(uDlg && uDlg.desc.indexOf('1 题会计入测验记录') >= 0, '提示已答 1 题会计入记录')
// 点确认 → 保存记录并回到设置页
vm.runInContext('__dlg.onConfirm()', ctx)
ok(vm.runInContext("document.getElementById('quiz-setup').style.display", ctx) === 'block', '确认退出后回到设置页')
ok(vm.runInContext("document.getElementById('quiz-play').style.display", ctx) === 'none', '答题区已隐藏')
ok(vm.runInContext('quizQuestions.length', ctx) === 0, '测验会话已重置')
// 未答任何题时退出 → 同样弹确认（文案不含"计入记录"），确认后直接重置
vm.runInContext(`quizQuestions = [${JSON.stringify(sQ)}]; quizIndex = 0; quizAnswered = false; quizAnswers = []; quizScore = 0; quizErrors = []`, ctx)
vm.runInContext('__dlg = null', ctx)
vm.runInContext('exitQuizWithConfirm()', ctx)
const uDlg2 = vm.runInContext('__dlg', ctx)
ok(uDlg2 && uDlg2.title === '退出测验？', '未答题时退出也弹确认弹窗')
ok(uDlg2 && uDlg2.desc.indexOf('会计入测验记录') === -1, '未答题时文案不含"计入测验记录"')
vm.runInContext('__dlg.onConfirm()', ctx)
ok(vm.runInContext('quizQuestions.length', ctx) === 0, '确认后直接重置（无记录保存）')

console.log('')
console.log('═══ 结果：' + passed + ' 通过 / ' + failed + ' 失败 ═══')
process.exit(failed > 0 ? 1 : 0)
