var AM_SW_VERSION='am-v4-stage4.18.4-cards-20261009';
self.addEventListener('install',function(){self.skipWaiting()});
self.addEventListener('activate',function(event){event.waitUntil(self.clients.claim())});
self.addEventListener('message',function(event){if(event.data&&event.data.type==='AM_SW_VERSION'&&event.source){event.source.postMessage({type:'AM_SW_VERSION',version:AM_SW_VERSION})}});
// La V4 usa Apps Script desde el frontend. El service worker no intercepta ni almacena datos del backend.
self.addEventListener('fetch',function(){});
