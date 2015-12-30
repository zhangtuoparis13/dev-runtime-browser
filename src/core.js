import {RuntimeUA} from 'runtime-core/dist/runtime-core';
import SandboxFactory from './SandboxFactory';

let runtime = new RuntimeUA(SandboxFactory);

window.addEventListener('message', function(event){
    if(event.data.to==='runtime:loadHyperty'){
        runtime.loadHyperty(event.data.body.descriptor)
    }else if(event.data.to==='runtime:loadStub'){
        runtime.loadStub(event.data.body.domain)
    }
}, false);
