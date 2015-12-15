import { expect } from 'chai';
import Sandbox from '../src/SandboxWorker';

describe('SandboxBrowser Integration Tests', function(){
    it('should manage messages with internal components - send and receive', function(done){
        this.timeout(0);
        var sandbox = new Sandbox('base/test/resources/serviceprovider.js');

        setTimeout(()=>{
            sandbox.postMessage({to:'sandbox://internal',type:'create', body: { config:'', url: 'ua.me', sourceCode: '(function (url, miniBus, config){ 2+2; })'} }, function(msg){
                    done();
                });
        }, 1200);
    });

    it('should create components', function(done){
        this.timeout(0);
        var sandbox = new Sandbox('base/test/resources/serviceprovider.js');
        sandbox.addListener('ua.me', function(e){
            done();
        });
        setTimeout(()=>{
            sandbox.postMessage({to:'sandbox://internal',type:'create', body: { config:'', url: 'ua.me', sourceCode: '(function (url, miniBus, config){ self.postMessage({to:"ua.me"}); })'}} );
        }, 1200);
    });

});
