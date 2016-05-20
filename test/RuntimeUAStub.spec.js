import chai from 'chai'
import RuntimeBrowser from '../src/RuntimeUAStub'

let expect = chai.expect

describe('RuntimeUAStub', function(){
    describe('getRuntime', function(){
        it('should return default runtime path and domain  if it is in production mode and receives a domain', function(){
            let runtime = RuntimeBrowser.getRuntime("", "hybroker.rethink.ptinovacao.pt",  false)
            expect(runtime.url).to.equal("https://catalogue.hybroker.rethink.ptinovacao.pt/.well-known/runtime/default", "PRODUCTION & DOMAIN")
            expect(runtime.domain).to.equal("hybroker.rethink.ptinovacao.pt")
        })

        it('should return default runtime path and domain  if it is in develop mode and receives a domain', function(){
            let runtime = RuntimeBrowser.getRuntime("", "hybroker.rethink.ptinovacao.pt", true)
            expect(runtime.domain).to.equal("hybroker.rethink.ptinovacao.pt")
            expect(runtime.url).to.equal("hyperty-catalogue://catalogue.hybroker.rethink.ptinovacao.pt/.well-known/runtime/RuntimeUA", "DEVELOP & DOMAIN")
        })

        it('should return default runtime path and domain if it is in production mode and receives a runtimeURL', function(){
            let runtime = RuntimeBrowser.getRuntime("https://catalogue.hybroker2.rethink.ptinovacao.pt/.well-known/runtime/default", "", false)
            expect(runtime.url).to.equal("https://catalogue.hybroker2.rethink.ptinovacao.pt/.well-known/runtime/default")
            expect(runtime.domain).to.equal("hybroker2.rethink.ptinovacao.pt")
        })

        it('should return default runtime path and domain if it is in develop mode and receives a runtimeURL', function(){
            let runtime = RuntimeBrowser.getRuntime("https://hybroker2.rethink.ptinovacao.pt/resources/descriptores/Runtimes.json", "", true)
            expect(runtime.url).to.equal("https://hybroker2.rethink.ptinovacao.pt/resources/descriptores/Runtimes.json")
            expect(runtime.domain).to.equal("hybroker2.rethink.ptinovacao.pt")
        })
    })
})
