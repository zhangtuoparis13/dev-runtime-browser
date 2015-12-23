import { Sandbox } from 'runtime-core/dist/sandbox';
import { MiniBus } from 'runtime-core/dist/minibus';
import { SandboxRegistry } from 'runtime-core/dist/sandbox';

export default class SandboxApp extends Sandbox{
   constructor(){
     super();

     this._miniBus = new MiniBus();
     this._miniBus._onPostMessage = function(msg){
         this._onMessage(msg);
     };

     this._registry = new SandboxRegistry(this._miniBus);
     this._registry._create = function(url, sourceCode, config){
         let activate = eval(sourceCode);
         return activate(url, this._miniBus, config);
     };
   }

   _onPostMessage(msg){
       this._miniBus._onMessage(msg);
   }
}
