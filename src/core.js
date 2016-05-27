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

function returnHyperty(source, hyperty) {
    source.postMessage({
        to: 'runtime:loadedHyperty',
        body: hyperty
    }, '*')
}

function searchHyperty(runtime, descriptor) {
    let hyperty = undefined;
    let index = 0;
    while (!!hyperty) {
        if (runtime.registry.hypertiesList[index] === descriptor)
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
    .then(function(descriptor) {
        let sourcePackageURL = descriptor.sourcePackageURL;
        if (sourcePackageURL === '/sourcePackage') {
            return descriptor.sourcePackage;
        }

        return catalogue.getSourcePackageFromURL(sourcePackageURL);
    })
    .then(function(sourcePackage) {
        eval.apply(window, [sourcePackage.sourceCode])

        let runtime = new Runtime(RuntimeFactory, window.location.host);
        window.addEventListener('message', function(event) {
            if (event.data.to === 'core:loadHyperty') {
                let descriptor = event.data.body.descriptor;
                let hyperty = searchHyperty(runtime, descriptor);

                if (hyperty) {
                    returnHyperty(event.source, {
                        runtimeHypertyURL: hyperty.hypertyURL
                    });
                } else {
                    runtime.loadHyperty(descriptor)
                        .then(returnHyperty.bind(null, event.source));
                }
            } else if (event.data.to === 'core:loadStub') {
                runtime.loadStub(event.data.body.domain)
            } else if (event.data.to === 'graph:generateGUID') {
                console.log('##try generating GUID');
                console.log(runtime.graphConnector.generateGUID());
                console.log("##GUID generated");
            } else if (event.data.to === 'graph:addUserID') {
                console.log('##try adding contact');
                console.log(runtime.graphConnector.addUserID(event.data.body.userID));
            } else if (event.data.to === 'graph:removeUserID') {
                let userID = event.data.body.userID;
                console.log('##Removing contact with userID: ' + userID);
                console.log(runtime.graphConnector.removeUserID(userID));
                console.log("UserID removed successfully");
            } else if (event.data.to === 'graph:addContact') {
                let guid = event.data.body.guid;
                let fname = event.data.body.fname;
                let lname = event.data.body.lname;
                console.log('##Inside Core: Adding a new contact with firstname: ' + fname);
                console.log(runtime.graphConnector.addContact(guid, fname, lname));
            } else if (event.data.to === 'graph:getContact') {
                let username = event.data.body.username;
                console.log("##Inside core: finding user with username: " + username);
                let user = runtime.graphConnector.getContact(username)[0];
                console.log("##User Found: \n Firtsname: " + user.firstName +
                    "\n LastName " + user.lastName +
                    "\n GUID: " + user.guid);
            } else if (event.data.to === 'graph:checkGUID') {
                let guid = event.data.body.guid;
                console.log("##Inside core: finding user with GUID: " + guid);
                let usersDirectContact = runtime.graphConnector.checkGUID(guid)[0][0];
                let usersFoF = runtime.graphConnector.checkGUID(guid)[0][1];
                if (usersDirectContact != null) {
                    console.log("User Found from its GUID: \n FirstName " + usersDirectContact.firstName +
                        "\n LastName " + usersDirectContact.lastName +
                        "\n GUID " + usersDirectContact.guid);
                } else {
                    console.log("##This user does not exist!!");
                }
            } else if (event.data.to === 'graph:removeContact') {
                let guid = event.data.body.guid;
                console.log("##Inside core: Deleting user with GUID: " + guid);
                let usersDirectContact = runtime.graphConnector.removeContact(guid);
                console.log("##User with " + guid + " is been deleted");
            } else if (event.data.to === 'graph:useGUID') {
                let seed = event.data.body.seed;
                console.log("##Inside core: generating keys using seed: " + seed);
                runtime.graphConnector.useGUID(seed);
                console.log("##Seed is created");
            } else if (event.data.to === 'graph:sendGlobalRegistryRecord') {
                let jwt = event.data.body.jwt;
                console.log("##Inside core: Sending JWT with value: " + jwt);
                console.log("##Global Registry record sent, this function returns promise object : " + runtime.graphConnector.sendGlobalRegistryRecord(jwt));
            } else if (event.data.to === 'graph:queryGlobalRegistry') {
                let guid = event.data.body.guid;
                console.log("##Inside core: Querying with GUID: " + guid);
                console.log("##Querying done and returned promise object is: " + runtime.graphConnector.queryGlobalRegistry(guid));
            } else if (event.data.to === 'graph:calculateBloomFilter1Hop') {
                console.log("##Inside bloom filter");
                console.log("##Calculating Bloom filter : " + runtime.graphConnector.calculateBloomFilter1Hop());
            } else if (event.data.to === 'graph:signGlobalRegistryRecord') {
                console.log("##Inside signing");
                console.log("##Signing and the returned JWT is : " + runtime.graphConnector.signGlobalRegistryRecord());
            }

        }, false);
        parent.postMessage({
            to: 'runtime:installed',
            body: {}
        }, '*');
    });