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
import RuntimeFactory from './RuntimeFactory';
import {RuntimeCatalogueLocal} from 'service-framework/dist/RuntimeCatalogue';
import {startPoliciesGUI} from '../src/admin/policiesGUI';
import {startIdentitiesGUI} from '../src/admin/identitiesGUI';

const runtimeURL = 'hyperty-catalogue://' + window.location.hostname + '/.well-known/runtime/RuntimeUA';

function returnHyperty(source, hyperty) {
  source.postMessage({ to: 'runtime:loadedHyperty', body: hyperty }, '*');
}

function searchHyperty(runtime, descriptor) {
  let index = 0;
  let hyperty = undefined;
  while (!!hyperty) {
    if (runtime.registry.hypertiesList[index] === descriptor)
        hyperty = runtime.registry.hypertiesList[index];

    index++;
  }

  return hyperty;
}

console.log('RUNTIME: ', RuntimeFactory);
let catalogue = new RuntimeCatalogueLocal(RuntimeFactory);
catalogue.getRuntimeDescriptor(runtimeURL).then(function (descriptor) {
  eval.apply(window, [descriptor.sourcePackage.sourceCode]);

  let runtime = new RuntimeUA(RuntimeFactory, window.location.hostname);

  console.info('AQUI:', runtime.policyEngine, startPoliciesGUI);
  startPoliciesGUI(runtime.policyEngine);
  //startIdentitiesGUI(runtime.identityModule);

  window.addEventListener('message', function (event) {
    if (event.data.to === 'core:loadHyperty') {
      let descriptor = event.data.body.descriptor;
      let hyperty = searchHyperty(runtime, descriptor);

      if (hyperty) {
        returnHyperty(event.source, { runtimeHypertyURL: hyperty.hypertyURL });
      } else {
        runtime.loadHyperty(descriptor)
            .then(returnHyperty.bind(null, event.source));
      }
    } else if (event.data.to === 'core:loadStub') {
      runtime.loadStub(event.data.body.domain);
    }
  }, false);

  parent.postMessage({ to:'runtime:installed', body:{} }, '*');
});
