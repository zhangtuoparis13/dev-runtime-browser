const SANDBOX_FILE = 'Sandbox.js'

function createSandbox(){
    return new Worker(SANDBOX_FILE)
}

export default { createSandbox }
