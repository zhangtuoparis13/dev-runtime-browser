class AppSandboxBrowser {

  constructor(messageBus) {

    let _this = this;

    _this.name = 'AppSandboxBrowser';
    _this.messageBus = messageBus;

    try {

      let sandbox = document.getElementById('sandbox-iframe');

      if (!sandbox) {
        sandbox = document.createElement('iframe');
        sandbox.setAttribute('id', 'sandbox-iframe');
        sandbox.setAttribute('seamless', '');
        sandbox.setAttribute('sandbox', 'allow-scripts allow-same-origin');

        sandbox.style.display = 'none';
        document.querySelector('body').appendChild(sandbox);

        // Instantiate the application inside the AppSandbox
        var script = document.createElement('script');
        script.type = 'text/JavaScript';
        script.text = 'var callbackMessage = function(msg) { console.log(\'callback message\', msg); self.parent.postMessage(msg, \'*\'); }; self.addEventListener(\'message\', function(event){ var message = event.data; if (message.sourceCode) { eval(message.sourceCode); var code = new VertxProtoStub(message.componentURL, callbackMessage, message.configuration); code.connect(); }});';

        sandbox.contentWindow.document.getElementsByTagName('body')[0].appendChild(script);
      }

      _this.sandbox = sandbox.contentWindow;

    } catch (e) {
      throw new Error('Your environment does not support worker \n', e);
    }

  }

  deployComponent(componentSourceCode, componentURL, configuration) {

    if (!componentSourceCode) throw new Error('Component source code parameter needed!');
    if (!componentURL) throw new Error('Component url parameter needed!');
    if (!configuration) throw new Error('Configuration parameter needed!');

    let _this = this;

    return new Promise(function(resolve, reject) {

      let messageBus = _this.messageBus;
      let sandbox = _this.sandbox;

      // TODO: Replace the * domain to secure domain
      sandbox.postMessage({
        type: 'CREATE',
        sourceCode: componentSourceCode,
        componentURL: componentURL,
        configuration: configuration
      }, '*');

      sandbox.addEventListener('error', function(event) {
        reject(event);
      });

      sandbox.parent.addEventListener('message', function(event) {
        console.log('result message: ', event.data);
        messageBus.postMessage(event.data);
        resolve(event.data);
      });

    });

  }

}

export default AppSandboxBrowser;
