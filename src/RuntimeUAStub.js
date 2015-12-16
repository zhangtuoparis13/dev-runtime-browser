import SandboxIframe from './SandboxIframe';

//TODO: notify iframe loaded, ask for resources url
let sandbox = new SandboxIframe('../dist/context-core.js');

window.rethink = {
    requireHyperty: (hypertyDescriptor)=>{
        sandbox.postMessage({to:'runtime:loadHyperty', body:{descriptor: hypertyDescriptor}})
    },

    requireProtostub: (domain)=>{
        sandbox.postMessage({to:'runtime:loadStub', body:{"domain": domain}})
    },
};
