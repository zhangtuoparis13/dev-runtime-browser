import Sandbox from 'runtime-core/src/sandbox/sandbox';
import SandboxRegistry from 'runtime-core/src/sandbox/sandboxregistry';
import MiniBus from 'runtime-core/src/bus/minibus';

self._miniBus = new MiniBus();
self._miniBus._onPostMessage = function(msg){
    self.postMessage(msg);
};
self.addEventListener('message', function(event){
    self._miniBus._onMessage(event.data);
});

self._registry = new SandboxRegistry(self._miniBus);
self._registry._create = function(url, sourceCode, config){
    eval(sourceCode);
    return activate(url, self._miniBus, config);
};
