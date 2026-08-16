/* ═══════════════════════════════════════════
   study.js · 学习层
   闪卡学习 / 发音 / 收藏页 / 搜索 / 易错本 / 复习池 / 键盘与滑动手势
   从 index.html 拆出（v1.10.6）
   依赖：data-books.js / data-yonsei1.js / utils.js / app.js 全局函数与状态
   加载：须在 app.js 之后、quiz.js 之前
   ═══════════════════════════════════════════ */

    /* ═══════════════════════════════════════════
       学习模式
       ═══════════════════════════════════════════ */

    // 从单词列表进入学习
    function hideNav() {
      document.querySelector('.bottom-nav').style.display = 'none'
    }
    function showNav() {
      document.querySelector('.bottom-nav').style.display = 'flex'
    }


    // 当前页面的词汇列表上下文（供 startStudyFromContext 使用）
    var _studyContextList = null

    // 从当前上下文列表开始学习（支持收藏/搜索/易错本/单词列表等任何来源）
    function startStudyFromContext(startKey, title, fromPage) {
      var list = _studyContextList
      if (!list || list.length === 0) return
      resetSessionStats()

      // 智能排序：未掌握的排前面（保留原始相对顺序）
      list.sort(function(a, b) {
        var aM = isMastered(a, a.lessonNum), bM = isMastered(b, b.lessonNum)
        if (aM && !bM) return 1
        if (!aM && bM) return -1
        return 0
      })

      // 根据 startKey 找到排序后的位置
      var startIdx = 0
      if (startKey) {
        for (var i = 0; i < list.length; i++) {
          if (wk(list[i], list[i].lessonNum) === startKey) { startIdx = i; break }
        }
      }

      // 若未找到或未指定，自动跳到第一个未掌握词
      if (!startKey || startIdx === 0) {
        for (var j = 0; j < list.length; j++) {
          if (!isMastered(list[j], list[j].lessonNum)) { startIdx = j; break }
        }
      }

      studyWords = list
      studyIndex = (startIdx >= 0 && startIdx < list.length) ? startIdx : 0
      isFlipped = false
      studyFromPage = fromPage
      document.getElementById('study-title').textContent = title
      hideNav()
      showCard()
      navigateTo('page-study')
    }

    function startStudy(lessonNum, startIndex) {
      var raw = VOCAB[lessonNum] || []
      var list = []
      for (var i = 0; i < raw.length; i++) {
        var w = {}
        var src = raw[i]
        for (var k in src) { if (src.hasOwnProperty(k)) w[k] = src[k] }
        w.lessonNum = lessonNum
        list.push(w)
      }
      if (list.length === 0) return

      _studyContextList = list
      var startKey = null
      if (typeof startIndex === 'number' && startIndex >= 0 && startIndex < raw.length) {
        startKey = wk(raw[startIndex], lessonNum)
      }
      startStudyFromContext(startKey, '제' + lessonNum + '과', 'page-words')
    }

    // 显示当前卡片
    function showCard(dir) {
      markStudyDay()
      const w = studyWords[studyIndex]
      if (!w) return
      // 看过这张卡即算"今天学过这个词"（去重：反复看不重复计，与退出方式无关）
      markWordStudied(wk(w, w.lessonNum))

      // 切换动画
      const card = document.getElementById('flashcard')
      card.classList.remove('slide-right', 'slide-left')
      if (dir === 'right') card.classList.add('slide-right')
      else if (dir === 'left') card.classList.add('slide-left')

      document.getElementById('study-progress').textContent = `${studyIndex + 1}/${studyWords.length}`

      // 卡片方向：正面显示什么语言
      if (cardDirection === 'cn-first') {
        document.getElementById('card-kr').textContent = w.cn
        document.getElementById('card-cn').textContent = w.kr
      } else {
        document.getElementById('card-kr').textContent = w.kr
        document.getElementById('card-cn').textContent = w.cn
      }
      document.getElementById('card-stars').innerHTML = renderStarsHTML(w.stars)
      document.getElementById('card-pos').textContent = w.pos

      // 例句
      var exDiv = document.getElementById('card-examples')
      var exList = generateExample(w)
      if (exList && exList.length > 0) {
        exDiv.style.display = 'block'
        exDiv.innerHTML = renderExamplesHTML(exList)
      } else {
        exDiv.style.display = 'none'
      }

      // 重置翻转状态
      document.getElementById('card-inner').classList.remove('flipped')
      isFlipped = false

      // 随机换一个萌 emoji
      var emojis = ['🐻','🐰','🐣','🐱','🐶','🐥','🐼','🦊','🐨','🐸','🐙','🌸','🍀','🫧','🎀','🩷','💝','🧸','🍰','☁️','🩵','🐾','🫶','⭐','🌈','💐','🍓','🍑']
      document.getElementById('card-emoji').textContent = emojis[Math.floor(Math.random() * emojis.length)]

      // 更新收藏/掌握按钮状态
      updateStarBtn()
      updateSrsStatus()

      // 自动播放当前单词发音（韩语优先方向：正面即韩语；中文优先时跳过，避免提前泄露答案）
      // 受设置页「自动发音」开关控制，关闭后只保留手动 🔊
      if (isAutoPlayEnabled() && cardDirection !== 'cn-first' && w.kr) {
        flashSpeakBtn()
        speakLocal(w, w.lessonNum, 'ko')
      }

      // 刷新顶栏发音快捷开关图标（与设置页同步）
      updateStudySoundBtn()
    }

    // 翻转卡片
    function flipCard(e) {
      // 点了喇叭或评分按钮不翻
      if (e && e.target && e.target.closest && (e.target.closest('.ex-clickable') || e.target.closest('.srs-rate-sm'))) return
      isFlipped = !isFlipped
      document.getElementById('card-inner').classList.toggle('flipped', isFlipped)
    }

    // 上一张
    // ─── 保存/恢复学习进度（按书隔离）───
    // 存储格式：ys-study-progress = { [bookId]: { words, index, title, fromPage } }
    // 每本书的快照各自保存，切换教材不丢任何一本书的进行中学习
    function getStudySnapshot(bookId) {
      var raw = lsGet('ys-study-progress', '')
      if (!raw) return null
      try { var m = JSON.parse(raw); return (m && m[bookId]) || null } catch(e) { return null }
    }
    function setStudySnapshot(bookId, snap) {
      var m = {}
      var raw = lsGet('ys-study-progress', '')
      try { if (raw) { m = JSON.parse(raw); if (!m || Array.isArray(m.words)) m = {} } } catch(e) { m = {} }
      m[bookId] = snap
      lsSet('ys-study-progress', JSON.stringify(m))
    }
    function clearStudySnapshot(bookId) {
      var m = {}
      var raw = lsGet('ys-study-progress', '')
      try { if (raw) { m = JSON.parse(raw); if (Array.isArray(m.words)) m = {} } } catch(e) { m = {} }
      if (m[bookId]) delete m[bookId]
      var keys = Object.keys(m)
      if (keys.length === 0) localStorage.removeItem('ys-study-progress')
      else lsSet('ys-study-progress', JSON.stringify(m))
    }

    function saveStudyProgress() {
      if (!studyWords || studyWords.length === 0) return
      setStudySnapshot(getCurrentBook().bookId, {
        words: studyWords,
        index: studyIndex,
        title: document.getElementById('study-title').textContent,
        fromPage: studyFromPage
      })
      updateContinueBtn()
    }

    function clearStudyProgress() {
      clearStudySnapshot(getCurrentBook().bookId)
      updateContinueBtn()
    }

    function hasStudyProgress() {
      var s = getStudySnapshot(getCurrentBook().bookId)
      return !!(s && s.words && s.words.length > 0)
    }

    function resumeStudy() {
      var p = getStudySnapshot(getCurrentBook().bookId)
      if (!p) return
      if (!p.words || p.words.length === 0) return
      _studyContextList = p.words
      studyWords = p.words
      studyIndex = Math.min(p.index, p.words.length - 1)
      studyFromPage = p.fromPage || 'page-home'
      resetSessionStats()
      isFlipped = false
      document.getElementById('study-title').textContent = p.title || '继续学习'
      hideNav()
      showCard()
      navigateTo('page-study')
    }

    function startMainStudy() {
      var due = buildDuePool()
      if (due.length > 0) {
        // 今日复习优先：到期词直接进入闪卡复习
        _studyContextList = due
        startStudyFromContext(null, '今日复习', 'page-home')
      } else if (hasStudyProgress()) {
        resumeStudy()
      } else {
        navigateTo('page-course')
      }
    }

    function updateContinueBtn() {
      var titleEl = document.getElementById('main-cta-title')
      var descEl = document.getElementById('main-cta-desc')
      var iconEl = document.getElementById('main-cta-icon')
      if (!titleEl || !descEl) return
      var due = buildDuePool()
      if (due.length > 0) {
        titleEl.textContent = '今日复习'
        descEl.textContent = due.length + ' 个词到期'
        if (iconEl) iconEl.textContent = '🔁'
        return
      }
      if (iconEl) iconEl.textContent = '📖'
      if (hasStudyProgress()) {
        var p = getStudySnapshot(getCurrentBook().bookId)
        titleEl.textContent = '继续学习'
        descEl.textContent = (p && p.title) || '恢复上次进度'
      } else {
        titleEl.textContent = '开始学习'
        descEl.textContent = getCurrentBook().textbook
      }
    }

    function prevCard() {
      if (studyIndex > 0) {
        studyIndex--
        showCard('left')
        saveStudyProgress()
      }
    }

    // 下一张
    function nextCard() {
      if (studyIndex < studyWords.length - 1) {
        studyIndex++
        showCard('right')
        saveStudyProgress()
      } else {
        clearStudyProgress()
        showStudyDone()
      }
    }

    // 发音按钮呼吸反馈：自动/手动发音时点亮，短暂后自然熄灭
    var _speakFbTimer = null
    function flashSpeakBtn() {
      var btn = document.getElementById('ctrl-speak')
      if (!btn) return
      if (_speakFbTimer) { clearTimeout(_speakFbTimer); _speakFbTimer = null }
      btn.classList.add('playing')
      _speakFbTimer = setTimeout(function() {
        btn.classList.remove('playing')
        _speakFbTimer = null
      }, 900)
    }

    // 发音：始终播韩语单词（中文优先时正面虽是中文，按钮仍读韩语，避免播中文无意义）
    function speakWord() {
      var w = studyWords[studyIndex]
      if (!w) return
      flashSpeakBtn()
      speakLocal(w, w.lessonNum, 'ko')
    }

    // 通用发音函数：speak('안녕하세요', 'ko')
    var _playingAudio = null


    // 通用发音函数：speak('안녕하세요', 'ko') / speak('안녕하세요', 'ko', 'audio/yonsei1/1/안녕하세요.mp3')
    // localSrc 存在时：本地 mp3 优先（不联网、任何浏览器可播）；
    // 本地缺失/播放被拦 → Google TTS 在线（用户翻墙环境可用）；失败静默不打扰。
    function speak(text, lang, localSrc) {
      if (!text) return
      if (_playingAudio) { _playingAudio.pause(); _playingAudio = null }
      if (window.speechSynthesis) { try { window.speechSynthesis.cancel() } catch(e) {} }
      var l = lang || 'ko'

      // Google TTS 在线播放（例句/本地缺失兜底；失败静默，不弹提示）
      var playGoogle = function() {
        var url = 'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=' + l + '&q=' + encodeURIComponent(text)
        var a = new Audio(url)
        a.playbackRate = parseFloat(lsGet('ys-tts-rate', '0.85'))
        _playingAudio = a
        a.play().catch(function() {
          if (_playingAudio === a) _playingAudio = null
        })
      }

      if (localSrc) {
        // 本地 mp3 优先：文件随网站发布，不依赖网络与浏览器内核
        var a = new Audio(localSrc)
        a.playbackRate = parseFloat(lsGet('ys-tts-rate', '0.85'))
        // 先静音启动，绕过浏览器自动播放策略（Chrome 允许静音自动播放），
        // 播放开始后再取消静音——学习卡片"自动发音"（非点击触发）也能出声。
        a.muted = true
        var settled = false
        var toGoogle = function() {
          if (settled) return
          settled = true
          if (_playingAudio === a) _playingAudio = null
          playGoogle()
        }
        // 文件不存在（404）/ 解码失败 → 回退 Google（用 onerror 属性，兼容性最稳）
        a.onerror = function() { toGoogle() }
        _playingAudio = a
        a.play().then(function() {
          a.muted = false
        }).catch(function() {
          toGoogle()
        })
      } else {
        // 无本地音频（如例句）→ 直接 Google 在线
        playGoogle()
      }
    }

    // 本地音频优先发音（词条级：知道书号/课号，指向 audio/ 目录的 mp3）
    function speakLocal(w, num, lang) {
      if (!w || !w.kr) return
      var bookId = (w.bookId) || getCurrentBook().bookId
      var src = 'audio/' + bookId + '/' + num + '/' + encodeURIComponent(w.kr) + '.mp3'
      speak(w.kr, lang || 'ko', src)
    }

    // 例句发音：Google TTS 在线（无本地音频），失败静默
    function speakExample(text, lang) {
      speak(text, lang)
    }

    // 本地音频优先发音（词条级：知道书号/课号，指向 audio/ 目录的 mp3）
    function speakLocal(w, num, lang) {
      if (!w || !w.kr) return
      var bookId = (w.bookId) || getCurrentBook().bookId
      var src = 'audio/' + bookId + '/' + num + '/' + encodeURIComponent(w.kr) + '.mp3'
      speak(w.kr, lang || 'ko', src)
    }

    // 例句/无本地音频的发音：Google TTS 在线尝试，失败静默（不降级、不弹提示）。
    // 单词发音已由本地 mp3 覆盖；例句未预生成（体积原因），走在线 Google TTS——
    // 用户环境可翻墙时能听；连不上（如手机未开梯子）时静默，不打扰学习。
    function speakExample(text, lang) {
      speak(text, lang)
    }

    // 生成例句 HTML，整行可点读
    function renderExamplesHTML(exList) {
      if (!exList || exList.length === 0) return ''
      var html = '<div class="ex-section-title">예문 例句</div>'
      exList.forEach(function(e) {
        html += '<div class="example-pair ex-clickable" data-speak="' + e.kr.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '">'
        html += '<div class="example-item">' + e.kr + ' 🔊</div>'
        html += '<div class="example-item-cn">' + e.cn + '</div>'
        html += '</div>'
      })
      return html
    }

    // 事件委托：点例句整行 → 播放，点卡片不翻面
    document.addEventListener('click', function(e) {
      // 例句朗读
      var row = e.target.closest ? e.target.closest('.ex-clickable') : null
      if (row) {
        var text = row.getAttribute('data-speak')
        if (text) { e.stopPropagation(); speakExample(text, 'ko') }
        return
      }

      // 单词卡片：发音按钮
      var speakEl = e.target.closest ? e.target.closest('.word-speak-btn') : null
      if (speakEl) {
        e.stopPropagation()
        var spkText = speakEl.getAttribute('data-speak')
        if (spkText) speak(spkText, 'ko', speakEl.getAttribute('data-path'))
        return
      }

      // 单词卡片：掌握/未掌握切换
      var badgeEl = e.target.closest ? e.target.closest('.word-mastery-badge') : null
      if (badgeEl) {
        e.stopPropagation()
        var badgeKey = badgeEl.getAttribute('data-key')
        if (badgeKey) {
          // 记住当前位置：刷新列表会触发 scrollTo(0)，先记下再还原，避免跳回顶部
          var savedScrollY = window.scrollY
          var d = srs[badgeKey]
          var now = Date.now()
          if (d && d.lv >= 4) {
            delete srs[badgeKey]
          } else {
            srs[badgeKey] = { lv: 4, due: now + 21*86400000, ease: 2.5, n: (d ? d.n + 1 : 1), badCount: 0 }
            markMastered(badgeKey)
          }
          saveUserData()
          updateHomeStats()
          renderLessons()
          // 根据当前页面刷新列表
          if (document.getElementById('page-weak').classList.contains('active')) {
            renderWeakWords()
          } else if (document.getElementById('page-starred').classList.contains('active')) {
            showStarred()
          } else if (document.getElementById('search-overlay').style.display === 'flex') {
            doSearch()
          } else {
            openLesson(currentLessonNum)
          }
          // 还原滚动位置（抵消 showPage 的 scrollTo(0)）
          window.scrollTo({ top: savedScrollY, behavior: 'auto' })
        }
        return
      }

      // 单词卡片：收藏星标切换
      var starEl = e.target.closest ? e.target.closest('.word-stars-clickable') : null
      if (starEl) {
        e.stopPropagation()
        var starKey = starEl.getAttribute('data-key')
        if (starKey) {
          var wasStarred = starred.has(starKey)
          if (wasStarred) starred.delete(starKey)
          else starred.add(starKey)
          popEl(starEl)
          saveUserData()
          var wItem = starEl.closest('.word-item')
          // 收藏页取消收藏 → 从 DOM 移除卡片
          if (wasStarred && document.getElementById('page-starred').classList.contains('active')) {
            if (wItem) wItem.remove()
            // 如果列表空了，显示空状态
            var vlist = document.getElementById('starred-list')
            var vlistItems = vlist ? vlist.querySelectorAll('.word-item') : []
            if (vlist && vlistItems.length === 0) {
              vlist.innerHTML = '<div style="text-align:center;padding:40px 0;color:var(--text-dim);font-size:14px;">还没有收藏的单词</div>'
            }
          } else if (wItem) {
            // 其他页面：局部刷新星标（跨书反查，findWordByKey 按 key 里的书ID定位）
            var isStar = starred.has(starKey)
            var starsSpan = wItem.querySelector('.word-stars-clickable')
            if (starsSpan) {
              var foundW = findWordByKey(starKey)
              var starCount = foundW ? foundW.stars : 5
              starsSpan.querySelector('.stars').innerHTML = isStar ? renderStars(5) : renderStars(starCount)
              starsSpan.style.color = isStar ? 'var(--star)' : ''
            }
          }
          updateHomeStats()
        }
        return
      }
    })

    // 从语法卡片的 pattern/formula 提取可安全高亮的标记（-에 / -부터 / -고 等）
    // 规则：只取「-」前缀的韩文标记；过滤含 / 或 ~ 的多选/变体（아/어요、은/는），
    //      避免把单字到处点亮；超长整句（>6字）不参与，仅作兜底不误伤。
    function grammarHighlightTokens(g) {
      var src = (g.pattern || '') + ' ' + (g.formula || '')
      var m = src.match(/-+[가-힣]+/g) || []
      var out = []
      m.forEach(function(t) {
        var tok = t.replace(/^-+/, '')
        if (!tok || tok.length > 6) return
        if (tok.indexOf('/') >= 0 || tok.indexOf('~') >= 0) return
        if (out.indexOf(tok) < 0) out.push(tok)
      })
      return out
    }

    // 在例句中高亮标记：只命中「韩文词末尾」的标记
    // （학교에 的 -에 ✓，이에요 里不亮；운동하고 的 -고 ✓，학교/포도 里不亮）
    function highlightKR(str, toks) {
      var out = str
      toks.forEach(function(tok) {
        var re = new RegExp('(' + tok + ')(?![가-힣])', 'g')
        out = out.replace(re, '<mark class="grammar-hl">$1</mark>')
      })
      return out
    }

    // 生成语法例句 HTML，整行可点读；有语法卡片时高亮其标记
    function renderGrammarExampleRow(ex, g) {
      var safe = ex.kr.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      var safeCN = ex.cn.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      var display = safe
      if (g) {
        var toks = grammarHighlightTokens(g)
        if (toks.length) display = highlightKR(safe, toks)
      }
      return '<div class="ex-item ex-clickable" data-speak="' + safe + '"><div class="kr">' + display + ' 🔊</div><div class="cn">' + safeCN + '</div></div>'
    }

    // 收藏切换
    function toggleStar() {
      const w = studyWords[studyIndex]
      if (!w) return
      const key = wk(w, w.lessonNum)
      if (starred.has(key)) starred.delete(key)
      else starred.add(key)
      updateStarBtn()
      saveUserData()
      updateStarredCount()
    }

    function updateStarBtn() {
      const btn = document.getElementById('ctrl-star')
      const w = studyWords[studyIndex]
      if (!btn) return
      if (w && starred.has(wk(w, w.lessonNum))) btn.classList.add('active')
      else btn.classList.remove('active')
    }

    // 一键已掌握：直接升到 lv=4
    function toggleMastered() {
      var w = studyWords[studyIndex]
      if (!w) return
      var key = wk(w, w.lessonNum)
      var d = srs[key]
      var now = Date.now()
      if (d && d.lv >= 4) {
        // 已经掌握了 → 取消掌握，重置为新词
        delete srs[key]
      } else {
        // 标记已掌握，badCount 清零 → 从易错本移除
        srs[key] = { lv: 4, due: now + 21*86400000, ease: 2.5, n: (d ? d.n + 1 : 1), badCount: 0 }
        markMastered(key)
      }
      updateSrsStatus()
      updateHomeStats()
      renderLessons()
      saveUserData()
      popEl(document.getElementById('ctrl-check'))
    }

    // updateMasterBtn 已不再需要，由 updateSrsStatus 替代
    function updateMasterBtn() {
      updateSrsStatus()
    }

    // 退出学习
    var studyFromPage = 'page-home'

    function exitStudy() {
      window.speechSynthesis && window.speechSynthesis.cancel()
      saveStudyProgress()
      showNav()
      goBack()
    }

    // 显示收藏列表
    // 底部导航收藏（带页面栈重置）
    function showStarredNav() {
      navigateRoot('page-starred')
      showStarred()
    }

    function showStarred() {
      showPage('page-starred')

      const count = document.getElementById('starred-count')
      const empty = document.getElementById('starred-empty')
      const vlist = document.getElementById('starred-list')
      const glist = document.getElementById('starred-glist')

      // 收集收藏的词（全局：遍历所有教材，按 书|课 分组）
      const wordGroups = {} // { "书ID|课号": [words] }
      BOOKS.forEach(book => {
        (book.lessons || []).forEach(lesson => {
          const ws = book.vocab[lesson.num] || []
          ws.forEach((w, idx) => {
            if (starred.has(wk(w, lesson.num, book.bookId))) {
              const gkey = book.bookId + '|' + lesson.num
              if (!wordGroups[gkey]) wordGroups[gkey] = []
              wordGroups[gkey].push({ ...w, bookId: book.bookId, bookTag: book.bookTag, lessonNum: lesson.num, wordIdx: idx })
            }
          })
        })
      })
      // 排序：先按教材顺序，再按课号
      const sortedGroupKeys = Object.keys(wordGroups).sort((a, b) => {
        const [bidA, numA] = a.split('|'), [bidB, numB] = b.split('|')
        const oa = BOOKS.findIndex(x => x.bookId === bidA), ob = BOOKS.findIndex(x => x.bookId === bidB)
        if (oa !== ob) return oa - ob
        return Number(numA) - Number(numB)
      })
      let totalWordCount = 0
      sortedGroupKeys.forEach(k => { totalWordCount += wordGroups[k].length })

      // 收集收藏的语法（全局）
      const gramGroups = {}
      BOOKS.forEach(book => {
        (book.lessons || []).forEach(lesson => {
          const gs = book.grammar[lesson.num] || []
          gs.forEach((g, idx) => {
            if (grammarStarred.has(gk(lesson.num, idx, book.bookId))) {
              const gkey = book.bookId + '|' + lesson.num
              if (!gramGroups[gkey]) gramGroups[gkey] = []
              gramGroups[gkey].push({ ...g, bookId: book.bookId, bookTag: book.bookTag, lessonNum: lesson.num, grammarIdx: idx })
            }
          })
        })
      })
      const sortedGramKeys = Object.keys(gramGroups).sort((a, b) => {
        const [bidA, numA] = a.split('|'), [bidB, numB] = b.split('|')
        const oa = BOOKS.findIndex(x => x.bookId === bidA), ob = BOOKS.findIndex(x => x.bookId === bidB)
        if (oa !== ob) return oa - ob
        return Number(numA) - Number(numB)
      })
      let totalGramCount = 0
      sortedGramKeys.forEach(k => { totalGramCount += gramGroups[k].length })

      const total = totalWordCount + totalGramCount
      count.textContent = `共 ${total} 项`

      // 构建学习上下文列表（所有收藏词的扁平列表）
      var starredCtxList = []
      sortedGroupKeys.forEach(function(k) {
        (wordGroups[k] || []).forEach(function(sw) { starredCtxList.push(sw) })
      })
      _studyContextList = starredCtxList

      // 渲染单词（与易错本一致的扁平列表：每张卡片带「书 + 课」小标签）
      vlist.innerHTML = ''
      if (totalWordCount === 0) {
        vlist.innerHTML = '<div style="text-align:center;padding:40px 0;color:var(--text-dim);font-size:14px;">还没有收藏的单词</div>'
      } else {
        starredCtxList.forEach(w => {
          var key2 = wk(w, w.lessonNum)
          var mastered2 = isMastered(w, w.lessonNum)
          var safeKr2 = w.kr.replace(/"/g, '&quot;')
          var localPath2 = 'audio/' + (w.bookId || getCurrentBook().bookId) + '/' + w.lessonNum + '/' + encodeURIComponent(w.kr) + '.mp3'

          const div = document.createElement('div')
          div.className = 'word-item'
          div.setAttribute('data-key', key2)
          div.setAttribute('data-lesson', String(w.lessonNum))
          div.setAttribute('data-book', w.bookId || '')
          div.onclick = function(e) {
            if (e && e.target && e.target.closest && (e.target.closest('.word-speak-btn') || e.target.closest('.word-mastery-badge') || e.target.closest('.word-stars-clickable') || e.target.closest('.word-learn-btn'))) return
            speakLocal(w, w.lessonNum, 'ko')
            div.classList.add('speaking')
            setTimeout(function() { div.classList.remove('speaking') }, 350)
          }
          div.innerHTML =
            '<div class="left-col">' +
              '<div class="kr">' + w.kr + '</div>' +
              '<div style="display:flex;align-items:center;gap:4px;">' +
                '<span class="pos">' + (w.pos || '') + '</span>' +
                '<span class="lesson-tag">' + (w.bookTag || '') + ' 제' + w.lessonNum + '과</span>' +
              '</div>' +
              '<div class="cn">' + w.cn + '</div>' +
            '</div>' +
            '<div class="right-col">' +
              '<span class="word-stars-clickable" data-key="' + key2 + '" title="点击切换收藏" style="color:var(--star);">' +
                '<span class="stars">' + renderStars(5) + '</span>' +
              '</span>' +
              '<div class="word-actions-under-stars">' +
                '<span class="word-speak-btn" title="发音" data-speak="' + safeKr2 + '" data-path="' + localPath2 + '" onclick="event.stopPropagation();speak(this.getAttribute(\'data-speak\'),\'ko\',this.getAttribute(\'data-path\'))">🔊</span>' +
                '<span class="word-mastery-badge ' + (mastered2 ? 'mastered' : 'unmastered') + '" data-key="' + key2 + '" title="点击切换掌握状态">' +
                  (mastered2 ? '✓' : '○') +
                '</span>' +
              '</div>' +
              '<button class="word-learn-btn" onclick="event.stopPropagation();startStudyFromContext(\'' + key2 + '\',\'收藏\',\'page-starred\')">▶ 学习</button>' +
            '</div>'
          vlist.appendChild(div)
        })
      }

      // 渲染语法（按 书|课 分组）
      glist.innerHTML = ''
      if (totalGramCount === 0) {
        glist.innerHTML = '<div style="text-align:center;padding:40px 0;color:var(--text-dim);font-size:14px;">还没有收藏的语法</div>'
      } else {
        sortedGramKeys.forEach(gkey => {
          const [bid, numStr] = gkey.split('|')
          const gs = gramGroups[gkey]
          const book = getBook(bid)
          const lesson = book && book.lessons.find(l => l.num === Number(numStr))
          if (!book || !lesson) return
          const header = document.createElement('div')
          header.style.cssText = 'font-size:13px;font-weight:500;color:var(--primary);margin:16px 0 8px 4px;'
          header.textContent = `${book.bookTag} 제${lesson.num}과 · ${lesson.title} (${gs.length}个)`
          glist.appendChild(header)
          gs.forEach(g => {
            const div = document.createElement('div')
            div.className = 'grammar-card'
            div.style.cursor = 'pointer'
            div.title = '点击展开/收起'

        // 构建完整内容
        var exHtml2 = ''
        if (g.examples) {
          exHtml2 += '<div class="grammar-examples"><div class="ex-title">📝 例句</div>'
          g.examples.forEach(function(ex) {
            exHtml2 += renderGrammarExampleRow(ex, g)
          })
          exHtml2 += '</div>'
        }
        var notesHtml = ''
        if (g.notes) {
          notesHtml = `<div class="grammar-notes"><span class="notes-icon">💡</span> ${g.notes}</div>`
        }

        div.innerHTML = `
          <div class="pattern-row">
            <span class="pattern" style="font-size:16px;">${g.pattern}</span>
            <span class="grammar-star" style="font-size:20px;color:var(--star);">★</span>
          </div>
          <div class="meaning">${g.meaning}</div>
          <div class="formula">${g.formula}</div>
          <div class="starred-grammar-body" style="display:none;margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">
            <div class="explanation" style="font-size:14px;line-height:1.8;">${g.exp}</div>
            ${exHtml2}
            ${notesHtml}
          </div>
        `

        // 星星收藏点击（跨书语法也归到正确书）
        div.querySelector('.grammar-star').onclick = function(e) {
          e.stopPropagation()
          const k = gk(g.lessonNum, g.grammarIdx, g.bookId)
          if (grammarStarred.has(k)) grammarStarred.delete(k)
          else grammarStarred.add(k)
          saveUserData()
          updateStarredCount()
          showStarred() // 刷新收藏列表
        }

        // 整张卡片点击 → 展开/收起
        div.onclick = function(e) {
          if (e.target.closest('.grammar-star')) return
          const body = div.querySelector('.starred-grammar-body')
          const isOpen = body.style.display !== 'none'
          body.style.display = isOpen ? 'none' : 'block'
          // 平滑滚动让内容可见
          if (!isOpen) {
            setTimeout(() => div.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100)
          }
        }

        glist.appendChild(div)
          })
        })
      }

      // 显示/隐藏空状态
      empty.style.display = total === 0 ? 'block' : 'none'

      // 默认显示单词标签
      switchStarTab('vocab')
    }

    let starTabData = { words: [], grammars: [] }

    function switchStarTab(tab) {
      document.getElementById('stab-vocab').classList.toggle('active', tab === 'vocab')
      document.getElementById('stab-grammar').classList.toggle('active', tab === 'grammar')
      document.getElementById('starred-vocab').style.display = tab === 'vocab' ? 'block' : 'none'
      document.getElementById('starred-grammar').style.display = tab === 'grammar' ? 'block' : 'none'
    }

    // 搜索功能
    let searchTimer = null

    function showSearch() {
      var overlay = document.getElementById('search-overlay')
      overlay.style.display = 'flex'
      document.getElementById('search-input').value = ''
      document.getElementById('search-results').innerHTML = ''
      document.getElementById('search-empty').style.display = 'none'
      setTimeout(function() { document.getElementById('search-input').focus() }, 200)
    }

    function closeSearch() {
      document.getElementById('search-overlay').style.display = 'none'
    }

    // ESC 关闭搜索浮层
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        var overlay = document.getElementById('search-overlay')
        if (overlay && overlay.style.display === 'flex') closeSearch()
      }
    })

    // 搜索高亮
    function highlightText(text, query) {
      if (!query) return text
      var escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      var re = new RegExp('(' + escaped + ')', 'gi')
      return text.replace(re, '<mark class="search-highlight">$1</mark>')
    }

    function doSearch() {
      const q = document.getElementById('search-input').value.trim().toLowerCase()
      const results = document.getElementById('search-results')
      const empty = document.getElementById('search-empty')
      const emptyText = document.getElementById('search-empty-text')

      if (!q) {
        results.innerHTML = ''
        empty.style.display = 'none'
        return
      }

      // 搜索所有词汇（韩语 + 中文 + 词性）—— 遍历所有教材
      const hits = []
      BOOKS.forEach(function(book) {
        (book.lessons || []).forEach(function(lesson) {
          const words = book.vocab[lesson.num] || []
          words.forEach(function(w, wi) {
            if (w.kr.includes(q) || w.cn.toLowerCase().includes(q) || w.pos.toLowerCase().includes(q)) {
              hits.push({ kr: w.kr, cn: w.cn, pos: w.pos, stars: w.stars, bookId: book.bookId, bookTag: book.bookTag, lessonNum: lesson.num, lessonTitle: lesson.title, wIdx: wi })
            }
          })
        })
      })

      if (hits.length === 0) {
        results.innerHTML = ''
        empty.style.display = 'block'
        emptyText.textContent = '没有找到包含"' + q + '"的结果'
        return
      }

      empty.style.display = 'none'
      results.innerHTML = ''

      // 设置学习上下文
      _studyContextList = hits

      // 结果计数
      var countDiv = document.createElement('div')
      countDiv.style.cssText = 'font-size:12px;color:var(--text-dim);margin-bottom:8px;grid-column:1/-1;'
      countDiv.textContent = '找到 ' + hits.length + ' 个结果'
      results.appendChild(countDiv)

      hits.forEach(function(w) {
        var key = wk(w, w.lessonNum)
        var mastered = isMastered(w, w.lessonNum)
        var isStar = starred.has(key)
        var localPath = 'audio/' + (w.bookId || getCurrentBook().bookId) + '/' + w.lessonNum + '/' + encodeURIComponent(w.kr) + '.mp3'

        var div = document.createElement('div')
        div.className = 'word-item search-result-item'
        div.setAttribute('data-key', key)
        div.setAttribute('data-lesson', String(w.lessonNum))
        div.onclick = function(e) {
          if (e && e.target && e.target.closest && (e.target.closest('.word-speak-btn') || e.target.closest('.word-mastery-badge') || e.target.closest('.word-stars-clickable') || e.target.closest('.word-learn-btn'))) return
          speakLocal(w, w.lessonNum, 'ko')
          div.classList.add('speaking')
          setTimeout(function() { div.classList.remove('speaking') }, 350)
        }

        var krHtml = highlightText(w.kr, q)
        var cnHtml = highlightText(w.cn, q)
        var starsText = isStar ? renderStars(5) : renderStars(w.stars)
        var starsStyle = isStar ? 'color:var(--star);' : ''
        var safeKr = w.kr.replace(/"/g, '&quot;')
        // 原始索引在收集时已记录（跨书查询不再依赖当前教材 VOCAB）

        div.innerHTML =
          '<div class="left-col">' +
            '<div class="kr">' + krHtml + '</div>' +
            '<span class="pos">' + w.pos + '</span>' +
            '<div class="cn">' + cnHtml + '</div>' +
            '<span class="lesson-tag">' + w.bookTag + ' 제' + w.lessonNum + '과</span>' +
          '</div>' +
          '<div class="right-col">' +
            '<span class="word-stars-clickable" data-key="' + key + '" title="点击切换收藏" style="' + starsStyle + '">' +
              '<span class="stars">' + starsText + '</span>' +
            '</span>' +
            '<div class="word-actions-under-stars">' +
              '<span class="word-speak-btn" title="发音" data-speak="' + safeKr + '" data-path="' + localPath + '" onclick="event.stopPropagation();speak(this.getAttribute(\'data-speak\'),\'ko\',this.getAttribute(\'data-path\'))">🔊</span>' +
              '<span class="word-mastery-badge ' + (mastered ? 'mastered' : 'unmastered') + '" data-key="' + key + '" title="点击切换掌握状态">' +
                (mastered ? '✓' : '○') +
              '</span>' +
            '</div>' +
            '<button class="word-learn-btn" onclick="event.stopPropagation();closeSearch();startStudyFromContext(\'' + key + '\',\'搜索结果\',\'page-home\')">▶ 学习</button>' +
          '</div>'

        results.appendChild(div)
      })
    }

    // 输入框防抖
    document.addEventListener('DOMContentLoaded', function() {
      const input = document.getElementById('search-input')
      if (input) {
        input.addEventListener('input', function() {
          clearTimeout(searchTimer)
          searchTimer = setTimeout(doSearch, 200)
        })
      }
    })

    /* ═══════════════════════════════════════════
       复习模式（新版：按单元分组 + 自选范围）
       ═══════════════════════════════════════════ */

    function _isDue(w, num) {
      var d = srs[wk(w, num)]
      if (!d) return true  // 新词 = 待复习
      return d.due <= Date.now()
    }
    function _isUnmastered(w, num) {
      var d = srs[wk(w, num)]
      if (!d) return true  // 新词 = 未掌握
      return d.lv < 4
    }
    function buildReviewPool(type, lessonNums) {
      const pool = []
      lessonNums.forEach(num => {
        const words = VOCAB[num] || []
        words.forEach(w => {
          var item = {}
          for (var k in w) { if (w.hasOwnProperty(k)) item[k] = w[k] }
          item.lessonNum = num
          if (type === 'all') pool.push(item)
          else if (type === 'due' && _isDue(w, num)) pool.push(item)
          else if (type === 'unmastered' && _isUnmastered(w, num)) pool.push(item)
          else if (type === 'starred' && starred.has(wk(w, num))) pool.push(item)
          else if (type === 'weak' && isWeak(wk(w, num))) pool.push(item)
        })
      })
      return pool
    }

    // 今日到期复习词池：只算学过、未掌握、已到期的词（纯新词不算"复习"）
    function buildDuePool() {
      const pool = []
      LESSONS.forEach(lesson => {
        const num = lesson.num
        const words = VOCAB[num] || []
        words.forEach(w => {
          const d = srs[wk(w, num)]
          if (d && d.lv < 4 && d.due <= Date.now()) {
            const item = {}
            for (var k in w) { if (w.hasOwnProperty(k)) item[k] = w[k] }
            item.lessonNum = num
            pool.push(item)
          }
        })
      })
      return pool
    }

    // 本次学习会话统计（学完收尾提示用）
    var _sessionStats = { forgot: 0, hard: 0, good: 0, easy: 0 }
    var _sessionDoneShown = false
    function resetSessionStats() {
      _sessionStats = { forgot: 0, hard: 0, good: 0, easy: 0 }
      _sessionDoneShown = false
    }
    function recordSessionRate(quality) {
      if (quality === 0) _sessionStats.forgot++
      else if (quality === 1) _sessionStats.hard++
      else if (quality === 2) _sessionStats.good++
      else if (quality === 3) _sessionStats.easy++
    }
    function showStudyDone() {
      if (_sessionDoneShown) return
      _sessionDoneShown = true
      var total = (studyWords && studyWords.length) || 0
      var forgot = _sessionStats.forgot, hard = _sessionStats.hard
      var smooth = _sessionStats.good + _sessionStats.easy
      var el = document.getElementById('study-done-stats')
      var ov = document.getElementById('study-done-overlay')
      if (!el || !ov) return
      var html = '本次共学 <strong>' + total + '</strong> 个词<br>'
      html += '忘记 <strong>' + forgot + '</strong> · 困难 <strong>' + hard + '</strong> · 顺利 <strong>' + smooth + '</strong>'
      if (forgot > 0) html += '<div class="study-done-note">忘记的词已进易错本，很快会再复习</div>'
      el.innerHTML = html
      ov.style.display = 'flex'
    }
    function closeStudyDone() {
      var ov = document.getElementById('study-done-overlay')
      if (ov) ov.style.display = 'none'
    }
    // 学完收尾：停止发音、关闭弹窗、回到首页（学习进度已清空，首页是自然的下一站）
    function finishStudyDone() {
      if (window.speechSynthesis) { try { window.speechSynthesis.cancel() } catch(e) {} }
      closeStudyDone()
      navigateRoot('page-home')
    }

    // 打开易错本列表页
    function showWeakWords() {
      showPage('page-weak')
      renderWeakWords()
    }

    // 底部导航易错本（带页面栈重置）
    function showWeakWordsNav() {
      navigateRoot('page-weak')
      renderWeakWords()
    }

    // 收集所有教材的薄弱词（全局易错本）
    function collectWeakItemsAllBooks() {
      var items = []
      BOOKS.forEach(function(book) {
        (book.lessons || []).forEach(function(l) {
          var ws = book.vocab[l.num] || []
          for (var i = 0; i < ws.length; i++) {
            var w = ws[i]
            var key = wk(w, l.num, book.bookId)
            if (isWeak(key)) {
              var item = {}
              for (var k in w) { if (w.hasOwnProperty(k)) item[k] = w[k] }
              item.bookId = book.bookId
              item.bookTag = book.bookTag
              item.lessonNum = l.num
              item.key = key
              item.origIdx = i
              items.push(item)
            }
          }
        })
      })
      return items
    }

    function renderWeakWords() {
      // 收集所有薄弱词（全局：遍历所有教材）
      var items = collectWeakItemsAllBooks()

      // 更新计数
      document.getElementById('weak-words-count').textContent = '共 ' + items.length + ' 个薄弱词'

      // 设置学习上下文
      _studyContextList = items

      // 空状态
      var emptyEl = document.getElementById('weak-empty')
      var list = document.getElementById('weak-word-list')
      if (items.length === 0) {
        emptyEl.style.display = 'block'
        list.innerHTML = ''
        document.getElementById('weak-study-btn-area').style.display = 'none'
        return
      }
      emptyEl.style.display = 'none'
      document.getElementById('weak-study-btn-area').style.display = ''

      // 扁平渲染 + 单元标签
      list.innerHTML = ''
      items.forEach(function(w) {
        var key = w.key
        var num = w.lessonNum
        var mastered = isMastered(w, num)
        var isStar = starred.has(key)
        var safeKr = w.kr.replace(/"/g, '&quot;')
        var localPath = 'audio/' + (w.bookId || getCurrentBook().bookId) + '/' + num + '/' + encodeURIComponent(w.kr) + '.mp3'

        var div = document.createElement('div')
        div.className = 'word-item'
        div.setAttribute('data-key', key)
        div.setAttribute('data-lesson', String(num))
        div.setAttribute('data-book', w.bookId || '')

        div.onclick = function(e) {
          if (e && e.target && e.target.closest && (e.target.closest('.word-speak-btn') || e.target.closest('.word-mastery-badge') || e.target.closest('.word-stars-clickable') || e.target.closest('.word-learn-btn'))) return
          speakLocal(w, num, 'ko')
          div.classList.add('speaking')
          setTimeout(function() { div.classList.remove('speaking') }, 350)
        }

        var starsText = isStar ? renderStars(5) : renderStars(w.stars)
        var starsStyle = isStar ? 'color:var(--star);' : ''

        div.innerHTML =
          '<div class="left-col">' +
            '<div class="kr">' + w.kr + '</div>' +
            '<div style="display:flex;align-items:center;gap:4px;">' +
              '<span class="pos">' + w.pos + '</span>' +
              '<span class="lesson-tag">' + (w.bookTag || '') + ' 제' + num + '과</span>' +
            '</div>' +
            '<div class="cn">' + w.cn + '</div>' +
          '</div>' +
          '<div class="right-col">' +
            '<span class="word-stars-clickable" data-key="' + key + '" title="点击切换收藏" style="' + starsStyle + '">' +
              '<span class="stars">' + starsText + '</span>' +
            '</span>' +
            '<div class="word-actions-under-stars">' +
              '<span class="word-speak-btn" title="发音" data-speak="' + safeKr + '" data-path="' + localPath + '" onclick="event.stopPropagation();speak(this.getAttribute(\'data-speak\'),\'ko\',this.getAttribute(\'data-path\'))">🔊</span>' +
              '<span class="word-mastery-badge ' + (mastered ? 'mastered' : 'unmastered') + '" data-key="' + key + '" title="点击切换掌握状态">' +
                (mastered ? '✓' : '○') +
              '</span>' +
            '</div>' +
            '<button class="word-learn-btn" onclick="event.stopPropagation();startStudyFromContext(\'' + key + '\',\'易错本\',\'page-weak\')">▶ 学习</button>' +
          '</div>'

        list.appendChild(div)
      })
    }

    // 易错本进入复习（全局：覆盖所有教材的薄弱词）
    function startStudyWeak() {
      var pool = collectWeakItemsAllBooks()
      if (pool.length === 0) { alert('还没有薄弱词！'); return }
      startStudyPool(pool, '薄弱词·易错本')
    }

    function startStudyPool(pool, label) {
      if (pool.length === 0) return
      _studyContextList = pool
      // 复习模式：默认从第一个开始（pool 已随机打乱或保持顺序由调用方决定）
      startStudyFromContext(null, '复习 · ' + label, 'page-home')
    }

    // 键盘支持
    document.addEventListener('keydown', function(e) {
      const studyPage = document.getElementById('page-study')
      if (!studyPage.classList.contains('active')) return

      if (e.key === 'ArrowLeft') prevCard()
      else if (e.key === 'ArrowRight') nextCard()
      else if (e.key === ' ' || e.key === 'Enter') { flipCard(); e.preventDefault() }
    })

    /* ═══════════ 滑动手势 ═══════════ */
    var touchStartX = 0, touchStartY = 0

    var flashcardArea = document.querySelector('.flashcard-area')
    flashcardArea.addEventListener('touchstart', function(e) {
      if (e.touches.length === 1) {
        touchStartX = e.touches[0].clientX
        touchStartY = e.touches[0].clientY
      }
    }, { passive: true })

    flashcardArea.addEventListener('touchend', function(e) {
      // 在卡片上 → 不拦截，让 click/flipCard 和滚动正常处理
      if (e.target.closest('.flashcard')) {
        touchStartX = 0; touchStartY = 0
        return
      }
      if (!touchStartX || !touchStartY) return
      var dx = (e.changedTouches[0] ? e.changedTouches[0].clientX : touchStartX) - touchStartX
      var dy = (e.changedTouches[0] ? e.changedTouches[0].clientY : touchStartY) - touchStartY
      var absDx = Math.abs(dx), absDy = Math.abs(dy)
      var SWIPE_THRESH = 50

      if (absDx < SWIPE_THRESH || absDx < absDy) {
        touchStartX = 0; touchStartY = 0
        return
      }

      if (dx < -SWIPE_THRESH) nextCard()
      else if (dx > SWIPE_THRESH) prevCard()

      touchStartX = 0; touchStartY = 0
    })

