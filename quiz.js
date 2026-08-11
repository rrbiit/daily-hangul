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

    function loadQuizHistory() {
      try { var v = lsGet('quiz-history', ''); quizHistory = v ? JSON.parse(v) : [] } catch(e) { quizHistory = [] }
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
      var todayRecords = quizHistory.filter(function(h) {
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
      if (quizHistory.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:20px 0;color:var(--text-dim);font-size:13px;">暂无测验记录</div>'
        return
      }
      var modeLabels = { 'kr-cn': '🇰🇷→🇨🇳', 'cn-kr': '🇨🇳→🇰🇷', 'listen': '🔊 听音', 'dict': '✍️ 听写' }
      var html = ''
      // 倒序显示，最新的在前面
      for (var i = quizHistory.length - 1; i >= 0; i--) {
        var h = quizHistory[i]
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
          'dict': '听发音，打出韩语'
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
      btn.disabled = totalCount < 4
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

    function generateQuizQuestions(pool) {
      var n = Math.min(quizCount, pool.length)
      var shuffled = pool.slice()
      for (var i = shuffled.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1))
        var t = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = t
      }
      var selected = shuffled.slice(0, n)

      var questions = []
      var allItems = []
      LESSONS.forEach(function(l) {
        (VOCAB[l.num] || []).forEach(function(w) {
          var item = {}; for (var k in w) { if (w.hasOwnProperty(k)) item[k] = w[k] }; item.lessonNum = l.num
          allItems.push(item)
        })
      })

      selected.forEach(function(w) {
        // 听写模式无需选项，直接输入韩语
        if (quizMode === 'dict') {
          questions.push({ word: w, options: [], correctIdx: -1 })
          return
        }
        var correct = quizMode === 'cn-kr' ? w.kr : w.cn
        var distractors = allItems.filter(function(x) { return x.kr !== w.kr })
        for (var i2 = distractors.length - 1; i2 > 0; i2--) {
          var j2 = Math.floor(Math.random() * (i2 + 1))
          var t2 = distractors[i2]; distractors[i2] = distractors[j2]; distractors[j2] = t2
        }
        var picked = distractors.slice(0, 3)
        var options = picked.map(function(x) { return quizMode === 'cn-kr' ? x.kr : x.cn })
        options.push(correct)
        for (var i3 = options.length - 1; i3 > 0; i3--) {
          var j3 = Math.floor(Math.random() * (i3 + 1))
          var t3 = options[i3]; options[i3] = options[j3]; options[j3] = t3
        }
        questions.push({ word: w, options: options, correctIdx: options.indexOf(correct) })
      })
      return questions
    }

    function startQuiz() {
      var nums = setKeys(quizSelectedLessons)
      var pool = buildQuizPool()
      if (nums.length > 0) { pool = pool.filter(function(w) { return nums.indexOf(w.lessonNum) >= 0 }) }
      if (pool.length < 4) { alert('词汇不足，至少需要4个词才能测验'); return }

      quizQuestions = generateQuizQuestions(pool)
      quizIndex = 0; quizScore = 0; quizErrors = []; quizAnswers = []
      document.getElementById('quiz-setup').style.display = 'none'
      document.getElementById('quiz-play').style.display = 'block'
      document.getElementById('quiz-result').style.display = 'none'
      document.getElementById('quiz-result').innerHTML = ''
      document.getElementById('quiz-tab-bar').style.display = 'none'
      hideNav()  // 答题中隐藏底部导航栏
      showQuizQuestion()
    }

    function showQuizQuestion() {
      markStudyDay()
      if (quizIndex >= quizQuestions.length) { showQuizResult(); return }
      var q = quizQuestions[quizIndex]
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
      if (quizMode === 'kr-cn') {
        area.innerHTML = '<div class="quiz-q-label">韩→中 · 选择正确的中文</div>' +
          '<div class="quiz-q-word" style="display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;">' +
            '<span>' + word.kr + '</span>' +
            '<button class="quiz-q-speak" id="quiz-speak-btn" style="width:32px;height:32px;font-size:15px;margin-top:0;" onclick="event.stopPropagation();quizSpeakWord()" title="听发音">🔊</button>' +
          '</div>' +
          '<div style="font-size:12px;color:var(--text-dim);margin-top:4px;">' + word.pos + '</div>'
      } else if (quizMode === 'cn-kr') {
        area.innerHTML = '<div class="quiz-q-label">中→韩 · 选择正确的韩语</div>' +
          '<div class="quiz-q-word">' + word.cn + '</div>' +
          '<div style="font-size:12px;color:var(--text-dim);margin-top:4px;">' + word.pos + '</div>'
      } else if (quizMode === 'listen') {
        area.innerHTML = '<div class="quiz-q-label">听音选义 · 选择正确的中文</div>' +
          '<div class="quiz-q-word" style="font-size:14px;color:var(--text-dim);">🔊 正在播放...</div>' +
          '<button class="quiz-q-speak" id="quiz-speak-btn" onclick="quizSpeakWord()" title="播放发音">🔊</button>' +
          '<div style="font-size:11px;color:var(--text-subtle);margin-top:6px;">点击 🔊 可重播发音</div>'
      } else {  // dict 听写
        area.innerHTML = '<div class="quiz-q-label">✍️ 听写 · 听发音写出韩语</div>' +
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
            if (prev.close) {
              fb.innerHTML = '✓ 正确（很接近）· 正确写法 <strong>' + q.word.kr + '</strong>'
            } else {
              fb.textContent = '✓ 正确！'
            }
            fb.style.color = 'var(--accent-green)'
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

      // 未答过的新题：自动播放发音
      if (!prev && (quizMode === 'kr-cn' || quizMode === 'listen' || quizMode === 'dict')) {
        setTimeout(function() { quizSpeakWord() }, 400)
      }
    }

    function quizSpeakWord() {
      var q = quizQuestions[quizIndex]
      if (!q) return
      var btn = document.getElementById('quiz-speak-btn')
      if (btn) { btn.classList.add('playing'); setTimeout(function() { btn.classList.remove('playing') }, 1500) }
      speak(q.word.kr, 'ko')
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
      quizAnswers[quizIndex] = { correct: correct, selectedIdx: idx }
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
        fb.textContent = '✗ 正确答案是 ' + labels[q.correctIdx]
        fb.style.color = 'var(--accent-pink)'
        // 答错停在当前题，显示"下一题"按钮
        document.getElementById('quiz-next-btn').style.display = ''
      } else {
        quizScore++
        fb.textContent = '✓ 正确！'
        fb.style.color = 'var(--accent-green)'
        // 答对自动下一题
        setTimeout(function() {
          quizIndex++
          showQuizQuestion()
        }, 800)
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
      quizAnswers[quizIndex] = { correct: isCorrect || isClose, close: isClose, submitted: field ? field.value : '' }
      var fb = document.getElementById('quiz-feedback')
      if (isCorrect || isClose) {
        quizScore++
        if (isClose) {
          fb.innerHTML = '✓ 正确（很接近）· 正确写法 <strong>' + q.word.kr + '</strong>'
        } else {
          fb.textContent = '✓ 正确！'
        }
        fb.style.color = 'var(--accent-green)'
        // 答对自动下一题（接近时多停留一会儿，方便看清正确写法）
        setTimeout(function() {
          quizIndex++
          showQuizQuestion()
        }, isClose ? 1200 : 800)
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
      quizHistory.push({ date: new Date().toISOString(), mode: quizMode, score: score, total: total, partial: !!partial, errors: quizErrors.map(function(e) { return { kr: e.kr, cn: e.cn, pos: e.pos, lessonNum: e.lessonNum } }) })
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
          html += '<div class="quiz-error-item"><div><span class="qe-kr">' + e.kr + '</span> · <span class="qe-cn">' + e.cn + '</span></div><span style="font-size:11px;color:var(--text-subtle);">제' + e.lessonNum + '과</span></div>'
        })
        html += '</div>'
        if (demotedMastered.length > 0) {
          html += '<div style="font-size:12px;color:var(--accent-coral);background:var(--accent-coral-light);border-radius:10px;padding:10px 12px;margin-top:10px;line-height:1.6;">⚠️ ' + demotedMastered.length + ' 个已掌握的词在测验中答错，已移出「已掌握」进入复习</div>'
        }
        html += '<button class="quiz-retry-btn" onclick="reviewQuizErrors()" style="border-color:var(--accent-pink);color:var(--accent-pink);">📖 复习这 ' + quizErrors.length + ' 个错题</button>'
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
      if (pool.length < 4) { alert('词汇不足'); return }
      quizQuestions = generateQuizQuestions(pool)
      quizIndex = 0; quizScore = 0; quizErrors = []; quizAnswers = []
      document.getElementById('quiz-result').style.display = 'none'
      document.getElementById('quiz-result').innerHTML = ''
      document.getElementById('quiz-play').style.display = 'block'
      hideNav()  // 答题中隐藏底部导航栏
      showQuizQuestion()
    }

    function quizBackToSetup() {
      quizQuestions = []; quizIndex = 0; quizScore = 0; quizErrors = []; quizAnswers = []
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
    // 所有"测验进行中退出"路径共用：已答过的题会计入测验记录（与 ✕ 退出 一致），
    // 不再出现「会计入测验记录 / 进度将丢失」前后矛盾的文案与行为。
    // 返回 true = 已退出并重置到设置页；false = 用户取消。
    function exitQuizWithConfirm() {
      var answered = quizScore + quizErrors.length
      if (quizQuestions.length > 0 && quizIndex < quizQuestions.length) {
        if (!confirm(answered > 0 ? '确定退出吗？已答的 ' + answered + ' 题会计入测验记录。' : '确定退出吗？')) return false
        // 半途退出也保存已答部分的记录
        if (answered > 0) persistQuizRecord(quizScore, answered, true)
      }
      // 重置测验会话回设置页
      quizQuestions = []; quizIndex = 0; quizScore = 0; quizErrors = []; quizAnswers = []
      document.getElementById('quiz-play').style.display = 'none'
      document.getElementById('quiz-result').style.display = 'none'
      document.getElementById('quiz-result').innerHTML = ''
      document.getElementById('quiz-setup').style.display = 'block'
      document.getElementById('quiz-tab-bar').style.display = ''
      switchQuizTab('quiz')
      renderQuizLessons()
      return true
    }

    function confirmExitQuiz() {
      exitQuizWithConfirm()
    }

    function showQuiz() {
      quizMode = 'kr-cn'; quizScope = 'all'; quizCount = 10
      quizSelectedLessons.clear(); quizQuestions = []; quizIndex = 0; quizScore = 0; quizErrors = []; quizAnswers = []
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
        if (!exitQuizWithConfirm()) return
      }
      navigateRoot('page-quiz')
      showQuiz()
    }

    // 拦截测验中底部导航跳转 —— 测验进行中先统一确认（已答的会计入记录）
    var origShowPage = showPage
    showPage = function(id) {
      var quizPlaying = document.getElementById('page-quiz').classList.contains('active') &&
        document.getElementById('quiz-play') && document.getElementById('quiz-play').style.display === 'block'
      if (quizPlaying && quizQuestions.length > 0 && quizIndex < quizQuestions.length) {
        if (id !== 'page-quiz' && id !== 'page-study') {
          if (!exitQuizWithConfirm()) return
        }
      }
      origShowPage(id)
    }

    loadQuizHistory()
