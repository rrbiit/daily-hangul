var CACHE = 'hangul-v21';
var FILES = [
  '.',
  'index.html',
  'style.css',
  'data.js',
  'utils.js',
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
  // 缓存优先：命中缓存立即返回（秒开），后台静默更新本站资源
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      if (cached) {
        // 已命中 → 后台更新（只更新本站资源，跨源如 Google Fonts 直接用缓存，不再重复请求）
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
      // 缓存未命中 → 走网络，成功才写入缓存；失败回退首页
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
