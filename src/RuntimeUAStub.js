/**
* Copyright 2016 PT Inovação e Sistemas SA
* Copyright 2016 INESC-ID
* Copyright 2016 QUOBIS NETWORKS SL
* Copyright 2016 FRAUNHOFER-GESELLSCHAFT ZUR FOERDERUNG DER ANGEWANDTEN FORSCHUNG E.V
* Copyright 2016 ORANGE SA
* Copyright 2016 Deutsche Telekom AG
* Copyright 2016 Apizee
* Copyright 2016 TECHNISCHE UNIVERSITAT BERLIN
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*   http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
**/
import app from './ContextApp';
import URI from 'urijs';
import { create as createIframe } from './iframe';

let iframe = undefined;
let buildMsg = (hypertyComponent, msg) => {
        return {
         runtimeHypertyURL: msg.body.runtimeHypertyURL,
         status: msg.body.status,
         instance: hypertyComponent.instance,
         name: hypertyComponent.name
       }
};

let runtimeProxy = {
    requireHyperty: (hypertyDescriptor)=>{
        return new Promise((resolve, reject)=>{
            let loaded = (e)=>{
                if(e.data.to === 'runtime:loadedHyperty'){
                    window.removeEventListener('message', loaded);
                    resolve(buildMsg(app.getHyperty(e.data.body.runtimeHypertyURL), e.data));
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

let RethinkBrowser = {
    install: function({domain, runtimeURL, development}={}){
        return new Promise((resolve, reject)=>{
            let runtime = this.getRuntime(runtimeURL, domain, development)
            iframe = createIframe(`https://${runtime.domain}/.well-known/runtime/index.html?runtime=${runtime.url}&development=${development}`);
            let installed = (e)=>{
                if(e.data.to === 'runtime:installed'){
                    window.removeEventListener('message', installed);
                    resolve(runtimeProxy);
                }
            };
            window.addEventListener('message', installed);
            app.create(iframe);
        });
    },

    getRuntime (runtimeURL, domain, development) {
        if(!!development){
            runtimeURL = runtimeURL || 'hyperty-catalogue://catalogue.' + domain + '/.well-known/runtime/RuntimeUA' //`https://${domain}/resources/descriptors/Runtimes.json`
            domain = domain || new URI(runtimeURL).host()
        }else{
            runtimeURL = runtimeURL || `https://catalogue.${domain}/.well-known/runtime/default`
            domain = domain || new URI(runtimeURL).host().replace("catalogue.", "")
        }

        return {
            "url": runtimeURL,
            "domain": domain
        }
    }
};

export default RethinkBrowser
