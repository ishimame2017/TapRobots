// Service Worker for TapRobots.

// キャッシュの設定
const CACHE_NAME = 'TapRobots-v1';
const urlsToCache = [
  './',
  './manifest.json', /* ??? */
  './sw.js', /* ??? */
  './index.html',
  './TapRobots.js',
  './TapRobots.css',
  './icons/favicon.ico',
  './icons/TapRobots-16x16.png',
  './icons/TapRobots-32x32.png',
  './icons/TapRobots-48x48.png',
  './icons/TapRobots-192x192.png',
  './icons/TapRobots-384x384.png',
  './icons/apple-touch-icon.png',
  './lib/three.module.js',
  './lib/GLTFLoader.js',
  './models/RobotExpressive.glb',
  './models/earth.glb',
  './models/bgm_maoudamashii_8bit01.mp3',
  './models/bgm_maoudamashii_8bit02.mp3',
  './models/se_maoudamashii_onepoint01.wav',
  './models/se_maoudamashii_onepoint02.wav',
];

// インストールイベントを検知して表示
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    console.log('installing...');
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(urlsToCache);
    console.log('installed.');
  })());
});

// アクティベート時の処理。一応余計なcacheを消す。
// `await self.clients.claim();`により次の起動を
// 待たずにすぐ有効化されコントローラーになる。
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    console.log('activating...');
    const allNames = await caches.keys();
    const names = allNames.filter(name => name!==CACHE_NAME);
    await Promise.all(names.map(name => caches.delete(name)));
    await self.clients.claim();
    console.log('activated.');
  })());
});

// メインスレッドからメッセージを受け取って
// 内容によって分岐。
self.addEventListener('message', async (e) => {
  console.log("sw received a mssage: "+e.data);
  switch(e.data) {
  case 'update_cache':
    await update_cache();
    e.source.postMessage('cache updated.');
    break;
  default:
    e.source.postMessage('Your message did not recognized.');
  }
});

// キャッシュを全部消してから再度読み込ませる
async function update_cache() {
  const cache = await caches.open(CACHE_NAME);
  const reqs = await cache.keys();
  await Promise.all(reqs.map(req => cache.delete(req)));
  await cache.addAll(urlsToCache);
}

// fetchを横取りして、基本cacheで応答。
self.addEventListener('fetch', async (e) => {
  e.respondWith((async ()=> {
    let response = await caches.match(e.request);
    if (response)
      return response; // ラッキー！

    const request = e.request.clone();
    response = await fetch(request);
    if (!response || response.status !== 200 || response.type !== 'basic')
      return response; // 残念！

    const cache = await caches.open(CACHE_NAME);
    cache.put(e.request,response); // キャッシュに保存してから
    return response; // 返す
  })());
});
