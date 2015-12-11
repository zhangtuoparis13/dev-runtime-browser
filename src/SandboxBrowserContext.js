"use strict";

var MiniBus = System.get('runtime-core').MiniBus;
var SandboxRegistry = System.get('runtime-core').SandboxRegistry;

self._miniBus = new MiniBus();
self._miniBus._onPostMessage = function(msg){
    self.postMessage(msg);
};
self.addEventListener('message', function(event){
    self._miniBus._onMessage(event.data);
});

self._registry = new SandboxRegistry(self._miniBus);
self._registry.create = function(url, sourceCode, config){
    return eval(sourceCode);
};

