/* ═══════════════════════════════════════════
   confusion.js · 易混词 / 混淆关系层（测验系统底层能力）
   职责：
   - 系统预设易混词（候选）：按"词形相似"规则从教材数据自动发现，
     仅作候选，不直接参与动态加权（"系统觉得像"≠"用户真的混"）
   - 用户个人混淆关系：根据实际答题 A→B 记录动态发现（独立存储 ys-confusions），
     达到活跃阈值后才作为个人易混关系用于动态出题
   - 严格区分"答错"与"把 A 答成 B"：只有用户实际选择/输入了另一个词，
     且该词与目标词"词形相似"（同一套判定规则）时才记录 A→B；
     完全无关的选项/输入只走现有错题逻辑，不产生混淆关系
   - 权重：定向次数 × 时间衰减（30 天半衰期）× 连续答对折扣
   - 多教材隔离：所有 key 均为 wk()（书ID|课号|韩语），按书遍历、跨书不关联
   依赖：data-books.js（getBook）/ utils.js（wk / levenshtein / normalizeForCompare）
   加载：在 quiz.js 之前（测验层底层能力）；纯逻辑无 DOM，可在 Node 中加载（供测试脚本）
   ═══════════════════════════════════════════ */

    // ─── 常量 ───
    var CONFUSION_ACTIVE_MIN_COUNT = 2    // 个人混淆"活跃"阈值：定向混淆次数 ≥2 才生效
    var CONFUSION_MATCH_MAX_DIST = 1      // 听写"疑似混淆"最大编辑距离（>1 视为纯拼写错误）
    var CONFUSION_STORE_CAP = 300         // 个人混淆关系存储上限（超出按最近活跃时间淘汰）
    var CONFUSION_HALF_LIFE_MS = 30 * 86400000   // 权重时间衰减半衰期：30 天
    var CONFUSION_RESOLVE_DISCOUNT = 0.8  // 连续答对一次的权重折扣

    // ─── 内部状态 ───
    var _confusions = null                // 个人混淆关系 { compositeKey: {a,b,ab,ba,last,resolvedStreak} }
    var _presetCache = {}                 // 预设易混词缓存 { bookId: [{a,b,dist}] }

    // 词 key（书ID|课号|韩语）→ 书ID
    function _keyBookId(key) { return String(key).split('|')[0] }
    // 词 key → 韩语
    function _keyKr(key) { return String(key).split('|').slice(2).join('|') }
    // 排序后的组合 key（a < b，避免同组两个方向重复存储）
    function _pairComposite(a, b) { return a < b ? a + '\u0001' + b : b + '\u0001' + a }

    // localStorage 安全访问（Node 测试环境无 localStorage → 内存兜底）
    function _confusionStorage() {
      try { return (typeof localStorage !== 'undefined' && localStorage) ? localStorage : null } catch (e) { return null }
    }

    /* ═══════════ ① 系统预设易混词（候选，自动发现）═══════════ */

    // 词形相似判定（预设发现 & 混淆记录共用的同一套规则）：
    // - 距离 ≤1 且等长（如 싸다/사다、살다/쓰다）
    // - 或 距离 ≤2 且长度差 ≤1 且距离 < 较长词长度
    //   （≥3 字词允许 2 处差异；2 字词要求距离 <2，即至少 1 个字符相同——
    //     否则任意两个两字词距离都 ≤2，会产生大量无意义候选，违背"宁可保守"）
    function isSimilarPair(keyA, keyB) {
      if (!keyA || !keyB || keyA === keyB) return false
      if (_keyBookId(keyA) !== _keyBookId(keyB)) return false
      var krA = _keyKr(keyA), krB = _keyKr(keyB)
      if (!krA || !krB || krA === krB) return false
      var d = levenshtein(krA, krB)
      var lenDiff = Math.abs(krA.length - krB.length)
      var maxLen = Math.max(krA.length, krB.length)
      return (d <= 1 && lenDiff === 0) || (d <= 2 && lenDiff <= 1 && d < maxLen)
    }

    // 按书自动发现候选易混词（命中相似规则的组合全部保留为候选；
    // 不设每词伙伴上限——上限会让 사다 的伙伴被 사전/크다 等先占满，
    // 把 싸다↔사다 这类核心配对挤掉。词伙选择由消费端（阶段2/3）按
    // "个人混淆优先 → 距离近优先"挑选，候选本身不参与任何行为）
    function buildPresetPairs(bookId) {
      var book = getBook(bookId)
      if (!book) return []
      var items = []   // { key, kr }
      Object.keys(book.vocab || {}).forEach(function(num) {
        (book.vocab[num] || []).forEach(function(w) {
          items.push({ key: bookId + '|' + num + '|' + w.kr, kr: w.kr })
        })
      })
      var pairs = []
      for (var i = 0; i < items.length; i++) {
        for (var j = i + 1; j < items.length; j++) {
          if (isSimilarPair(items[i].key, items[j].key)) {
            pairs.push({ a: items[i].key, b: items[j].key, dist: levenshtein(items[i].kr, items[j].kr) })
          }
        }
      }
      return pairs
    }

    function getPresetPairs(bookId) {
      if (!_presetCache[bookId]) _presetCache[bookId] = buildPresetPairs(bookId)
      return _presetCache[bookId]
    }

    /* ═══════════ ② 用户个人混淆关系（独立存储 ys-confusions）═══════════ */

    function loadConfusions() {
      var store = _confusionStorage()
      if (store) {
        try { var raw = store.getItem('ys-confusions'); _confusions = raw ? JSON.parse(raw) : {} } catch (e) { _confusions = {} }
      } else if (!_confusions) {
        _confusions = {}
      }
      return _confusions
    }

    function saveConfusions() {
      var store = _confusionStorage()
      if (store) { try { store.setItem('ys-confusions', JSON.stringify(_confusions || {})) } catch (e) {} }
    }

    function clearConfusions() {
      _confusions = {}
      saveConfusions()
    }

    // 记录"该答 targetKey、实际选择/输入了 selectedKey"的定向混淆
    // 仅当：两个 key 有效、同一本书、不同词，且两词"词形相似"（同一套判定规则）
    // 完全无关的选项/输入不会产生混淆关系（只由现有错题逻辑记录"答错"）
    // 返回 true = 已记录定向混淆；false = 未记录（视为普通答错）
    function recordConfusion(targetKey, selectedKey) {
      if (!targetKey || !selectedKey || targetKey === selectedKey) return false
      if (_keyBookId(targetKey) !== _keyBookId(selectedKey)) return false
      if (!isSimilarPair(targetKey, selectedKey)) return false   // 保守：只记录词形相似的定向混淆
      loadConfusions()
      var composite = _pairComposite(targetKey, selectedKey)
      var rec = _confusions[composite]
      if (!rec) {
        rec = { a: targetKey, b: selectedKey, ab: 0, ba: 0, last: 0, resolvedStreak: 0 }
        if (rec.a > rec.b) { var t = rec.a; rec.a = rec.b; rec.b = t }
        _confusions[composite] = rec
      }
      if (rec.a === targetKey && rec.b === selectedKey) rec.ab = (rec.ab || 0) + 1
      else if (rec.b === targetKey && rec.a === selectedKey) rec.ba = (rec.ba || 0) + 1
      rec.last = Date.now()
      rec.resolvedStreak = 0   // 新的混淆重置连续答对
      // 容量控制：超出上限淘汰最近未活跃的
      var keys = Object.keys(_confusions)
      if (keys.length > CONFUSION_STORE_CAP) {
        keys.sort(function(x, y) { return (_confusions[x].last || 0) - (_confusions[y].last || 0) })
        for (var i = 0; i < keys.length - CONFUSION_STORE_CAP; i++) delete _confusions[keys[i]]
      }
      saveConfusions()
      return true
    }

    // 记录"该混淆对最近一次辨析答对"（连续答对 → 权重折扣；由动态出题阶段调用）
    function recordConfusionResolved(targetKey, selectedKey) {
      if (!targetKey || !selectedKey) return
      loadConfusions()
      var composite = _pairComposite(targetKey, selectedKey)
      var rec = _confusions[composite]
      if (rec) {
        rec.resolvedStreak = (rec.resolvedStreak || 0) + 1
        rec.last = Date.now()
        saveConfusions()
      }
    }

    // 个人混淆权重：定向次数 × 时间衰减（30 天半衰期）× 连续答对折扣
    function pairWeight(pair) {
      if (!pair) return 0
      var count = (pair.ab || 0) + (pair.ba || 0)
      if (count <= 0) return 0
      var days = (Date.now() - (pair.last || Date.now())) / 86400000
      var decay = Math.pow(0.5, Math.max(0, days) / 30)
      var resolve = Math.pow(CONFUSION_RESOLVE_DISCOUNT, pair.resolvedStreak || 0)
      return Math.round(count * decay * resolve * 1000) / 1000
    }

    // 是否"活跃"个人混淆（定向次数达到阈值才用于动态出题）
    function isActivePersonalPair(pair) {
      return !!(pair && ((pair.ab || 0) + (pair.ba || 0)) >= CONFUSION_ACTIVE_MIN_COUNT)
    }

    // 某本书的全部个人混淆关系（带权重）
    function getPersonalPairs(bookId) {
      loadConfusions()
      var out = []
      for (var k in _confusions) {
        var rec = _confusions[k]
        if (!rec || !rec.a || _keyBookId(rec.a) !== bookId) continue
        out.push({
          a: rec.a, b: rec.b,
          ab: rec.ab || 0, ba: rec.ba || 0,
          last: rec.last || 0, resolvedStreak: rec.resolvedStreak || 0,
          weight: pairWeight(rec)
        })
      }
      return out
    }

    /* ═══════════ ③ 听写最近词匹配（供听写判分后判定"是否疑似混淆"）═══════════ */

    // 在给定词条中找与输入最接近的词
    // items: [{ key, kr }]；返回 { key, kr, dist }；无匹配返回 null
    function findNearestWordKey(input, items) {
      var norm = normalizeForCompare(input)
      if (!norm || !items || items.length === 0) return null
      var best = null
      for (var i = 0; i < items.length; i++) {
        var d = levenshtein(norm, normalizeForCompare(items[i].kr))
        if (!best || d < best.dist) best = { key: items[i].key, kr: items[i].kr, dist: d }
      }
      return best
    }

    // 听写"疑似混淆"判定：输入与最近词距离 ≤ 阈值（≤1）
    // 注：距离 0 = 用户输入了另一个真实存在的词（如该写 싸다 却打出 사다），同样算疑似混淆
    function isLikelyConfusionDist(dist) {
      return typeof dist === 'number' && dist <= CONFUSION_MATCH_MAX_DIST
    }

    /* ═══════════ ④ 统一出口（后续阶段只调此函数）═══════════ */

    // 某本书的完整易混关系：{ preset: [...候选], personal: [...个人混淆] }
    function getConfusionPairsForBook(bookId) {
      return {
        preset: getPresetPairs(bookId).map(function(p) {
          return { a: p.a, b: p.b, dist: p.dist, kind: 'preset' }
        }),
        personal: getPersonalPairs(bookId).map(function(p) {
          return { a: p.a, b: p.b, ab: p.ab, ba: p.ba, weight: p.weight, kind: 'personal' }
        })
      }
    }

    // 浏览器就绪：启动即载入个人混淆关系（Node 环境无 localStorage 则内存兜底）
    loadConfusions()
