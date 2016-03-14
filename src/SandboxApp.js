import Sandbox from 'runtime-core/src/sandbox/Sandbox';
import MiniBus from 'runtime-core/src/bus/MiniBus';
import {SandboxType} from 'runtime-core/src/sandbox/Sandbox';

export default class SandboxApp extends Sandbox{
   constructor(){
     super();

     this.type = SandboxType.NORMAL;
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
