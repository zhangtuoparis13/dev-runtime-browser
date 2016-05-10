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
import Rx from 'rx'
let iframe, iframe_auth = undefined;

const buildMsg = (hypertyComponent, msg) => {
        return {
         runtimeHypertyURL: msg.body.runtimeHypertyURL,
         status: msg.body.status,
         instance: hypertyComponent.instance,
         name: hypertyComponent.name
       }
};

const runtimeProxy = {
    requireHyperty (hypertyDescriptor){
        iframe.contentWindow.postMessage({to:'core:loadHyperty', body:{descriptor: hypertyDescriptor}}, '*')
        return new Promise((resolve, reject)=>{
            this._messages.first((e)=>e.data.to === 'runtime:loadedHyperty')
                .subscribe((e) => resolve(buildMsg(app.getHyperty(e.data.body.runtimeHypertyURL), e.data)))  
        }) 
    },

    requireProtostub (domain){
        iframe.contentWindow.postMessage({to:'core:loadStub', body:{"domain": domain}}, '*')
    },
};

const runtimeProxyFactory = function(runtimeURL, messages){
    runtimeProxy._messages = messages
    messages.filter((e)=>e.data.to === `${runtimeURL}/gui-manager` && e.data.body.method === "openURL")
            .subscribe((e) => { 
                iframe_auth.style.display = "block"
                iframe_auth.src = e.data.body.value
                let id = e.data.id 
                messages.first((e)=> e.data.to === "runtime:auth")
                        .subscribe((e) => {
                            iframe_auth.style.display = "none"
                            iframe.contentWindow.postMessage({
                                id: id,
                                to: `${runtimeURL}/idm`,
                                from: `${runtimeURL}/gui-manager`,
                                type: "response",
                                body: { type: "200", value: e.data.value }
                            }, '*')
                        })
            })     

    return runtimeProxy
}

const RethinkBrowser = {
    install: function({domain, runtimeURL, development}={}){
        if(window.location.hash && parent){
            parent.postMessage({to: "runtime:auth", value: window.location.href}, '*')
            return {then:()=>{}}
        }

        let runtimeData = this._getRuntime(runtimeURL, domain, development)
        this._messages = Rx.Observable.fromEvent(window, 'message')
        iframe = createIframe(`https://${runtimeData.domain}/.well-known/runtime/index.html?runtime=${runtimeData.url}&development=${development}`);
        iframe_auth = createIframe("about:blank")
        app.create(iframe);

        return new Promise((resolve, reject) => {
            this._messages.first((e)=>e.data.to === 'runtime:installed')
                .subscribe((e)=>resolve(runtimeProxyFactory(e.data.body.url, this._messages)))
        })
    },

    _getRuntime (runtimeURL, domain, development) {
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
