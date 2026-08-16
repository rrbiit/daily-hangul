/* ═══════════════════════════════════════════
   quiz.js · 测验模块
   从 index.html 拆出（v1.10.5 试拆第一步）
   依赖：data-books.js / data-yonsei1.js / utils.js / index.html 全局函数与状态
   加载：须在 index.html 主脚本之后（内部覆盖 showPage，需先有原函数）
   ═══════════════════════════════════════════ */
    /* ═══════════════════════════════════════════
       测验模式
       ═══════════════════════════════════════════ */

    var quizMode = 'kr-cn'
    var quizScope = 'all'
    var quizCount = 10
    var quizSelectedLessons = new Set()
    var quizQuestions = []
    var quizIndex = 0
    var quizScore = 0
    var quizErrors = []
    var quizHistory = []
    var quizAnswered = false
    var quizAnswers = []  // 每道题的作答记录：{ correct, selectedIdx } / { correct, submitted }，未答为 undefined
    // 写义模式（✍️ 写义：整页批量 · 逐题即判）专属状态
    var quizWriteRevealed = []       // 各行是否点了「想不起来」（true 的行判错）
    var quizWriteLastActive = -1     // 最近一次聚焦的输入框行号（用于"点下一个框 → 自动判上一行"）

    /* ═══════════ 测验答对累计 → 自动已掌握 ═══════════ */
    // 累计答对阈值：达到 4 次自动标记为「已掌握」（封顶 4，不重复累计、不出现 5/4）
    var QUIZ_MASTER_THRESHOLD = 4
    // 本局新晋「已掌握」的单词 key（结果页 ✨ 提示用）
    var quizAutoMasteredKeys = []

    // 记录一次答对：累计 +1（封顶 4）；达到阈值且当前未掌握 → 自动标记已掌握。
    // 次数按「书|课|韩语」key 隔离（wk 生成），不同教材的同形词互不影响；
    // 答错不加减、不清零（错题处理在 persistQuizRecord，与本计数无关）。
    // 已掌握的词继续答对 → 只累计不标记（alreadyMastered 供 UI 决定是否显示进度文案）；
    // 若被现有规则（测验降级/SRS重学）移出已掌握，次数仍保留，下次答对按同一规则自动恢复。
    // 返回 { count, newlyMastered, alreadyMastered } 供 UI 展示。
    function recordQuizCorrect(q) {
      if (!q || !q.targetKey) return { count: 0, newlyMastered: false, alreadyMastered: false }
      var key = q.targetKey
      var d = srs[key]
      if (!d) { d = { lv: 0, due: 0, ease: 2.5, n: 0 }; srs[key] = d }
      var alreadyMastered = d.lv >= 4
      var count = (d.quizCorrect || 0)
      var newlyMastered = false
      if (count < QUIZ_MASTER_THRESHOLD) {
        count += 1
        d.quizCorrect = count
      }
      // 达到阈值且当前未掌握 → 走现有「已掌握」通道（与手动标记同一入口，所有页面立即生效）
      if (count >= QUIZ_MASTER_THRESHOLD && d.lv < 4) {
        masterViaQuiz(key, d)
        newlyMastered = true
      }
      saveUserData()
      return { count: Math.min(count, QUIZ_MASTER_THRESHOLD), newlyMastered: newlyMastered, alreadyMastered: alreadyMastered }
    }

    // 听写"很接近"计数：记录"接近但拼错"的次数（不改变判分、不计分、不累计掌握）
    // ——为将来"总差一点的词优先复习"预留数据；老记录无 closeCount 字段按 0 算，无需迁移
    function recordQuizClose(q) {
      if (!q || !q.targetKey) return
      var d = srs[q.targetKey]
      if (!d) { d = { lv: 0, due: 0, ease: 2.5, n: 0 }; srs[q.targetKey] = d }
      d.closeCount = (d.closeCount || 0) + 1
      saveUserData()
    }

    // 升为已掌握：lv=4 + 21 天复习间隔（与手动标记写法一致）+ 记录掌握日期/今日成果
    function masterViaQuiz(key, d) {
      var now = Date.now()
      d.lv = 4
      d.due = now + 21 * 86400000
      d.ease = 2.5
      d.n = (d.n || 0) + 1
      d.badCount = 0
      d.quizCorrect = 4
      markMastered(key)
      if (quizAutoMasteredKeys.indexOf(key) === -1) quizAutoMasteredKeys.push(key)
    }

    // 在答对反馈下方追加一行进度小字（沿用现有 feedback 元素，不新增卡片）
    // 已掌握的词答对 → 不显示任何进度（避免「已掌握却显示 1/4 · 再答对3次自动掌握」的误导）；
    // 只有未掌握的词在向 4 次目标累计时才显示 x/4。
    function appendQuizMasteryNote(fb, m) {
      if (!fb || !m) return
      if (m.newlyMastered) {
        fb.innerHTML = (fb.innerHTML || fb.textContent) +
          '<br><span style="font-size:12px;color:var(--accent-green);">🎉 已掌握！累计答对 ' + QUIZ_MASTER_THRESHOLD + ' 次</span>'
      } else if (!m.alreadyMastered && m.count >= 1 && m.count < QUIZ_MASTER_THRESHOLD) {
        fb.innerHTML = (fb.innerHTML || fb.textContent) +
          '<br><span style="font-size:12px;color:var(--text-subtle);">该词已答对 ' + m.count + '/' + QUIZ_MASTER_THRESHOLD + ' · 再答对 ' + (QUIZ_MASTER_THRESHOLD - m.count) + ' 次自动掌握</span>'
      }
    }

    function loadQuizHistory() {
      try { var v = lsGet('quiz-history', ''); quizHistory = v ? JSON.parse(v) : [] } catch(e) { quizHistory = [] }
    }

    // 当前教材的测验记录；多教材前的老记录没有 bookId，视为当前教材（启动迁移已把它们归入默认书）
    function quizHistoryForBook() {
      var bookId = getCurrentBook().bookId
      return quizHistory.filter(function(h) { return !h.bookId || h.bookId === bookId })
    }

    function saveQuizHistory() {
      if (quizHistory.length > 300) quizHistory = quizHistory.slice(-300)
      lsSet('quiz-history', JSON.stringify(quizHistory))
      renderQuizHistory()
    }

    function renderTodayAnalysis(containerId) {
      var el = document.getElementById(containerId || 'quiz-today-analysis')
      if (!el) return

      var today = getStudyDay()
      var todayRecords = quizHistoryForBook().filter(function(h) {
        return getStudyDay(new Date(h.date)) === today
      })

      if (todayRecords.length === 0) {
        el.innerHTML = ''
        return
      }

      // 聚合
      var totalScore = 0, totalQ = 0
      var morningScore = 0, morningTotal = 0   // 4:00-11:59
      var afternoonScore = 0, afternoonTotal = 0 // 12:00-17:59
      var eveningScore = 0, eveningTotal = 0     // 18:00-3:59
      var unitErrors = {}  // { lessonNum: count }

      todayRecords.forEach(function(h) {
        totalScore += h.score
        totalQ += h.total
        var d = new Date(h.date)
        var hr = d.getHours()
        if (hr >= 4 && hr < 12) { morningScore += h.score; morningTotal += h.total }
        else if (hr >= 12 && hr < 18) { afternoonScore += h.score; afternoonTotal += h.total }
        else { eveningScore += h.score; eveningTotal += h.total }

        if (h.errors) {
          h.errors.forEach(function(e) {
            var n = e.lessonNum || 0
            unitErrors[n] = (unitErrors[n] || 0) + 1
          })
        }
      })

      var overallPct = totalQ > 0 ? Math.round(totalScore / totalQ * 100) : 0
      var html = '<div class="quiz-analysis-card" style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:14px;">'
      html += '<div style="font-family:var(--font-display);font-size:14px;font-weight:500;margin-bottom:8px;">📊 今日分析</div>'

      // 总体
      html += '<div style="font-size:13px;color:var(--text-dim);margin-bottom:6px;">'
      html += '共 <strong>' + todayRecords.length + '</strong> 轮 · 答对 <strong>' + totalScore + '/' + totalQ + '</strong> · 正确率 <strong style="color:' + (overallPct >= 80 ? 'var(--accent-green)' : overallPct >= 50 ? 'var(--star)' : 'var(--accent-pink)') + ';">' + overallPct + '%</strong>'
      html += '</div>'

      // 按时段
      var periodParts = []
      if (morningTotal > 0) periodParts.push('🌅 上午答对 ' + morningScore + '/' + morningTotal + ' · ' + Math.round(morningScore/morningTotal*100) + '%')
      if (afternoonTotal > 0) periodParts.push('☀️ 下午答对 ' + afternoonScore + '/' + afternoonTotal + ' · ' + Math.round(afternoonScore/afternoonTotal*100) + '%')
      if (eveningTotal > 0) periodParts.push('🌙 晚上答对 ' + eveningScore + '/' + eveningTotal + ' · ' + Math.round(eveningScore/eveningTotal*100) + '%')
      if (periodParts.length > 0) {
        html += '<div style="font-size:12px;color:var(--text-dim);line-height:1.7;">' + periodParts.join(' · ') + '</div>'
      }

      // 按单元错题分布
      var unitKeys = Object.keys(unitErrors).sort(function(a, b) { return unitErrors[b] - unitErrors[a] })
      if (unitKeys.length > 0) {
        html += '<div style="margin-top:8px;font-size:12px;color:var(--text-dim);">'
        html += '<span style="color:var(--text-subtle);">错题分布：</span>'
        var unitParts = []
        for (var i = 0; i < Math.min(unitKeys.length, 5); i++) {
          var un = parseInt(unitKeys[i])
          unitParts.push('제' + un + '과 <strong>' + unitErrors[un] + '</strong>次')
        }
        html += unitParts.join('、')
        html += '</div>'
      }

      html += '</div>'
      el.innerHTML = html
    }

    function renderQuizHistory(containerId, analysisId) {
      renderTodayAnalysis(analysisId || 'quiz-today-analysis')
      var container = document.getElementById(containerId || 'quiz-history-list')
      if (!container) return
      var history = quizHistoryForBook()
      if (history.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:20px 0;color:var(--text-dim);font-size:13px;">暂无测验记录</div>'
        return
      }
      var modeLabels = { 'kr-cn': '🇰🇷→🇨🇳', 'cn-kr': '🇨🇳→🇰🇷', 'listen': '🔊 听音选义', 'listen-kr': '🔊 听音选词', 'dict': '✍️ 听写', 'write': '✍️ 写义' }
      var html = ''
      // 倒序显示，最新的在前面
      for (var i = history.length - 1; i >= 0; i--) {
        var h = history[i]
        var d = new Date(h.date)
        var dateStr = (d.getMonth()+1) + '/' + d.getDate() + ' ' + d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0')
        var pct = Math.round(h.score / h.total * 100)
        var gradeDot = pct >= 90 ? '🟢' : pct >= 70 ? '🔵' : pct >= 40 ? '🟡' : '🔴'
        html += '<div class="quiz-history-item" style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px;">'
        html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">'
        html += '<span style="font-size:13px;font-weight:500;">' + gradeDot + ' ' + h.score + '/' + h.total + ' <span style="color:var(--text-dim);font-size:11px;">(' + pct + '%)</span></span>'
        html += '<span style="font-size:11px;color:var(--text-subtle);">' + (modeLabels[h.mode] || h.mode) + (h.partial ? ' <span style="color:var(--accent-coral);">未完成</span>' : '') + ' · ' + dateStr + '</span>'
        html += '</div>'
        if (h.errors && h.errors.length > 0) {
          html += '<div style="font-size:11px;color:var(--accent-pink);line-height:1.6;">'
          html += '<span style="color:var(--text-subtle);">薄弱词：</span>'
          var errTexts = []
          for (var ei = 0; ei < h.errors.length; ei++) {
            errTexts.push(h.errors[ei].kr + '(' + h.errors[ei].cn + ')')
          }
          html += errTexts.join('、')
          html += '</div>'
        }
        html += '</div>'
      }
      container.innerHTML = html
    }

    function switchQuizMode(mode) {
      quizMode = mode
      document.querySelectorAll('#quiz-mode-bar .tab-btn').forEach(function(b) {
        b.classList.toggle('active', b.getAttribute('data-mode') === mode)
      })
      var modeHint = document.getElementById('quiz-mode-hint')
      if (modeHint) {
        modeHint.textContent = {
          'kr-cn': '看韩语，选正确的中文意思',
          'cn-kr': '看中文，选正确的韩语',
          'listen': '听发音，选正确的中文意思',
          'listen-kr': '听发音，选出听到的韩语单词',
          'dict': '听发音，打出韩语',
          'write': '看韩语，写出中文意思（整页批量作答）'
        }[mode] || ''
      }
      renderQuizLessons()
    }

    function setQuizCount(n) {
      quizCount = n
      document.querySelectorAll('#quiz-count-bar .tab-btn').forEach(function(b) {
        b.classList.toggle('active', parseInt(b.getAttribute('data-count')) === n)
      })
    }

    function setQuizScope(s) {
      quizScope = s
      document.querySelectorAll('#quiz-scope-bar .quiz-scope-btn').forEach(function(b) {
        b.classList.toggle('active', b.getAttribute('data-scope') === s)
      })
      renderQuizLessons()
    }

    function toggleQuizLesson(num) {
      if (quizSelectedLessons.has(num)) quizSelectedLessons.delete(num)
      else quizSelectedLessons.add(num)
      renderQuizLessons()
    }

    function renderQuizLessons() {
      var list = document.getElementById('quiz-lesson-list')
      var footer = document.getElementById('quiz-footer')
      var info = document.getElementById('quiz-selected-info')
      var btn = document.getElementById('quiz-start-btn')
      if (!list) return

      list.innerHTML = ''
      var totalCount = 0
      var anySelected = quizSelectedLessons.size > 0

      LESSONS.forEach(function(lesson) {
        var words = VOCAB[lesson.num] || []
        var count = 0
        words.forEach(function(w) {
          var key = wk(w, lesson.num)
          var ok = false
          if (quizScope === 'all') ok = true
          else if (quizScope === 'unmastered' && !isMastered(w, lesson.num)) ok = true
          else if (quizScope === 'starred' && starred.has(key)) ok = true
          else if (quizScope === 'weak' && isWeak(key)) ok = true
          else if (quizScope === 'mastered' && isMastered(w, lesson.num)) ok = true
          if (ok) count++
        })
        if (count === 0) return
        totalCount += count

        var sel = quizSelectedLessons.has(lesson.num)
        var div = document.createElement('div')
        div.className = 'review-option'
        div.style.cssText = sel ? 'border-color:var(--primary);background:var(--primary-light);' : ''
        div.onclick = function() { toggleQuizLesson(lesson.num) }
        div.innerHTML =
          '<div class="ro-icon" style="font-size:20px;">' + (sel ? '☑️' : '☐') + '</div>' +
          '<div><div class="ro-title">제' + lesson.num + '과 · ' + lesson.title + '</div>' +
          '<div class="ro-desc">' + lesson.kr + '</div></div>' +
          '<span class="ro-count" style="color:var(--primary);">' + count + '词</span>'
        list.appendChild(div)
      })

      if (anySelected) {
        var selTotal = 0
        quizSelectedLessons.forEach(function(n) {
          var ws = VOCAB[n] || []
          ws.forEach(function(w) {
            var key = wk(w, n)
            var ok = false
            if (quizScope === 'all') ok = true
            else if (quizScope === 'unmastered' && !isMastered(w, n)) ok = true
            else if (quizScope === 'starred' && starred.has(key)) ok = true
            else if (quizScope === 'weak' && isWeak(key)) ok = true
            else if (quizScope === 'mastered' && isMastered(w, n)) ok = true
            if (ok) selTotal++
          })
        })
        info.textContent = '已选 ' + quizSelectedLessons.size + ' 个单元，共 ' + selTotal + ' 词'
      } else {
        info.textContent = '未选单元则默认全部 · 共 ' + totalCount + ' 词'
      }

      footer.style.display = totalCount > 0 ? 'block' : 'none'
      btn.disabled = totalCount === 0  // 1~3 词也可开始（点开始后弹确认），0 词才禁用
    }

    function buildQuizPool() {
      var pool = []
      LESSONS.forEach(function(l) {
        var words = VOCAB[l.num] || []
        words.forEach(function(w) {
          var item = {}
          for (var k in w) { if (w.hasOwnProperty(k)) item[k] = w[k] }
          item.lessonNum = l.num
          var key = wk(w, l.num)
          var ok = false
          if (quizScope === 'all') ok = true
          else if (quizScope === 'unmastered' && !isMastered(w, l.num)) ok = true
          else if (quizScope === 'starred' && starred.has(key)) ok = true
          else if (quizScope === 'weak' && isWeak(key)) ok = true
          else if (quizScope === 'mastered' && isMastered(w, l.num)) ok = true
          if (ok) pool.push(item)
        })
      })
      return pool
    }

    // 当前教材全部词条（带 lessonNum，供选项构建/听写匹配用）
    function buildBookItems() {
      var items = []
      LESSONS.forEach(function(l) {
        (VOCAB[l.num] || []).forEach(function(w) {
          var item = {}
          for (var k in w) { if (w.hasOwnProperty(k)) item[k] = w[k] }
          item.lessonNum = l.num
          items.push(item)
        })
      })
      return items
    }

    // 构建一道选择题的选项（易混词干扰项动态注入 + 显示去重）
    // mode: kr-cn / cn-kr / listen（选项为中文释义）/ listen-kr（选项为韩语词形）
    // 返回 { options: [显示文本], optionKeys: [词key], correctIdx, contrastKeys: [注入的易混伙伴key] }
    function buildQuizOptions(w, mode, allItems) {
      var isKrOption = mode === 'cn-kr' || mode === 'listen-kr'
      var correctText = isKrOption ? w.kr : w.cn
      var targetKey = wk(w, w.lessonNum)
      var chosen = []   // { text, key }
      var contrastKeys = []   // 实际进入选项的易混伙伴（答对时用于渐进降权）
      function tryAdd(text, key) {
        if (!text || text === correctText) return false
        if (chosen.some(function(c) { return c.text === text })) return false
        chosen.push({ text: text, key: key })
        return true
      }

      // ① 易混词干扰项优先（动态注入概率，最多 2 个）：
      //    有个人混淆记录 → 0.8（用户行为证据 > 系统词形相似度）
      //    仅预设候选 → 0.4；无任何候选 → 0（纯随机普通题）
      var partners = getConfusionPartners(targetKey)
      var hasPersonal = partners.some(function(p) { return p.kind === 'personal' })
      var injectProb = hasPersonal ? 0.8 : (partners.length > 0 ? 0.4 : 0)
      if (partners.length > 0 && injectProb > 0 && Math.random() < injectProb) {
        var nPartners = Math.min(2, partners.length)
        for (var i = 0; i < partners.length && chosen.length < nPartners; i++) {
          var pItem = null
          for (var ai = 0; ai < allItems.length; ai++) {
            if (wk(allItems[ai], allItems[ai].lessonNum) === partners[i].key) { pItem = allItems[ai]; break }
          }
          if (!pItem) continue
          if (tryAdd(isKrOption ? pItem.kr : pItem.cn, partners[i].key)) contrastKeys.push(partners[i].key)
        }
      }

      // ② 随机补齐到 3 个干扰项（排除显示重复）
      var distractors = allItems.slice()
      for (var i2 = distractors.length - 1; i2 > 0; i2--) {
        var j2 = Math.floor(Math.random() * (i2 + 1))
        var t2 = distractors[i2]; distractors[i2] = distractors[j2]; distractors[j2] = t2
      }
      for (var di = 0; di < distractors.length && chosen.length < 3; di++) {
        var x = distractors[di]
        if (wk(x, x.lessonNum) === targetKey) continue
        tryAdd(isKrOption ? x.kr : x.cn, wk(x, x.lessonNum))
      }

      // ③ 加入正确答案并整体打乱（选项与 key 同步移动，correctIdx 跟随）
      var options = [], optionKeys = []
      chosen.forEach(function(c) { options.push(c.text); optionKeys.push(c.key) })
      var correctIdx = options.length
      options.push(correctText); optionKeys.push(targetKey)
      for (var i3 = options.length - 1; i3 > 0; i3--) {
        var j3 = Math.floor(Math.random() * (i3 + 1))
        var t3 = options[i3]; options[i3] = options[j3]; options[j3] = t3
        var k3 = optionKeys[i3]; optionKeys[i3] = optionKeys[j3]; optionKeys[j3] = k3
        if (i3 === correctIdx) correctIdx = j3
        else if (j3 === correctIdx) correctIdx = i3
      }
      return { options: options, optionKeys: optionKeys, correctIdx: correctIdx, contrastKeys: contrastKeys }
    }

    function shuffleArray(arr) {
      for (var i = arr.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1))
        var t = arr[i]; arr[i] = arr[j]; arr[j] = t
      }
      return arr
    }

    // 加权随机选取 k 个个人混淆对：权重高 → 更容易被选（动态核心）
    // 已选对涉及过的词会从候选中排除（一个词一局最多进一个辨析对）→ 防止某对霸占整局
    function pickWeightedPairs(pairs, k) {
      var out = []
      var remaining = pairs.slice()
      var usedWords = {}
      while (out.length < k && remaining.length > 0) {
        var total = 0
        for (var i = 0; i < remaining.length; i++) total += remaining[i].weight
        if (total <= 0) break
        var r = Math.random() * total
        var acc = 0, idx = remaining.length - 1
        for (var i2 = 0; i2 < remaining.length; i2++) {
          acc += remaining[i2].weight
          if (r < acc) { idx = i2; break }
        }
        var p = remaining[idx]
        out.push(p)
        usedWords[p.a] = true; usedWords[p.b] = true
        remaining = remaining.filter(function(x) { return !usedWords[x.a] && !usedWords[x.b] })
      }
      return out
    }

    // 把一对辨析词放入间隔 2~3 的空位（不机械相邻）；放不下则任意两个空位兜底
    function placePairWords(slots, wordA, wordB) {
      var n = slots.length
      for (var tries = 0; tries < 30; tries++) {
        var i = Math.floor(Math.random() * n)
        var gap = 2 + Math.floor(Math.random() * 2)
        if (i + gap < n && !slots[i] && !slots[i + gap]) {
          slots[i] = wordA; slots[i + gap] = wordB
          return true
        }
      }
      var empties = []
      for (var j = 0; j < n; j++) if (!slots[j]) empties.push(j)
      if (empties.length >= 2) { slots[empties[0]] = wordA; slots[empties[1]] = wordB; return true }
      return false
    }

    // 动态出题规划：普通随机题 + 个人混淆辨析题
    // - 辨析对数量 = min(⌊N×20%⌋, 词池内的活跃个人混淆对数)；没有活跃对 → 全是普通题（不强行凑）
    // - 辨析对按权重加权随机选出；每对两词间隔 2~3 题放置
    // - 剩余位置由普通随机词填充（排除已用作辨析的词）
    // 所有模式共用：听写没有选项，同样靠"辨析对近邻出现"形成对照
    function planQuizSlots(pool, n) {
      var slots = []
      for (var si = 0; si < n; si++) slots.push(null)
      var poolByKey = {}
      pool.forEach(function(w) { poolByKey[wk(w, w.lessonNum)] = w })
      var activePairs = getActivePersonalPairs(getCurrentBook().bookId).filter(function(p) {
        return poolByKey[p.a] && poolByKey[p.b]
      })
      var maxPairs = Math.min(Math.floor(n * 0.2), activePairs.length)
      var picked = pickWeightedPairs(activePairs, maxPairs)
      var used = {}
      picked.forEach(function(p) {
        var wa = poolByKey[p.a], wb = poolByKey[p.b]
        if (placePairWords(slots, wa, wb)) { used[p.a] = true; used[p.b] = true }
      })
      var normals = pool.filter(function(w) { return !used[wk(w, w.lessonNum)] })
      shuffleArray(normals)
      var ni = 0
      for (var i = 0; i < slots.length; i++) {
        if (!slots[i]) slots[i] = normals[ni++] || slots[i]
      }
      return slots
    }

    function generateQuizQuestions(pool) {
      var n = Math.min(quizCount, pool.length)
      var slots = planQuizSlots(pool, n)
      var allItems = buildBookItems()
      var questions = []
      slots.forEach(function(w) {
        if (!w) return
        var targetKey = wk(w, w.lessonNum)
        // 听写/写义模式无需选项，直接输入（写义=整页批量，每题同样携带 targetKey 走自动掌握/错题链路）
        if (quizMode === 'dict' || quizMode === 'write') {
          questions.push({ word: w, targetKey: targetKey, options: [], optionKeys: [], correctIdx: -1, contrastKeys: [] })
          return
        }
        var built = buildQuizOptions(w, quizMode, allItems)
        questions.push({ word: w, targetKey: targetKey, options: built.options, optionKeys: built.optionKeys, correctIdx: built.correctIdx, contrastKeys: built.contrastKeys || [] })
      })
      return questions
    }

    function startQuiz() {
      var nums = setKeys(quizSelectedLessons)
      var pool = buildQuizPool()
      if (nums.length > 0) { pool = pool.filter(function(w) { return nums.indexOf(w.lessonNum) >= 0 }) }
      if (pool.length === 0) { showQuizNoWordsOverlay(); return }
      if (pool.length < 4) { showQuizLowOverlay(pool); return }
      beginQuiz(pool)
    }

    // 真正开局：给定词池开始答题（startQuiz / quizRetry / 低词确认后共用）
    function beginQuiz(pool) {
      if (!pool || pool.length === 0) return
      quizQuestions = generateQuizQuestions(pool)
      quizIndex = 0; quizScore = 0; quizErrors = []; quizAnswers = []; quizAutoMasteredKeys = []
      quizWriteRevealed = []; quizWriteLastActive = -1
      document.getElementById('quiz-setup').style.display = 'none'
      document.getElementById('quiz-play').style.display = 'block'
      document.getElementById('quiz-result').style.display = 'none'
      document.getElementById('quiz-result').innerHTML = ''
      document.getElementById('quiz-tab-bar').style.display = 'none'
      hideNav()  // 答题中隐藏底部导航栏
      showQuizQuestion()
    }

    /* ═══════════ 测验词数不足确认弹窗（毛玻璃半透明）═══════════ */
    // 待确认开始的词池（不足 4 词时弹窗确认后使用）
    var _quizPendingPool = null

    // 1~3 个词：问用户是否直接开始（题数 = 实际词数）
    function showQuizLowOverlay(pool) {
      _quizPendingPool = pool
      var count = pool.length
      var el
      el = document.getElementById('quiz-low-emoji'); if (el) el.textContent = '🧩'
      el = document.getElementById('quiz-low-title'); if (el) el.textContent = '只剩 ' + count + ' 个词'
      el = document.getElementById('quiz-low-desc'); if (el) el.textContent = '当前范围只有 ' + count + ' 个词，不够 4 题。直接开始的话，这轮就是 ' + count + ' 题的小测验，测完就收工 🎉'
      el = document.getElementById('quiz-low-start'); if (el) el.textContent = '开始 ' + count + ' 题'
      el = document.getElementById('quiz-low-ghost'); if (el) el.style.display = ''
      el = document.getElementById('quiz-low-overlay'); if (el) el.style.display = 'flex'
    }

    // 0 个词：无法开始，引导切换范围
    function showQuizNoWordsOverlay() {
      _quizPendingPool = null
      var el
      el = document.getElementById('quiz-low-emoji'); if (el) el.textContent = '🌱'
      el = document.getElementById('quiz-low-title'); if (el) el.textContent = '没有可测的词啦'
      el = document.getElementById('quiz-low-desc'); if (el) el.textContent = '当前范围已经没有词了。可以切换到「全部」或「已掌握」等范围继续测验～'
      el = document.getElementById('quiz-low-start'); if (el) el.textContent = '知道了'
      el = document.getElementById('quiz-low-ghost'); if (el) el.style.display = 'none'
      el = document.getElementById('quiz-low-overlay'); if (el) el.style.display = 'flex'
    }

    // 弹窗主按钮：确认开始（或「知道了」关闭）
    function quizLowStart() {
      var pool = _quizPendingPool
      closeQuizLowOverlay()
      if (pool && pool.length > 0) beginQuiz(pool)
    }

    function closeQuizLowOverlay() {
      _quizPendingPool = null
      var el = document.getElementById('quiz-low-overlay')
      if (el) el.style.display = 'none'
    }

    function showQuizQuestion() {
      markStudyDay()
      if (quizIndex >= quizQuestions.length) { showQuizResult(); return }
      var q = quizQuestions[quizIndex]

      // 写义模式：整页批量作答（一屏列全部词，不逐题；由 panel 自行渲染并管理进度）
      if (quizMode === 'write') {
        renderQuizWritePanel()
        return
      }

      // 已答过的题进入"回顾"态（锁定不可改），未答过才是正常作答
      var prev = quizAnswers[quizIndex] || null
      quizAnswered = prev ? true : false

      document.getElementById('quiz-progress-text').textContent = (quizIndex + 1) + '/' + quizQuestions.length
      document.getElementById('quiz-score-live').textContent = '✅ ' + quizScore
      // 进度按"已到第几题"算：第一题 1/10，最后一道题满格 100%
      document.getElementById('quiz-progress-fill').style.width = ((quizIndex + 1) / quizQuestions.length * 100) + '%'
      document.getElementById('quiz-feedback').textContent = ''
      document.getElementById('quiz-feedback').style.color = 'var(--text-dim)'

      // 上一题/下一题按钮：回顾态始终显示"下一题"
      var prevBtn = document.getElementById('quiz-prev-btn')
      var nextBtn = document.getElementById('quiz-next-btn')
      prevBtn.style.display = quizIndex > 0 ? '' : 'none'
      nextBtn.style.display = prev ? '' : 'none'

      var area = document.getElementById('quiz-question-area')
      var word = q.word
      // 自动发音关闭时提示（手动点 🔊 仍可听）；只在会"自动播放"的模式下提示，避免用户以为没声音是 Bug
      var muteHint = ''
      if (!isAutoPlayEnabled() && (quizMode === 'kr-cn' || quizMode === 'listen' || quizMode === 'listen-kr' || quizMode === 'dict')) {
        muteHint = '<div style="font-size:11px;color:var(--text-subtle);margin-bottom:6px;">🔇 自动发音已关（手动点 🔊 仍可听）</div>'
      }
      if (quizMode === 'kr-cn') {
        area.innerHTML = muteHint + '<div class="quiz-q-label">韩→中 · 选择正确的中文</div>' +
          '<div class="quiz-q-word" style="display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;">' +
            '<span>' + word.kr + '</span>' +
            '<button class="quiz-q-speak" id="quiz-speak-btn" style="width:32px;height:32px;font-size:15px;margin-top:0;" onclick="event.stopPropagation();quizSpeakWord()" title="听发音">🔊</button>' +
          '</div>' +
          '<div style="font-size:12px;color:var(--text-dim);margin-top:4px;">' + word.pos + '</div>'
      } else if (quizMode === 'cn-kr') {
        area.innerHTML = muteHint + '<div class="quiz-q-label">中→韩 · 选择正确的韩语</div>' +
          '<div class="quiz-q-word">' + word.cn + '</div>' +
          '<div style="font-size:12px;color:var(--text-dim);margin-top:4px;">' + word.pos + '</div>'
      } else if (quizMode === 'listen') {
        area.innerHTML = muteHint + '<div class="quiz-q-label">听音选义 · 选择正确的中文</div>' +
          '<div class="quiz-q-word" style="font-size:14px;color:var(--text-dim);">🔊 正在播放...</div>' +
          '<button class="quiz-q-speak" id="quiz-speak-btn" onclick="quizSpeakWord()" title="播放发音">🔊</button>' +
          '<div style="font-size:11px;color:var(--text-subtle);margin-top:6px;">点击 🔊 可重播发音</div>'
      } else if (quizMode === 'listen-kr') {
        area.innerHTML = muteHint + '<div class="quiz-q-label">听音选词 · 选出你听到的韩语单词</div>' +
          '<div class="quiz-q-word" style="font-size:14px;color:var(--text-dim);">🔊 正在播放...</div>' +
          '<button class="quiz-q-speak" id="quiz-speak-btn" onclick="quizSpeakWord()" title="播放发音">🔊</button>' +
          '<div style="font-size:11px;color:var(--text-subtle);margin-top:6px;">点击 🔊 可重播发音</div>'
      } else {  // dict 听写
        area.innerHTML = muteHint + '<div class="quiz-q-label">✍️ 听写 · 听发音写出韩语</div>' +
          '<div class="quiz-q-word">' + word.cn + '</div>' +
          '<div style="font-size:12px;color:var(--text-dim);margin-top:4px;">' + word.pos + '</div>' +
          '<button class="quiz-q-speak" id="quiz-speak-btn" onclick="quizSpeakWord()" title="重播发音">🔊</button>' +
          '<div style="font-size:11px;color:var(--text-subtle);margin-top:6px;">点击 🔊 可重播发音</div>'
      }

      var optsEl = document.getElementById('quiz-options')
      var dictInput = document.getElementById('quiz-dict-input')
      var dictField = document.getElementById('quiz-dict-field')
      var fb = document.getElementById('quiz-feedback')
      var labels = ['A', 'B', 'C', 'D']

      if (quizMode === 'dict') {
        // 听写：隐藏选项，显示输入框
        optsEl.innerHTML = ''
        optsEl.style.display = 'none'
        if (dictInput) dictInput.style.display = 'block'
        if (dictField) {
          dictField.disabled = !!prev
          if (prev) {
            dictField.value = prev.submitted || ''
          } else {
            dictField.value = ''
            setTimeout(function() { dictField.focus() }, 350)
          }
        }
      } else {
        if (dictInput) dictInput.style.display = 'none'
        optsEl.style.display = ''
        optsEl.innerHTML = ''
        q.options.forEach(function(opt, idx) {
          var div = document.createElement('div')
          div.className = 'quiz-option'
          div.textContent = labels[idx] + '. ' + opt
          if (prev) {
            // 回顾态：锁定，标出正确和你选的
            div.style.pointerEvents = 'none'
            if (idx === q.correctIdx) div.classList.add('correct')
            else if (prev.selectedIdx === idx && !prev.correct) div.classList.add('wrong')
            else div.classList.add('dimmed')
          } else {
            div.onclick = function() { quizAnswer(idx) }
          }
          optsEl.appendChild(div)
        })
      }

      // 回顾已答过的题：恢复正误反馈
      if (prev) {
        if (quizMode === 'dict') {
          if (prev.correct) {
            fb.textContent = '✓ 正确！'
            fb.style.color = 'var(--accent-green)'
          } else if (prev.close) {
            fb.innerHTML = '✗ 很接近！正确写法是 <strong>' + q.word.kr + '</strong>'
            fb.style.color = '#c7851a'
          } else {
            fb.innerHTML = '✗ 正确答案是 <strong>' + q.word.kr + '</strong>'
            fb.style.color = 'var(--accent-pink)'
          }
        } else {
          if (prev.correct) {
            fb.textContent = '✓ 正确！'
            fb.style.color = 'var(--accent-green)'
          } else {
            fb.textContent = '✗ 正确答案是 ' + labels[q.correctIdx] + '. ' + q.options[q.correctIdx]
            fb.style.color = 'var(--accent-pink)'
          }
        }
      }

      // 未答过的新题：自动播放发音（受设置页「自动发音」开关控制）
      if (isAutoPlayEnabled() && !prev && (quizMode === 'kr-cn' || quizMode === 'listen' || quizMode === 'listen-kr' || quizMode === 'dict')) {
        setTimeout(function() { quizSpeakWord() }, 400)
      }
    }

    function quizSpeakWord() {
      var q = quizQuestions[quizIndex]
      if (!q) return
      var btn = document.getElementById('quiz-speak-btn')
      if (btn) { btn.classList.add('playing'); setTimeout(function() { btn.classList.remove('playing') }, 1500) }
      speakLocal(q.word, q.word.lessonNum, 'ko')
      document.getElementById('quiz-feedback').textContent = '🔊 正在播放...'
      document.getElementById('quiz-feedback').style.color = 'var(--text-dim)'
      setTimeout(function() {
        var fb = document.getElementById('quiz-feedback')
        if (fb && fb.textContent === '🔊 正在播放...') { fb.textContent = '' }
      }, 2500)
    }

    function quizAnswer(idx) {
      if (quizAnswered) return
      quizAnswered = true
      var q = quizQuestions[quizIndex]
      var correct = idx === q.correctIdx
      var selectedKey = q.optionKeys && q.optionKeys[idx] ? q.optionKeys[idx] : null
      quizAnswers[quizIndex] = { correct: correct, selectedIdx: idx, targetKey: q.targetKey || null, selectedKey: selectedKey }
      var labels = ['A', 'B', 'C', 'D']

      var opts = document.querySelectorAll('#quiz-options .quiz-option')
      opts.forEach(function(opt, i) {
        opt.style.pointerEvents = 'none'
        if (i === q.correctIdx) opt.classList.add('correct')
        else opt.classList.add('dimmed')
      })
      var fb = document.getElementById('quiz-feedback')
      if (!correct) {
        opts[idx].classList.add('wrong', 'shake')
        var w = q.word
        quizErrors.push({ kr: w.kr, cn: w.cn, pos: w.pos, lessonNum: w.lessonNum, key: wk(w, w.lessonNum) })
        // 混淆记录：仅当用户实际选了另一个词且两词"词形相似"（recordConfusion 内部把关），
        // 完全无关的选项只走上面的错题逻辑，不产生混淆关系
        if (q.targetKey && selectedKey && selectedKey !== q.targetKey) {
          recordConfusion(q.targetKey, selectedKey)
        }
        fb.textContent = '✗ 正确答案是 ' + labels[q.correctIdx]
        fb.style.color = 'var(--accent-pink)'
        // 答错停在当前题，显示"下一题"按钮
        document.getElementById('quiz-next-btn').style.display = ''
      } else {
        quizScore++
        // 连续答对 → 渐进降低本题出现的易混伙伴的混淆权重
        // （0.85^连续答对次数；只对"本题确实出现、且用户没有选错"的伙伴生效，
        //   每次新混淆会重置连续答对计数——权重回升，不是一次清零）
        if (q.contrastKeys) {
          q.contrastKeys.forEach(function(pk) {
            recordConfusionResolved(q.targetKey, pk)
          })
        }
        // 答对累计 → 自动已掌握（阈值 4 次，封顶，按书|课|词隔离）
        var m = recordQuizCorrect(q)
        fb.textContent = '✓ 正确！'
        fb.style.color = 'var(--accent-green)'
        appendQuizMasteryNote(fb, m)
        // 答对自动下一题（刚自动掌握时多停留一会儿，让用户看到 🎉）
        setTimeout(function() {
          quizIndex++
          showQuizQuestion()
        }, m.newlyMastered ? 1600 : 800)
      }

      document.getElementById('quiz-score-live').textContent = '✅ ' + quizScore
    }

    // 听写模式：提交输入判分
    function dictSubmit() {
      if (quizAnswered) return
      var q = quizQuestions[quizIndex]
      if (!q) return
      quizAnswered = true
      var field = document.getElementById('quiz-dict-field')
      if (field) field.disabled = true
      var input = normalizeForCompare(field ? field.value : '')
      var correct = normalizeForCompare(q.word.kr)
      var dist = levenshtein(input, correct)
      // 宽容规则：完全一致；或"距离 ≤1 且正确词 ≥3 字"（短词防变意，必须全对）
      var isCorrect = input === correct
      var isClose = !isCorrect && correct.length >= 3 && dist <= 1
      // 判分口径：只有完全一致才算对；"很接近"是中性第三态——不计分、不记错、不累计掌握，
      // 但明确提示正确写法（紧音/送气音等拼写小错不该被当成"对了"）
      quizAnswers[quizIndex] = { correct: isCorrect, close: isClose, submitted: field ? field.value : '', targetKey: q.targetKey || null, matchedKey: null }
      // 混淆信号（不改变判分）：输入命中了另一个"词形相似"的真实词
      // ——距离 ≤1 且比正确词更接近该词（含"很接近"被判对的情况，如 비싸다 打成 싸다）
      if (!isCorrect && q.targetKey) {
        var matchItems = buildBookItems().map(function(x) { return { key: wk(x, x.lessonNum), kr: x.kr } })
        var matched = findNearestWordKey(input, matchItems)
        if (matched && matched.key !== q.targetKey && matched.dist <= dist && isLikelyConfusionDist(matched.dist)) {
          quizAnswers[quizIndex].matchedKey = matched.key
          recordConfusion(q.targetKey, matched.key)
        }
      }
      var fb = document.getElementById('quiz-feedback')
      if (isCorrect) {
        quizScore++
        // 答对累计 → 自动已掌握
        var m = recordQuizCorrect(q)
        fb.textContent = '✓ 正确！'
        fb.style.color = 'var(--accent-green)'
        appendQuizMasteryNote(fb, m)
        // 答对自动下一题（刚自动掌握时多停留一会儿，方便看清）
        var dDelay = m.newlyMastered ? 1600 : 800
        setTimeout(function() {
          quizIndex++
          showQuizQuestion()
        }, dDelay)
      } else if (isClose) {
        // 很接近但拼写有误：中性第三态——不计分、不记错、不累计掌握，
        // 但明确展示正确写法（紧音/送气音等拼写小错不该被当成"对了"）
        // 同时记录"接近次数"（只记不显示，为将来"总差一点的词优先复习"预留数据）
        recordQuizClose(q)
        fb.innerHTML = '✗ 很接近！正确写法是 <strong>' + q.word.kr + '</strong>'
        fb.style.color = '#c7851a'
        setTimeout(function() {
          quizIndex++
          showQuizQuestion()
        }, 1400)
      } else {
        var w = q.word
        quizErrors.push({ kr: w.kr, cn: w.cn, pos: w.pos, lessonNum: w.lessonNum, key: wk(w, w.lessonNum) })
        fb.innerHTML = '✗ 正确答案是 <strong>' + w.kr + '</strong>'
        fb.style.color = 'var(--accent-pink)'
        // 答错停在当前题，显示"下一题"按钮
        document.getElementById('quiz-next-btn').style.display = ''
      }
      document.getElementById('quiz-score-live').textContent = '✅ ' + quizScore
    }

    /* ═══════════ 写义模式（✍️ 写义：整页批量 · 逐题即判）═══════════ */
    // 渲染整页批量面板：一屏列全部词，每行 = 韩语词 + 🔊 + 词性 + 输入框 + 「想不起来ㅠㅠ」
    // 判分方式：填完一行按回车（或点想不起来）→ 这一行立即判分就地反馈 → 自动跳下一行；全部判完自动进结果页
    function renderQuizWritePanel() {
      // 隐藏单题元素，显示批量面板
      document.getElementById('quiz-question-area').style.display = 'none'
      document.getElementById('quiz-options').style.display = 'none'
      var dictInput = document.getElementById('quiz-dict-input')
      if (dictInput) dictInput.style.display = 'none'
      var fb = document.getElementById('quiz-feedback')
      fb.textContent = ''; fb.style.display = 'none'
      document.getElementById('quiz-nav').style.display = 'none'
      var area = document.getElementById('quiz-write-panel')
      if (area) {
        area.style.display = 'block'
        var muteHint = isAutoPlayEnabled() ? '' : '<div style="font-size:11px;color:var(--text-subtle);margin-bottom:8px;">🔇 自动发音已关（手动点 🔊 仍可听）</div>'
        area.innerHTML = muteHint + buildQuizWriteRows() +
          '<div class="qw-finish-wrap"><button class="qw-finish" onclick="quizWriteFinish()">✅ 完成作答</button></div>'
      }
      quizWriteUpdateFilled()
      // 进入面板自动聚焦第一个输入框（onfocus 统一触发发音）
      if (quizQuestions.length > 0) {
        setTimeout(function() { quizWriteFocusRow(0) }, 400)
      }
    }

    // 构建批量行 HTML（逐题即判：已判的行锁定并就地显示对错与正确答案）
    function buildQuizWriteRows() {
      var html = ''
      for (var i = 0; i < quizQuestions.length; i++) {
        var q = quizQuestions[i]
        var judged = quizWriteIsJudged(i)
        var revealed = !!quizWriteRevealed[i]
        var a = quizAnswers[i] || null
        var ans = a && a.submitted != null ? a.submitted : ''
        var okCls = judged ? (a && a.correct ? ' ok' : ' bad') : ''
        html += '<div class="qw-row" id="qw-row-' + i + '">'
        html += '<div class="qw-head">'
        html += '<span class="qw-num">' + (i + 1) + '</span>'
        html += '<span class="qw-word">' + q.word.kr + '</span>'
        html += '<button class="quiz-q-speak qw-speak" onclick="quizWriteSpeakRow(' + i + ')" title="听发音">🔊</button>'
        html += '<span class="qw-pos">' + (q.word.pos || '') + '</span>'
        html += '<span class="qw-result" id="qw-result-' + i + '">' + (judged ? (a && a.correct ? '✓' : '✗') : '') + '</span>'
        html += '</div>'
        html += '<div class="qw-body">'
        html += '<input id="quiz-write-input-' + i + '" class="qw-input' + okCls + '"' +
          (judged ? ' disabled' : '') +
          ' value="' + escapeAttr(ans) + '" placeholder="写中文意思…"' +
          ' onkeydown="quizWriteKey(event,' + i + ')" onfocus="quizWriteOnFocus(' + i + ')" oninput="quizWriteUpdateFilled()" autocomplete="off" autocorrect="off" spellcheck="false" />'
        html += '<button class="qw-dontknow" id="qw-dk-' + i + '" onclick="quizWriteDontKnow(' + i + ')"' +
          (judged ? ' style="display:none;"' : '') + '>想不起来ㅠㅠ</button>'
        if (judged && a && !a.correct) {
          html += '<span class="qw-answer">' + (revealed ? '💡 答案：' : '正确答案：') + q.word.cn + '</span>'
        }
        html += '</div>'
        html += '</div>'
      }
      return html
    }

    // 输入值里的引号/尖括号转义（写进 value 属性前）
    function escapeAttr(s) {
      return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }

    // 某行是否已判（想不起来也算已判）
    function quizWriteIsJudged(i) {
      return !!quizWriteRevealed[i] || !!(quizAnswers[i] && quizAnswers[i].correct !== undefined)
    }

    // 全部行是否已判完
    function quizWriteAllJudged() {
      for (var i = 0; i < quizQuestions.length; i++) {
        if (!quizWriteIsJudged(i)) return false
      }
      return true
    }

    // 顶部进度：已判 X/N + 进度条 + 实时分数
    function quizWriteUpdateFilled() {
      var judged = 0
      for (var i = 0; i < quizQuestions.length; i++) {
        if (quizWriteIsJudged(i)) judged++
      }
      var total = quizQuestions.length
      var pt = document.getElementById('quiz-progress-text')
      if (pt) pt.textContent = '已判 ' + judged + '/' + total
      var fill = document.getElementById('quiz-progress-fill')
      if (fill) fill.style.width = (total > 0 ? (judged / total * 100) : 0) + '%'
      var score = document.getElementById('quiz-score-live')
      if (score) score.textContent = '✅ ' + quizScore
    }

    // 回车 → 判当前行（做完直接判）：判完自动跳下一个未判行；全部判完自动出结果
    function quizWriteKey(ev, i) {
      if (ev.key === 'Enter') {
        ev.preventDefault()
        quizWriteJudgeRow(i)
      }
    }

    // 输入框聚焦：① 自动判"上一行"——填过字的行，点下一个框 = 上一行收工，直接判，不用回车；
    // ② 自动播放该行发音（受设置页「自动发音」开关控制，关闭后只保留手动 🔊）
    function quizWriteOnFocus(i) {
      if (quizWriteLastActive >= 0 && quizWriteLastActive !== i && !quizWriteIsJudged(quizWriteLastActive)) {
        var prevInp = document.getElementById('quiz-write-input-' + quizWriteLastActive)
        if (prevInp && String(prevInp.value || '').trim() !== '') {
          quizWriteJudgeRowCore(quizWriteLastActive)
        }
      }
      quizWriteLastActive = i
      if (quizWriteAllJudged()) { showQuizResult(); return }
      if (isAutoPlayEnabled()) quizWriteSpeakRow(i)
    }

    // 下一个未判行
    function quizWriteNextRow(from) {
      for (var j = from + 1; j < quizQuestions.length; j++) {
        if (!quizWriteIsJudged(j)) return j
      }
      return -1
    }

    function quizWriteFocusRow(i) {
      var inp = document.getElementById('quiz-write-input-' + i)
      if (inp && !inp.disabled) inp.focus()
    }

    // 播放某一行韩语词的发音（🔊 按钮 / 自动发音共用）
    function quizWriteSpeakRow(i) {
      var q = quizQuestions[i]
      if (!q) return
      var btn = document.querySelector('#qw-row-' + i + ' .qw-speak')
      if (btn) { btn.classList.add('playing'); setTimeout(function() { btn.classList.remove('playing') }, 1500) }
      speakLocal(q.word, q.word.lessonNum, 'ko')
    }

    // 判一行（核心）：就地判分、就地反馈、更新进度；不负责跳焦点（由调用方决定）
    function quizWriteJudgeRowCore(i) {
      if (quizWriteIsJudged(i)) return
      var q = quizQuestions[i]
      if (!q) return
      var inp = document.getElementById('quiz-write-input-' + i)
      var raw = inp ? inp.value : ''
      var correct = cnAnswerMatch(raw, q.word.cn)
      if (correct) {
        quizScore++
        recordQuizCorrect(q)   // 答对累计 → 自动已掌握（已掌握词不重复处理）
        quizAnswers[i] = { correct: true, submitted: raw, targetKey: q.targetKey || null }
      } else {
        quizErrors.push({ kr: q.word.kr, cn: q.word.cn, pos: q.word.pos, lessonNum: q.word.lessonNum, key: wk(q.word, q.word.lessonNum), submitted: raw, revealed: false })
        quizAnswers[i] = { correct: false, submitted: raw, targetKey: q.targetKey || null }
      }
      quizWriteShowRowResult(i)
      quizWriteUpdateFilled()
    }

    // 逐题判分（回车触发）：判当前行；未判完 → 聚焦下一个未判行；全部判完 → 自动进结果页
    function quizWriteJudgeRow(i) {
      if (quizWriteIsJudged(i)) return
      var q = quizQuestions[i]
      if (!q) return
      quizWriteJudgeRowCore(i)
      if (quizWriteAllJudged()) {
        showQuizResult()
      } else {
        var next = quizWriteNextRow(i)
        if (next >= 0) quizWriteFocusRow(next)
      }
    }

    // 「想不起来ㅠㅠ」：就地显示答案、立即记错、锁定该行，跳下一个未判行（全部判完自动出结果）
    function quizWriteDontKnow(i) {
      if (quizWriteIsJudged(i)) return
      var q = quizQuestions[i]
      if (!q) return
      quizWriteRevealed[i] = true
      var inp = document.getElementById('quiz-write-input-' + i)
      quizAnswers[i] = { correct: false, submitted: inp ? inp.value : '', revealed: true, targetKey: q.targetKey || null }
      quizErrors.push({ kr: q.word.kr, cn: q.word.cn, pos: q.word.pos, lessonNum: q.word.lessonNum, key: wk(q.word, q.word.lessonNum), submitted: inp ? inp.value : '', revealed: true })
      quizWriteShowRowResult(i)
      quizWriteUpdateFilled()
      if (quizWriteAllJudged()) {
        showQuizResult()
      } else {
        var next = quizWriteNextRow(i)
        if (next >= 0) quizWriteFocusRow(next)
      }
    }

    // 「✅ 完成作答」：一键判完所有未判行（含空行，空=答错），全部判完自动进结果页
    function quizWriteFinish() {
      for (var i = 0; i < quizQuestions.length; i++) {
        if (!quizWriteIsJudged(i)) quizWriteJudgeRowCore(i)
      }
      if (quizWriteAllJudged()) showQuizResult()
    }

    // 就地反馈单行：锁定输入框、标 ✓/✗、显示正确答案、隐藏「想不起来」（逐题判分/想不起来共用）
    function quizWriteShowRowResult(i) {
      var q = quizQuestions[i]
      if (!q) return
      var a = quizAnswers[i] || null
      var inp = document.getElementById('quiz-write-input-' + i)
      if (inp) {
        inp.disabled = true
        inp.classList.remove('ok', 'bad')
        inp.classList.add(a && a.correct ? 'ok' : 'bad')
      }
      var dk = document.getElementById('qw-dk-' + i)
      if (dk) dk.style.display = 'none'
      var res = document.getElementById('qw-result-' + i)
      if (res) res.textContent = a && a.correct ? '✓' : '✗'
      var row = document.getElementById('qw-row-' + i)
      if (row && !a.correct && !row.querySelector('.qw-answer')) {
        var ans = document.createElement('span')
        ans.className = 'qw-answer'
        ans.textContent = (quizWriteRevealed[i] ? '💡 答案：' : '正确答案：') + q.word.cn
        row.appendChild(ans)
      }
    }

    // 上一题
    function quizPrev() {
      if (quizIndex <= 0) return
      quizIndex--
      showQuizQuestion()
    }

    // 下一题（答错后手动点击）
    function quizNext() {
      if (quizIndex >= quizQuestions.length - 1) { showQuizResult(); return }
      quizIndex++
      showQuizQuestion()
    }

    // 保存一笔测验记录（含错词进易错本），完整完成和半途退出共用
    function persistQuizRecord(score, total, partial) {
      addQuizSummary(score, total)
      quizHistory.push({ date: new Date().toISOString(), mode: quizMode, score: score, total: total, partial: !!partial, bookId: getCurrentBook().bookId, errors: quizErrors.map(function(e) { return { kr: e.kr, cn: e.cn, pos: e.pos, lessonNum: e.lessonNum } }) })
      saveQuizHistory()
      var demotedMastered = []
      quizErrors.forEach(function(e) {
        var d = srs[e.key] || { lv: 0, due: 0, ease: 2.5, n: 0 }
        d.badCount = (d.badCount || 0) + 1
        if (!d.lv) d.lv = 0
        // 已掌握词答错应降级，否则 isWeak() 过滤掉（lv>=4）
        if (d.lv >= 4) {
          d.lv = 3
          unmarkMastered(e.key)
          demotedMastered.push({ kr: e.kr, cn: e.cn })
        }
        d.last = Date.now()
        srs[e.key] = d
      })
      saveUserData()
      return demotedMastered
    }

    function showQuizResult() {
      document.getElementById('quiz-play').style.display = 'none'
      var demotedMastered = persistQuizRecord(quizScore, quizQuestions.length, false)

      var resultEl = document.getElementById('quiz-result')
      resultEl.style.display = 'block'

      var total = quizQuestions.length
      var score = quizScore
      var pct = Math.round(score / total * 100)
      var gradeClass = pct >= 90 ? 'perfect' : pct >= 70 ? 'good' : pct >= 40 ? 'ok' : 'bad'
      var gradeEmoji = pct >= 90 ? '🎉' : pct >= 70 ? '👍' : pct >= 40 ? '💪' : '📚'
      var gradeText = pct >= 90 ? '太棒了！' : pct >= 70 ? '不错哦！' : pct >= 40 ? '继续加油！' : '多练练会更好！'

      var html = '<div class="quiz-result-card">'
      html += '<div style="font-size:48px;margin-bottom:8px;">' + gradeEmoji + '</div>'
      html += '<div class="quiz-score ' + gradeClass + '">' + score + '<span style="font-size:20px;color:var(--text-dim);">/' + total + '</span></div>'
      html += '<div style="font-size:16px;color:var(--text-dim);margin-top:4px;">' + gradeText + '</div>'
      html += '<div style="font-size:13px;color:var(--text-subtle);margin-top:8px;">正确率 ' + pct + '%</div>'

      if (quizErrors.length > 0) {
        html += '<div class="quiz-errors"><div class="quiz-errors-title">❌ 答错的词（已加入易错本）</div>'
        quizErrors.forEach(function(e) {
          // 写义模式：错词行额外显示"你写的"，方便对照正确答案纠错
          var typedHtml = ''
          if (quizMode === 'write') {
            var typed = e.revealed ? '（想不起来）' : (e.submitted ? e.submitted : '（空）')
            typedHtml = '<div style="font-size:11px;color:var(--accent-pink);margin-bottom:2px;">你写的：' + escapeAttr(typed) + '</div>'
          }
          html += '<div class="quiz-error-item"><div>' + typedHtml + '<span class="qe-kr">' + e.kr + '</span> · <span class="qe-cn">' + e.cn + '</span></div><span style="font-size:11px;color:var(--text-subtle);">제' + e.lessonNum + '과</span></div>'
        })
        html += '</div>'
        if (demotedMastered.length > 0) {
          html += '<div style="font-size:12px;color:var(--accent-coral);background:var(--accent-coral-light);border-radius:10px;padding:10px 12px;margin-top:10px;line-height:1.6;">⚠️ ' + demotedMastered.length + ' 个已掌握的词在测验中答错，已移出「已掌握」进入复习</div>'
        }
        html += '<button class="quiz-retry-btn" onclick="reviewQuizErrors()" style="border-color:var(--accent-pink);color:var(--accent-pink);">📖 复习这 ' + quizErrors.length + ' 个错题</button>'
      }

      // 本局新晋「已掌握」的提示（与答错降级提示同款式，正向绿色）
      if (quizAutoMasteredKeys.length > 0) {
        html += '<div style="font-size:12px;color:var(--accent-green);background:var(--accent-green-light);border-radius:10px;padding:10px 12px;margin-top:10px;line-height:1.6;">✨ ' + quizAutoMasteredKeys.length + ' 个词累计答对 4 次，已自动标记为已掌握</div>'
      }

      html += '<button class="quiz-retry-btn" onclick="quizRetry()">🔄 再来一轮</button>'
      html += '<button class="quiz-retry-btn" style="margin-top:8px;border-color:var(--border);color:var(--text-dim);" onclick="quizBackToSetup()">↩ 返回设置</button>'
      html += '</div>'
      resultEl.innerHTML = html
      updateHomeStats()
      showNav()  // 结果页恢复底部导航栏
    }

    function reviewQuizErrors() {
      if (quizErrors.length === 0) return
      var items = []
      quizErrors.forEach(function(e) {
        items.push({ kr: e.kr, cn: e.cn, pos: e.pos, stars: 3, lessonNum: e.lessonNum })
      })
      startStudyPool(items, '错题复习')
      studyFromPage = 'page-quiz'
    }

    function quizRetry() {
      var pool = buildQuizPool()
      var nums = setKeys(quizSelectedLessons)
      if (nums.length > 0) pool = pool.filter(function(w) { return nums.indexOf(w.lessonNum) >= 0 })
      if (pool.length === 0) { showQuizNoWordsOverlay(); return }
      if (pool.length < 4) { showQuizLowOverlay(pool); return }
      beginQuiz(pool)
    }

    function quizBackToSetup() {
      resetQuizToSetup()
    }

    // ─── 退出测验统一逻辑 ───
    // 所有"测验进行中退出"路径共用：已答过的题会计入测验记录（与 ✕ 退出 一致）。
    // 弹出毛玻璃确认弹窗，确认后保存记录并重置回设置页，再执行 onDone（如需跳转）。
    function exitQuizWithConfirm(onDone) {
      var answered = quizScore + quizErrors.length
      var resetAnd = function() {
        // 半途退出也保存已答部分的记录
        if (answered > 0) persistQuizRecord(quizScore, answered, true)
        resetQuizToSetup()
        if (typeof onDone === 'function') onDone()
      }
      if (quizQuestions.length > 0 && quizIndex < quizQuestions.length) {
        showAppDialog({
          emoji: '👋',
          title: '退出测验？',
          desc: answered > 0 ? '已答的 ' + answered + ' 题会计入测验记录。确定退出吗？' : '确定退出测验吗？',
          confirmText: '退出',
          cancelText: '继续答题',
          onConfirm: resetAnd
        })
      } else {
        resetAnd()
      }
    }

    function confirmExitQuiz() {
      exitQuizWithConfirm()
    }

    // 重置测验会话回设置页（返回设置 / 退出测验共用）
    function resetQuizToSetup() {
      quizQuestions = []; quizIndex = 0; quizScore = 0; quizErrors = []; quizAnswers = []; quizAutoMasteredKeys = []
      document.getElementById('quiz-play').style.display = 'none'
      document.getElementById('quiz-result').style.display = 'none'
      document.getElementById('quiz-result').innerHTML = ''
      document.getElementById('quiz-setup').style.display = 'block'
      document.getElementById('quiz-tab-bar').style.display = ''
      switchQuizTab('quiz')
      renderQuizLessons()
    }

    function quizGoBack() {
      if (!document.getElementById('quiz-play').style.display || document.getElementById('quiz-play').style.display === 'none') {
        goBack()
      } else {
        confirmExitQuiz()
      }
    }

    // ─── 退出测验统一逻辑 ───
    // 所有"测验进行中退出"路径共用：已答过的题会计入测验记录（与 ✕ 退出 一致）。
    // 弹出毛玻璃确认弹窗，确认后保存记录并重置回设置页，再执行 onDone（如需跳转）。
    function exitQuizWithConfirm(onDone) {
      var answered = quizScore + quizErrors.length
      var resetAnd = function() {
        // 半途退出也保存已答部分的记录
        if (answered > 0) persistQuizRecord(quizScore, answered, true)
        resetQuizToSetup()
        if (typeof onDone === 'function') onDone()
      }
      if (quizQuestions.length > 0 && quizIndex < quizQuestions.length) {
        showAppDialog({
          emoji: '👋',
          title: '退出测验？',
          desc: answered > 0 ? '已答的 ' + answered + ' 题会计入测验记录。确定退出吗？' : '确定退出测验吗？',
          confirmText: '退出',
          cancelText: '继续答题',
          onConfirm: resetAnd
        })
      } else {
        resetAnd()
      }
    }

    function confirmExitQuiz() {
      exitQuizWithConfirm()
    }

    // 重置测验会话回设置页（返回设置 / 退出测验共用）
    function resetQuizToSetup() {
      quizQuestions = []; quizIndex = 0; quizScore = 0; quizErrors = []; quizAnswers = []; quizAutoMasteredKeys = []
      quizWriteRevealed = []; quizWriteLastActive = -1
      document.getElementById('quiz-play').style.display = 'none'
      document.getElementById('quiz-result').style.display = 'none'
      document.getElementById('quiz-result').innerHTML = ''
      document.getElementById('quiz-setup').style.display = 'block'
      document.getElementById('quiz-tab-bar').style.display = ''
      var wp = document.getElementById('quiz-write-panel')
      if (wp) { wp.style.display = 'none'; wp.innerHTML = '' }
      // 恢复写义面板隐藏掉的单题元素（下次进入其他模式时正常显示）
      var qa = document.getElementById('quiz-question-area')
      if (qa) qa.style.display = ''
      var qnav = document.getElementById('quiz-nav')
      if (qnav) qnav.style.display = ''
      var qfb = document.getElementById('quiz-feedback')
      if (qfb) qfb.style.display = ''
      switchQuizTab('quiz')
      renderQuizLessons()
    }

    function showQuiz() {
      quizMode = 'kr-cn'; quizScope = 'all'; quizCount = 10
      quizSelectedLessons.clear(); quizQuestions = []; quizIndex = 0; quizScore = 0; quizErrors = []; quizAnswers = []; quizAutoMasteredKeys = []
      quizWriteRevealed = []; quizWriteLastActive = -1
      document.getElementById('quiz-setup').style.display = 'block'
      document.getElementById('quiz-play').style.display = 'none'
      document.getElementById('quiz-result').style.display = 'none'
      document.getElementById('quiz-result').innerHTML = ''
      document.querySelectorAll('#quiz-mode-bar .tab-btn').forEach(function(b) {
        b.classList.toggle('active', b.getAttribute('data-mode') === 'kr-cn')
      })
      document.querySelectorAll('#quiz-count-bar .tab-btn').forEach(function(b) {
        b.classList.toggle('active', parseInt(b.getAttribute('data-count')) === 10)
      })
      document.querySelectorAll('#quiz-scope-bar .quiz-scope-btn').forEach(function(b) {
        b.classList.toggle('active', b.getAttribute('data-scope') === 'all')
      })
      loadQuizHistory()
      renderQuizLessons()
      renderQuizHistory()
      // 切到测验标签
      switchQuizTab('quiz')
      document.getElementById('quiz-tab-bar').style.display = ''
      showPage('page-quiz')
    }

    // 测验页标签切换：测验 / 记录
    function switchQuizTab(tab) {
      document.querySelectorAll('#quiz-tab-bar .tab-btn').forEach(function(b) {
        b.classList.toggle('active', b.getAttribute('data-qtab') === tab)
      })
      var quizContent = document.getElementById('quiz-tab-content')
      var historyContent = document.getElementById('quiz-history-tab-content')
      if (tab === 'history') {
        if (quizContent) quizContent.style.display = 'none'
        if (historyContent) historyContent.style.display = 'block'
        loadQuizHistory()
        renderQuizHistory()
      } else {
        if (quizContent) quizContent.style.display = 'block'
        if (historyContent) historyContent.style.display = 'none'
      }
    }

    // 底部导航测验按钮（带页面栈重置）—— 测验进行中先统一确认（已答的会计入记录）
    function navQuiz() {
      var quizPlaying = document.getElementById('page-quiz').classList.contains('active') &&
        document.getElementById('quiz-play') && document.getElementById('quiz-play').style.display === 'block'
      if (quizPlaying && quizQuestions.length > 0 && quizIndex < quizQuestions.length) {
        exitQuizWithConfirm(function() {
          navigateRoot('page-quiz')
          showQuiz()
        })
        return
      }
      navigateRoot('page-quiz')
      showQuiz()
    }

    // 拦截测验中底部导航跳转 —— 测验进行中先统一确认（已答的会计入记录）。
    // 手机/浏览器返回键（popstate）也在拦截范围内：popstate 发生时历史已回退、URL 已变，
    // 这里先把历史顶回测验页（pushState 占位），再弹确认——返回键被真正"困住"，
    // 不会出现"已经返回了又弹确认"的状态脱节；点「继续答题」页面与 URL 保持一致。
    // 确认退出后按正常流程切换页面（历史多一条测验占位，退出后按返回会回到测验设置页，属预期）。
    var origShowPage = showPage
    showPage = function(id) {
      var quizPlaying = document.getElementById('page-quiz').classList.contains('active') &&
        document.getElementById('quiz-play') && document.getElementById('quiz-play').style.display === 'block'
      if (quizPlaying && quizQuestions.length > 0 && quizIndex < quizQuestions.length) {
        if (id !== 'page-quiz' && id !== 'page-study') {
          // 返回键触发的回退：把 URL/历史顶回测验页，再弹确认
          if (_fromPopstate) {
            _currentPage = 'page-quiz'
            history.pushState({ page: 'page-quiz' }, '', '#quiz')
          }
          exitQuizWithConfirm(function() { origShowPage(id) })
          return
        }
      }
      origShowPage(id)
    }

    loadQuizHistory()
