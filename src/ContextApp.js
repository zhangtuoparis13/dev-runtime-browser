import { MiniBus } from 'runtime-core/dist/minibus';
import { SandboxRegistry } from 'runtime-core/dist/sandbox';

export function create(iframe){
    window._miniBus = new MiniBus();
    window._miniBus._onPostMessage = function(msg){
        iframe.contentWindow.postMessage(msg, '*');
    };
    window.addEventListener('message', function(event){
        window._miniBus._onMessage(event.data);
    }, false);

    window._registry = new SandboxRegistry(window._miniBus);
    window._registry._create = function(url, sourceCode, config){
        eval(sourceCode);
        return activate(url, window._miniBus, config);
    };
};
