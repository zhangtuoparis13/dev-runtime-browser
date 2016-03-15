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
