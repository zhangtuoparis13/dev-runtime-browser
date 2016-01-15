import {Sandbox, SandboxRegistry} from 'runtime-core/dist/sandbox';
import MiniBus from 'runtime-core/dist/minibus';

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
