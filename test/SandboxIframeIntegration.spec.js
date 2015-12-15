import Sandbox from '../src/SandboxIframe';

describe('SandboxIframe', function(){
    //TODO: this test is a fake, only an example. Waiting for other components to be completed.
    xit('should load RuntimeUA context', function(){
        var sandbox = new Sandbox('base/test/resources/core.js');
        setTimeout(()=>{
            sandbox.postMessage({to:'ua.me', body: { config:'', url: 'ua.me', sourceCode: ''}} );
        }, 1200);
    });
});

