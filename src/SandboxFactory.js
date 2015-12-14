import SandboxBrowser from './SandboxBrowser';

function createSandbox(){
    return new SandboxBrowser();
}

function createAppSandbox(){
}

export default { createSandbox, createAppSandbox };
