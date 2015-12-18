import SandboxIframe from './SandboxIframe';
import SandboxApp from './SandboxApp';

//TODO: notify iframe loaded, ask for resources url
let core = new SandboxIframe('../dist/context-core.js');
let app = new SandboxApp();

core.addListener('*', function(e){
    console.log('CORE->RUNTIMESTUB: ' + JSON.stringify(e));
    if(e.to === 'sandboxApp:deploy'){
        app.deployComponent(e.data.body.sourceCode, e.data.body.url, e.data.body.config)
            .then((response)=>core.postMessage({to:'core:deployResponse', body:{"response": response}}));
        return;
    }
    app.postMessage(e);
});

app.addListener('*', function(e){
    console.log('RUNTIMESTUB->CORE: ' + JSON.stringify(e));
    core.postMessage(e);
});

window.rethink = {
    requireHyperty: (hypertyDescriptor)=>{
        core.postMessage({to:'runtime:loadHyperty', body:{descriptor: hypertyDescriptor}})
    },

    requireProtostub: (domain)=>{
        core.postMessage({to:'runtime:loadStub', body:{"domain": domain}})
    },
};
