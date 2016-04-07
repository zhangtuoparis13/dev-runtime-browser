import chai from 'chai'
import rethink from '../src/RuntimeLoader'

let expect = chai.expect

describe('Service framework', function(){

    describe('Require Hyperty', function(){
        it('should returns required hyperty', function(){
            let runtime = rethink.install('domain');
            let hyperty = runtime.requireHyperty('aaa')

            expect(hyperty).to.not.be.undefined;
        })
    }),

    describe('Require ProtoStub', function(){
    })

})
