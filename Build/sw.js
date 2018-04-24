/* global caches */
const CACHE_VERSION = 'a';

const CURRENT_CACHES = {
  offline: 'offline-v' + CACHE_VERSION
};

var urlsToCache = [
  // ADDME: Add paths and URLs to pull from cache first if it has been loaded before. Else fetch from network.
  // If loading from cache, fetch from network in the background to update the resource. Examples:
  // 'assets/img/logo.png',
  // 'assets/models/controller.gltf',
  'Build/Build/Build.asm.code.unityweb',
  'Build/Build/Build.asm.framework.unityweb',
  'Build/Build/Build.asm.memory.unityweb',
  'Build/Build/Build.data.unityweb',
  'Build/Build/Build.json',
  'Build/Build/Build.wasm.code.unityweb',
  'Build/Build/Build.wasm.framework.unityweb',
  'Build/Build/UnityLoader.js',
  'favicon.ico',
  'index.html',
  'lib/telemetry.js',
  'manifest.webmanifest',
  'motion-controllers.png',
  'mousedrag.png',
  'styles/webvr.css',
  'vendor/gl-matrix-min.js',
  'vendor/webvr-polyfill.min.js',
  'vr.png',
  'webvr.js'
];

var urlsToAttemptNetworkFirst = [
  // ADDME: Add paths and URLs to pull from network first. Otherwise, we fall back to the other caching policies.
];

let cacheUrls = urlsToCache.concat(urlsToAttemptNetworkFirst);

self.addEventListener('install', event => {
  console.log('The service worker is being installed.');
  event.waitUntil(
    caches.open(CURRENT_CACHES.offline).then(cache => {
      return cache.addAll(cacheUrls);
    }).catch(err => {
      console.error('[Service Worker] failed to cache upon "install" event:', err);
    })
  );
});

self.addEventListener('activate', event => {
  // Delete all caches that aren't named in `CURRENT_CACHES`.
  // While there is only one cache in this example, the same logic will handle the case where
  // there are multiple versioned caches.
  let expectedCacheNames = Object.keys(CURRENT_CACHES).map(key => {
    return CURRENT_CACHES[key];
  });
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (expectedCacheNames.includes(cacheName)) {
            // If this cache name isn't present in the array of "expected" cache names, then delete it.
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

self.addEventListener('fetch', event => {
  // We want to call `event.respondWith()` if this is only a navigation request for an HTML page.
  // request.mode of 'navigate' is unfortunately not supported in Chrome
  // versions older than 49, so we need to include a less precise fallback,
  // which checks for a GET request with an Accept: text/html header.

  console.log('Handling fetch event for', event.request.url);

  if (event.request.mode !== 'navigate' && event.request.method !== 'GET') {
    console.log('    Bailing');
    return;
  }

  console.log('    Proceeding');

  event.respondWith(
    caches.open(CURRENT_CACHES.offline).then(cache => {
      return cache.match(event.request).then(response => {
        if (response) {
          // If there is an entry in the cache for event.request, then response will be defined
          // and we can just return it.
          console.log(' Found response in cache:', response);
          return response;
        }

        // Otherwise, if there is no entry in the cache for event.request, response will be
        // undefined, and we need to fetch() the resource.
        console.log(' No response for %s found in cache. About to fetch from network …', event.request.url);

        // We call .clone() on the request since we might use it in the call to cache.put() later on.
        // Both fetch() and cache.put() "consume" the request, so we need to make a copy.
        // (see https://fetch.spec.whatwg.org/#dom-request-clone)
        return fetch(event.request.clone()).then(response => {
          console.log('  Response for %s from network is: %O', event.request.url, response);

          // Optional: add in extra conditions here, e.g. response.type == 'basic' to only cache
          // responses from the same domain. See https://fetch.spec.whatwg.org/#concept-response-type
          if (response.status < 400) {
            // This avoids caching responses that we know are errors (i.e. HTTP status code of 4xx or 5xx).
            // One limitation is that, for non-CORS requests, we get back a filtered opaque response
            // (https://fetch.spec.whatwg.org/#concept-filtered-response-opaque) which will always have a
            // .status of 0, regardless of whether the underlying HTTP call was successful. Since we're
            // blindly caching those opaque responses, we run the risk of caching a transient error response.
            //
            // We need to call .clone() on the response object to save a copy of it to the cache.
            // (https://fetch.spec.whatwg.org/#dom-request-clone)
            cache.put(event.request, response.clone());
          }

          // Return the original response object, which will be used to fulfill the resource request.
          return response;
        });
      }).catch(err => {
        // This catch() will handle exceptions that arise from the match() or fetch() operations.
        // Note that a HTTP error response (e.g., 404) will NOT trigger an exception.
        // It will return a normal response object that has the appropriate error code set.
        console.error('  Read-through caching failed:', err);
        throw err;
      });
    })
  );


  // if (event.request.mode === 'navigate' || event.request.method === 'GET') {
  //   // event.respondWith(
  //   //   fetch(event.request).catch(function(error) {
  //   //     // An error will most likely happen due to the server being unreachable.
  //   //     // If `fetch()` returns a valid HTTP response (i.e., a response code in the 4XX–5XX range), then the `catch`
  //   //     // *not* be called. If you need custom handling for 4XX–5XX errors:
  //   //     // https://github.com/GoogleChrome/samples/tree/gh-pages/service-worker/fallback-response
  //   //     return caches.match(OFFLINE_URL);
  //   //   })
  //   // );
  // }

  // if (event.request.mode !== 'navigate' && event.request.method !== 'GET') {
  //   return;
  // }
  // if (urlsToAttemptNetworkFirst.includes(event.request.url)) {
  //   event.respondWith(networkElseCache(event));
  // } else if (urlsToCache.includes(event.request.url)) {
  //   event.respondWith(cacheElseNetwork(event));
  // }
  // event.respondWith(fetchRequest(event.request));

  // If our `if` condition is `false`, then this "fetch" handler won't intercept the request.
  // If there are any other fetch handlers registered, they will get a chance to call
  // `event.respondWith()`. If no fetch handlers call `event.respondWith()`, the request will be
  // handled by the browser as if there were no Service Worker involvement.
});


// function fetchRequest (request, settings) {
//   settings = settings || {};
//   // settings.mode = settings.mode || 'no-cors';
//   return fetch(request);
// }
//
// function fetchAndCache (request, response) {
//    return fetchRequest(request).then(response => {
//     // Update the cache.
//     caches.open(CURRENT_CACHES.offline).then(cache => cache.put(request, response.clone()));
//     return response;
//   });
// }
//
// function cacheElseNetwork (event) {
//   return caches.match(event.request).then(response => {
//     // If a cache miss, then make a request and then cache.
//     if (!response) {
//       return fetchAndCache(event.request);
//     }
//
//     // If a cache hit, then return the cached version whilst updating the cache for this response.
//     fetchAndCache(event.request, response);
//     return response;
//   });
// }
//
// function networkElseCache (event) {
//   return caches.match(event.request).then(match => {
//     if (!match) {
//       return fetchRequest(event.request);
//     }
//     fetchAndCache();
//   });
// }
