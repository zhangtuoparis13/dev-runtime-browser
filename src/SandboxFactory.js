import SandboxWorker from './SandboxWorker';
import SandboxApp from './SandboxApp';
import Request from './Request';

//TODO: resources url dependency
function createSandbox(){
    return new SandboxWorker('../dist/context-service.js');
}

function createAppSandbox(){
    return new SandboxApp();
}

function createHttpRequest() {
    let request = new Request();
    return request;
}

export default { createSandbox, createAppSandbox ,createHttpRequest};
