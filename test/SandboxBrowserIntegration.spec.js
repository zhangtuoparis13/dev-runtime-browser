import { expect } from 'chai';
import Sandbox from '../src/SandboxBrowser';

describe('SandboxBrowser Integration Tests', function(){
    it('should manage messages with internal components - send and receive', function(done){
        this.timeout(0);
        var sandbox = new Sandbox('base/test/resources/environment.js');

        setTimeout(()=>{
            sandbox.postMessage({to:'sandbox://internal',type:'create', body: { config:'', url: 'ua.me', sourceCode: '2+2'} }, function(msg){
                    done();
                });
        }, 1200);
    });

    xit('should create components', function(){

    });
});
