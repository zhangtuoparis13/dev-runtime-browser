import {RuntimeUA} from 'runtime-core/dist/runtime-core';
import SandboxFactory from './SandboxFactory';

let runtime = new RuntimeUA(SandboxFactory);

SandboxFactory.messageBus._onPostMessage = function(msg){
    window.postMessage(msg, '*');
};

window.addEventListener('message', function(event){
    if(event.data.to==='runtime:loadHyperty'){
        runtime.loadHyperty(event.data.body.descriptor)
            .then((msg)=>event.source.postMessage(msg, '*'));
    }else if(event.data.to==='runtime:loadStub'){
        runtime.loadStub(event.data.body.domain)
            .then((msg)=>event.source.postMessage(msg, '*'));
    }else{
        SandboxFactory.messageBus._onMessage(event.data);
    }
}, false);
