import {Sandbox} from 'runtime-core';

class SandboxBrowser extends Sandbox {

  constructor(messageBus) {

    super();

    let _this = this;

    _this.name = 'SandboxBrowser';
    _this.messageBus = messageBus;

    try {

      let blob = new Blob([SandboxCode], {type: 'text/javascript'});
      var blobURL = window.URL.createObjectURL(blob);
      let sandbox = new Worker(blobURL);

      _this.sandbox = sandbox;

    } catch (e) {
      throw new Error('Your environment does not support worker \n', e);
    }

  }

  deployComponent(componentSourceCode, componentURL, configuration) {

    if (!componentSourceCode) throw new Error('Component source code parameter needed!');
    if (!componentURL) throw new Error('Component url parameter needed!');
    if (!configuration) throw new Error('Configuration parameter needed!');

    let _this = this;
    console.log('messagebus:', _this);

    return new Promise(function(resolve, reject) {

      let messageBus = _this.messageBus;
      let sandbox = _this.sandbox;

      sandbox.postMessage({
        type: 'CREATE',
        sourceCode: componentSourceCode,
        componentURL: componentURL,
        configuration: configuration
      });

      sandbox.addEventListener('error', function(event) {
        reject(event);
      });

      sandbox.addEventListener('message', function(event) {
        messageBus.postMessage(event.data);
        resolve(event.data);
      });

    });

  }

  removeComponent(componentURL) {

    //TODO: check the sandbox code and remove the respective component;
    if (!componentURL) throw new Error('Component URL parameter needed');

    let _this = this;

    return new Promise(function(resolve, reject) {

      let sandbox = _this.sandbox;
      let messageBus = _this.messageBus;

      sandbox.postMessage({
        type: 'REMOVE',
        componentURL: componentURL
      });

      sandbox.addEventListener('error', function(event) {
        reject(event);
      });

      sandbox.addEventListener('message', function(event) {
        messageBus.postMessage(event.data);
        resolve(event.data);
      });

    });

  }

}

const SandboxCode = 'self.protoStubs = {}; self.addEventListener("message", function(event) { if (event.data.sourceCode) { eval(event.data.sourceCode); postMessage({header: {}, body: {value: "deployed", desc: "The component has been loaded."}}); } else { postMessage({header: {}, body: {value: "error", desc: "You don\'t provide any source code;"}}); } var callback = function(msg) { console.log("callback msg: ", msg); postMessage(msg); }; var protoStub = self.protoStubs[event.data.componentURL]; if (!protoStub){ self.protoStubs[event.data.componentURL] = new VertxProtoStub(event.data.componentURL, callback, event.data.configuration); protoStub = self.protoStubs[event.data.componentURL]; } switch (event.data.type) { case "CREATE": protoStub.connect(); break; case "REMOVE": console.log("REMOVE: ", protoStub); protoStub.disconnect(); break; } }); self.addEventListener("error", function(event) { postMessage({header: {}, body: {value: "error", desc: "An error has occurred when we try downloading: " + event.data}}); });';

export default SandboxBrowser;
