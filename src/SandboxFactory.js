import SandboxWorker from './SandboxWorker';
import SandboxApp from './SandboxApp';

//TODO: resources url dependency
function createSandbox(){
    return new SandboxWorker('../dist/context-service.js');
}

function createAppSandbox(){
    return new SandboxApp();
}

export default { createSandbox, createAppSandbox };
