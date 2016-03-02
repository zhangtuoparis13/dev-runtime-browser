import RethinkBrowser from './RuntimeUAStub'

let rethink;

if( typeof window != undefined && window != null ){
    rethink = RethinkBrowser.install()
    window.rethink = rethink
}else{
    rethink = undefined
}

export default rethink
