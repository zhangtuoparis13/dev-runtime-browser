import { expect } from 'chai'
import sandboxFactory from '../src/SandBoxFactory'

describe('SandBoxBrowser', function(){
    describe('create sandbox browser', function(){
        it('should return a web worker object', function(){
            let sandbox = sandboxFactory.createSandbox()

            expect(sandbox).to.be.a('Worker')
        })
    })
})
