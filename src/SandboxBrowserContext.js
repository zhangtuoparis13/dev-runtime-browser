import { MiniBus } from 'runtime-core';
import { SandboxRegistry } from 'runtime-core';

self._miniBus = new MiniBus();
self._miniBus._onPostMessage = function(msg){
    self.postMessage(msg);
};
self.addEventListener('message', function(event){
    self._miniBus._onMessage(event.data);
});

self._registry = new SandboxRegistry(self._miniBus);
self._registry._create = function(url, sourceCode, config){
    return eval(sourceCode);
};

