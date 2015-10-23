class AppSandboxBrowser {

  constructor(messageBus) {

    let _this = this;

    _this.name = 'AppSandboxBrowser';
    _this.messageBus = messageBus;

    try {

      let sandbox = document.createElement('iframe');
      console.log(sandbox);

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

}

export default AppSandboxBrowser;
