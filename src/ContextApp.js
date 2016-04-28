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
import SandboxRegistry from 'runtime-core/src/sandbox/SandboxRegistry';
import MiniBus from 'runtime-core/src/bus/MiniBus';

function manageIDMmessages(body, iframe){
    if(body.method === 'unhideAdminPage'){
        iframe.style.display = 'block';
    }else if(body.method === 'hideAdminPage'){
        iframe.style.display = 'none';
    }
}

function create(iframe){
    window._miniBus = new MiniBus();
    window._miniBus._onPostMessage = function(msg){
        iframe.contentWindow.postMessage(msg, '*');
    };
    window.addEventListener('message', function(event){
        if(event.data.to.startsWith('runtime:loadedHyperty'))
            return;

        if(event.data.from.endsWith('idm')){
            manageIDMmessages(event.data.body, iframe)
            return
        }

        window._miniBus._onMessage(event.data);
    }, false);

    window._registry = new SandboxRegistry(window._miniBus);
    window._registry._create = function(url, sourceCode, config){
        eval.apply(window, [sourceCode]);
        return activate(url, window._miniBus, config);
    };
};

function getHyperty(hypertyDescriptor){
    return window._registry.components[hypertyDescriptor]
};

export default { create, getHyperty };
