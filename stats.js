/* ═══════════════════════════════════════════
   stats.js · 统计层
   学习记录页 / 今日分析 / 每日列表
   从 index.html 拆出（v1.10.6）
   依赖：data.js / utils.js / app.js / quiz.js（quizHistory 运行时读取）
   加载：在 app.js 之后即可
   ═══════════════════════════════════════════ */

    /* ═══════════ 学习记录页 ═══════════ */
    function showStats() {
      navigateTo('page-stats')
      renderStatsContent()
    }

    function renderStatsContent() {
      renderStatsOverview()
      renderStatsList()
    }

    function renderStatsOverview() {
      var el = document.getElementById('stats-overview')
      if (!el) return
      var streak = loadStreak()
      var today = loadTodaySummary()
      var log = loadDailyLog()
      var cumQuiz = 0, cumCorrect = 0
      for (var k in log) { if (log.hasOwnProperty(k)) { cumQuiz += (log[k].quizTotal || 0); cumCorrect += (log[k].quizCorrect || 0) } }

      // 是否有任何历史足迹（日志里有学习/测验/掌握，或 srs 里已有掌握词）
      var hasHistory = false
      for (var kh in log) {
        if (log.hasOwnProperty(kh)) {
          var eh = log[kh]
          if ((eh.words || 0) > 0 || (eh.quizTotal || 0) > 0 || (eh.mastered || 0) > 0) { hasHistory = true; break }
        }
      }
      if (!hasHistory) {
        for (var ks in srs) {
          if (srs.hasOwnProperty(ks) && srs[ks].lv >= 4) { hasHistory = true; break }
        }
      }

      // 完全没有记录时：友好的空状态，鼓励开始，而不是一屏的 0
      var hasAny = hasHistory || streak.count > 0
      if (!hasAny) {
        el.innerHTML =
          '<div class="quiz-analysis-card" style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:28px 20px;text-align:center;">' +
          '<div style="font-size:40px;line-height:1;">🌱</div>' +
          '<p style="font-size:13px;color:var(--text-dim);margin-top:10px;line-height:1.7;">还没有学习记录<br>今天学几个词，这里就会出现你的学习足迹</p>' +
          '<button onclick="startMainStudy()" style="margin-top:14px;padding:11px 26px;border:none;border-radius:12px;background:var(--primary);color:#fff;font-family:var(--font-display);font-size:15px;font-weight:500;cursor:pointer;">📖 去学习</button>' +
          '</div>'
        return
      }

      // 累计已掌握（当前 srs 状态）+ 总词数
      var masteredCount = 0, totalWords = 0
      LESSONS.forEach(function(l) {
        var words = VOCAB[l.num] || []
        words.forEach(function(w) {
          totalWords++
          var d = srs[wk(w, l.num)]
          if (d && d.lv >= 4) masteredCount++
        })
      })

      // 本月掌握（日志里当月 mastered 之和）
      var curMonth = getStudyDay().slice(0, 7)
      var monthMastered = 0
      for (var k2 in log) {
        if (log.hasOwnProperty(k2) && k2.slice(0, 7) === curMonth) {
          monthMastered += (log[k2].mastered || 0)
        }
      }

      var html = ''
      html += '<div class="quiz-analysis-card" style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:12px;">'
      // 连续打卡 + 累计已掌握（一行两端）
      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">'
      html += '<div style="font-family:var(--font-display);font-size:16px;font-weight:500;">🔥 连续打卡 <strong style="color:var(--accent-coral);">' + (streak.count > 0 ? streak.count : 0) + '</strong> 天</div>'
      html += '<div style="font-size:12px;color:var(--text-dim);">📊 累计已掌握 <strong>' + masteredCount + '</strong> / ' + totalWords + ' 词</div>'
      html += '</div>'

      // 今天学习了多少词（始终显示，与"今天掌握"同款样式）
      html += '<div style="font-size:13px;color:var(--text);line-height:1.7;">'
      html += '📖 今天学习了 <strong>' + today.studyWords + '</strong> 个单词'
      html += '</div>'

      // 今日掌握（主打，含具体词 chips 纯展示）
      html += '<div style="font-size:13px;color:var(--text);line-height:1.7;">'
      html += '📈 今天掌握了 <strong>' + today.mastered + '</strong> 个词'
      html += '</div>'
      if (today.masteredKeys && today.masteredKeys.length > 0) {
        var chips = []
        for (var ci = 0; ci < today.masteredKeys.length; ci++) {
          var kp = today.masteredKeys[ci].split('|')
          // 取最后一段即韩语词：兼容旧格式「3|가족」与新格式「yonsei1|3|가족」
          chips.push('<span style="display:inline-block;background:var(--primary-light);color:var(--primary);border-radius:6px;padding:0 8px;font-size:12px;margin:3px 4px 0 0;">' + (kp[kp.length - 1] || '') + '</span>')
        }
        html += '<div>' + chips.join('') + '</div>'
      }

      // 今日测验正确率
      if (today.quizRounds > 0) {
        var todayPct = today.quizTotal > 0 ? Math.round(today.quizCorrect / today.quizTotal * 100) : 0
        html += '<div style="font-size:13px;color:var(--text-dim);margin-top:2px;">✅ 今日测验 <strong>' + today.quizCorrect + '/' + today.quizTotal + '</strong>（' + todayPct + '%）</div>'
      }
      // 今日错词（从今日测验记录取，纯展示，与"已掌握"同款 chips，珊瑚色区分）
      var todayErrors = todayQuizErrors()
      if (todayErrors.length > 0) {
        html += '<div style="font-size:13px;color:var(--text);line-height:1.7;">📕 今日错词：</div>'
        var errChips = []
        for (var ej = 0; ej < todayErrors.length; ej++) {
          errChips.push('<span style="display:inline-block;background:var(--accent-coral-light);color:var(--accent-coral);border-radius:6px;padding:0 8px;font-size:12px;margin:3px 4px 0 0;">' + todayErrors[ej] + '</span>')
        }
        html += '<div>' + errChips.join('') + '</div>'
      }

      // 底部：本月掌握 + 累计测验
      var cumPct = cumQuiz > 0 ? Math.round(cumCorrect / cumQuiz * 100) : 0
      html += '<div style="font-size:12px;color:var(--text-subtle);margin-top:8px;border-top:1px solid var(--border);padding-top:8px;">'
      html += '本月掌握 <strong>' + monthMastered + '</strong> 词 · 累计测验 <strong>' + cumCorrect + '/' + cumQuiz + '</strong>（' + cumPct + '%）'
      html += '</div>'
      html += '</div>'
      el.innerHTML = html
    }

    // 今日测验答错的词（去重，只显示韩语）
    function todayQuizErrors() {
      var today = getStudyDay()
      var seen = {}
      var out = []
      for (var i = 0; i < quizHistory.length; i++) {
        var h = quizHistory[i]
        if (getStudyDay(new Date(h.date)) !== today) continue
        var errs = h.errors || []
        for (var j = 0; j < errs.length; j++) {
          var kr = errs[j].kr
          if (!seen[kr]) { seen[kr] = true; out.push(kr) }
        }
      }
      return out
    }

    function renderStatsList() {
      var el = document.getElementById('stats-list')
      if (!el) return
      var log = loadDailyLog()
      var todayKey = getStudyDay()
      var weekNames = ['日', '一', '二', '三', '四', '五', '六']

      // 只收集"有记录的日子"（掌握/测验/学习任一），倒序（最新在前）
      var days = []
      for (var k in log) {
        if (!log.hasOwnProperty(k)) continue
        var e = log[k]
        if ((e.words || 0) > 0 || (e.quizTotal || 0) > 0 || (e.mastered || 0) > 0) {
          days.push(k)
        }
      }
      days.sort().reverse()

      if (days.length === 0) {
        el.innerHTML = ''
        return
      }

      var html = ''
      var curMonth = null
      for (var i = 0; i < days.length; i++) {
        var key = days[i]
        var dObj = new Date(key + 'T12:00:00')
        var month = key.slice(0, 7)
        if (month !== curMonth) {
          curMonth = month
          html += '<div class="stats-month">📅 ' + dObj.getFullYear() + '年' + (dObj.getMonth() + 1) + '月</div>'
        }
        var e = log[key]
        var parts = []
        if ((e.mastered || 0) > 0) parts.push('掌握 <strong>' + e.mastered + '</strong> 词')
        if ((e.quizTotal || 0) > 0) {
          var pct = Math.round((e.quizCorrect || 0) / e.quizTotal * 100)
          parts.push('测验 <strong>' + (e.quizCorrect || 0) + '/' + e.quizTotal + '</strong>（' + pct + '%）')
        } else if ((e.words || 0) > 0) {
          parts.push('复习 ' + (e.words || 0) + ' 词')
        }
        html += '<div class="stats-day' + (key === todayKey ? ' today' : '') + '">'
        html += '<span class="stats-date">' + (dObj.getMonth() + 1) + '/' + dObj.getDate() + ' 周' + weekNames[dObj.getDay()] + '</span>'
        html += '<span class="stats-info">' + parts.join(' · ') + '</span>'
        html += '</div>'
      }

      el.innerHTML = html
    }

    function goToQuizAnalysis() {
      navigateRoot('page-quiz')
      showQuiz()
      switchQuizTab('history')
      setTimeout(function() {
        var el = document.getElementById('quiz-today-analysis')
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 300)
    }
