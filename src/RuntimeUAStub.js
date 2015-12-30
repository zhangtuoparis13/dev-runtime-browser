import { create as createApp } from './ContextApp';
import { create as createIframe } from './iframe';

var iframe = createIframe('http://127.0.0.1:8080/dist/index.html');
createApp(iframe);

window.rethink = {
    requireHyperty: (hypertyDescriptor)=>{
        iframe.contentWindow.postMessage({to:'runtime:loadHyperty', body:{descriptor: hypertyDescriptor}}, '*')
    },

    requireProtostub: (domain)=>{
        iframe.contentWindow.postMessage({to:'runtime:loadStub', body:{"domain": domain}}, '*')
    },
};
