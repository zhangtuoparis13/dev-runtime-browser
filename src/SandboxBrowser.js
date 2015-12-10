import { Sandbox } from 'runtime-core';

const SANDBOX_FILE = 'SandboxBrowserContext.js';
export default class SandBoxWebWorker extends Sandbox{
   constructor(){
     super();
     if(!!Worker){
         this._worker = new Worker(SANDBOX_FILE);
         this._worker.addEventListener('message', function(e){
             this._onMessage(e.data);
         }.bind(this));
     }else{
         throw new Error('Your environment does not support worker \n', e);
     }
   }

   _onPostMessage(msg){
       this._worker.postMessage(msg);
   }
}
