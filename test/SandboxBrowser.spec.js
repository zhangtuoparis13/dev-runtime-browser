/*jshint esnext: true */
import { expect } from 'chai';
import sandboxFactory from '../src/SandBoxFactory';

let init, post, sendMessage;

window.Worker = function(){
    init = true;
    return {
        addEventListener: function(msg, callback) {
                            sendMessage = callback; 
                          },
        postMessage: function(msg) {
            post = true;
        }
    };
};

describe('SandBoxBrowser', function(){
    beforeEach(function(){
        init = false;
        post = false;
        sendMessage = undefined;
    });

    it('should instantiate a web worker object', function(){
        let sandbox = sandboxFactory.createSandbox();

        expect(init).to.be.true;
    });

    it('should send outside messages to web worker', function(){
        let sandbox = sandboxFactory.createSandbox();
        
        sandbox.postMessage({header:{}});
        expect(post).to.be.true;
    });

    it('should receive inside messages from web worker', function(done){
        let sandbox = sandboxFactory.createSandbox();
        sandbox.addListener('ua.me/mock', function(msg){
            done();
        });
        sendMessage({data: {to:'ua.me/mock'}});
    });
});
