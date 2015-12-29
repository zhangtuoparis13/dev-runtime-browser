"format global";
(function(global) {

  var defined = {};

  // indexOf polyfill for IE8
  var indexOf = Array.prototype.indexOf || function(item) {
    for (var i = 0, l = this.length; i < l; i++)
      if (this[i] === item)
        return i;
    return -1;
  }

  var getOwnPropertyDescriptor = true;
  try {
    Object.getOwnPropertyDescriptor({ a: 0 }, 'a');
  }
  catch(e) {
    getOwnPropertyDescriptor = false;
  }

  var defineProperty;
  (function () {
    try {
      if (!!Object.defineProperty({}, 'a', {}))
        defineProperty = Object.defineProperty;
    }
    catch (e) {
      defineProperty = function(obj, prop, opt) {
        try {
          obj[prop] = opt.value || opt.get.call(obj);
        }
        catch(e) {}
      }
    }
  })();

  function register(name, deps, declare) {
    if (arguments.length === 4)
      return registerDynamic.apply(this, arguments);
    doRegister(name, {
      declarative: true,
      deps: deps,
      declare: declare
    });
  }

  function registerDynamic(name, deps, executingRequire, execute) {
    doRegister(name, {
      declarative: false,
      deps: deps,
      executingRequire: executingRequire,
      execute: execute
    });
  }

  function doRegister(name, entry) {
    entry.name = name;

    // we never overwrite an existing define
    if (!(name in defined))
      defined[name] = entry;

    // we have to normalize dependencies
    // (assume dependencies are normalized for now)
    // entry.normalizedDeps = entry.deps.map(normalize);
    entry.normalizedDeps = entry.deps;
  }


  function buildGroups(entry, groups) {
    groups[entry.groupIndex] = groups[entry.groupIndex] || [];

    if (indexOf.call(groups[entry.groupIndex], entry) != -1)
      return;

    groups[entry.groupIndex].push(entry);

    for (var i = 0, l = entry.normalizedDeps.length; i < l; i++) {
      var depName = entry.normalizedDeps[i];
      var depEntry = defined[depName];

      // not in the registry means already linked / ES6
      if (!depEntry || depEntry.evaluated)
        continue;

      // now we know the entry is in our unlinked linkage group
      var depGroupIndex = entry.groupIndex + (depEntry.declarative != entry.declarative);

      // the group index of an entry is always the maximum
      if (depEntry.groupIndex === undefined || depEntry.groupIndex < depGroupIndex) {

        // if already in a group, remove from the old group
        if (depEntry.groupIndex !== undefined) {
          groups[depEntry.groupIndex].splice(indexOf.call(groups[depEntry.groupIndex], depEntry), 1);

          // if the old group is empty, then we have a mixed depndency cycle
          if (groups[depEntry.groupIndex].length == 0)
            throw new TypeError("Mixed dependency cycle detected");
        }

        depEntry.groupIndex = depGroupIndex;
      }

      buildGroups(depEntry, groups);
    }
  }

  function link(name) {
    var startEntry = defined[name];

    startEntry.groupIndex = 0;

    var groups = [];

    buildGroups(startEntry, groups);

    var curGroupDeclarative = !!startEntry.declarative == groups.length % 2;
    for (var i = groups.length - 1; i >= 0; i--) {
      var group = groups[i];
      for (var j = 0; j < group.length; j++) {
        var entry = group[j];

        // link each group
        if (curGroupDeclarative)
          linkDeclarativeModule(entry);
        else
          linkDynamicModule(entry);
      }
      curGroupDeclarative = !curGroupDeclarative; 
    }
  }

  // module binding records
  var moduleRecords = {};
  function getOrCreateModuleRecord(name) {
    return moduleRecords[name] || (moduleRecords[name] = {
      name: name,
      dependencies: [],
      exports: {}, // start from an empty module and extend
      importers: []
    })
  }

  function linkDeclarativeModule(entry) {
    // only link if already not already started linking (stops at circular)
    if (entry.module)
      return;

    var module = entry.module = getOrCreateModuleRecord(entry.name);
    var exports = entry.module.exports;

    var declaration = entry.declare.call(global, function(name, value) {
      module.locked = true;

      if (typeof name == 'object') {
        for (var p in name)
          exports[p] = name[p];
      }
      else {
        exports[name] = value;
      }

      for (var i = 0, l = module.importers.length; i < l; i++) {
        var importerModule = module.importers[i];
        if (!importerModule.locked) {
          for (var j = 0; j < importerModule.dependencies.length; ++j) {
            if (importerModule.dependencies[j] === module) {
              importerModule.setters[j](exports);
            }
          }
        }
      }

      module.locked = false;
      return value;
    });

    module.setters = declaration.setters;
    module.execute = declaration.execute;

    // now link all the module dependencies
    for (var i = 0, l = entry.normalizedDeps.length; i < l; i++) {
      var depName = entry.normalizedDeps[i];
      var depEntry = defined[depName];
      var depModule = moduleRecords[depName];

      // work out how to set depExports based on scenarios...
      var depExports;

      if (depModule) {
        depExports = depModule.exports;
      }
      else if (depEntry && !depEntry.declarative) {
        depExports = depEntry.esModule;
      }
      // in the module registry
      else if (!depEntry) {
        depExports = load(depName);
      }
      // we have an entry -> link
      else {
        linkDeclarativeModule(depEntry);
        depModule = depEntry.module;
        depExports = depModule.exports;
      }

      // only declarative modules have dynamic bindings
      if (depModule && depModule.importers) {
        depModule.importers.push(module);
        module.dependencies.push(depModule);
      }
      else
        module.dependencies.push(null);

      // run the setter for this dependency
      if (module.setters[i])
        module.setters[i](depExports);
    }
  }

  // An analog to loader.get covering execution of all three layers (real declarative, simulated declarative, simulated dynamic)
  function getModule(name) {
    var exports;
    var entry = defined[name];

    if (!entry) {
      exports = load(name);
      if (!exports)
        throw new Error("Unable to load dependency " + name + ".");
    }

    else {
      if (entry.declarative)
        ensureEvaluated(name, []);

      else if (!entry.evaluated)
        linkDynamicModule(entry);

      exports = entry.module.exports;
    }

    if ((!entry || entry.declarative) && exports && exports.__useDefault)
      return exports['default'];

    return exports;
  }

  function linkDynamicModule(entry) {
    if (entry.module)
      return;

    var exports = {};

    var module = entry.module = { exports: exports, id: entry.name };

    // AMD requires execute the tree first
    if (!entry.executingRequire) {
      for (var i = 0, l = entry.normalizedDeps.length; i < l; i++) {
        var depName = entry.normalizedDeps[i];
        var depEntry = defined[depName];
        if (depEntry)
          linkDynamicModule(depEntry);
      }
    }

    // now execute
    entry.evaluated = true;
    var output = entry.execute.call(global, function(name) {
      for (var i = 0, l = entry.deps.length; i < l; i++) {
        if (entry.deps[i] != name)
          continue;
        return getModule(entry.normalizedDeps[i]);
      }
      throw new TypeError('Module ' + name + ' not declared as a dependency.');
    }, exports, module);

    if (output)
      module.exports = output;

    // create the esModule object, which allows ES6 named imports of dynamics
    exports = module.exports;
 
    if (exports && exports.__esModule) {
      entry.esModule = exports;
    }
    else {
      entry.esModule = {};
      
      // don't trigger getters/setters in environments that support them
      if ((typeof exports == 'object' || typeof exports == 'function') && exports !== global) {
        if (getOwnPropertyDescriptor) {
          var d;
          for (var p in exports)
            if (d = Object.getOwnPropertyDescriptor(exports, p))
              defineProperty(entry.esModule, p, d);
        }
        else {
          var hasOwnProperty = exports && exports.hasOwnProperty;
          for (var p in exports) {
            if (!hasOwnProperty || exports.hasOwnProperty(p))
              entry.esModule[p] = exports[p];
          }
         }
       }
      entry.esModule['default'] = exports;
      defineProperty(entry.esModule, '__useDefault', {
        value: true
      });
    }
  }

  /*
   * Given a module, and the list of modules for this current branch,
   *  ensure that each of the dependencies of this module is evaluated
   *  (unless one is a circular dependency already in the list of seen
   *  modules, in which case we execute it)
   *
   * Then we evaluate the module itself depth-first left to right 
   * execution to match ES6 modules
   */
  function ensureEvaluated(moduleName, seen) {
    var entry = defined[moduleName];

    // if already seen, that means it's an already-evaluated non circular dependency
    if (!entry || entry.evaluated || !entry.declarative)
      return;

    // this only applies to declarative modules which late-execute

    seen.push(moduleName);

    for (var i = 0, l = entry.normalizedDeps.length; i < l; i++) {
      var depName = entry.normalizedDeps[i];
      if (indexOf.call(seen, depName) == -1) {
        if (!defined[depName])
          load(depName);
        else
          ensureEvaluated(depName, seen);
      }
    }

    if (entry.evaluated)
      return;

    entry.evaluated = true;
    entry.module.execute.call(global);
  }

  // magical execution function
  var modules = {};
  function load(name) {
    if (modules[name])
      return modules[name];

    // node core modules
    if (name.substr(0, 6) == '@node/')
      return require(name.substr(6));

    var entry = defined[name];

    // first we check if this module has already been defined in the registry
    if (!entry)
      throw "Module " + name + " not present.";

    // recursively ensure that the module and all its 
    // dependencies are linked (with dependency group handling)
    link(name);

    // now handle dependency execution in correct order
    ensureEvaluated(name, []);

    // remove from the registry
    defined[name] = undefined;

    // exported modules get __esModule defined for interop
    if (entry.declarative)
      defineProperty(entry.module.exports, '__esModule', { value: true });

    // return the defined module object
    return modules[name] = entry.declarative ? entry.module.exports : entry.esModule;
  };

  return function(mains, depNames, declare) {
    return function(formatDetect) {
      formatDetect(function(deps) {
        var System = {
          _nodeRequire: typeof require != 'undefined' && require.resolve && typeof process != 'undefined' && require,
          register: register,
          registerDynamic: registerDynamic,
          get: load, 
          set: function(name, module) {
            modules[name] = module; 
          },
          newModule: function(module) {
            return module;
          }
        };
        System.set('@empty', {});

        // register external dependencies
        for (var i = 0; i < depNames.length; i++) (function(depName, dep) {
          if (dep && dep.__esModule)
            System.register(depName, [], function(_export) {
              return {
                setters: [],
                execute: function() {
                  for (var p in dep)
                    if (p != '__esModule' && !(typeof p == 'object' && p + '' == 'Module'))
                      _export(p, dep[p]);
                }
              };
            });
          else
            System.registerDynamic(depName, [], false, function() {
              return dep;
            });
        })(depNames[i], arguments[i]);

        // register modules in this bundle
        declare(System);

        // load mains
        var firstLoad = load(mains[0]);
        if (mains.length > 1)
          for (var i = 1; i < mains.length; i++)
            load(mains[i]);

        if (firstLoad.__useDefault)
          return firstLoad['default'];
        else
          return firstLoad;
      });
    };
  };

})(typeof self != 'undefined' ? self : global)
/* (['mainModule'], ['external-dep'], function($__System) {
  System.register(...);
})
(function(factory) {
  if (typeof define && define.amd)
    define(['external-dep'], factory);
  // etc UMD / module pattern
})*/

(['1'], [], function($__System) {

(function(__global) {
  var loader = $__System;
  var indexOf = Array.prototype.indexOf || function(item) {
    for (var i = 0, l = this.length; i < l; i++)
      if (this[i] === item)
        return i;
    return -1;
  }

  var commentRegEx = /(\/\*([\s\S]*?)\*\/|([^:]|^)\/\/(.*)$)/mg;
  var cjsRequirePre = "(?:^|[^$_a-zA-Z\\xA0-\\uFFFF.])";
  var cjsRequirePost = "\\s*\\(\\s*(\"([^\"]+)\"|'([^']+)')\\s*\\)";
  var fnBracketRegEx = /\(([^\)]*)\)/;
  var wsRegEx = /^\s+|\s+$/g;
  
  var requireRegExs = {};

  function getCJSDeps(source, requireIndex) {

    // remove comments
    source = source.replace(commentRegEx, '');

    // determine the require alias
    var params = source.match(fnBracketRegEx);
    var requireAlias = (params[1].split(',')[requireIndex] || 'require').replace(wsRegEx, '');

    // find or generate the regex for this requireAlias
    var requireRegEx = requireRegExs[requireAlias] || (requireRegExs[requireAlias] = new RegExp(cjsRequirePre + requireAlias + cjsRequirePost, 'g'));

    requireRegEx.lastIndex = 0;

    var deps = [];

    var match;
    while (match = requireRegEx.exec(source))
      deps.push(match[2] || match[3]);

    return deps;
  }

  /*
    AMD-compatible require
    To copy RequireJS, set window.require = window.requirejs = loader.amdRequire
  */
  function require(names, callback, errback, referer) {
    // in amd, first arg can be a config object... we just ignore
    if (typeof names == 'object' && !(names instanceof Array))
      return require.apply(null, Array.prototype.splice.call(arguments, 1, arguments.length - 1));

    // amd require
    if (typeof names == 'string' && typeof callback == 'function')
      names = [names];
    if (names instanceof Array) {
      var dynamicRequires = [];
      for (var i = 0; i < names.length; i++)
        dynamicRequires.push(loader['import'](names[i], referer));
      Promise.all(dynamicRequires).then(function(modules) {
        if (callback)
          callback.apply(null, modules);
      }, errback);
    }

    // commonjs require
    else if (typeof names == 'string') {
      var module = loader.get(names);
      return module.__useDefault ? module['default'] : module;
    }

    else
      throw new TypeError('Invalid require');
  }

  function define(name, deps, factory) {
    if (typeof name != 'string') {
      factory = deps;
      deps = name;
      name = null;
    }
    if (!(deps instanceof Array)) {
      factory = deps;
      deps = ['require', 'exports', 'module'].splice(0, factory.length);
    }

    if (typeof factory != 'function')
      factory = (function(factory) {
        return function() { return factory; }
      })(factory);

    // in IE8, a trailing comma becomes a trailing undefined entry
    if (deps[deps.length - 1] === undefined)
      deps.pop();

    // remove system dependencies
    var requireIndex, exportsIndex, moduleIndex;
    
    if ((requireIndex = indexOf.call(deps, 'require')) != -1) {
      
      deps.splice(requireIndex, 1);

      // only trace cjs requires for non-named
      // named defines assume the trace has already been done
      if (!name)
        deps = deps.concat(getCJSDeps(factory.toString(), requireIndex));
    }

    if ((exportsIndex = indexOf.call(deps, 'exports')) != -1)
      deps.splice(exportsIndex, 1);
    
    if ((moduleIndex = indexOf.call(deps, 'module')) != -1)
      deps.splice(moduleIndex, 1);

    var define = {
      name: name,
      deps: deps,
      execute: function(req, exports, module) {

        var depValues = [];
        for (var i = 0; i < deps.length; i++)
          depValues.push(req(deps[i]));

        module.uri = module.id;

        module.config = function() {};

        // add back in system dependencies
        if (moduleIndex != -1)
          depValues.splice(moduleIndex, 0, module);
        
        if (exportsIndex != -1)
          depValues.splice(exportsIndex, 0, exports);
        
        if (requireIndex != -1) 
          depValues.splice(requireIndex, 0, function(names, callback, errback) {
            if (typeof names == 'string' && typeof callback != 'function')
              return req(names);
            return require.call(loader, names, callback, errback, module.id);
          });

        var output = factory.apply(exportsIndex == -1 ? __global : exports, depValues);

        if (typeof output == 'undefined' && module)
          output = module.exports;

        if (typeof output != 'undefined')
          return output;
      }
    };

    // anonymous define
    if (!name) {
      // already defined anonymously -> throw
      if (lastModule.anonDefine)
        throw new TypeError('Multiple defines for anonymous module');
      lastModule.anonDefine = define;
    }
    // named define
    else {
      // if we don't have any other defines,
      // then let this be an anonymous define
      // this is just to support single modules of the form:
      // define('jquery')
      // still loading anonymously
      // because it is done widely enough to be useful
      if (!lastModule.anonDefine && !lastModule.isBundle) {
        lastModule.anonDefine = define;
      }
      // otherwise its a bundle only
      else {
        // if there is an anonDefine already (we thought it could have had a single named define)
        // then we define it now
        // this is to avoid defining named defines when they are actually anonymous
        if (lastModule.anonDefine && lastModule.anonDefine.name)
          loader.registerDynamic(lastModule.anonDefine.name, lastModule.anonDefine.deps, false, lastModule.anonDefine.execute);

        lastModule.anonDefine = null;
      }

      // note this is now a bundle
      lastModule.isBundle = true;

      // define the module through the register registry
      loader.registerDynamic(name, define.deps, false, define.execute);
    }
  }
  define.amd = {};

  // adds define as a global (potentially just temporarily)
  function createDefine(loader) {
    lastModule.anonDefine = null;
    lastModule.isBundle = false;

    // ensure no NodeJS environment detection
    var oldModule = __global.module;
    var oldExports = __global.exports;
    var oldDefine = __global.define;

    __global.module = undefined;
    __global.exports = undefined;
    __global.define = define;

    return function() {
      __global.define = oldDefine;
      __global.module = oldModule;
      __global.exports = oldExports;
    };
  }

  var lastModule = {
    isBundle: false,
    anonDefine: null
  };

  loader.set('@@amd-helpers', loader.newModule({
    createDefine: createDefine,
    require: require,
    define: define,
    lastModule: lastModule
  }));
  loader.amdDefine = define;
  loader.amdRequire = require;
})(typeof self != 'undefined' ? self : global);

"bundle";
$__System.register('2', ['3'], function (_export) {
    var _Promise, postMessage, addListener, deployComponent;

    return {
        setters: [function (_) {
            _Promise = _['default'];
        }],
        execute: function () {
            'use strict';

            postMessage = function postMessage(msg) {
                return window.postMessage(msg);
            };

            addListener = function addListener(url, callback) {
                return window.addEventListener('message', function (e) {
                    if (e.data.to === 'core:deployResponse') return;
                    callback;
                });
            };

            deployComponent = function deployComponent(sourceCode, url, config) {
                return new _Promise(function (resolve, rejected) {
                    window.addEventListener('message', function deployResponse(e) {
                        if (e.data.to === 'core:deployResponse') {
                            window.removeEventListener('message', deployResponse);
                            if (e.data.response === 'deployed') resolve('deployed');else reject(e.data.response);
                        }
                    });

                    window.postMessage({
                        to: 'sandboxApp:deploy',
                        body: {
                            "sourceCode": sourceCode,
                            "url": url,
                            "config": config
                        }
                    });
                });
            };

            _export('default', { postMessage: postMessage, addListener: addListener, deployComponent: deployComponent });
        }
    };
});
$__System.register('4', ['5', '6', '7', '8', '9'], function (_export) {
   var Sandbox, _get, _inherits, _createClass, _classCallCheck, SandboxIframe;

   return {
      setters: [function (_5) {
         Sandbox = _5.Sandbox;
      }, function (_) {
         _get = _['default'];
      }, function (_2) {
         _inherits = _2['default'];
      }, function (_3) {
         _createClass = _3['default'];
      }, function (_4) {
         _classCallCheck = _4['default'];
      }],
      execute: function () {
         'use strict';

         SandboxIframe = (function (_Sandbox) {
            _inherits(SandboxIframe, _Sandbox);

            function SandboxIframe(scriptUrl) {
               _classCallCheck(this, SandboxIframe);

               _get(Object.getPrototypeOf(SandboxIframe.prototype), 'constructor', this).call(this);
               this.sandbox = document.getElementById('sandbox');

               if (!!!this.sandbox) {
                  this.sandbox = document.createElement('iframe');
                  this.sandbox.setAttribute('id', 'sandbox');
                  this.sandbox.setAttribute('seamless', '');
                  this.sandbox.setAttribute('sandbox', 'allow-scripts allow-same-origin');
                  this.sandbox.style.display = 'none';
                  document.querySelector('body').appendChild(this.sandbox);

                  var script = document.createElement('script');
                  script.type = 'text/JavaScript';
                  script.src = scriptUrl;
                  this.sandbox.contentWindow.document.getElementsByTagName('body')[0].appendChild(script);
               }

               window.addEventListener('message', (function (e) {
                  this._onMessage(e.data);
               }).bind(this));
            }

            _createClass(SandboxIframe, [{
               key: '_onPostMessage',
               value: function _onPostMessage(msg) {
                  this.sandbox.contentWindow.postMessage(msg, '*');
               }
            }]);

            return SandboxIframe;
         })(Sandbox);

         _export('default', SandboxIframe);
      }
   };
});
$__System.register('a', ['5', '6', '7', '8', '9'], function (_export) {
    var Sandbox, _get, _inherits, _createClass, _classCallCheck, SandboxWorker;

    return {
        setters: [function (_5) {
            Sandbox = _5.Sandbox;
        }, function (_) {
            _get = _['default'];
        }, function (_2) {
            _inherits = _2['default'];
        }, function (_3) {
            _createClass = _3['default'];
        }, function (_4) {
            _classCallCheck = _4['default'];
        }],
        execute: function () {
            'use strict';

            SandboxWorker = (function (_Sandbox) {
                _inherits(SandboxWorker, _Sandbox);

                function SandboxWorker(script) {
                    _classCallCheck(this, SandboxWorker);

                    _get(Object.getPrototypeOf(SandboxWorker.prototype), 'constructor', this).call(this);
                    if (!!Worker) {
                        this._worker = new Worker(script);
                        this._worker.addEventListener('message', (function (e) {
                            this._onMessage(e.data);
                        }).bind(this));
                        this._worker.postMessage('');
                    } else {
                        throw new Error('Your environment does not support worker \n', e);
                    }
                }

                _createClass(SandboxWorker, [{
                    key: '_onPostMessage',
                    value: function _onPostMessage(msg) {
                        this._worker.postMessage(msg);
                    }
                }]);

                return SandboxWorker;
            })(Sandbox);

            _export('default', SandboxWorker);
        }
    };
});
$__System.register('b', ['2', '4', 'a'], function (_export) {

    //TODO: resources url dependency
    'use strict';

    var SandboxAppStub, SandboxIframe, SandboxWorker;
    function createSandbox() {
        return new SandboxWorker('../dist/context-service.js');
    }

    function createAppSandbox() {
        return SandboxAppStub;
    }

    return {
        setters: [function (_2) {
            SandboxAppStub = _2['default'];
        }, function (_) {
            SandboxIframe = _['default'];
        }, function (_a) {
            SandboxWorker = _a['default'];
        }],
        execute: function () {
            _export('default', { createSandbox: createSandbox, createAppSandbox: createAppSandbox });
        }
    };
});
$__System.register('c', ['8', '9'], function (_export) {
  var _createClass, _classCallCheck, SandboxRegistry;

  return {
    setters: [function (_) {
      _createClass = _['default'];
    }, function (_2) {
      _classCallCheck = _2['default'];
    }],
    execute: function () {
      /**
       * @author micaelpedrosa@gmail.com
       * Base class to implement internal deploy manager of components.
       */

      // import MessageFactory from '../../resources/MessageFactory';

      'use strict';

      SandboxRegistry = (function () {
        /* private
        _components: <url: instance>
        */

        function SandboxRegistry(bus) {
          _classCallCheck(this, SandboxRegistry);

          var _this = this;

          _this._bus = bus;
          _this._components = {};

          // Add Message Factory
          // let messageFactory = new MessageFactory();
          // _this.messageFactory = messageFactory;

          bus.addListener(SandboxRegistry.InternalDeployAddress, function (msg) {
            //console.log('SandboxRegistry-RCV: ', msg);
            // let responseMsg = {
            //   id: msg.id, type: 'response', from: SandboxRegistry.InternalDeployAddress, to: SandboxRegistry.ExternalDeployAddress
            // };

            switch (msg.type) {
              case 'create':
                _this._onDeploy(msg);break;
              case 'delete':
                _this._onRemove(msg);break;
            }
          });
        }

        _createClass(SandboxRegistry, [{
          key: '_responseMsg',
          value: function _responseMsg(msg, code, value) {

            var _this = this;

            // let messageFactory = _this.messageFactory;

            var responseMsg = {
              id: msg.id, type: 'response', from: SandboxRegistry.InternalDeployAddress, to: SandboxRegistry.ExternalDeployAddress
            };

            // Chanege the origin message, because the response;
            // msg.from = SandboxRegistry.InternalDeployAddress;
            // msg.to = SandboxRegistry.ExternalDeployAddress;

            var body = {};
            if (code) body.code = code;
            if (value) body.desc = value;

            responseMsg.body = body;

            // return messageFactory.createResponse(msg, code, value);
            return responseMsg;
          }
        }, {
          key: '_onDeploy',
          value: function _onDeploy(msg) {
            var _this = this;
            var config = msg.body.config;
            var componentURL = msg.body.url;
            var sourceCode = msg.body.sourceCode;
            var responseCode = undefined;
            var responseDesc = undefined;

            if (!_this._components.hasOwnProperty(componentURL)) {
              try {
                _this._components[componentURL] = _this._create(componentURL, sourceCode, config);
                responseCode = 200;
              } catch (error) {
                responseCode = 500;
                responseDesc = error;
              }
            } else {
              responseCode = 500;
              responseDesc = 'Instance ' + componentURL + ' already exist!';
            }

            // Create response message with MessageFactory
            var responseMsg = _this._responseMsg(msg, responseCode, responseDesc);
            _this._bus.postMessage(responseMsg);
          }
        }, {
          key: '_onRemove',
          value: function _onRemove(msg) {
            var _this = this;
            var componentURL = msg.body.url;
            var responseCode = undefined;
            var responseDesc = undefined;

            if (_this._components.hasOwnProperty(componentURL)) {
              //remove component from the pool and all listeners
              delete _this._components[componentURL];
              _this._bus.removeAllListenersOf(componentURL);
              responseCode = 200;
            } else {
              responseCode = 500;
              responseDesc = 'Instance ' + componentURL + ' doesn\'t exist!';
            }

            var responseMsg = _this._responseMsg(msg, responseCode, responseDesc);

            _this._bus.postMessage(responseMsg);
          }

          /**
           * This method should be implemented by the internal sandbox code.
           * @param  {ComponentURL} url URL used for the instance
           * @param  {string} sourceCode Code of the component
           * @param  {Config} config Configuration parameters
           * @return {Object} Returns instance of the component or throw an error "throw 'error message'"
           */
        }, {
          key: '_create',
          value: function _create(url, sourceCode, config) {
            //implementation specific
            /* example code:
              eval(sourceCode);
              return activate(url, _this._bus, config);
            */
          }
        }, {
          key: 'components',
          get: function get() {
            return this._components;
          }
        }]);

        return SandboxRegistry;
      })();

      SandboxRegistry.ExternalDeployAddress = 'sandbox://external';
      SandboxRegistry.InternalDeployAddress = 'sandbox://internal';

      _export('default', SandboxRegistry);
    }
  };
});
$__System.register('d', ['3', '6', '7', '8', '9', 'c', 'e'], function (_export) {
  var _Promise, _get, _inherits, _createClass, _classCallCheck, SandboxRegistry, MiniBus, Sandbox;

  return {
    setters: [function (_5) {
      _Promise = _5['default'];
    }, function (_) {
      _get = _['default'];
    }, function (_2) {
      _inherits = _2['default'];
    }, function (_3) {
      _createClass = _3['default'];
    }, function (_4) {
      _classCallCheck = _4['default'];
    }, function (_c) {
      SandboxRegistry = _c['default'];
    }, function (_e) {
      MiniBus = _e['default'];
    }],
    execute: function () {
      // import MessageFactory from '../../resources/MessageFactory';

      /**
       * @author micaelpedrosa@gmail.com
       * Base class to implement external sandbox component
       */
      'use strict';

      Sandbox = (function (_MiniBus) {
        _inherits(Sandbox, _MiniBus);

        function Sandbox() {
          _classCallCheck(this, Sandbox);

          _get(Object.getPrototypeOf(Sandbox.prototype), 'constructor', this).call(this);

          var _this = this;

          // Add Message Factory
          // let messageFactory = new MessageFactory();
          // _this.messageFactory = messageFactory;
        }

        /**
         * Deploy an instance of the component into the sandbox.
         * @param  {string} componentSourceCode Component source code (Hyperty, ProtoStub, etc)
         * @param  {URL} componentURL Hyperty, ProtoStub, or any other component address.
         * @param  {Config} configuration Config parameters of the component
         * @return {Promise<string>} return deployed if successful, or any other string with an error
         */

        _createClass(Sandbox, [{
          key: 'deployComponent',
          value: function deployComponent(componentSourceCode, componentURL, configuration) {

            var _this = this;

            // let messageFactory = _this.messageFactory;

            return new _Promise(function (resolve, reject) {
              //TODO: message format is not properly defined yet
              var deployMessage = {
                type: 'create', from: SandboxRegistry.ExternalDeployAddress, to: SandboxRegistry.InternalDeployAddress,
                body: { url: componentURL, sourceCode: componentSourceCode, config: configuration }
              };

              // createMessageRequest(from, to, contextId, value, policy, idToken, accessToken, resource, signature)
              // let deployMessage = messageFactory.createMessageRequest(SandboxRegistry.ExternalDeployAddress, SandboxRegistry.InternalDeployAddress, 'deploy', {url: componentURL, sourceCode: componentSourceCode, config: configuration});

              //send message into the sandbox internals and wait for reply
              _this.postMessage(deployMessage, function (reply) {
                if (reply.body.code === 200) {
                  //is this response complaint with the spec?
                  resolve('deployed');
                } else {
                  reject(reply.body.desc);
                }
              });
            });
          }

          /**
           * Remove the instance of a previously deployed component.
           * @param  {URL} componentURL Hyperty, ProtoStub, or any other component address.
           * @return {Promise<string>} return undeployed if successful, or any other string with an error
           */
        }, {
          key: 'removeComponent',
          value: function removeComponent(componentURL) {
            var _this = this;

            return new _Promise(function (resolve, reject) {
              //TODO: message format is not properly defined yet
              var removeMessage = {
                type: 'delete', from: SandboxRegistry.ExternalDeployAddress, to: SandboxRegistry.InternalDeployAddress,
                body: { url: componentURL }
              };

              //send message into the sandbox internals and wait for reply
              _this.postMessage(removeMessage, function (reply) {
                if (reply.body.code === 200) {
                  //is this response complaint with the spec?
                  resolve('undeployed');
                } else {
                  reject(reply.body.desc);
                }
              });
            });
          }
        }]);

        return Sandbox;
      })(MiniBus);

      _export('default', Sandbox);
    }
  };
});
$__System.register('f', ['3', '8', '9'], function (_export) {
  var _Promise, _createClass, _classCallCheck, ObjectAllocation;

  return {
    setters: [function (_3) {
      _Promise = _3['default'];
    }, function (_) {
      _createClass = _['default'];
    }, function (_2) {
      _classCallCheck = _2['default'];
    }],
    execute: function () {
      'use strict';

      ObjectAllocation = (function () {
        /* private
        _url: URL
        _bus: MiniBus
        */

        /**
         * Create an Object Allocation
         * @param  {URL.URL}      url - url from who is sending the message
         * @param  {MiniBus}      bus - MiniBus used for address allocation
         */

        function ObjectAllocation(url, bus) {
          _classCallCheck(this, ObjectAllocation);

          var _this = this;

          _this._url = url;
          _this._bus = bus;
        }

        /**
         * get the URL value
         * @return {string} The url value;
         */

        _createClass(ObjectAllocation, [{
          key: 'create',

          /**
           * Ask for creation of a number of Object addresses, to the domain message node.
           * @param  {Domain} domain - Domain of the message node.
           * @param  {number} number - Number of addresses to request
           * @returns {Promise<ObjectURL>}  A list of ObjectURL's
           */
          value: function create(domain, number) {
            var _this = this;

            var msg = {
              type: 'create', from: _this._url, to: 'domain://msg-node.' + domain + '/object-address-allocation',
              body: { number: number }
            };

            return new _Promise(function (resolve, reject) {
              _this._bus.postMessage(msg, function (reply) {
                if (reply.body.code === 200) {
                  resolve(reply.body.allocated);
                } else {
                  reject(reply.body.desc);
                }
              });
            });
          }
        }, {
          key: 'url',
          get: function get() {
            return this._url;
          }
        }]);

        return ObjectAllocation;
      })();

      _export('default', ObjectAllocation);
    }
  };
});
$__System.register('10', ['8', '9', '11', 'f'], function (_export) {
  var _createClass, _classCallCheck, divideURL, deepClone, ObjectAllocation, SyncherManager;

  return {
    setters: [function (_) {
      _createClass = _['default'];
    }, function (_2) {
      _classCallCheck = _2['default'];
    }, function (_3) {
      divideURL = _3.divideURL;
      deepClone = _3.deepClone;
    }, function (_f) {
      ObjectAllocation = _f['default'];
    }],
    execute: function () {

      /**
       * @author micaelpedrosa@gmail.com
       * Core Syncronization system.
       */
      'use strict';

      SyncherManager = (function () {
        /* private
        _url: URL
        _bus: MiniBus
        _registry: Registry
        _allocator: ObjectAllocation
         _subscriptions: { ObjectURL: { owner: HypertyURL, schema: Schema, sl: MsgListener, cl: MsgListener, subs: [HypertyURL] } }
        */

        function SyncherManager(runtimeURL, bus, registry, allocator) {
          _classCallCheck(this, SyncherManager);

          var _this = this;

          //TODO: this should not be hardcoded!
          _this._domain = 'ua.pt';

          _this._bus = bus;
          _this._registry = registry;

          //TODO: these should be saved in persistence engine?
          _this._url = runtimeURL + '/sm';
          _this._objectURL = runtimeURL + '/object-allocation';
          _this._subscriptions = {};

          if (allocator) {
            _this._allocator = allocator;
          } else {
            _this._allocator = new ObjectAllocation(_this._objectURL, bus);
          }

          bus.addListener(_this._url, function (msg) {
            console.log('SyncherManager-RCV: ', msg);
            switch (msg.type) {
              case 'create':
                _this._onCreate(msg);break;
              case 'delete':
                _this._onDelete(msg);break;
            }
          });
        }

        _createClass(SyncherManager, [{
          key: '_onCreate',
          value: function _onCreate(msg) {
            var _this = this;
            var owner = msg.from;

            //TODO: 5-7 authorizeObjectCreation(owner, obj ???? )
            //TODO: other optional steps

            _this._allocator.create(_this._domain, 1).then(function (allocated) {
              //TODO: get address from address allocator ?
              var objURL = allocated[0];
              var objSubscriptorURL = objURL + '/subscription';

              //TODO: register objectURL so that it can be discovered in the network

              //register change listener
              var changeListener = _this._bus.addListener(objURL, function (msg) {
                console.log(objURL + '-RCV: ', msg);
                _this._subscriptions[objURL].subs.forEach(function (hypertyUrl) {
                  var changeMsg = deepClone(msg);
                  changeMsg.id = 0;
                  changeMsg.from = objURL;
                  changeMsg.to = hypertyUrl;

                  //forward to hyperty observer
                  _this._bus.postMessage(changeMsg);
                });
              });

              //15. add subscription listener
              var subscriptorListener = _this._bus.addListener(objSubscriptorURL, function (msg) {
                console.log(objSubscriptorURL + '-RCV: ', msg);
                switch (msg.type) {
                  case 'subscribe':
                    _this._onSubscribe(objURL, msg);break;
                  case 'unsubscribe':
                    _this._onUnSubscribe(objURL, msg);break;
                }
              });

              _this._subscriptions[objURL] = { owner: owner, sl: subscriptorListener, cl: changeListener, subs: [] };

              //all ok, send response
              _this._bus.postMessage({
                id: msg.id, type: 'response', from: msg.to, to: owner,
                body: { code: 200, resource: objURL }
              });

              //19. send create to all observers, responses will be deliver to the Hyperty owner?
              setTimeout(function () {
                //schedule for next cycle needed, because the Reporter should be available.
                msg.body.authorise.forEach(function (hypertyURL) {
                  _this._bus.postMessage({
                    type: 'create', from: owner, to: hypertyURL,
                    body: { schema: msg.body.schema, resource: objURL, value: msg.body.value }
                  });
                });
              });
            })['catch'](function (reason) {
              _this._bus.postMessage({
                id: msg.id, type: 'response', from: msg.to, to: owner,
                body: { code: 500, desc: reason }
              });
            });
          }
        }, {
          key: '_onDelete',
          value: function _onDelete(msg) {
            var _this = this;

            //TODO: where to get objectURL ?
            var objURL = '<objURL>';

            //destroy all objURL listeners
            delete _this._subscriptions[objURL];
            _this._bus.removeAllListenersOf(objURL);
            _this._bus.removeAllListenersOf(objURL + '/subscription');

            //TODO: destroy object in the registry?
          }
        }, {
          key: '_onSubscribe',
          value: function _onSubscribe(objURL, msg) {
            var _this = this;
            var hypertyUrl = msg.from;

            var subscription = _this._subscriptions[objURL];

            //27. validate if subscription already exists?
            if (subscription[hypertyUrl]) {
              var errorMsg = {
                id: msg.id, type: 'response', from: msg.to, to: hypertyUrl,
                body: { code: 500, desc: 'Subscription for (' + objURL + ' : ' + hypertyUrl + ') already exists!' }
              };

              _this._bus.postMessage(errorMsg);
              return;
            }

            //31. ask to subscribe to Syncher? (depends on the operation mode)
            //TODO: get mode from object!
            var mode = 'sub/pub';

            if (mode === 'sub/pub') {
              //forward to Hyperty owner
              var forwardMsg = {
                type: 'forward', from: _this._url, to: subscription.owner,
                body: { type: msg.type, from: msg.from, to: objURL }
              };

              if (msg.body) {
                forwardMsg.body.body = msg.body;
              }

              _this._bus.postMessage(forwardMsg, function (reply) {
                console.log('forward-reply: ', reply);
                if (reply.body.code === 200) {
                  //subscription accepted
                  _this._subscriptions[objURL].subs.push(hypertyUrl);
                }

                //send subscribe-response
                _this._bus.postMessage({
                  id: msg.id, type: 'response', from: msg.to, to: hypertyUrl,
                  body: reply.body
                });
              });
            }
          }
        }, {
          key: '_onUnSubscribe',
          value: function _onUnSubscribe(objURL, msg) {
            var _this = this;
            var hypertyUrl = msg.from;

            var subs = _this._subscriptions[objURL].subs;
            var index = subs.indexOf(hypertyUrl);
            subs.splice(index, 1);

            //TODO: send un-subscribe message to Syncher? (depends on the operation mode)
          }
        }, {
          key: 'url',
          get: function get() {
            return this._url;
          }
        }]);

        return SyncherManager;
      })();

      _export('default', SyncherManager);
    }
  };
});
$__System.register('12', ['3', '8', '9'], function (_export) {
  var _Promise, _createClass, _classCallCheck, RuntimeCatalogue;

  return {
    setters: [function (_3) {
      _Promise = _3['default'];
    }, function (_) {
      _createClass = _['default'];
    }, function (_2) {
      _classCallCheck = _2['default'];
    }],
    execute: function () {
      'use strict';

      RuntimeCatalogue = (function () {
        function RuntimeCatalogue() {
          _classCallCheck(this, RuntimeCatalogue);

          console.log('runtime catalogue');

          var _this = this;
        }

        _createClass(RuntimeCatalogue, [{
          key: 'getHypertyRuntimeURL',

          /**
          * Get hypertyRuntimeURL
          */
          value: function getHypertyRuntimeURL() {
            // TODO: check if this is real needed;
            return _hypertyRuntimeURL;
          }
        }, {
          key: '_makeExternalRequest',
          value: function _makeExternalRequest(url) {

            var _this = this;

            return new _Promise(function (resolve, reject) {

              // TODO: implementation
              // Simulate getting hypertySourceCode through the XMLHttpRequest
              // but in node this should be overrided to other method to make a
              // ajax request;
              // i think we can use a factory like we used in for the sandboxes,
              // an sandboxFactory;
              var xhr = new XMLHttpRequest();

              xhr.onreadystatechange = function (event) {
                var xhr = event.currentTarget;
                if (xhr.readyState === 4) {
                  if (xhr.status === 200) {
                    resolve(xhr.responseText);
                  } else {
                    reject(xhr.responseText);
                  }
                }
              };

              xhr.open('GET', url, true);
              xhr.send();
            });
          }

          /**
          * Get HypertyDescriptor
          */
        }, {
          key: 'getHypertyDescriptor',
          value: function getHypertyDescriptor(hypertyURL) {

            var _this = this;

            return new _Promise(function (resolve, reject) {

              //hyperty-catalogue://sp1/HelloHyperty
              var hypertyName = hypertyURL.substr(hypertyURL.lastIndexOf('/') + 1);

              var hypertyDescriptor = {
                guid: 'guid',
                id: 'idHyperty',
                classname: hypertyName,
                description: 'description of ' + hypertyName,
                kind: 'hyperty',
                catalogueURL: '....',
                sourcePackageURL: '../resources/' + hypertyName + '-sourcePackageURL.json',
                dataObject: '',
                type: '',
                messageSchema: '',
                policies: '',
                constraints: '',
                hypertyCapabilities: '',
                protocolCapabilities: ''
              };

              resolve(hypertyDescriptor);
            });
          }

          /**
          * Get hypertySourceCode
          */
        }, {
          key: 'getHypertySourcePackage',
          value: function getHypertySourcePackage(hypertyPackage) {
            var _this = this;

            return new _Promise(function (resolve, reject) {

              _this._makeExternalRequest(hypertyPackage).then(function (result) {

                try {

                  var sourcePackage = JSON.parse(result);
                  var sourceCode = window.atob(sourcePackage.sourceCode);
                  sourcePackage.sourceCode = sourceCode;

                  resolve(sourcePackage);
                } catch (e) {
                  reject(e);
                }
              })['catch'](function (reason) {
                reject(reason);
              });
            });
          }

          /**
          * Get StubDescriptor
          */
        }, {
          key: 'getStubDescriptor',
          value: function getStubDescriptor(domainURL) {

            var _this = this;

            return new _Promise(function (resolve, reject) {

              var stubDescriptor = {
                guid: 'guid',
                id: 'idProtoStub',
                classname: 'VertxProtoStub',
                description: 'description of ProtoStub',
                kind: 'hyperty',
                catalogueURL: '....',
                sourcePackageURL: '../resources/Vertx-sourcePackageURL.json',
                dataObject: '',
                type: '',
                messageSchema: '',
                configuration: {
                  url: 'wss://msg-node.ua.pt:9090/ws'
                },
                policies: '',
                constraints: '',
                hypertyCapabilities: '',
                protocolCapabilities: ''
              };

              resolve(stubDescriptor);
            });
          }

          /**
          * Get protostubSourceCode
          */
        }, {
          key: 'getStubSourcePackage',
          value: function getStubSourcePackage(sourcePackageURL) {
            var _this = this;

            return new _Promise(function (resolve, reject) {

              _this._makeExternalRequest(sourcePackageURL).then(function (result) {

                try {
                  var sourcePackage = JSON.parse(result);
                  var sourceCode = window.atob(sourcePackage.sourceCode);
                  sourcePackage.sourceCode = sourceCode;

                  resolve(sourcePackage);
                } catch (e) {
                  reject(e);
                }
              })['catch'](function (reason) {
                console.error(reason);
                reject(reason);
              });
            });
          }
        }, {
          key: 'runtimeURL',
          set: function set(runtimeURL) {
            var _this = this;
            _this._runtimeURL = runtimeURL;
          },
          get: function get() {
            var _this = this;
            return _this._runtimeURL;
          }
        }]);

        return RuntimeCatalogue;
      })();

      _export('default', RuntimeCatalogue);
    }
  };
});
$__System.register('e', ['8', '9'], function (_export) {
  var _createClass, _classCallCheck, MiniBus, MsgListener;

  return {
    setters: [function (_) {
      _createClass = _['default'];
    }, function (_2) {
      _classCallCheck = _2['default'];
    }],
    execute: function () {
      /**
      * @author micaelpedrosa@gmail.com
      * Minimal interface and implementation to send and receive messages. It can be reused in many type of components.
      * Components that need a message system should receive this class as a dependency or extend it.
      * Extensions should implement the following private methods: _onPostMessage and _registerExternalListener
      */
      'use strict';

      MiniBus = (function () {
        /* private
        _msgId: number;
        _subscriptions: <url: MsgListener[]>
         _responseTimeOut: number
        _responseCallbacks: <url+id: (msg) => void>
        */

        function MiniBus() {
          _classCallCheck(this, MiniBus);

          var _this = this;
          _this._msgId = 0;
          _this._subscriptions = {};

          _this._responseTimeOut = 3000; //default to 3s
          _this._responseCallbacks = {};

          _this._registerExternalListener();
        }

        /**
        * Register listener to receive message when "msg.to === url".
        * Special url "*" for default listener is accepted to intercept all messages.
        * @param {URL} url Address to intercept, tha is in the message "to"
        * @param {Listener} listener listener
        * @return {MsgListener} instance of MsgListener
        */

        _createClass(MiniBus, [{
          key: 'addListener',
          value: function addListener(url, listener) {
            var _this = this;

            var item = new MsgListener(_this._subscriptions, url, listener);
            var itemList = _this._subscriptions[url];
            if (!itemList) {
              itemList = [];
              _this._subscriptions[url] = itemList;
            }

            itemList.push(item);
            return item;
          }

          /**
           * Manually add a response listener. Only one listener per message ID should exist.
           * ATENTION, there is no timeout for this listener.
           * The listener should be removed with a removeResponseListener, failing to do this will result in a unreleased memory problem.
           * @param {URL} url Origin address of the message sent, "msg.from".
           * @param {number} msgId Message ID that is returned from the postMessage.
           * @param {Function} responseListener Callback function for the response
           */
        }, {
          key: 'addResponseListener',
          value: function addResponseListener(url, msgId, responseListener) {
            this._responseCallbacks[url + msgId] = responseListener;
          }

          /**
           * Remove the response listener.
           * @param {URL} url Origin address of the message sent, "msg.from".
           * @param {number} msgId  Message ID that is returned from the postMessage
           */
        }, {
          key: 'removeResponseListener',
          value: function removeResponseListener(url, msgId) {
            delete this._responseCallbacks[url + msgId];
          }

          /**
           * Remove all existent listeners for the URL
           * @param  {URL} url Address registered
           */
        }, {
          key: 'removeAllListenersOf',
          value: function removeAllListenersOf(url) {
            delete this._subscriptions[url];
          }

          /**
          * Send messages to local listeners, or if not exists to external listeners.
          * It's has an optional mechanism for automatic management of response handlers.
          * The response handler will be unregistered after receiving the response, or after response timeout (default to 3s).
          * @param  {Message} msg Message to send. Message ID is automatically added to the message.
          * @param  {Function} responseCallback Optional parameter, if the developer what's automatic response management.
          * @return {number} Returns the message ID, in case it should be needed for manual management of the response handler.
          */
        }, {
          key: 'postMessage',
          value: function postMessage(msg, responseCallback) {
            var _this = this;

            //TODO: how do we manage message ID's? Should it be a global runtime counter, or per URL address?
            //Global counter will not work, because there will be multiple MiniBus instances!
            //Per URL, can be a lot of data to maintain!
            //Maybe a counter per MiniBus instance. This is the assumed solution for now.
            if (!msg.id || msg.id === 0) {
              _this._msgId++;
              msg.id = _this._msgId;
            }

            //automatic management of response handlers
            if (responseCallback) {
              (function () {
                var responseId = msg.from + msg.id;
                _this._responseCallbacks[responseId] = responseCallback;

                setTimeout(function () {
                  var responseFun = _this._responseCallbacks[responseId];
                  delete _this._responseCallbacks[responseId];

                  if (responseFun) {
                    var errorMsg = {
                      id: msg.id, type: 'response',
                      body: { code: 'error', desc: 'Response timeout!' }
                    };

                    responseFun(errorMsg);
                  }
                }, _this._responseTimeOut);
              })();
            }

            if (!_this._onResponse(msg)) {
              var itemList = _this._subscriptions[msg.to];
              if (itemList) {
                //do not publish on default address, because of loopback cycle
                _this._publishOn(itemList, msg);
              } else {
                //if there is no listener, send to external interface
                _this._onPostMessage(msg);
              }
            }

            return msg.id;
          }

          /**
           * Helper method to bind listeners (in both directions) into other MiniBus target.
           * @param  {URL} outUrl Outbound URL, register listener for url in direction "this -> target"
           * @param  {URL} inUrl Inbound URL, register listener for url in direction "target -> this"
           * @param  {MiniBus} target The other target MiniBus
           * @return {Bound} an object that contains the properties [thisListener, targetListener] and the unbind method.
           */
        }, {
          key: 'bind',
          value: function bind(outUrl, inUrl, target) {
            var _this2 = this;

            var _this = this;

            var thisListn = _this.addListener(outUrl, function (msg) {
              target.postMessage(msg);
            });

            var targetListn = target.addListener(inUrl, function (msg) {
              _this.postMessage(msg);
            });

            return {
              thisListener: thisListn,
              targetListener: targetListn,
              unbind: function unbind() {
                _this2.thisListener.remove();
                _this2.targetListener.remove();
              }
            };
          }

          //publish on a subscription list.
        }, {
          key: '_publishOn',
          value: function _publishOn(itemList, msg) {
            itemList.forEach(function (sub) {
              sub._callback(msg);
            });
          }
        }, {
          key: '_onResponse',
          value: function _onResponse(msg) {
            var _this = this;

            if (msg.type === 'response') {
              var responseId = msg.to + msg.id;
              var responseFun = _this._responseCallbacks[responseId];
              delete _this._responseCallbacks[responseId];

              if (responseFun) {
                responseFun(msg);
                return true;
              }
            }

            return false;
          }

          //receive messages from external interface
        }, {
          key: '_onMessage',
          value: function _onMessage(msg) {
            var _this = this;

            if (!_this._onResponse(msg)) {
              var itemList = _this._subscriptions[msg.to];
              if (itemList) {
                _this._publishOn(itemList, msg);
              } else {
                //is there any "*" (default) listeners?
                itemList = _this._subscriptions['*'];
                if (itemList) {
                  _this._publishOn(itemList, msg);
                }
              }
            }
          }

          /**
           * Not public available, used by the class extension implementation, to process messages from the public "postMessage" without a registered listener.
           * Used to send the message to an external interface, like a WebWorker, IFrame, etc.
           * @param  {Message.Message} msg Message
           */
        }, {
          key: '_onPostMessage',
          value: function _onPostMessage(msg) {} /*implementation will send message to external system*/

          /**
           * Not public available, used by the class extension implementation, to process all messages that enter the MiniBus from an external interface, like a WebWorker, IFrame, etc.
           * This method is called one time in the constructor to register external listeners.
           * The implementation will probably call the "_onMessage" method to publish in the local listeners.
           * DO NOT call "postMessage", there is a danger that the message enters in a cycle!
           */

        }, {
          key: '_registerExternalListener',
          value: function _registerExternalListener() {/*implementation will register external listener and call "this._onMessage(msg)" */}
        }]);

        return MiniBus;
      })();

      MsgListener = (function () {
        /* private
        _subscriptions: <string: MsgListener[]>;
        _url: string;
        _callback: (msg) => void;
        */

        function MsgListener(subscriptions, url, callback) {
          _classCallCheck(this, MsgListener);

          var _this = this;

          _this._subscriptions = subscriptions;
          _this._url = url;
          _this._callback = callback;
        }

        _createClass(MsgListener, [{
          key: 'remove',
          value: function remove() {
            var _this = this;

            var subs = _this._subscriptions[_this._url];
            if (subs) {
              var index = subs.indexOf(_this);
              subs.splice(index, 1);

              //if there are no listeners, remove the subscription entirely.
              if (subs.length === 0) {
                delete _this._subscriptions[_this._url];
              }
            }
          }
        }, {
          key: 'url',
          get: function get() {
            return this._url;
          }
        }]);

        return MsgListener;
      })();

      _export('default', MiniBus);
    }
  };
});
$__System.register('13', ['6', '7', '8', '9', 'e'], function (_export) {
  var _get, _inherits, _createClass, _classCallCheck, MiniBus, MessageBus;

  return {
    setters: [function (_) {
      _get = _['default'];
    }, function (_2) {
      _inherits = _2['default'];
    }, function (_3) {
      _createClass = _3['default'];
    }, function (_4) {
      _classCallCheck = _4['default'];
    }, function (_e) {
      MiniBus = _e['default'];
    }],
    execute: function () {
      /**
      * Message BUS Interface is an extension of the MiniBus
      * It doesn't support the default '*' listener, instead it uses the registry.resolve(..)
      */
      'use strict';

      MessageBus = (function (_MiniBus) {
        _inherits(MessageBus, _MiniBus);

        /* private
        _registry: Registry
        */

        //TODO: future optimization
        //1. message batch processing with setInterval
        //2. resolve default gateway/protostub with register.resolve

        function MessageBus(registry) {
          _classCallCheck(this, MessageBus);

          _get(Object.getPrototypeOf(MessageBus.prototype), 'constructor', this).call(this);
          this._registry = registry;
        }

        _createClass(MessageBus, [{
          key: '_onPostMessage',
          value: function _onPostMessage(msg) {
            var _this = this;

            //resolve external protostub...
            _this._registry.resolve(msg.to).then(function (protoStubURL) {

              var itemList = _this._subscriptions[protoStubURL];
              if (itemList) {
                _this._publishOn(itemList, msg);
              }
            })['catch'](function (e) {
              console.log('PROTO-STUB-ERROR: ', e);
            });
          }
        }]);

        return MessageBus;
      })(MiniBus);

      _export('default', MessageBus);
    }
  };
});
$__System.register('14', ['3', '8', '9'], function (_export) {
  var _Promise, _createClass, _classCallCheck, PolicyEngine;

  return {
    setters: [function (_3) {
      _Promise = _3['default'];
    }, function (_) {
      _createClass = _['default'];
    }, function (_2) {
      _classCallCheck = _2['default'];
    }],
    execute: function () {
      /**
       * Core Policy Engine (PDP/PEP) Interface
       * According to: https://github.com/reTHINK-project/core-framework/blob/master/docs/specs/runtime/runtime-apis.md#core-policy-engine-pdppep-interface
       */
      'use strict';

      PolicyEngine = (function () {

        /**
        * To initialise the Policy Engine
        * @param  {Identity Module}      identityModule      identityModule
        * @param  {Runtime Registry}    runtimeRegistry     runtimeRegistry
        */

        function PolicyEngine(identityModule, runtimeRegistry) {
          _classCallCheck(this, PolicyEngine);

          var _this = this;
          _this.idModule = identityModule;
          _this.registry = runtimeRegistry;
          _this.policiesTable = new Object();
          /* assumes the Policy Engine has the blacklist */
          _this.blacklist = [];
          /* _this.blacklist.push('Alice');*/
        }

        /**
         * To add policies to be enforced for a certain deployed Hyperty Instance
         * Example of an hyperty: hyperty-instance://tecnico.pt/e1b8fb0b-95e2-4f44-aa18-b40984741196
         * Example of a policy: {subject: 'message.header.from', target: 'blacklist', action: 'deny'}
         * @param {URL.HypertyURL}     hyperty  hyperty
         * @param {HypertyPolicyList}  policies policies
         */

        _createClass(PolicyEngine, [{
          key: 'addPolicies',
          value: function addPolicies(hyperty, policies) {
            var _this = this;
            _this.policiesTable[hyperty] = policies;
          }

          /**
           * To remove previously added policies for a certain deployed Hyperty Instance
           * @param  {URL.HypertyURL}  hyperty       hyperty
           */
        }, {
          key: 'removePolicies',
          value: function removePolicies(hyperty) {
            var _this = this;
            delete _this.policiesTable[hyperty];
          }

          /**
           * Authorisation request to accept a Subscription for a certain resource. Returns a Response Message to be returned to Subscription requester
           * @param  {Message.Message} message       message
           * @return {AuthorisationResponse}                 AuthorisationResponse
           */
        }, {
          key: 'authorise',
          value: function authorise(message) {
            var _this = this;
            console.log(_this.policiesTable);
            return new _Promise(function (resolve, reject) {
              if (_this.checkPolicies(message) == 'allow') {
                /*let hypertyIdentity = _this.registry.getHypertyIdentity(message.body.hypertyURL);
                //this step assume the hypertyIdentity will be google */
                _this.idModule.loginWithRP('google identity', 'scope').then(function (value) {
                  message.body.assertedIdentity = JSON.stringify(value);
                  message.body.authorised = true;
                  resolve(message);
                }, function (error) {
                  reject(error);
                });
              } else {
                resolve(false);
              }
            });
          }
        }, {
          key: 'checkPolicies',
          value: function checkPolicies(message) {
            var _this = this;
            var _results = ['allow']; /* by default, all messages are allowed */
            var _policies = _this.policiesTable[message.body.hypertyURL];
            if (_policies != undefined) {
              /* if there are applicable policies, checks them */
              var _numPolicies = _policies.length;

              for (var i = 0; i < _numPolicies; i++) {
                var _policy = _policies[i];
                console.log(_policy);
                if (_policy.target == 'blacklist') {
                  if (_this.blacklist.indexOf(eval(_policy.subject)) > -1) {
                    console.log('Is in blacklist!');
                    _results.push(_policy.action);
                  }
                }
                if (_policy.target == 'whitelist') {
                  if (_this.whitelist.indexOf(eval(_policy.subject)) > -1) {
                    console.log('Is in whitelist!');
                    _results.push(_policy.action);
                  }
                }
              }
            }
            console.log(_results);
            if (_results.indexOf('deny') > -1) {
              /* if one policy evaluates to 'deny', the result is 'deny' */
              return 'deny';
            } else {
              return 'allow';
            }
          }
        }]);

        return PolicyEngine;
      })();

      _export('default', PolicyEngine);
    }
  };
});
$__System.register('15', ['3', '8', '9'], function (_export) {
  var _Promise, _createClass, _classCallCheck, IdentityModule;

  return {
    setters: [function (_3) {
      _Promise = _3['default'];
    }, function (_) {
      _createClass = _['default'];
    }, function (_2) {
      _classCallCheck = _2['default'];
    }],
    execute: function () {
      /**
      * IdentityModule
      *
      * Initial specification: D4.1
      *
      * The IdentityModule is a component managing user Identity. It downloads, instantiates
      * and manage Identity Provider Proxy (IdP) for its own user identity or for external
      * user identity verification.
      *
      */
      'use strict';

      IdentityModule = (function () {

        /**
        * USER'S OWN IDENTITY
        */

        function IdentityModule() {
          _classCallCheck(this, IdentityModule);
        }

        /**
        * Register a new Identity with an Identity Provider
        */

        _createClass(IdentityModule, [{
          key: 'registerIdentity',
          value: function registerIdentity() {}
          // Body...

          /**
          * In relation with a classical Relying Party: Registration
          */

        }, {
          key: 'registerWithRP',
          value: function registerWithRP() {}
          // Body...

          /**
          * In relation with a classical Relying Party: Login
          * @param  {Identifier}      identifier      identifier
          * @param  {Scope}           scope           scope
          * @return {Promise}         Promise         IDToken
          */

        }, {
          key: 'loginWithRP',
          value: function loginWithRP(identifier, scope) {

            /*
              When calling this function, if everything is fine, a small pop-up will open requesting a login with a google account. After the login is made, the pop-up will close and the function will return the ID token.
              This function was tested with the URL: http://127.0.0.1:8080/ and with the same redirect URI
             	In case the redirect URI is not accepted or is required to add others redirect URIs, a little information is provided to fix the problem:
             	So that an application can use Google's OAuth 2.0 authentication system for user login,
            	first is required to set up a project in the Google Developers Console to obtain OAuth 2.0 credentials and set a redirect URI.
            	A test account was created to set the project in the Google Developers Console to obtain OAuth 2.0 credentials,	with the following credentials:
                 	username: openidtest10@gmail.com
                   password: testOpenID10
             	To add more URI's, follow the steps:
            	1º choose the project ( can be the My OpenID Project)	 from  https://console.developers.google.com/projectselector/apis/credentials using the credentials provided above.
            	2º Open The Client Web 1 listed in OAuth 2.0 Client ID's
            	3º Add the URI  in the authorized redirect URI section.
              4º change the REDIRECT parameter bellow with the pretended URI
             */
            var VALIDURL = 'https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=';
            var USERINFURL = 'https://www.googleapis.com/oauth2/v1/userinfo?access_token=';
            var OAUTHURL = 'https://accounts.google.com/o/oauth2/auth?';
            var SCOPE = 'email%20profile';
            var CLIENTID = '808329566012-tqr8qoh111942gd2kg007t0s8f277roi.apps.googleusercontent.com';
            var REDIRECT = 'http://127.0.0.1:8080/';

            //let REDIRECT   =   document.URL.substring(0, document.URL.length - 1); //remove the '#' character
            var LOGOUT = 'http://accounts.google.com/Logout';
            var TYPE = 'token';
            var _url = OAUTHURL + 'scope=' + SCOPE + '&client_id=' + CLIENTID + '&redirect_uri=' + REDIRECT + '&response_type=' + TYPE;
            var acToken = undefined;
            var tokenType = undefined;
            var expiresIn = undefined;
            var user = undefined;
            var tokenID = undefined;
            var loggedIn = false;

            //function to parse the query string in the given URL to obatin certain values
            function gup(url, name) {
              name = name.replace(/[\[]/, '\\\[').replace(/[\]]/, '\\\]');
              var regexS = '[\\#&]' + name + '=([^&#]*)';
              var regex = new RegExp(regexS);
              var results = regex.exec(url);
              if (results === null) return '';else return results[1];
            }

            return new _Promise(function (resolve, reject) {

              //function to validate the access token received during the authentication
              function validateToken(token) {
                var req = new XMLHttpRequest();
                req.open('GET', VALIDURL + token, true);

                req.onreadystatechange = function (e) {
                  if (req.readyState == 4) {
                    if (req.status == 200) {
                      //console.log('validateToken ', e);

                      getIDToken(token);
                    } else if (req.status == 400) {
                      reject('There was an error processing the token');
                    } else {
                      reject('something else other than 200 was returned');
                    }
                  }
                };
                req.send();
              }

              //function to exchange the access token with an ID Token containing the information
              function getIDToken(token) {
                var req = new XMLHttpRequest();
                req.open('GET', USERINFURL + token, true);

                req.onreadystatechange = function (e) {
                  if (req.readyState == 4) {
                    if (req.status == 200) {
                      console.log('getUserInfo ', req);
                      tokenID = JSON.parse(req.responseText);
                      resolve(tokenID);
                    } else if (req.status == 400) {
                      reject('There was an error processing the token');
                    } else {
                      reject('something else other than 200 was returned');
                    }
                  }
                };
                req.send();
              }

              //this will open a window with the URL which will open a page sent by google for the user to insert the credentials
              // when the google validates the credentials then send a access token
              var win = window.open(_url, 'openIDrequest', 'width=800, height=600');
              var pollTimer = window.setInterval(function () {
                try {
                  //console.log(win.document.URL);

                  if (win.closed) {
                    reject('Some error occured.');
                    clearInterval(pollTimer);
                  }

                  if (win.document.URL.indexOf(REDIRECT) != -1) {
                    window.clearInterval(pollTimer);
                    var url = win.document.URL;
                    acToken = gup(url, 'access_token');
                    tokenType = gup(url, 'token_type');
                    expiresIn = gup(url, 'expires_in');
                    win.close();

                    //after receiving the access token, google requires to validate first the token to prevent confused deputy problem.
                    validateToken(acToken);
                  }
                } catch (e) {
                  //console.log(e);
                }
              }, 500);
            });
          }

          /**
          * In relation with a Hyperty Instance: Associate identity
          */
        }, {
          key: 'setHypertyIdentity',
          value: function setHypertyIdentity() {}
          // Body...

          /**
          * Generates an Identity Assertion for a call session
          * @param  {DOMString} contents     contents
          * @param  {DOMString} origin       origin
          * @param  {DOMString} usernameHint usernameHint
          * @return {IdAssertion}              IdAssertion
          */

        }, {
          key: 'generateAssertion',
          value: function generateAssertion(contents, origin, usernameHint) {}
          // Body...

          /**
          * OTHER USER'S IDENTITY
          */

          /**
          * Verification of a received IdAssertion validity
          * @param  {DOMString} assertion assertion
          */

        }, {
          key: 'validateAssertion',
          value: function validateAssertion(assertion) {}
          // Body...

          /**
          * Trust level evaluation of a received IdAssertion
          * @param  {DOMString} assertion assertion
          */

        }, {
          key: 'getAssertionTrustLevel',
          value: function getAssertionTrustLevel(assertion) {
            // Body...
          }
        }]);

        return IdentityModule;
      })();

      _export('default', IdentityModule);
    }
  };
});
$__System.register('11', [], function (_export) {
  /**
   * Support module with some functions will be useful
   * @module utils
   */

  /**
   * @typedef divideURL
   * @type Object
   * @property {string} type The type of URL
   * @property {string} domain The domain of URL
   * @property {string} identity The identity of URL
   */

  /**
   * Divide an url in type, domain and identity
   * @param  {URL.URL} url - url address
   * @return {divideURL} the result of divideURL
   */
  'use strict';

  /**
   * Make a COPY of the original data
   * @param  {Object}  obj - object to be cloned
   * @return {Object}
   */

  _export('divideURL', divideURL);

  _export('deepClone', deepClone);

  function divideURL(url) {

    // let re = /([a-zA-Z-]*)?:\/\/(?:\.)?([-a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,6}\b)*(\/[\/\d\w\.-]*)*(?:[\?])*(.+)*/gi;
    var re = /([a-zA-Z-]*):\/\/(?:\.)?([-a-zA-Z0-9@:%._\+~#=]{2,256})([-a-zA-Z0-9@:%._\+~#=\/]*)/gi;
    var subst = '$1,$2,$3';
    var parts = url.replace(re, subst).split(',');
    var result = {
      type: parts[0],
      domain: parts[1],
      identity: parts[2]
    };

    return result;
  }

  function deepClone(obj) {
    //TODO: simple but inefficient JSON deep clone...
    return JSON.parse(JSON.stringify(obj));
  }

  return {
    setters: [],
    execute: function () {}
  };
});
$__System.register('16', ['3', '8', '9'], function (_export) {
  var _Promise, _createClass, _classCallCheck, AddressAllocation;

  return {
    setters: [function (_3) {
      _Promise = _3['default'];
    }, function (_) {
      _createClass = _['default'];
    }, function (_2) {
      _classCallCheck = _2['default'];
    }],
    execute: function () {
      // import MessageFactory from '../../resources/MessageFactory';

      /**
       * Class will ask to the message node for addresses
       */
      'use strict';

      AddressAllocation = (function () {
        /* private
        _url: URL
        _bus: MiniBus
        */

        /**
         * Create an Address Allocation
         * @param  {URL.URL}      url - url from who is sending the message
         * @param  {MiniBus}      bus - MiniBus used for address allocation
         */

        function AddressAllocation(url, bus) {
          _classCallCheck(this, AddressAllocation);

          var _this = this;

          // let messageFactory = new MessageFactory();
          //
          // _this._messageFactory = messageFactory;
          _this._url = url;
          _this._bus = bus;
        }

        /**
         * get the URL value
         * @return {string} The url value;
         */

        _createClass(AddressAllocation, [{
          key: 'create',

          /**
           * Ask for creation of a number of Hyperty addresses, to the domain message node.
           * @param  {Domain} domain - Domain of the message node.
           * @param  {number} number - Number of addresses to request
           * @returns {Promise<HypertyURL>}  A list of HypertyURL's
           */
          value: function create(domain, number) {
            var _this = this;

            // let messageFactory = _this._messageFactory;

            var msg = {
              type: 'create', from: _this._url, to: 'domain://msg-node.' + domain + '/hyperty-address-allocation',
              body: { number: number }
            };

            // TODO: Apply the message factory
            // The msg-node-vertx should be changed the body field to receive
            // the following format body: {value: {number: number}} because
            // the message is generated in that way by the message factory;
            // let msg = messageFactory.createMessageRequest(_this._url, 'domain://msg-node.' + domain + '/hyperty-address-allocation', '', {number: number});

            return new _Promise(function (resolve, reject) {

              // TODO: change this response Message using the MessageFactory
              _this._bus.postMessage(msg, function (reply) {
                if (reply.body.code === 200) {
                  resolve(reply.body.allocated);
                } else {
                  reject(reply.body.desc);
                }
              });
            });
          }
        }, {
          key: 'url',
          get: function get() {
            return this._url;
          }
        }]);

        return AddressAllocation;
      })();

      _export('default', AddressAllocation);
    }
  };
});
$__System.register("17", ["8", "9"], function (_export) {
  var _createClass, _classCallCheck, EventEmitter;

  return {
    setters: [function (_) {
      _createClass = _["default"];
    }, function (_2) {
      _classCallCheck = _2["default"];
    }],
    execute: function () {
      /**
       * EventEmitter
       * All classes which extends this, can have addEventListener and trigger events;
       */
      "use strict";

      EventEmitter = (function () {
        function EventEmitter() {
          _classCallCheck(this, EventEmitter);
        }

        _createClass(EventEmitter, [{
          key: "addEventListener",

          /**
           * addEventListener listen for an eventType
           * @param  {string}         eventType - listening for this type of event
           * @param  {Function}       cb        - callback function will be executed when the event it is invoked
           */
          value: function addEventListener(eventType, cb) {
            var _this = this;
            _this[eventType] = cb;
          }

          /**
           * Invoke the eventType
           * @param  {string} eventType - event will be invoked
           * @param  {object} params - parameters will be passed to the addEventListener
           */
        }, {
          key: "trigger",
          value: function trigger(eventType, params) {
            var _this = this;

            if (_this[eventType]) {
              _this[eventType](params);
            }
          }
        }]);

        return EventEmitter;
      })();

      _export("default", EventEmitter);
    }
  };
});
$__System.registerDynamic("18", ["19", "1a"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $def = $__require('19');
  $def($def.S, 'Object', {setPrototypeOf: $__require('1a').set});
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("1b", ["18", "1c"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  $__require('18');
  module.exports = $__require('1c').Object.setPrototypeOf;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("1d", ["1b"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": $__require('1b'),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("1e", ["1f"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = $__require('1f');
  module.exports = function create(P, D) {
    return $.create(P, D);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("20", ["1e"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": $__require('1e'),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("7", ["20", "1d"], true, function($__require, exports, module) {
  "use strict";
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var _Object$create = $__require('20')["default"];
  var _Object$setPrototypeOf = $__require('1d')["default"];
  exports["default"] = function(subClass, superClass) {
    if (typeof superClass !== "function" && superClass !== null) {
      throw new TypeError("Super expression must either be null or a function, not " + typeof superClass);
    }
    subClass.prototype = _Object$create(superClass && superClass.prototype, {constructor: {
        value: subClass,
        enumerable: false,
        writable: true,
        configurable: true
      }});
    if (superClass)
      _Object$setPrototypeOf ? _Object$setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
  };
  exports.__esModule = true;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("21", ["19", "1c", "22"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = function(KEY, exec) {
    var $def = $__require('19'),
        fn = ($__require('1c').Object || {})[KEY] || Object[KEY],
        exp = {};
    exp[KEY] = exec(fn);
    $def($def.S + $def.F * $__require('22')(function() {
      fn(1);
    }), 'Object', exp);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("23", ["24", "21"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var toIObject = $__require('24');
  $__require('21')('getOwnPropertyDescriptor', function($getOwnPropertyDescriptor) {
    return function getOwnPropertyDescriptor(it, key) {
      return $getOwnPropertyDescriptor(toIObject(it), key);
    };
  });
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("25", ["1f", "23"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = $__require('1f');
  $__require('23');
  module.exports = function getOwnPropertyDescriptor(it, key) {
    return $.getDesc(it, key);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("26", ["25"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": $__require('25'),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("6", ["26"], true, function($__require, exports, module) {
  "use strict";
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var _Object$getOwnPropertyDescriptor = $__require('26')["default"];
  exports["default"] = function get(_x, _x2, _x3) {
    var _again = true;
    _function: while (_again) {
      var object = _x,
          property = _x2,
          receiver = _x3;
      _again = false;
      if (object === null)
        object = Function.prototype;
      var desc = _Object$getOwnPropertyDescriptor(object, property);
      if (desc === undefined) {
        var parent = Object.getPrototypeOf(object);
        if (parent === null) {
          return undefined;
        } else {
          _x = parent;
          _x2 = property;
          _x3 = receiver;
          _again = true;
          desc = parent = undefined;
          continue _function;
        }
      } else if ("value" in desc) {
        return desc.value;
      } else {
        var getter = desc.get;
        if (getter === undefined) {
          return undefined;
        }
        return getter.call(receiver);
      }
    }
  };
  exports.__esModule = true;
  global.define = __define;
  return module.exports;
});

$__System.register('27', ['3', '6', '7', '8', '9', '11', '16', '17'], function (_export) {
  var _Promise, _get, _inherits, _createClass, _classCallCheck, divideURL, AddressAllocation, EventEmitter, Registry;

  return {
    setters: [function (_5) {
      _Promise = _5['default'];
    }, function (_) {
      _get = _['default'];
    }, function (_2) {
      _inherits = _2['default'];
    }, function (_3) {
      _createClass = _3['default'];
    }, function (_4) {
      _classCallCheck = _4['default'];
    }, function (_8) {
      divideURL = _8.divideURL;
    }, function (_7) {
      AddressAllocation = _7['default'];
    }, function (_6) {
      EventEmitter = _6['default'];
    }],
    execute: function () {

      /**
      * Runtime Registry Interface
      */
      'use strict';

      Registry = (function (_EventEmitter) {
        _inherits(Registry, _EventEmitter);

        /**
        * To initialise the Runtime Registry with the RuntimeURL that will be the basis to derive the internal runtime addresses when allocating addresses to internal runtime component. In addition, the Registry domain back-end to be used to remotely register Runtime components, is also passed as input parameter.
        * @param  {MessageBus}          msgbus                msgbus
        * @param  {HypertyRuntimeURL}   runtimeURL            runtimeURL
        * @param  {AppSandbox}          appSandbox            appSandbox
        * @param  {DomainURL}           remoteRegistry        remoteRegistry
        */

        function Registry(runtimeURL, appSandbox, remoteRegistry) {
          _classCallCheck(this, Registry);

          _get(Object.getPrototypeOf(Registry.prototype), 'constructor', this).call(this);

          // how some functions receive the parameters for example:
          // new Registry(msgbus, 'hyperty-runtime://sp1/123', appSandbox, remoteRegistry);
          // registry.registerStub(sandbox, 'sp1');
          // registry.registerHyperty(sandBox, 'hyperty-runtime://sp1/123');
          // registry.resolve('hyperty-runtime://sp1/123');

          if (!runtimeURL) throw new Error('runtimeURL is missing.');
          /*if (!remoteRegistry) throw new Error('remoteRegistry is missing');*/

          var _this = this;

          _this.registryURL = runtimeURL + '/registry/123';
          _this.appSandbox = appSandbox;
          _this.runtimeURL = runtimeURL;
          _this.remoteRegistry = remoteRegistry;

          _this.hypertiesList = {};
          _this.protostubsList = {};
          _this.sandboxesList = {};
          _this.pepList = {};
        }

        /**
        * return the messageBus in this Registry
        * @param {MessageBus}           messageBus
        */

        _createClass(Registry, [{
          key: 'getAppSandbox',

          /**
          * This function is used to return the sandbox instance where the Application is executing. It is assumed there is just one App per Runtime instance.
          */
          value: function getAppSandbox() {
            var _this = this;
            return _this.appSandbox;
          }

          /**
          * To register a new Hyperty in the runtime which returns the HypertyURL allocated to the new Hyperty.
          * @param  {Sandbox}             sandbox               sandbox
          * @param  {HypertyCatalogueURL} HypertyCatalogueURL   descriptor
          * @return {HypertyURL}          HypertyURL
          */
        }, {
          key: 'registerHyperty',
          value: function registerHyperty(sandbox, descriptor) {
            var _this = this;

            //assuming descriptor come in this format, the service-provider-domain url is retrieved by a split instruction
            //hyperty-catalogue://<service-provider-domain>/<catalogue-object-identifier>
            var domainUrl = divideURL(descriptor).domain;

            //TODO Call get Identity and set Identity to Identity Module
            //for simplicity added an identity
            var hypertyIdentity = domainUrl + '/identity';

            var promise = new _Promise(function (resolve, reject) {

              if (_this._messageBus === undefined) {
                reject('MessageBus not found on registerStub');
              } else {
                //call check if the protostub exist
                return _this.resolve('hyperty-runtime://' + domainUrl).then(function () {

                  if (_this.hypertiesList.hasOwnProperty(domainUrl)) {
                    _this.hypertiesList[domainUrl] = { identity: hypertyIdentity };
                  }

                  if (!_this.sandboxesList.hasOwnProperty(domainUrl)) {
                    _this.sandboxesList[domainUrl] = sandbox;
                    sandbox.addListener('*', function (msg) {
                      _this._messageBus.postMessage(msg);
                    });
                  }

                  // // addListener with the callback to execute when receive a message from the address-allocation
                  // let item = _this._messageBus.addListener(_this.registryURL, (msg) => {
                  //   let url = msg.body.hypertyRuntime;
                  //
                  //   _this.hypertiesList[domainUrl] = {identity: url + '/identity'};
                  //   _this.sandboxesList[domainUrl] = sandbox;
                  //
                  //   //TODO register this hyperty in the Global Registry
                  //
                  //   item.remove();
                  //
                  // });

                  // TODO: should be implemented with addresses poll
                  // In this case we will request and return only one
                  // address
                  var numberOfAddresses = 1;
                  _this.addressAllocation.create(domainUrl, numberOfAddresses).then(function (adderessList) {

                    adderessList.forEach(function (address) {

                      _this._messageBus.addListener(address + '/status', function (msg) {
                        console.log('Message addListener for : ', address + '/status -> ' + msg);
                      });
                    });

                    resolve(adderessList[0]);
                  })['catch'](function (reason) {
                    console.log('Address Reason: ', reason);
                    reject(reason);
                  });

                  //TODO call the post message with create hypertyRegistration msg
                });
              }
            });

            return promise;
          }

          /**
          * To unregister a previously registered Hyperty
          * @param  {HypertyURL}          HypertyURL url        url
          */
        }, {
          key: 'unregisterHyperty',
          value: function unregisterHyperty(url) {
            var _this = this;

            var promise = new _Promise(function (resolve, reject) {

              var request = _this.hypertiesList[url];

              if (request === undefined) {
                reject('Hyperty not found');
              } else {
                resolve('Hyperty successfully deleted');
              }
            });

            return promise;
          }

          /**
          * To discover protocol stubs available in the runtime for a certain domain. If available, it returns the runtime url for the protocol stub that connects to the requested domain. Required by the runtime BUS to route messages to remote servers or peers (do we need something similar for Hyperties?).
          * @param  {DomainURL}           DomainURL            url
          * @return {RuntimeURL}           RuntimeURL
          */
        }, {
          key: 'discoverProtostub',
          value: function discoverProtostub(url) {
            if (!url) throw new Error('Parameter url needed');
            var _this = this;

            var promise = new _Promise(function (resolve, reject) {

              var request = _this.protostubsList[url];

              if (request === undefined) {
                reject('requestUpdate couldn\' get the ProtostubURL');
              } else {
                resolve(request);
              }
            });

            return promise;
          }

          /**
           * To register a new Protocol Stub in the runtime including as input parameters the function to postMessage, the DomainURL that is connected with the stub, which returns the RuntimeURL allocated to the new ProtocolStub.
           * @param {Sandbox}        Sandbox
           * @param  {DomainURL}     DomainURL service provider domain
           * @return {RuntimeProtoStubURL}
           */
        }, {
          key: 'registerStub',
          value: function registerStub(sandbox, domainURL) {
            var _this = this;
            var runtimeProtoStubURL;

            var promise = new _Promise(function (resolve, reject) {

              //check if messageBus is registered in registry or not
              if (_this._messageBus === undefined) {
                reject('MessageBus not found on registerStub');
              }

              //TODO implement a unique number for the protostubURL
              if (!domainURL.indexOf('msg-node.')) {
                domainURL = domainURL.substring(domainURL.indexOf('.') + 1);
              }

              runtimeProtoStubURL = 'msg-node.' + domainURL + '/protostub/' + Math.floor(Math.random() * 10000 + 1);

              // TODO: Optimize this
              _this.protostubsList[domainURL] = runtimeProtoStubURL;
              _this.sandboxesList[runtimeProtoStubURL] = sandbox;

              sandbox.addListener('*', function (msg) {
                _this._messageBus.postMessage(msg);
              });

              resolve(runtimeProtoStubURL);

              _this._messageBus.addListener(runtimeProtoStubURL + '/status', function (msg) {
                if (msg.resource === msg.to + '/status') {
                  console.log('RuntimeProtostubURL/status message: ', msg.body.value);
                }
              });
            });

            return promise;
          }

          /**
          * To unregister a previously registered protocol stub
          * @param  {HypertyRuntimeURL}   HypertyRuntimeURL     hypertyRuntimeURL
          */
        }, {
          key: 'unregisterStub',
          value: function unregisterStub(hypertyRuntimeURL) {
            var _this = this;
            var runtimeProtoStubURL;

            var promise = new _Promise(function (resolve, reject) {

              var data = _this.protostubsList[hypertyRuntimeURL];

              if (data === undefined) {
                reject('Error on unregisterStub: Hyperty not found');
              } else {
                delete _this.protostubsList[hypertyRuntimeURL];
                resolve('ProtostubURL removed');
              }
            });

            return promise;
          }

          /**
          * To register a new Policy Enforcer in the runtime including as input parameters the function to postMessage, the HypertyURL associated with the PEP, which returns the RuntimeURL allocated to the new Policy Enforcer component.
          * @param  {Message.Message} postMessage postMessage
          * @param  {HypertyURL}          HypertyURL            hyperty
          * @return {HypertyRuntimeURL}   HypertyRuntimeURL
          */
        }, {
          key: 'registerPEP',
          value: function registerPEP(postMessage, hyperty) {
            var _this = this;

            var promise = new _Promise(function (resolve, reject) {
              //TODO check what parameter in the postMessage the pep is.
              _this.pepList[hyperty] = postMessage;
              resolve('PEP registered with success');
            });

            return promise;
          }

          /**
          * To unregister a previously registered protocol stub
          * @param  {HypertyRuntimeURL}   HypertyRuntimeURL     HypertyRuntimeURL
          */
        }, {
          key: 'unregisterPEP',
          value: function unregisterPEP(HypertyRuntimeURL) {
            var _this = this;

            var promise = new _Promise(function (resolve, reject) {

              var result = _this.pepList[HypertyRuntimeURL];

              if (result === undefined) {
                reject('Pep Not found.');
              } else {
                resolve('PEP successfully removed.');
              }
            });

            return promise;
          }

          /**
          * To receive status events from components registered in the Registry.
          * @param  {Message.Message}     Message.Message       event
          */
        }, {
          key: 'onEvent',
          value: function onEvent(event) {}
          // TODO body...

          /**
          * To discover sandboxes available in the runtime for a certain domain. Required by the runtime UA to avoid more than one sandbox for the same domain.
          * @param  {DomainURL} DomainURL url
          * @return {RuntimeSandbox}           RuntimeSandbox
          */

        }, {
          key: 'getSandbox',
          value: function getSandbox(url) {
            if (!url) throw new Error('Parameter url needed');
            var _this = this;
            var promise = new _Promise(function (resolve, reject) {

              var request = _this.sandboxesList[url];

              if (request === undefined) {
                reject('Sandbox not found');
              } else {
                resolve(request);
              }
            });
            return promise;
          }

          /**
          * To verify if source is valid and to resolve target runtime url address if needed (eg protostub runtime url in case the message is to be dispatched to a remote endpoint).
          * @param  {URL.URL}  url       url
          * @return {Promise<URL.URL>}                 Promise <URL.URL>
          */
        }, {
          key: 'resolve',
          value: function resolve(url) {
            console.log('resolve ' + url);
            var _this = this;

            //split the url to find the domainURL. deals with the url for example as:
            //"hyperty-runtime://sp1/protostub/123",
            var domainUrl = divideURL(url).domain;

            var promise = new _Promise(function (resolve, reject) {

              if (!domainUrl.indexOf('msg-node.')) {
                domainUrl = domainUrl.substring(domainUrl.indexOf('.') + 1);
              }

              var request = _this.protostubsList[domainUrl];

              _this.addEventListener('runtime:stubLoaded', function (domainUrl) {
                resolve(domainUrl);
              });

              if (request !== undefined) {
                resolve(request);
              } else {
                _this.trigger('runtime:loadStub', domainUrl);
              }
            });
            return promise;
          }
        }, {
          key: 'messageBus',
          get: function get() {
            var _this = this;
            return _this._messageBus;
          },

          /**
          * Set the messageBus in this Registry
          * @param {MessageBus}           messageBus
          */
          set: function set(messageBus) {
            var _this = this;
            _this._messageBus = messageBus;

            // Install AddressAllocation
            var addressAllocation = new AddressAllocation(_this.registryURL, messageBus);
            _this.addressAllocation = addressAllocation;
          }
        }]);

        return Registry;
      })(EventEmitter);

      _export('default', Registry);
    }
  };
});
$__System.registerDynamic("28", ["29"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var defined = $__require('29');
  module.exports = function(it) {
    return Object(defined(it));
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("2a", ["1f", "28", "2b", "22"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = $__require('1f'),
      toObject = $__require('28'),
      IObject = $__require('2b');
  module.exports = $__require('22')(function() {
    var a = Object.assign,
        A = {},
        B = {},
        S = Symbol(),
        K = 'abcdefghijklmnopqrst';
    A[S] = 7;
    K.split('').forEach(function(k) {
      B[k] = k;
    });
    return a({}, A)[S] != 7 || Object.keys(a({}, B)).join('') != K;
  }) ? function assign(target, source) {
    var T = toObject(target),
        $$ = arguments,
        $$len = $$.length,
        index = 1,
        getKeys = $.getKeys,
        getSymbols = $.getSymbols,
        isEnum = $.isEnum;
    while ($$len > index) {
      var S = IObject($$[index++]),
          keys = getSymbols ? getKeys(S).concat(getSymbols(S)) : getKeys(S),
          length = keys.length,
          j = 0,
          key;
      while (length > j)
        if (isEnum.call(S, key = keys[j++]))
          T[key] = S[key];
    }
    return T;
  } : Object.assign;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("2c", ["19", "2a"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $def = $__require('19');
  $def($def.S + $def.F, 'Object', {assign: $__require('2a')});
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("2d", ["2c", "1c"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  $__require('2c');
  module.exports = $__require('1c').Object.assign;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("2e", ["2d"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": $__require('2d'),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("2f", ["30"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var SYMBOL_ITERATOR = $__require('30')('iterator'),
      SAFE_CLOSING = false;
  try {
    var riter = [7][SYMBOL_ITERATOR]();
    riter['return'] = function() {
      SAFE_CLOSING = true;
    };
    Array.from(riter, function() {
      throw 2;
    });
  } catch (e) {}
  module.exports = function(exec, skipClosing) {
    if (!skipClosing && !SAFE_CLOSING)
      return false;
    var safe = false;
    try {
      var arr = [7],
          iter = arr[SYMBOL_ITERATOR]();
      iter.next = function() {
        safe = true;
      };
      arr[SYMBOL_ITERATOR] = function() {
        return iter;
      };
      exec(arr);
    } catch (e) {}
    return safe;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("31", ["32"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $redef = $__require('32');
  module.exports = function(target, src) {
    for (var key in src)
      $redef(target, key, src[key]);
    return target;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("33", [], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var process = module.exports = {};
  var queue = [];
  var draining = false;
  var currentQueue;
  var queueIndex = -1;
  function cleanUpNextTick() {
    draining = false;
    if (currentQueue.length) {
      queue = currentQueue.concat(queue);
    } else {
      queueIndex = -1;
    }
    if (queue.length) {
      drainQueue();
    }
  }
  function drainQueue() {
    if (draining) {
      return;
    }
    var timeout = setTimeout(cleanUpNextTick);
    draining = true;
    var len = queue.length;
    while (len) {
      currentQueue = queue;
      queue = [];
      while (++queueIndex < len) {
        if (currentQueue) {
          currentQueue[queueIndex].run();
        }
      }
      queueIndex = -1;
      len = queue.length;
    }
    currentQueue = null;
    draining = false;
    clearTimeout(timeout);
  }
  process.nextTick = function(fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
      for (var i = 1; i < arguments.length; i++) {
        args[i - 1] = arguments[i];
      }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
      setTimeout(drainQueue, 0);
    }
  };
  function Item(fun, array) {
    this.fun = fun;
    this.array = array;
  }
  Item.prototype.run = function() {
    this.fun.apply(null, this.array);
  };
  process.title = 'browser';
  process.browser = true;
  process.env = {};
  process.argv = [];
  process.version = '';
  process.versions = {};
  function noop() {}
  process.on = noop;
  process.addListener = noop;
  process.once = noop;
  process.off = noop;
  process.removeListener = noop;
  process.removeAllListeners = noop;
  process.emit = noop;
  process.binding = function(name) {
    throw new Error('process.binding is not supported');
  };
  process.cwd = function() {
    return '/';
  };
  process.chdir = function(dir) {
    throw new Error('process.chdir is not supported');
  };
  process.umask = function() {
    return 0;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("34", ["33"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = $__require('33');
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("35", ["34"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = $__System._nodeRequire ? process : $__require('34');
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("36", ["35"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = $__require('35');
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("37", ["38", "39"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var isObject = $__require('38'),
      document = $__require('39').document,
      is = isObject(document) && isObject(document.createElement);
  module.exports = function(it) {
    return is ? document.createElement(it) : {};
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("3a", ["39"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = $__require('39').document && document.documentElement;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("3b", [], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = function(fn, args, that) {
    var un = that === undefined;
    switch (args.length) {
      case 0:
        return un ? fn() : fn.call(that);
      case 1:
        return un ? fn(args[0]) : fn.call(that, args[0]);
      case 2:
        return un ? fn(args[0], args[1]) : fn.call(that, args[0], args[1]);
      case 3:
        return un ? fn(args[0], args[1], args[2]) : fn.call(that, args[0], args[1], args[2]);
      case 4:
        return un ? fn(args[0], args[1], args[2], args[3]) : fn.call(that, args[0], args[1], args[2], args[3]);
    }
    return fn.apply(that, args);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("3c", ["3d", "3b", "3a", "37", "39", "3e", "36"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  (function(process) {
    'use strict';
    var ctx = $__require('3d'),
        invoke = $__require('3b'),
        html = $__require('3a'),
        cel = $__require('37'),
        global = $__require('39'),
        process = global.process,
        setTask = global.setImmediate,
        clearTask = global.clearImmediate,
        MessageChannel = global.MessageChannel,
        counter = 0,
        queue = {},
        ONREADYSTATECHANGE = 'onreadystatechange',
        defer,
        channel,
        port;
    var run = function() {
      var id = +this;
      if (queue.hasOwnProperty(id)) {
        var fn = queue[id];
        delete queue[id];
        fn();
      }
    };
    var listner = function(event) {
      run.call(event.data);
    };
    if (!setTask || !clearTask) {
      setTask = function setImmediate(fn) {
        var args = [],
            i = 1;
        while (arguments.length > i)
          args.push(arguments[i++]);
        queue[++counter] = function() {
          invoke(typeof fn == 'function' ? fn : Function(fn), args);
        };
        defer(counter);
        return counter;
      };
      clearTask = function clearImmediate(id) {
        delete queue[id];
      };
      if ($__require('3e')(process) == 'process') {
        defer = function(id) {
          process.nextTick(ctx(run, id, 1));
        };
      } else if (MessageChannel) {
        channel = new MessageChannel;
        port = channel.port2;
        channel.port1.onmessage = listner;
        defer = ctx(port.postMessage, port, 1);
      } else if (global.addEventListener && typeof postMessage == 'function' && !global.importScripts) {
        defer = function(id) {
          global.postMessage(id + '', '*');
        };
        global.addEventListener('message', listner, false);
      } else if (ONREADYSTATECHANGE in cel('script')) {
        defer = function(id) {
          html.appendChild(cel('script'))[ONREADYSTATECHANGE] = function() {
            html.removeChild(this);
            run.call(id);
          };
        };
      } else {
        defer = function(id) {
          setTimeout(ctx(run, id, 1), 0);
        };
      }
    }
    module.exports = {
      set: setTask,
      clear: clearTask
    };
  })($__require('36'));
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("3f", ["39", "3c", "3e", "36"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  (function(process) {
    var global = $__require('39'),
        macrotask = $__require('3c').set,
        Observer = global.MutationObserver || global.WebKitMutationObserver,
        process = global.process,
        isNode = $__require('3e')(process) == 'process',
        head,
        last,
        notify;
    var flush = function() {
      var parent,
          domain;
      if (isNode && (parent = process.domain)) {
        process.domain = null;
        parent.exit();
      }
      while (head) {
        domain = head.domain;
        if (domain)
          domain.enter();
        head.fn.call();
        if (domain)
          domain.exit();
        head = head.next;
      }
      last = undefined;
      if (parent)
        parent.enter();
    };
    if (isNode) {
      notify = function() {
        process.nextTick(flush);
      };
    } else if (Observer) {
      var toggle = 1,
          node = document.createTextNode('');
      new Observer(flush).observe(node, {characterData: true});
      notify = function() {
        node.data = toggle = -toggle;
      };
    } else {
      notify = function() {
        macrotask.call(global, flush);
      };
    }
    module.exports = function asap(fn) {
      var task = {
        fn: fn,
        next: undefined,
        domain: isNode && process.domain
      };
      if (last)
        last.next = task;
      if (!head) {
        head = task;
        notify();
      }
      last = task;
    };
  })($__require('36'));
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("40", ["41", "42", "30"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var anObject = $__require('41'),
      aFunction = $__require('42'),
      SPECIES = $__require('30')('species');
  module.exports = function(O, D) {
    var C = anObject(O).constructor,
        S;
    return C === undefined || (S = anObject(C)[SPECIES]) == undefined ? D : aFunction(S);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("43", ["1f", "30", "44"], true, function($__require, exports, module) {
  "use strict";
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = $__require('1f'),
      SPECIES = $__require('30')('species');
  module.exports = function(C) {
    if ($__require('44') && !(SPECIES in C))
      $.setDesc(C, SPECIES, {
        configurable: true,
        get: function() {
          return this;
        }
      });
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("45", [], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = Object.is || function is(x, y) {
    return x === y ? x !== 0 || 1 / x === 1 / y : x != x && y != y;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("1a", ["1f", "38", "41", "3d"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var getDesc = $__require('1f').getDesc,
      isObject = $__require('38'),
      anObject = $__require('41');
  var check = function(O, proto) {
    anObject(O);
    if (!isObject(proto) && proto !== null)
      throw TypeError(proto + ": can't set as prototype!");
  };
  module.exports = {
    set: Object.setPrototypeOf || ('__proto__' in {} ? function(test, buggy, set) {
      try {
        set = $__require('3d')(Function.call, getDesc(Object.prototype, '__proto__').set, 2);
        set(test, []);
        buggy = !(test instanceof Array);
      } catch (e) {
        buggy = true;
      }
      return function setPrototypeOf(O, proto) {
        check(O, proto);
        if (buggy)
          O.__proto__ = proto;
        else
          set(O, proto);
        return O;
      };
    }({}, false) : undefined),
    check: check
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("46", ["47", "30", "48", "1c"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var classof = $__require('47'),
      ITERATOR = $__require('30')('iterator'),
      Iterators = $__require('48');
  module.exports = $__require('1c').getIteratorMethod = function(it) {
    if (it != undefined)
      return it[ITERATOR] || it['@@iterator'] || Iterators[classof(it)];
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("49", ["4a"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var toInteger = $__require('4a'),
      min = Math.min;
  module.exports = function(it) {
    return it > 0 ? min(toInteger(it), 0x1fffffffffffff) : 0;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("4b", ["48", "30"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var Iterators = $__require('48'),
      ITERATOR = $__require('30')('iterator');
  module.exports = function(it) {
    return (Iterators.Array || Array.prototype[ITERATOR]) === it;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("4c", ["41"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var anObject = $__require('41');
  module.exports = function(iterator, fn, value, entries) {
    try {
      return entries ? fn(anObject(value)[0], value[1]) : fn(value);
    } catch (e) {
      var ret = iterator['return'];
      if (ret !== undefined)
        anObject(ret.call(iterator));
      throw e;
    }
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("4d", ["3d", "4c", "4b", "41", "49", "46"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var ctx = $__require('3d'),
      call = $__require('4c'),
      isArrayIter = $__require('4b'),
      anObject = $__require('41'),
      toLength = $__require('49'),
      getIterFn = $__require('46');
  module.exports = function(iterable, entries, fn, that) {
    var iterFn = getIterFn(iterable),
        f = ctx(fn, that, entries ? 2 : 1),
        index = 0,
        length,
        step,
        iterator;
    if (typeof iterFn != 'function')
      throw TypeError(iterable + ' is not iterable!');
    if (isArrayIter(iterFn))
      for (length = toLength(iterable.length); length > index; index++) {
        entries ? f(anObject(step = iterable[index])[0], step[1]) : f(iterable[index]);
      }
    else
      for (iterator = iterFn.call(iterable); !(step = iterator.next()).done; ) {
        call(iterator, f, step.value, entries);
      }
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("4e", [], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = function(it, Constructor, name) {
    if (!(it instanceof Constructor))
      throw TypeError(name + ": use the 'new' operator!");
    return it;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("41", ["38"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var isObject = $__require('38');
  module.exports = function(it) {
    if (!isObject(it))
      throw TypeError(it + ' is not an object!');
    return it;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("38", [], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = function(it) {
    return typeof it === 'object' ? it !== null : typeof it === 'function';
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("47", ["3e", "30"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var cof = $__require('3e'),
      TAG = $__require('30')('toStringTag'),
      ARG = cof(function() {
        return arguments;
      }()) == 'Arguments';
  module.exports = function(it) {
    var O,
        T,
        B;
    return it === undefined ? 'Undefined' : it === null ? 'Null' : typeof(T = (O = Object(it))[TAG]) == 'string' ? T : ARG ? cof(O) : (B = cof(O)) == 'Object' && typeof O.callee == 'function' ? 'Arguments' : B;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("42", [], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = function(it) {
    if (typeof it != 'function')
      throw TypeError(it + ' is not a function!');
    return it;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("3d", ["42"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var aFunction = $__require('42');
  module.exports = function(fn, that, length) {
    aFunction(fn);
    if (that === undefined)
      return fn;
    switch (length) {
      case 1:
        return function(a) {
          return fn.call(that, a);
        };
      case 2:
        return function(a, b) {
          return fn.call(that, a, b);
        };
      case 3:
        return function(a, b, c) {
          return fn.call(that, a, b, c);
        };
    }
    return function() {
      return fn.apply(that, arguments);
    };
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("4f", ["1f", "50", "39", "3d", "47", "19", "38", "41", "42", "4e", "4d", "1a", "45", "43", "30", "40", "51", "3f", "44", "31", "52", "1c", "2f", "36"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  (function(process) {
    'use strict';
    var $ = $__require('1f'),
        LIBRARY = $__require('50'),
        global = $__require('39'),
        ctx = $__require('3d'),
        classof = $__require('47'),
        $def = $__require('19'),
        isObject = $__require('38'),
        anObject = $__require('41'),
        aFunction = $__require('42'),
        strictNew = $__require('4e'),
        forOf = $__require('4d'),
        setProto = $__require('1a').set,
        same = $__require('45'),
        species = $__require('43'),
        SPECIES = $__require('30')('species'),
        speciesConstructor = $__require('40'),
        RECORD = $__require('51')('record'),
        asap = $__require('3f'),
        PROMISE = 'Promise',
        process = global.process,
        isNode = classof(process) == 'process',
        P = global[PROMISE],
        Wrapper;
    var testResolve = function(sub) {
      var test = new P(function() {});
      if (sub)
        test.constructor = Object;
      return P.resolve(test) === test;
    };
    var useNative = function() {
      var works = false;
      function P2(x) {
        var self = new P(x);
        setProto(self, P2.prototype);
        return self;
      }
      try {
        works = P && P.resolve && testResolve();
        setProto(P2, P);
        P2.prototype = $.create(P.prototype, {constructor: {value: P2}});
        if (!(P2.resolve(5).then(function() {}) instanceof P2)) {
          works = false;
        }
        if (works && $__require('44')) {
          var thenableThenGotten = false;
          P.resolve($.setDesc({}, 'then', {get: function() {
              thenableThenGotten = true;
            }}));
          works = thenableThenGotten;
        }
      } catch (e) {
        works = false;
      }
      return works;
    }();
    var isPromise = function(it) {
      return isObject(it) && (useNative ? classof(it) == 'Promise' : RECORD in it);
    };
    var sameConstructor = function(a, b) {
      if (LIBRARY && a === P && b === Wrapper)
        return true;
      return same(a, b);
    };
    var getConstructor = function(C) {
      var S = anObject(C)[SPECIES];
      return S != undefined ? S : C;
    };
    var isThenable = function(it) {
      var then;
      return isObject(it) && typeof(then = it.then) == 'function' ? then : false;
    };
    var notify = function(record, isReject) {
      if (record.n)
        return;
      record.n = true;
      var chain = record.c;
      asap(function() {
        var value = record.v,
            ok = record.s == 1,
            i = 0;
        var run = function(react) {
          var cb = ok ? react.ok : react.fail,
              ret,
              then;
          try {
            if (cb) {
              if (!ok)
                record.h = true;
              ret = cb === true ? value : cb(value);
              if (ret === react.P) {
                react.rej(TypeError('Promise-chain cycle'));
              } else if (then = isThenable(ret)) {
                then.call(ret, react.res, react.rej);
              } else
                react.res(ret);
            } else
              react.rej(value);
          } catch (err) {
            react.rej(err);
          }
        };
        while (chain.length > i)
          run(chain[i++]);
        chain.length = 0;
        record.n = false;
        if (isReject)
          setTimeout(function() {
            var promise = record.p,
                handler,
                console;
            if (isUnhandled(promise)) {
              if (isNode) {
                process.emit('unhandledRejection', value, promise);
              } else if (handler = global.onunhandledrejection) {
                handler({
                  promise: promise,
                  reason: value
                });
              } else if ((console = global.console) && console.error) {
                console.error('Unhandled promise rejection', value);
              }
            }
            record.a = undefined;
          }, 1);
      });
    };
    var isUnhandled = function(promise) {
      var record = promise[RECORD],
          chain = record.a || record.c,
          i = 0,
          react;
      if (record.h)
        return false;
      while (chain.length > i) {
        react = chain[i++];
        if (react.fail || !isUnhandled(react.P))
          return false;
      }
      return true;
    };
    var $reject = function(value) {
      var record = this;
      if (record.d)
        return;
      record.d = true;
      record = record.r || record;
      record.v = value;
      record.s = 2;
      record.a = record.c.slice();
      notify(record, true);
    };
    var $resolve = function(value) {
      var record = this,
          then;
      if (record.d)
        return;
      record.d = true;
      record = record.r || record;
      try {
        if (then = isThenable(value)) {
          asap(function() {
            var wrapper = {
              r: record,
              d: false
            };
            try {
              then.call(value, ctx($resolve, wrapper, 1), ctx($reject, wrapper, 1));
            } catch (e) {
              $reject.call(wrapper, e);
            }
          });
        } else {
          record.v = value;
          record.s = 1;
          notify(record, false);
        }
      } catch (e) {
        $reject.call({
          r: record,
          d: false
        }, e);
      }
    };
    if (!useNative) {
      P = function Promise(executor) {
        aFunction(executor);
        var record = {
          p: strictNew(this, P, PROMISE),
          c: [],
          a: undefined,
          s: 0,
          d: false,
          v: undefined,
          h: false,
          n: false
        };
        this[RECORD] = record;
        try {
          executor(ctx($resolve, record, 1), ctx($reject, record, 1));
        } catch (err) {
          $reject.call(record, err);
        }
      };
      $__require('31')(P.prototype, {
        then: function then(onFulfilled, onRejected) {
          var react = {
            ok: typeof onFulfilled == 'function' ? onFulfilled : true,
            fail: typeof onRejected == 'function' ? onRejected : false
          };
          var promise = react.P = new (speciesConstructor(this, P))(function(res, rej) {
            react.res = res;
            react.rej = rej;
          });
          aFunction(react.res);
          aFunction(react.rej);
          var record = this[RECORD];
          record.c.push(react);
          if (record.a)
            record.a.push(react);
          if (record.s)
            notify(record, false);
          return promise;
        },
        'catch': function(onRejected) {
          return this.then(undefined, onRejected);
        }
      });
    }
    $def($def.G + $def.W + $def.F * !useNative, {Promise: P});
    $__require('52')(P, PROMISE);
    species(P);
    species(Wrapper = $__require('1c')[PROMISE]);
    $def($def.S + $def.F * !useNative, PROMISE, {reject: function reject(r) {
        return new this(function(res, rej) {
          rej(r);
        });
      }});
    $def($def.S + $def.F * (!useNative || testResolve(true)), PROMISE, {resolve: function resolve(x) {
        return isPromise(x) && sameConstructor(x.constructor, this) ? x : new this(function(res) {
          res(x);
        });
      }});
    $def($def.S + $def.F * !(useNative && $__require('2f')(function(iter) {
      P.all(iter)['catch'](function() {});
    })), PROMISE, {
      all: function all(iterable) {
        var C = getConstructor(this),
            values = [];
        return new C(function(res, rej) {
          forOf(iterable, false, values.push, values);
          var remaining = values.length,
              results = Array(remaining);
          if (remaining)
            $.each.call(values, function(promise, index) {
              C.resolve(promise).then(function(value) {
                results[index] = value;
                --remaining || res(results);
              }, rej);
            });
          else
            res(results);
        });
      },
      race: function race(iterable) {
        var C = getConstructor(this);
        return new C(function(res, rej) {
          forOf(iterable, false, function(promise) {
            C.resolve(promise).then(res, rej);
          });
        });
      }
    });
  })($__require('36'));
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("3e", [], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var toString = {}.toString;
  module.exports = function(it) {
    return toString.call(it).slice(8, -1);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("2b", ["3e"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var cof = $__require('3e');
  module.exports = Object('z').propertyIsEnumerable(0) ? Object : function(it) {
    return cof(it) == 'String' ? it.split('') : Object(it);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("24", ["2b", "29"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var IObject = $__require('2b'),
      defined = $__require('29');
  module.exports = function(it) {
    return IObject(defined(it));
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("53", [], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = function(done, value) {
    return {
      value: value,
      done: !!done
    };
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("54", [], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = function() {};
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("55", ["54", "53", "48", "24", "56"], true, function($__require, exports, module) {
  "use strict";
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var setUnscope = $__require('54'),
      step = $__require('53'),
      Iterators = $__require('48'),
      toIObject = $__require('24');
  $__require('56')(Array, 'Array', function(iterated, kind) {
    this._t = toIObject(iterated);
    this._i = 0;
    this._k = kind;
  }, function() {
    var O = this._t,
        kind = this._k,
        index = this._i++;
    if (!O || index >= O.length) {
      this._t = undefined;
      return step(1);
    }
    if (kind == 'keys')
      return step(0, index);
    if (kind == 'values')
      return step(0, O[index]);
    return step(0, [index, O[index]]);
  }, 'values');
  Iterators.Arguments = Iterators.Array;
  setUnscope('keys');
  setUnscope('values');
  setUnscope('entries');
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("57", ["55", "48"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  $__require('55');
  var Iterators = $__require('48');
  Iterators.NodeList = Iterators.HTMLCollection = Iterators.Array;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("52", ["1f", "58", "30"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var def = $__require('1f').setDesc,
      has = $__require('58'),
      TAG = $__require('30')('toStringTag');
  module.exports = function(it, tag, stat) {
    if (it && !has(it = stat ? it : it.prototype, TAG))
      def(it, TAG, {
        configurable: true,
        value: tag
      });
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("59", ["1f", "5a", "30", "5b", "52"], true, function($__require, exports, module) {
  "use strict";
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = $__require('1f'),
      IteratorPrototype = {};
  $__require('5a')(IteratorPrototype, $__require('30')('iterator'), function() {
    return this;
  });
  module.exports = function(Constructor, NAME, next) {
    Constructor.prototype = $.create(IteratorPrototype, {next: $__require('5b')(1, next)});
    $__require('52')(Constructor, NAME + ' Iterator');
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("48", [], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {};
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("51", [], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var id = 0,
      px = Math.random();
  module.exports = function(key) {
    return 'Symbol('.concat(key === undefined ? '' : key, ')_', (++id + px).toString(36));
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("5c", ["39"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var global = $__require('39'),
      SHARED = '__core-js_shared__',
      store = global[SHARED] || (global[SHARED] = {});
  module.exports = function(key) {
    return store[key] || (store[key] = {});
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("30", ["5c", "39", "51"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var store = $__require('5c')('wks'),
      Symbol = $__require('39').Symbol;
  module.exports = function(name) {
    return store[name] || (store[name] = Symbol && Symbol[name] || (Symbol || $__require('51'))('Symbol.' + name));
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("58", [], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var hasOwnProperty = {}.hasOwnProperty;
  module.exports = function(it, key) {
    return hasOwnProperty.call(it, key);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("22", [], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = function(exec) {
    try {
      return !!exec();
    } catch (e) {
      return true;
    }
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("44", ["22"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = !$__require('22')(function() {
    return Object.defineProperty({}, 'a', {get: function() {
        return 7;
      }}).a != 7;
  });
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("5b", [], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = function(bitmap, value) {
    return {
      enumerable: !(bitmap & 1),
      configurable: !(bitmap & 2),
      writable: !(bitmap & 4),
      value: value
    };
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("5a", ["1f", "5b", "44"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = $__require('1f'),
      createDesc = $__require('5b');
  module.exports = $__require('44') ? function(object, key, value) {
    return $.setDesc(object, key, createDesc(1, value));
  } : function(object, key, value) {
    object[key] = value;
    return object;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("32", ["5a"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = $__require('5a');
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("1c", [], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var core = module.exports = {version: '1.2.3'};
  if (typeof __e == 'number')
    __e = core;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("39", [], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var global = module.exports = typeof window != 'undefined' && window.Math == Math ? window : typeof self != 'undefined' && self.Math == Math ? self : Function('return this')();
  if (typeof __g == 'number')
    __g = global;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("19", ["39", "1c"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var global = $__require('39'),
      core = $__require('1c'),
      PROTOTYPE = 'prototype';
  var ctx = function(fn, that) {
    return function() {
      return fn.apply(that, arguments);
    };
  };
  var $def = function(type, name, source) {
    var key,
        own,
        out,
        exp,
        isGlobal = type & $def.G,
        isProto = type & $def.P,
        target = isGlobal ? global : type & $def.S ? global[name] : (global[name] || {})[PROTOTYPE],
        exports = isGlobal ? core : core[name] || (core[name] = {});
    if (isGlobal)
      source = name;
    for (key in source) {
      own = !(type & $def.F) && target && key in target;
      if (own && key in exports)
        continue;
      out = own ? target[key] : source[key];
      if (isGlobal && typeof target[key] != 'function')
        exp = source[key];
      else if (type & $def.B && own)
        exp = ctx(out, global);
      else if (type & $def.W && target[key] == out)
        !function(C) {
          exp = function(param) {
            return this instanceof C ? new C(param) : C(param);
          };
          exp[PROTOTYPE] = C[PROTOTYPE];
        }(out);
      else
        exp = isProto && typeof out == 'function' ? ctx(Function.call, out) : out;
      exports[key] = exp;
      if (isProto)
        (exports[PROTOTYPE] || (exports[PROTOTYPE] = {}))[key] = out;
    }
  };
  $def.F = 1;
  $def.G = 2;
  $def.S = 4;
  $def.P = 8;
  $def.B = 16;
  $def.W = 32;
  module.exports = $def;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("50", [], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = true;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("56", ["50", "19", "32", "5a", "58", "30", "48", "59", "1f", "52"], true, function($__require, exports, module) {
  "use strict";
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var LIBRARY = $__require('50'),
      $def = $__require('19'),
      $redef = $__require('32'),
      hide = $__require('5a'),
      has = $__require('58'),
      SYMBOL_ITERATOR = $__require('30')('iterator'),
      Iterators = $__require('48'),
      BUGGY = !([].keys && 'next' in [].keys()),
      FF_ITERATOR = '@@iterator',
      KEYS = 'keys',
      VALUES = 'values';
  var returnThis = function() {
    return this;
  };
  module.exports = function(Base, NAME, Constructor, next, DEFAULT, IS_SET, FORCE) {
    $__require('59')(Constructor, NAME, next);
    var createMethod = function(kind) {
      switch (kind) {
        case KEYS:
          return function keys() {
            return new Constructor(this, kind);
          };
        case VALUES:
          return function values() {
            return new Constructor(this, kind);
          };
      }
      return function entries() {
        return new Constructor(this, kind);
      };
    };
    var TAG = NAME + ' Iterator',
        proto = Base.prototype,
        _native = proto[SYMBOL_ITERATOR] || proto[FF_ITERATOR] || DEFAULT && proto[DEFAULT],
        _default = _native || createMethod(DEFAULT),
        methods,
        key;
    if (_native) {
      var IteratorPrototype = $__require('1f').getProto(_default.call(new Base));
      $__require('52')(IteratorPrototype, TAG, true);
      if (!LIBRARY && has(proto, FF_ITERATOR))
        hide(IteratorPrototype, SYMBOL_ITERATOR, returnThis);
    }
    if (!LIBRARY || FORCE)
      hide(proto, SYMBOL_ITERATOR, _default);
    Iterators[NAME] = _default;
    Iterators[TAG] = returnThis;
    if (DEFAULT) {
      methods = {
        values: DEFAULT == VALUES ? _default : createMethod(VALUES),
        keys: IS_SET ? _default : createMethod(KEYS),
        entries: DEFAULT != VALUES ? _default : createMethod('entries')
      };
      if (FORCE)
        for (key in methods) {
          if (!(key in proto))
            $redef(proto, key, methods[key]);
        }
      else
        $def($def.P + $def.F * BUGGY, NAME, methods);
    }
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("29", [], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = function(it) {
    if (it == undefined)
      throw TypeError("Can't call method on  " + it);
    return it;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("4a", [], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var ceil = Math.ceil,
      floor = Math.floor;
  module.exports = function(it) {
    return isNaN(it = +it) ? 0 : (it > 0 ? floor : ceil)(it);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("5d", ["4a", "29"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var toInteger = $__require('4a'),
      defined = $__require('29');
  module.exports = function(TO_STRING) {
    return function(that, pos) {
      var s = String(defined(that)),
          i = toInteger(pos),
          l = s.length,
          a,
          b;
      if (i < 0 || i >= l)
        return TO_STRING ? '' : undefined;
      a = s.charCodeAt(i);
      return a < 0xd800 || a > 0xdbff || i + 1 === l || (b = s.charCodeAt(i + 1)) < 0xdc00 || b > 0xdfff ? TO_STRING ? s.charAt(i) : a : TO_STRING ? s.slice(i, i + 2) : (a - 0xd800 << 10) + (b - 0xdc00) + 0x10000;
    };
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("5e", ["5d", "56"], true, function($__require, exports, module) {
  "use strict";
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $at = $__require('5d')(true);
  $__require('56')(String, 'String', function(iterated) {
    this._t = String(iterated);
    this._i = 0;
  }, function() {
    var O = this._t,
        index = this._i,
        point;
    if (index >= O.length)
      return {
        value: undefined,
        done: true
      };
    point = $at(O, index);
    this._i += point.length;
    return {
      value: point,
      done: false
    };
  });
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("5f", [], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  "format cjs";
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("60", ["5f", "5e", "57", "4f", "1c"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  $__require('5f');
  $__require('5e');
  $__require('57');
  $__require('4f');
  module.exports = $__require('1c').Promise;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("3", ["60"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": $__require('60'),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("9", [], true, function($__require, exports, module) {
  "use strict";
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  exports["default"] = function(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
      throw new TypeError("Cannot call a class as a function");
    }
  };
  exports.__esModule = true;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("1f", [], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $Object = Object;
  module.exports = {
    create: $Object.create,
    getProto: $Object.getPrototypeOf,
    isEnum: {}.propertyIsEnumerable,
    getDesc: $Object.getOwnPropertyDescriptor,
    setDesc: $Object.defineProperty,
    setDescs: $Object.defineProperties,
    getKeys: $Object.keys,
    getNames: $Object.getOwnPropertyNames,
    getSymbols: $Object.getOwnPropertySymbols,
    each: [].forEach
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("61", ["1f"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = $__require('1f');
  module.exports = function defineProperty(it, key, desc) {
    return $.setDesc(it, key, desc);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("62", ["61"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": $__require('61'),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("8", ["62"], true, function($__require, exports, module) {
  "use strict";
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var _Object$defineProperty = $__require('62')["default"];
  exports["default"] = (function() {
    function defineProperties(target, props) {
      for (var i = 0; i < props.length; i++) {
        var descriptor = props[i];
        descriptor.enumerable = descriptor.enumerable || false;
        descriptor.configurable = true;
        if ("value" in descriptor)
          descriptor.writable = true;
        _Object$defineProperty(target, descriptor.key, descriptor);
      }
    }
    return function(Constructor, protoProps, staticProps) {
      if (protoProps)
        defineProperties(Constructor.prototype, protoProps);
      if (staticProps)
        defineProperties(Constructor, staticProps);
      return Constructor;
    };
  })();
  exports.__esModule = true;
  global.define = __define;
  return module.exports;
});

$__System.register('63', ['3', '8', '9', '10', '12', '13', '14', '15', '27', '2e'], function (_export) {
  var _Promise, _createClass, _classCallCheck, SyncherManager, RuntimeCatalogue, MessageBus, PolicyEngine, IdentityModule, Registry, _Object$assign, RuntimeUA;

  return {
    setters: [function (_3) {
      _Promise = _3['default'];
    }, function (_) {
      _createClass = _['default'];
    }, function (_2) {
      _classCallCheck = _2['default'];
    }, function (_9) {
      SyncherManager = _9['default'];
    }, function (_8) {
      RuntimeCatalogue = _8['default'];
    }, function (_7) {
      MessageBus = _7['default'];
    }, function (_6) {
      PolicyEngine = _6['default'];
    }, function (_5) {
      IdentityModule = _5['default'];
    }, function (_4) {
      Registry = _4['default'];
    }, function (_e) {
      _Object$assign = _e['default'];
    }],
    execute: function () {
      //Main dependecies

      /**
       * Runtime User Agent Interface will process all the dependecies of the core runtime;
       * @author Vitor Silva [vitor-t-silva@telecom.pt]
       * @version 0.2.0
       *
       * @property {sandboxFactory} sandboxFactory - Specific implementation of sandbox;
       * @property {RuntimeCatalogue} runtimeCatalogue - Catalogue of components can be installed;
       * @property {runtimeURL} runtimeURL - This identify the core runtime, should be unique;
       * @property {IdentityModule} identityModule - Identity Module;
       * @property {PolicyEngine} policyEngine - Policy Engine Module;
       * @property {Registry} registry - Registry Module;
       * @property {MessageBus} messageBus - Message Bus is used like a router to redirect the messages from one component to other(s)
       */
      'use strict';

      RuntimeUA = (function () {

        /**
         * Create a new instance of Runtime User Agent
         * @param {sandboxFactory} sandboxFactory - Specific implementation for the environment where the core runtime will run;
         */

        function RuntimeUA(sandboxFactory) {
          _classCallCheck(this, RuntimeUA);

          if (!sandboxFactory) throw new Error('The sandbox factory is a needed parameter');

          var _this = this;

          _this.sandboxFactory = sandboxFactory;

          _this.runtimeCatalogue = new RuntimeCatalogue();

          // TODO: post and return registry/hypertyRuntimeInstance to and from Back-end Service
          // the response is like: runtime://sp1/123

          var runtimeURL = 'runtime://ua.pt/' + Math.floor(Math.random() * 10000 + 1);
          _this.runtimeURL = runtimeURL;

          // TODO: check if runtime catalogue need the runtimeURL;
          _this.runtimeCatalogue.runtimeURL = runtimeURL;

          // Use the sandbox factory to create an AppSandbox;
          // In the future can be decided by policyEngine if we need
          // create a AppSandbox or not;
          var appSandbox = sandboxFactory.createAppSandbox();

          // Instantiate the identity Module
          _this.identityModule = new IdentityModule();

          // Instantiate the Policy Engine
          _this.policyEngine = new PolicyEngine();

          // Instantiate the Registry Module
          _this.registry = new Registry(runtimeURL, appSandbox);

          // Instantiate the Message Bus
          _this.messageBus = new MessageBus(_this.registry);

          // Register messageBus on Registry
          _this.registry.messageBus = _this.messageBus;

          _this.registry.addEventListener('runtime:loadStub', function (domainURL) {

            _this.loadStub(domainURL).then(function (result) {
              _this.registry.trigger('runtime:stubLoaded', domainURL);
            })['catch'](function (reason) {
              console.error(reason);
            });
          });

          // Use sandbox factory to use specific methods
          // and set the message bus to the factory
          sandboxFactory.messageBus = _this.messageBus;

          // Instanciate the SyncherManager;
          _this.syncherManager = new SyncherManager(_this.runtimeURL, _this.messageBus, {});
        }

        /**
        * Accomodate interoperability in H2H and proto on the fly for newly discovered devices in M2M
        * @param  {CatalogueDataObject.HypertyDescriptor}   descriptor    descriptor
        */

        _createClass(RuntimeUA, [{
          key: 'discoverHiperty',
          value: function discoverHiperty(descriptor) {}
          // Body...

          /**
          * Register Hyperty deployed by the App that is passed as input parameter. To be used when App and Hyperties are from the same domain otherwise the RuntimeUA will raise an exception and the App has to use the loadHyperty(..) function.
          * @param  {Object} Object                   hypertyInstance
          * @param  {URL.HypertyCatalogueURL}         descriptor      descriptor
          */

        }, {
          key: 'registerHyperty',
          value: function registerHyperty(hypertyInstance, descriptor) {}
          // Body...

          /**
          * Deploy Hyperty from Catalogue URL
          * @param  {URL.URL}    hyperty hypertyInstance url;
          */

        }, {
          key: 'loadHyperty',
          value: function loadHyperty(hypertyDescriptorURL) {

            var _this = this;

            if (!hypertyDescriptorURL) throw new Error('Hyperty descriptor url parameter is needed');

            return new _Promise(function (resolve, reject) {

              var _hypertyURL = undefined;
              var _hypertySandbox = undefined;
              var _hypertyDescriptor = undefined;
              var _hypertySourcePackage = undefined;

              var errorReason = function errorReason(reason) {
                console.error(reason);
                reject(reason);
              };

              // Get Hyperty descriptor
              // TODO: the request Module should be changed,
              // because at this moment it is incompatible with nodejs;
              // Probably we need to pass a factory like we do for sandboxes;
              console.log('------------------ Hyperty ------------------------');
              console.info('Get hyperty descriptor for :', hypertyDescriptorURL);
              _this.runtimeCatalogue.getHypertyDescriptor(hypertyDescriptorURL).then(function (hypertyDescriptor) {
                // at this point, we have completed "step 2 and 3" as shown in https://github.com/reTHINK-project/core-framework/blob/master/docs/specs/runtime/dynamic-view/basics/deploy-hyperty.md
                console.info('1: return hyperty descriptor', hypertyDescriptor);

                // hyperty contains the full path of the catalogue URL, e.g.
                // catalogue.rethink.eu/.well-known/..........
                _hypertyDescriptor = hypertyDescriptor;

                var sourcePackageURL = hypertyDescriptor.sourcePackageURL;

                // Get the hyperty source code
                return _this.runtimeCatalogue.getHypertySourcePackage(sourcePackageURL);
              }).then(function (sourcePackage) {
                console.info('2: return hyperty source code');

                // at this point, we have completed "step 4 and 5" as shown in https://github.com/reTHINK-project/core-framework/blob/master/docs/specs/runtime/dynamic-view/basics/deploy-hyperty.md

                _hypertySourcePackage = sourcePackage;

                //
                // steps 6 -- 9 are skipped.
                // TODO: on release of core 0.2;
                // TODO: Promise to check the policy engine

                // mock-up code;
                // temporary code, only
                var policy = true;

                return policy;
              }).then(function (policyResult) {
                console.info('3: return policy engine result');

                // we have completed step 6 to 9 of https://github.com/reTHINK-project/core-framework/blob/master/docs/specs/runtime/dynamic-view/basics/deploy-hyperty.md right now.
                //
                // Steps 6 -- 9
                // As a result of the sipped steps, we know at this point if we execute
                // inSameSandbox or not.
                //

                // For testing, just assume we execute in same Sandbox.
                var inSameSandbox = true;
                var sandbox = undefined;

                if (inSameSandbox) {

                  // this don't need be a Promise;
                  sandbox = _this.registry.getAppSandbox();

                  // we have completed step 11 here.
                } else {

                    // getSandbox, this will return a promise;
                    sandbox = _this.registry.getSandbox(domain);
                  }

                // this will return the sandbox or one promise to getSandbox;
                return sandbox;
              }).then(function (sandbox) {
                console.info('4: return the sandbox', sandbox);

                // Return the sandbox indepentely if it running in the same sandbox or not
                // we have completed step 14 here.
                return sandbox;
              }, function (reason) {
                console.error('4.1: try to register a new sandbox', reason);

                // check if the sandbox is registed for this hyperty descriptor url;
                // Make Steps xxx --- xxx
                // Instantiate the Sandbox
                return _this.sandboxFactory.createSandbox();
              }).then(function (sandbox) {
                console.info('5: return sandbox and register');

                _hypertySandbox = sandbox;

                // Register hyperty
                return _this.registry.registerHyperty(sandbox, hypertyDescriptorURL);
              }).then(function (hypertyURL) {
                console.info('6: Hyperty url, after register hyperty', hypertyURL);

                // we have completed step 16 of https://github.com/reTHINK-project/core-framework/blob/master/docs/specs/runtime/dynamic-view/basics/deploy-hyperty.md right now.

                _hypertyURL = hypertyURL;

                // Extend original hyperty configuration;
                var configuration = _Object$assign({}, _hypertyDescriptor.configuration);
                configuration.runtimeURL = _this.runtimeURL;

                // We will deploy the component - step 17 of https://github.com/reTHINK-project/core-framework/blob/master/docs/specs/runtime/dynamic-view/basics/deploy-hyperty.md right now.
                return _hypertySandbox.deployComponent(_hypertySourcePackage.sourceCode, _hypertyURL, configuration);
              }).then(function (deployComponentStatus) {
                console.info('7: Deploy component status for hyperty: ', deployComponentStatus);

                // we have completed step 19 https://github.com/reTHINK-project/core-framework/blob/master/docs/specs/runtime/dynamic-view/basics/deploy-hyperty.md right now.

                // Add the message bus listener to the appSandbox or hypertSandbox;
                _this.messageBus.addListener(_hypertyURL, function (msg) {
                  _hypertySandbox.postMessage(msg);
                });

                // we have completed step 20 of https://github.com/reTHINK-project/core-framework/blob/master/docs/specs/runtime/dynamic-view/basics/deploy-hyperty.md right now.
                var hyperty = {
                  runtimeHypertyURL: _hypertyURL,
                  status: deployComponentStatus
                };

                resolve(hyperty);

                // we have completed step 21 https://github.com/reTHINK-project/core-framework/blob/master/docs/specs/runtime/dynamic-view/basics/deploy-hyperty.md right now.
                console.log('------------------ END ------------------------');
              })['catch'](errorReason);
            });
          }

          /**
          * Deploy Stub from Catalogue URL or domain url
          * @param  {URL.URL}     domain          domain
          */
        }, {
          key: 'loadStub',
          value: function loadStub(domain) {

            var _this = this;

            if (!domain) throw new Error('domain parameter is needed');

            return new _Promise(function (resolve, reject) {

              var _stubSandbox = undefined;
              var _stubDescriptor = undefined;
              var _runtimeProtoStubURL = undefined;
              var _stubSourcePackage = undefined;

              var errorReason = function errorReason(reason) {
                console.error(reason);
                reject(reason);
              };

              // Discover Protocol Stub
              console.info('------------------- ProtoStub ---------------------------\n');
              console.info('Discover or Create a new ProtoStub for domain: ', domain);
              _this.registry.discoverProtostub(domain).then(function (descriptor) {
                // Is registed?
                console.info('1. Proto Stub Discovered: ', descriptor);
                _stubDescriptor = descriptor;

                // we have completed step 2 https://github.com/reTHINK-project/core-framework/blob/master/docs/specs/runtime/dynamic-view/basics/deploy-protostub.md

                return _stubDescriptor;
              }, function (reason) {
                // is not registed?
                console.info('1. Proto Stub not found:', reason);

                // we have completed step 3 https://github.com/reTHINK-project/core-framework/blob/master/docs/specs/runtime/dynamic-view/basics/deploy-protostub.md

                // we need to get ProtoStub descriptor step 4 https://github.com/reTHINK-project/core-framework/blob/master/docs/specs/runtime/dynamic-view/basics/deploy-protostub.md
                return _this.runtimeCatalogue.getStubDescriptor(domain);
              }).then(function (stubDescriptor) {

                console.info('2. return the ProtoStub descriptor:', stubDescriptor);

                // we have completed step 5 https://github.com/reTHINK-project/core-framework/blob/master/docs/specs/runtime/dynamic-view/basics/deploy-protostub.md

                _stubDescriptor = stubDescriptor;

                var sourcePackageURL = stubDescriptor.sourcePackageURL;

                console.log(stubDescriptor.sourcePackageURL);

                // we need to get ProtoStub Source code from descriptor - step 6 https://github.com/reTHINK-project/core-framework/blob/master/docs/specs/runtime/dynamic-view/basics/deploy-protostub.md
                return _this.runtimeCatalogue.getStubSourcePackage(sourcePackageURL);
              }).then(function (stubSourcePackage) {
                console.info('3. return the ProtoStub Source Code: ', stubSourcePackage);

                // we have completed step 7 https://github.com/reTHINK-project/core-framework/blob/master/docs/specs/runtime/dynamic-view/basics/deploy-protostub.md

                _stubSourcePackage = stubSourcePackage;

                // TODO: Check on PEP (policy Engine) if we need the sandbox and check if the Sandbox Factory have the context sandbox;
                var policy = true;
                return policy;
              }).then(function (policy) {
                // this will return the sandbox or one promise to getSandbox;
                return _this.registry.getSandbox(domain);
              }).then(function (stubSandbox) {

                console.info('4. if the sandbox is registered then return the sandbox', stubSandbox);

                // we have completed step xxx https://github.com/reTHINK-project/core-framework/blob/master/docs/specs/runtime/dynamic-view/basics/deploy-protostub.md

                _stubSandbox = stubSandbox;
                return stubSandbox;
              }, function (reason) {
                console.info('5. Sandbox was not found, creating a new one');

                // check if the sandbox is registed for this stub descriptor url;
                // Make Steps xxx --- xxx
                // Instantiate the Sandbox
                return _this.sandboxFactory.createSandbox();
              }).then(function (sandbox) {
                console.info('6. return the sandbox instance and the register', sandbox);

                _stubSandbox = sandbox;

                // we need register stub on registry - step xxx https://github.com/reTHINK-project/core-framework/blob/master/docs/specs/runtime/dynamic-view/basics/deploy-protostub.md
                return _this.registry.registerStub(_stubSandbox, domain);
              }).then(function (runtimeProtoStubURL) {

                console.info('7. return the runtime protostub url: ', runtimeProtoStubURL);

                // we have completed step xxx https://github.com/reTHINK-project/core-framework/blob/master/docs/specs/runtime/dynamic-view/basics/deploy-protostub.md

                _runtimeProtoStubURL = runtimeProtoStubURL;

                // Extend original hyperty configuration;
                var configuration = _Object$assign({}, _stubDescriptor.configuration);
                configuration.runtimeURL = _this.runtimeURL;

                console.log(_stubSourcePackage);

                // Deploy Component step xxx
                return _stubSandbox.deployComponent(_stubSourcePackage.sourceCode, runtimeProtoStubURL, configuration);
              }).then(function (deployComponentStatus) {
                console.info('8: return deploy component for sandbox status: ', deployComponentStatus);

                // we have completed step xxx https://github.com/reTHINK-project/core-framework/blob/master/docs/specs/runtime/dynamic-view/basics/deploy-protostub.md

                // Add the message bus listener
                _this.messageBus.addListener(_runtimeProtoStubURL, function (msg) {
                  _stubSandbox.postMessage(msg);
                });

                // we have completed step xxx https://github.com/reTHINK-project/core-framework/blob/master/docs/specs/runtime/dynamic-view/basics/deploy-protostub.md

                // Load Stub function resolved with success;
                var stub = {
                  runtimeProtoStubURL: _runtimeProtoStubURL,
                  status: deployComponentStatus
                };

                resolve(stub);
                console.info('------------------- END ---------------------------\n');
              })['catch'](errorReason);
            });
          }

          /**
          * Used to check for updates about components handled in the Catalogue including protocol stubs and Hyperties. check relationship with lifecycle management provided by Service Workers
          * @param  {CatalogueURL}       url url
          */
        }, {
          key: 'checkForUpdate',
          value: function checkForUpdate(url) {
            // Body...
          }
        }]);

        return RuntimeUA;
      })();

      _export('default', RuntimeUA);
    }
  };
});
$__System.register('64', ['63', 'd', 'e', 'c'], function (_export) {
  'use strict';

  var RuntimeUA, Sandbox, MiniBus, SandboxRegistry;
  return {
    setters: [function (_) {
      RuntimeUA = _['default'];
    }, function (_d) {
      Sandbox = _d['default'];
    }, function (_e) {
      MiniBus = _e['default'];
    }, function (_c) {
      SandboxRegistry = _c['default'];
    }],
    execute: function () {
      _export('RuntimeUA', RuntimeUA);

      _export('Sandbox', Sandbox);

      _export('MiniBus', MiniBus);

      _export('SandboxRegistry', SandboxRegistry);
    }
  };
});
(function() {
var _removeDefine = $__System.get("@@amd-helpers").createDefine();
define("5", ["64"], function(main) {
  return main;
});

_removeDefine();
})();
$__System.register('1', ['5', 'b'], function (_export) {
    'use strict';

    var RuntimeUA, SandboxFactory, runtime;
    return {
        setters: [function (_) {
            RuntimeUA = _.RuntimeUA;
        }, function (_b) {
            SandboxFactory = _b['default'];
        }],
        execute: function () {
            runtime = new RuntimeUA(SandboxFactory);

            SandboxFactory.messageBus._onPostMessage = function (msg) {
                window.postMessage(msg, '*');
            };

            window.addEventListener('message', function (event) {
                if (event.data.to === 'runtime:loadHyperty') {
                    runtime.loadHyperty(event.data.body.descriptor).then(function (msg) {
                        return event.source.postMessage(msg, '*');
                    });
                } else if (event.data.to === 'runtime:loadStub') {
                    runtime.loadStub(event.data.body.domain).then(function (msg) {
                        return event.source.postMessage(msg, '*');
                    });
                } else {
                    SandboxFactory.messageBus._onMessage(event.data);
                }
            }, false);
        }
    };
});
})
(function(factory) {
  factory();
});
//# sourceMappingURL=context-core.js.map