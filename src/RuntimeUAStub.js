import app from './ContextApp';
import { create as createIframe } from './iframe';

let RethinkBrowser = {
    install: function(){
        var iframe = createIframe('https://localhost/dist/index.html');
        app.create(iframe);

        return {
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
    }
}

export default RethinkBrowser
