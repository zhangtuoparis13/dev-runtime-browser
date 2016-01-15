import app from './ContextApp';
import { create as createIframe } from './iframe';

var iframe = createIframe('http://127.0.0.1:8080/dist/index.html');
app.create(iframe);

window.rethink = {
    requireHyperty: (hypertyDescriptor)=>{
        return new Promise((resolve, reject)=>{
            let loaded = (e)=>{
                if(e.data.to === 'runtime:loadedHyperty'){
                    window.removeEventListener('message', loaded);
                    resolve(app.getHyperty(e.data.body.runtimeHypertyURL));
                }
            };
            window.addEventListener('message', loaded);                     
            iframe.contentWindow.postMessage({to:'core:loadHyperty', body:{descriptor: hypertyDescriptor}}, '*');
        });
    },

    requireProtostub: (domain)=>{
        iframe.contentWindow.postMessage({to:'core:loadStub', body:{"domain": domain}}, '*')
    },
};
