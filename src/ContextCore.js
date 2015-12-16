import { RuntimeUA } from 'runtime-core';
import SandboxFactory from './SandboxFactory';

let runtime = new RuntimeUA(SandboxFactory);

SandboxFactory.messageBus._onPostMessage = function(msg){
    window.postMessage(msg);
};

window.addEventListener('message', function(event){
    if(event.data.to==='runtime:loadHyperty'){
        runtime.loadHyperty(event.data.body.descriptor)
            .then((msg)=>self.postMessage(msg));
    }else if(event.data.to==='runtime:loadStub'){
        runtime.loadStub(event.data.body.domain)
            .then((msg)=>self.postMessage(msg));
    }else{
        SandboxFactory.messageBus._onMessage(event.data);
    }
}, false);

