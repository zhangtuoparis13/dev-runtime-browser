/*jshint esnext: true */
import SandboxBrowser from './SandboxBrowser';

function createSandbox(){
    return new SandboxBrowser();
}

export default { createSandbox };
