var CACHE = 'hangul-v28';
var FILES = [
  '.',
  'index.html',
  'style.css',
  'data.js',
  'utils.js',
  'app.js',
  'study.js',
  'stats.js',
  'quiz.js',
  'manifest.json'
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(c) {
      return c.addAll(FILES);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function(e) {
  // 导航请求（index.html 应用入口）走网络优先：每次打开先取最新版，断网才回退缓存
  // ——保证版本更新刷新一次即生效，不会像纯缓存优先那样长期停留在旧版
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then(function(r) {
        if (r && r.ok) {
          var clone = r.clone();
          caches.open(CACHE).then(function(c) { c.put(e.request, clone); });
        }
        return r;
      }).catch(function() {
        return caches.match(e.request).then(function(cached) {
          return cached || caches.match('.');
        });
      })
    );
    return;
  }

  // 其它资源（CSS/JS/data.js 等）保持缓存优先：命中秒回（秒开），后台静默更新
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      if (cached) {
        // 已命中 → 后台更新（只更新本站资源，跨源资源直接用缓存，不再重复请求）
        if (e.request.url.indexOf(self.location.origin) === 0) {
          fetch(e.request).then(function(r) {
            if (r && r.ok) {
              var clone = r.clone();
              caches.open(CACHE).then(function(c) { c.put(e.request, clone); });
            }
          }).catch(function() {});
        }
        return cached;
      }
      // 缓存未命中 → 走网络，成功才写入缓存；失败仅导航回退首页
      return fetch(e.request).then(function(r) {
        if (r && r.ok) {
          var clone = r.clone();
          caches.open(CACHE).then(function(c) { c.put(e.request, clone); });
        }
        return r;
      }).catch(function() {
        // 仅导航请求回退首页；其他资源（CSS/JS/跨域字体等）失败就失败，
        // 避免把 index.html 当 CSS/JS 返回导致解析错误
        if (e.request.mode === 'navigate') { return caches.match('.'); }
        return Response.error();
      });
    })
  );
});
