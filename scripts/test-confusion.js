/* ════════════════════════════════════════════════════════════════
   test-confusion.js — 易混词/混淆关系层（confusion.js）阶段1 验证脚本
   用法：node scripts/test-confusion.js
   通过 = 打印 PASS 摘要并退出码 0；失败 = 打印 FAIL 详情并退出码 1
   ════════════════════════════════════════════════════════════════ */
'use strict'
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const ROOT = path.resolve(__dirname, '..')

// 简易 localStorage（模拟浏览器持久化，供 confusion.js 读写 ys-confusions）
function makeFakeStorage() {
  const m = {}
  return {
    getItem: k => (Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v) },
    removeItem: k => { delete m[k] },
    dump: () => JSON.parse(JSON.stringify(m)),
  }
}

let passed = 0, failed = 0
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg) }
  else { failed++; console.log('  ✗ FAIL: ' + msg) }
}

const DATA_FILES = ['data-books.js', 'data-yonsei1.js', 'data-yonsei2.js', 'utils.js', 'confusion.js']
function loadInto(ctx) {
  for (const f of DATA_FILES) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx)
}

// ═══ 上下文 1：带 localStorage（模拟浏览器）═══
const ctx1 = { localStorage: makeFakeStorage(), console, Date, Math, JSON }
vm.createContext(ctx1)
loadInto(ctx1)

const T = vm.runInContext(`(function () {
  function keyOf(bookId, kr) {
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
  function hasPair(arr, a, b) {
    return arr.some(function (p) { return (p.a === a && p.b === b) || (p.a === b && p.b === a) })
  }
  return { keyOf: keyOf, hasPair: hasPair }
})()`, ctx1)

console.log('── 0. 数据前提 ──')
const K = {
  y1ssa: T.keyOf('yonsei1', '싸다'),
  y1sa:  T.keyOf('yonsei1', '사다'),
  y1sseu:T.keyOf('yonsei1', '쓰다'),
  y1biss:T.keyOf('yonsei1', '비싸다'),
  y1irum:T.keyOf('yonsei1', '이름'),
  y2ssa: T.keyOf('yonsei2', '싸다'),
  y2sa:  T.keyOf('yonsei2', '사다'),
}
ok(K.y1ssa && K.y1sa && K.y1sseu && K.y1biss && K.y1irum, '延世1 存在 싸다/사다/쓰다/비싸다/이름')
ok(K.y2ssa && K.y2sa, '延世2 存在 싸다/사다（跨书同名隔离测试素材）')

console.log('── ① 预设易混词（自动发现，词形相似）──')
vm.runInContext('clearConfusions()', ctx1)

let presetY1 = vm.runInContext('getPresetPairs("yonsei1")', ctx1)
ok(presetY1.length > 0, '延世1 自动发现候选组数量 > 0（实际 ' + presetY1.length + ' 对）')
ok(T.hasPair(presetY1, K.y1ssa, K.y1sa), '候选组包含核心配对 싸다↔사다')
ok(T.hasPair(presetY1, K.y1ssa, K.y1sseu), '候选组包含 싸다↔쓰다')
ok(T.hasPair(presetY1, K.y1ssa, K.y1biss), '候选组包含 싸다↔비싸다（长度差1 的近形词）')
ok(T.hasPair(presetY1, K.y1ssa, K.y1irum) === false, '이름 与 싸다 不相似（两字词距离=2 被保守规则排除）')

// 候选自洽性：每组都通过 isSimilarPair，且距离 ≤2
const selfCheck = vm.runInContext(`(function () {
  var pairs = getPresetPairs('yonsei1')
  var bad = pairs.filter(function (p) { return !isSimilarPair(p.a, p.b) || p.dist > 2 })
  var maxDist = pairs.reduce(function (m, p) { return Math.max(m, p.dist) }, 0)
  return { badCount: bad.length, maxDist: maxDist }
})()`, ctx1)
ok(selfCheck.badCount === 0 && selfCheck.maxDist <= 2, '候选组全部符合相似规则且距离 ≤2（最大 ' + selfCheck.maxDist + '）')

console.log('── ② 多教材隔离 ──')
const y1KeysOk = presetY1.every(p => String(p.a).indexOf('yonsei1|') === 0 && String(p.b).indexOf('yonsei1|') === 0)
ok(y1KeysOk, '延世1 候选组全部 key 属于 yonsei1，无跨书混合')
const presetY2 = vm.runInContext('getPresetPairs("yonsei2")', ctx1)
const y2KeysOk = presetY2.every(p => String(p.a).indexOf('yonsei2|') === 0 && String(p.b).indexOf('yonsei2|') === 0)
ok(y2KeysOk, '延世2 候选组全部 key 属于 yonsei2，无跨书混合')
ok(T.hasPair(presetY1, K.y1ssa, K.y2ssa) === false, '跨书同名（延世1 싸다 ↔ 延世2 싸다）不会产生候选')
ok(T.hasPair(presetY2, K.y2ssa, K.y2sa), '延世2 候选组包含自己的 싸다↔사다（各书独立发现）')

console.log('── ③ A→B 定向混淆记录 ──')
vm.runInContext('clearConfusions()', ctx1)

let r1 = vm.runInContext(`recordConfusion('${K.y1ssa}', '${K.y1sa}')`, ctx1)
ok(r1 === true, '记录 싸다→사다 返回 true')
let r2 = vm.runInContext(`recordConfusion('${K.y1ssa}', '${K.y1sa}')`, ctx1)
ok(r2 === true, '再次记录 싸다→사다 返回 true')
let r3 = vm.runInContext(`recordConfusion('${K.y1sa}', '${K.y1ssa}')`, ctx1)
ok(r3 === true, '反向记录 사다→싸다 返回 true')

let pers = vm.runInContext('getPersonalPairs("yonsei1")', ctx1)
ok(pers.length === 1, '个人混淆关系只有 1 组（方向合并到同一组）')
// a/b 按 key 字典序排序：사다(L3) 的 key 小于 싸다(L6)，故 a=사다、b=싸다
// r1/r2 = 考 싸다 答成 사다（target=b）→ ba 各 +1 → ba=2
// r3   = 考 사다 答成 싸다（target=a）→ ab +1 → ab=1
ok(pers[0].ab === 1 && pers[0].ba === 2, '方向计数正确（该答 a=사다 答成 b=싸다 1 次 ab=1；该答 b=싸다 答成 a=사다 2 次 ba=2）')
ok(vm.runInContext('isActivePersonalPair(getPersonalPairs("yonsei1")[0])', ctx1) === true, 'ab+ba=3 ≥ 2 → 活跃个人混淆')

let persY2 = vm.runInContext('getPersonalPairs("yonsei2")', ctx1)
ok(persY2.length === 0, '延世1 的记录不会出现在延世2')

console.log('── ④ 无关选择不产生混淆 ──')
let r4 = vm.runInContext(`recordConfusion('${K.y1ssa}', '${K.y1irum}')`, ctx1)
ok(r4 === false, '考 싸다 选 이름（无关词）→ 不记录混淆，返回 false')
let persAfter = vm.runInContext('getPersonalPairs("yonsei1")', ctx1)
ok(persAfter.length === 1, '无关选择后个人混淆仍只有 1 组（未新增）')
ok(vm.runInContext(`recordConfusion('${K.y1ssa}', '${K.y1ssa}')`, ctx1) === false, '相同词不记录')

console.log('── ⑤ 单次失误不活跃、两次才活跃 ──')
vm.runInContext('clearConfusions()', ctx1)
vm.runInContext(`recordConfusion('${K.y1ssa}', '${K.y1sa}')`, ctx1)
let once = vm.runInContext('getPersonalPairs("yonsei1")[0]', ctx1)
ok(vm.runInContext('isActivePersonalPair(getPersonalPairs("yonsei1")[0])', ctx1) === false, '单次 A→B 不活跃（等待反复出现）')
vm.runInContext(`recordConfusion('${K.y1ssa}', '${K.y1sa}')`, ctx1)
ok(vm.runInContext('isActivePersonalPair(getPersonalPairs("yonsei1")[0])', ctx1) === true, '两次 A→B 达到活跃阈值')

console.log('── ⑥ 权重：次数 × 衰减 × 连续答对折扣 ──')
const w = vm.runInContext(`(function () {
  var now = Date.now()
  return {
    fresh: pairWeight({ ab: 2, ba: 1, last: now, resolvedStreak: 0 }),
    decayed30d: pairWeight({ ab: 2, ba: 1, last: now - 30 * 86400000, resolvedStreak: 0 }),
    resolved: pairWeight({ ab: 2, ba: 1, last: now, resolvedStreak: 1 }),
    zero: pairWeight({ ab: 0, ba: 0, last: now, resolvedStreak: 0 }),
    neg: pairWeight({ ab: 2, ba: 1, last: now + 999999, resolvedStreak: 0 })
  }
})()`, ctx1)
ok(w.fresh === 3, '无衰减权重 = 次数 3（实际 ' + w.fresh + '）')
ok(w.decayed30d === 1.5, '30 天后权重减半 = 1.5（实际 ' + w.decayed30d + '）')
ok(w.resolved === 2.4, '连续答对 1 次折扣 0.8 → 2.4（实际 ' + w.resolved + '）')
ok(w.zero === 0, '零次数权重 = 0')
ok(w.neg === 3, '未来时间戳不产生负权重（按 0 天算）')

console.log('── ⑦ 听写最近词匹配（距离 ≤1 才算疑似混淆）──')
const items = vm.runInContext(`(function () {
  var out = []
  Object.keys(VOCAB).forEach(function (num) {
    (VOCAB[num] || []).forEach(function (w) { out.push({ key: 'yonsei1|' + num + '|' + w.kr, kr: w.kr }) })
  })
  return out
})()`, ctx1)
const m1 = vm.runInContext(`findNearestWordKey('사다', ${JSON.stringify(items)})`, ctx1)
ok(m1 && m1.key === K.y1sa && m1.dist === 0, '输入 사다 → 最近词 = 延世1 사다（dist 0）')
ok(vm.runInContext(`isLikelyConfusionDist(${m1.dist})`, ctx1) === true, 'dist 0 ≤ 1 → 疑似混淆（输入了另一个真实词）')
const m2 = vm.runInContext(`findNearestWordKey('ㅁㄴㅇㄹ', ${JSON.stringify(items)})`, ctx1)
ok(m2 && m2.dist > 1, '输入乱码 → 最近词距离 > 1（实际 ' + (m2 ? m2.dist : 'null') + '）')
ok(vm.runInContext(`isLikelyConfusionDist(${m2.dist})`, ctx1) === false, '乱码不构成疑似混淆（判为纯拼写错误）')
const m3 = vm.runInContext(`findNearestWordKey('${K.y1ssa.split('|')[2]}', ${JSON.stringify(items)})`, ctx1)
ok(m3 && m3.key === K.y1ssa, '输入正确词 → 最近词就是它自己（不会误判）')

console.log('── ⑧ 持久化（独立 key ys-confusions）──')
const stored = ctx1.localStorage.dump()['ys-confusions']
ok(!!stored, 'ys-confusions 已写入 localStorage')
let parsed = null
try { parsed = JSON.parse(stored) } catch (e) {}
ok(!!parsed && Object.keys(parsed).length === 1, '存储内容可解析且只有 1 组')
// 测试⑤共记录 2 次 考 싸다 答成 사다（target=b=싸다）→ ba=2, ab=0
ok(parsed && parsed[Object.keys(parsed)[0]].ab === 0 && parsed[Object.keys(parsed)[0]].ba === 2, '存储方向计数与记录一致（ba=2）')
const otherKeys = Object.keys(ctx1.localStorage.dump()).filter(k => k !== 'ys-confusions')
ok(otherKeys.length === 0, '未触碰其它 localStorage key（与现有数据完全隔离）')

console.log('── ⑨ 统一出口 getConfusionPairsForBook ──')
const layer = vm.runInContext('getConfusionPairsForBook("yonsei1")', ctx1)
ok(Array.isArray(layer.preset) && Array.isArray(layer.personal), '统一出口返回 { preset, personal }')
ok(layer.preset.length > 0 && layer.personal.length === 1, 'preset=候选组, personal=个人混淆（各 1+）')

console.log('── ⑩ 无 localStorage 环境（Node/异常环境兜底）──')
const ctx2 = { console, Date, Math, JSON }   // 无 localStorage
vm.createContext(ctx2)
let bootOk = true
try { loadInto(ctx2) } catch (e) { bootOk = false; console.log('   加载异常: ' + e.message) }
ok(bootOk, '无 localStorage 时模块可正常加载（不抛错）')
ok(vm.runInContext('loadConfusions() && true', ctx2) === true, 'loadConfusions 返回空对象不抛错')
ok(vm.runInContext(`recordConfusion('${K.y1ssa}', '${K.y1sa}')`, ctx2) === true, '内存兜底模式下仍可记录混淆')
ok(vm.runInContext('getPersonalPairs("yonsei1").length === 1', ctx2) === true, '内存兜底记录可读回')

console.log('')
console.log('═══ 结果：' + passed + ' 通过 / ' + failed + ' 失败 ═══')
process.exit(failed > 0 ? 1 : 0)
