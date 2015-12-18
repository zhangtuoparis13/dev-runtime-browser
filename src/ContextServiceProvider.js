import { MiniBus } from 'runtime-core';
import { SandboxRegistry } from 'runtime-core';

self._miniBus = new MiniBus();
self._miniBus._onPostMessage = function(msg){
    let response = {
        body:{
                code: msg.body.code,
                desc: msg.body.desc?msg.body.desc.toString():null
             },
        from: msg.from,
        to: msg.to,
        id: msg.id,
        type: msg.type
    };

    self.postMessage(response);
};
self.addEventListener('message', function(event){
    self._miniBus._onMessage(event.data);
});

self._registry = new SandboxRegistry(self._miniBus);
self._registry._create = function(url, sourceCode, config){
    let activate = eval(sourceCode);
    //TODO: temp hack
    if(VertxProtoStub)
        return new VertxProtoStub(url, self._miniBus, config);
    return activate(url, self._miniBus, config);
};

