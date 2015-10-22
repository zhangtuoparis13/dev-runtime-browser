import SandboxBrowser from './SandboxBrowser';

class SandboxFactoryBrowser {

  get messageBus() {
    let _this = this;
    return _this._messageBus;
  }

  set messageBus(messageBus) {
    let _this = this;
    _this._messageBus = messageBus;
  }

  createSandbox() {
    let _this = this;
    return new SandboxBrowser(_this._messageBus);
  }

  removeSandbox() {

  }

}

export default SandboxFactoryBrowser;
