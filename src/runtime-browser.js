import {RuntimeUA} from 'runtime-core';
import SandboxFactoryBrowser from './sandbox/SandboxFactoryBrowser';

var sandboxFactoryBrowser = new SandboxFactoryBrowser();

var runtime = new RuntimeUA(sandboxFactoryBrowser);
window.runtime = runtime;

setTimeout(function() {
  runtime.loadStub('ptinovacao.pt').then(function(result) {
    console.log('stub loaded: ', result);
  }).catch(function(reason) {
    console.log('stub load error ', reason);
  });

  runtime.loadHyperty('http://localhost:4000/dist/HypertyHello.js').then(function(result) {
    console.log('Hyperty loaded: ', result);
  }).catch(function(reason) {
    console.log('Hyperty load error:', reason);
  });

}, 100);
