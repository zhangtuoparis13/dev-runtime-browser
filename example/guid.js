import {ready, errorMessage} from './support';

// polyfills
import 'babel-polyfill';
import 'indexeddbshim';
import 'mutationobserver-shim';
import 'object.observe';
import 'array.observe';

import rethink from '../bin/rethink';

// reTHINK modules
// import RuntimeUA from 'runtime-core/dist/runtimeUA';

// import SandboxFactory from '../resources/sandboxes/SandboxFactory';
// let sandboxFactory = new SandboxFactory();
// let avatar = 'https://lh3.googleusercontent.com/-XdUIqdMkCWA/AAAAAAAAAAI/AAAAAAAAAAA/4252rscbv5M/photo.jpg';

// You can change this at your own domain
let domain = "localhost";
window.runtime = { "domain": domain }

// Hack because the GraphConnector jsrsasign module;
window.KJUR = {};

// Check if the document is ready
if (document.readyState === 'complete') {
  documentReady();
} else {
  window.addEventListener('onload', documentReady, false);
  document.addEventListener('DOMContentLoaded', documentReady, false);
}

var runtimeLoader;

function documentReady() {

  // ready();

  let hypertyHolder = $('.hyperties');
  hypertyHolder.removeClass('hide');

  rethink.install({"domain": domain, development: true}).then(runtimeInstalled).catch(errorMessage);
}

function runtimeInstalled(runtime) {
  console.log(runtime);
  
  runtime.addUserID('facebook.com/felix');

  //runtime.generateGUID();
  
  //let hypertyObserver = 'hyperty-catalogue://' + runtime.domain + '/.well-known/hyperty/HelloWorldObserver';

  // Load First Hyperty
  //runtime.requireHyperty(hypertyObserver).then(hypertyObserverDeployed).catch(function(reason) {
  //  errorMessage(reason);
  //});

}
