# Getting Started

**Note:** Quobis will keep this guide updated and we will try to keep as much stable as possible. However it is a work on progress so we recommend to check it periodically and in the event you find any error when deploying the environment.

## Scenarios

### Using rethink hosted on Quobis

This is the most straightforward way to start. This server is public and can be used by the rest of partners . You only need to link rethink.js from Quobis server:

    <script src="https://rethink-app.quobis.com/.well-known/runtime/rethink.js"
    ></script>

Then you can use rethink global variable in window object to install the runtime:

    let domain = "rethink-app.quobis.com"
    let runtimeLoader = window.rethink.default.install({runtimeURL:"https://rethink-app.quobis.com/RuntimeUA", development: true}).then((runtime) => {//here go the interesting things});

Other option is to import it and use the reference to install the runtime

    import rethink from 'Rethink'
    rethink.install({runtimeURL:"https://rethink-app.quobis.com/RuntimeUA", development: true}).then((runtime) => {//here go the interesting things})

Once the runtime is installed you can require hyperties and protostubs through the runtime instance.

    runtime.requireHyperty(hyperty)
        .then(hypertyDeployed)
        .catch(function(reason) {
          errorMessage(reason);
        });


In order to test your app you can server it locally using http-server:

    sudo http-server --cors -S -p 443 -C rethink-certificate.cert -K rethink-certificate.key

### Using your own environment

The last but not the least is setup all the environment in your own server. We used an updated Ubuntu 14.04.4 LTS Server to install all the services.

#### Dev registry domain

Deploy a local instance of registry-domain. [More info...](https://github.com/reTHINK-project/dev-registry-domain/blob/master/README.md)

#### Dev msg node vertx

Deploy a local instance of msg-node. [More info..](https://github.com/reTHINK-project/dev-msg-node-vertx/blob/master/README.md)

#### Configure Runtime

You have the option to host runtime files on your own server. In this scenario the steps are pretty similar than before but changing the URIs to the right place.

The distribution files are on dev-runtime-browser@master repo, on .well-known/runtime:

* rethink.js
* index.html
* core.js
* context-service.js

One thing to take into account is the domain parameter in installation process. Runtime will look for index.html|core.js|context-service.js using this convention https://*domain*/.well-known/runtime/*distribution-file*.

Addiotionally you need to place the resources folder on the root path. The resource folder conteins hyperties and protostubs descriptors.

Finally, it is needed to configure the protostub descriptors to connect to Quobis Server:

    "configuration": {
       "url": "wss://msg-node.localhost.com:9090/ws"
     },
     
**Domain configured on runtime installation process must be the same that configured on protostaub configuration**

