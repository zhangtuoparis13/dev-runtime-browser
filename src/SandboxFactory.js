import SandboxWorker from './SandboxWorker';
import SandboxIframe from './SandboxIframe';

//TODO: resources url dependency
function createSandbox(){
    return new SandboxWorker('../dist/context-service.js');
}

function createAppSandbox(){
}

export default { createSandbox, createAppSandbox };
