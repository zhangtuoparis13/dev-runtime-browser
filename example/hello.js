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
let avatar = 'https://lh3.googleusercontent.com/-XdUIqdMkCWA/AAAAAAAAAAI/AAAAAAAAAAA/4252rscbv5M/photo.jpg';

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

  rethink.install(domain).then(runtimeInstalled).catch(errorMessage);
}

function runtimeInstalled(runtime) {
  console.log(runtime);

  // put here the options to select observer or reporter
  let selection = $('.selection-panel');

  let helloReporter = '<button class="deploy-reporter">Hello World Reporter</button>';
  let helloObserver = '<button class="deploy-observer">Hello World Observer</button>';

  selection.append(helloReporter);
  selection.append(helloObserver);
  
  $('.deploy-reporter').on('click', (e)=>{
    console.log(runtime);
    deployReporter(runtime);
  });
  $('.deploy-observer').on('click', (e)=>{
    console.log(runtime);
    deployObserver(runtime);
  });
}
