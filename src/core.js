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
import URI from 'urijs';
import RuntimeFactory from './RuntimeFactory';

function returnHyperty(source, hyperty){
    source.postMessage({to: 'runtime:loadedHyperty', body: hyperty}, '*')
}

function searchHyperty(runtime, descriptor){
    let hyperty = undefined;
    let index = 0;
    while(!!hyperty){
        if(runtime.registry.hypertiesList[index]=== descriptor) 
            hyperty = runtime.registry.hypertiesList[index]

        index++
    }

    return hyperty;
}

let parameters = new URI(window.location).search(true)
let runtimeURL = parameters.runtime
let development = !!parameters.development
let catalogue = RuntimeFactory.createRuntimeCatalogue(development)

catalogue.getRuntimeDescriptor(runtimeURL)
    .then(function(descriptor){
        let sourcePackageURL = descriptor.sourcePackageURL;
        if (sourcePackageURL === '/sourcePackage') {
            return descriptor.sourcePackage;
        }

        return catalogue.getSourcePackageFromURL(sourcePackageURL);
    })
    .then(function(sourcePackage){
        eval.apply(window,[sourcePackage.sourceCode])

        let runtime = new Runtime(RuntimeFactory, window.location.host);
        runtime.messageBus.addListener(`${runtime.runtimeURL}/gui-manager`,(e)=>{
            parent.postMessage(e, '*')
        })
        window.addEventListener('message', function(event){
            if(event.data.to==='core:loadHyperty'){
                let descriptor = event.data.body.descriptor;
                let hyperty = searchHyperty(runtime, descriptor);

                if(hyperty){
                    returnHyperty(event.source, {runtimeHypertyURL: hyperty.hypertyURL});
                }else{
                    runtime.loadHyperty(descriptor)
                        .then(returnHyperty.bind(null, event.source));
                }
            }else if(event.data.to==='core:loadStub'){
                runtime.loadStub(event.data.body.domain)
            }else{
                runtime.messageBus._onMessage(event.data)
            }
        }, false);
        parent.postMessage({to:'runtime:installed', body:{url:runtime.runtimeURL}}, '*');
    });
