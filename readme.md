## dev-runtime-browser

###Overview
This repository contain the code necessary to execute the reTHINK runtime core in a browser. reTHINK runtime core can also be executed in other Javascript runtimes such as Node.js.

The execution of the core runtime takes place in an iFrame which isolates it from the main application runtime (the window where the App javascript code is being executed). The only way to transmit messages between the main window and the iFrame is through the ```postMessage()``` method. This way, main application javascript code can not interact with the reTHINK runtime. 

Addtionally to the iFrame, all the hyperties and protoStub will be executed as independient Web Workers (which will extend the sandBox class from the dev-core-runtime repository). This way we keep Hyperties and protoStub runtimes not directly accessible from the core runtime but using also the postMessage() mechanism.

###User view

####Setup Environment
#####Configure jspm access to runtime-core repo

1. generate token with public_repo permission enabled
2. Then execute the command below and you'll be asked for the credentials: 
 
        jspm registry config github

#####Configure dependencies

        npm install -g jspm karma-cli gulp-cli
        npm install
        jspm install

or

        npm run init-setup

#### Example of use

This repository have a folder with an use example of rethink.js. It initializes runtime and then you can use the console to invoke:

* rethink.requireHyperty(hypertyDescriptor);
* rethink.requireProtostub(domain);

To run the demo on example folder:
 - you need **live-server** running in the root folder.
 ```
 live-server --port=4000
 ```
 - in your browser access to http://localhost:4000/example.

#### Distributable files
* rethink.js 
* context-core.js
* context-service.js

###Developer view    
## How does it work?

![Runtime Browser](runtime-browser.png)

####RuntimeUAStub responsibilities:

1. Expose loadHyperty and loadProtoStub to **client app**.
2. if Core Sandbox doesn't exist it creates Core Sandbox.
3. Route messages from client app to core and vice versa.
4. Create **AppSandbox** when RuntimeUA set it.
    Virtually AppSandbox is created by RuntimeUA, but due to AppSandbox is running in the window context it should be created by RuntimeUAStub. RuntimeUA will send a message asking it to RuntimeUAStub.

####Core/Service Provider Sandbox responsibilities:

1. Isolate RuntimeUA from client app.
2. Manage all the communication from and to internal components.

####AppSandbox
1. Manage all the communication from and to internal components.



#### Unit Testing

Unit testing can be launched manually with **npm test**.

#### Javascript Environment

JavaScript code should be written in ES6. There are direct dependencies from nodejs and npm, these can be installed separately or in conjunction with [nvm](https://github.com/creationix/nvm)

#### Dependencies

-   nodejs
-   npm
-   karma - Make the communication between unit test tool and jenkins. See more on [karma](http://karma-runner.github.io/0.13/index.html)
-   mocha - Unit test tool. See more on [http://mochajs.org](http://mochajs.org/)
-   jspm - Don't need compile the code, it uses babel (or traucer or typescript) to run ES6 code on browser. Know more in [jspm.io](http://jspm.io/)
-   gulp - Automate and enhance your workflow. See more about gulp on [gulp](http://gulpjs.com/)

#### Code Style and Hinting

On the root directory you will find **.jshintrc**, this file is a helper to maintain syntax consistency, it signals syntax mistakes and makes the code equal for all developers.

-   [jshint](http://jshint.com/) - Detect errors and potential problems in JavaScript code.

All IDE's and Text Editors can handle these tools.



