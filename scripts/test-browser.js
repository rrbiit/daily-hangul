/* ════════════════════════════════════════════════════════════════
   test-browser.js — 阶段4：真实 DOM / 页面流程验证（jsdom）
   用法：node scripts/test-browser.js
   前置：npm install jsdom（安装到 DSH_JSDOM_DIR 或 $TEMP/dsh-jsdom）
   实现：脚本内启动本地 HTTP 服务器，jsdom 以 resources:'usable' 真实加载
         index.html + 全部 JS/CSS（与浏览器一致），再驱动真实 UI 流程。
   覆盖：应用启动无错误 / 五种模式按钮 / 听音→韩语真实出题与答题 /
         完整一轮测验（选择+听写）/ 结果页与测验历史 / 无脚本异常
   说明：jsdom 无真实排版引擎，溢出检测无法测量（依赖 CSS 结构检查）；
         发音（Audio/speechSynthesis）用桩替代。
   通过 = 打印 PASS 摘要并退出码 0；失败 = 打印 FAIL 详情并退出码 1
   ════════════════════════════════════════════════════════════════ */
'use strict'
const fs = require('fs')
const path = require('path')
const os = require('os')
const http = require('http')

const ROOT = path.resolve(__dirname, '..')
const JSDOM_DIR = process.env.DSH_JSDOM_DIR || path.join(os.tmpdir(), 'dsh-jsdom')
const JSDOM_PATH = path.join(JSDOM_DIR, 'node_modules', 'jsdom')

let passed = 0, failed = 0
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg) }
  else { failed++; console.log('  ✗ FAIL: ' + msg) }
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
async function waitFor(fn, timeoutMs) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true
    await sleep(100)
  }
  return false
}

async function main() {
  if (!fs.existsSync(JSDOM_PATH)) {
    console.log('⚠️  未找到 jsdom（' + JSDOM_PATH + '），跳过浏览器级验证。')
    console.log('═══ 结果：SKIPPED ═══')
    process.exit(0)
  }

  const { JSDOM, VirtualConsole } = require(JSDOM_PATH)

  // ─── 本地静态服务器（模拟浏览器从 http 加载页面资源）───
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' }
  const server = http.createServer((req, res) => {
    let file = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    if (file === '/') file = '/index.html'
    const p = path.join(ROOT, file)
    fs.readFile(p, (err, data) => {
      if (err) { res.writeHead(404); res.end('404'); return }
      res.writeHead(200, { 'Content-Type': mime[path.extname(p)] || 'application/octet-stream' })
      res.end(data)
    })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const base = 'http://127.0.0.1:' + server.address().port

  const errors = []
  const vc = new VirtualConsole()
  vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.detail ? e.detail.message : e.message)))
  vc.on('error', (...a) => errors.push('console.error: ' + a.map(String).join(' ')))

  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  const dom = new JSDOM(html, {
    url: base + '/index.html',
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.onerror = (msg, src, line) => { errors.push('window.onerror: ' + msg + ' @' + line) }
      // 发音桩：jsdom 无 Audio / speechSynthesis
      window.Audio = class { constructor() {} play() { return Promise.reject(new Error('no-audio')) } pause() {} }
      window.speechSynthesis = { cancel() {}, speak() {}, getVoices() { return [] } }
      // 导出桩：捕获下载 Blob（jsdom 无 createObjectURL）
      window.URL.createObjectURL = blob => { window.__capturedBlob = blob; return 'blob:mock' }
      window.URL.revokeObjectURL = () => {}
      // 导入桩：FileReader 同步回填 + 文件选择器 click 后派发 change（jsdom 无真实文件选择）
      window.FileReader = class {
        readAsText(file) {
          const self = this
          const fill = t => { self.result = t; if (self.onload) self.onload({ target: self }) }
          if (file && typeof file.text === 'function') file.text().then(fill, () => fill(''))
          else fill('')
        }
      }
      const origClick = window.HTMLInputElement.prototype.click
      window.HTMLInputElement.prototype.click = function() {
        origClick.call(this)
        if (this.type === 'file' && window.__importFile) {
          Object.defineProperty(this, 'files', { value: [window.__importFile], configurable: true })
          this.dispatchEvent(new window.Event('change'))
        }
      }
    },
  })

  const { window } = dom
  try {
    await new Promise(resolve => window.addEventListener('load', resolve))
  } catch (e) {
    console.log('✗ 页面加载失败: ' + e.message)
    server.close()
    process.exit(1)
  }

  console.log('── 1. 应用启动 ──')
  ok(!window.document.querySelector('#ys-error'), '启动无全局错误（#ys-error 不存在）')
  ok(typeof window.startQuiz === 'function' && typeof window.switchQuizMode === 'function', 'quiz.js 已加载（startQuiz/switchQuizMode 可用）')
  ok(typeof window.getConfusionPairsForBook === 'function', 'confusion.js 已加载（易混层可用）')
  ok(window.eval('APP_CONFIG.version') === '1.21.0', '版本号 = 1.21.0（实际 ' + window.eval('APP_CONFIG.version') + '）')

  console.log('── 2. 测验设置页：五种模式按钮 ──')
  window.showQuiz()
  const modeBtns = window.document.querySelectorAll('#quiz-mode-bar .tab-btn')
  ok(modeBtns.length === 5, '模式栏 5 个按钮（实际 ' + modeBtns.length + '）')
  const krBtn = window.document.querySelector('#quiz-mode-bar .tab-btn[data-mode="listen-kr"]')
  ok(!!krBtn && krBtn.textContent.indexOf('听词') >= 0, '新增「听词」按钮存在（data-mode="listen-kr"）')
  const modeOrder = Array.from(modeBtns).map(b => b.getAttribute('data-mode')).join(',')
  ok(modeOrder === 'kr-cn,cn-kr,listen,listen-kr,dict', '按钮顺序：韩→中,中→韩,听音,听词,听写（实际 ' + modeOrder + '）')

  console.log('── 3. 听音→韩语（listen-kr）真实出题与答题 ──')
  window.switchQuizMode('listen-kr')
  ok(window.document.getElementById('quiz-mode-hint').textContent === '听发音，选出听到的韩语单词', '模式提示 = 听发音，选出听到的韩语单词')
  window.setQuizCount(5)
  window.startQuiz()
  ok(window.document.getElementById('quiz-play').style.display === 'block', '测验已开始（答题区显示）')
  const label = window.document.getElementById('quiz-question-area').textContent || ''
  ok(label.indexOf('听音选词') >= 0, '题目标签 = 听音选词')
  const q0 = window.quizQuestions[0]
  const optEls = window.document.querySelectorAll('#quiz-options .quiz-option')
  ok(optEls.length === 4, '渲染 4 个选项（实际 ' + optEls.length + '）')
  const correctText = q0.options[q0.correctIdx]
  const renderedCorrect = Array.from(optEls).find(el => el.textContent.indexOf(correctText) >= 0)
  ok(!!renderedCorrect, '正确选项已渲染：' + correctText + '（韩语词形）')
  ok(/^[A-D]\.\s[가-힣]+$/.test(renderedCorrect.textContent.trim()), '选项格式 A. 싸다 且为韩语词形')
  for (let i = 0; i < 5; i++) {
    const q = window.quizQuestions[window.quizIndex]
    const target = window.document.querySelectorAll('#quiz-options .quiz-option')[q.correctIdx]
    target.click()
    await sleep(950)   // 答对自动跳下一题（800ms）；最后一题跳到结果页
  }
  await waitFor(() => window.document.getElementById('quiz-result').style.display === 'block', 3000)
  ok(window.document.getElementById('quiz-result').style.display === 'block', '5 题答完后进入结果页')
  ok((window.document.querySelector('.quiz-score') || {}).textContent === '5/5', '得分 5/5')
  ok(window.quizHistory.length === 1 && window.quizHistory[0].mode === 'listen-kr' && window.quizHistory[0].score === 5, '测验历史写入：mode=listen-kr, score=5')
  ok(window.quizHistory[0].bookId === 'yonsei1', '测验历史带 bookId=yonsei1')

  console.log('── 4. 听写模式真实判分 ──')
  window.quizBackToSetup()
  window.switchQuizMode('dict')
  window.startQuiz()
  window.document.getElementById('quiz-dict-field').value = window.quizQuestions[0].word.kr
  window.dictSubmit()
  const dFb = window.document.getElementById('quiz-feedback').textContent || ''
  ok(dFb.indexOf('✓') >= 0, '听写输入正确词 → 判对（反馈含 ✓）')
  await sleep(950)
  window.document.getElementById('quiz-dict-field').value = 'ㅁㄴㅇㄹㅁㄴㅇ'
  window.dictSubmit()
  const dFb2 = window.document.getElementById('quiz-feedback').textContent || ''
  ok(dFb2.indexOf('✗') >= 0, '听写输入乱码 → 判错（反馈含 ✗）')

  console.log('── 5. SRS / 易错本 / 测验历史 联动（答错路径）──')
  window.quizBackToSetup()
  window.switchQuizMode('kr-cn')
  window.setQuizCount(5)
  window.startQuiz()
  for (let i = 0; i < 5; i++) {
    const q = window.quizQuestions[window.quizIndex]
    const wrongIdx = (q.correctIdx + 1) % 4
    window.document.querySelectorAll('#quiz-options .quiz-option')[wrongIdx].click()
    await sleep(300)
    window.document.getElementById('quiz-next-btn').click()   // 答错不自动跳转，手动下一题
    await sleep(200)
  }
  await waitFor(() => window.document.getElementById('quiz-result').style.display === 'block', 3000)
  ok(window.eval('quizErrors.length') === 5, '5 题全错 → quizErrors=5（易错本数据源）')
  ok(window.eval('Object.keys(srs).length') >= 5, 'SRS 已为错词建立条目（' + window.eval('Object.keys(srs).length') + ' 个）')
  ok(window.eval('Object.keys(srs).every(function(k){ return (srs[k].badCount||0) >= 1 })') === true, '错词 badCount ≥ 1（薄弱词判定生效）')
  const h5 = window.quizHistory[window.quizHistory.length - 1]
  ok(!!h5 && h5.errors && h5.errors.length === 5 && h5.score === 0, '测验历史记录 5 个错词、得分 0（历史结构未变）')

  console.log('── 6. 韩→中 / 中→韩 / 听音→中文 快速回归 ──')
  window.quizBackToSetup()
  window.switchQuizMode('kr-cn')
  ok(window.document.getElementById('quiz-mode-hint').textContent === '看韩语，选正确的中文意思', '韩→中 提示正常')
  window.startQuiz()
  const k0 = window.quizQuestions[0]
  ok(k0.options[k0.correctIdx] === k0.word.cn, '韩→中 正确选项 = 中文释义')
  ok(Array.isArray(k0.optionKeys) && k0.optionKeys.length === 4 && !!k0.targetKey, '韩→中 题目携带 optionKeys/targetKey')
  window.quizBackToSetup()
  window.switchQuizMode('cn-kr')
  window.startQuiz()
  const c0 = window.quizQuestions[0]
  ok(c0.options[c0.correctIdx] === c0.word.kr, '中→韩 正确选项 = 韩语词形')
  window.quizBackToSetup()
  window.switchQuizMode('listen')
  window.startQuiz()
  const l0 = window.quizQuestions[0]
  ok(l0.options[l0.correctIdx] === l0.word.cn, '听音→中文 正确选项 = 中文释义（原模式保留）')

  console.log('── 7. 无脚本异常 ──')
  const hardErrors = errors.filter(e => e.indexOf('window.onerror') >= 0 || e.indexOf('console.error') >= 0)
  ok(hardErrors.length === 0, '无 window.onerror / console.error（实际 ' + hardErrors.length + ' 条）')
  if (errors.length > 0) {
    console.log('    (jsdom 环境噪音 ' + errors.length + ' 条：' + errors.slice(0, 3).join(' | '))
  }

  console.log('── 8. 导出 / 导入（含 ys-confusions 个人混淆数据）──')
  window.eval("clearConfusions(); recordConfusion('yonsei1|6|싸다', 'yonsei1|3|사다'); recordConfusion('yonsei1|6|싸다', 'yonsei1|3|사다')")
  ok(window.eval('getPersonalPairs("yonsei1").length') === 1, '导出前存在个人混淆记录（싸다↔사다）')
  window.exportData()
  const backupText = await window.__capturedBlob.text()
  const backup = JSON.parse(backupText)
  ok(!!backup.store && !!backup.store['ys-confusions'], '导出 JSON 包含 ys-confusions（ys- 前缀已纳入备份范围）')
  ok(JSON.stringify(backup.store['ys-confusions']).indexOf('싸다') >= 0, 'ys-confusions 内容包含混淆记录（싸다）')
  ok(!!backup.store['yonsei-study-data'] && !!backup.store['quiz-history'], '原有数据（SRS/历史）照常导出')
  // 模拟全部数据丢失（用应用自身的 key 收集函数清空），再导入恢复
  window.eval('collectAppStorageKeys().forEach(function(k){ localStorage.removeItem(k) })')
  ok(window.localStorage.getItem('ys-confusions') === null && window.localStorage.getItem('yonsei-study-data') === null, '已模拟全部数据丢失')
  window.__importFile = new window.File([backupText], 'backup.json', { type: 'application/json' })
  window.confirm = () => true
  window.alert = () => {}
  window.importData()
  await sleep(200)
  window.eval('loadConfusions()')   // 真实浏览器里 importData 会 location.reload() 自动重读；jsdom 无刷新，手动等价模拟
  ok(window.localStorage.getItem('ys-confusions') !== null, '导入后 ys-confusions 已写回 localStorage')
  ok(window.localStorage.getItem('yonsei-study-data') !== null, '导入后原有学习数据一并恢复')
  ok(window.localStorage.getItem('quiz-history') !== null, '导入后测验历史一并恢复')
  const restored = window.eval('getPersonalPairs("yonsei1")')
  ok(restored.length === 1 && restored[0].ba === 2 && restored[0].ab === 0, '恢复的混淆方向计数正确（a=사다, b=싸다，考 싸다 答成 사다 2 次 → ba=2）')

  console.log('── 9. 清除所有数据（含 ys-confusions）──')
  window.eval(`recordConfusion('yonsei1|6|싸다', 'yonsei1|3|사다')`)
  ok(window.eval('getPersonalPairs("yonsei1").length') >= 1, '存在个人混淆记录（实测 ' + window.eval('getPersonalPairs("yonsei1").length') + ' 组）')
  ok(window.localStorage.getItem('ys-confusions') !== null, 'ys-confusions 已写入 localStorage')
  window.confirm = () => true
  window.alert = () => {}
  window.resetAllData()
  ok(window.localStorage.getItem('ys-confusions') === null, '清除后 ys-confusions 已从 localStorage 删除（不留空壳 key）')
  ok(window.localStorage.getItem('yonsei-study-data') === null, '清除后 yonsei-study-data 已删除')
  ok(window.eval('getPersonalPairs("yonsei1").length') === 0, '内存混淆关系已清空（clearConfusions 生效，不残留旧数据）')
  ok(window.eval('Object.keys(srs).length') === 0, 'SRS 内存已清空')

  server.close()
  console.log('')
  console.log('═══ 结果：' + passed + ' 通过 / ' + failed + ' 失败 ═══')
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => { console.error('脚本异常: ' + e.message); process.exit(1) })
