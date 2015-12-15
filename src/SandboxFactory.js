import SandboxWorker from './SandboxWorker';
import SandboxIframe from './SandboxIframe';

function createSandbox(){
    return new SandboxWorker();
}

function createAppSandbox(){
}

export default { createSandbox, createAppSandbox };
