import SandboxWorker from './SandboxWorker';
import SandboxIframe from './SandboxIframe';
import SandboxAppStub from './SandboxAppStub';

//TODO: resources url dependency
function createSandbox(){
    return new SandboxWorker('../dist/context-service.js');
}

function createAppSandbox(){
    return SandboxAppStub;
}

export default { createSandbox, createAppSandbox };
