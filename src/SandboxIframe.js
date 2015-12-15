import { Sandbox } from 'runtime-core';

export default class SandboxIframe extends Sandbox{
   constructor(scriptUrl){
     super();
     this.sandbox = document.getElementById('sandbox');

     if(!!!this.sandbox){
        this.sandbox = document.createElement('iframe');
        this.sandbox.setAttribute('id', 'sandbox');
        this.sandbox.setAttribute('seamless', '');
        this.sandbox.setAttribute('sandbox', 'allow-scripts allow-same-origin');
        this.sandbox.style.display = 'none';
        document.querySelector('body').appendChild(this.sandbox);

        let script = document.createElement('script');
        script.type = 'text/JavaScript';
        script.src = scriptUrl;
        this.sandbox.contentWindow.document.getElementsByTagName('body')[0].appendChild(script);
     }

     this.sandbox.contentWindow.addEventListener('message', function(e){
         this._onMessage(e.data);
     }.bind(this));
   }

   _onPostMessage(msg){
       this.sandbox.contentWindow.postMessage(msg, '*');
   }
}
