import Sandbox from 'runtime-core/src/sandbox/Sandbox';
import SandboxRegistry from 'runtime-core/src/sandbox/SandboxRegistry';
import MiniBus from 'runtime-core/src/bus/MiniBus';

function create(iframe){
    window._miniBus = new MiniBus();
    window._miniBus._onPostMessage = function(msg){
        iframe.contentWindow.postMessage(msg, '*');
    };
    window.addEventListener('message', function(event){
        if(event.data.to.startsWith('runtime:loadedHyperty'))
            return;

        window._miniBus._onMessage(event.data);
    }, false);

    window._registry = new SandboxRegistry(window._miniBus);
    window._registry._create = function(url, sourceCode, config){
        eval(sourceCode);
        return activate(url, window._miniBus, config);
    };
};

function getHyperty(hypertyDescriptor){
    return window._registry.components[hypertyDescriptor]
};

export default { create, getHyperty };
