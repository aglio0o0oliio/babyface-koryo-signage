self.addEventListener("install",function(e){e.waitUntil(caches.open("babyface-signage-v1").then(function(c){return c.addAll(["./","./index.html","./manifest.webmanifest"]);}).catch(function(){}));});
self.addEventListener("fetch",function(e){e.respondWith(caches.match(e.request).then(function(r){return r||fetch(e.request);}));});
