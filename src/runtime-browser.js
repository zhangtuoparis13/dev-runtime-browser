import {RuntimeUA} from 'runtime-core';
import SandboxFactoryBrowser from './sandbox/SandboxFactoryBrowser';

var sandboxFactoryBrowser = new SandboxFactoryBrowser();

var runtime = new RuntimeUA(sandboxFactoryBrowser);
window.runtime = runtime;
