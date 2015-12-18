let postMessage = (msg)=>window.postMessage(msg);

let addListener = (url, callback)=>window.addEventListener('message', 
        (e)=>{
            if(e.data.to === 'core:deployResponse')
                return;
            callback
        });

let deployComponent = (sourceCode, url, config)=>{
    return new Promise((resolve, rejected) => {
        window.addEventListener('message',function deployResponse(e){
            if(e.data.to === 'core:deployResponse'){
                window.removeEventListener('message', deployResponse);
                if(e.data.response === 'deployed')
                    resolve('deployed');
                else
                    reject(e.data.response);
            }
        });

        window.postMessage({
                            to:'sandboxApp:deploy', 
                            body: {
                                "sourceCode": sourceCode,
                                "url": url,
                                "config": config
                            }
        });
    });
};

export default { postMessage, addListener, deployComponent };
