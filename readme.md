# dev-runtime-browser

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
