class HelloHyperty {

  constructor(hypertyURL, bus, configuration) {

    let _this = this;
    _this.bus = bus;
    _this.configuration = configuration;
    _this.hypertyURL = hypertyURL;

    _this.bus.addListener(hypertyURL, function(msg) {
        if(_this._onMessage)
            _this._onMessage(msg);
    });

  }
  
  set onMessage(value){
      this._onMessage = value;
  }

  sendMessage(toURL, text) {

    var _this = this;

    _this.bus.postMessage({
        from: _this.hypertyURL,
        to: toURL,
        type: 'MESSAGE',

        body: {
          value: text
        }
    });

  }

}

export default function activate(hypertyURL, bus, configuration) {

  return {
    hypertyName: 'HelloHyperty',
    hypertyCode: new HelloHyperty(hypertyURL, bus, configuration)
  };

}
