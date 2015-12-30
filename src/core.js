import {RuntimeUA} from 'runtime-core/dist/runtime-core';
import SandboxFactory from './SandboxFactory';

function returnHyperty(source, hyperty){
    source.postMessage({to: 'runtime:loadedHyperty', body: hyperty}, '*')
}

let runtime = new RuntimeUA(SandboxFactory);

window.addEventListener('message', function(event){
    if(event.data.to==='core:loadHyperty'){
        let descriptor = event.data.body.descriptor;
        let hyperty = runtime.registry.hypertiesList
            .find((hi, index, array)=>hi.descriptor === descriptor);
        if(hyperty){
            returnHyperty(event.source, {runtimeHypertyURL: hyperty.hypertyURL});
        }else{
            runtime.loadHyperty(descriptor)
                .then(returnHyperty.bind(null, event.source));
        }
    }else if(event.data.to==='core:loadStub'){
        runtime.loadStub(event.data.body.domain)
    }
}, false);
