class HypertyWorld {

  constructor() {
    console.log('Hyperty World');

    self.addEventListener('message', function(event) {
      console.log('message:', event);
    });

  }

  activate() {
    self.parent.postMessage({}, '*');
  }

}

export default HypertyWorld;
