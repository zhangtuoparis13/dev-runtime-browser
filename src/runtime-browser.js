import {RuntimeUA} from 'runtime-core';
import SandboxFactoryBrowser from './sandbox/SandboxFactoryBrowser';

var sandboxFactoryBrowser = new SandboxFactoryBrowser();

var runtime = new RuntimeUA(sandboxFactoryBrowser);
window.runtime = runtime;

var loadHyperty = runtime.loadHyperty('http://localhost:4000/dist/VertxProtoStub.js');
var loadStub = runtime.loadStub('hyperty-runtime://sp1/protostub/123');

Promise.all([loadHyperty, loadStub]).then(function(result) {
  console.log(resolved);
}).catch(function(reason) {
  console.log('error:', reason);
});
