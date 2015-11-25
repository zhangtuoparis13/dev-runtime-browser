# dev-runtime-browser

##Introduction
This repository contain the code necessary to execute the reTHINK runtime core in a browser. reTHINK runtime core can also be executed in other Javascript runtimes such as Node.js.

The execution of the core runtime takes place in an iFrame which isolates it from the main application runtime (the window where the App javascript code is being executed). The only way to transmit messages between the main window and the iFrame is through the ```postMessage()``` method. This way, main application javascript code can not interact with the reTHINK runtime. 

Addtionally to the iFrame, all the hyperties and protoStub will be executed as independient Web Workers (which will extend the sandBox class from the dev-core-runtime repository). This way we keep Hyperties and protoStub runtimes not directly accessible from the core runtime but using also the postMessage() mechanism.
    
## rethink.js
This file will contain all the code necessary to launch the iFrame.

### How to include runtime-core code into runtime-browser;

Verify these use cases:
 1. if you will create a new repository, you can use this template, and can configure your development environment;
 2. if you already have an respository cloned;

for both cases you just have run the command:

```
jspm install runtime-core=github:reTHINK-project/dev-runtime-core.git.
```

and on javascript code you need import the script like other modules;

```
import {RuntimeUA, Sandbox} from 'runtime-core';

console.log('Runtime: ', RuntimeUA);
console.log('Sandbox: ', Sandbox);

```

### Karma
if you have some problems starting the karma tests, try running this commands for the following order:

 1. ```npm uninstall karma karma-browserify karma-mocha karma-mocha-reporter karma-chrome-launcher -g```
 2. ```npm install karma-cli -g```
 3. ```npm install```
 4. ```jspm update```
