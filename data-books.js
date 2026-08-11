/* ═══════════════════════════════════════════
   教材注册表 + 应用全局状态（多教材架构基础层）
   职责：
   - BOOKS：已加入的教材数组，每本书用 registerBook() 注册
   - PLANNED_BOOKS：规划中的教材（首页书架占位，内容未加入时显示"敬请期待"）
   - APP_STATE：当前教材状态（currentBookId）
   - APP_CONFIG：应用级配置（version / defaultBookId）
   - LESSONS / VOCAB / GRAMMAR：兼容全局，始终指向"当前教材"的数据，
     由 bindBookGlobals() 在启动 / 切书时重绑
   加载顺序：最先加载（早于 data-yonsei1.js 及各业务模块）
   ═══════════════════════════════════════════ */

const BOOKS = []

// 规划中的教材：首页书架先占位置，内容文件（data-yonseiN.js）写好后
// 用 registerBook() 注册即自动变成可学教材（然后从 PLANNED_BOOKS 移除）
const PLANNED_BOOKS = [
  { bookId: 'yonsei3', textbook: '연세 한국어 3', cn: '延世韩国语3', bookTag: '연세3' },
]

const APP_STATE = {
  currentBookId: 'yonsei1',   // 启动时由启动脚本从 ys-current-book 恢复
}

const APP_CONFIG = {
  defaultBookId: 'yonsei1',   // 默认教材（老数据无书号，一律归属此书）
  version: '1.15.11',
}

// 兼容全局：当前教材的数据指针（普通变量 + 重绑，非 getter，避免词法遮蔽陷阱）
let LESSONS = []
let VOCAB = {}
let GRAMMAR = {}

// 注册一本教材（data-yonseiN.js 在文件末尾调用）
function registerBook(book) { BOOKS.push(book) }

function getBook(bookId) { return BOOKS.find(b => b.bookId === bookId) || null }

// 当前教材对象（无则回退第一本）
function getCurrentBook() { return getBook(APP_STATE.currentBookId) || BOOKS[0] || null }

// 把当前教材的 lessons/vocab/grammar 绑定到全局变量（启动与切书时调用）
function bindBookGlobals() {
  var cb = getCurrentBook()
  if (!cb) return
  LESSONS = cb.lessons
  VOCAB = cb.vocab
  GRAMMAR = cb.grammar
}
