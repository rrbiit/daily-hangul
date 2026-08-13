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
    appendChild() {}, querySelectorAll() { return [] }, focus() {}
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
    }
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

// G2："很接近"（비싸다 → 输入 싸다）→ 判对（原判分不变）+ 同时记录混淆
vm.runInContext('clearConfusions()', ctx)
const g2Word = vm.runInContext(`testItemByKey('${K.biss}')`, ctx)
vm.runInContext(`quizQuestions = [{ word: ${JSON.stringify(g2Word)}, targetKey: '${K.biss}', options: [], optionKeys: [], correctIdx: -1 }]; quizIndex = 0; quizAnswered = false; quizAnswers = []; quizErrors = []`, ctx)
ctx.document.getElementById('quiz-dict-field').value = '싸다'
vm.runInContext('dictSubmit()', ctx)
gRec = vm.runInContext('quizAnswers[0]', ctx)
ok(gRec && gRec.correct === true && gRec.close === true, '비싸다 输入 싸다 → 仍判"很接近=正确"（原判分逻辑不变）')
ok(gRec && gRec.matchedKey === K.ssa, '同时记录 matchedKey=싸다（潜在混淆信号）')
const g2Pers = vm.runInContext('getPersonalPairs("yonsei1")', ctx)
ok(g2Pers.length === 1 && g2Pers[0].ab === 1, '已记录 비싸다→싸다 混淆（ab=1），且未改变判分')

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

console.log('')
console.log('═══ 结果：' + passed + ' 通过 / ' + failed + ' 失败 ═══')
process.exit(failed > 0 ? 1 : 0)
