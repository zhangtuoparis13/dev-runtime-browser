import {Sandbox} from 'runtime-core/dist/sandbox';

class SandboxIframe extends Sandbox{

   constructor(scriptUrl){

     super(scriptUrl);

     this.sandbox = document.getElementById('sandbox');

     if(!!!this.sandbox){
        this.sandbox = document.createElement('iframe');
        this.sandbox.setAttribute('id', 'sandbox');
        this.sandbox.setAttribute('seamless', '');
        this.sandbox.setAttribute('url', 'http://127.0.0.1:8080/example/');
        this.sandbox.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
        this.sandbox.style.display = 'none';
        document.querySelector('body').appendChild(this.sandbox);

        let script = document.createElement('script');
        script.type = 'text/JavaScript';
        script.src = scriptUrl;
        this.sandbox.contentWindow.document.getElementsByTagName('body')[0].appendChild(script);
     }

     window.addEventListener('message', function(e){
         this._onMessage(e.data);
     }.bind(this));
   }

   _onPostMessage(msg){
       this.sandbox.contentWindow.postMessage(msg, '*');
   }
}

export default SandboxIframe;
