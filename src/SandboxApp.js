import { Sandbox } from 'runtime-core/dist/sandbox';
import { MiniBus } from 'runtime-core/dist/minibus';
import { SandboxRegistry } from 'runtime-core/dist/sandbox';

export default class SandboxApp extends Sandbox{
   constructor(){
     super();

     window.addEventListener('message', function(e){
         if(!!!this.origin)
            this.origin = e.source;

         if(e.data.to.startsWith('core:'))
             return;

         this._onMessage(e.data);
     }.bind(this));
   }

   _onPostMessage(msg){
       this.origin.postMessage(msg, '*');
   }
}
