/* ═══════════════════════════════════════════
   app.js · 核心层
   全局状态 / 页面导航 / 首页 / 单词列表 / 设置 / 数据持久化 / 打卡统计
   从 index.html 拆出（v1.10.6）
   依赖：data-books.js / data-yonsei1.js / utils.js / 基础工具脚本（setKeys/lsGet/wk 等）
   加载：须在 study.js / stats.js / quiz.js 之前
   ═══════════════════════════════════════════ */

    let studyWords = []
    let studyIndex = 0
    let isFlipped = false
    let starred = new Set()
    let srs = {}  // SRS数据: { key: { lv, due, ease, n } }
    let grammarStarred = new Set()
    let grammarMastered = new Set()
    let cardDirection = lsGet('ys-carddir', 'kr-first')
    let wordFilter = 'all'  // 单词列表过滤: 'all' | 'unmastered' | 'mastered'

    function masteryCount(num) {
      return (VOCAB[num] || []).filter(function(w) { return isMastered(w, num) }).length
    }

    // 首页随机 emoji 池（只此一份，回到首页 / 启动共用，避免两处维护）
    var HOME_EMOJIS = ['🍨','🥯','🥐','🧇','🛁','💭','🏝️','🌿','🍂','🪺','🐌','💝','🤲🏻','🥹','😸','😺','🩷','💖','💕','💗','🐰','🥺','🎀','✨','☁️','🌷','🧸','🍮','🌙','🕊️','💫','🫶🏻','🐢','🫧','🐽','💤','🥟','🐶','🐰','😵','😴','🥰','🧁','🍕','🍩','🍤','🫨','😽','😼','🐾','🪸','🪽','🌱','🍃','🌵','🍀','🪴','🍔','🍓','🍟','🍦','🍧','🍣','🍰','🧁','🥥','🥑','🧋','🫐','🙌🏻','🫳🏻','🫶🏻','🫰🏻','🩵','🤍','🩶','💞','☃️','❄️','⛈️']

    /* ═══════════════════════════════════════════
       渲染函数
       ═══════════════════════════════════════════ */

    function renderStars(n) {
      var s = ''; for (var i = 0; i < 5; i++) { s += i < n ? '★' : '☆' }; return s
    }
    function renderStarsHTML(n) {
      var s = ''; for (var i = 0; i < 5; i++) { s += i < n ? '<span class="star-on">★</span>' : '<span class="star-off">☆</span>' }; return s
    }

    // 渲染首页「我的教材」书架（已加入教材可学 + 规划中的占位）
    function renderHomeBooks() {
      var list = document.getElementById('home-book-list')
      if (!list) return
      list.innerHTML = ''
      // ① 已加入的教材：可点击进入课程列表，卡上显示每本书的掌握进度
      BOOKS.forEach(function(b) {
        var isCurrent = b.bookId === APP_STATE.currentBookId
        var lessons = b.lessons || []
        var words = 0, done = 0
        // 进度按"这本书自己的 bookId"算（非当前书时不能用全局 wk()，否则 key 会串到当前书）
        Object.keys(b.vocab || {}).forEach(function(k) {
          (b.vocab[k] || []).forEach(function(w) {
            words++
            var d = srs[b.bookId + '|' + k + '|' + w.kr]
            if (d && d.lv >= 4) done++
          })
        })
        var pct = words > 0 ? Math.round((done / words) * 100) : 0
        var item = document.createElement('div')
        item.className = 'home-book-item' + (isCurrent ? ' current' : '')
        item.onclick = function() { onBookClick(b.bookId) }
        var metaText = (b.cn || b.textbook) + ' · ' + lessons.length + '课'
        if (words > 0) metaText += ' · 已掌握 ' + done + '/' + words
        var progressHTML = words > 0
          ? '<div class="hbi-progress"><div class="hbi-progress-fill" style="width:' + pct + '%"></div></div>'
          : ''
        item.innerHTML =
          '<div class="hbi-info"><div class="hbi-title">' + b.textbook + '</div>' +
          '<div class="hbi-meta">' + metaText + '</div>' + progressHTML + '</div>' +
          (isCurrent ? '<span class="hbi-badge">✓ 学习中</span>' : '<span class="hbi-badge">切换</span>')
        list.appendChild(item)
      })
      // ② 规划中的教材：书架占位，内容未加入
      // 已注册进 BOOKS 的跳过（防止忘记从 PLANNED_BOOKS 移除时重复显示）
      var realIds = {}
      BOOKS.forEach(function(b) { realIds[b.bookId] = true })
      PLANNED_BOOKS.forEach(function(p) {
        if (realIds[p.bookId]) return
        var item = document.createElement('div')
        item.className = 'home-book-item planned'
        item.onclick = function() { showToast(p.textbook + ' 即将加入，敬请期待') }
        item.innerHTML =
          '<div class="hbi-info"><div class="hbi-title">' + p.textbook + '</div>' +
          '<div class="hbi-meta">' + p.cn + ' · 内容准备中</div></div>' +
          '<span class="hbi-badge planned">敬请期待</span>'
        list.appendChild(item)
      })
    }

    // 点击书架上的教材：当前教材 → 进课程列表；其他教材 → 切换后进课程列表
    // 切书不再弹确认：学习快照按书保存，切换不丢任何一本书的进度
    function onBookClick(bookId) {
      if (!getBook(bookId)) return
      if (bookId === APP_STATE.currentBookId) {
        renderLessons()
        navigateTo('page-course')
        return
      }
      setCurrentBook(bookId)
      navigateTo('page-course')
    }

    function renderLessons() {
      var l, w, total, done, pct, div, d
      // 课程列表页
      var list = document.getElementById('lesson-list')
      if (list) {
        list.innerHTML = ''
        LESSONS.forEach(function(l) {
          w = VOCAB[l.num] || []
          total = w.length
          done = w.filter(function(x) { var d = srs[wk(x, l.num)]; return d && d.lv >= 4 }).length
          pct = total > 0 ? Math.round((done / total) * 100) : 0
          d = document.createElement('div')
          d.className = 'lesson-item'
          d.onclick = function() { openLesson(l.num) }
          d.innerHTML = '<span class="num">제' + l.num + '과</span><div class="info"><div class="title">' + l.title + '</div><div class="meta">' + l.kr + ' · ' + total + '个词 · 掌握' + done + '个</div></div><div class="stats"><div class="bar-wrap"><div class="bar-fill" style="width:' + pct + '%"></div></div><span class="count">' + done + '/' + total + '</span></div>'
          list.appendChild(d)
        })
      }
    }

    let currentLessonNum = 1

    // 单词列表过滤
    function setWordFilter(f) {
      wordFilter = f
      document.querySelectorAll('#word-filter-bar .tab-btn').forEach(function(b) {
        b.classList.toggle('active', b.getAttribute('data-filter') === f)
      })
      openLesson(currentLessonNum)
    }

    // 打开单词列表
    function openLesson(num, tab) {
      currentLessonNum = num
      const rawWords = VOCAB[num] || []

      // 排序：未掌握在前，已掌握在后
      const words = rawWords.slice()
      words.sort(function(a, b) {
        var aM = isMastered(a, num), bM = isMastered(b, num)
        if (aM && !bM) return 1
        if (!aM && bM) return -1
        return 0
      })

      // 过滤
      var filtered = words
      if (wordFilter === 'unmastered') {
        filtered = words.filter(function(w) { return !isMastered(w, num) })
      } else if (wordFilter === 'mastered') {
        filtered = words.filter(function(w) { return isMastered(w, num) })
      }

      // 标题 + 进度（顶部带短书名，如「연세1 · 제1과 - 소개」）
      document.getElementById('words-title').textContent = getCurrentBook().bookTag + ' · 제' + num + '과 - ' + LESSONS[num-1].title
      var mc = masteryCount(num)
      document.getElementById('words-count').textContent = `共 ${rawWords.length} 个词汇 · 已掌握 ${mc}/${rawWords.length}`

      // 构建学习上下文列表（带 lessonNum）
      var ctxList = []
      filtered.forEach(function(w) {
        var cw = {}; for (var ck in w) { if (w.hasOwnProperty(ck)) cw[ck] = w[ck] }
        cw.lessonNum = num; ctxList.push(cw)
      })
      _studyContextList = ctxList

      // 渲染单词
      const list = document.getElementById('word-list')
      list.innerHTML = ''
      filtered.forEach(function(w) {
        var key = wk(w, num)
        var mastered = isMastered(w, num)
        var isStar = starred.has(key)
        var origIdx = rawWords.indexOf(w)
        var safeKr = w.kr.replace(/"/g, '&quot;')

        var div = document.createElement('div')
        div.className = 'word-item'
        div.setAttribute('data-key', key)
        div.setAttribute('data-lesson', String(num))

        div.onclick = function(e) {
          // 点了操作按钮不触发卡片点击
          if (e && e.target && e.target.closest && (e.target.closest('.word-speak-btn') || e.target.closest('.word-mastery-badge') || e.target.closest('.word-stars-clickable') || e.target.closest('.word-learn-btn'))) return
          // 点击卡片空白处 → 播放读音
          speak(w.kr, 'ko')
          div.classList.add('speaking')
          setTimeout(function() { div.classList.remove('speaking') }, 350)
        }

        var starsText = isStar ? renderStars(5) : renderStars(w.stars)
        var starsStyle = isStar ? 'color:var(--star);' : ''
        div.innerHTML =
          '<div class="left-col">' +
            '<div class="kr">' + w.kr + '</div>' +
            '<span class="pos">' + w.pos + '</span>' +
            '<div class="cn">' + w.cn + '</div>' +
          '</div>' +
          '<div class="right-col">' +
            '<span class="word-stars-clickable" data-key="' + key + '" title="点击切换收藏" style="' + starsStyle + '">' +
              '<span class="stars">' + starsText + '</span>' +
            '</span>' +
            '<div class="word-actions-under-stars">' +
              '<span class="word-speak-btn" title="发音" data-speak="' + safeKr + '" onclick="event.stopPropagation();speak(this.getAttribute(\'data-speak\'),\'ko\')">🔊</span>' +
              '<span class="word-mastery-badge ' + (mastered ? 'mastered' : 'unmastered') + '" data-key="' + key + '" title="点击切换掌握状态">' +
                (mastered ? '✓' : '○') +
              '</span>' +
            '</div>' +
            '<button class="word-learn-btn" onclick="event.stopPropagation();startStudyFromContext(\'' + key + '\',\'제' + num + '과\',\'page-words\')">▶ 学习</button>' +
          '</div>'

        list.appendChild(div)
      })

      // 渲染语法
      renderGrammar(num)

      // 切换到指定标签
      switchLessonTab(tab === 'grammar' ? 'grammar' : 'vocab')
      navigateTo('page-words')
      showHintIfNeeded('word-list')
    }

    // 渲染语法
    function renderGrammar(num) {
      const list = document.getElementById('grammar-list')
      list.innerHTML = ''
      const gs = GRAMMAR[num] || []
      if (gs.length === 0) {
        list.innerHTML = '<p style="text-align:center;padding:40px 0;color:var(--text-dim);font-size:14px;">暂无语法数据</p>'
        return
      }
      gs.forEach((g, idx) => {
        const gkey = gk(num, idx)
        const div = document.createElement('div')
        div.className = 'grammar-card'
        div.id = `grammar-${num}-${idx}`
        div.style.cursor = 'pointer'
        div.title = '点击查看详情'

        // 例句HTML
        var exHtml = ''
        if (g.examples) {
          exHtml += '<div class="grammar-examples"><div class="ex-title">📝 例句</div>'
          g.examples.forEach(function(ex) {
            exHtml += renderGrammarExampleRow(ex, g)
          })
          exHtml += '</div>'
        }

        // 注意说明
        let notesHtml = ''
        if (g.notes) {
          notesHtml = `<div class="grammar-notes"><span class="notes-icon">💡</span> ${g.notes}</div>`
        }

        const isStarred = grammarStarred.has(gkey)
        const isGMastered = grammarMastered.has(gkey)
        div.innerHTML = `
          <div class="pattern-row">
            <span class="pattern">${g.pattern}</span>
            <div style="display:flex;align-items:center;gap:8px;">
              <span class="grammar-master-btn" data-gkey="${gkey}" style="font-size:13px;padding:2px 8px;border-radius:6px;cursor:pointer;color:${isGMastered?'var(--primary)':'var(--text-subtle)'};background:${isGMastered?'var(--primary-light)':'transparent'};border:1px solid ${isGMastered?'var(--primary)':'var(--border)'};transition:all 0.2s;">${isGMastered ? '✓ 已掌握' : '标记掌握'}</span>
              <span class="grammar-star" data-gkey="${gkey}">${isStarred ? '★' : '☆'}</span>
            </div>
          </div>
          <div class="meaning">${g.meaning}</div>
          <div class="formula">${g.formula}</div>
          <div class="explanation">${g.exp}</div>
          ${exHtml}
          ${notesHtml}
        `

        // 收藏点击
        div.querySelector('.grammar-star').onclick = function(e) {
          e.stopPropagation()
          const k = this.dataset.gkey
          if (grammarStarred.has(k)) grammarStarred.delete(k)
          else grammarStarred.add(k)
          this.textContent = grammarStarred.has(k) ? '★' : '☆'
          popEl(this)
          saveUserData()
          updateStarredCount()
        }

        // 语法掌握切换
        div.querySelector('.grammar-master-btn').onclick = function(e) {
          e.stopPropagation()
          const k = this.dataset.gkey
          if (grammarMastered.has(k)) grammarMastered.delete(k)
          else grammarMastered.add(k)
          saveUserData()
          // 刷新此卡片显示
          const isM = grammarMastered.has(k)
          this.textContent = isM ? '✓ 已掌握' : '标记掌握'
          this.style.color = isM ? 'var(--primary)' : 'var(--text-subtle)'
          this.style.background = isM ? 'var(--primary-light)' : 'transparent'
          this.style.borderColor = isM ? 'var(--primary)' : 'var(--border)'
          popEl(this)
        }

        // 整张卡片点击 → 滚动到此语法并高亮
        div.onclick = function(e) {
          // 如果点的是星星，不处理（上面已处理）
          if (e.target.closest('.grammar-star')) return
          // 确保在语法 Tab
          switchLessonTab('grammar')
          // 滚动到这张卡片
          div.scrollIntoView({ behavior: 'smooth', block: 'center' })
          // 高亮闪烁
          div.style.transition = 'box-shadow 0.3s'
          div.style.boxShadow = '0 0 0 3px var(--primary)'
          setTimeout(() => { div.style.boxShadow = '' }, 1500)
        }

        list.appendChild(div)
      })
    }

    // 单词/语法标签切换
    function switchLessonTab(tab) {
      document.getElementById('tab-vocab').classList.toggle('active', tab === 'vocab')
      document.getElementById('tab-grammar').classList.toggle('active', tab === 'grammar')
      document.getElementById('lesson-vocab').style.display = tab === 'vocab' ? 'block' : 'none'
      document.getElementById('lesson-grammar').style.display = tab === 'grammar' ? 'block' : 'none'
      // 掌握状态过滤栏只属于单词 Tab；语法 Tab 下隐藏，避免误导（点了还会跳回单词页）
      var fb = document.getElementById('word-filter-bar')
      if (fb) fb.style.display = tab === 'vocab' ? '' : 'none'
    }

    // 更新首页统计
    function updateHomeStats() {
      var totalWords = 0, dueCount = 0, learningCount = 0, masteredCount = 0, starredCount = 0, weakCount = 0
      var now = Date.now()
      LESSONS.forEach(function(l) {
        var words = VOCAB[l.num] || []
        words.forEach(function(w) {
          totalWords++
          var key = wk(w, l.num)
          var d = srs[key]
          if (starred.has(key)) starredCount++
          if (d) {
            if (d.lv >= 4) masteredCount++
            else if (d.lv >= 1) learningCount++
            if (d.due <= now) dueCount++
          } else {
            dueCount++  // 新词也算待复习
          }
          if (isWeak(key)) weakCount++
        })
      })
      // 进度条：只算已掌握（与每课进度条口径一致，数字与条形完全对应）
      var pct = totalWords > 0 ? Math.round((masteredCount / totalWords) * 100) : 0

      // 更新首页元素
      var el
      el = document.getElementById('home-total'); if (el) el.textContent = totalWords
      el = document.getElementById('home-mastered'); if (el) el.textContent = masteredCount
      el = document.getElementById('home-pct'); if (el) el.textContent = pct + '%'
      el = document.getElementById('home-progress-fill'); if (el) el.style.width = pct + '%'
      renderHomeBooks()
      updateContinueBtn()
      updateStarredCount()
    }

    function updateStarredCount() {
      var el = document.getElementById('starred-count-badge')
      if (!el) return
      var total = starred.size + grammarStarred.size
      el.textContent = total
      if (total === 0) el.setAttribute('data-zero', 'true')
      else el.removeAttribute('data-zero')
    }

    /* ═══════════════════════════════════════════
       页面切换
       ═══════════════════════════════════════════ */

    // page id → URL hash 映射
    var PAGE_HASH = {
      'page-home': 'home', 'page-course': 'course', 'page-words': 'words',
      'page-study': 'study', 'page-starred': 'starred', 'page-weak': 'weak',
      'page-settings': 'settings', 'page-quiz': 'quiz', 'page-stats': 'stats'
    }
    var HASH_PAGE = {}
    Object.keys(PAGE_HASH).forEach(function(k) { HASH_PAGE[PAGE_HASH[k]] = k })

    function showPage(id) {
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
      document.getElementById(id).classList.add('active')
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'))
      document.querySelector(`.nav-item[data-page="${id}"]`)?.classList.add('active')
      window.scrollTo({ top: 0, behavior: 'smooth' })
      // 除学习/测验模式外显示底部导航
      if (id !== 'page-study' && id !== 'page-quiz') showNav()
      // 更新 URL hash + 浏览器历史（用于返回键和刷新定位）
      var newHash = PAGE_HASH[id] || 'home'
      if (location.hash !== '#' + newHash) {
        // 从 popstate 来的不用再推，只替换；正常导航才推一条
        if (_fromPopstate) {
          history.replaceState({ page: id }, '', '#' + newHash)
        } else {
          history.pushState({ page: id }, '', '#' + newHash)
        }
      }
      // 回到首页时刷新统计数据 + 随机 emoji
      if (id === 'page-home') {
        var he = document.getElementById('home-emoji')
        if (he) he.textContent = HOME_EMOJIS[Math.floor(Math.random() * HOME_EMOJIS.length)]
        // 刷新时段问候和鼓励语
        var now = new Date(); var hh = now.getHours()
        var gtEl = document.getElementById('greeting-text')
        if (hh < 12) gtEl.textContent = '좋은 아침'
        else if (hh < 18) gtEl.textContent = '좋은 오후'
        else gtEl.textContent = '좋은 저녁'
        document.getElementById('greeting-sub').textContent = greetings[Math.floor(Math.random() * greetings.length)]
        updateHomeStats()
        renderTodaySummary()
        renderLessons()
      }
      // 进入课程页时更新统计
      if (id === 'page-course') {
        var tWords = 0; LESSONS.forEach(function(l) { (VOCAB[l.num]||[]).forEach(function() { tWords++ }) })
        var el1 = document.getElementById('course-count'); if (el1) el1.textContent = LESSONS.length
        var el2 = document.getElementById('course-words'); if (el2) el2.textContent = tWords
      }
    }

    /* ═══════════ 页面栈（统一返回逻辑）══════════ */
    var _pageStack = []
    var _currentPage = 'page-home'

    // 向前导航：推入栈
    function navigateTo(pageId) {
      _pageStack.push(_currentPage)
      _currentPage = pageId
      showPage(pageId)
    }

    // 返回上一页：弹出栈并回退浏览器历史
    function goBack() {
      if (_pageStack.length > 0) {
        _currentPage = _pageStack.pop()
        history.back()
      } else {
        navigateRoot('page-home')
      }
    }

    // 底部导航 / 重置路径
    function navigateRoot(pageId) {
      _pageStack = []
      _currentPage = pageId
      showPage(pageId)
    }

    /* ═══════════ 时段问候 ═══════════ */
    var _now = new Date()
    var hour = _now.getHours()
    var gt = document.getElementById('greeting-text')
    var gs = document.getElementById('greeting-sub')
    var gd = document.getElementById('greeting-date')

    var greetings = [
      '每天进步一点点，积累就是奇迹 🐣',
      '今天也是努力学习的一天，真棒 🩷',
      '你已经比昨天的自己更厉害了 🐰',
      '每一个坚持的日子，都在闪闪发光 🎀',
      '慢慢来，比较快 🐢💨',
      '不怕慢，就怕站，今天又前进了一步 🐾',
      '学习是给自己的礼物，拆开就是惊喜 🎁',
      '今天的付出，明天都会开花 🌸',
      '你认真学韩语的样子，真的很可爱 ૮₍˶ᵔ ᵕ ᵔ˶₎ა',
      '每次翻一张卡片，离流利又近了一点 🃏',
      '完成比完美更重要，打开就是胜利 🏆',
      '한 걸음씩 천천히～一步一步，慢慢地 🐌',
      '学习不是赛跑，是和自己和解的旅程 🧸',
      '能坚持到现在，你已经赢了一半 🌷',
      '每次点开这个页面，就是一次自律的胜利 🎯',
      '不跟别人比，只跟昨天的自己比 🎈',
      '学习很苦，但坚持很可爱 ૮ ˙Ⱉ˙ ა',
      '今天的努力是明天的底气 📚',
      '没有什么比坚持更让人佩服 🌻',
      '每天学一点点，时间会给你答案 ⭐',
      '한국어 공부 재미있어요! 韩语其实很有趣 🐻',
      '总有一天，看韩剧不用字幕 📺',
      '想象一下，在首尔街头用韩语点餐的样子 🍜',
      '김치, 불고기, 비빔밥…学韩语才能吃得更香 🍚',
      '每一个韩语单词，都是一扇了解韩国的窗 🪟',
      'K-pop 听懂了，才知道歌词写得多美 🎶',
      '说不定哪天在韩国咖啡店就派上用场了 🧋',
      '韩语学会了，看韩综笑点翻倍 😆',
      '한글은 정말 아름다워요～韩文真的很美 🫧',
      '语言是桥，韩语是通往新世界的桥 🌈',
      '会韩语的人，看世界的角度都不一样 👀',
      '延世韩国语1学完，首尔自由行毫无压力 🐥',
      '韩国朋友会惊讶你韩语说得这么好 (*≧ω≦)',
      '每一课学完，就是打开一个新世界 🗺️',
      '韩语是离我们最近的外语，学起来事半功倍 🎓',
      '오늘도 파이팅! 🔥',
      '힘내세요～加油呀 💙',
      '잘하고 있어요! 你做得很好 🩵',
      '자신 있게! 自信一点！🍀',
      '괜찮아요, 천천히～没关系，慢慢来 🫶',
      '할 수 있어요! 你可以的！🐶',
      '한 번 더! 再来一次！🔄',
      '조금만 더! 再坚持一下！⚡',
      '포기하지 마세요～不要放弃 🤗',
      '내일도 같이 공부해요! 明天也一起学习吧 🫧',
      '지금이 제일 좋은 시간! 现在就是最好的时间 ⏳',
      '행복한 하루 보내세요～度过幸福的一天 💝',
      '오늘도 수고했어요! 今天也辛苦了 🫶',
      '작은 성공이 큰 변화를 만듭니다 小成功造大改变 🦋',
      '시작이 반이다! 开始就成功了一半！🚀',
      '雨天适合窝在房间背单词 ☔📖',
      '阳光正好，心情正好，学习正好 ☀️',
      '耳机里放着韩语歌，手里翻着单词卡 🎧',
      '今天喝什么？커피? 차? 边喝边学 🥤',
      '周末也要保持手感，哪怕只翻 5 张卡 📅',
      '通勤路上，排队等待，碎片时间就是黄金时间 ⏱️',
      '一个人的自习时光，安静而美好 📔',
      '书桌收拾干净，心也跟着静下来 🕯️',
      '学习累了就站起来走走，回来继续 🐾',
      '每一天都是一个新的开始 🌅'
    ]

    var pick = greetings[Math.floor(Math.random() * greetings.length)]
    if (hour < 12) { gt.textContent = '좋은 아침' }
    else if (hour < 18) { gt.textContent = '좋은 오후' }
    else { gt.textContent = '좋은 저녁' }
    gs.textContent = pick

    /* ═══════════ 学习日 + 连续天数 ═══════════ */
    // 凌晨 2:00 分界：0:00-1:59 算前一天
    function getStudyDay(now) {
      var d = new Date(now || Date.now())
      if (d.getHours() < 2) d.setDate(d.getDate() - 1)
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    }

    function loadStreak() {
      try {
        var raw = lsGet('ys-streak', '')
        if (raw) return JSON.parse(raw)
      } catch(e) {}
      return { date: '', count: 0 }
    }

    function saveStreak(s) { lsSet('ys-streak', JSON.stringify(s)) }

    function markStudyDay() {
      var today = getStudyDay()
      var streak = loadStreak()
      if (streak.date === today) return  // 今天已标记

      var yesterday = getStudyDay(Date.now() - 24 * 60 * 60 * 1000)
      if (streak.date === yesterday) {
        streak.count += 1
      } else {
        streak.count = 1
      }
      streak.date = today
      saveStreak(streak)
      renderDateLine()
    }

    function renderDateLine() {
      var gdEl = document.getElementById('greeting-date')
      if (!gdEl) return
      var now = new Date()
      var days = ['日','一','二','三','四','五','六']
      var text = now.getFullYear() + '年' + (now.getMonth()+1) + '月' + now.getDate() + '日 · 星期' + days[now.getDay()]
      var streak = loadStreak()
      if (streak.count >= 2 && streak.date === getStudyDay()) {
        text += ' · 🔥 连续 ' + streak.count + ' 天'
      }
      gdEl.textContent = text
    }

    // 初始化日期行
    renderDateLine()

    /* ═══════════ 今日小结 ═══════════ */
    var POSITIVE_FEEDBACK = [
      '잘하고 있어요! 你做得很好 🩵', '오늘도 수고했어요! 今天也辛苦了 🫶',
      '今天的付出，明天都会开花 🌸', '完成比完美更重要 🏆',
      '할 수 있어요! 你可以的！🐶', '每天进步一点点，积累就是奇迹 🐣',
      '자신 있게! 自信一点！🍀', '你已经比昨天的自己更厉害了 🐰',
      '작은 성공이 큰 변화를 만듭니다 🦋', '오늘도 파이팅! 🔥'
    ]

    /* ═══════════ 每日学习日志（持久化统计）═══════════ */
    function loadDailyLog() {
      try {
        var raw = lsGet('ys-daily-log', '')
        if (raw) return JSON.parse(raw)
      } catch(e) {}
      return {}
    }

    function saveDailyLog(log) { lsSet('ys-daily-log', JSON.stringify(log)) }

    // 今天的日志条目（不存在则初始化，返回 log 引用便于直接改）
    function todayLogEntry() {
      var log = loadDailyLog()
      var day = getStudyDay()
      if (!log[day]) log[day] = { words: 0, quizRounds: 0, quizTotal: 0, quizCorrect: 0, mastered: 0, masteredKeys: [], studiedKeys: [] }
      return { log: log, entry: log[day] }
    }

    function loadTodaySummary() {
      var today = getStudyDay()
      var log = loadDailyLog()
      var e = log[today] || { words: 0, quizRounds: 0, quizTotal: 0, quizCorrect: 0, mastered: 0, masteredKeys: [], studiedKeys: [] }
      return { date: today, studyWords: e.words, quizRounds: e.quizRounds, quizTotal: e.quizTotal, quizCorrect: e.quizCorrect, mastered: e.mastered || 0, masteredKeys: e.masteredKeys || [] }
    }

    // 记录某词"今天学过"（去重：今天只看过一遍的词算 1 个，反复看不重复累加）
    function markWordStudied(key) {
      var t = todayLogEntry()
      var keys = t.entry.studiedKeys || (t.entry.studiedKeys = [])
      if (keys.indexOf(key) === -1) {
        keys.push(key)
        t.entry.words = (t.entry.words || 0) + 1
        saveDailyLog(t.log)
      }
    }

    function addQuizSummary(score, total) {
      var t = todayLogEntry()
      t.entry.quizRounds += 1
      t.entry.quizTotal += total
      t.entry.quizCorrect += score
      saveDailyLog(t.log)
    }

    // 记录某词"成为已掌握"（成果事件：当天计入 mastered，词条盖日期戳）
    function markMastered(key) {
      var d = srs[key]
      if (d) d.masteredAt = getStudyDay()
      var t = todayLogEntry()
      var keys = t.entry.masteredKeys || (t.entry.masteredKeys = [])
      if (keys.indexOf(key) === -1) {
        keys.push(key)
        t.entry.mastered = (t.entry.mastered || 0) + 1
        saveDailyLog(t.log)
      }
    }

    // 清除某词的"已掌握日期"（测验降级等词条仍在的场合；手动取消掌握会直接删词条，无需调用）
    function unmarkMastered(key) {
      var d = srs[key]
      if (d && d.masteredAt) delete d.masteredAt
    }

    function renderTodaySummary() {
      var s = loadTodaySummary()
      var el = document.getElementById('today-summary')
      var textEl = document.getElementById('today-summary-text')
      if (!el || !textEl) return
      if (s.studyWords === 0 && s.quizRounds === 0) {
        el.style.display = 'none'
        return
      }
      var fb = POSITIVE_FEEDBACK[Math.floor(Math.random() * POSITIVE_FEEDBACK.length)]
      var parts = []
      if (s.studyWords > 0) parts.push('📖 学了 <strong>' + s.studyWords + '</strong> 个词')
      if (s.quizRounds > 0) {
        var pct = s.quizTotal > 0 ? Math.round(s.quizCorrect / s.quizTotal * 100) : 0
        parts.push('✅ 测验 <strong>' + s.quizCorrect + '/' + s.quizTotal + '</strong>（' + pct + '%）')
      }
      textEl.innerHTML = fb + ' · ' + parts.join(' · ')
      el.style.display = 'flex'
    }

    /* ═══════════════════════════════════════════
       LocalStorage 保存
       ═══════════════════════════════════════════ */

    function saveUserData() {
      const data = {
        starred: setKeys(starred),
        srs: srs,
        grammarStarred: setKeys(grammarStarred),
        grammarMastered: setKeys(grammarMastered),
      }
      try {
        lsSet('yonsei-study-data', JSON.stringify(data))
      } catch(e) {}
    }

    function loadUserData() {
      try {
        const raw = lsGet('yonsei-study-data', null)
        if (raw) {
          // 迁移前备份一份原始数据（仅首次备份，不覆盖，便于异常时还原）
          if (!lsGet('yonsei-study-data-backup', null)) lsSet('yonsei-study-data-backup', raw)

          const data = JSON.parse(raw)
          starred = new Set(data.starred || [])
          grammarStarred = new Set(data.grammarStarred || [])
          grammarMastered = new Set(data.grammarMastered || [])

          // SRS 数据迁移：如果有 srs 直接用，否则从旧 mastered 迁移
          if (data.srs && typeof data.srs === 'object') {
            srs = data.srs
          } else if (data.mastered && Array.isArray(data.mastered)) {
            // 旧版 mastered → SRS 迁移
            var now = Date.now()
            srs = {}
            data.mastered.forEach(function(key) {
              srs[key] = { lv: 3, due: now, ease: 2.5, n: 3 }
            })
          } else {
            srs = {}
          }

          // 书 ID 迁移：早期编号没带书前缀（如 3|가족），统一升级为 yonsei1|3|가족
          migrateBookIdKeys()
          // 多教材迁移：为新旧数据补全"所属教材"信息（幂等，不删任何数据）
          migrateMultiBook()
        }
      } catch(e) {}
    }

    // 幂等迁移：已是「书ID|…」开头的 key 直接保留，否则补上书前缀
    // 覆盖四块数据：掌握进度 srs / 单词收藏 starred / 语法收藏 grammarStarred / 语法掌握 grammarMastered
    function migrateBookIdKeys() {
      var prefix = APP_CONFIG.defaultBookId + '|'   // 早期数据无书号，一律归属默认书（延世1）
      var changed = false
      function fix(k) {
        if (typeof k === 'string' && k.indexOf(prefix) === 0) return k
        changed = true
        return prefix + k
      }
      var nsrs = {}
      for (var k in srs) nsrs[fix(k)] = srs[k]
      srs = nsrs
      function fixAll(set) {
        var out = []
        set.forEach(function(k) { out.push(fix(k)) })
        return new Set(out)
      }
      if (changed) {
        starred = fixAll(starred)
        grammarStarred = fixAll(grammarStarred)
        grammarMastered = fixAll(grammarMastered)
        saveUserData()
      }
    }

    // 多教材迁移（幂等）：为老数据补全"所属教材"信息，老数据一律归属默认书（延世1）
    function migrateMultiBook() {
      // ① 当前教材：首次无记录 → 默认书
      if (!lsGet('ys-current-book', null)) lsSet('ys-current-book', APP_CONFIG.defaultBookId)
      // ② 测验历史补书号：旧记录默认属延世1
      var rawQ = lsGet('quiz-history', '')
      if (rawQ) {
        try {
          var qh = JSON.parse(rawQ)
          var qChanged = false
          for (var i = 0; i < qh.length; i++) {
            if (qh[i] && !qh[i].bookId) { qh[i].bookId = APP_CONFIG.defaultBookId; qChanged = true }
          }
          if (qChanged) lsSet('quiz-history', JSON.stringify(qh))
        } catch(e) {}
      }
      // ③ 学习进度快照：旧格式（单个快照）→ 按书映射 { [bookId]: 快照 }（旧快照归属默认书）
      var rawP = lsGet('ys-study-progress', '')
      if (rawP) {
        try {
          var sp = JSON.parse(rawP)
          if (sp && Array.isArray(sp.words)) {
            var snapMap = {}
            snapMap[sp.bookId || APP_CONFIG.defaultBookId] = {
              words: sp.words,
              index: sp.index || 0,
              title: sp.title || '',
              fromPage: sp.fromPage || 'page-home'
            }
            lsSet('ys-study-progress', JSON.stringify(snapMap))
          }
        } catch(e) {}
      }
      // ④ 上次所学按书隔离：旧单键 `ys-last-lesson` → `ys-last-lesson-<默认书号>`（老记录归属延世1）
      var oldLast = lsGet('ys-last-lesson', null)
      if (oldLast !== null && lsGet('ys-last-lesson-' + APP_CONFIG.defaultBookId, null) === null) {
        lsSet('ys-last-lesson-' + APP_CONFIG.defaultBookId, oldLast)
      }
    }

    // 切书状态清理协议：切换教材时清空"内存中的"学习/测验会话
    // （磁盘上的学习快照按书保存，切书不删——回来自动恢复，换书零丢失）
    function clearBookSessionState() {
      // 学习会话（study.js 会话状态，运行时才访问）
      _studyContextList = null
      studyWords = []
      studyIndex = 0
      studyFromPage = 'page-home'
      // 测验会话（quiz.js 会话状态）
      quizQuestions = []
      quizIndex = 0
      quizScore = 0
      if (typeof quizSelectedLessons !== 'undefined' && quizSelectedLessons) quizSelectedLessons.clear()
    }

    // 设置当前教材：更新状态 → 持久化 → 重绑数据 → 清理会话 → 刷新相关页面
    function setCurrentBook(bookId) {
      if (!getBook(bookId) || bookId === APP_STATE.currentBookId) return
      APP_STATE.currentBookId = bookId
      lsSet('ys-current-book', bookId)
      bindBookGlobals()
      clearBookSessionState()
      refreshBookTitles()
      renderLessons()
      updateHomeStats()
    }

    // 刷新显示书名的元素（课程页标题/副标题；首页书架由 renderHomeBooks 渲染）
    function refreshBookTitles() {
      var cb = getCurrentBook(); if (!cb) return
      var cbt = document.getElementById('course-book-title'); if (cbt) cbt.textContent = cb.textbook
      var cbc = document.getElementById('course-book-cn'); if (cbc) cbc.textContent = cb.cn || ''
    }

    // 在单词列表加"开始学习"按钮
    const origOpenLesson = openLesson
    openLesson = function(num) {
      origOpenLesson(num)
      lsSet('ys-last-lesson-' + getCurrentBook().bookId, String(num))
      // 在单词列表顶部加学习按钮 + 全部标记掌握
      const header = document.querySelector('#page-words .page-header')
      const existing = document.getElementById('study-btn-area')
      if (existing) existing.remove()

      const btnArea = document.createElement('div')
      btnArea.id = 'study-btn-area'
      btnArea.style.cssText = 'margin-bottom:16px;'

      // 说明当前筛选范围（放按钮上方，左对齐）
      var studyHint = document.createElement('div')
      studyHint.className = 'ui-hint'
      studyHint.textContent = '学习当前筛选的 ' + (_studyContextList ? _studyContextList.length : 0) + ' 个词'
      btnArea.appendChild(studyHint)

      // 开始学习按钮
      const btn = document.createElement('button')
      btn.textContent = '▶ 开始学习'
      btn.style.cssText = `
        width:100%; padding:14px; border:none; border-radius:12px;
        background:var(--primary); color:white;
        font-family:var(--font-display); font-size:16px; font-weight:500;
        cursor:pointer; transition:opacity 0.2s;
      `
      btn.onmouseover = function() { btn.style.opacity = '0.9' }
      btn.onmouseout = function() { btn.style.opacity = '1' }
      // 学当前筛选的词（_studyContextList 由 openLesson 设为过滤后的列表）
      btn.onclick = function() { startStudyFromContext(null, '제' + num + '과', 'page-words') }
      btnArea.appendChild(btn)

      // 全部标记/取消掌握按钮（智能切换）
      var allMastered = (VOCAB[num] || []).every(function(w) { return isMastered(w, num) })
      var markBtn = document.createElement('button')
      markBtn.id = 'mark-all-mastered-btn'

      if (allMastered) {
        markBtn.textContent = '↩ 取消全部已掌握'
        markBtn.style.cssText = 'margin-top:8px;width:100%;padding:10px;border:1px solid var(--accent-pink);border-radius:10px;background:var(--accent-pink-light);color:var(--accent-pink);cursor:pointer;font-family:var(--font-display);font-size:14px;transition:all 0.2s;'
        markBtn.onclick = function() {
          if (!confirm('确定将本课所有词汇恢复为"未掌握"吗？')) return
          ;(VOCAB[num] || []).forEach(function(w2) {
            delete srs[wk(w2, num)]
          })
          saveUserData()
          updateHomeStats()
          renderLessons()
          openLesson(num)
        }
      } else {
        markBtn.textContent = '✓ 本课全部标记为掌握'
        markBtn.onclick = function() {
          if (!confirm('确定将本课所有词汇标记为"已掌握"吗？')) return
          var now = Date.now()
          ;(VOCAB[num] || []).forEach(function(w2) {
            var key2 = wk(w2, num)
            var d2 = srs[key2]
            srs[key2] = { lv: 4, due: now + 21*86400000, ease: 2.5, n: (d2 ? d2.n + 1 : 1), badCount: 0 }
            markMastered(key2)
          })
          saveUserData()
          updateHomeStats()
          renderLessons()
          openLesson(num)
        }
      }
      btnArea.appendChild(markBtn)

      header.after(btnArea)
    }

    /* ═══════════════════════════════════════════
       设置功能
       ═══════════════════════════════════════════ */

    // ─── 卡片方向 ───
    // ─── 新手提示 ───
    function dismissHint(name) {
      lsSet('hint-' + name, '1')
      var el = document.getElementById(name + '-hint')
      if (el) el.style.display = 'none'
    }

    function showHintIfNeeded(name) {
      if (lsGet('hint-' + name, '0') === '1') return
      var el = document.getElementById(name + '-hint')
      if (el) el.style.display = 'block'
    }

    // ─── 主题模式 ───
    var _themeMedia = window.matchMedia('(prefers-color-scheme: dark)')

    function applyTheme() {
      var mode = lsGet('ys-theme', 'auto')
      if (mode === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark')
      } else if (mode === 'auto' && _themeMedia.matches) {
        document.documentElement.setAttribute('data-theme', 'dark')
      } else {
        document.documentElement.removeAttribute('data-theme')
      }
      updateThemeButtons(mode)
    }

    function setTheme(mode) {
      lsSet('ys-theme', mode)
      applyTheme()
    }

    function updateThemeButtons(mode) {
      var btns = { 'auto': 'theme-auto', 'light': 'theme-light', 'dark': 'theme-dark' }
      for (var k in btns) {
        if (!btns.hasOwnProperty(k)) continue
        var el = document.getElementById(btns[k])
        if (!el) continue
        if (k === mode) {
          el.style.background = 'var(--primary-light)'
          el.style.color = 'var(--primary)'
        } else {
          el.style.background = 'transparent'
          el.style.color = 'var(--text)'
        }
      }
    }

    // 监听系统主题变化（仅在 auto 模式下生效）
    _themeMedia.addEventListener('change', function() {
      if (lsGet('ys-theme', 'auto') === 'auto') {
        applyTheme()
      }
    })

    function setCardDir(dir) {
      cardDirection = dir
      lsSet('ys-carddir', dir)
      document.getElementById('carddir-kr').style.background = dir === 'kr-first' ? 'var(--primary-light)' : 'transparent'
      document.getElementById('carddir-kr').style.color = dir === 'kr-first' ? 'var(--primary)' : 'var(--text)'
      document.getElementById('carddir-cn').style.background = dir === 'cn-first' ? 'var(--primary-light)' : 'transparent'
      document.getElementById('carddir-cn').style.color = dir === 'cn-first' ? 'var(--primary)' : 'var(--text)'
    }

    // ─── TTS 语速 ───
    function updateTtsRate(val) {
      lsSet('ys-tts-rate', val)
      const labels = { '0.5':'很慢', '0.65':'慢', '0.75':'较慢', '0.85':'正常', '0.95':'较快', '1.05':'快', '1.2':'很快' }
      const label = labels[val] || val
      document.getElementById('tts-rate-label').textContent = label + ' (' + val + ')'
    }

    // ─── 数据导出/导入/清除 ───
    // 收集本应用相关的全部本地存储 key（原始字符串，保证跨教材完整还原）
    function collectAppStorageKeys() {
      var keys = []
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i)
          if (k && (k === 'quiz-history' || k === 'yonsei-study-data' || k === 'yonsei-study-data-backup' || k.indexOf('ys-') === 0)) {
            keys.push(k)
          }
        }
      } catch(e) {}
      return keys
    }

    function exportData() {
      // 全量备份：所有相关 key 的原始内容（学习/测验/打卡/连续/设置/进度快照，含各教材）
      var store = {}
      collectAppStorageKeys().forEach(function(k) {
        try { store[k] = localStorage.getItem(k) } catch(e) {}
      })
      var data = {
        app: 'daily-hangul-backup',
        format: 1,
        version: APP_CONFIG.version,
        exportedAt: new Date().toISOString(),
        store: store,
        // 兼容字段：老版本导入器仍能读取
        starred: setKeys(starred),
        srs: srs,
        grammarStarred: setKeys(grammarStarred),
        grammarMastered: setKeys(grammarMastered),
        cardDirection: cardDirection,
      }
      var jsonStr = JSON.stringify(data, null, 2)
      var blob = new Blob([jsonStr], { type: 'application/json' })
      var url = URL.createObjectURL(blob)
      var a = document.createElement('a')
      a.href = url
      a.download = '每日韩语-备份-' + new Date().toISOString().slice(0, 10) + '.json'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(function() { URL.revokeObjectURL(url) }, 1000)
      showToast('📤 下载中...')
    }

    // 给元素一个"弹一下"的视觉反馈
    function popEl(el) {
      if (!el) return
      el.classList.add('pop')
      setTimeout(function() { el.classList.remove('pop') }, 300)
    }

    function showToast(msg) {
      var t = document.getElementById('ys-toast')
      if (!t) { t = document.createElement('div'); t.id = 'ys-toast'; t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--text);color:var(--bg);padding:10px 20px;border-radius:20px;font-size:14px;z-index:99999;pointer-events:none;transition:opacity 0.3s;'; document.body.appendChild(t) }
      t.textContent = msg; t.style.opacity = '1'
      clearTimeout(t._timer); t._timer = setTimeout(function() { t.style.opacity = '0' }, 2000)
    }

    function importData() {
      var input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json'
      input.onchange = function() {
        var file = input.files[0]
        if (!file) return
        var reader = new FileReader()
        reader.onload = function(e) {
          try {
            var data = JSON.parse(e.target.result)
            if (data.store && typeof data.store === 'object') {
              // 新格式全量备份：覆盖所有本地数据后整页刷新（各模块从 localStorage 重新读取）
              if (!confirm('导入会覆盖当前所有学习数据（两本教材的进度、收藏、测验历史、打卡记录等）。\n确定继续吗？')) return
              var keys = Object.keys(data.store)
              keys.forEach(function(k) {
                if (k === 'quiz-history' || k === 'yonsei-study-data' || k === 'yonsei-study-data-backup' || k.indexOf('ys-') === 0) {
                  lsSet(k, data.store[k])
                }
              })
              alert('✅ 导入成功！数据已恢复，正在刷新…')
              setTimeout(function() { location.reload() }, 300)
              return
            }
            // 旧格式（只有记忆字段的备份）：兼容导入
            if (!confirm('导入会覆盖当前所有学习数据。确定继续吗？')) return
            if (data.starred) starred = new Set(data.starred)
            if (data.grammarStarred) grammarStarred = new Set(data.grammarStarred)
            if (data.grammarMastered) grammarMastered = new Set(data.grammarMastered)
            if (data.cardDirection) cardDirection = data.cardDirection
            // SRS: 新格式直接用，旧mastered格式迁移
            if (data.srs && typeof data.srs === 'object') {
              srs = data.srs
            } else if (data.mastered && Array.isArray(data.mastered)) {
              var now = new Date().getTime()
              srs = {}
              data.mastered.forEach(function(key) {
                srs[key] = { lv: 3, due: now, ease: 2.5, n: 3 }
              })
            }
            // 导入的备份若是不带书前缀的旧格式，同样自动升级（与启动迁移一致）
            migrateBookIdKeys()
            saveUserData()
            if (data.cardDirection) lsSet('ys-carddir', data.cardDirection)
            updateHomeStats()
            renderLessons()
            showToast('✅ 导入成功！')
          } catch (err) {
            alert('导入失败：数据格式不对')
          }
        }
        reader.readAsText(file)
      }
      // 加到页面里再触发，防止移动浏览器拦截
      document.body.appendChild(input)
      input.click()
      document.body.removeChild(input)
    }

    function resetAllData() {
      // 全部清光（用户确认）：清掉两本教材的所有学习数据，用确认框防止误点
      if (!confirm('确定要清除所有学习数据吗？\n\n包括：\n· 两本教材的进度、收藏、易错记录\n· 测验历史\n· 打卡 / 连续学习记录\n· 学习偏好设置\n\n此操作无法撤销！')) return
      // 删除本应用相关的全部本地存储 key
      var delKeys = collectAppStorageKeys()
      try {
        delKeys.forEach(function(k) { localStorage.removeItem(k) })
      } catch(e) {}
      // 内存同步清空
      try {
        starred.clear()
        grammarStarred.clear()
        grammarMastered.clear()
        srs = {}
      } catch(e) {}
      alert('所有学习数据已清除。正在刷新…')
      setTimeout(function() { location.reload() }, 300)
    }

    // ─── 显示设置 ───
    function showSettings() {
      var rate = lsGet('ys-tts-rate', '0.85')
      updateTtsRate(rate)
      document.getElementById('tts-rate').value = rate
      setCardDir(cardDirection)
      // 关于统计（跨全部教材合计；keys 带书前缀，各书不串数据）
      let total = 0, mCount = 0
      BOOKS.forEach(b => {
        Object.keys(b.vocab || {}).forEach(k => {
          (b.vocab[k] || []).forEach(w => {
            total++
            var d = srs[b.bookId + '|' + k + '|' + w.kr]
            if (d && d.lv >= 4) mCount++
          })
        })
      })
      document.getElementById('settings-word-count').textContent = total + ' 词'
      document.getElementById('settings-mastered-count').textContent = mCount + ' 词'
      // 版本行显示项目名 + 版本号（版本属于应用而非教材，书名在首页/课程/单词页展示）
      document.getElementById('settings-version').textContent = 'Daily Hangul · v' + APP_CONFIG.version
      showPage('page-settings')
    }

    // 底部导航设置（带页面栈重置）
    function showSettingsNav() {
      navigateRoot('page-settings')
      showSettings()
    }
    var _fromPopstate = false
    // 浏览器返回键监听
    window.addEventListener('popstate', function(e) {
      _fromPopstate = true
      if (e.state && e.state.page) {
        _currentPage = e.state.page
        showPage(e.state.page)
      } else {
        _currentPage = 'page-home'
        showPage('page-home')
      }
      _fromPopstate = false
    })

    // PWA
    if ('serviceWorker' in navigator) { navigator.serviceWorker.register('sw.js').catch(function(){}) }
