    /* ═══════════ SRS 间隔重复系统 ═══════════ */
    function srsInterval(lv) {
      // lv 0: 10分钟(首次), lv 1: 1天, lv 2: 3天, lv 3: 7天, lv 4: 21天, lv 5: 60天, lv 6: 120天
      var intervals = [10*60*1000, 86400000, 3*86400000, 7*86400000, 21*86400000, 60*86400000, 120*86400000]
      return intervals[Math.min(lv, intervals.length - 1)]
    }

    /* ═══════════ 输入归一化（听写判分用）═══════════ */
    function normalizeForCompare(str) {
      var s = String(str || '')
      // 全角→半角（字母/数字/标点）
      s = s.replace(/[！-～]/g, function(c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0) })
      // 全角空格→半角
      s = s.replace(/　/g, ' ')
      // 去首尾空格、压缩连续空格
      return s.trim().replace(/\s+/g, ' ')
    }

    /* ═══════════ 编辑距离（听写宽容判分用）═══════════ */
    function levenshtein(a, b) {
      a = String(a || ''); b = String(b || '')
      var m = a.length, n = b.length
      if (m === 0) return n
      if (n === 0) return m
      var d = []
      for (var i = 0; i <= m; i++) d[i] = [i]
      for (var j = 0; j <= n; j++) d[0][j] = j
      for (var i = 1; i <= m; i++) {
        var ai = a.charCodeAt(i - 1)
        for (var j = 1; j <= n; j++) {
          var cost = ai === b.charCodeAt(j - 1) ? 0 : 1
          d[i][j] = Math.min(d[i-1][j] + 1, d[i][j-1] + 1, d[i-1][j-1] + cost)
        }
      }
      return d[m][n]
    }

    function srsStatus(key) {
      var d = srs[key]
      if (!d || d.lv === 0) return { text: '新词', lv: 0, due: false }
      if (d.lv >= 4) return { text: '已掌握 ✓', lv: d.lv, due: false }
      var now = Date.now()
      if (d.due <= now) return { text: 'Lv.' + d.lv + ' · 待复习', lv: d.lv, due: true }
      var diff = d.due - now
      var days = Math.ceil(diff / 86400000)
      var hours = Math.ceil(diff / 3600000)
      if (days >= 2) return { text: 'Lv.' + d.lv + ' · ' + days + '天后复习', lv: d.lv, due: false }
      if (hours >= 1) return { text: 'Lv.' + d.lv + ' · ' + hours + '小时后复习', lv: d.lv, due: false }
      return { text: 'Lv.' + d.lv + ' · 即将复习', lv: d.lv, due: false }
    }

    function srsRate(quality) {
      // quality: 0=忘记, 1=困难, 2=一般, 3=简单
      var w = studyWords[studyIndex]
      if (!w) return
      var key = wk(w, w.lessonNum)
      var d = srs[key] || { lv: 0, due: 0, ease: 2.5, n: 0 }
      var now = Date.now()
      if (typeof recordSessionRate === 'function') recordSessionRate(quality)
      d.n = (d.n || 0) + 1
      d.last = now

      // 记录差评次数（薄弱词追踪）
      if (quality === 0 || quality === 1) {
        d.badCount = (d.badCount || 0) + 1
      }

      if (quality === 0) {
        var wasMastered = d.lv >= 4
        // 忘记了：重置
        d.lv = 0
        d.ease = Math.max(1.3, (d.ease || 2.5) - 0.2)
        d.due = now + 10*60*1000  // 10分钟后
        // 已掌握的词被评"忘记"→ 降级提示
        if (wasMastered && typeof showToast === 'function') showToast('已移出「已掌握」，10分钟后复习')
      } else if (quality === 1) {
        // 困难：保持等级，延长间隔
        d.ease = Math.max(1.3, (d.ease || 2.5) - 0.15)
        d.due = now + Math.round(srsInterval(d.lv) * 1.2)
      } else if (quality === 2) {
        // 一般：升级
        d.lv = Math.min(d.lv + 1, 6)
        d.due = now + Math.round(srsInterval(d.lv) * (d.ease || 2.5))
      } else if (quality === 3) {
        // 简单：跳级
        d.lv = Math.min(d.lv + 2, 6)
        d.ease = Math.min(3.0, (d.ease || 2.5) + 0.15)
        d.due = now + Math.round(srsInterval(d.lv) * (d.ease || 2.5) * 1.3)
      }

      srs[key] = d
      updateSrsStatus()
      updateHomeStats()
      renderLessons()
      saveUserData()
      // 评分后自动翻到下一张
      setTimeout(function() { nextCard() }, 400)
    }

    function updateSrsStatus() {
      var btn = document.getElementById('ctrl-check')
      var w = studyWords[studyIndex]
      if (!btn || !w) return
      var key = wk(w, w.lessonNum)
      var st = srsStatus(key)
      var label = btn.parentNode ? btn.parentNode.querySelector('.ctrl-label') : null
      if (label) label.textContent = st.text
      if (st.lv >= 4) btn.classList.add('active')
      else btn.classList.remove('active')
    }

    function srsDueCount() {
      var now = Date.now(), count = 0
      LESSONS.forEach(function(l) {
        var words = VOCAB[l.num] || []
        words.forEach(function(w) {
          var key = wk(w, l.num)
          var d = srs[key]
          if (!d || d.due <= now) count++
        })
      })
      return count
    }
    // 根据单词生成例句
    // ─── 韩语助词 & 词尾变化辅助函数 ───
    function hasBatchim(str) {
      if (!str || str.length === 0) return false
      const c = str.charCodeAt(str.length - 1)
      if (c < 0xAC00 || c > 0xD7A3) return false
      return (c - 0xAC00) % 28 !== 0
    }
    function attach(word, p) {
      const [a, b] = p.split('/')
      return hasBatchim(word) ? word + a : word + (b || a)
    }
    // ㄹ받침으로 끝나는 어간인지（걸/알/살/들…：ㄹ불규칙 활용）
    function hasLFinal(s) {
      if (!s || s.length === 0) return false
      const c = s.charCodeAt(s.length - 1) - 0xAC00
      return c >= 0 && c <= 11171 && (c % 28) === 8
    }
    // ㄷ불규칙 어간인지（걷/듣/묻/싣/깨닫…：걷다→걸어요, 들으세요）
    const D_IRREG = ['걷','듣','묻','싣','깨닫']
    function hasDFinal(s) { return D_IRREG.indexOf(s) !== -1 }
    // ㄷ받침을 ㄹ로 교체（걷→걸, 듣→들）
    function dropDFinal(s) {
      const c = s.charCodeAt(s.length - 1) - 0xAC00
      const init = Math.floor(c / 588), vow = Math.floor((c % 588) / 28)
      return s.slice(0, -1) + String.fromCharCode(0xAC00 + init * 588 + vow * 28 + 8)
    }
    // 把 ㅂ/ㄹ 合成进末尾音节的终声：가다+ㅂ→갑니다, 가다+ㄹ→갈 수 있습니다
    // ㄹ받침 어간은 ㄹ을 탈락시킨 뒤 합성：알다→압니다, 알다→알 수 있습니다
    function mergeFinal(s, ch) {
      const c = s.charCodeAt(s.length - 1) - 0xAC00
      if (c < 0 || c > 11171) return s + ch
      const init = Math.floor(c / 588)
      const vow = Math.floor((c % 588) / 28)
      const fin = (c % 28) === 8 ? 0 : (c % 28)
      if (fin !== 0) return s + ch
      const f = ch === 'ㅂ' ? 17 : 8
      return s.slice(0, -1) + String.fromCharCode(0xAC00 + init * 588 + vow * 28 + f)
    }
    // 어간의 '-아/어' 연결형（가다→가, 오다→와, 배우다→배워, 알다→알아, 닫다→닫아, 걷다→걸어）
    function aeoStem(s) {
      if (hasDFinal(s)) {
        const vi = lastVowelIdx(s)
        return dropDFinal(s) + (vi === 0 || vi === 8 || vi === 12 ? '아' : '어')
      }
      if (hasBatchim(s)) {
        // 받침 있음：어간 말음이 ㅏ/ㅗ/ㅛ → 아, 그 외 → 어
        const vi = lastVowelIdx(s)
        return s + (vi === 0 || vi === 8 || vi === 12 ? '아' : '어')
      }
      const c = s.charCodeAt(s.length - 1) - 0xAC00
      const init = Math.floor(c / 588)
      const vi = Math.floor((c % 588) / 28)
      const make = (vow) => String.fromCharCode(0xAC00 + init * 588 + vow * 28)
      if (vi === 0 || vi === 1 || vi === 4 || vi === 5) return s
      if (vi === 8) return s.slice(0, -1) + make(9)      // ㅗ→ㅘ（오다→와）
      if (vi === 11) return s.slice(0, -1) + make(10)    // ㅚ→ㅙ（되다→돼）
      if (vi === 12) return s.slice(0, -1) + make(14)    // ㅛ→ㅝ（희귀）
      if (vi === 13) return s.slice(0, -1) + make(14)    // ㅜ→ㅝ（배우다→배워）
      if (vi === 18) return s.slice(0, -1) + make(4)     // ㅡ→ㅓ（크다→커）
      if (vi === 20) return s.slice(0, -1) + make(6)     // ㅣ→ㅕ（치다→쳐）
      return s + '어'
    }
    // ㅂ불규칙 어간：맵다→매워, 돕다→도와（끝 모음 ㅗ→와, 그 외→워）
    function bipStem(s) {
      const code = s.charCodeAt(s.length - 1) - 0xAC00
      const init = Math.floor(code / 588), vow = Math.floor((code % 588) / 28)
      const clean = String.fromCharCode(0xAC00 + init * 588 + vow * 28)
      return s.slice(0, -1) + clean + (vow === 8 ? '와' : '워')
    }
    // 末尾音节的 종성 ㄹ 제거（알→아, 만들→만드）
    function dropLFinal(s) {
      const c = s.charCodeAt(s.length - 1) - 0xAC00
      const init = Math.floor(c / 588), vow = Math.floor((c % 588) / 28)
      return s.slice(0, -1) + String.fromCharCode(0xAC00 + init * 588 + vow * 28)
    }
    // '-아/어' 연결형에 과거 ㅆ 합성：가→갔, 와→왔, 배워→배웠
    function pastStem(a) {
      const c = a.charCodeAt(a.length - 1) - 0xAC00
      const init = Math.floor(c / 588), vow = Math.floor((c % 588) / 28)
      return a.slice(0, -1) + String.fromCharCode(0xAC00 + init * 588 + vow * 28 + 20)
    }
    function stem(v) { return v.endsWith('다') ? v.slice(0, -1) : v }
    function lastVowelIdx(str) {
      const c = str.charCodeAt(str.length - 1)
      if (c < 0xAC00 || c > 0xD7A3) return -1
      return Math.floor(((c - 0xAC00) % 588) / 28)
    }
    function lastFinalIdx(str) {
      const c = str.charCodeAt(str.length - 1)
      if (c < 0xAC00 || c > 0xD7A3) return -1
      return (c - 0xAC00) % 28
    }
    function presentForm(v) {
      const s = stem(v)
      if (s.endsWith('하')) return s.slice(0, -1) + '합니다'
      if (hasBatchim(s) && !hasLFinal(s)) return s + '습니다'
      return mergeFinal(s, 'ㅂ') + '니다'
    }
    function wantForm(v) { return stem(v) + '고 싶습니다' }
    function negForm(v) { return stem(v) + '지 않습니다' }
    function ingForm(v) { return stem(v) + '고 있습니다' }
    function gerundForm(v) { return stem(v) + '기' }
    function nounForm(adj) {
      const s = stem(adj)
      if (s.endsWith('하')) return s.slice(0, -1) + '한'
      if (s.endsWith('있')) return s + '는'
      if (hasBatchim(s)) return s + '은'
      return s + '는'
    }

    // 过去式（处理常见不规则变化）
    const PAST_IRREG = {
      '듣':'들었','걷':'걸었','묻':'물었','싣':'실었','깨닫':'깨달았',
      '돕':'도왔','곱':'고왔','이르':'이르렀',
      '부르':'불렀','모르':'몰랐','고르':'골랐','서두르':'서둘렀','다르':'달랐','누르':'눌렀','오르':'올랐',
      '기쁘':'기뻤','나쁘':'나빴','바쁘':'바빴',
      '슬프':'슬펐','아프':'아팠','예쁘':'예뻤',
    }
    function pastForm(v) {
      const s = stem(v)
      if (s.endsWith('하')) return s.slice(0, -1) + '했습니다'
      if (PAST_IRREG[s]) return PAST_IRREG[s] + '습니다'
      // ㅂ irregular: 맵다 → 매웠, 돕다 → 도왔
      if (lastFinalIdx(s) === 17) return pastStem(bipStem(s)) + '습니다'
      return pastStem(aeoStem(s)) + '습니다'
    }

    // ─── 更多活用辅助函数 ───
    function stemVowel(v) {
      const s = stem(v)
      const code = s.charCodeAt(s.length - 1)
      if (code < 0xAC00 || code > 0xD7A3) return -1
      return Math.floor(((code - 0xAC00) % 588) / 28)
    }
    function canForm(v) {
      const s = stem(v)
      if (s.endsWith('하')) return s.slice(0, -1) + '할 수 있습니다'
      if (hasDFinal(s)) return dropDFinal(s) + '을 수 있습니다'   // 걷다→걸을 수
      if (hasBatchim(s) && !hasLFinal(s)) return s + '을 수 있습니다'
      return mergeFinal(s, 'ㄹ') + ' 수 있습니다'
    }
    function canFormQ(v) {
      const s = stem(v)
      if (s.endsWith('하')) return s.slice(0, -1) + '할 수 있습니까?'
      if (hasDFinal(s)) return dropDFinal(s) + '을 수 있습니까?'
      if (hasBatchim(s) && !hasLFinal(s)) return s + '을 수 있습니까?'
      return mergeFinal(s, 'ㄹ') + ' 수 있습니까?'
    }
    function cantForm(v) {
      const s = stem(v)
      if (s.endsWith('하')) return s.slice(0, -1) + '할 수 없습니다'
      if (hasDFinal(s)) return dropDFinal(s) + '을 수 없습니다'
      if (hasBatchim(s) && !hasLFinal(s)) return s + '을 수 없습니다'
      return mergeFinal(s, 'ㄹ') + ' 수 없습니다'
    }
    function letsForm(v) {
      const s = stem(v)
      if (s.endsWith('하')) return s.slice(0, -1) + '합시다'
      if (hasBatchim(s) && !hasLFinal(s)) return s + '읍시다'
      return mergeFinal(s, 'ㅂ') + '시다'
    }
    function pleaseForm(v) {
      const s = stem(v)
      if (s.endsWith('하')) return s.slice(0, -1) + '하세요'
      if (hasDFinal(s)) return dropDFinal(s) + '으세요'   // 걷다→걸으세요
      if (hasLFinal(s)) return dropLFinal(s) + '세요'   // 알다→아세요
      return hasBatchim(s) ? s + '으세요' : s + '세요'
    }
    function futureForm(v) {
      const s = stem(v)
      if (s.endsWith('하')) return s.slice(0, -1) + '할 겁니다'
      if (hasDFinal(s)) return dropDFinal(s) + '을 겁니다'   // 걷다→걸을 겁니다
      if (hasBatchim(s) && !hasLFinal(s)) return s + '을 겁니다'
      return mergeFinal(s, 'ㄹ') + ' 겁니다'
    }
    function condForm(v) {
      const s = stem(v)
      if (s.endsWith('하')) return s.slice(0, -1) + '하면'
      if (hasDFinal(s)) return dropDFinal(s) + '으면'   // 걷다→걸으면
      if (hasLFinal(s)) return s + '면'   // 알다→알면
      return hasBatchim(s) ? s + '으면' : s + '면'
    }
    // -아/어서 连接
    function aSeoForm(v) {
      const s = stem(v)
      if (s.endsWith('하')) return s.slice(0, -1) + '해서'
      if (lastFinalIdx(s) === 17) return bipStem(s) + '서'   // 맵다→매워서
      return aeoStem(s) + '서'
    }
    // -지만 (但是)
    function jimanForm(v) {
      const s = stem(v)
      if (s.endsWith('하')) return s.slice(0, -1) + '하지만'
      return s + '지만'
    }
    // 过去否定
    function pastNegForm(v) {
      const s = stem(v)
      if (s.endsWith('하')) return s.slice(0, -1) + '하지 않았습니다'
      return s + '지 않았습니다'
    }

    // ─── 从数组中随机取 N 个 ───
    function pickRandom(arr, n) {
      const copy = [...arr]
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]]
      }
      return copy.slice(0, Math.min(n, copy.length))
    }

    function generateExample(w) {
      const p = w.pos, kr = w.kr
      const cn = w.cn.replace(/[（(].*?[）)]/g, '').trim()

      // 如果有手写例句，直接使用
      if (w.ex && w.ex.length > 0) {
        return w.ex.slice(0, 5).map(e => ({ kr: e.kr, cn: e.cn }))
      }

      const list = []
      function add(a, b) { list.push({ kr: a, cn: b }) }

      // --- 问候语 ---
      if (p === '问候语') {
        if (kr === '안녕하세요') {
          add('안녕하세요, 만나서 반갑습니다.', '你好，很高兴见到你。')
          add('안녕하세요, 처음 뵙겠습니다.', '你好，初次见面。')
          add('안녕하세요, 오랜만이에요.', '你好，好久不见。')
          add('안녕하세요, 잘 지내셨어요?', '您好，最近过得好吗？')
          add('선생님, 안녕하세요!', '老师，您好！')
        } else if (kr === '감사합니다') {
          add('도와주셔서 정말 감사합니다.', '非常感谢您的帮助。')
          add('선물을 주셔서 감사합니다.', '谢谢您送我礼物。')
          add('초대해 주셔서 감사합니다.', '谢谢您的邀请。')
          add('항상 감사합니다, 선생님.', '一直很感谢您，老师。')
          add('진심으로 감사합니다.', '真心感谢。')
        } else if (kr === '실례합니다') {
          add('실례합니다, 길을 좀 물어보겠습니다.', '打扰一下，我想问路。')
          add('실례합니다, 여기 앉아도 됩니까?', '打扰一下，可以坐这里吗？')
          add('실례합니다, 지금 몇 시예요?', '不好意思，现在几点？')
          add('실례합니다, 잠깐만요.', '失礼了，请稍等。')
          add('실례합니다, 먼저 가겠습니다.', '失陪了，我先走了。')
        } else if (kr === '늦어서 죄송합니다') {
          add('늦어서 죄송합니다.', '抱歉来晚了。')
          add('많이 늦어서 정말 죄송합니다.', '迟到了很多，真的很抱歉。')
          add('교통이 복잡해서 늦었어요. 죄송합니다.', '路上堵车来晚了，抱歉。')
          add('늦어서 죄송합니다. 오래 기다렸어요?', '抱歉来晚了。等很久了吗？')
        }
        return list
      }

      // --- 感叹词 ---
      if (p === '感叹词') {
        if (kr === '네') {
          add('네, 맞습니다.', '是的，没错。')
          add('네, 알겠습니다.', '好的，我知道了。')
          add('네, 그렇게 하겠습니다.', '好的，我会那样做。')
          add('네, 좋습니다!', '好的，太好了！')
          add('네, 바로 그거예요.', '对，就是那个。')
        } else if (kr === '아니요') {
          add('아니요, 아닙니다.', '不，不是的。')
          add('아니요, 괜찮습니다.', '不，没关系。')
          add('아니요, 아직 안 했어요.', '不，还没做。')
          add('아니요, 제 것이 아닙니다.', '不，不是我的。')
          add('아니요, 처음 왔습니다.', '不，我是第一次来。')
        }
        return list
      }

      // --- 代词 ---
      if (p === '代词') {
        if (kr === '저') {
          add('저는 한국어를 공부합니다.', '我学韩语。')
          add('저는 중국에서 왔습니다.', '我来自中国。')
          add('저는 대학생입니다.', '我是大学生。')
          add('저는 내일 한국에 갑니다.', '我明天去韩国。')
          add('저는 매일 운동을 합니다.', '我每天运动。')
          return list
        }
        if (kr === '제') {
          add('제 이름은 민수입니다.', '我的名字是敏秀。')
          add('이것은 제 가방이 아닙니다.', '这不是我的包。')
          add('제 꿈은 의사가 되는 것입니다.', '我的梦想是成为医生。')
          add('제가 도와 드리겠습니다.', '我来帮您。')
          add('제 생각에는 좋은 것 같아요.', '我觉得挺好的。')
          return list
        }
        if (kr === '누구') {
          add('저분은 누구세요?', '那位是谁？')
          add('누구를 기다리고 있어요?', '你在等谁？')
          add('이거 누구 거예요?', '这是谁的？')
          add('누구랑 같이 왔어요?', '和谁一起来的？')
          add('아까 전화한 분이 누구예요?', '刚才打电话的是谁？')
          return list
        }
        if (kr === '무엇') {
          add('이것은 무엇입니까?', '这是什么？')
          add('오늘 저녁에 무엇을 먹을까요?', '今天晚上吃什么？')
          add('지금 무엇을 하고 있어요?', '现在在做什么？')
          add('무엇이 가장 필요해요?', '最需要什么？')
          add('무엇 때문에 왔어요?', '为什么而来？')
          return list
        }
        if (kr === '어디') {
          add('지금 어디에 가요?', '现在去哪里？')
          add('화장실이 어디예요?', '洗手间在哪里？')
          add('어디에서 만날까요?', '在哪里见面呢？')
          add('이 버스가 어디까지 가요?', '这趟公交车到哪里？')
          add('어디가 아프세요?', '哪里不舒服？')
          return list
        }
        if (kr === '여기' || kr === '거기' || kr === '저기') {
          add(kr + '가 정말 예쁘네요.', cn + '真漂亮啊。')
          add(kr + '에 앉으세요.', '请坐在' + cn + '。')
          add(kr + '에서 기다릴게요.', '我在' + cn + '等你。')
          add(kr + '에 뭐가 있어요?', cn + '有什么？')
          add(kr + '로 오세요!', '来' + cn + '吧！')
          return list
        }
        if (kr === '이것' || kr === '그것' || kr === '저것') {
          add(attach(kr, '은/는') + ' 얼마예요?', cn + '多少钱？')
          add(attach(kr, '은/는') + ' 정말 예뻐요.', cn + '真漂亮。')
          add(attach(kr, '이/가') + ' 마음에 들어요.', '我喜欢' + cn + '。')
          add(attach(kr, '을/를') + ' 한번 입어 보세요.', '请试穿一下' + cn + '。')
          add(attach(kr, '을/를') + ' 어디에서 샀어요?', cn + '在哪里买的？')
          return list
        }
        if (kr === '이쪽' || kr === '그쪽' || kr === '저쪽') {
          add(kr + '으로 가세요.', '请往' + cn + '走。')
          add(kr + '에 앉으세요.', '请坐在' + cn + '。')
          add(kr + '이 더 조용해요.', cn + '更安静。')
          add(kr + '에서 뵙겠습니다.', '在' + cn + '见。')
          add(kr + '은 어떤가요?', cn + '怎么样？')
          return list
        }
        add(attach(kr, '은/는') + ' 무엇입니까?', cn + '是什么？')
        add(attach(kr, '이/가') + ' 궁금합니다.', '对' + cn + '很好奇。')
        add(attach(kr, '을/를') + ' 알고 싶습니다.', '想知道' + cn + '。')
        add(attach(kr, '에') + ' 대해서 이야기합시다.', '谈谈关于' + cn + '吧。')
        add(attach(kr, '이/가') + ' 중요합니다.', cn + '很重要。')
        return list
      }

      // --- 动词（按语境维度选模板）---
      if (p === '动词' || p === '自动词' || p === '他动词') {
        const groups = [
          [ [`저는 매일 ${presentForm(kr)}.`, `我每天${cn}。`], [`보통 아침에 ${presentForm(kr)}.`, `通常早上${cn}。`], [`주말마다 ${presentForm(kr)}.`, `每个周末${cn}。`], [`한국 사람들은 자주 ${presentForm(kr)}.`, `韩国人经常${cn}。`] ],
          [ [`어제 ${pastForm(kr)}.`, `昨天${cn}了。`], [`지난 주말에 친구와 ${pastForm(kr)}.`, `上周末和朋友${cn}了。`], [`방금 ${pastForm(kr)}.`, `刚刚${cn}了。`], [`처음 ${pastForm(kr)} 때 힘들었어요.`, `第一次${cn}的时候很辛苦。`] ],
          [ [`정말 ${wantForm(kr)}.`, `真的很想${cn}。`], [`내일은 꼭 ${futureForm(kr)}.`, `明天一定要${cn}。`], [`다음 주에 ${futureForm(kr)}.`, `下周要${cn}。`], [`기회가 되면 ${wantForm(kr)}.`, `有机会的话想${cn}。`] ],
          [ [`아직 ${negForm(kr)}.`, `还没${cn}。`], [`너무 피곤해서 ${cantForm(kr)}.`, `太累了没法${cn}。`], [`왜 ${negForm(kr)}?`, `为什么不${cn}？`], [`혼자서 ${canFormQ(kr)}`, `一个人能${cn}吗？`] ],
          [ [`지금 ${ingForm(kr)}.`, `现在正在${cn}。`], [`같이 ${letsForm(kr)}!`, `一起${cn}吧！`], [`천천히 ${pleaseForm(kr)}.`, `请慢慢${cn}。`], [`시간이 ${condForm(kr)} 연락 주세요.`, `${cn}的话请联系我。`], [`${jimanForm(kr)} 재미있어요.`, `虽然${cn}但有意思。`] ],
        ]
        groups.forEach(g => { const t = g[Math.floor(Math.random() * g.length)]; add(t[0], t[1]) })
        return list
      }

      // --- 形容词 ---
      if (p === '形容词') {
        const groups = [
          [ [`오늘 정말 ${presentForm(kr)}.`, `今天真的很${cn}。`], [`이것은 ${presentForm(kr)}.`, `这个很${cn}。`], [`요즘 날씨가 ${presentForm(kr)}.`, `最近天气很${cn}。`], [`여기 분위기가 ${presentForm(kr)}.`, `这里气氛很${cn}。`] ],
          [ [`어제는 정말 ${pastForm(kr)}.`, `昨天真的很${cn}。`], [`처음에는 ${pastNegForm(kr)}.`, `一开始不${cn}。`], [`예전보다 훨씬 ${presentForm(kr)}.`, `比以前${cn}多了。`] ],
          [ [`점점 더 ${presentForm(kr)}.`, `越来越${cn}了。`], [`내일은 더 ${futureForm(kr)}.`, `明天会更${cn}。`], [`${condForm(kr)} 정말 좋겠어요.`, `要是${cn}就好了。`] ],
          [ [`별로 ${negForm(kr)}.`, `不太${cn}。`], [`이것보다 저것이 더 ${presentForm(kr)}.`, `比起这个那个更${cn}。`], [`뭐가 제일 ${presentForm(kr)}?`, `什么最${cn}？`], [`생각보다 ${presentForm(kr)}.`, `比想象中${cn}。`] ],
          [ [`와, 진짜 ${presentForm(kr)}!`, `哇，真是太${cn}了！`], [`${jimanForm(kr)} 마음에 들어요.`, `虽然${cn}但我喜欢。`], [`처음 봤을 때 너무 ${pastForm(kr)}.`, `第一次见的时候太${cn}了。`] ],
        ]
        groups.forEach(g => { const t = g[Math.floor(Math.random() * g.length)]; add(t[0], t[1]) })
        return list
      }

      // --- 名词（按语义子类分池）---
      if (p === '名词') {
        const placeSet = new Set(['학교','집','병원','도서관','시장','은행','공원','식당','카페','회사','교실','사무실','화장실','영화관','서점','극장','버스','지하철','택시','길','한국','중국','일본','미국','영국','독일','러시아','인도','호주','캐나다','프랑스','태국','대사관','기숙사','운동장','주차장','약국','미용실','편의점','백화점','슈퍼','정류장','역','공항','앞','뒤','옆','위','아래','안','밖','근처','호텔','미술관','도시','마을','동네','바다','산','강','터미널','빵집','꽃집','문구점','옷 가게','레스토랑','커피숍'])
        const personSet = new Set(['의사','선생','학생','회사원','경찰','간호사','변호사','기자','교수','비서','은행원','가수','대학생','군인','소방관','요리사','운전사','배우','사장','직원','주인','친구','사람','아이','어른','남자','여자','아가씨','아주머니','아저씨','부모님','아버지','어머니','가족','할아버지','할머니','외할아버지','외할머니','아들','딸','형','오빠','누나','언니','남동생','여동생','선생님'])
        const foodSet = new Set(['밥','물','음식','과일','고기','야채','김치','불고기','비빔밥','떡볶이','라면','빵','커피','차','주스','맥주','소주','와인','우유','요구르트','국','찌개','반찬','간식','식사','아침','점심','저녁','된장찌개','냉면','삼겹살','갈비','케이크','바나나','포도','귤','사과'])

        let ntype = 'object'
        if (placeSet.has(kr) || cn.match(/地方|国家|学校|医院|店|园|馆|场|室|所|局|站|厅/)) ntype = 'place'
        else if (personSet.has(kr) || cn.match(/师|生$|员|者|亲|奶|爷|爸妈|哥姐|弟兄|妹/)) ntype = 'person'
        else if (foodSet.has(kr) || cn.match(/吃|喝|饭|菜|汤|肉|果|饮料|酒|奶|茶/)) ntype = 'food'

        if (ntype === 'place') {
          const g = [
            [ [kr + '에 가 봤어요?', '去过' + cn + '吗？'], [kr + '에 어떻게 가요?', '怎么去' + cn + '？'], ['주말에 ' + kr + '에 갈 거예요.', '周末要去' + cn + '。'] ],
            [ ['지난주에 ' + kr + '에 다녀왔어요.', '上周去了' + cn + '。'], ['예전에 ' + kr + ' 근처에 살았어요.', '以前住' + cn + '附近。'] ],
            [ [kr + '에서 친구를 만날 거예요.', '要在' + cn + '见朋友。'], [kr + ' 근처에 맛집이 많아요.', cn + '附近好吃的很多。'] ],
            [ [kr + '까지 얼마나 걸려요?', '到' + cn + '要多长时间？'], ['여기서 ' + kr + '까지 가까워요?', '这里到' + cn + '近吗？'] ],
            [ [attach(kr, '이/가') + ' 정말 예뻐요.', cn + '真漂亮。'], [kr + '에 사람이 진짜 많아요.', cn + '人真的好多。'] ],
          ]
          g.forEach(gg => { const t = gg[Math.floor(Math.random() * gg.length)]; add(t[0], t[1]) })
        } else if (ntype === 'person') {
          const g = [
            [ [attach(kr, '이/가') + ' 되고 싶어요.', '想成为' + cn + '。'], [attach(kr, '은/는') + ' 제 꿈이에요.', cn + '是我的梦想。'] ],
            [ ['어제 ' + attach(kr, '을/를') + ' 만났어요.', '昨天见了' + cn + '。'], [attach(kr, '이/가') + ' 도와줬어요.', cn + '帮了我。'] ],
            [ [attach(kr, '이/가') + ' 보고 싶어요.', '想念' + cn + '。'], [attach(kr, '에게') + ' 선물을 줬어요.', '给' + cn + '送了礼物。'] ],
            [ [attach(kr, '은/는') + ' 어디에 계세요?', cn + '在哪里？'], ['제 ' + attach(kr, '은/는') + ' 중국에 있어요.', '我的' + cn + '在中国。'] ],
            [ [attach(kr, '이랑/랑') + ' 같이 살아요.', '和' + cn + '一起住。'], [attach(kr, '께') + ' 안부 전해 주세요.', '代我向' + cn + '问好。'] ],
          ]
          g.forEach(gg => { const t = gg[Math.floor(Math.random() * gg.length)]; add(t[0], t[1]) })
        } else if (ntype === 'food') {
          const g = [
            [ [attach(kr, '이/가') + ' 정말 맛있어요.', cn + '真的很好吃。'], ['저는 ' + attach(kr, '을/를') + ' 진짜 좋아해요.', '我很喜欢' + cn + '。'] ],
            [ ['어제 처음 ' + attach(kr, '을/를') + ' 먹어 봤어요.', '昨天第一次吃' + cn + '。'], ['한국에서 ' + attach(kr, '을/를') + ' 먹어 봤어요.', '在韩国吃过' + cn + '。'] ],
            [ [attach(kr, '을/를') + ' 만들어 볼 거예요.', '打算做' + cn + '。'], ['내일 ' + attach(kr, '을/를') + ' 먹으러 갈래요?', '明天去吃' + cn + '吗？'] ],
            [ [attach(kr, '이/가') + ' 조금 매워요.', cn + '有点辣。'], [attach(kr, '은/는') + ' 무슨 맛이에요?', cn + '是什么味道？'] ],
            [ [kr + ' 한 그릇 더 주세요!', '再来一碗' + cn + '！'], ['이 집 ' + attach(kr, '이/가') + ' 제일 유명해요.', '这家的' + cn + '最有名。'] ],
          ]
          g.forEach(gg => { const t = gg[Math.floor(Math.random() * gg.length)]; add(t[0], t[1]) })
        } else {
          const g = [
            [ [attach(kr, '이/가') + ' 있어요?', '有' + cn + '吗？'], ['새 ' + attach(kr, '을/를') + ' 샀어요.', '买了新的' + cn + '。'] ],
            [ ['어제 ' + attach(kr, '을/를') + ' 잃어버렸어요.', '昨天把' + cn + '弄丢了。'], [attach(kr, '을/를') + ' 찾았어요!', '找到' + cn + '了！'] ],
            [ [attach(kr, '이/가') + ' 필요해요.', '需要' + cn + '。'], [attach(kr, '을/를') + ' 빌릴 수 있을까요?', '能借一下' + cn + '吗？'] ],
            [ [attach(kr, '이/가') + ' 너무 비싸요.', cn + '太贵了。'], ['이 ' + attach(kr, '은/는') + ' 얼마예요?', '这个' + cn + '多少钱？'] ],
            [ [attach(kr, '을/를') + ' 선물로 받았어요.', cn + '是收到的礼物。'], [attach(kr, '을/를') + ' 어떻게 사용해요?', cn + '怎么用？'] ],
          ]
          g.forEach(gg => { const t = gg[Math.floor(Math.random() * gg.length)]; add(t[0], t[1]) })
        }
        return list
      }

      // --- 依存名词 ---
      if (p === '依存名词') {
        if (kr === '씨') {
          add('김민수 씨, 안녕하세요?', '金敏秀先生，您好。')
          add('박 씨는 어디에 가셨어요?', '朴先生去哪里了？')
          add('저기 최 씨가 와요.', '那边崔女士来了。')
          add('이 씨, 내일 뵐게요.', '李先生，明天见。')
          add('김 씨한테 물어보세요.', '问问金先生吧。')
          return list
        }
        if (kr === '시' || kr === '분' || kr === '초') {
          add('지금 몇 시예요?', '现在几点？')
          add('세 시에 약속이 있어요.', '三点有约会。')
          add('1시 30분에 만나요.', '1点30分见。')
          add('몇 시에 출발할까요?', '几点出发？')
          add('두 시까지 와 주세요.', '请两点之前来。')
          return list
        }
        if (kr === '년' || kr === '월' || kr === '일') {
          add('2024년 7월 17일입니다.', '是2024年7月17日。')
          add('생일이 몇 월 며칠이에요?', '生日是几月几号？')
          add('12월 25일에 만나요.', '12月25日见面。')
          return list
        }
        if (kr === '층') {
          add('3층으로 올라가세요.', '请上三楼。')
          add('이 건물은 몇 층이에요?', '这栋楼有几层？')
          add('1층에 커피숍이 있어요.', '一楼有咖啡店。')
          return list
        }
        if (kr === '호선') {
          add('2호선으로 갈아타세요.', '请换乘2号线。')
          add('몇 호선을 타야 해요?', '应该坐几号线？')
          return list
        }
        if (kr === '호') {
          add('101호실이 어디예요?', '101号室在哪里？')
          return list
        }
        add(attach(kr, '이/가') + ' 많습니다.', cn + '很多。')
        add(attach(kr, '을/를') + ' 모릅니다.', '不知道' + cn + '。')
        add(attach(kr, '은/는') + ' 몇 개 있습니까?', '有几个' + cn + '？')
        add(attach(kr, '이/가') + ' 필요합니다.', '需要' + cn + '。')
        add(attach(kr, '에') + ' 따라 다릅니다.', '根据' + cn + '而不同。')
        return list
      }

      // --- 副词 ---
      if (p === '副词') {
        const g = [
          [ [kr + ' 한국어를 공부해요.', cn + '学韩语。'], [kr + ' 운동을 해요.', cn + '运动。'], [kr + ' 친구를 만나요.', cn + '见朋友。'], [kr + ' 책을 읽어요.', cn + '读书。'] ],
          [ ['예전에는 ' + kr + ' 갔어요.', '以前' + cn + '去。'], ['어제는 ' + kr + ' 쉬었어요.', '昨天' + cn + '休息了。'] ],
          [ [kr + ' 연습하면 잘할 거예요.', cn + '练习就能做好。'], ['앞으로 ' + kr + ' 할 거예요.', '以后要' + cn + '做。'] ],
          [ ['왜 ' + kr + ' 안 와요?', '为什么不' + cn + '来？'], [kr + ' 안 해도 돼요?', '不' + cn + '也行吗？'] ],
          [ ['우리 ' + kr + ' 갑시다!', '我们' + cn + '去吧！'], [kr + ' 한 번 해 보세요.', '请' + cn + '试一次。'] ],
        ]
        g.forEach(gg => { const t = gg[Math.floor(Math.random() * gg.length)]; add(t[0], t[1]) })
        return list
      }

      // --- 冠词 ---
      if (p === '冠词') {
        if (kr === '무슨') {
          add('무슨 음식을 좋아해요?', '喜欢什么食物？')
          add('무슨 영화를 보고 싶어요?', '想看什么电影？')
          add('무슨 일로 오셨어요?', '您有什么事？')
          add('무슨 책을 읽고 있어요?', '在读什么书？')
          add('무슨 색이 가장 좋아요?', '最喜欢什么颜色？')
        } else if (kr === '어느') {
          add('어느 나라에서 오셨어요?', '从哪个国家来的？')
          add('어느 학교에 다녀요?', '上哪个学校？')
          add('어느 쪽이 더 좋아요?', '哪个更好？')
          add('어느 계절을 좋아해요?', '喜欢哪个季节？')
          add('어느 정도 할 수 있어요?', '能做到什么程度？')
        }
        return list
      }

      // --- 量词 ---
      if (p === '量词') {
        add('한 ' + kr + ' 주세요.', '请给一' + cn + '。')
        add('두 ' + kr + ' 있어요.', '有两' + cn + '。')
        add('세 ' + kr + ' 필요해요.', '需要三' + cn + '。')
        add('몇 ' + kr + ' 드릴까요?', '给您几' + cn + '？')
        add('한 ' + kr + ' 더 있어요?', '还有一' + cn + '吗？')
        return list
      }

      // --- 词组 ---
      if (p === '词组') {
        add(attach(kr, '을/를') + ' 자주 합니다.', '经常' + cn + '。')
        add(attach(kr, '을/를') + ' 좋아합니다.', '喜欢' + cn + '。')
        add(attach(kr, '을/를') + ' 배우고 싶습니다.', '想学' + cn + '。')
        add(attach(kr, '을/를') + ' 열심히 했습니다.', '努力' + cn + '了。')
        add('어제 처음으로 ' + attach(kr, '을/를') + ' 했습니다.', '昨天第一次' + cn + '了。')
        return list
      }

      return list
    }
