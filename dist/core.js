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
$__System.register('2', ['3', '4', '5', '6', '7'], function (_export) {
  var _get, _inherits, _createClass, _classCallCheck, Bus, MiniBus;

  return {
    setters: [function (_) {
      _get = _['default'];
    }, function (_2) {
      _inherits = _2['default'];
    }, function (_3) {
      _createClass = _3['default'];
    }, function (_4) {
      _classCallCheck = _4['default'];
    }, function (_5) {
      Bus = _5['default'];
    }],
    execute: function () {
      'use strict';

      MiniBus = (function (_Bus) {
        _inherits(MiniBus, _Bus);

        function MiniBus() {
          _classCallCheck(this, MiniBus);

          _get(Object.getPrototypeOf(MiniBus.prototype), 'constructor', this).call(this);
        }

        _createClass(MiniBus, [{
          key: 'postMessage',
          value: function postMessage(inMsg, responseCallback) {
            var _this = this;

            _this._genId(inMsg);
            _this._responseCallback(inMsg, responseCallback);

            //always send to external (to core MessageBus)
            _this._onPostMessage(inMsg);

            return inMsg.id;
          }
        }, {
          key: '_onMessage',
          value: function _onMessage(msg) {
            var _this = this;

            if (!_this._onResponse(msg)) {
              var itemList = _this._subscriptions[msg.to];
              if (itemList) {
                _this._publishOn(itemList, msg);
                if (!msg.to.startsWith('hyperty')) {
                  _this._publishOnDefault(msg);
                }
              } else {
                _this._publishOnDefault(msg);
              }
            }
          }
        }]);

        return MiniBus;
      })(Bus);

      _export('default', MiniBus);
    }
  };
});
$__System.register('8', ['2', '3', '4', '5', '6', '9'], function (_export) {
    var MiniBus, _get, _inherits, _createClass, _classCallCheck, Sandbox, SandboxApp;

    return {
        setters: [function (_6) {
            MiniBus = _6['default'];
        }, function (_) {
            _get = _['default'];
        }, function (_2) {
            _inherits = _2['default'];
        }, function (_3) {
            _createClass = _3['default'];
        }, function (_4) {
            _classCallCheck = _4['default'];
        }, function (_5) {
            Sandbox = _5['default'];
        }],
        execute: function () {
            'use strict';

            SandboxApp = (function (_Sandbox) {
                _inherits(SandboxApp, _Sandbox);

                function SandboxApp() {
                    _classCallCheck(this, SandboxApp);

                    _get(Object.getPrototypeOf(SandboxApp.prototype), 'constructor', this).call(this);

                    window.addEventListener('message', (function (e) {
                        if (!!!this.origin) this.origin = e.source;

                        if (e.data.to.startsWith('core:')) return;

                        this._onMessage(e.data);
                    }).bind(this));
                }

                _createClass(SandboxApp, [{
                    key: '_onPostMessage',
                    value: function _onPostMessage(msg) {
                        this.origin.postMessage(msg, '*');
                    }
                }]);

                return SandboxApp;
            })(Sandbox);

            _export('default', SandboxApp);
        }
    };
});
$__System.register('a', ['3', '4', '5', '6', '7'], function (_export) {
  var _get, _inherits, _createClass, _classCallCheck, Bus, MiniBus;

  return {
    setters: [function (_) {
      _get = _['default'];
    }, function (_2) {
      _inherits = _2['default'];
    }, function (_3) {
      _createClass = _3['default'];
    }, function (_4) {
      _classCallCheck = _4['default'];
    }, function (_5) {
      Bus = _5['default'];
    }],
    execute: function () {
      'use strict';

      MiniBus = (function (_Bus) {
        _inherits(MiniBus, _Bus);

        function MiniBus() {
          _classCallCheck(this, MiniBus);

          _get(Object.getPrototypeOf(MiniBus.prototype), 'constructor', this).call(this);
        }

        _createClass(MiniBus, [{
          key: 'postMessage',
          value: function postMessage(inMsg, responseCallback) {
            var _this = this;

            _this._genId(inMsg);
            _this._responseCallback(inMsg, responseCallback);

            //always send to external (to core MessageBus)
            _this._onPostMessage(inMsg);

            return inMsg.id;
          }
        }, {
          key: '_onMessage',
          value: function _onMessage(msg) {
            var _this = this;

            if (!_this._onResponse(msg)) {
              var itemList = _this._subscriptions[msg.to];
              if (itemList) {
                _this._publishOn(itemList, msg);
                if (!msg.to.startsWith('hyperty')) {
                  _this._publishOnDefault(msg);
                }
              } else {
                _this._publishOnDefault(msg);
              }
            }
          }
        }]);

        return MiniBus;
      })(Bus);

      _export('default', MiniBus);
    }
  };
});
$__System.register('b', ['5', '6'], function (_export) {
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

      SandboxRegistry.ExternalDeployAddress = 'hyperty-runtime://sandbox/external';
      SandboxRegistry.InternalDeployAddress = 'hyperty-runtime://sandbox/internal';

      _export('default', SandboxRegistry);
    }
  };
});
$__System.register('9', ['3', '4', '5', '6', 'c', 'b', 'a'], function (_export) {
  var _get, _inherits, _createClass, _classCallCheck, _Promise, SandboxRegistry, MiniBus, Sandbox;

  return {
    setters: [function (_) {
      _get = _['default'];
    }, function (_2) {
      _inherits = _2['default'];
    }, function (_3) {
      _createClass = _3['default'];
    }, function (_4) {
      _classCallCheck = _4['default'];
    }, function (_c) {
      _Promise = _c['default'];
    }, function (_b) {
      SandboxRegistry = _b['default'];
    }, function (_a) {
      MiniBus = _a['default'];
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
$__System.register('d', ['3', '4', '5', '6', '9'], function (_export) {
    var _get, _inherits, _createClass, _classCallCheck, Sandbox, SandboxWorker;

    return {
        setters: [function (_) {
            _get = _['default'];
        }, function (_2) {
            _inherits = _2['default'];
        }, function (_3) {
            _createClass = _3['default'];
        }, function (_4) {
            _classCallCheck = _4['default'];
        }, function (_5) {
            Sandbox = _5['default'];
        }],
        execute: function () {
            'use strict';

            SandboxWorker = (function (_Sandbox) {
                _inherits(SandboxWorker, _Sandbox);

                function SandboxWorker(script) {
                    _classCallCheck(this, SandboxWorker);

                    _get(Object.getPrototypeOf(SandboxWorker.prototype), 'constructor', this).call(this, script);
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
$__System.register('e', ['8', 'd'], function (_export) {

    //TODO: resources url dependency
    'use strict';

    var SandboxApp, SandboxWorker;
    function createSandbox() {
        return new SandboxWorker('../dist/context-service.js');
    }

    function createAppSandbox() {
        return new SandboxApp();
    }

    return {
        setters: [function (_) {
            SandboxApp = _['default'];
        }, function (_d) {
            SandboxWorker = _d['default'];
        }],
        execute: function () {
            _export('default', { createSandbox: createSandbox, createAppSandbox: createAppSandbox });
        }
    };
});
$__System.register('f', ['5', '6', '10', '11'], function (_export) {
  var _createClass, _classCallCheck, divideURL, Subscription, ObserverObject;

  return {
    setters: [function (_) {
      _createClass = _['default'];
    }, function (_2) {
      _classCallCheck = _2['default'];
    }, function (_3) {
      divideURL = _3.divideURL;
    }, function (_4) {
      Subscription = _4['default'];
    }],
    execute: function () {
      'use strict';

      ObserverObject = (function () {
        function ObserverObject(bus, url) {
          _classCallCheck(this, ObserverObject);

          var _this = this;

          _this._bus = bus;
          _this._url = url;
          _this._subscriptions = {};
        }

        _createClass(ObserverObject, [{
          key: 'addSubscription',
          value: function addSubscription(hyperty, childrens) {
            var _this = this;

            _this._subscriptions[hyperty] = new Subscription(_this._bus, hyperty, _this._url, childrens);
          }
        }, {
          key: 'removeSubscription',
          value: function removeSubscription(hyperty) {
            var _this = this;

            var domain = divideURL(hyperty).domain;
            var objURLSubscription = _this._url + '/subscription';

            var subscription = _this._subscriptions[hyperty];
            if (subscription) {
              //unsubscribe msg to the Reporter SM
              _this._bus.postMessage({
                type: 'unsubscribe', from: _this._url, to: objURLSubscription,
                body: { resource: _this._url }
              });

              //TODO: should I wait for response before unsubscribe on msg-node
              //unsubscribe msg to the domain node
              _this._bus.postMessage({
                type: 'unsubscribe', from: _this._url, to: 'domain://msg-node.' + domain + '/sm',
                body: { resource: _this._url }
              });

              subscription._releaseListeners();
              delete _this._subscriptions[hyperty];
            }
          }
        }]);

        return ObserverObject;
      })();

      _export('default', ObserverObject);
    }
  };
});
$__System.register('11', ['5', '6'], function (_export) {
  var _createClass, _classCallCheck, Subscription;

  return {
    setters: [function (_) {
      _createClass = _['default'];
    }, function (_2) {
      _classCallCheck = _2['default'];
    }],
    execute: function () {
      'use strict';

      Subscription = (function () {
        function Subscription(bus, hyperty, url, childrens) {
          _classCallCheck(this, Subscription);

          var _this = this;
          var childBaseURL = url + '/children/';

          //TODO: how to process delete message?

          //subscription accepted (add forward and subscription)
          _this._changeListener = bus.addForward(url + '/changes', hyperty);

          //add forward for children
          _this._childrenListeners = [];
          childrens.forEach(function (child) {
            var childrenForward = bus.addForward(childBaseURL + child, hyperty);
            _this._childrenListeners.push(childrenForward);
          });
        }

        _createClass(Subscription, [{
          key: '_releaseListeners',
          value: function _releaseListeners() {
            var _this = this;

            _this._changeListener.remove();
            _this._childrenListeners.forEach(function (forward) {
              forward.remove();
            });
          }
        }]);

        return Subscription;
      })();

      _export('default', Subscription);
    }
  };
});
$__System.register('12', ['5', '6', '10', '11', '13'], function (_export) {
  var _createClass, _classCallCheck, divideURL, Subscription, _Object$keys, ReporterObject;

  return {
    setters: [function (_) {
      _createClass = _['default'];
    }, function (_2) {
      _classCallCheck = _2['default'];
    }, function (_4) {
      divideURL = _4.divideURL;
    }, function (_5) {
      Subscription = _5['default'];
    }, function (_3) {
      _Object$keys = _3['default'];
    }],
    execute: function () {
      'use strict';

      ReporterObject = (function () {
        function ReporterObject(parent, owner, url, childrens) {
          _classCallCheck(this, ReporterObject);

          var _this = this;

          _this._parent = parent;
          _this._owner = owner;
          _this._url = url;
          _this._childrens = childrens;

          _this._objSubscriptorURL = _this._url + '/subscription';
          _this._bus = parent._bus;
          _this._subscriptions = {};

          _this._allocateListeners();
        }

        _createClass(ReporterObject, [{
          key: '_allocateListeners',
          value: function _allocateListeners() {
            var _this = this;

            //add objectURL forward...
            _this._objForward = _this._bus.addForward(_this._url, _this._owner);

            //add subscription listener...
            _this._subscriptionListener = _this._bus.addListener(_this._objSubscriptorURL, function (msg) {
              console.log(_this._objSubscriptorURL + '-RCV: ', msg);
              switch (msg.type) {
                case 'subscribe':
                  _this._onRemoteSubscribe(msg);break;
                case 'unsubscribe':
                  _this._onRemoteUnSubscribe(msg);break;
                case 'response':
                  _this._onRemoteResponse(msg);break;
              }
            });

            //add children listeners...
            var childBaseURL = _this._url + '/children/';
            _this._childrenListeners = [];
            _this._childrens.forEach(function (child) {
              var childURL = childBaseURL + child;
              var childListener = _this._bus.addListener(childURL, function (msg) {
                //TODO: what todo here? Process child creations?
                console.log('SyncherManager-' + childURL + '-RCV: ', msg);
              });

              _this._childrenListeners.push(childListener);
            });
          }
        }, {
          key: '_releaseListeners',
          value: function _releaseListeners() {
            var _this = this;

            _this._objForward.remove();

            _this._subscriptionListener.remove();

            _this._childrenListeners.forEach(function (cl) {
              cl.remove();
            });

            //remove all subscriptions
            _Object$keys(_this._subscriptions).forEach(function (key) {
              _this._subscriptions[key]._releaseListeners();
            });
          }
        }, {
          key: 'delete',
          value: function _delete() {
            var _this = this;

            var domain = divideURL(_this._owner).domain;

            //delete msg to all subscriptions
            _this._bus.postMessage({
              type: 'delete', from: _this._objSubscriptorURL, to: _this._url + '/changes'
            });

            //TODO: should I wait for response before delete on msg-node
            //delete msg to the domain node
            _this._bus.postMessage({
              type: 'delete', from: _this._url, to: 'domain://msg-node.' + domain + '/hyperty-address-allocation',
              body: { resource: _this._url }
            });

            _this._releaseListeners();
            delete _this._parent._reporters[_this._url];
          }
        }, {
          key: '_onRemoteResponse',
          value: function _onRemoteResponse(msg) {
            var _this = this;

            _this._bus.postMessage({
              id: msg.id, type: 'response', from: msg.to, to: _this._url,
              body: { code: msg.body.code, source: msg.from }
            });
          }
        }, {
          key: '_onRemoteSubscribe',
          value: function _onRemoteSubscribe(msg) {
            var _this = this;
            var hypertyURL = msg.body.subscriber;

            //validate if subscription already exists?
            if (_this._subscriptions[hypertyURL]) {
              var errorMsg = {
                id: msg.id, type: 'response', from: msg.to, to: hypertyURL,
                body: { code: 500, desc: 'Subscription for (' + _this._url + ' : ' + hypertyURL + ') already exists!' }
              };

              _this._bus.postMessage(errorMsg);
              return;
            }

            //ask to subscribe to Syncher? (depends on the operation mode)
            //TODO: get mode from object!
            var mode = 'sub/pub';

            if (mode === 'sub/pub') {
              //forward to Hyperty owner
              var forwardMsg = {
                type: 'forward', from: _this._url, to: _this._owner,
                body: { type: msg.type, from: hypertyURL, to: _this._url }
              };

              _this._bus.postMessage(forwardMsg, function (reply) {
                console.log('forward-reply: ', reply);
                if (reply.body.code === 200) {
                  _this._subscriptions[hypertyURL] = new Subscription(_this._bus, hypertyURL, _this._url, _this._childrens);
                }

                //send subscribe-response
                _this._bus.postMessage({
                  id: msg.id, type: 'response', from: msg.to, to: msg.from,
                  body: reply.body
                });
              });
            }
          }
        }, {
          key: '_onRemoteUnSubscribe',
          value: function _onRemoteUnSubscribe(msg) {
            var _this = this;
            var hypertyURL = msg.body.subscriber;

            var subscription = _this._subscriptions[hypertyURL];
            if (subscription) {
              subscription._releaseListeners();
              delete _this._subscriptions[hypertyURL];

              //TODO: send un-subscribe message to Syncher? (depends on the operation mode)
            }
          }
        }]);

        return ReporterObject;
      })();

      _export('default', ReporterObject);
    }
  };
});
$__System.register('14', ['5', '6', 'c'], function (_export) {
  var _createClass, _classCallCheck, _Promise, ObjectAllocation;

  return {
    setters: [function (_) {
      _createClass = _['default'];
    }, function (_2) {
      _classCallCheck = _2['default'];
    }, function (_c) {
      _Promise = _c['default'];
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
          value: function create(domain, scheme, children, number) {
            var _this = this;

            var msg = {
              type: 'create', from: _this._url, to: 'domain://msg-node.' + domain + '/object-address-allocation',
              body: { scheme: scheme, childrenResources: children, value: { number: number } }
            };

            return new _Promise(function (resolve, reject) {
              _this._bus.postMessage(msg, function (reply) {
                if (reply.body.code === 200) {
                  resolve(reply.body.value.allocated);
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
$__System.register('15', ['5', '6', '10', '12', '14', 'f'], function (_export) {
  var _createClass, _classCallCheck, divideURL, ReporterObject, ObjectAllocation, ObserverObject, SyncherManager;

  return {
    setters: [function (_) {
      _createClass = _['default'];
    }, function (_2) {
      _classCallCheck = _2['default'];
    }, function (_3) {
      divideURL = _3.divideURL;
    }, function (_5) {
      ReporterObject = _5['default'];
    }, function (_4) {
      ObjectAllocation = _4['default'];
    }, function (_f) {
      ObserverObject = _f['default'];
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
         _reporters: { ObjectURL: ReporterObject }
        _observers: { ObjectURL: ObserverObject }
        */

        function SyncherManager(runtimeURL, bus, registry, catalog, allocator) {
          _classCallCheck(this, SyncherManager);

          var _this = this;

          _this._bus = bus;
          _this._registry = registry;
          _this._catalog = catalog;

          //TODO: these should be saved in persistence engine?
          _this._url = runtimeURL + '/sm';
          _this._objectURL = runtimeURL + '/object-allocation';

          _this._reporters = {};
          _this._observers = {};

          //TODO: this should not be hardcoded!
          _this._domain = divideURL(runtimeURL).domain;

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
              case 'subscribe':
                _this._onLocalSubscribe(msg);break;
              case 'unsubscribe':
                _this._onLocalUnSubscribe(msg);break;
            }
          });
        }

        _createClass(SyncherManager, [{
          key: '_onCreate',
          value: function _onCreate(msg) {
            var _this = this;
            var owner = msg.from;
            var domain = divideURL(msg.from).domain;

            //TODO: 5-7 authorizeObjectCreation(owner, obj ???? )
            //TODO: other optional steps

            //get schema from catalogue and parse -> (scheme, children)
            _this._catalog.getDataSchemaDescriptor(msg.body.schema).then(function (descriptor) {
              var properties = descriptor.sourcePackage.sourceCode.properties;
              var scheme = properties.scheme ? properties.scheme.constant : 'resource';
              var childrens = properties.children ? properties.children.constant : [];

              _this._allocator.create(domain, scheme, childrens, 1).then(function (allocated) {
                //TODO: get address from address allocator ?
                var objURL = allocated[0];
                var objSubscriptorURL = objURL + '/subscription';

                _this._reporters[objURL] = new ReporterObject(_this, owner, objURL, childrens);

                //all ok, send response
                _this._bus.postMessage({
                  id: msg.id, type: 'response', from: msg.to, to: owner,
                  body: { code: 200, resource: objURL, childrenResources: childrens }
                });

                //send create to all observers, responses will be deliver to the Hyperty owner?
                setTimeout(function () {
                  //schedule for next cycle needed, because the Reporter should be available.
                  msg.body.authorise.forEach(function (hypertyURL) {
                    _this._bus.postMessage({
                      type: 'create', from: objSubscriptorURL, to: hypertyURL,
                      body: { source: msg.from, value: msg.body.value, schema: msg.body.schema }
                    });
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

            var objURL = msg.body.resource;

            var object = _this._reporters[objURL];
            if (object) {
              //TODO: is there any policy verification before delete?
              object['delete']();

              //TODO: destroy object in the registry?
              _this._bus.postMessage({
                id: msg.id, type: 'response', from: msg.to, to: msg.from,
                body: { code: 200 }
              });
            }
          }
        }, {
          key: '_onLocalSubscribe',
          value: function _onLocalSubscribe(msg) {
            var _this2 = this;

            var _this = this;

            var hypertyURL = msg.from;
            var domain = divideURL(hypertyURL).domain;
            var objURL = msg.body.resource;
            var objURLSubscription = objURL + '/subscription';

            //get schema from catalogue and parse -> (children)
            _this._catalog.getDataSchemaDescriptor(msg.body.schema).then(function (descriptor) {
              var properties = descriptor.sourcePackage.sourceCode.properties;
              var childrens = properties.children ? properties.children.constant : [];

              //subscribe msg for the domain node
              var nodeSubscribeMsg = {
                type: 'subscribe', from: _this._url, to: 'domain://msg-node.' + domain + '/sm',
                body: { resource: objURL, childrenResources: childrens, schema: msg.body.schema }
              };

              //subscribe in msg-node
              _this._bus.postMessage(nodeSubscribeMsg, function (reply) {
                console.log('node-subscribe-response: ', reply);
                if (reply.body.code === 200) {

                  //send provisional response
                  _this._bus.postMessage({
                    id: msg.id, type: 'response', from: msg.to, to: hypertyURL,
                    body: { code: 100, childrenResources: childrens }
                  });

                  var objSubscribeMsg = {
                    type: 'subscribe', from: _this._url, to: objURLSubscription,
                    body: { subscriber: hypertyURL }
                  };

                  //subscribe to reporter SM
                  _this._bus.postMessage(objSubscribeMsg, function (reply) {
                    console.log('reporter-subscribe-response: ', reply);
                    if (reply.body.code === 200) {

                      var observer = _this._observers[objURL];
                      if (!observer) {
                        observer = new ObserverObject(_this._bus, objURL);
                        _this._observers[objURL] = observer;
                      }

                      observer.addSubscription(hypertyURL, childrens);

                      //forward to hyperty:
                      reply.id = msg.id;
                      reply.from = _this._url;
                      reply.to = hypertyURL;
                      _this2._bus.postMessage(reply);
                    }
                  });
                } else {
                  //listener rejected
                  _this._bus.postMessage({
                    id: msg.id, type: 'response', from: msg.to, to: hypertyURL,
                    body: reply.body
                  });
                }
              });
            });
          }
        }, {
          key: '_onLocalUnSubscribe',
          value: function _onLocalUnSubscribe(msg) {
            var _this = this;

            var hypertyURL = msg.from;
            var objURL = msg.body.resource;

            var observer = _this._observers[objURL];
            if (observer) {
              //TODO: is there any policy verification before delete?
              observer.removeSubscription(hypertyURL);

              //TODO: destroy object in the registry?
              _this._bus.postMessage({
                id: msg.id, type: 'response', from: msg.to, to: msg.from,
                body: { code: 200 }
              });

              //TODO: remove Object if no more subscription?
              //delete _this._observers[objURL];
            }
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
$__System.register('16', ['5', '6', '10', '17', 'c'], function (_export) {
  var _createClass, _classCallCheck, divideURL, CatalogueFactory, _Promise, RuntimeCatalogue;

  return {
    setters: [function (_) {
      _createClass = _['default'];
    }, function (_2) {
      _classCallCheck = _2['default'];
    }, function (_3) {
      divideURL = _3.divideURL;
    }, function (_4) {
      CatalogueFactory = _4.CatalogueFactory;
    }, function (_c) {
      _Promise = _c['default'];
    }],
    execute: function () {
      'use strict';

      RuntimeCatalogue = (function () {
        function RuntimeCatalogue() {
          _classCallCheck(this, RuntimeCatalogue);

          // console.log('runtime catalogue');
          var _this = this;
          _this._factory = new CatalogueFactory(false, undefined);
        }

        _createClass(RuntimeCatalogue, [{
          key: 'getHypertyRuntimeURL',

          /**
          * Get hypertyRuntimeURL
          */
          value: function getHypertyRuntimeURL() {
            var _this = this;

            // TODO: check if this is real needed;
            return _this._hypertyRuntimeURL;
          }

          /**
          * TODO: Delete this method
          */
        }, {
          key: '_makeLocalRequest',
          value: function _makeLocalRequest(url) {

            console.log(url);

            return new _Promise(function (resolve, reject) {
              var protocolmap = {
                'hyperty-catalogue://': 'http://',
                '../': '../'
              };

              var foundProtocol = false;
              for (var protocol in protocolmap) {
                if (url.slice(0, protocol.length) === protocol) {
                  // console.log('exchanging ' + protocol + " with " + protocolmap[protocol]);
                  url = protocolmap[protocol] + url.slice(protocol.length, url.length);
                  foundProtocol = true;
                  break;
                }
              }

              if (!foundProtocol) {
                reject('Invalid protocol of url: ' + url);
                return;
              }

              var xhr = new XMLHttpRequest();

              // console.log(url);

              xhr.open('GET', url, true);

              xhr.onreadystatechange = function (event) {
                var xhr = event.currentTarget;
                if (xhr.readyState === 4) {
                  // console.log("got response:", xhr);
                  if (xhr.status === 200) {
                    resolve(xhr.responseText);
                  } else {
                    // console.log("rejecting promise because of response code: 200 != ", xhr.status);
                    reject(xhr.responseText);
                  }
                }
              };

              xhr.send();
            });
          }

          /**
          * make a http request to a given URL.
          * @param url
          * @returns {Promise}
          * @private
          */
        }, {
          key: '_makeExternalRequest',
          value: function _makeExternalRequest(url) {
            // console.log("_makeExternalRequest", url);

            // TODO: make this request compatible with nodejs
            // at this moment, XMLHttpRequest only is compatible with browser implementation
            // nodejs doesn't support;
            return new _Promise(function (resolve, reject) {
              var protocolmap = {
                'hyperty-catalogue://': 'http://'
              };

              var foundProtocol = false;
              for (var protocol in protocolmap) {
                if (url.slice(0, protocol.length) === protocol) {
                  // console.log("exchanging " + protocol + " with " + protocolmap[protocol]);
                  url = protocolmap[protocol] + url.slice(protocol.length, url.length);
                  foundProtocol = true;
                  break;
                }
              }

              if (!foundProtocol) {
                reject('Invalid protocol of url: ' + url);
                return;
              }

              var xhr = new XMLHttpRequest();

              // console.log(url);

              xhr.open('GET', url, true);

              xhr.onreadystatechange = function (event) {
                var xhr = event.currentTarget;
                if (xhr.readyState === 4) {
                  // console.log("got response:", xhr);
                  if (xhr.status === 200) {
                    resolve(xhr.responseText);
                  } else {
                    // console.log("rejecting promise because of response code: 200 != ", xhr.status);
                    reject(xhr.responseText);
                  }
                }
              };

              xhr.send();
            });
          }

          /**
          * Get HypertyDescriptor
          * @param hypertyURL - e.g. mydomain.com/.well-known/hyperty/MyHyperty
          * @returns {Promise}
          */
        }, {
          key: 'getHypertyDescriptor',
          value: function getHypertyDescriptor(hypertyURL) {
            var _this = this;

            // console.log("getHypertyDescriptor", hypertyURL);

            return new _Promise(function (resolve, reject) {

              var dividedURL = divideURL(hypertyURL);
              var domain = dividedURL.domain;
              var hyperty = dividedURL.identity;

              if (!domain) {
                domain = hypertyURL;
              }

              if (hyperty) {
                hyperty = hyperty.substring(hyperty.lastIndexOf('/') + 1);
              }

              _this._makeLocalRequest('../resources/descriptors/Hyperties.json').then(function (descriptor) {
                _this.Hyperties = JSON.parse(descriptor);

                var result = _this.Hyperties[hyperty];

                if (result.error) {
                  // TODO handle error properly
                  reject(result);
                } else {
                  // console.log("creating hyperty descriptor based on: ", result);

                  // create the descriptor
                  var _hyperty = _this._factory.createHypertyDescriptorObject(result.cguid, result.objectName, result.description, result.language, result.sourcePackageURL, result.type, result.dataObjects);

                  // optional fields
                  _hyperty.configuration = result.configuration;
                  _hyperty.constraints = result.constraints;
                  _hyperty.messageSchema = result.messageSchema;
                  _hyperty.policies = result.policies;
                  _hyperty.signature = result.signature;

                  // parse and attach sourcePackage
                  var sourcePackage = result.sourcePackage;
                  if (sourcePackage) {
                    // console.log("hyperty has sourcePackage:", sourcePackage);
                    _hyperty.sourcePackage = _this._createSourcePackage(_this._factory, sourcePackage);
                  }

                  console.log('hyperty has sourcePackage:', _hyperty);

                  resolve(_hyperty);
                }
              });
            });
          }

          /**
          * Get source Package from a URL
          * @param sourcePackageURL - e.g. mydomain.com/.well-known/hyperty/MyHyperty/sourcePackage
          * @returns {Promise}
          */
        }, {
          key: 'getSourcePackageFromURL',
          value: function getSourcePackageFromURL(sourcePackageURL) {
            var _this = this;

            // console.log("getting sourcePackage from:", sourcePackageURL);

            return new _Promise(function (resolve, reject) {

              if (sourcePackageURL === '/sourcePackage') {
                reject('sourcePackage is already contained in descriptor, please use it directly');
              }

              _this._makeExternalRequest(sourcePackageURL).then(function (result) {
                // console.log("got raw sourcePackage:", result);
                if (result.error) {
                  // TODO handle error properly
                  reject(result);
                } else {
                  result = JSON.parse(result);

                  var sourcePackage = result.sourcePackage;
                  if (sourcePackage) {
                    sourcePackage = _this._createSourcePackage(_this._factory, sourcePackage);
                    resolve(sourcePackage);
                  } else {
                    reject('no source package');
                  }
                }
              })['catch'](function (reason) {
                reject(reason);
              });
            });
          }

          /**
          * Get StubDescriptor
          * @param stubURL - e.g. mydomain.com/.well-known/protostub/MyProtostub
          * @returns {Promise}
          */
        }, {
          key: 'getStubDescriptor',
          value: function getStubDescriptor(stubURL) {
            var _this = this;

            // console.log("getting stub descriptor from: " + stubURL);
            return new _Promise(function (resolve, reject) {

              var dividedURL = divideURL(stubURL);
              var domain = dividedURL.domain;
              var protoStub = dividedURL.identity;

              if (!domain) {
                domain = stubURL;
              }

              if (!protoStub) {
                protoStub = 'default';
              } else {
                protoStub = protoStub.substring(protoStub.lastIndexOf('/') + 1);
              }

              _this._makeLocalRequest('../resources/descriptors/ProtoStubs.json').then(function (descriptor) {
                _this.ProtoStubs = JSON.parse(descriptor);

                var result = _this.ProtoStubs[protoStub];

                if (result.error) {
                  // TODO handle error properly
                  reject(result);
                } else {
                  console.log('creating stub descriptor based on: ', result);

                  // create the descriptor
                  var stub = _this._factory.createProtoStubDescriptorObject(result.cguid, result.objectName, result.description, result.language, result.sourcePackageURL, result.messageSchemas, JSON.stringify(result.configuration), result.constraints);

                  // parse and attach sourcePackage
                  var sourcePackage = result.sourcePackage;

                  if (sourcePackage) {
                    sourcePackage = _this._createSourcePackage(_this._factory, sourcePackage);
                    stub.sourcePackage = sourcePackage;
                  }
                  resolve(stub);
                }
              });
            });
          }

          /**
          * Get DataSchemaDescriptor
          * @param dataSchemaURL - e.g. mydomain.com/.well-known/dataschema/MyDataSchema
          * @returns {Promise}
          */
        }, {
          key: 'getDataSchemaDescriptor',
          value: function getDataSchemaDescriptor(dataSchemaURL) {
            var _this = this;

            return new _Promise(function (resolve, reject) {

              // request the json
              if (dataSchemaURL) {
                dataSchemaURL = dataSchemaURL.substring(dataSchemaURL.lastIndexOf('/') + 1);
              }

              _this._makeLocalRequest('../resources/descriptors/DataSchemas.json').then(function (descriptor) {

                _this.DataSchemas = JSON.parse(descriptor);

                var result = _this.DataSchemas[dataSchemaURL];

                if (result.ERROR) {
                  // TODO handle error properly
                  reject(result);
                } else {
                  console.log('creating dataSchema based on: ', result);

                  // FIXME: accessControlPolicy field not needed?
                  // create the descriptor
                  var dataSchema = _this._factory.createDataObjectSchema(result.cguid, result.objectName, result.description, result.language, result.sourcePackageURL);

                  console.log('created dataSchema descriptor object:', dataSchema);

                  // parse and attach sourcePackage
                  var sourcePackage = result.sourcePackage;
                  if (sourcePackage) {
                    // console.log('dataSchema has sourcePackage:', sourcePackage);
                    dataSchema.sourcePackage = _this._createSourcePackage(_this._factory, sourcePackage);
                    if (typeof dataSchema.sourcePackage.sourceCode === 'string') {
                      dataSchema.sourcePackage.sourceCode = JSON.parse(dataSchema.sourcePackage.sourceCode);
                    }
                  }

                  resolve(dataSchema);
                }
              });
            });
          }
        }, {
          key: '_createSourcePackage',
          value: function _createSourcePackage(factory, sp) {
            // console.log("creating sourcePackage. factory:", factory, ", raw package:", sp);
            try {
              sp = JSON.parse(sp);
            } catch (e) {
              console.log('parsing sourcePackage failed. already parsed? -> ', sp);
            }

            // check encoding
            if (sp.encoding === 'base64') {
              sp.sourceCode = atob(sp.sourceCode);
              sp.encoding = 'UTF-8';
            }

            var sourcePackage = factory.createSourcePackage(sp.sourceCodeClassname, sp.sourceCode);

            if (sp.hasOwnProperty('encoding')) sourcePackage.encoding = sp.encoding;

            if (sp.hasOwnProperty('signature')) sourcePackage.signature = sp.signature;

            return sourcePackage;
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
$__System.register("18", ["5", "6"], function (_export) {
  var _createClass, _classCallCheck, Pipeline, PipeContext, Iterator;

  return {
    setters: [function (_) {
      _createClass = _["default"];
    }, function (_2) {
      _classCallCheck = _2["default"];
    }],
    execute: function () {
      /**
      * @author micaelpedrosa@gmail.com
      * Pipeline
      * Sequencial processor of methods. Similar to how Sequential Promise's work, but better fit for message processing.
      */
      "use strict";

      Pipeline = (function () {
        /* public
          handlers: ((PipeContext) => void)[]
          onFail: (error) => void
        */

        function Pipeline(_onFail) {
          _classCallCheck(this, Pipeline);

          var _this = this;

          _this.handlers = [];
          _this.onFail = _onFail;
        }

        _createClass(Pipeline, [{
          key: "process",
          value: function process(msg, onDeliver) {
            var _this = this;

            if (_this.handlers.length > 0) {
              var iter = new Iterator(_this.handlers);
              iter.next(new PipeContext(_this, iter, msg, onDeliver));
            } else {
              onDeliver(msg);
            }
          }
        }]);

        return Pipeline;
      })();

      PipeContext = (function () {
        /* private
          _inStop: boolean
           _pipeline: Pipeline
          _iter: Iterator
          _msg: Message
        */

        function PipeContext(pipeline, iter, msg, onDeliver) {
          _classCallCheck(this, PipeContext);

          var _this = this;

          _this._inStop = false;

          _this._pipeline = pipeline;
          _this._iter = iter;
          _this._msg = msg;
          _this._onDeliver = onDeliver;
        }

        _createClass(PipeContext, [{
          key: "next",
          value: function next() {
            var _this = this;

            if (!_this._inStop) {
              if (_this._iter.hasNext) {
                _this._iter.next(_this);
              } else {
                _this._onDeliver(_this._msg);
              }
            }
          }
        }, {
          key: "deliver",
          value: function deliver() {
            var _this = this;
            if (!_this._inStop) {
              _this._inStop = true;
              _this._onDeliver(_this._msg);
            }
          }
        }, {
          key: "fail",
          value: function fail(error) {
            var _this = this;

            if (!_this._inStop) {
              _this._inStop = true;
              if (_this._pipeline.onFail) {
                _this._pipeline.onFail(error);
              }
            }
          }
        }, {
          key: "pipeline",
          get: function get() {
            return this._pipeline;
          }
        }, {
          key: "msg",
          get: function get() {
            return this._msg;
          },
          set: function set(inMsg) {
            this._msg = inMsg;
          }
        }]);

        return PipeContext;
      })();

      Iterator = (function () {
        /* private
          _index: number
          _array: []
        */

        function Iterator(array) {
          _classCallCheck(this, Iterator);

          this._index = -1;
          this._array = array;
        }

        _createClass(Iterator, [{
          key: "hasNext",
          get: function get() {
            return this._index < this._array.length - 1;
          }
        }, {
          key: "next",
          get: function get() {
            this._index++;
            return this._array[this._index];
          }
        }]);

        return Iterator;
      })();

      _export("default", Pipeline);
    }
  };
});
$__System.register('7', ['5', '6'], function (_export) {
  var _createClass, _classCallCheck, Bus, MsgListener;

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

      Bus = (function () {
        /* private
        _msgId: number;
        _subscriptions: <url: MsgListener[]>
         _responseTimeOut: number
        _responseCallbacks: <url+id: (msg) => void>
         */

        function Bus() {
          _classCallCheck(this, Bus);

          var _this = this;
          _this._msgId = 0;
          _this._subscriptions = {};

          _this._responseTimeOut = 5000; //default to 3s
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

        _createClass(Bus, [{
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

          //publish on default listeners
        }, {
          key: '_publishOnDefault',
          value: function _publishOnDefault(msg) {
            //is there any "*" (default) listeners?
            var itemList = this._subscriptions['*'];
            if (itemList) {
              this._publishOn(itemList, msg);
            }
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
          key: '_responseCallback',
          value: function _responseCallback(inMsg, responseCallback) {
            var _this = this;

            //automatic management of response handlers
            if (responseCallback) {
              (function () {
                var responseId = inMsg.from + inMsg.id;
                _this._responseCallbacks[responseId] = responseCallback;

                setTimeout(function () {
                  var responseFun = _this._responseCallbacks[responseId];
                  delete _this._responseCallbacks[responseId];

                  if (responseFun) {
                    var errorMsg = {
                      id: inMsg.id, type: 'response',
                      body: { code: 408, desc: 'Response timeout!', value: inMsg }
                    };

                    responseFun(errorMsg);
                  }
                }, _this._responseTimeOut);
              })();
            }
          }
        }, {
          key: '_onResponse',
          value: function _onResponse(msg) {
            var _this = this;

            if (msg.type === 'response') {
              var responseId = msg.to + msg.id;
              var responseFun = _this._responseCallbacks[responseId];

              //if it's a provisional response, don't delete response listener
              if (msg.body.code >= 200) {
                delete _this._responseCallbacks[responseId];
              }

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
                _this._publishOnDefault(msg);
              }
            }
          }
        }, {
          key: '_genId',
          value: function _genId(inMsg) {
            //TODO: how do we manage message ID's? Should it be a global runtime counter, or per URL address?
            //Global counter will not work, because there will be multiple MiniBus instances!
            //Per URL, can be a lot of data to maintain!
            //Maybe a counter per MiniBus instance. This is the assumed solution for now.
            if (!inMsg.id || inMsg.id === 0) {
              this._msgId++;
              inMsg.id = this._msgId;
            }
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
          value: function postMessage(inMsg, responseCallback) {}

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

        return Bus;
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

      _export('default', Bus);
    }
  };
});
$__System.registerDynamic("19", ["1a", "1b"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $export = $__require('1a');
  $export($export.P, 'Set', {toJSON: $__require('1b')('Set')});
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("1c", ["1d", "1e"], true, function($__require, exports, module) {
  "use strict";
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var strong = $__require('1d');
  $__require('1e')('Set', function(get) {
    return function Set() {
      return get(this, arguments.length > 0 ? arguments[0] : undefined);
    };
  }, {add: function add(value) {
      return strong.def(this, value = value === 0 ? 0 : value, value);
    }}, strong);
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("1f", ["20", "21", "22", "1c", "19", "23"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  $__require('20');
  $__require('21');
  $__require('22');
  $__require('1c');
  $__require('19');
  module.exports = $__require('23').Set;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("24", ["1f"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": $__require('1f'),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("1b", ["25", "26"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var forOf = $__require('25'),
      classof = $__require('26');
  module.exports = function(NAME) {
    return function toJSON() {
      if (classof(this) != NAME)
        throw TypeError(NAME + "#toJSON isn't generic");
      var arr = [];
      forOf(this, false, arr.push, arr);
      return arr;
    };
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("27", ["1a", "1b"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $export = $__require('1a');
  $export($export.P, 'Map', {toJSON: $__require('1b')('Map')});
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("1e", ["28", "29", "1a", "2a", "2b", "2c", "25", "2d", "2e", "2f", "30"], true, function($__require, exports, module) {
  "use strict";
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = $__require('28'),
      global = $__require('29'),
      $export = $__require('1a'),
      fails = $__require('2a'),
      hide = $__require('2b'),
      redefineAll = $__require('2c'),
      forOf = $__require('25'),
      strictNew = $__require('2d'),
      isObject = $__require('2e'),
      setToStringTag = $__require('2f'),
      DESCRIPTORS = $__require('30');
  module.exports = function(NAME, wrapper, methods, common, IS_MAP, IS_WEAK) {
    var Base = global[NAME],
        C = Base,
        ADDER = IS_MAP ? 'set' : 'add',
        proto = C && C.prototype,
        O = {};
    if (!DESCRIPTORS || typeof C != 'function' || !(IS_WEAK || proto.forEach && !fails(function() {
      new C().entries().next();
    }))) {
      C = common.getConstructor(wrapper, NAME, IS_MAP, ADDER);
      redefineAll(C.prototype, methods);
    } else {
      C = wrapper(function(target, iterable) {
        strictNew(target, C, NAME);
        target._c = new Base;
        if (iterable != undefined)
          forOf(iterable, IS_MAP, target[ADDER], target);
      });
      $.each.call('add,clear,delete,forEach,get,has,set,keys,values,entries'.split(','), function(KEY) {
        var IS_ADDER = KEY == 'add' || KEY == 'set';
        if (KEY in proto && !(IS_WEAK && KEY == 'clear'))
          hide(C.prototype, KEY, function(a, b) {
            if (!IS_ADDER && IS_WEAK && !isObject(a))
              return KEY == 'get' ? undefined : false;
            var result = this._c[KEY](a === 0 ? 0 : a, b);
            return IS_ADDER ? this : result;
          });
      });
      if ('size' in proto)
        $.setDesc(C.prototype, 'size', {get: function() {
            return this._c.size;
          }});
    }
    setToStringTag(C, NAME);
    O[NAME] = C;
    $export($export.G + $export.W + $export.F, O);
    if (!IS_WEAK)
      common.setStrong(C, NAME, IS_MAP);
    return C;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("1d", ["28", "2b", "2c", "31", "2d", "32", "25", "33", "34", "35", "36", "2e", "37", "30"], true, function($__require, exports, module) {
  "use strict";
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = $__require('28'),
      hide = $__require('2b'),
      redefineAll = $__require('2c'),
      ctx = $__require('31'),
      strictNew = $__require('2d'),
      defined = $__require('32'),
      forOf = $__require('25'),
      $iterDefine = $__require('33'),
      step = $__require('34'),
      ID = $__require('35')('id'),
      $has = $__require('36'),
      isObject = $__require('2e'),
      setSpecies = $__require('37'),
      DESCRIPTORS = $__require('30'),
      isExtensible = Object.isExtensible || isObject,
      SIZE = DESCRIPTORS ? '_s' : 'size',
      id = 0;
  var fastKey = function(it, create) {
    if (!isObject(it))
      return typeof it == 'symbol' ? it : (typeof it == 'string' ? 'S' : 'P') + it;
    if (!$has(it, ID)) {
      if (!isExtensible(it))
        return 'F';
      if (!create)
        return 'E';
      hide(it, ID, ++id);
    }
    return 'O' + it[ID];
  };
  var getEntry = function(that, key) {
    var index = fastKey(key),
        entry;
    if (index !== 'F')
      return that._i[index];
    for (entry = that._f; entry; entry = entry.n) {
      if (entry.k == key)
        return entry;
    }
  };
  module.exports = {
    getConstructor: function(wrapper, NAME, IS_MAP, ADDER) {
      var C = wrapper(function(that, iterable) {
        strictNew(that, C, NAME);
        that._i = $.create(null);
        that._f = undefined;
        that._l = undefined;
        that[SIZE] = 0;
        if (iterable != undefined)
          forOf(iterable, IS_MAP, that[ADDER], that);
      });
      redefineAll(C.prototype, {
        clear: function clear() {
          for (var that = this,
              data = that._i,
              entry = that._f; entry; entry = entry.n) {
            entry.r = true;
            if (entry.p)
              entry.p = entry.p.n = undefined;
            delete data[entry.i];
          }
          that._f = that._l = undefined;
          that[SIZE] = 0;
        },
        'delete': function(key) {
          var that = this,
              entry = getEntry(that, key);
          if (entry) {
            var next = entry.n,
                prev = entry.p;
            delete that._i[entry.i];
            entry.r = true;
            if (prev)
              prev.n = next;
            if (next)
              next.p = prev;
            if (that._f == entry)
              that._f = next;
            if (that._l == entry)
              that._l = prev;
            that[SIZE]--;
          }
          return !!entry;
        },
        forEach: function forEach(callbackfn) {
          var f = ctx(callbackfn, arguments.length > 1 ? arguments[1] : undefined, 3),
              entry;
          while (entry = entry ? entry.n : this._f) {
            f(entry.v, entry.k, this);
            while (entry && entry.r)
              entry = entry.p;
          }
        },
        has: function has(key) {
          return !!getEntry(this, key);
        }
      });
      if (DESCRIPTORS)
        $.setDesc(C.prototype, 'size', {get: function() {
            return defined(this[SIZE]);
          }});
      return C;
    },
    def: function(that, key, value) {
      var entry = getEntry(that, key),
          prev,
          index;
      if (entry) {
        entry.v = value;
      } else {
        that._l = entry = {
          i: index = fastKey(key, true),
          k: key,
          v: value,
          p: prev = that._l,
          n: undefined,
          r: false
        };
        if (!that._f)
          that._f = entry;
        if (prev)
          prev.n = entry;
        that[SIZE]++;
        if (index !== 'F')
          that._i[index] = entry;
      }
      return that;
    },
    getEntry: getEntry,
    setStrong: function(C, NAME, IS_MAP) {
      $iterDefine(C, NAME, function(iterated, kind) {
        this._t = iterated;
        this._k = kind;
        this._l = undefined;
      }, function() {
        var that = this,
            kind = that._k,
            entry = that._l;
        while (entry && entry.r)
          entry = entry.p;
        if (!that._t || !(that._l = entry = entry ? entry.n : that._t._f)) {
          that._t = undefined;
          return step(1);
        }
        if (kind == 'keys')
          return step(0, entry.k);
        if (kind == 'values')
          return step(0, entry.v);
        return step(0, [entry.k, entry.v]);
      }, IS_MAP ? 'entries' : 'values', !IS_MAP, true);
      setSpecies(NAME);
    }
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("38", ["1d", "1e"], true, function($__require, exports, module) {
  "use strict";
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var strong = $__require('1d');
  $__require('1e')('Map', function(get) {
    return function Map() {
      return get(this, arguments.length > 0 ? arguments[0] : undefined);
    };
  }, {
    get: function get(key) {
      var entry = strong.getEntry(this, key);
      return entry && entry.v;
    },
    set: function set(key, value) {
      return strong.def(this, key === 0 ? 0 : key, value);
    }
  }, strong, true);
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("39", ["20", "21", "22", "38", "27", "23"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  $__require('20');
  $__require('21');
  $__require('22');
  $__require('38');
  $__require('27');
  module.exports = $__require('23').Map;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("3a", ["39"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": $__require('39'),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

$__System.register('3b', ['3', '4', '5', '6', '7', '18', '24', '3a'], function (_export) {
  var _get, _inherits, _createClass, _classCallCheck, Bus, Pipeline, _Set, _Map, MessageBus;

  return {
    setters: [function (_) {
      _get = _['default'];
    }, function (_2) {
      _inherits = _2['default'];
    }, function (_3) {
      _createClass = _3['default'];
    }, function (_4) {
      _classCallCheck = _4['default'];
    }, function (_6) {
      Bus = _6['default'];
    }, function (_7) {
      Pipeline = _7['default'];
    }, function (_5) {
      _Set = _5['default'];
    }, function (_a) {
      _Map = _a['default'];
    }],
    execute: function () {
      /**
      * Message BUS Interface is an extension of the MiniBus
      * It doesn't support the default '*' listener, instead it uses the registry.resolve(..)
      */
      'use strict';

      MessageBus = (function (_Bus) {
        _inherits(MessageBus, _Bus);

        /* private
        _registry: Registry
        _forwards: { <from-url>: { fl: MsgListener, sandboxToUrls: Map(Sandbox, [to-url]), urlToSandbox: { to-url: Sandbox } } }
         _pipeline: Pipeline
        */

        //TODO: future optimization
        //1. message batch processing with setInterval
        //2. resolve default gateway/protostub with register.resolve

        function MessageBus(registry) {
          _classCallCheck(this, MessageBus);

          _get(Object.getPrototypeOf(MessageBus.prototype), 'constructor', this).call(this);
          this._registry = registry;
          this._forwards = {};

          this._pipeline = new Pipeline(function (error) {
            console.log('PIPELINE-ERROR: ', JSON.stringify(error));
          });
        }

        _createClass(MessageBus, [{
          key: 'postMessage',
          value: function postMessage(inMsg, responseCallback) {
            var _this = this;

            _this._genId(inMsg);

            _this._pipeline.process(inMsg, function (msg) {

              _this._responseCallback(inMsg, responseCallback);

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
            });

            return inMsg.id;
          }
        }, {
          key: 'addForward',
          value: function addForward(from, to) {
            var _this2 = this;

            var _this = this;

            //verify if forward exist
            var conf = _this._forwards[from];
            if (!conf) {
              var forwardListener = _this.addListener(from, function (msg) {
                conf.sandboxToUrls.forEach(function (urls, sandbox) {
                  console.log('MB-FORWARD: ( ' + from + ' to ' + urls.size + ' destinations)');
                  urls.forEach(function (value) {
                    console.log('SEND-TO: ', value);
                  });

                  sandbox.postMessage(msg);
                });
              });

              conf = {
                from: from,
                fl: forwardListener,
                sandboxToUrls: new _Map(),
                urlToSandbox: new _Map(),

                //remove forward detination
                remove: function remove(url) {
                  var sandbox = _this2.urlToSandbox.get(url);
                  if (sandbox) {
                    _this2.urlToSandbox['delete'](url);
                    _this2.sandboxToUrls.get(sandbox)['delete'](url);
                  }
                }
              };

              _this._forwards[from] = conf;
            }

            //add forward detination
            this._registry.getSandbox(to).then(function (sandbox) {
              var urls = conf.sandboxToUrls.get(sandbox);
              if (!urls) {
                urls = new _Set();
                conf.sandboxToUrls.set(sandbox, urls);
              }

              urls.add(to);
              conf.urlToSandbox.set(to, sandbox);
            });

            return conf;
          }
        }, {
          key: '_publish',
          value: function _publish(url, msg) {
            var _this = this;

            var itemList = _this._subscriptions[url];
            if (itemList) {
              _this._publishOn(itemList, msg);
            }
          }
        }, {
          key: '_onPostMessage',
          value: function _onPostMessage(msg) {
            var _this = this;

            //resolve external protostub...
            _this._registry.resolve(msg.to).then(function (route) {
              _this._publish(route, msg);
            })['catch'](function (e) {
              console.log('RESOLVE-ERROR: ', e);
            });
          }
        }, {
          key: 'pipeline',
          get: function get() {
            return this._pipeline;
          }
        }]);

        return MessageBus;
      })(Bus);

      _export('default', MessageBus);
    }
  };
});
$__System.register('3c', ['5', '6'], function (_export) {
  var _createClass, _classCallCheck, PDP;

  return {
    setters: [function (_) {
      _createClass = _['default'];
    }, function (_2) {
      _classCallCheck = _2['default'];
    }],
    execute: function () {
      'use strict';

      PDP = (function () {
        function PDP() {
          _classCallCheck(this, PDP);

          var _this = this;
          _this.blackList = [];
          _this.whiteList = [];
        }

        /* use hashtable to allow dynamic management */

        _createClass(PDP, [{
          key: 'evaluate',
          value: function evaluate(registry, message, hypertyToVerify, policies) {
            var _this = this;
            var results = [true];
            var actions = [];

            for (var i in policies) {
              var policy = policies[i];
              var result = [];
              var condition = policy.condition.split(' ');
              switch (condition[0]) {
                case 'blacklisted':
                  result[0] = _this.isBlackListed(registry, hypertyToVerify) ? policy.authorise : !policy.authorise;
                  break;
                case 'whitelisted':
                  result[0] = _this.isWhiteListed(hypertyToVerify) ? policy.authorise : !policy.authorise;
                  break;
                case 'time':
                  var start = condition[1];
                  var end = condition[2];
                  result[0] = _this.isTimeBetween(start, end) ? policy.authorise : !policy.authorise;
                  break;
                default:

                  // TODO: do actions depend on the decision?
                  result[1] = policy.actions;
              }

              results.push(result[0]);
              actions.push(result[1]);
            }

            var authDecision = _this.getDecision(results);
            return [authDecision, actions];
          }
        }, {
          key: 'isSameOrigin',
          value: function isSameOrigin() {}
        }, {
          key: 'isBlackListed',
          value: function isBlackListed(registry, hypertyToVerify) {
            var _this = this;
            var blackList = _this.blackList;
            for (var i in blackList) {
              if ((_this.hypertiesMatch(registry, blackList[i]), hypertyToVerify)) {
                return true;
              }
            }
            return false;
          }

          /* TODO: cache this? */
        }, {
          key: 'hypertiesMatch',
          value: function hypertiesMatch(registry, URLToVerify, hypertyToVerify) {
            registry.getUserHyperty(URLToVerify).then(function (hyperty) {
              return hyperty.hypertyURL === hypertyToVerify;
            });
          }
        }, {
          key: 'isWhiteListed',
          value: function isWhiteListed(userID) {
            var _this = this;
            return _this.whiteList.indexOf(userID) > -1;
          }
        }, {
          key: 'isTimeBetween',
          value: function isTimeBetween(start, end) {
            var _this = this;
            var now = new Date();
            var nowMinutes = _this.getMinutes(parseInt(now.getHours()) + ':' + now.getMinutes());
            var startMinutes = _this.getMinutes(start);
            var endMinutes = _this.getMinutes(end);
            if (endMinutes > startMinutes) {
              return nowMinutes > startMinutes && nowMinutes < endMinutes;
            } else {
              if (nowMinutes < startMinutes) {
                nowMinutes += 24 * 60;
              }
              endMinutes += 24 * 60;
              return nowMinutes > startMinutes && nowMinutes < endMinutes;
            }
          }

          /* Aux function for isTimeBetween() */
        }, {
          key: 'getMinutes',
          value: function getMinutes(time) {
            var timeSplit = time.split(':');
            return parseInt(timeSplit[0]) * 60 + parseInt(timeSplit[1]);
          }
        }, {
          key: 'getBlackList',
          value: function getBlackList() {
            var _this = this;
            return _this.blackList;
          }
        }, {
          key: 'isContext',
          value: function isContext() {}
        }, {
          key: 'isHypertyType',
          value: function isHypertyType() {}

          /* Aux function for evaluate() */
        }, {
          key: 'getDecision',
          value: function getDecision(results) {
            return results.indexOf(false) === -1;
          }
        }, {
          key: 'addToBlackList',
          value: function addToBlackList(userID) {
            var _this = this;
            if (_this.blackList.indexOf(userID) === -1) {
              _this.blackList.push(userID);
            }
          }
        }, {
          key: 'removeFromBlackList',
          value: function removeFromBlackList(userID) {
            var _this = this;
            var blackList = _this.blackList;
            for (var i in blackList) {
              if (blackList[i] === userID) {
                blackList.splice(i, 1);
                break;
              }
            }
          }
        }, {
          key: 'addToWhiteList',
          value: function addToWhiteList(userID) {
            var _this = this;
            if (_this.blackList.indexOf(userID) === -1) {
              _this.whiteList.push(userID);
            }
          }
        }, {
          key: 'removeFromWhiteList',
          value: function removeFromWhiteList(userID) {
            var _this = this;
            var whiteList = _this.whiteList;
            for (var i in whiteList) {
              if (whiteList[i] === userID) {
                whiteList.splice(i, 1);
                break;
              }
            }
          }
        }]);

        return PDP;
      })();

      _export('default', PDP);
    }
  };
});
$__System.register("3d", ["5", "6"], function (_export) {
  var _createClass, _classCallCheck, PEP;

  return {
    setters: [function (_) {
      _createClass = _["default"];
    }, function (_2) {
      _classCallCheck = _2["default"];
    }],
    execute: function () {
      "use strict";

      PEP = (function () {
        function PEP() {
          _classCallCheck(this, PEP);
        }

        _createClass(PEP, [{
          key: "enforce",
          value: function enforce() {}
        }, {
          key: "sendAutomaticMessage",
          value: function sendAutomaticMessage() {}
        }, {
          key: "forwardToID",
          value: function forwardToID() {}
        }, {
          key: "forwardToHyperty",
          value: function forwardToHyperty() {}
        }]);

        return PEP;
      })();

      _export("default", PEP);
    }
  };
});
$__System.register('3e', ['5', '6', 'c', '3d', '3c'], function (_export) {
  var _createClass, _classCallCheck, _Promise, PEP, PDP, PolicyEngine;

  return {
    setters: [function (_) {
      _createClass = _['default'];
    }, function (_2) {
      _classCallCheck = _2['default'];
    }, function (_c) {
      _Promise = _c['default'];
    }, function (_d) {
      PEP = _d['default'];
    }, function (_c2) {
      PDP = _c2['default'];
    }],
    execute: function () {

      // import Policy from './Policy';

      'use strict';

      PolicyEngine = (function () {
        function PolicyEngine(identityModule, runtimeRegistry) {
          _classCallCheck(this, PolicyEngine);

          var _this = this;
          _this.idModule = identityModule;
          _this.registry = runtimeRegistry;
          _this.pep = new PEP();
          _this.pdp = new PDP();
          _this.policies = {};
        }

        // TODO: verify duplicates
        // TODO: conflict detection

        _createClass(PolicyEngine, [{
          key: 'addPolicies',
          value: function addPolicies(key, policies) {
            var _this = this;
            for (var i in policies) {
              if (_this.policies[key] === undefined) {
                _this.policies[key] = [];
              }
              var exists = false;
              for (var policy in _this.policies[key]) {
                if (_this.policies[key][policy].id === policies[i].id) {
                  exists = true;
                  break;
                }
              }
              if (!exists) {
                _this.policies[key].push(policies[i]);
              }
            }
          }

          /*simulate(key) {
            let _this = this;
             yte
            let policy2 = new Policy(policy.id, policy.scope, policy.condition,
              policy.authorise, policy.actions);
             policy = {
              id: 'allow-whitelisted',
              scope: 'user',
              condition: 'whitelisted'c,
              authorise: true,
              actions: []
            };
            let policy3 = new Policy(policy.id, policy.scope, policy.condition,
              policy.authorise, policy.actions);
             policy = {
              id: 'block-08-20',
              scope: 'user',
              condition: 'time 08:00 20:00',
              authorise: false,
              actions: []
            };
            let policy4 = new Policy(policy.id, policy.scope, policy.condition,
              policy.authorise, policy.actions);
             _this.addPolicies(key, [policy4]);
          }*/

        }, {
          key: 'removePolicies',
          value: function removePolicies(key, policyId) {
            var _this = this;
            var allPolicies = _this.policies;

            if (key in allPolicies) {
              if (policyId !== 'all') {
                var policies = allPolicies[key];
                var numPolicies = policies.length;

                for (var policy = 0; policy < numPolicies; policy++) {
                  if (policies[policy].id === policyId) {
                    policies.splice(policy, 1);
                    break;
                  }
                }
              } else {
                delete _this.policies[key];
              }
            }
          }
        }, {
          key: 'addToBlackList',
          value: function addToBlackList(userID) {
            this.pdp.addToBlackList(userID);
          }
        }, {
          key: 'removeFromBlackList',
          value: function removeFromBlackList(userID) {
            this.pdp.removeFromBlackList(userID);
          }
        }, {
          key: 'addToWhiteList',
          value: function addToWhiteList(userID) {
            this.pdp.addToWhiteList(userID);
          }
        }, {
          key: 'removeFromWhiteList',
          value: function removeFromWhiteList(userID) {
            this.pdp.removeFromWhiteList(userID);
          }
        }, {
          key: 'authorise',
          value: function authorise(message) {
            var _this = this;
            /*let message = { id: 123, type:'READ', from:'hyperty://ua.pt/asdf',
                          to:'domain://registry.ua.pt/hyperty-instance/user' };
            _this.simulate(message.from);*/
            return new _Promise(function (resolve, reject) {
              _this.idModule.loginWithRP('google identity', 'scope').then(function (value) {
                var assertedID = _this.idModule.getIdentities();

                if (!message.hasOwnProperty('body')) {
                  message.body = {};
                }

                var hypertyToVerify = undefined;
                if (!message.body.hasOwnProperty('assertedIdentity')) {
                  message.body.assertedIdentity = assertedID[0].identity;
                  message.body.idToken = value;
                  hypertyToVerify = message.to;
                } else {
                  hypertyToVerify = message.from;
                }

                /* TODO: get scope of the message */
                var scope = 'user';

                var applicablePolicies = _this.getApplicablePolicies(scope);
                var policiesResult = undefined;
                if (hypertyToVerify.split(':')[0] === 'hyperty') {
                  policiesResult = _this.pdp.evaluate(_this.registry, message, hypertyToVerify, applicablePolicies);
                } else {
                  policiesResult = [true, []];
                }

                _this.pep.enforce(policiesResult[1]);

                if (policiesResult[0]) {
                  resolve(message);
                } else {
                  reject(message);
                }
              }, function (error) {
                reject(error);
              });
            });
          }
        }, {
          key: 'getApplicablePolicies',
          value: function getApplicablePolicies(scope) {
            var _this = this;
            var applicablePolicies = _this.policies[scope];
            if (applicablePolicies === undefined) {
              applicablePolicies = [];
            }
            return applicablePolicies;
          }
        }, {
          key: 'getBlackList',
          value: function getBlackList() {
            var _this = this;
            return _this.pdp.getBlackList();
          }
        }]);

        return PolicyEngine;
      })();

      _export('default', PolicyEngine);
    }
  };
});
$__System.registerDynamic("3f", ["40"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  "format cjs";
  (function(process) {
    if (!Object.create) {
      Object.create = (function() {
        function F() {}
        return function(o) {
          if (arguments.length != 1) {
            throw new Error('Object.create implementation only accepts one parameter.');
          }
          F.prototype = o;
          return new F();
        };
      })();
    }
    if (!Object.keys) {
      Object.keys = function(o, k, r) {
        r = [];
        for (k in o) {
          if (r.hasOwnProperty.call(o, k))
            r.push(k);
        }
        return r;
      };
    }
    if (!Array.prototype.indexOf) {
      Array.prototype.indexOf = function(s) {
        for (var j = 0; j < this.length; j++) {
          if (this[j] === s) {
            return j;
          }
        }
        return -1;
      };
    }
    if (!Array.prototype.forEach) {
      Array.prototype.forEach = function(fun) {
        if (this === void 0 || this === null) {
          throw new TypeError();
        }
        var t = Object(this);
        var len = t.length >>> 0;
        if (typeof fun !== 'function') {
          throw new TypeError();
        }
        var thisArg = arguments.length >= 2 ? arguments[1] : void 0;
        for (var i = 0; i < len; i++) {
          if (i in t) {
            fun.call(thisArg, t[i], i, t);
          }
        }
        return this;
      };
    }
    if (!Array.prototype.filter) {
      Array.prototype.filter = function(fun, thisArg) {
        var a = [];
        this.forEach(function(val, i, t) {
          if (fun.call(thisArg || void 0, val, i, t)) {
            a.push(val);
          }
        });
        return a;
      };
    }
    if (!Array.prototype.map) {
      Array.prototype.map = function(fun, thisArg) {
        var a = [];
        this.forEach(function(val, i, t) {
          a.push(fun.call(thisArg || void 0, val, i, t));
        });
        return a;
      };
    }
    if (!Array.isArray) {
      Array.isArray = function(o) {
        return Object.prototype.toString.call(o) === '[object Array]';
      };
    }
    if (typeof window === 'object' && typeof window.location === 'object' && !window.location.assign) {
      window.location.assign = function(url) {
        window.location = url;
      };
    }
    if (!Function.prototype.bind) {
      Function.prototype.bind = function(b) {
        if (typeof this !== 'function') {
          throw new TypeError('Function.prototype.bind - what is trying to be bound is not callable');
        }
        function C() {}
        var a = [].slice;
        var f = a.call(arguments, 1);
        var _this = this;
        var D = function() {
          return _this.apply(this instanceof C ? this : b || window, f.concat(a.call(arguments)));
        };
        C.prototype = this.prototype;
        D.prototype = new C();
        return D;
      };
    }
    var hello = function(name) {
      return hello.use(name);
    };
    hello.utils = {extend: function(r) {
        Array.prototype.slice.call(arguments, 1).forEach(function(a) {
          if (Array.isArray(r) && Array.isArray(a)) {
            Array.prototype.push.apply(r, a);
          } else if (r instanceof Object && a instanceof Object && r !== a) {
            for (var x in a) {
              r[x] = hello.utils.extend(r[x], a[x]);
            }
          } else {
            if (Array.isArray(a)) {
              a = a.slice(0);
            }
            r = a;
          }
        });
        return r;
      }};
    hello.utils.extend(hello, {
      settings: {
        redirect_uri: window.location.href.split('#')[0],
        response_type: 'token',
        display: 'popup',
        state: '',
        oauth_proxy: 'https://auth-server.herokuapp.com/proxy',
        timeout: 20000,
        popup: {
          resizable: 1,
          scrollbars: 1,
          width: 500,
          height: 550
        },
        scope: ['basic'],
        scope_map: {basic: ''},
        default_service: null,
        force: null,
        page_uri: window.location.href
      },
      services: {},
      use: function(service) {
        var self = Object.create(this);
        self.settings = Object.create(this.settings);
        if (service) {
          self.settings.default_service = service;
        }
        self.utils.Event.call(self);
        return self;
      },
      init: function(services, options) {
        var utils = this.utils;
        if (!services) {
          return this.services;
        }
        for (var x in services) {
          if (services.hasOwnProperty(x)) {
            if (typeof(services[x]) !== 'object') {
              services[x] = {id: services[x]};
            }
          }
        }
        utils.extend(this.services, services);
        if (options) {
          utils.extend(this.settings, options);
          if ('redirect_uri' in options) {
            this.settings.redirect_uri = utils.url(options.redirect_uri).href;
          }
        }
        return this;
      },
      login: function() {
        var _this = this;
        var utils = _this.utils;
        var error = utils.error;
        var promise = utils.Promise();
        var p = utils.args({
          network: 's',
          options: 'o',
          callback: 'f'
        }, arguments);
        var url;
        var qs = utils.diffKey(p.options, _this.settings);
        var opts = p.options = utils.merge(_this.settings, p.options || {});
        opts.popup = utils.merge(_this.settings.popup, p.options.popup || {});
        p.network = p.network || _this.settings.default_service;
        promise.proxy.then(p.callback, p.callback);
        function emit(s, value) {
          hello.emit(s, value);
        }
        promise.proxy.then(emit.bind(this, 'auth.login auth'), emit.bind(this, 'auth.failed auth'));
        if (typeof(p.network) !== 'string' || !(p.network in _this.services)) {
          return promise.reject(error('invalid_network', 'The provided network was not recognized'));
        }
        var provider = _this.services[p.network];
        var callbackId = utils.globalEvent(function(str) {
          var obj;
          if (str) {
            obj = JSON.parse(str);
          } else {
            obj = error('cancelled', 'The authentication was not completed');
          }
          if (!obj.error) {
            utils.store(obj.network, obj);
            promise.fulfill({
              network: obj.network,
              authResponse: obj
            });
          } else {
            promise.reject(obj);
          }
        });
        var redirectUri = utils.url(opts.redirect_uri).href;
        var responseType = provider.oauth.response_type || opts.response_type;
        if (/\bcode\b/.test(responseType) && !provider.oauth.grant) {
          responseType = responseType.replace(/\bcode\b/, 'token');
        }
        p.qs = utils.merge(qs, {
          client_id: encodeURIComponent(provider.id),
          response_type: encodeURIComponent(responseType),
          redirect_uri: encodeURIComponent(redirectUri),
          display: opts.display,
          state: {
            client_id: provider.id,
            network: p.network,
            display: opts.display,
            callback: callbackId,
            state: opts.state,
            redirect_uri: redirectUri
          }
        });
        var session = utils.store(p.network);
        var SCOPE_SPLIT = /[,\s]+/;
        var scope = _this.settings.scope ? [_this.settings.scope.toString()] : [];
        var scopeMap = utils.merge(_this.settings.scope_map, provider.scope || {});
        if (opts.scope) {
          scope.push(opts.scope.toString());
        }
        if (session && 'scope' in session && session.scope instanceof String) {
          scope.push(session.scope);
        }
        scope = scope.join(',').split(SCOPE_SPLIT);
        scope = utils.unique(scope).filter(filterEmpty);
        p.qs.state.scope = scope.join(',');
        scope = scope.map(function(item) {
          return (item in scopeMap) ? scopeMap[item] : item;
        });
        scope = scope.join(',').split(SCOPE_SPLIT);
        scope = utils.unique(scope).filter(filterEmpty);
        p.qs.scope = scope.join(provider.scope_delim || ',');
        if (opts.force === false) {
          if (session && 'access_token' in session && session.access_token && 'expires' in session && session.expires > ((new Date()).getTime() / 1e3)) {
            var diff = utils.diff((session.scope || '').split(SCOPE_SPLIT), (p.qs.state.scope || '').split(SCOPE_SPLIT));
            if (diff.length === 0) {
              promise.fulfill({
                unchanged: true,
                network: p.network,
                authResponse: session
              });
              return promise;
            }
          }
        }
        if (opts.display === 'page' && opts.page_uri) {
          p.qs.state.page_uri = utils.url(opts.page_uri).href;
        }
        if ('login' in provider && typeof(provider.login) === 'function') {
          provider.login(p);
        }
        if (!/\btoken\b/.test(responseType) || parseInt(provider.oauth.version, 10) < 2 || (opts.display === 'none' && provider.oauth.grant && session && session.refresh_token)) {
          p.qs.state.oauth = provider.oauth;
          p.qs.state.oauth_proxy = opts.oauth_proxy;
        }
        p.qs.state = encodeURIComponent(JSON.stringify(p.qs.state));
        if (parseInt(provider.oauth.version, 10) === 1) {
          url = utils.qs(opts.oauth_proxy, p.qs, encodeFunction);
        } else if (opts.display === 'none' && provider.oauth.grant && session && session.refresh_token) {
          p.qs.refresh_token = session.refresh_token;
          url = utils.qs(opts.oauth_proxy, p.qs, encodeFunction);
        } else {
          url = utils.qs(provider.oauth.auth, p.qs, encodeFunction);
        }
        emit('auth.init', p);
        if (opts.display === 'none') {
          utils.iframe(url, redirectUri);
        } else if (opts.display === 'popup') {
          var popup = utils.popup(url, redirectUri, opts.popup);
          var timer = setInterval(function() {
            if (!popup || popup.closed) {
              clearInterval(timer);
              if (!promise.state) {
                var response = error('cancelled', 'Login has been cancelled');
                if (!popup) {
                  response = error('blocked', 'Popup was blocked');
                }
                response.network = p.network;
                promise.reject(response);
              }
            }
          }, 100);
        } else {
          window.location = url;
        }
        return promise.proxy;
        function encodeFunction(s) {
          return s;
        }
        function filterEmpty(s) {
          return !!s;
        }
      },
      logout: function() {
        var _this = this;
        var utils = _this.utils;
        var error = utils.error;
        var promise = utils.Promise();
        var p = utils.args({
          name: 's',
          options: 'o',
          callback: 'f'
        }, arguments);
        p.options = p.options || {};
        promise.proxy.then(p.callback, p.callback);
        function emit(s, value) {
          hello.emit(s, value);
        }
        promise.proxy.then(emit.bind(this, 'auth.logout auth'), emit.bind(this, 'error'));
        p.name = p.name || this.settings.default_service;
        p.authResponse = utils.store(p.name);
        if (p.name && !(p.name in _this.services)) {
          promise.reject(error('invalid_network', 'The network was unrecognized'));
        } else if (p.name && p.authResponse) {
          var callback = function(opts) {
            utils.store(p.name, null);
            promise.fulfill(hello.utils.merge({network: p.name}, opts || {}));
          };
          var _opts = {};
          if (p.options.force) {
            var logout = _this.services[p.name].logout;
            if (logout) {
              if (typeof(logout) === 'function') {
                logout = logout(callback, p);
              }
              if (typeof(logout) === 'string') {
                utils.iframe(logout);
                _opts.force = null;
                _opts.message = 'Logout success on providers site was indeterminate';
              } else if (logout === undefined) {
                return promise.proxy;
              }
            }
          }
          callback(_opts);
        } else {
          promise.reject(error('invalid_session', 'There was no session to remove'));
        }
        return promise.proxy;
      },
      getAuthResponse: function(service) {
        service = service || this.settings.default_service;
        if (!service || !(service in this.services)) {
          return null;
        }
        return this.utils.store(service) || null;
      },
      events: {}
    });
    hello.utils.extend(hello.utils, {
      error: function(code, message) {
        return {error: {
            code: code,
            message: message
          }};
      },
      qs: function(url, params, formatFunction) {
        if (params) {
          formatFunction = formatFunction || encodeURIComponent;
          for (var x in params) {
            var str = '([\\?\\&])' + x + '=[^\\&]*';
            var reg = new RegExp(str);
            if (url.match(reg)) {
              url = url.replace(reg, '$1' + x + '=' + formatFunction(params[x]));
              delete params[x];
            }
          }
        }
        if (!this.isEmpty(params)) {
          return url + (url.indexOf('?') > -1 ? '&' : '?') + this.param(params, formatFunction);
        }
        return url;
      },
      param: function(s, formatFunction) {
        var b;
        var a = {};
        var m;
        if (typeof(s) === 'string') {
          formatFunction = formatFunction || decodeURIComponent;
          m = s.replace(/^[\#\?]/, '').match(/([^=\/\&]+)=([^\&]+)/g);
          if (m) {
            for (var i = 0; i < m.length; i++) {
              b = m[i].match(/([^=]+)=(.*)/);
              a[b[1]] = formatFunction(b[2]);
            }
          }
          return a;
        } else {
          formatFunction = formatFunction || encodeURIComponent;
          var o = s;
          a = [];
          for (var x in o) {
            if (o.hasOwnProperty(x)) {
              if (o.hasOwnProperty(x)) {
                a.push([x, o[x] === '?' ? '?' : formatFunction(o[x])].join('='));
              }
            }
          }
          return a.join('&');
        }
      },
      store: (function() {
        var a = ['localStorage', 'sessionStorage'];
        var i = -1;
        var prefix = 'test';
        var localStorage;
        while (a[++i]) {
          try {
            localStorage = window[a[i]];
            localStorage.setItem(prefix + i, i);
            localStorage.removeItem(prefix + i);
            break;
          } catch (e) {
            localStorage = null;
          }
        }
        if (!localStorage) {
          var cache = null;
          localStorage = {
            getItem: function(prop) {
              prop = prop + '=';
              var m = document.cookie.split(';');
              for (var i = 0; i < m.length; i++) {
                var _m = m[i].replace(/(^\s+|\s+$)/, '');
                if (_m && _m.indexOf(prop) === 0) {
                  return _m.substr(prop.length);
                }
              }
              return cache;
            },
            setItem: function(prop, value) {
              cache = value;
              document.cookie = prop + '=' + value;
            }
          };
          cache = localStorage.getItem('hello');
        }
        function get() {
          var json = {};
          try {
            json = JSON.parse(localStorage.getItem('hello')) || {};
          } catch (e) {}
          return json;
        }
        function set(json) {
          localStorage.setItem('hello', JSON.stringify(json));
        }
        return function(name, value, days) {
          var json = get();
          if (name && value === undefined) {
            return json[name] || null;
          } else if (name && value === null) {
            try {
              delete json[name];
            } catch (e) {
              json[name] = null;
            }
          } else if (name) {
            json[name] = value;
          } else {
            return json;
          }
          set(json);
          return json || null;
        };
      })(),
      append: function(node, attr, target) {
        var n = typeof(node) === 'string' ? document.createElement(node) : node;
        if (typeof(attr) === 'object') {
          if ('tagName' in attr) {
            target = attr;
          } else {
            for (var x in attr) {
              if (attr.hasOwnProperty(x)) {
                if (typeof(attr[x]) === 'object') {
                  for (var y in attr[x]) {
                    if (attr[x].hasOwnProperty(y)) {
                      n[x][y] = attr[x][y];
                    }
                  }
                } else if (x === 'html') {
                  n.innerHTML = attr[x];
                } else if (!/^on/.test(x)) {
                  n.setAttribute(x, attr[x]);
                } else {
                  n[x] = attr[x];
                }
              }
            }
          }
        }
        if (target === 'body') {
          (function self() {
            if (document.body) {
              document.body.appendChild(n);
            } else {
              setTimeout(self, 16);
            }
          })();
        } else if (typeof(target) === 'object') {
          target.appendChild(n);
        } else if (typeof(target) === 'string') {
          document.getElementsByTagName(target)[0].appendChild(n);
        }
        return n;
      },
      iframe: function(src) {
        this.append('iframe', {
          src: src,
          style: {
            position: 'absolute',
            left: '-1000px',
            bottom: 0,
            height: '1px',
            width: '1px'
          }
        }, 'body');
      },
      merge: function() {
        var args = Array.prototype.slice.call(arguments);
        args.unshift({});
        return this.extend.apply(null, args);
      },
      args: function(o, args) {
        var p = {};
        var i = 0;
        var t = null;
        var x = null;
        for (x in o) {
          if (o.hasOwnProperty(x)) {
            break;
          }
        }
        if ((args.length === 1) && (typeof(args[0]) === 'object') && o[x] != 'o!') {
          for (x in args[0]) {
            if (o.hasOwnProperty(x)) {
              if (x in o) {
                return args[0];
              }
            }
          }
        }
        for (x in o) {
          if (o.hasOwnProperty(x)) {
            t = typeof(args[i]);
            if ((typeof(o[x]) === 'function' && o[x].test(args[i])) || (typeof(o[x]) === 'string' && ((o[x].indexOf('s') > -1 && t === 'string') || (o[x].indexOf('o') > -1 && t === 'object') || (o[x].indexOf('i') > -1 && t === 'number') || (o[x].indexOf('a') > -1 && t === 'object') || (o[x].indexOf('f') > -1 && t === 'function')))) {
              p[x] = args[i++];
            } else if (typeof(o[x]) === 'string' && o[x].indexOf('!') > -1) {
              return false;
            }
          }
        }
        return p;
      },
      url: function(path) {
        if (!path) {
          return window.location;
        } else if (window.URL && URL instanceof Function && URL.length !== 0) {
          return new URL(path, window.location);
        } else {
          var a = document.createElement('a');
          a.href = path;
          return a.cloneNode(false);
        }
      },
      diff: function(a, b) {
        return b.filter(function(item) {
          return a.indexOf(item) === -1;
        });
      },
      diffKey: function(a, b) {
        if (a || !b) {
          var r = {};
          for (var x in a) {
            if (!(x in b)) {
              r[x] = a[x];
            }
          }
          return r;
        }
        return a;
      },
      unique: function(a) {
        if (!Array.isArray(a)) {
          return [];
        }
        return a.filter(function(item, index) {
          return a.indexOf(item) === index;
        });
      },
      isEmpty: function(obj) {
        if (!obj)
          return true;
        if (Array.isArray(obj)) {
          return !obj.length;
        } else if (typeof(obj) === 'object') {
          for (var key in obj) {
            if (obj.hasOwnProperty(key)) {
              return false;
            }
          }
        }
        return true;
      },
      Promise: (function() {
        var STATE_PENDING = 0;
        var STATE_FULFILLED = 1;
        var STATE_REJECTED = 2;
        var api = function(executor) {
          if (!(this instanceof api))
            return new api(executor);
          this.id = "Thenable/1.0.6";
          this.state = STATE_PENDING;
          this.fulfillValue = undefined;
          this.rejectReason = undefined;
          this.onFulfilled = [];
          this.onRejected = [];
          this.proxy = {then: this.then.bind(this)};
          if (typeof executor === "function")
            executor.call(this, this.fulfill.bind(this), this.reject.bind(this));
        };
        api.prototype = {
          fulfill: function(value) {
            return deliver(this, STATE_FULFILLED, "fulfillValue", value);
          },
          reject: function(value) {
            return deliver(this, STATE_REJECTED, "rejectReason", value);
          },
          then: function(onFulfilled, onRejected) {
            var curr = this;
            var next = new api();
            curr.onFulfilled.push(resolver(onFulfilled, next, "fulfill"));
            curr.onRejected.push(resolver(onRejected, next, "reject"));
            execute(curr);
            return next.proxy;
          }
        };
        var deliver = function(curr, state, name, value) {
          if (curr.state === STATE_PENDING) {
            curr.state = state;
            curr[name] = value;
            execute(curr);
          }
          return curr;
        };
        var execute = function(curr) {
          if (curr.state === STATE_FULFILLED)
            execute_handlers(curr, "onFulfilled", curr.fulfillValue);
          else if (curr.state === STATE_REJECTED)
            execute_handlers(curr, "onRejected", curr.rejectReason);
        };
        var execute_handlers = function(curr, name, value) {
          if (curr[name].length === 0)
            return;
          var handlers = curr[name];
          curr[name] = [];
          var func = function() {
            for (var i = 0; i < handlers.length; i++)
              handlers[i](value);
          };
          if (typeof process === "object" && typeof process.nextTick === "function")
            process.nextTick(func);
          else if (typeof setImmediate === "function")
            setImmediate(func);
          else
            setTimeout(func, 0);
        };
        var resolver = function(cb, next, method) {
          return function(value) {
            if (typeof cb !== "function")
              next[method].call(next, value);
            else {
              var result;
              try {
                result = cb(value);
              } catch (e) {
                next.reject(e);
                return;
              }
              resolve(next, result);
            }
          };
        };
        var resolve = function(promise, x) {
          if (promise === x || promise.proxy === x) {
            promise.reject(new TypeError("cannot resolve promise with itself"));
            return;
          }
          var then;
          if ((typeof x === "object" && x !== null) || typeof x === "function") {
            try {
              then = x.then;
            } catch (e) {
              promise.reject(e);
              return;
            }
          }
          if (typeof then === "function") {
            var resolved = false;
            try {
              then.call(x, function(y) {
                if (resolved)
                  return;
                resolved = true;
                if (y === x)
                  promise.reject(new TypeError("circular thenable chain"));
                else
                  resolve(promise, y);
              }, function(r) {
                if (resolved)
                  return;
                resolved = true;
                promise.reject(r);
              });
            } catch (e) {
              if (!resolved)
                promise.reject(e);
            }
            return;
          }
          promise.fulfill(x);
        };
        return api;
      })(),
      Event: function() {
        var separator = /[\s\,]+/;
        this.parent = {
          events: this.events,
          findEvents: this.findEvents,
          parent: this.parent,
          utils: this.utils
        };
        this.events = {};
        this.on = function(evt, callback) {
          if (callback && typeof(callback) === 'function') {
            var a = evt.split(separator);
            for (var i = 0; i < a.length; i++) {
              this.events[a[i]] = [callback].concat(this.events[a[i]] || []);
            }
          }
          return this;
        };
        this.off = function(evt, callback) {
          this.findEvents(evt, function(name, index) {
            if (!callback || this.events[name][index] === callback) {
              this.events[name][index] = null;
            }
          });
          return this;
        };
        this.emit = function(evt) {
          var args = Array.prototype.slice.call(arguments, 1);
          args.push(evt);
          var handler = function(name, index) {
            args[args.length - 1] = (name === '*' ? evt : name);
            this.events[name][index].apply(this, args);
          };
          var _this = this;
          while (_this && _this.findEvents) {
            _this.findEvents(evt + ',*', handler);
            _this = _this.parent;
          }
          return this;
        };
        this.emitAfter = function() {
          var _this = this;
          var args = arguments;
          setTimeout(function() {
            _this.emit.apply(_this, args);
          }, 0);
          return this;
        };
        this.findEvents = function(evt, callback) {
          var a = evt.split(separator);
          for (var name in this.events) {
            if (this.events.hasOwnProperty(name)) {
              if (a.indexOf(name) > -1) {
                for (var i = 0; i < this.events[name].length; i++) {
                  if (this.events[name][i]) {
                    callback.call(this, name, i);
                  }
                }
              }
            }
          }
        };
        return this;
      },
      globalEvent: function(callback, guid) {
        guid = guid || '_hellojs_' + parseInt(Math.random() * 1e12, 10).toString(36);
        window[guid] = function() {
          try {
            if (callback.apply(this, arguments)) {
              delete window[guid];
            }
          } catch (e) {
            console.error(e);
          }
        };
        return guid;
      },
      popup: function(url, redirectUri, options) {
        var documentElement = document.documentElement;
        if (options.height) {
          var dualScreenTop = window.screenTop !== undefined ? window.screenTop : screen.top;
          var height = screen.height || window.innerHeight || documentElement.clientHeight;
          options.top = parseInt((height - options.height) / 2, 10) + dualScreenTop;
        }
        if (options.width) {
          var dualScreenLeft = window.screenLeft !== undefined ? window.screenLeft : screen.left;
          var width = screen.width || window.innerWidth || documentElement.clientWidth;
          options.left = parseInt((width - options.width) / 2, 10) + dualScreenLeft;
        }
        var optionsArray = [];
        Object.keys(options).forEach(function(name) {
          var value = options[name];
          optionsArray.push(name + (value !== null ? '=' + value : ''));
        });
        if (navigator.userAgent.indexOf('Safari') !== -1 && navigator.userAgent.indexOf('Chrome') === -1) {
          url = redirectUri + '#oauth_redirect=' + encodeURIComponent(encodeURIComponent(url));
        }
        var popup = window.open(url, '_blank', optionsArray.join(','));
        if (popup && popup.focus) {
          popup.focus();
        }
        return popup;
      },
      responseHandler: function(window, parent) {
        var _this = this;
        var p;
        var location = window.location;
        p = _this.param(location.search);
        if (p && p.state && (p.code || p.oauth_token)) {
          var state = JSON.parse(p.state);
          p.redirect_uri = state.redirect_uri || location.href.replace(/[\?\#].*$/, '');
          var path = state.oauth_proxy + '?' + _this.param(p);
          location.assign(path);
          return;
        }
        p = _this.merge(_this.param(location.search || ''), _this.param(location.hash || ''));
        if (p && 'state' in p) {
          try {
            var a = JSON.parse(p.state);
            _this.extend(p, a);
          } catch (e) {
            console.error('Could not decode state parameter');
          }
          if (('access_token' in p && p.access_token) && p.network) {
            if (!p.expires_in || parseInt(p.expires_in, 10) === 0) {
              p.expires_in = 0;
            }
            p.expires_in = parseInt(p.expires_in, 10);
            p.expires = ((new Date()).getTime() / 1e3) + (p.expires_in || (60 * 60 * 24 * 365));
            authCallback(p, window, parent);
          } else if (('error' in p && p.error) && p.network) {
            p.error = {
              code: p.error,
              message: p.error_message || p.error_description
            };
            authCallback(p, window, parent);
          } else if (p.callback && p.callback in parent) {
            var res = 'result' in p && p.result ? JSON.parse(p.result) : false;
            parent[p.callback](res);
            closeWindow();
          }
          if (p.page_uri) {
            location.assign(p.page_uri);
          }
        } else if ('oauth_redirect' in p) {
          location.assign(decodeURIComponent(p.oauth_redirect));
          return;
        }
        function authCallback(obj, window, parent) {
          var cb = obj.callback;
          var network = obj.network;
          _this.store(network, obj);
          if (('display' in obj) && obj.display === 'page') {
            return;
          }
          if (parent && cb && cb in parent) {
            try {
              delete obj.callback;
            } catch (e) {}
            _this.store(network, obj);
            var str = JSON.stringify(obj);
            try {
              parent[cb](str);
            } catch (e) {}
          }
          closeWindow();
        }
        function closeWindow() {
          if (window.frameElement) {
            parent.document.body.removeChild(window.frameElement);
          } else {
            try {
              window.close();
            } catch (e) {}
            if (window.addEventListener) {
              window.addEventListener('load', function() {
                window.close();
              });
            }
          }
        }
      }
    });
    hello.utils.Event.call(hello);
    (function(hello) {
      var oldSessions = {};
      var expired = {};
      hello.on('auth.login, auth.logout', function(auth) {
        if (auth && typeof(auth) === 'object' && auth.network) {
          oldSessions[auth.network] = hello.utils.store(auth.network) || {};
        }
      });
      (function self() {
        var CURRENT_TIME = ((new Date()).getTime() / 1e3);
        var emit = function(eventName) {
          hello.emit('auth.' + eventName, {
            network: name,
            authResponse: session
          });
        };
        for (var name in hello.services) {
          if (hello.services.hasOwnProperty(name)) {
            if (!hello.services[name].id) {
              continue;
            }
            var session = hello.utils.store(name) || {};
            var provider = hello.services[name];
            var oldSess = oldSessions[name] || {};
            if (session && 'callback' in session) {
              var cb = session.callback;
              try {
                delete session.callback;
              } catch (e) {}
              hello.utils.store(name, session);
              try {
                window[cb](session);
              } catch (e) {}
            }
            if (session && ('expires' in session) && session.expires < CURRENT_TIME) {
              var refresh = provider.refresh || session.refresh_token;
              if (refresh && (!(name in expired) || expired[name] < CURRENT_TIME)) {
                hello.emit('notice', name + ' has expired trying to resignin');
                hello.login(name, {
                  display: 'none',
                  force: false
                });
                expired[name] = CURRENT_TIME + 600;
              } else if (!refresh && !(name in expired)) {
                emit('expired');
                expired[name] = true;
              }
              continue;
            } else if (oldSess.access_token === session.access_token && oldSess.expires === session.expires) {
              continue;
            } else if (!session.access_token && oldSess.access_token) {
              emit('logout');
            } else if (session.access_token && !oldSess.access_token) {
              emit('login');
            } else if (session.expires !== oldSess.expires) {
              emit('update');
            }
            oldSessions[name] = session;
            if (name in expired) {
              delete expired[name];
            }
          }
        }
        setTimeout(self, 1000);
      })();
    })(hello);
    hello.api = function() {
      var _this = this;
      var utils = _this.utils;
      var error = utils.error;
      var promise = utils.Promise();
      var p = utils.args({
        path: 's!',
        query: 'o',
        method: 's',
        data: 'o',
        timeout: 'i',
        callback: 'f'
      }, arguments);
      p.method = (p.method || 'get').toLowerCase();
      p.headers = p.headers || {};
      p.query = p.query || {};
      if (p.method === 'get' || p.method === 'delete') {
        utils.extend(p.query, p.data);
        p.data = {};
      }
      var data = p.data = p.data || {};
      promise.then(p.callback, p.callback);
      if (!p.path) {
        return promise.reject(error('invalid_path', 'Missing the path parameter from the request'));
      }
      p.path = p.path.replace(/^\/+/, '');
      var a = (p.path.split(/[\/\:]/, 2) || [])[0].toLowerCase();
      if (a in _this.services) {
        p.network = a;
        var reg = new RegExp('^' + a + ':?\/?');
        p.path = p.path.replace(reg, '');
      }
      p.network = _this.settings.default_service = p.network || _this.settings.default_service;
      var o = _this.services[p.network];
      if (!o) {
        return promise.reject(error('invalid_network', 'Could not match the service requested: ' + p.network));
      }
      if (!(!(p.method in o) || !(p.path in o[p.method]) || o[p.method][p.path] !== false)) {
        return promise.reject(error('invalid_path', 'The provided path is not available on the selected network'));
      }
      if (!p.oauth_proxy) {
        p.oauth_proxy = _this.settings.oauth_proxy;
      }
      if (!('proxy' in p)) {
        p.proxy = p.oauth_proxy && o.oauth && parseInt(o.oauth.version, 10) === 1;
      }
      if (!('timeout' in p)) {
        p.timeout = _this.settings.timeout;
      }
      if (!('formatResponse' in p)) {
        p.formatResponse = true;
      }
      p.authResponse = _this.getAuthResponse(p.network);
      if (p.authResponse && p.authResponse.access_token) {
        p.query.access_token = p.authResponse.access_token;
      }
      var url = p.path;
      var m;
      p.options = utils.clone(p.query);
      p.data = utils.clone(data);
      var actions = o[{'delete': 'del'}[p.method] || p.method] || {};
      if (p.method === 'get') {
        var query = url.split(/[\?#]/)[1];
        if (query) {
          utils.extend(p.query, utils.param(query));
          url = url.replace(/\?.*?(#|$)/, '$1');
        }
      }
      if ((m = url.match(/#(.+)/, ''))) {
        url = url.split('#')[0];
        p.path = m[1];
      } else if (url in actions) {
        p.path = url;
        url = actions[url];
      } else if ('default' in actions) {
        url = actions['default'];
      }
      p.redirect_uri = _this.settings.redirect_uri;
      p.xhr = o.xhr;
      p.jsonp = o.jsonp;
      p.form = o.form;
      if (typeof(url) === 'function') {
        url(p, getPath);
      } else {
        getPath(url);
      }
      return promise.proxy;
      function getPath(url) {
        url = url.replace(/\@\{([a-z\_\-]+)(\|.*?)?\}/gi, function(m, key, defaults) {
          var val = defaults ? defaults.replace(/^\|/, '') : '';
          if (key in p.query) {
            val = p.query[key];
            delete p.query[key];
          } else if (p.data && key in p.data) {
            val = p.data[key];
            delete p.data[key];
          } else if (!defaults) {
            promise.reject(error('missing_attribute', 'The attribute ' + key + ' is missing from the request'));
          }
          return val;
        });
        if (!url.match(/^https?:\/\//)) {
          url = o.base + url;
        }
        p.url = url;
        utils.request(p, function(r, headers) {
          if (!p.formatResponse) {
            if (typeof headers === 'object' ? (headers.statusCode >= 400) : (typeof r === 'object' && 'error' in r)) {
              promise.reject(r);
            } else {
              promise.fulfill(r);
            }
            return;
          }
          if (r === true) {
            r = {success: true};
          } else if (!r) {
            r = {};
          }
          if (p.method === 'delete') {
            r = (!r || utils.isEmpty(r)) ? {success: true} : r;
          }
          if (o.wrap && ((p.path in o.wrap) || ('default' in o.wrap))) {
            var wrap = (p.path in o.wrap ? p.path : 'default');
            var time = (new Date()).getTime();
            var b = o.wrap[wrap](r, headers, p);
            if (b) {
              r = b;
            }
          }
          if (r && 'paging' in r && r.paging.next) {
            if (r.paging.next[0] === '?') {
              r.paging.next = p.path + r.paging.next;
            } else {
              r.paging.next += '#' + p.path;
            }
          }
          if (!r || 'error' in r) {
            promise.reject(r);
          } else {
            promise.fulfill(r);
          }
        });
      }
    };
    hello.utils.extend(hello.utils, {
      request: function(p, callback) {
        var _this = this;
        var error = _this.error;
        if (!_this.isEmpty(p.data) && !('FileList' in window) && _this.hasBinary(p.data)) {
          p.xhr = false;
          p.jsonp = false;
        }
        var cors = this.request_cors(function() {
          return ((p.xhr === undefined) || (p.xhr && (typeof(p.xhr) !== 'function' || p.xhr(p, p.query))));
        });
        if (cors) {
          formatUrl(p, function(url) {
            var x = _this.xhr(p.method, url, p.headers, p.data, callback);
            x.onprogress = p.onprogress || null;
            if (x.upload && p.onuploadprogress) {
              x.upload.onprogress = p.onuploadprogress;
            }
          });
          return;
        }
        var _query = p.query;
        p.query = _this.clone(p.query);
        p.callbackID = _this.globalEvent();
        if (p.jsonp !== false) {
          p.query.callback = p.callbackID;
          if (typeof(p.jsonp) === 'function') {
            p.jsonp(p, p.query);
          }
          if (p.method === 'get') {
            formatUrl(p, function(url) {
              _this.jsonp(url, callback, p.callbackID, p.timeout);
            });
            return;
          } else {
            p.query = _query;
          }
        }
        if (p.form !== false) {
          p.query.redirect_uri = p.redirect_uri;
          p.query.state = JSON.stringify({callback: p.callbackID});
          var opts;
          if (typeof(p.form) === 'function') {
            opts = p.form(p, p.query);
          }
          if (p.method === 'post' && opts !== false) {
            formatUrl(p, function(url) {
              _this.post(url, p.data, opts, callback, p.callbackID, p.timeout);
            });
            return;
          }
        }
        callback(error('invalid_request', 'There was no mechanism for handling this request'));
        return;
        function formatUrl(p, callback) {
          var sign;
          if (p.authResponse && p.authResponse.oauth && parseInt(p.authResponse.oauth.version, 10) === 1) {
            sign = p.query.access_token;
            delete p.query.access_token;
            p.proxy = true;
          }
          if (p.data && (p.method === 'get' || p.method === 'delete')) {
            _this.extend(p.query, p.data);
            p.data = null;
          }
          var path = _this.qs(p.url, p.query);
          if (p.proxy) {
            path = _this.qs(p.oauth_proxy, {
              path: path,
              access_token: sign || '',
              then: p.proxy_response_type || (p.method.toLowerCase() === 'get' ? 'redirect' : 'proxy'),
              method: p.method.toLowerCase(),
              suppress_response_codes: true
            });
          }
          callback(path);
        }
      },
      request_cors: function(callback) {
        return 'withCredentials' in new XMLHttpRequest() && callback();
      },
      domInstance: function(type, data) {
        var test = 'HTML' + (type || '').replace(/^[a-z]/, function(m) {
          return m.toUpperCase();
        }) + 'Element';
        if (!data) {
          return false;
        }
        if (window[test]) {
          return data instanceof window[test];
        } else if (window.Element) {
          return data instanceof window.Element && (!type || (data.tagName && data.tagName.toLowerCase() === type));
        } else {
          return (!(data instanceof Object || data instanceof Array || data instanceof String || data instanceof Number) && data.tagName && data.tagName.toLowerCase() === type);
        }
      },
      clone: function(obj) {
        if (obj === null || typeof(obj) !== 'object' || obj instanceof Date || 'nodeName' in obj || this.isBinary(obj) || (typeof FormData === 'function' && obj instanceof FormData)) {
          return obj;
        }
        if (Array.isArray(obj)) {
          return obj.map(this.clone.bind(this));
        }
        var clone = {};
        for (var x in obj) {
          clone[x] = this.clone(obj[x]);
        }
        return clone;
      },
      xhr: function(method, url, headers, data, callback) {
        var r = new XMLHttpRequest();
        var error = this.error;
        var binary = false;
        if (method === 'blob') {
          binary = method;
          method = 'GET';
        }
        method = method.toUpperCase();
        r.onload = function(e) {
          var json = r.response;
          try {
            json = JSON.parse(r.responseText);
          } catch (_e) {
            if (r.status === 401) {
              json = error('access_denied', r.statusText);
            }
          }
          var headers = headersToJSON(r.getAllResponseHeaders());
          headers.statusCode = r.status;
          callback(json || (method === 'GET' ? error('empty_response', 'Could not get resource') : {}), headers);
        };
        r.onerror = function(e) {
          var json = r.responseText;
          try {
            json = JSON.parse(r.responseText);
          } catch (_e) {}
          callback(json || error('access_denied', 'Could not get resource'));
        };
        var x;
        if (method === 'GET' || method === 'DELETE') {
          data = null;
        } else if (data && typeof(data) !== 'string' && !(data instanceof FormData) && !(data instanceof File) && !(data instanceof Blob)) {
          var f = new FormData();
          for (x in data)
            if (data.hasOwnProperty(x)) {
              if (data[x] instanceof HTMLInputElement) {
                if ('files' in data[x] && data[x].files.length > 0) {
                  f.append(x, data[x].files[0]);
                }
              } else if (data[x] instanceof Blob) {
                f.append(x, data[x], data.name);
              } else {
                f.append(x, data[x]);
              }
            }
          data = f;
        }
        r.open(method, url, true);
        if (binary) {
          if ('responseType' in r) {
            r.responseType = binary;
          } else {
            r.overrideMimeType('text/plain; charset=x-user-defined');
          }
        }
        if (headers) {
          for (x in headers) {
            r.setRequestHeader(x, headers[x]);
          }
        }
        r.send(data);
        return r;
        function headersToJSON(s) {
          var r = {};
          var reg = /([a-z\-]+):\s?(.*);?/gi;
          var m;
          while ((m = reg.exec(s))) {
            r[m[1]] = m[2];
          }
          return r;
        }
      },
      jsonp: function(url, callback, callbackID, timeout) {
        var _this = this;
        var error = _this.error;
        var bool = 0;
        var head = document.getElementsByTagName('head')[0];
        var operaFix;
        var result = error('server_error', 'server_error');
        var cb = function() {
          if (!(bool++)) {
            window.setTimeout(function() {
              callback(result);
              head.removeChild(script);
            }, 0);
          }
        };
        callbackID = _this.globalEvent(function(json) {
          result = json;
          return true;
        }, callbackID);
        url = url.replace(new RegExp('=\\?(&|$)'), '=' + callbackID + '$1');
        var script = _this.append('script', {
          id: callbackID,
          name: callbackID,
          src: url,
          async: true,
          onload: cb,
          onerror: cb,
          onreadystatechange: function() {
            if (/loaded|complete/i.test(this.readyState)) {
              cb();
            }
          }
        });
        if (window.navigator.userAgent.toLowerCase().indexOf('opera') > -1) {
          operaFix = _this.append('script', {text: 'document.getElementById(\'' + callbackID + '\').onerror();'});
          script.async = false;
        }
        if (timeout) {
          window.setTimeout(function() {
            result = error('timeout', 'timeout');
            cb();
          }, timeout);
        }
        head.appendChild(script);
        if (operaFix) {
          head.appendChild(operaFix);
        }
      },
      post: function(url, data, options, callback, callbackID, timeout) {
        var _this = this;
        var error = _this.error;
        var doc = document;
        var form = null;
        var reenableAfterSubmit = [];
        var newform;
        var i = 0;
        var x = null;
        var bool = 0;
        var cb = function(r) {
          if (!(bool++)) {
            callback(r);
          }
        };
        _this.globalEvent(cb, callbackID);
        var win;
        try {
          win = doc.createElement('<iframe name="' + callbackID + '">');
        } catch (e) {
          win = doc.createElement('iframe');
        }
        win.name = callbackID;
        win.id = callbackID;
        win.style.display = 'none';
        if (options && options.callbackonload) {
          win.onload = function() {
            cb({
              response: 'posted',
              message: 'Content was posted'
            });
          };
        }
        if (timeout) {
          setTimeout(function() {
            cb(error('timeout', 'The post operation timed out'));
          }, timeout);
        }
        doc.body.appendChild(win);
        if (_this.domInstance('form', data)) {
          form = data.form;
          for (i = 0; i < form.elements.length; i++) {
            if (form.elements[i] !== data) {
              form.elements[i].setAttribute('disabled', true);
            }
          }
          data = form;
        }
        if (_this.domInstance('form', data)) {
          form = data;
          for (i = 0; i < form.elements.length; i++) {
            if (!form.elements[i].disabled && form.elements[i].type === 'file') {
              form.encoding = form.enctype = 'multipart/form-data';
              form.elements[i].setAttribute('name', 'file');
            }
          }
        } else {
          for (x in data)
            if (data.hasOwnProperty(x)) {
              if (_this.domInstance('input', data[x]) && data[x].type === 'file') {
                form = data[x].form;
                form.encoding = form.enctype = 'multipart/form-data';
              }
            }
          if (!form) {
            form = doc.createElement('form');
            doc.body.appendChild(form);
            newform = form;
          }
          var input;
          for (x in data)
            if (data.hasOwnProperty(x)) {
              var el = (_this.domInstance('input', data[x]) || _this.domInstance('textArea', data[x]) || _this.domInstance('select', data[x]));
              if (!el || data[x].form !== form) {
                var inputs = form.elements[x];
                if (input) {
                  if (!(inputs instanceof NodeList)) {
                    inputs = [inputs];
                  }
                  for (i = 0; i < inputs.length; i++) {
                    inputs[i].parentNode.removeChild(inputs[i]);
                  }
                }
                input = doc.createElement('input');
                input.setAttribute('type', 'hidden');
                input.setAttribute('name', x);
                if (el) {
                  input.value = data[x].value;
                } else if (_this.domInstance(null, data[x])) {
                  input.value = data[x].innerHTML || data[x].innerText;
                } else {
                  input.value = data[x];
                }
                form.appendChild(input);
              } else if (el && data[x].name !== x) {
                data[x].setAttribute('name', x);
                data[x].name = x;
              }
            }
          for (i = 0; i < form.elements.length; i++) {
            input = form.elements[i];
            if (!(input.name in data) && input.getAttribute('disabled') !== true) {
              input.setAttribute('disabled', true);
              reenableAfterSubmit.push(input);
            }
          }
        }
        form.setAttribute('method', 'POST');
        form.setAttribute('target', callbackID);
        form.target = callbackID;
        form.setAttribute('action', url);
        setTimeout(function() {
          form.submit();
          setTimeout(function() {
            try {
              if (newform) {
                newform.parentNode.removeChild(newform);
              }
            } catch (e) {
              try {
                console.error('HelloJS: could not remove iframe');
              } catch (ee) {}
            }
            for (var i = 0; i < reenableAfterSubmit.length; i++) {
              if (reenableAfterSubmit[i]) {
                reenableAfterSubmit[i].setAttribute('disabled', false);
                reenableAfterSubmit[i].disabled = false;
              }
            }
          }, 0);
        }, 100);
      },
      hasBinary: function(data) {
        for (var x in data)
          if (data.hasOwnProperty(x)) {
            if (this.isBinary(data[x])) {
              return true;
            }
          }
        return false;
      },
      isBinary: function(data) {
        return data instanceof Object && ((this.domInstance('input', data) && data.type === 'file') || ('FileList' in window && data instanceof window.FileList) || ('File' in window && data instanceof window.File) || ('Blob' in window && data instanceof window.Blob));
      },
      toBlob: function(dataURI) {
        var reg = /^data\:([^;,]+(\;charset=[^;,]+)?)(\;base64)?,/i;
        var m = dataURI.match(reg);
        if (!m) {
          return dataURI;
        }
        var binary = atob(dataURI.replace(reg, ''));
        var array = [];
        for (var i = 0; i < binary.length; i++) {
          array.push(binary.charCodeAt(i));
        }
        return new Blob([new Uint8Array(array)], {type: m[1]});
      }
    });
    (function(hello) {
      var api = hello.api;
      var utils = hello.utils;
      utils.extend(utils, {
        dataToJSON: function(p) {
          var _this = this;
          var w = window;
          var data = p.data;
          if (_this.domInstance('form', data)) {
            data = _this.nodeListToJSON(data.elements);
          } else if ('NodeList' in w && data instanceof NodeList) {
            data = _this.nodeListToJSON(data);
          } else if (_this.domInstance('input', data)) {
            data = _this.nodeListToJSON([data]);
          }
          if (('File' in w && data instanceof w.File) || ('Blob' in w && data instanceof w.Blob) || ('FileList' in w && data instanceof w.FileList)) {
            data = {file: data};
          }
          if (!('FormData' in w && data instanceof w.FormData)) {
            for (var x in data)
              if (data.hasOwnProperty(x)) {
                if ('FileList' in w && data[x] instanceof w.FileList) {
                  if (data[x].length === 1) {
                    data[x] = data[x][0];
                  }
                } else if (_this.domInstance('input', data[x]) && data[x].type === 'file') {
                  continue;
                } else if (_this.domInstance('input', data[x]) || _this.domInstance('select', data[x]) || _this.domInstance('textArea', data[x])) {
                  data[x] = data[x].value;
                } else if (_this.domInstance(null, data[x])) {
                  data[x] = data[x].innerHTML || data[x].innerText;
                }
              }
          }
          p.data = data;
          return data;
        },
        nodeListToJSON: function(nodelist) {
          var json = {};
          for (var i = 0; i < nodelist.length; i++) {
            var input = nodelist[i];
            if (input.disabled || !input.name) {
              continue;
            }
            if (input.type === 'file') {
              json[input.name] = input;
            } else {
              json[input.name] = input.value || input.innerHTML;
            }
          }
          return json;
        }
      });
      hello.api = function() {
        var p = utils.args({
          path: 's!',
          method: 's',
          data: 'o',
          timeout: 'i',
          callback: 'f'
        }, arguments);
        if (p.data) {
          utils.dataToJSON(p);
        }
        return api.call(this, p);
      };
    })(hello);
    hello.utils.responseHandler(window, window.opener || window.parent);
    if (typeof chrome === 'object' && typeof chrome.identity === 'object' && chrome.identity.launchWebAuthFlow) {
      (function() {
        hello.utils.popup = function(url) {
          return _open(url, true);
        };
        hello.utils.iframe = function(url) {
          _open(url, false);
        };
        hello.utils.request_cors = function(callback) {
          callback();
          return true;
        };
        var _cache = {};
        chrome.storage.local.get('hello', function(r) {
          _cache = r.hello || {};
        });
        hello.utils.store = function(name, value) {
          if (arguments.length === 0) {
            return _cache;
          }
          if (arguments.length === 1) {
            return _cache[name] || null;
          }
          if (value) {
            _cache[name] = value;
            chrome.storage.local.set({hello: _cache});
            return value;
          }
          if (value === null) {
            delete _cache[name];
            chrome.storage.local.set({hello: _cache});
            return null;
          }
        };
        function _open(url, interactive) {
          var ref = {closed: false};
          chrome.identity.launchWebAuthFlow({
            url: url,
            interactive: interactive
          }, function(responseUrl) {
            if (responseUrl === undefined) {
              ref.closed = true;
              return;
            }
            var a = hello.utils.url(responseUrl);
            var _popup = {
              location: {
                assign: function(url) {
                  _open(url, false);
                },
                search: a.search,
                hash: a.hash,
                href: a.href
              },
              close: function() {}
            };
            hello.utils.responseHandler(_popup, window);
          });
          return ref;
        }
      })();
    }
    (function() {
      if (!(/^file:\/{3}[^\/]/.test(window.location.href) && window.cordova)) {
        return;
      }
      hello.utils.iframe = function(url, redirectUri) {
        hello.utils.popup(url, redirectUri, {hidden: 'yes'});
      };
      var utilPopup = hello.utils.popup;
      hello.utils.popup = function(url, redirectUri, options) {
        var popup = utilPopup.call(this, url, redirectUri, options);
        try {
          if (popup && popup.addEventListener) {
            var a = hello.utils.url(redirectUri);
            var redirectUriOrigin = a.origin || (a.protocol + '//' + a.hostname);
            popup.addEventListener('loadstart', function(e) {
              var url = e.url;
              if (url.indexOf(redirectUriOrigin) !== 0) {
                return;
              }
              var a = hello.utils.url(url);
              var _popup = {
                location: {
                  assign: function(location) {
                    popup.executeScript({code: 'window.location.href = "' + location + ';"'});
                  },
                  search: a.search,
                  hash: a.hash,
                  href: a.href
                },
                close: function() {
                  if (popup.close) {
                    popup.close();
                    try {
                      popup.closed = true;
                    } catch (_e) {}
                  }
                }
              };
              hello.utils.responseHandler(_popup, window);
            });
          }
        } catch (e) {}
        return popup;
      };
    })();
    (function(hello) {
      var OAuth1Settings = {
        version: '1.0',
        auth: 'https://www.dropbox.com/1/oauth/authorize',
        request: 'https://api.dropbox.com/1/oauth/request_token',
        token: 'https://api.dropbox.com/1/oauth/access_token'
      };
      var OAuth2Settings = {
        version: 2,
        auth: 'https://www.dropbox.com/1/oauth2/authorize',
        grant: 'https://api.dropbox.com/1/oauth2/token'
      };
      hello.init({dropbox: {
          name: 'Dropbox',
          oauth: OAuth2Settings,
          login: function(p) {
            p.qs.scope = '';
            delete p.qs.display;
            var redirect = decodeURIComponent(p.qs.redirect_uri);
            if (redirect.indexOf('http:') === 0 && redirect.indexOf('http://localhost/') !== 0) {
              hello.services.dropbox.oauth = OAuth1Settings;
            } else {
              hello.services.dropbox.oauth = OAuth2Settings;
            }
            p.options.popup.width = 1000;
            p.options.popup.height = 1000;
          },
          base: 'https://api.dropbox.com/1/',
          root: 'sandbox',
          get: {
            me: 'account/info',
            'me/files': req('metadata/auto/@{parent|}'),
            'me/folder': req('metadata/auto/@{id}'),
            'me/folders': req('metadata/auto/'),
            'default': function(p, callback) {
              if (p.path.match('https://api-content.dropbox.com/1/files/')) {
                p.method = 'blob';
              }
              callback(p.path);
            }
          },
          post: {
            'me/files': function(p, callback) {
              var path = p.data.parent;
              var fileName = p.data.name;
              p.data = {file: p.data.file};
              if (typeof(p.data.file) === 'string') {
                p.data.file = hello.utils.toBlob(p.data.file);
              }
              callback('https://api-content.dropbox.com/1/files_put/auto/' + path + '/' + fileName);
            },
            'me/folders': function(p, callback) {
              var name = p.data.name;
              p.data = {};
              callback('fileops/create_folder?root=@{root|sandbox}&' + hello.utils.param({path: name}));
            }
          },
          del: {
            'me/files': 'fileops/delete?root=@{root|sandbox}&path=@{id}',
            'me/folder': 'fileops/delete?root=@{root|sandbox}&path=@{id}'
          },
          wrap: {
            me: function(o) {
              formatError(o);
              if (!o.uid) {
                return o;
              }
              o.name = o.display_name;
              var m = o.name.split(' ');
              o.first_name = m.shift();
              o.last_name = m.join(' ');
              o.id = o.uid;
              delete o.uid;
              delete o.display_name;
              return o;
            },
            'default': function(o, headers, req) {
              formatError(o);
              if (o.is_dir && o.contents) {
                o.data = o.contents;
                delete o.contents;
                o.data.forEach(function(item) {
                  item.root = o.root;
                  formatFile(item, headers, req);
                });
              }
              formatFile(o, headers, req);
              if (o.is_deleted) {
                o.success = true;
              }
              return o;
            }
          },
          xhr: function(p) {
            if (p.data && p.data.file) {
              var file = p.data.file;
              if (file) {
                if (file.files) {
                  p.data = file.files[0];
                } else {
                  p.data = file;
                }
              }
            }
            if (p.method === 'delete') {
              p.method = 'post';
            }
            return true;
          },
          form: function(p, qs) {
            delete qs.state;
            delete qs.redirect_uri;
          }
        }});
      function formatError(o) {
        if (o && 'error' in o) {
          o.error = {
            code: 'server_error',
            message: o.error.message || o.error
          };
        }
      }
      function formatFile(o, headers, req) {
        if (typeof o !== 'object' || (typeof Blob !== 'undefined' && o instanceof Blob) || (typeof ArrayBuffer !== 'undefined' && o instanceof ArrayBuffer)) {
          return;
        }
        if ('error' in o) {
          return;
        }
        var path = (o.root !== 'app_folder' ? o.root : '') + o.path.replace(/\&/g, '%26');
        path = path.replace(/^\//, '');
        if (o.thumb_exists) {
          o.thumbnail = req.oauth_proxy + '?path=' + encodeURIComponent('https://api-content.dropbox.com/1/thumbnails/auto/' + path + '?format=jpeg&size=m') + '&access_token=' + req.options.access_token;
        }
        o.type = (o.is_dir ? 'folder' : o.mime_type);
        o.name = o.path.replace(/.*\//g, '');
        if (o.is_dir) {
          o.files = path.replace(/^\//, '');
        } else {
          o.downloadLink = hello.settings.oauth_proxy + '?path=' + encodeURIComponent('https://api-content.dropbox.com/1/files/auto/' + path) + '&access_token=' + req.options.access_token;
          o.file = 'https://api-content.dropbox.com/1/files/auto/' + path;
        }
        if (!o.id) {
          o.id = o.path.replace(/^\//, '');
        }
      }
      function req(str) {
        return function(p, cb) {
          delete p.query.limit;
          cb(str);
        };
      }
    })(hello);
    (function(hello) {
      hello.init({facebook: {
          name: 'Facebook',
          oauth: {
            version: 2,
            auth: 'https://www.facebook.com/dialog/oauth/',
            grant: 'https://graph.facebook.com/oauth/access_token'
          },
          scope: {
            basic: 'public_profile',
            email: 'email',
            share: 'user_posts',
            birthday: 'user_birthday',
            events: 'user_events',
            photos: 'user_photos',
            videos: 'user_videos',
            friends: 'user_friends',
            files: 'user_photos,user_videos',
            publish_files: 'user_photos,user_videos,publish_actions',
            publish: 'publish_actions',
            offline_access: ''
          },
          refresh: true,
          login: function(p) {
            if (p.options.force) {
              p.qs.auth_type = 'reauthenticate';
            }
            p.options.popup.width = 580;
            p.options.popup.height = 400;
          },
          logout: function(callback, options) {
            var callbackID = hello.utils.globalEvent(callback);
            var redirect = encodeURIComponent(hello.settings.redirect_uri + '?' + hello.utils.param({
              callback: callbackID,
              result: JSON.stringify({force: true}),
              state: '{}'
            }));
            var token = (options.authResponse || {}).access_token;
            hello.utils.iframe('https://www.facebook.com/logout.php?next=' + redirect + '&access_token=' + token);
            if (!token) {
              return false;
            }
          },
          base: 'https://graph.facebook.com/v2.4/',
          get: {
            me: 'me?fields=email,first_name,last_name,name,timezone,verified',
            'me/friends': 'me/friends',
            'me/following': 'me/friends',
            'me/followers': 'me/friends',
            'me/share': 'me/feed',
            'me/like': 'me/likes',
            'me/files': 'me/albums',
            'me/albums': 'me/albums?fields=cover_photo,name',
            'me/album': '@{id}/photos?fields=picture',
            'me/photos': 'me/photos',
            'me/photo': '@{id}',
            'friend/albums': '@{id}/albums',
            'friend/photos': '@{id}/photos'
          },
          post: {
            'me/share': 'me/feed',
            'me/photo': '@{id}'
          },
          wrap: {
            me: formatUser,
            'me/friends': formatFriends,
            'me/following': formatFriends,
            'me/followers': formatFriends,
            'me/albums': format,
            'me/photos': format,
            'me/files': format,
            'default': format
          },
          xhr: function(p, qs) {
            if (p.method === 'get' || p.method === 'post') {
              qs.suppress_response_codes = true;
            }
            if (p.method === 'post' && p.data && typeof(p.data.file) === 'string') {
              p.data.file = hello.utils.toBlob(p.data.file);
            }
            return true;
          },
          jsonp: function(p, qs) {
            var m = p.method;
            if (m !== 'get' && !hello.utils.hasBinary(p.data)) {
              p.data.method = m;
              p.method = 'get';
            } else if (p.method === 'delete') {
              qs.method = 'delete';
              p.method = 'post';
            }
          },
          form: function(p) {
            return {callbackonload: true};
          }
        }});
      var base = 'https://graph.facebook.com/';
      function formatUser(o) {
        if (o.id) {
          o.thumbnail = o.picture = 'https://graph.facebook.com/' + o.id + '/picture';
        }
        return o;
      }
      function formatFriends(o) {
        if ('data' in o) {
          o.data.forEach(formatUser);
        }
        return o;
      }
      function format(o, headers, req) {
        if (typeof o === 'boolean') {
          o = {success: o};
        }
        if (o && 'data' in o) {
          var token = req.query.access_token;
          if (!(o.data instanceof Array)) {
            var data = o.data;
            delete o.data;
            o.data = [data];
          }
          o.data.forEach(function(d) {
            if (d.picture) {
              d.thumbnail = d.picture;
            }
            d.pictures = (d.images || []).sort(function(a, b) {
              return a.width - b.width;
            });
            if (d.cover_photo && d.cover_photo.id) {
              d.thumbnail = base + d.cover_photo.id + '/picture?access_token=' + token;
            }
            if (d.type === 'album') {
              d.files = d.photos = base + d.id + '/photos';
            }
            if (d.can_upload) {
              d.upload_location = base + d.id + '/photos';
            }
          });
        }
        return o;
      }
    })(hello);
    (function(hello) {
      hello.init({flickr: {
          name: 'Flickr',
          oauth: {
            version: '1.0a',
            auth: 'https://www.flickr.com/services/oauth/authorize?perms=read',
            request: 'https://www.flickr.com/services/oauth/request_token',
            token: 'https://www.flickr.com/services/oauth/access_token'
          },
          base: 'https://api.flickr.com/services/rest',
          get: {
            me: sign('flickr.people.getInfo'),
            'me/friends': sign('flickr.contacts.getList', {per_page: '@{limit|50}'}),
            'me/following': sign('flickr.contacts.getList', {per_page: '@{limit|50}'}),
            'me/followers': sign('flickr.contacts.getList', {per_page: '@{limit|50}'}),
            'me/albums': sign('flickr.photosets.getList', {per_page: '@{limit|50}'}),
            'me/album': sign('flickr.photosets.getPhotos', {photoset_id: '@{id}'}),
            'me/photos': sign('flickr.people.getPhotos', {per_page: '@{limit|50}'})
          },
          wrap: {
            me: function(o) {
              formatError(o);
              o = checkResponse(o, 'person');
              if (o.id) {
                if (o.realname) {
                  o.name = o.realname._content;
                  var m = o.name.split(' ');
                  o.first_name = m.shift();
                  o.last_name = m.join(' ');
                }
                o.thumbnail = getBuddyIcon(o, 'l');
                o.picture = getBuddyIcon(o, 'l');
              }
              return o;
            },
            'me/friends': formatFriends,
            'me/followers': formatFriends,
            'me/following': formatFriends,
            'me/albums': function(o) {
              formatError(o);
              o = checkResponse(o, 'photosets');
              paging(o);
              if (o.photoset) {
                o.data = o.photoset;
                o.data.forEach(function(item) {
                  item.name = item.title._content;
                  item.photos = 'https://api.flickr.com/services/rest' + getApiUrl('flickr.photosets.getPhotos', {photoset_id: item.id}, true);
                });
                delete o.photoset;
              }
              return o;
            },
            'me/photos': function(o) {
              formatError(o);
              return formatPhotos(o);
            },
            'default': function(o) {
              formatError(o);
              return formatPhotos(o);
            }
          },
          xhr: false,
          jsonp: function(p, qs) {
            if (p.method == 'get') {
              delete qs.callback;
              qs.jsoncallback = p.callbackID;
            }
          }
        }});
      function getApiUrl(method, extraParams, skipNetwork) {
        var url = ((skipNetwork) ? '' : 'flickr:') + '?method=' + method + '&api_key=' + hello.services.flickr.id + '&format=json';
        for (var param in extraParams) {
          if (extraParams.hasOwnProperty(param)) {
            url += '&' + param + '=' + extraParams[param];
          }
        }
        return url;
      }
      function withUser(cb) {
        var auth = hello.getAuthResponse('flickr');
        cb(auth && auth.user_nsid ? auth.user_nsid : null);
      }
      function sign(url, params) {
        if (!params) {
          params = {};
        }
        return function(p, callback) {
          withUser(function(userId) {
            params.user_id = userId;
            callback(getApiUrl(url, params, true));
          });
        };
      }
      function getBuddyIcon(profile, size) {
        var url = 'https://www.flickr.com/images/buddyicon.gif';
        if (profile.nsid && profile.iconserver && profile.iconfarm) {
          url = 'https://farm' + profile.iconfarm + '.staticflickr.com/' + profile.iconserver + '/' + 'buddyicons/' + profile.nsid + ((size) ? '_' + size : '') + '.jpg';
        }
        return url;
      }
      function createPhotoUrl(id, farm, server, secret, size) {
        size = (size) ? '_' + size : '';
        return 'https://farm' + farm + '.staticflickr.com/' + server + '/' + id + '_' + secret + size + '.jpg';
      }
      function formatUser(o) {}
      function formatError(o) {
        if (o && o.stat && o.stat.toLowerCase() != 'ok') {
          o.error = {
            code: 'invalid_request',
            message: o.message
          };
        }
      }
      function formatPhotos(o) {
        if (o.photoset || o.photos) {
          var set = ('photoset' in o) ? 'photoset' : 'photos';
          o = checkResponse(o, set);
          paging(o);
          o.data = o.photo;
          delete o.photo;
          for (var i = 0; i < o.data.length; i++) {
            var photo = o.data[i];
            photo.name = photo.title;
            photo.picture = createPhotoUrl(photo.id, photo.farm, photo.server, photo.secret, '');
            photo.pictures = createPictures(photo.id, photo.farm, photo.server, photo.secret);
            photo.source = createPhotoUrl(photo.id, photo.farm, photo.server, photo.secret, 'b');
            photo.thumbnail = createPhotoUrl(photo.id, photo.farm, photo.server, photo.secret, 'm');
          }
        }
        return o;
      }
      function createPictures(id, farm, server, secret) {
        var NO_LIMIT = 2048;
        var sizes = [{
          id: 't',
          max: 100
        }, {
          id: 'm',
          max: 240
        }, {
          id: 'n',
          max: 320
        }, {
          id: '',
          max: 500
        }, {
          id: 'z',
          max: 640
        }, {
          id: 'c',
          max: 800
        }, {
          id: 'b',
          max: 1024
        }, {
          id: 'h',
          max: 1600
        }, {
          id: 'k',
          max: 2048
        }, {
          id: 'o',
          max: NO_LIMIT
        }];
        return sizes.map(function(size) {
          return {
            source: createPhotoUrl(id, farm, server, secret, size.id),
            width: size.max,
            height: size.max
          };
        });
      }
      function checkResponse(o, key) {
        if (key in o) {
          o = o[key];
        } else if (!('error' in o)) {
          o.error = {
            code: 'invalid_request',
            message: o.message || 'Failed to get data from Flickr'
          };
        }
        return o;
      }
      function formatFriends(o) {
        formatError(o);
        if (o.contacts) {
          o = checkResponse(o, 'contacts');
          paging(o);
          o.data = o.contact;
          delete o.contact;
          for (var i = 0; i < o.data.length; i++) {
            var item = o.data[i];
            item.id = item.nsid;
            item.name = item.realname || item.username;
            item.thumbnail = getBuddyIcon(item, 'm');
          }
        }
        return o;
      }
      function paging(res) {
        if (res.page && res.pages && res.page !== res.pages) {
          res.paging = {next: '?page=' + (++res.page)};
        }
      }
    })(hello);
    (function(hello) {
      hello.init({foursquare: {
          name: 'Foursquare',
          oauth: {
            version: 2,
            auth: 'https://foursquare.com/oauth2/authenticate',
            grant: 'https://foursquare.com/oauth2/access_token'
          },
          refresh: true,
          base: 'https://api.foursquare.com/v2/',
          get: {
            me: 'users/self',
            'me/friends': 'users/self/friends',
            'me/followers': 'users/self/friends',
            'me/following': 'users/self/friends'
          },
          wrap: {
            me: function(o) {
              formatError(o);
              if (o && o.response) {
                o = o.response.user;
                formatUser(o);
              }
              return o;
            },
            'default': function(o) {
              formatError(o);
              if (o && 'response' in o && 'friends' in o.response && 'items' in o.response.friends) {
                o.data = o.response.friends.items;
                o.data.forEach(formatUser);
                delete o.response;
              }
              return o;
            }
          },
          xhr: formatRequest,
          jsonp: formatRequest
        }});
      function formatError(o) {
        if (o.meta && (o.meta.code === 400 || o.meta.code === 401)) {
          o.error = {
            code: 'access_denied',
            message: o.meta.errorDetail
          };
        }
      }
      function formatUser(o) {
        if (o && o.id) {
          o.thumbnail = o.photo.prefix + '100x100' + o.photo.suffix;
          o.name = o.firstName + ' ' + o.lastName;
          o.first_name = o.firstName;
          o.last_name = o.lastName;
          if (o.contact) {
            if (o.contact.email) {
              o.email = o.contact.email;
            }
          }
        }
      }
      function formatRequest(p, qs) {
        var token = qs.access_token;
        delete qs.access_token;
        qs.oauth_token = token;
        qs.v = 20121125;
        return true;
      }
    })(hello);
    (function(hello) {
      hello.init({github: {
          name: 'GitHub',
          oauth: {
            version: 2,
            auth: 'https://github.com/login/oauth/authorize',
            grant: 'https://github.com/login/oauth/access_token',
            response_type: 'code'
          },
          scope: {email: 'user:email'},
          base: 'https://api.github.com/',
          get: {
            me: 'user',
            'me/friends': 'user/following?per_page=@{limit|100}',
            'me/following': 'user/following?per_page=@{limit|100}',
            'me/followers': 'user/followers?per_page=@{limit|100}',
            'me/like': 'user/starred?per_page=@{limit|100}'
          },
          wrap: {
            me: function(o, headers) {
              formatError(o, headers);
              formatUser(o);
              return o;
            },
            'default': function(o, headers, req) {
              formatError(o, headers);
              if (Array.isArray(o)) {
                o = {data: o};
              }
              if (o.data) {
                paging(o, headers, req);
                o.data.forEach(formatUser);
              }
              return o;
            }
          },
          xhr: function(p) {
            if (p.method !== 'get' && p.data) {
              p.headers = p.headers || {};
              p.headers['Content-Type'] = 'application/json';
              if (typeof(p.data) === 'object') {
                p.data = JSON.stringify(p.data);
              }
            }
            return true;
          }
        }});
      function formatError(o, headers) {
        var code = headers ? headers.statusCode : (o && 'meta' in o && 'status' in o.meta && o.meta.status);
        if ((code === 401 || code === 403)) {
          o.error = {
            code: 'access_denied',
            message: o.message || (o.data ? o.data.message : 'Could not get response')
          };
          delete o.message;
        }
      }
      function formatUser(o) {
        if (o.id) {
          o.thumbnail = o.picture = o.avatar_url;
          o.name = o.login;
        }
      }
      function paging(res, headers, req) {
        if (res.data && res.data.length && headers && headers.Link) {
          var next = headers.Link.match(/<(.*?)>;\s*rel=\"next\"/);
          if (next) {
            res.paging = {next: next[1]};
          }
        }
      }
    })(hello);
    (function(hello) {
      var contactsUrl = 'https://www.google.com/m8/feeds/contacts/default/full?v=3.0&alt=json&max-results=@{limit|1000}&start-index=@{start|1}';
      hello.init({google: {
          name: 'Google Plus',
          oauth: {
            version: 2,
            auth: 'https://accounts.google.com/o/oauth2/auth',
            grant: 'https://accounts.google.com/o/oauth2/token'
          },
          scope: {
            basic: 'https://www.googleapis.com/auth/plus.me profile',
            email: 'email',
            birthday: '',
            events: '',
            photos: 'https://picasaweb.google.com/data/',
            videos: 'http://gdata.youtube.com',
            friends: 'https://www.google.com/m8/feeds, https://www.googleapis.com/auth/plus.login',
            files: 'https://www.googleapis.com/auth/drive.readonly',
            publish: '',
            publish_files: 'https://www.googleapis.com/auth/drive',
            share: '',
            create_event: '',
            offline_access: ''
          },
          scope_delim: ' ',
          login: function(p) {
            if (p.qs.display === 'none') {
              p.qs.display = '';
            }
            if (p.qs.response_type === 'code') {
              p.qs.access_type = 'offline';
            }
            if (p.options.force) {
              p.qs.approval_prompt = 'force';
            }
          },
          base: 'https://www.googleapis.com/',
          get: {
            me: 'plus/v1/people/me',
            'me/friends': 'plus/v1/people/me/people/visible?maxResults=@{limit|100}',
            'me/following': contactsUrl,
            'me/followers': contactsUrl,
            'me/contacts': contactsUrl,
            'me/share': 'plus/v1/people/me/activities/public?maxResults=@{limit|100}',
            'me/feed': 'plus/v1/people/me/activities/public?maxResults=@{limit|100}',
            'me/albums': 'https://picasaweb.google.com/data/feed/api/user/default?alt=json&max-results=@{limit|100}&start-index=@{start|1}',
            'me/album': function(p, callback) {
              var key = p.query.id;
              delete p.query.id;
              callback(key.replace('/entry/', '/feed/'));
            },
            'me/photos': 'https://picasaweb.google.com/data/feed/api/user/default?alt=json&kind=photo&max-results=@{limit|100}&start-index=@{start|1}',
            'me/file': 'drive/v2/files/@{id}',
            'me/files': 'drive/v2/files?q=%22@{parent|root}%22+in+parents+and+trashed=false&maxResults=@{limit|100}',
            'me/folders': 'drive/v2/files?q=%22@{id|root}%22+in+parents+and+mimeType+=+%22application/vnd.google-apps.folder%22+and+trashed=false&maxResults=@{limit|100}',
            'me/folder': 'drive/v2/files?q=%22@{id|root}%22+in+parents+and+trashed=false&maxResults=@{limit|100}'
          },
          post: {
            'me/files': uploadDrive,
            'me/folders': function(p, callback) {
              p.data = {
                title: p.data.name,
                parents: [{id: p.data.parent || 'root'}],
                mimeType: 'application/vnd.google-apps.folder'
              };
              callback('drive/v2/files');
            }
          },
          put: {'me/files': uploadDrive},
          del: {
            'me/files': 'drive/v2/files/@{id}',
            'me/folder': 'drive/v2/files/@{id}'
          },
          patch: {'me/file': 'drive/v2/files/@{id}'},
          wrap: {
            me: function(o) {
              if (o.id) {
                o.last_name = o.family_name || (o.name ? o.name.familyName : null);
                o.first_name = o.given_name || (o.name ? o.name.givenName : null);
                if (o.emails && o.emails.length) {
                  o.email = o.emails[0].value;
                }
                formatPerson(o);
              }
              return o;
            },
            'me/friends': function(o) {
              if (o.items) {
                paging(o);
                o.data = o.items;
                o.data.forEach(formatPerson);
                delete o.items;
              }
              return o;
            },
            'me/contacts': formatFriends,
            'me/followers': formatFriends,
            'me/following': formatFriends,
            'me/share': formatFeed,
            'me/feed': formatFeed,
            'me/albums': gEntry,
            'me/photos': formatPhotos,
            'default': gEntry
          },
          xhr: function(p) {
            if (p.method === 'post' || p.method === 'put') {
              toJSON(p);
            } else if (p.method === 'patch') {
              hello.utils.extend(p.query, p.data);
              p.data = null;
            }
            return true;
          },
          form: false
        }});
      function toInt(s) {
        return parseInt(s, 10);
      }
      function formatFeed(o) {
        paging(o);
        o.data = o.items;
        delete o.items;
        return o;
      }
      function formatItem(o) {
        if (o.error) {
          return;
        }
        if (!o.name) {
          o.name = o.title || o.message;
        }
        if (!o.picture) {
          o.picture = o.thumbnailLink;
        }
        if (!o.thumbnail) {
          o.thumbnail = o.thumbnailLink;
        }
        if (o.mimeType === 'application/vnd.google-apps.folder') {
          o.type = 'folder';
          o.files = 'https://www.googleapis.com/drive/v2/files?q=%22' + o.id + '%22+in+parents';
        }
        return o;
      }
      function formatImage(image) {
        return {
          source: image.url,
          width: image.width,
          height: image.height
        };
      }
      function formatPhotos(o) {
        o.data = o.feed.entry.map(formatEntry);
        delete o.feed;
      }
      function gEntry(o) {
        paging(o);
        if ('feed' in o && 'entry' in o.feed) {
          o.data = o.feed.entry.map(formatEntry);
          delete o.feed;
        } else if ('entry' in o) {
          return formatEntry(o.entry);
        } else if ('items' in o) {
          o.data = o.items.map(formatItem);
          delete o.items;
        } else {
          formatItem(o);
        }
        return o;
      }
      function formatPerson(o) {
        o.name = o.displayName || o.name;
        o.picture = o.picture || (o.image ? o.image.url : null);
        o.thumbnail = o.picture;
      }
      function formatFriends(o, headers, req) {
        paging(o);
        var r = [];
        if ('feed' in o && 'entry' in o.feed) {
          var token = req.query.access_token;
          for (var i = 0; i < o.feed.entry.length; i++) {
            var a = o.feed.entry[i];
            a.id = a.id.$t;
            a.name = a.title.$t;
            delete a.title;
            if (a.gd$email) {
              a.email = (a.gd$email && a.gd$email.length > 0) ? a.gd$email[0].address : null;
              a.emails = a.gd$email;
              delete a.gd$email;
            }
            if (a.updated) {
              a.updated = a.updated.$t;
            }
            if (a.link) {
              var pic = (a.link.length > 0) ? a.link[0].href : null;
              if (pic && a.link[0].gd$etag) {
                pic += (pic.indexOf('?') > -1 ? '&' : '?') + 'access_token=' + token;
                a.picture = pic;
                a.thumbnail = pic;
              }
              delete a.link;
            }
            if (a.category) {
              delete a.category;
            }
          }
          o.data = o.feed.entry;
          delete o.feed;
        }
        return o;
      }
      function formatEntry(a) {
        var group = a.media$group;
        var photo = group.media$content.length ? group.media$content[0] : {};
        var mediaContent = group.media$content || [];
        var mediaThumbnail = group.media$thumbnail || [];
        var pictures = mediaContent.concat(mediaThumbnail).map(formatImage).sort(function(a, b) {
          return a.width - b.width;
        });
        var i = 0;
        var _a;
        var p = {
          id: a.id.$t,
          name: a.title.$t,
          description: a.summary.$t,
          updated_time: a.updated.$t,
          created_time: a.published.$t,
          picture: photo ? photo.url : null,
          pictures: pictures,
          images: [],
          thumbnail: photo ? photo.url : null,
          width: photo.width,
          height: photo.height
        };
        if ('link' in a) {
          for (i = 0; i < a.link.length; i++) {
            var d = a.link[i];
            if (d.rel.match(/\#feed$/)) {
              p.upload_location = p.files = p.photos = d.href;
              break;
            }
          }
        }
        if ('category' in a && a.category.length) {
          _a = a.category;
          for (i = 0; i < _a.length; i++) {
            if (_a[i].scheme && _a[i].scheme.match(/\#kind$/)) {
              p.type = _a[i].term.replace(/^.*?\#/, '');
            }
          }
        }
        if ('media$thumbnail' in group && group.media$thumbnail.length) {
          _a = group.media$thumbnail;
          p.thumbnail = _a[0].url;
          p.images = _a.map(formatImage);
        }
        _a = group.media$content;
        if (_a && _a.length) {
          p.images.push(formatImage(_a[0]));
        }
        return p;
      }
      function paging(res) {
        if ('feed' in res && res.feed.openSearch$itemsPerPage) {
          var limit = toInt(res.feed.openSearch$itemsPerPage.$t);
          var start = toInt(res.feed.openSearch$startIndex.$t);
          var total = toInt(res.feed.openSearch$totalResults.$t);
          if ((start + limit) < total) {
            res.paging = {next: '?start=' + (start + limit)};
          }
        } else if ('nextPageToken' in res) {
          res.paging = {next: '?pageToken=' + res.nextPageToken};
        }
      }
      function Multipart() {
        var body = [];
        var boundary = (Math.random() * 1e10).toString(32);
        var counter = 0;
        var lineBreak = '\r\n';
        var delim = lineBreak + '--' + boundary;
        var ready = function() {};
        var dataUri = /^data\:([^;,]+(\;charset=[^;,]+)?)(\;base64)?,/i;
        function addFile(item) {
          var fr = new FileReader();
          fr.onload = function(e) {
            addContent(btoa(e.target.result), item.type + lineBreak + 'Content-Transfer-Encoding: base64');
          };
          fr.readAsBinaryString(item);
        }
        function addContent(content, type) {
          body.push(lineBreak + 'Content-Type: ' + type + lineBreak + lineBreak + content);
          counter--;
          ready();
        }
        this.append = function(content, type) {
          if (typeof(content) === 'string' || !('length' in Object(content))) {
            content = [content];
          }
          for (var i = 0; i < content.length; i++) {
            counter++;
            var item = content[i];
            if ((typeof(File) !== 'undefined' && item instanceof File) || (typeof(Blob) !== 'undefined' && item instanceof Blob)) {
              addFile(item);
            } else if (typeof(item) === 'string' && item.match(dataUri)) {
              var m = item.match(dataUri);
              addContent(item.replace(dataUri, ''), m[1] + lineBreak + 'Content-Transfer-Encoding: base64');
            } else {
              addContent(item, type);
            }
          }
        };
        this.onready = function(fn) {
          ready = function() {
            if (counter === 0) {
              body.unshift('');
              body.push('--');
              fn(body.join(delim), boundary);
              body = [];
            }
          };
          ready();
        };
      }
      function uploadDrive(p, callback) {
        var data = {};
        if (p.data && (typeof(HTMLInputElement) !== 'undefined' && p.data instanceof HTMLInputElement)) {
          p.data = {file: p.data};
        }
        if (!p.data.name && Object(Object(p.data.file).files).length && p.method === 'post') {
          p.data.name = p.data.file.files[0].name;
        }
        if (p.method === 'post') {
          p.data = {
            title: p.data.name,
            parents: [{id: p.data.parent || 'root'}],
            file: p.data.file
          };
        } else {
          data = p.data;
          p.data = {};
          if (data.parent) {
            p.data.parents = [{id: p.data.parent || 'root'}];
          }
          if (data.file) {
            p.data.file = data.file;
          }
          if (data.name) {
            p.data.title = data.name;
          }
        }
        var file;
        if ('file' in p.data) {
          file = p.data.file;
          delete p.data.file;
          if (typeof(file) === 'object' && 'files' in file) {
            file = file.files;
          }
          if (!file || !file.length) {
            callback({error: {
                code: 'request_invalid',
                message: 'There were no files attached with this request to upload'
              }});
            return;
          }
        }
        var parts = new Multipart();
        parts.append(JSON.stringify(p.data), 'application/json');
        if (file) {
          parts.append(file);
        }
        parts.onready(function(body, boundary) {
          p.headers['content-type'] = 'multipart/related; boundary="' + boundary + '"';
          p.data = body;
          callback('upload/drive/v2/files' + (data.id ? '/' + data.id : '') + '?uploadType=multipart');
        });
      }
      function toJSON(p) {
        if (typeof(p.data) === 'object') {
          try {
            p.data = JSON.stringify(p.data);
            p.headers['content-type'] = 'application/json';
          } catch (e) {}
        }
      }
    })(hello);
    (function(hello) {
      hello.init({instagram: {
          name: 'Instagram',
          oauth: {
            version: 2,
            auth: 'https://instagram.com/oauth/authorize/',
            grant: 'https://api.instagram.com/oauth/access_token'
          },
          refresh: true,
          scope: {
            basic: 'basic',
            photos: '',
            friends: 'relationships',
            publish: 'likes comments',
            email: '',
            share: '',
            publish_files: '',
            files: '',
            videos: '',
            offline_access: ''
          },
          scope_delim: ' ',
          login: function(p) {
            p.qs.display = '';
          },
          base: 'https://api.instagram.com/v1/',
          get: {
            me: 'users/self',
            'me/feed': 'users/self/feed?count=@{limit|100}',
            'me/photos': 'users/self/media/recent?min_id=0&count=@{limit|100}',
            'me/friends': 'users/self/follows?count=@{limit|100}',
            'me/following': 'users/self/follows?count=@{limit|100}',
            'me/followers': 'users/self/followed-by?count=@{limit|100}',
            'friend/photos': 'users/@{id}/media/recent?min_id=0&count=@{limit|100}'
          },
          post: {'me/like': function(p, callback) {
              var id = p.data.id;
              p.data = {};
              callback('media/' + id + '/likes');
            }},
          del: {'me/like': 'media/@{id}/likes'},
          wrap: {
            me: function(o) {
              formatError(o);
              if ('data' in o) {
                o.id = o.data.id;
                o.thumbnail = o.data.profile_picture;
                o.name = o.data.full_name || o.data.username;
              }
              return o;
            },
            'me/friends': formatFriends,
            'me/following': formatFriends,
            'me/followers': formatFriends,
            'me/photos': function(o) {
              formatError(o);
              paging(o);
              if ('data' in o) {
                o.data = o.data.filter(function(d) {
                  return d.type === 'image';
                });
                o.data.forEach(function(d) {
                  d.name = d.caption ? d.caption.text : null;
                  d.thumbnail = d.images.thumbnail.url;
                  d.picture = d.images.standard_resolution.url;
                  d.pictures = Object.keys(d.images).map(function(key) {
                    var image = d.images[key];
                    return formatImage(image);
                  }).sort(function(a, b) {
                    return a.width - b.width;
                  });
                });
              }
              return o;
            },
            'default': function(o) {
              o = formatError(o);
              paging(o);
              return o;
            }
          },
          xhr: function(p, qs) {
            var method = p.method;
            var proxy = method !== 'get';
            if (proxy) {
              if ((method === 'post' || method === 'put') && p.query.access_token) {
                p.data.access_token = p.query.access_token;
                delete p.query.access_token;
              }
              p.proxy = proxy;
            }
            return proxy;
          },
          form: false
        }});
      function formatImage(image) {
        return {
          source: image.url,
          width: image.width,
          height: image.height
        };
      }
      function formatError(o) {
        if (typeof o === 'string') {
          return {error: {
              code: 'invalid_request',
              message: o
            }};
        }
        if (o && 'meta' in o && 'error_type' in o.meta) {
          o.error = {
            code: o.meta.error_type,
            message: o.meta.error_message
          };
        }
        return o;
      }
      function formatFriends(o) {
        paging(o);
        if (o && 'data' in o) {
          o.data.forEach(formatFriend);
        }
        return o;
      }
      function formatFriend(o) {
        if (o.id) {
          o.thumbnail = o.profile_picture;
          o.name = o.full_name || o.username;
        }
      }
      function paging(res) {
        if ('pagination' in res) {
          res.paging = {next: res.pagination.next_url};
          delete res.pagination;
        }
      }
    })(hello);
    (function(hello) {
      hello.init({joinme: {
          name: 'join.me',
          oauth: {
            version: 2,
            auth: 'https://secure.join.me/api/public/v1/auth/oauth2',
            grant: 'https://secure.join.me/api/public/v1/auth/oauth2'
          },
          refresh: false,
          scope: {
            basic: 'user_info',
            user: 'user_info',
            scheduler: 'scheduler',
            start: 'start_meeting',
            email: '',
            friends: '',
            share: '',
            publish: '',
            photos: '',
            publish_files: '',
            files: '',
            videos: '',
            offline_access: ''
          },
          scope_delim: ' ',
          login: function(p) {
            p.options.popup.width = 400;
            p.options.popup.height = 700;
          },
          base: 'https://api.join.me/v1/',
          get: {
            me: 'user',
            meetings: 'meetings',
            'meetings/info': 'meetings/@{id}'
          },
          post: {
            'meetings/start/adhoc': function(p, callback) {
              callback('meetings/start');
            },
            'meetings/start/scheduled': function(p, callback) {
              var meetingId = p.data.meetingId;
              p.data = {};
              callback('meetings/' + meetingId + '/start');
            },
            'meetings/schedule': function(p, callback) {
              callback('meetings');
            }
          },
          patch: {'meetings/update': function(p, callback) {
              callback('meetings/' + p.data.meetingId);
            }},
          del: {'meetings/delete': 'meetings/@{id}'},
          wrap: {
            me: function(o, headers) {
              formatError(o, headers);
              if (!o.email) {
                return o;
              }
              o.name = o.fullName;
              o.first_name = o.name.split(' ')[0];
              o.last_name = o.name.split(' ')[1];
              o.id = o.email;
              return o;
            },
            'default': function(o, headers) {
              formatError(o, headers);
              return o;
            }
          },
          xhr: formatRequest
        }});
      function formatError(o, headers) {
        var errorCode;
        var message;
        var details;
        if (o && ('Message' in o)) {
          message = o.Message;
          delete o.Message;
          if ('ErrorCode' in o) {
            errorCode = o.ErrorCode;
            delete o.ErrorCode;
          } else {
            errorCode = getErrorCode(headers);
          }
          o.error = {
            code: errorCode,
            message: message,
            details: o
          };
        }
        return o;
      }
      function formatRequest(p, qs) {
        var token = qs.access_token;
        delete qs.access_token;
        p.headers.Authorization = 'Bearer ' + token;
        if (p.method !== 'get' && p.data) {
          p.headers['Content-Type'] = 'application/json';
          if (typeof(p.data) === 'object') {
            p.data = JSON.stringify(p.data);
          }
        }
        if (p.method === 'put') {
          p.method = 'patch';
        }
        return true;
      }
      function getErrorCode(headers) {
        switch (headers.statusCode) {
          case 400:
            return 'invalid_request';
          case 403:
            return 'stale_token';
          case 401:
            return 'invalid_token';
          case 500:
            return 'server_error';
          default:
            return 'server_error';
        }
      }
    }(hello));
    (function(hello) {
      hello.init({linkedin: {
          oauth: {
            version: 2,
            response_type: 'code',
            auth: 'https://www.linkedin.com/uas/oauth2/authorization',
            grant: 'https://www.linkedin.com/uas/oauth2/accessToken'
          },
          refresh: true,
          scope: {
            basic: 'r_basicprofile',
            email: 'r_emailaddress',
            files: '',
            friends: '',
            photos: '',
            publish: 'w_share',
            publish_files: 'w_share',
            share: '',
            videos: '',
            offline_access: ''
          },
          scope_delim: ' ',
          base: 'https://api.linkedin.com/v1/',
          get: {
            me: 'people/~:(picture-url,first-name,last-name,id,formatted-name,email-address)',
            'me/share': 'people/~/network/updates?count=@{limit|250}'
          },
          post: {
            'me/share': function(p, callback) {
              var data = {visibility: {code: 'anyone'}};
              if (p.data.id) {
                data.attribution = {share: {id: p.data.id}};
              } else {
                data.comment = p.data.message;
                if (p.data.picture && p.data.link) {
                  data.content = {
                    'submitted-url': p.data.link,
                    'submitted-image-url': p.data.picture
                  };
                }
              }
              p.data = JSON.stringify(data);
              callback('people/~/shares?format=json');
            },
            'me/like': like
          },
          del: {'me/like': like},
          wrap: {
            me: function(o) {
              formatError(o);
              formatUser(o);
              return o;
            },
            'me/friends': formatFriends,
            'me/following': formatFriends,
            'me/followers': formatFriends,
            'me/share': function(o) {
              formatError(o);
              paging(o);
              if (o.values) {
                o.data = o.values.map(formatUser);
                o.data.forEach(function(item) {
                  item.message = item.headline;
                });
                delete o.values;
              }
              return o;
            },
            'default': function(o, headers) {
              formatError(o);
              empty(o, headers);
              paging(o);
            }
          },
          jsonp: function(p, qs) {
            formatQuery(qs);
            if (p.method === 'get') {
              qs.format = 'jsonp';
              qs['error-callback'] = p.callbackID;
            }
          },
          xhr: function(p, qs) {
            if (p.method !== 'get') {
              formatQuery(qs);
              p.headers['Content-Type'] = 'application/json';
              p.headers['x-li-format'] = 'json';
              p.proxy = true;
              return true;
            }
            return false;
          }
        }});
      function formatError(o) {
        if (o && 'errorCode' in o) {
          o.error = {
            code: o.status,
            message: o.message
          };
        }
      }
      function formatUser(o) {
        if (o.error) {
          return;
        }
        o.first_name = o.firstName;
        o.last_name = o.lastName;
        o.name = o.formattedName || (o.first_name + ' ' + o.last_name);
        o.thumbnail = o.pictureUrl;
        o.email = o.emailAddress;
        return o;
      }
      function formatFriends(o) {
        formatError(o);
        paging(o);
        if (o.values) {
          o.data = o.values.map(formatUser);
          delete o.values;
        }
        return o;
      }
      function paging(res) {
        if ('_count' in res && '_start' in res && (res._count + res._start) < res._total) {
          res.paging = {next: '?start=' + (res._start + res._count) + '&count=' + res._count};
        }
      }
      function empty(o, headers) {
        if (JSON.stringify(o) === '{}' && headers.statusCode === 200) {
          o.success = true;
        }
      }
      function formatQuery(qs) {
        if (qs.access_token) {
          qs.oauth2_access_token = qs.access_token;
          delete qs.access_token;
        }
      }
      function like(p, callback) {
        p.headers['x-li-format'] = 'json';
        var id = p.data.id;
        p.data = (p.method !== 'delete').toString();
        p.method = 'put';
        callback('people/~/network/updates/key=' + id + '/is-liked');
      }
    })(hello);
    (function(hello) {
      hello.init({soundcloud: {
          name: 'SoundCloud',
          oauth: {
            version: 2,
            auth: 'https://soundcloud.com/connect',
            grant: 'https://soundcloud.com/oauth2/token'
          },
          base: 'https://api.soundcloud.com/',
          get: {
            me: 'me.json',
            'me/friends': 'me/followings.json',
            'me/followers': 'me/followers.json',
            'me/following': 'me/followings.json',
            'default': function(p, callback) {
              callback(p.path + '.json');
            }
          },
          wrap: {
            me: function(o) {
              formatUser(o);
              return o;
            },
            'default': function(o) {
              if (Array.isArray(o)) {
                o = {data: o.map(formatUser)};
              }
              paging(o);
              return o;
            }
          },
          xhr: formatRequest,
          jsonp: formatRequest
        }});
      function formatRequest(p, qs) {
        var token = qs.access_token;
        delete qs.access_token;
        qs.oauth_token = token;
        qs['_status_code_map[302]'] = 200;
        return true;
      }
      function formatUser(o) {
        if (o.id) {
          o.picture = o.avatar_url;
          o.thumbnail = o.avatar_url;
          o.name = o.username || o.full_name;
        }
        return o;
      }
      function paging(res) {
        if ('next_href' in res) {
          res.paging = {next: res.next_href};
        }
      }
    })(hello);
    (function(hello) {
      var base = 'https://api.twitter.com/';
      hello.init({twitter: {
          oauth: {
            version: '1.0a',
            auth: base + 'oauth/authenticate',
            request: base + 'oauth/request_token',
            token: base + 'oauth/access_token'
          },
          login: function(p) {
            var prefix = '?force_login=true';
            this.oauth.auth = this.oauth.auth.replace(prefix, '') + (p.options.force ? prefix : '');
          },
          base: base + '1.1/',
          get: {
            me: 'account/verify_credentials.json',
            'me/friends': 'friends/list.json?count=@{limit|200}',
            'me/following': 'friends/list.json?count=@{limit|200}',
            'me/followers': 'followers/list.json?count=@{limit|200}',
            'me/share': 'statuses/user_timeline.json?count=@{limit|200}',
            'me/like': 'favorites/list.json?count=@{limit|200}'
          },
          post: {
            'me/share': function(p, callback) {
              var data = p.data;
              p.data = null;
              var status = [];
              if (data.message) {
                status.push(data.message);
                delete data.message;
              }
              if (data.link) {
                status.push(data.link);
                delete data.link;
              }
              if (data.picture) {
                status.push(data.picture);
                delete data.picture;
              }
              if (status.length) {
                data.status = status.join(' ');
              }
              if (data.file) {
                data['media[]'] = data.file;
                delete data.file;
                p.data = data;
                callback('statuses/update_with_media.json');
              } else if ('id' in data) {
                callback('statuses/retweet/' + data.id + '.json');
              } else {
                hello.utils.extend(p.query, data);
                callback('statuses/update.json?include_entities=1');
              }
            },
            'me/like': function(p, callback) {
              var id = p.data.id;
              p.data = null;
              callback('favorites/create.json?id=' + id);
            }
          },
          del: {'me/like': function() {
              p.method = 'post';
              var id = p.data.id;
              p.data = null;
              callback('favorites/destroy.json?id=' + id);
            }},
          wrap: {
            me: function(res) {
              formatError(res);
              formatUser(res);
              return res;
            },
            'me/friends': formatFriends,
            'me/followers': formatFriends,
            'me/following': formatFriends,
            'me/share': function(res) {
              formatError(res);
              paging(res);
              if (!res.error && 'length' in res) {
                return {data: res};
              }
              return res;
            },
            'default': function(res) {
              res = arrayToDataResponse(res);
              paging(res);
              return res;
            }
          },
          xhr: function(p) {
            return (p.method !== 'get');
          }
        }});
      function formatUser(o) {
        if (o.id) {
          if (o.name) {
            var m = o.name.split(' ');
            o.first_name = m.shift();
            o.last_name = m.join(' ');
          }
          o.thumbnail = o.profile_image_url_https || o.profile_image_url;
        }
        return o;
      }
      function formatFriends(o) {
        formatError(o);
        paging(o);
        if (o.users) {
          o.data = o.users.map(formatUser);
          delete o.users;
        }
        return o;
      }
      function formatError(o) {
        if (o.errors) {
          var e = o.errors[0];
          o.error = {
            code: 'request_failed',
            message: e.message
          };
        }
      }
      function paging(res) {
        if ('next_cursor_str' in res) {
          res.paging = {next: '?cursor=' + res.next_cursor_str};
        }
      }
      function arrayToDataResponse(res) {
        return Array.isArray(res) ? {data: res} : res;
      }
    })(hello);
    (function(hello) {
      hello.init({vk: {
          name: 'Vk',
          oauth: {
            version: 2,
            auth: 'https://oauth.vk.com/authorize',
            grant: 'https://oauth.vk.com/access_token'
          },
          scope: {
            email: 'email',
            friends: 'friends',
            photos: 'photos',
            videos: 'video',
            share: 'share',
            offline_access: 'offline'
          },
          refresh: true,
          login: function(p) {
            p.qs.display = window.navigator && window.navigator.userAgent && /ipad|phone|phone|android/.test(window.navigator.userAgent.toLowerCase()) ? 'mobile' : 'popup';
          },
          base: 'https://api.vk.com/method/',
          get: {me: function(p, callback) {
              p.query.fields = 'id,first_name,last_name,photo_max';
              callback('users.get');
            }},
          wrap: {me: function(res, headers, req) {
              formatError(res);
              return formatUser(res, req);
            }},
          xhr: false,
          jsonp: true,
          form: false
        }});
      function formatUser(o, req) {
        if (o !== null && 'response' in o && o.response !== null && o.response.length) {
          o = o.response[0];
          o.id = o.uid;
          o.thumbnail = o.picture = o.photo_max;
          o.name = o.first_name + ' ' + o.last_name;
          if (req.authResponse && req.authResponse.email !== null)
            o.email = req.authResponse.email;
        }
        return o;
      }
      function formatError(o) {
        if (o.error) {
          var e = o.error;
          o.error = {
            code: e.error_code,
            message: e.error_msg
          };
        }
      }
    })(hello);
    (function(hello) {
      hello.init({windows: {
          name: 'Windows live',
          oauth: {
            version: 2,
            auth: 'https://login.live.com/oauth20_authorize.srf',
            grant: 'https://login.live.com/oauth20_token.srf'
          },
          refresh: true,
          logout: function() {
            return 'http://login.live.com/oauth20_logout.srf?ts=' + (new Date()).getTime();
          },
          scope: {
            basic: 'wl.signin,wl.basic',
            email: 'wl.emails',
            birthday: 'wl.birthday',
            events: 'wl.calendars',
            photos: 'wl.photos',
            videos: 'wl.photos',
            friends: 'wl.contacts_emails',
            files: 'wl.skydrive',
            publish: 'wl.share',
            publish_files: 'wl.skydrive_update',
            share: 'wl.share',
            create_event: 'wl.calendars_update,wl.events_create',
            offline_access: 'wl.offline_access'
          },
          base: 'https://apis.live.net/v5.0/',
          get: {
            me: 'me',
            'me/friends': 'me/friends',
            'me/following': 'me/contacts',
            'me/followers': 'me/friends',
            'me/contacts': 'me/contacts',
            'me/albums': 'me/albums',
            'me/album': '@{id}/files',
            'me/photo': '@{id}',
            'me/files': '@{parent|me/skydrive}/files',
            'me/folders': '@{id|me/skydrive}/files',
            'me/folder': '@{id|me/skydrive}/files'
          },
          post: {
            'me/albums': 'me/albums',
            'me/album': '@{id}/files/',
            'me/folders': '@{id|me/skydrive/}',
            'me/files': '@{parent|me/skydrive}/files'
          },
          del: {
            'me/album': '@{id}',
            'me/photo': '@{id}',
            'me/folder': '@{id}',
            'me/files': '@{id}'
          },
          wrap: {
            me: formatUser,
            'me/friends': formatFriends,
            'me/contacts': formatFriends,
            'me/followers': formatFriends,
            'me/following': formatFriends,
            'me/albums': formatAlbums,
            'me/photos': formatDefault,
            'default': formatDefault
          },
          xhr: function(p) {
            if (p.method !== 'get' && p.method !== 'delete' && !hello.utils.hasBinary(p.data)) {
              if (typeof(p.data.file) === 'string') {
                p.data.file = hello.utils.toBlob(p.data.file);
              } else {
                p.data = JSON.stringify(p.data);
                p.headers = {'Content-Type': 'application/json'};
              }
            }
            return true;
          },
          jsonp: function(p) {
            if (p.method !== 'get' && !hello.utils.hasBinary(p.data)) {
              p.data.method = p.method;
              p.method = 'get';
            }
          }
        }});
      function formatDefault(o) {
        if ('data' in o) {
          o.data.forEach(function(d) {
            if (d.picture) {
              d.thumbnail = d.picture;
            }
            if (d.images) {
              d.pictures = d.images.map(formatImage).sort(function(a, b) {
                return a.width - b.width;
              });
            }
          });
        }
        return o;
      }
      function formatImage(image) {
        return {
          width: image.width,
          height: image.height,
          source: image.source
        };
      }
      function formatAlbums(o) {
        if ('data' in o) {
          o.data.forEach(function(d) {
            d.photos = d.files = 'https://apis.live.net/v5.0/' + d.id + '/photos';
          });
        }
        return o;
      }
      function formatUser(o, headers, req) {
        if (o.id) {
          var token = req.query.access_token;
          if (o.emails) {
            o.email = o.emails.preferred;
          }
          if (o.is_friend !== false) {
            var id = (o.user_id || o.id);
            o.thumbnail = o.picture = 'https://apis.live.net/v5.0/' + id + '/picture?access_token=' + token;
          }
        }
        return o;
      }
      function formatFriends(o, headers, req) {
        if ('data' in o) {
          o.data.forEach(function(d) {
            formatUser(d, headers, req);
          });
        }
        return o;
      }
    })(hello);
    (function(hello) {
      hello.init({yahoo: {
          oauth: {
            version: '1.0a',
            auth: 'https://api.login.yahoo.com/oauth/v2/request_auth',
            request: 'https://api.login.yahoo.com/oauth/v2/get_request_token',
            token: 'https://api.login.yahoo.com/oauth/v2/get_token'
          },
          login: function(p) {
            p.options.popup.width = 560;
            try {
              delete p.qs.state.scope;
            } catch (e) {}
          },
          base: 'https://social.yahooapis.com/v1/',
          get: {
            me: yql('select * from social.profile(0) where guid=me'),
            'me/friends': yql('select * from social.contacts(0) where guid=me'),
            'me/following': yql('select * from social.contacts(0) where guid=me')
          },
          wrap: {
            me: formatUser,
            'me/friends': formatFriends,
            'me/following': formatFriends,
            'default': paging
          }
        }});
      function formatError(o) {
        if (o && 'meta' in o && 'error_type' in o.meta) {
          o.error = {
            code: o.meta.error_type,
            message: o.meta.error_message
          };
        }
      }
      function formatUser(o) {
        formatError(o);
        if (o.query && o.query.results && o.query.results.profile) {
          o = o.query.results.profile;
          o.id = o.guid;
          o.last_name = o.familyName;
          o.first_name = o.givenName || o.nickname;
          var a = [];
          if (o.first_name) {
            a.push(o.first_name);
          }
          if (o.last_name) {
            a.push(o.last_name);
          }
          o.name = a.join(' ');
          o.email = (o.emails && o.emails[0]) ? o.emails[0].handle : null;
          o.thumbnail = o.image ? o.image.imageUrl : null;
        }
        return o;
      }
      function formatFriends(o, headers, request) {
        formatError(o);
        paging(o, headers, request);
        var contact;
        var field;
        if (o.query && o.query.results && o.query.results.contact) {
          o.data = o.query.results.contact;
          delete o.query;
          if (!Array.isArray(o.data)) {
            o.data = [o.data];
          }
          o.data.forEach(formatFriend);
        }
        return o;
      }
      function formatFriend(contact) {
        contact.id = null;
        if (contact.fields && !(contact.fields instanceof Array)) {
          contact.fields = [contact.fields];
        }
        (contact.fields || []).forEach(function(field) {
          if (field.type === 'email') {
            contact.email = field.value;
          }
          if (field.type === 'name') {
            contact.first_name = field.value.givenName;
            contact.last_name = field.value.familyName;
            contact.name = field.value.givenName + ' ' + field.value.familyName;
          }
          if (field.type === 'yahooid') {
            contact.id = field.value;
          }
        });
      }
      function paging(res, headers, request) {
        if (res.query && res.query.count && request.options) {
          res.paging = {next: '?start=' + (res.query.count + (+request.options.start || 1))};
        }
        return res;
      }
      function yql(q) {
        return 'https://query.yahooapis.com/v1/yql?q=' + (q + ' limit @{limit|100} offset @{start|0}').replace(/\s/g, '%20') + '&format=json';
      }
    })(hello);
    if (typeof define === 'function' && define.amd) {
      define(function() {
        return hello;
      });
    }
    if (typeof module === 'object' && module.exports) {
      module.exports = hello;
    }
  })($__require('40'));
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("41", ["3f"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = $__require('3f');
  global.define = __define;
  return module.exports;
});

$__System.register('42', ['5', '6', '41', 'c'], function (_export) {
  var _createClass, _classCallCheck, hello, _Promise, IdentityModule;

  return {
    setters: [function (_) {
      _createClass = _['default'];
    }, function (_2) {
      _classCallCheck = _2['default'];
    }, function (_3) {
      hello = _3['default'];
    }, function (_c) {
      _Promise = _c['default'];
    }],
    execute: function () {

      /**
      *
      * The Identity Module (Id Module) is the component responsible for handling the
      * user identity and the association of this identity with the Hyperty instances,
      * in order to make Hyperty instances identifiable. The identity in the reTHINK project
      * is not fixed to a unique Identity Service Provider, but obtained through several
      * different Identity sources. With this approach, the Id Module provides to the user the
      * option to choose the preferred method for authentication.
      * This module will thus able to support multiple Identity acquisition methods,
      * such as OpenID connect 1.0, Kerberos System, or authentication through smart cards.
      * For example, a user with a Google account can use the Google as an Identity Provider to provide Identity Tokens,
      *  which can be used by the Identity Module to associate it with a Hyperty instance.
      *
      * The Identity Module uses a node package, the HelloJS, which is a client-side JavaScript API for authentication
      * that facilitates the requests for the OpenID connect protocol. This method allows for some abstraction
      * when making requests for different Identity Providers, such as OpenID connect used by Google, Facebook, Microsoft, for example.
      *
      * When a request for a user identity is made using the method loginWithRP(identifier, scope),
      * this method will analyse the Identity Provider chosen to obtain an identity and will use the HelloJS node package
      * with the selected Identity Provider and identity scope. After the HelloJS request for an Access Token
      * to the Identity Providers, the user will be prompted to authenticate towards the Identity Provider.
      * Upon receiving the Access Token, this token is validated with a RESTful web service request to an endpoint
      * on the Identity Provider Authorization Server, and after the validation is done,
      * an ID token is obtained with the information according to the scope required.
      * This ID token is then preserved in this module that can obtained through the getIdentities()
      * and is passed as return value of the loginWithRP function. The methods generateAssertion and validateAssertion have not yet been developed.
      *
      */
      'use strict';

      IdentityModule = (function () {

        /**
        * This is the constructor to initialise the Identity Module it does not require any input.
        */

        function IdentityModule() {
          _classCallCheck(this, IdentityModule);

          var _this = this;
          //to store items with this format: {identity: identityURL, token: tokenID}
          _this.identities = [];
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
          * Function to return all the identities registered within a session by a user.
          * These identities are returned in an array containing a JSON package for each user identity.
          * @return {Array<Identities>}         Array         Identities
          */

        }, {
          key: 'getIdentities',
          value: function getIdentities() {
            var _this = this;
            return _this.identities;
          }

          /**
          * Function to request an ID Token from a user. If no token exists, the Identity Module
          * will try to obtain one from an Identity Provider, and the user will be asked to authenticate
          *  towards the Identity Provider.
          * The function returns a promise with a token containing the user information.
          *
          * @param  {Identifier}      identifier      identifier
          * @param  {Scope}           scope           scope
          * @return {Promise}         Promise         IDToken containing the user information
          */
        }, {
          key: 'loginWithRP',
          value: function loginWithRP(identifier, scope) {
            var _this = this;

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
               identityModule._hello.init({google: "808329566012-tqr8qoh111942gd2kg007t0s8f277roi.apps.googleusercontent.com"});
              identityModule._hello("google").login();
             */

            var VALIDURL = 'https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=';
            var USERINFURL = 'https://www.googleapis.com/oauth2/v1/userinfo?access_token=';
            var acToken = undefined;
            var tokenType = undefined;
            var expiresIn = undefined;
            var user = undefined;
            var tokenID = undefined;
            var infoToken = undefined;
            var loggedIn = false;

            return new _Promise(function (resolve, reject) {

              if (_this.infoToken !== undefined) {
                //TODO verify whether the token is still valid or not.
                return resolve(_this.infoToken);
              }

              //function to validate the access token received during the authentication
              function validateToken(token) {
                var req = new XMLHttpRequest();
                req.open('GET', VALIDURL + token, true);

                req.onreadystatechange = function (e) {
                  if (req.readyState == 4) {
                    if (req.status == 200) {
                      getInfoToken(token);
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
              function getInfoToken(token) {
                var req = new XMLHttpRequest();
                req.open('GET', USERINFURL + token, true);

                req.onreadystatechange = function (e) {
                  if (req.readyState === 4) {
                    if (req.status === 200) {
                      infoToken = JSON.parse(req.responseText);
                      _this.infoToken = infoToken;
                      var email = infoToken.email;

                      //contruct the identityURL to be defined as in specification
                      // model: user://<idpdomain>/<user-identifier>
                      var identityURL = 'user://' + email.substring(email.indexOf('@') + 1, email.length) + '/' + email.substring(0, email.indexOf('@'));

                      //TODO remove later the 'token' field key
                      var identityBundle = { identity: identityURL, token: infoToken, accessToken: token, idToken: {}, infoToken: infoToken };

                      getIDToken(token, identityBundle);
                    } else if (req.status === 400) {
                      reject('There was an error processing the token');
                    } else {
                      reject('something else other than 200 was returned');
                    }
                  }
                };
                req.send();
              }

              function getIDToken(token, identityBundle) {
                var req = new XMLHttpRequest();
                req.open('GET', VALIDURL + token, true);

                req.onreadystatechange = function (e) {
                  if (req.readyState === 4) {
                    if (req.status === 200) {
                      tokenID = JSON.parse(req.responseText);

                      identityBundle.idToken = tokenID;
                      _this.identities.push(identityBundle);
                      resolve(identityBundle.token);
                    } else if (req.status === 400) {
                      reject('There was an error processing the token');
                    } else {
                      reject('something else other than 200 was returned');
                    }
                  }
                };
                req.send();
              }

              hello.init({ google: '808329566012-tqr8qoh111942gd2kg007t0s8f277roi.apps.googleusercontent.com' });
              hello('google').login({ scope: 'email' }).then(function (token) {

                validateToken(token.authResponse.access_token);
              }, function (error) {
                console.log('errorValidating ', error);
                reject(error);
              });
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
          * Generates an Identity Assertion
          *
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
          * Function to validate an identity assertion generated previously.
          * Returns a promise with the result from the validation.
          * @param  {DOMString} assertion
          * @return {Promise}         Promise         promise with the result from the validation
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
$__System.registerDynamic("43", ["44", "45"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var toObject = $__require('44');
  $__require('45')('keys', function($keys) {
    return function keys(it) {
      return $keys(toObject(it));
    };
  });
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("46", ["43", "23"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  $__require('43');
  module.exports = $__require('23').Object.keys;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("13", ["46"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": $__require('46'),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

$__System.register('10', ['13'], function (_export) {
  var _Object$keys;

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

  /**
   * Check if an Object is empty
   * @param  {Object} object Object to be checked
   * @return {Boolean}       status of Object, empty or not (true|false);
   */

  function emptyObject(object) {
    return _Object$keys(object).length > 0 ? false : true;
  }

  /**
   * Make a COPY of the original data
   * @param  {Object}  obj - object to be cloned
   * @return {Object}
   */

  function deepClone(obj) {
    //TODO: simple but inefficient JSON deep clone...
    if (obj) return JSON.parse(JSON.stringify(obj));
  }

  /**
   * Obtains the user URL that corresponds to a given email
   * @param  {string} userEmail The user email
   * @return {URL.URL} userURL The user URL
   */

  function getUserURLFromEmail(userEmail) {
    var indexOfAt = userEmail.indexOf('@');
    return 'user://' + userEmail.substring(indexOfAt + 1, userEmail.length) + '/' + userEmail.substring(0, indexOfAt);
  }

  /**
   * Obtains the user email that corresponds to a given URL
   * @param  {URL.URL} userURL The user URL
   * @return {string} userEmail The user email
   */

  function getUserEmailFromURL(userURL) {
    var url = divideURL(userURL);
    return url.identity.replace('/', '') + '@' + url.domain; // identity field has '/exampleID' instead of 'exampleID'
  }

  return {
    setters: [function (_) {
      _Object$keys = _['default'];
    }],
    execute: function () {
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

      _export('divideURL', divideURL);

      _export('emptyObject', emptyObject);

      _export('deepClone', deepClone);

      _export('getUserURLFromEmail', getUserURLFromEmail);

      _export('getUserEmailFromURL', getUserEmailFromURL);
    }
  };
});
(function() {
var _removeDefine = $__System.get("@@amd-helpers").createDefine();
!function(e) {
  if ("object" == typeof exports && "undefined" != typeof module)
    module.exports = e();
  else if ("function" == typeof define && define.amd)
    define("47", [], e);
  else {
    var t;
    t = "undefined" != typeof window ? window : "undefined" != typeof global ? global : "undefined" != typeof self ? self : this, t.serviceFramework = e();
  }
}(function() {
  var e;
  return function t(e, r, n) {
    function o(s, a) {
      if (!r[s]) {
        if (!e[s]) {
          var u = "function" == typeof require && require;
          if (!a && u)
            return u(s, !0);
          if (i)
            return i(s, !0);
          var c = new Error("Cannot find module '" + s + "'");
          throw c.code = "MODULE_NOT_FOUND", c;
        }
        var l = r[s] = {exports: {}};
        e[s][0].call(l.exports, function(t) {
          var r = e[s][1][t];
          return o(r ? r : t);
        }, l, l.exports, t, e, r, n);
      }
      return r[s].exports;
    }
    for (var i = "function" == typeof require && require,
        s = 0; s < n.length; s++)
      o(n[s]);
    return o;
  }({
    1: [function(e, t, r) {
      t.exports = {
        "default": e("core-js/library/fn/object/create"),
        __esModule: !0
      };
    }, {"core-js/library/fn/object/create": 20}],
    2: [function(e, t, r) {
      t.exports = {
        "default": e("core-js/library/fn/object/define-property"),
        __esModule: !0
      };
    }, {"core-js/library/fn/object/define-property": 21}],
    3: [function(e, t, r) {
      t.exports = {
        "default": e("core-js/library/fn/object/freeze"),
        __esModule: !0
      };
    }, {"core-js/library/fn/object/freeze": 22}],
    4: [function(e, t, r) {
      t.exports = {
        "default": e("core-js/library/fn/object/get-own-property-descriptor"),
        __esModule: !0
      };
    }, {"core-js/library/fn/object/get-own-property-descriptor": 23}],
    5: [function(e, t, r) {
      t.exports = {
        "default": e("core-js/library/fn/object/get-prototype-of"),
        __esModule: !0
      };
    }, {"core-js/library/fn/object/get-prototype-of": 24}],
    6: [function(e, t, r) {
      t.exports = {
        "default": e("core-js/library/fn/object/keys"),
        __esModule: !0
      };
    }, {"core-js/library/fn/object/keys": 25}],
    7: [function(e, t, r) {
      t.exports = {
        "default": e("core-js/library/fn/object/set-prototype-of"),
        __esModule: !0
      };
    }, {"core-js/library/fn/object/set-prototype-of": 26}],
    8: [function(e, t, r) {
      t.exports = {
        "default": e("core-js/library/fn/promise"),
        __esModule: !0
      };
    }, {"core-js/library/fn/promise": 27}],
    9: [function(e, t, r) {
      t.exports = {
        "default": e("core-js/library/fn/symbol"),
        __esModule: !0
      };
    }, {"core-js/library/fn/symbol": 28}],
    10: [function(e, t, r) {
      t.exports = {
        "default": e("core-js/library/fn/symbol/iterator"),
        __esModule: !0
      };
    }, {"core-js/library/fn/symbol/iterator": 29}],
    11: [function(e, t, r) {
      t.exports = e("./classCallCheck.js");
    }, {"./classCallCheck.js": 12}],
    12: [function(e, t, r) {
      "use strict";
      r.__esModule = !0, r["default"] = function(e, t) {
        if (!(e instanceof t))
          throw new TypeError("Cannot call a class as a function");
      };
    }, {}],
    13: [function(e, t, r) {
      t.exports = e("./createClass.js");
    }, {"./createClass.js": 14}],
    14: [function(e, t, r) {
      "use strict";
      function n(e) {
        return e && e.__esModule ? e : {"default": e};
      }
      r.__esModule = !0;
      var o = e("../core-js/object/define-property"),
          i = n(o);
      r["default"] = function() {
        function e(e, t) {
          for (var r = 0; r < t.length; r++) {
            var n = t[r];
            n.enumerable = n.enumerable || !1, n.configurable = !0, "value" in n && (n.writable = !0), (0, i["default"])(e, n.key, n);
          }
        }
        return function(t, r, n) {
          return r && e(t.prototype, r), n && e(t, n), t;
        };
      }();
    }, {"../core-js/object/define-property": 2}],
    15: [function(e, t, r) {
      "use strict";
      function n(e) {
        return e && e.__esModule ? e : {"default": e};
      }
      r.__esModule = !0;
      var o = e("../core-js/object/get-prototype-of"),
          i = n(o),
          s = e("../core-js/object/get-own-property-descriptor"),
          a = n(s);
      r["default"] = function u(e, t, r) {
        null === e && (e = Function.prototype);
        var n = (0, a["default"])(e, t);
        if (void 0 === n) {
          var o = (0, i["default"])(e);
          return null === o ? void 0 : u(o, t, r);
        }
        if ("value" in n)
          return n.value;
        var s = n.get;
        if (void 0 !== s)
          return s.call(r);
      };
    }, {
      "../core-js/object/get-own-property-descriptor": 4,
      "../core-js/object/get-prototype-of": 5
    }],
    16: [function(e, t, r) {
      "use strict";
      function n(e) {
        return e && e.__esModule ? e : {"default": e};
      }
      r.__esModule = !0;
      var o = e("../core-js/object/set-prototype-of"),
          i = n(o),
          s = e("../core-js/object/create"),
          a = n(s),
          u = e("../helpers/typeof"),
          c = n(u);
      r["default"] = function(e, t) {
        if ("function" != typeof t && null !== t)
          throw new TypeError("Super expression must either be null or a function, not " + ("undefined" == typeof t ? "undefined" : (0, c["default"])(t)));
        e.prototype = (0, a["default"])(t && t.prototype, {constructor: {
            value: e,
            enumerable: !1,
            writable: !0,
            configurable: !0
          }}), t && (i["default"] ? (0, i["default"])(e, t) : e.__proto__ = t);
      };
    }, {
      "../core-js/object/create": 1,
      "../core-js/object/set-prototype-of": 7,
      "../helpers/typeof": 19
    }],
    17: [function(e, t, r) {
      t.exports = e("./interopRequireDefault.js");
    }, {"./interopRequireDefault.js": 18}],
    18: [function(e, t, r) {
      "use strict";
      r.__esModule = !0, r["default"] = function(e) {
        return e && e.__esModule ? e : {"default": e};
      };
    }, {}],
    19: [function(e, t, r) {
      "use strict";
      function n(e) {
        return e && e.__esModule ? e : {"default": e};
      }
      function o(e) {
        return e && "undefined" != typeof _Symbol && e.constructor === _Symbol ? "symbol" : typeof e;
      }
      r.__esModule = !0;
      var i = e("../core-js/symbol"),
          s = n(i);
      r["default"] = function(e) {
        return e && "undefined" != typeof s["default"] && e.constructor === s["default"] ? "symbol" : "undefined" == typeof e ? "undefined" : o(e);
      };
    }, {"../core-js/symbol": 9}],
    20: [function(e, t, r) {
      var n = e("../../modules/$");
      t.exports = function(e, t) {
        return n.create(e, t);
      };
    }, {"../../modules/$": 60}],
    21: [function(e, t, r) {
      var n = e("../../modules/$");
      t.exports = function(e, t, r) {
        return n.setDesc(e, t, r);
      };
    }, {"../../modules/$": 60}],
    22: [function(e, t, r) {
      e("../../modules/es6.object.freeze"), t.exports = e("../../modules/$.core").Object.freeze;
    }, {
      "../../modules/$.core": 35,
      "../../modules/es6.object.freeze": 85
    }],
    23: [function(e, t, r) {
      var n = e("../../modules/$");
      e("../../modules/es6.object.get-own-property-descriptor"), t.exports = function(e, t) {
        return n.getDesc(e, t);
      };
    }, {
      "../../modules/$": 60,
      "../../modules/es6.object.get-own-property-descriptor": 86
    }],
    24: [function(e, t, r) {
      e("../../modules/es6.object.get-prototype-of"), t.exports = e("../../modules/$.core").Object.getPrototypeOf;
    }, {
      "../../modules/$.core": 35,
      "../../modules/es6.object.get-prototype-of": 87
    }],
    25: [function(e, t, r) {
      e("../../modules/es6.object.keys"), t.exports = e("../../modules/$.core").Object.keys;
    }, {
      "../../modules/$.core": 35,
      "../../modules/es6.object.keys": 88
    }],
    26: [function(e, t, r) {
      e("../../modules/es6.object.set-prototype-of"), t.exports = e("../../modules/$.core").Object.setPrototypeOf;
    }, {
      "../../modules/$.core": 35,
      "../../modules/es6.object.set-prototype-of": 89
    }],
    27: [function(e, t, r) {
      e("../modules/es6.object.to-string"), e("../modules/es6.string.iterator"), e("../modules/web.dom.iterable"), e("../modules/es6.promise"), t.exports = e("../modules/$.core").Promise;
    }, {
      "../modules/$.core": 35,
      "../modules/es6.object.to-string": 90,
      "../modules/es6.promise": 91,
      "../modules/es6.string.iterator": 92,
      "../modules/web.dom.iterable": 94
    }],
    28: [function(e, t, r) {
      e("../../modules/es6.symbol"), e("../../modules/es6.object.to-string"), t.exports = e("../../modules/$.core").Symbol;
    }, {
      "../../modules/$.core": 35,
      "../../modules/es6.object.to-string": 90,
      "../../modules/es6.symbol": 93
    }],
    29: [function(e, t, r) {
      e("../../modules/es6.string.iterator"), e("../../modules/web.dom.iterable"), t.exports = e("../../modules/$.wks")("iterator");
    }, {
      "../../modules/$.wks": 82,
      "../../modules/es6.string.iterator": 92,
      "../../modules/web.dom.iterable": 94
    }],
    30: [function(e, t, r) {
      t.exports = function(e) {
        if ("function" != typeof e)
          throw TypeError(e + " is not a function!");
        return e;
      };
    }, {}],
    31: [function(e, t, r) {
      t.exports = function() {};
    }, {}],
    32: [function(e, t, r) {
      var n = e("./$.is-object");
      t.exports = function(e) {
        if (!n(e))
          throw TypeError(e + " is not an object!");
        return e;
      };
    }, {"./$.is-object": 53}],
    33: [function(e, t, r) {
      var n = e("./$.cof"),
          o = e("./$.wks")("toStringTag"),
          i = "Arguments" == n(function() {
            return arguments;
          }());
      t.exports = function(e) {
        var t,
            r,
            s;
        return void 0 === e ? "Undefined" : null === e ? "Null" : "string" == typeof(r = (t = Object(e))[o]) ? r : i ? n(t) : "Object" == (s = n(t)) && "function" == typeof t.callee ? "Arguments" : s;
      };
    }, {
      "./$.cof": 34,
      "./$.wks": 82
    }],
    34: [function(e, t, r) {
      var n = {}.toString;
      t.exports = function(e) {
        return n.call(e).slice(8, -1);
      };
    }, {}],
    35: [function(e, t, r) {
      var n = t.exports = {version: "1.2.6"};
      "number" == typeof __e && (__e = n);
    }, {}],
    36: [function(e, t, r) {
      var n = e("./$.a-function");
      t.exports = function(e, t, r) {
        if (n(e), void 0 === t)
          return e;
        switch (r) {
          case 1:
            return function(r) {
              return e.call(t, r);
            };
          case 2:
            return function(r, n) {
              return e.call(t, r, n);
            };
          case 3:
            return function(r, n, o) {
              return e.call(t, r, n, o);
            };
        }
        return function() {
          return e.apply(t, arguments);
        };
      };
    }, {"./$.a-function": 30}],
    37: [function(e, t, r) {
      t.exports = function(e) {
        if (void 0 == e)
          throw TypeError("Can't call method on  " + e);
        return e;
      };
    }, {}],
    38: [function(e, t, r) {
      t.exports = !e("./$.fails")(function() {
        return 7 != Object.defineProperty({}, "a", {get: function() {
            return 7;
          }}).a;
      });
    }, {"./$.fails": 42}],
    39: [function(e, t, r) {
      var n = e("./$.is-object"),
          o = e("./$.global").document,
          i = n(o) && n(o.createElement);
      t.exports = function(e) {
        return i ? o.createElement(e) : {};
      };
    }, {
      "./$.global": 45,
      "./$.is-object": 53
    }],
    40: [function(e, t, r) {
      var n = e("./$");
      t.exports = function(e) {
        var t = n.getKeys(e),
            r = n.getSymbols;
        if (r)
          for (var o,
              i = r(e),
              s = n.isEnum,
              a = 0; i.length > a; )
            s.call(e, o = i[a++]) && t.push(o);
        return t;
      };
    }, {"./$": 60}],
    41: [function(e, t, r) {
      var n = e("./$.global"),
          o = e("./$.core"),
          i = e("./$.ctx"),
          s = "prototype",
          a = function(e, t, r) {
            var u,
                c,
                l,
                f = e & a.F,
                h = e & a.G,
                p = e & a.S,
                d = e & a.P,
                y = e & a.B,
                b = e & a.W,
                v = h ? o : o[t] || (o[t] = {}),
                m = h ? n : p ? n[t] : (n[t] || {})[s];
            h && (r = t);
            for (u in r)
              c = !f && m && u in m, c && u in v || (l = c ? m[u] : r[u], v[u] = h && "function" != typeof m[u] ? r[u] : y && c ? i(l, n) : b && m[u] == l ? function(e) {
                var t = function(t) {
                  return this instanceof e ? new e(t) : e(t);
                };
                return t[s] = e[s], t;
              }(l) : d && "function" == typeof l ? i(Function.call, l) : l, d && ((v[s] || (v[s] = {}))[u] = l));
          };
      a.F = 1, a.G = 2, a.S = 4, a.P = 8, a.B = 16, a.W = 32, t.exports = a;
    }, {
      "./$.core": 35,
      "./$.ctx": 36,
      "./$.global": 45
    }],
    42: [function(e, t, r) {
      t.exports = function(e) {
        try {
          return !!e();
        } catch (t) {
          return !0;
        }
      };
    }, {}],
    43: [function(e, t, r) {
      var n = e("./$.ctx"),
          o = e("./$.iter-call"),
          i = e("./$.is-array-iter"),
          s = e("./$.an-object"),
          a = e("./$.to-length"),
          u = e("./core.get-iterator-method");
      t.exports = function(e, t, r, c) {
        var l,
            f,
            h,
            p = u(e),
            d = n(r, c, t ? 2 : 1),
            y = 0;
        if ("function" != typeof p)
          throw TypeError(e + " is not iterable!");
        if (i(p))
          for (l = a(e.length); l > y; y++)
            t ? d(s(f = e[y])[0], f[1]) : d(e[y]);
        else
          for (h = p.call(e); !(f = h.next()).done; )
            o(h, d, f.value, t);
      };
    }, {
      "./$.an-object": 32,
      "./$.ctx": 36,
      "./$.is-array-iter": 51,
      "./$.iter-call": 54,
      "./$.to-length": 79,
      "./core.get-iterator-method": 83
    }],
    44: [function(e, t, r) {
      var n = e("./$.to-iobject"),
          o = e("./$").getNames,
          i = {}.toString,
          s = "object" == typeof window && Object.getOwnPropertyNames ? Object.getOwnPropertyNames(window) : [],
          a = function(e) {
            try {
              return o(e);
            } catch (t) {
              return s.slice();
            }
          };
      t.exports.get = function(e) {
        return s && "[object Window]" == i.call(e) ? a(e) : o(n(e));
      };
    }, {
      "./$": 60,
      "./$.to-iobject": 78
    }],
    45: [function(e, t, r) {
      var n = t.exports = "undefined" != typeof window && window.Math == Math ? window : "undefined" != typeof self && self.Math == Math ? self : Function("return this")();
      "number" == typeof __g && (__g = n);
    }, {}],
    46: [function(e, t, r) {
      var n = {}.hasOwnProperty;
      t.exports = function(e, t) {
        return n.call(e, t);
      };
    }, {}],
    47: [function(e, t, r) {
      var n = e("./$"),
          o = e("./$.property-desc");
      t.exports = e("./$.descriptors") ? function(e, t, r) {
        return n.setDesc(e, t, o(1, r));
      } : function(e, t, r) {
        return e[t] = r, e;
      };
    }, {
      "./$": 60,
      "./$.descriptors": 38,
      "./$.property-desc": 65
    }],
    48: [function(e, t, r) {
      t.exports = e("./$.global").document && document.documentElement;
    }, {"./$.global": 45}],
    49: [function(e, t, r) {
      t.exports = function(e, t, r) {
        var n = void 0 === r;
        switch (t.length) {
          case 0:
            return n ? e() : e.call(r);
          case 1:
            return n ? e(t[0]) : e.call(r, t[0]);
          case 2:
            return n ? e(t[0], t[1]) : e.call(r, t[0], t[1]);
          case 3:
            return n ? e(t[0], t[1], t[2]) : e.call(r, t[0], t[1], t[2]);
          case 4:
            return n ? e(t[0], t[1], t[2], t[3]) : e.call(r, t[0], t[1], t[2], t[3]);
        }
        return e.apply(r, t);
      };
    }, {}],
    50: [function(e, t, r) {
      var n = e("./$.cof");
      t.exports = Object("z").propertyIsEnumerable(0) ? Object : function(e) {
        return "String" == n(e) ? e.split("") : Object(e);
      };
    }, {"./$.cof": 34}],
    51: [function(e, t, r) {
      var n = e("./$.iterators"),
          o = e("./$.wks")("iterator"),
          i = Array.prototype;
      t.exports = function(e) {
        return void 0 !== e && (n.Array === e || i[o] === e);
      };
    }, {
      "./$.iterators": 59,
      "./$.wks": 82
    }],
    52: [function(e, t, r) {
      var n = e("./$.cof");
      t.exports = Array.isArray || function(e) {
        return "Array" == n(e);
      };
    }, {"./$.cof": 34}],
    53: [function(e, t, r) {
      t.exports = function(e) {
        return "object" == typeof e ? null !== e : "function" == typeof e;
      };
    }, {}],
    54: [function(e, t, r) {
      var n = e("./$.an-object");
      t.exports = function(e, t, r, o) {
        try {
          return o ? t(n(r)[0], r[1]) : t(r);
        } catch (i) {
          var s = e["return"];
          throw void 0 !== s && n(s.call(e)), i;
        }
      };
    }, {"./$.an-object": 32}],
    55: [function(e, t, r) {
      "use strict";
      var n = e("./$"),
          o = e("./$.property-desc"),
          i = e("./$.set-to-string-tag"),
          s = {};
      e("./$.hide")(s, e("./$.wks")("iterator"), function() {
        return this;
      }), t.exports = function(e, t, r) {
        e.prototype = n.create(s, {next: o(1, r)}), i(e, t + " Iterator");
      };
    }, {
      "./$": 60,
      "./$.hide": 47,
      "./$.property-desc": 65,
      "./$.set-to-string-tag": 71,
      "./$.wks": 82
    }],
    56: [function(e, t, r) {
      "use strict";
      var n = e("./$.library"),
          o = e("./$.export"),
          i = e("./$.redefine"),
          s = e("./$.hide"),
          a = e("./$.has"),
          u = e("./$.iterators"),
          c = e("./$.iter-create"),
          l = e("./$.set-to-string-tag"),
          f = e("./$").getProto,
          h = e("./$.wks")("iterator"),
          p = !([].keys && "next" in [].keys()),
          d = "@@iterator",
          y = "keys",
          b = "values",
          v = function() {
            return this;
          };
      t.exports = function(e, t, r, m, g, _, O) {
        c(r, t, m);
        var j,
            E,
            w = function(e) {
              if (!p && e in R)
                return R[e];
              switch (e) {
                case y:
                  return function() {
                    return new r(this, e);
                  };
                case b:
                  return function() {
                    return new r(this, e);
                  };
              }
              return function() {
                return new r(this, e);
              };
            },
            k = t + " Iterator",
            $ = g == b,
            P = !1,
            R = e.prototype,
            S = R[h] || R[d] || g && R[g],
            M = S || w(g);
        if (S) {
          var T = f(M.call(new e));
          l(T, k, !0), !n && a(R, d) && s(T, h, v), $ && S.name !== b && (P = !0, M = function() {
            return S.call(this);
          });
        }
        if (n && !O || !p && !P && R[h] || s(R, h, M), u[t] = M, u[k] = v, g)
          if (j = {
            values: $ ? M : w(b),
            keys: _ ? M : w(y),
            entries: $ ? w("entries") : M
          }, O)
            for (E in j)
              E in R || i(R, E, j[E]);
          else
            o(o.P + o.F * (p || P), t, j);
        return j;
      };
    }, {
      "./$": 60,
      "./$.export": 41,
      "./$.has": 46,
      "./$.hide": 47,
      "./$.iter-create": 55,
      "./$.iterators": 59,
      "./$.library": 62,
      "./$.redefine": 67,
      "./$.set-to-string-tag": 71,
      "./$.wks": 82
    }],
    57: [function(e, t, r) {
      var n = e("./$.wks")("iterator"),
          o = !1;
      try {
        var i = [7][n]();
        i["return"] = function() {
          o = !0;
        }, Array.from(i, function() {
          throw 2;
        });
      } catch (s) {}
      t.exports = function(e, t) {
        if (!t && !o)
          return !1;
        var r = !1;
        try {
          var i = [7],
              s = i[n]();
          s.next = function() {
            r = !0;
          }, i[n] = function() {
            return s;
          }, e(i);
        } catch (a) {}
        return r;
      };
    }, {"./$.wks": 82}],
    58: [function(e, t, r) {
      t.exports = function(e, t) {
        return {
          value: t,
          done: !!e
        };
      };
    }, {}],
    59: [function(e, t, r) {
      t.exports = {};
    }, {}],
    60: [function(e, t, r) {
      var n = Object;
      t.exports = {
        create: n.create,
        getProto: n.getPrototypeOf,
        isEnum: {}.propertyIsEnumerable,
        getDesc: n.getOwnPropertyDescriptor,
        setDesc: n.defineProperty,
        setDescs: n.defineProperties,
        getKeys: n.keys,
        getNames: n.getOwnPropertyNames,
        getSymbols: n.getOwnPropertySymbols,
        each: [].forEach
      };
    }, {}],
    61: [function(e, t, r) {
      var n = e("./$"),
          o = e("./$.to-iobject");
      t.exports = function(e, t) {
        for (var r,
            i = o(e),
            s = n.getKeys(i),
            a = s.length,
            u = 0; a > u; )
          if (i[r = s[u++]] === t)
            return r;
      };
    }, {
      "./$": 60,
      "./$.to-iobject": 78
    }],
    62: [function(e, t, r) {
      t.exports = !0;
    }, {}],
    63: [function(e, t, r) {
      var n,
          o,
          i,
          s = e("./$.global"),
          a = e("./$.task").set,
          u = s.MutationObserver || s.WebKitMutationObserver,
          c = s.process,
          l = s.Promise,
          f = "process" == e("./$.cof")(c),
          h = function() {
            var e,
                t,
                r;
            for (f && (e = c.domain) && (c.domain = null, e.exit()); n; )
              t = n.domain, r = n.fn, t && t.enter(), r(), t && t.exit(), n = n.next;
            o = void 0, e && e.enter();
          };
      if (f)
        i = function() {
          c.nextTick(h);
        };
      else if (u) {
        var p = 1,
            d = document.createTextNode("");
        new u(h).observe(d, {characterData: !0}), i = function() {
          d.data = p = -p;
        };
      } else
        i = l && l.resolve ? function() {
          l.resolve().then(h);
        } : function() {
          a.call(s, h);
        };
      t.exports = function(e) {
        var t = {
          fn: e,
          next: void 0,
          domain: f && c.domain
        };
        o && (o.next = t), n || (n = t, i()), o = t;
      };
    }, {
      "./$.cof": 34,
      "./$.global": 45,
      "./$.task": 76
    }],
    64: [function(e, t, r) {
      var n = e("./$.export"),
          o = e("./$.core"),
          i = e("./$.fails");
      t.exports = function(e, t) {
        var r = (o.Object || {})[e] || Object[e],
            s = {};
        s[e] = t(r), n(n.S + n.F * i(function() {
          r(1);
        }), "Object", s);
      };
    }, {
      "./$.core": 35,
      "./$.export": 41,
      "./$.fails": 42
    }],
    65: [function(e, t, r) {
      t.exports = function(e, t) {
        return {
          enumerable: !(1 & e),
          configurable: !(2 & e),
          writable: !(4 & e),
          value: t
        };
      };
    }, {}],
    66: [function(e, t, r) {
      var n = e("./$.redefine");
      t.exports = function(e, t) {
        for (var r in t)
          n(e, r, t[r]);
        return e;
      };
    }, {"./$.redefine": 67}],
    67: [function(e, t, r) {
      t.exports = e("./$.hide");
    }, {"./$.hide": 47}],
    68: [function(e, t, r) {
      t.exports = Object.is || function(e, t) {
        return e === t ? 0 !== e || 1 / e === 1 / t : e != e && t != t;
      };
    }, {}],
    69: [function(e, t, r) {
      var n = e("./$").getDesc,
          o = e("./$.is-object"),
          i = e("./$.an-object"),
          s = function(e, t) {
            if (i(e), !o(t) && null !== t)
              throw TypeError(t + ": can't set as prototype!");
          };
      t.exports = {
        set: Object.setPrototypeOf || ("__proto__" in {} ? function(t, r, o) {
          try {
            o = e("./$.ctx")(Function.call, n(Object.prototype, "__proto__").set, 2), o(t, []), r = !(t instanceof Array);
          } catch (i) {
            r = !0;
          }
          return function(e, t) {
            return s(e, t), r ? e.__proto__ = t : o(e, t), e;
          };
        }({}, !1) : void 0),
        check: s
      };
    }, {
      "./$": 60,
      "./$.an-object": 32,
      "./$.ctx": 36,
      "./$.is-object": 53
    }],
    70: [function(e, t, r) {
      "use strict";
      var n = e("./$.core"),
          o = e("./$"),
          i = e("./$.descriptors"),
          s = e("./$.wks")("species");
      t.exports = function(e) {
        var t = n[e];
        i && t && !t[s] && o.setDesc(t, s, {
          configurable: !0,
          get: function() {
            return this;
          }
        });
      };
    }, {
      "./$": 60,
      "./$.core": 35,
      "./$.descriptors": 38,
      "./$.wks": 82
    }],
    71: [function(e, t, r) {
      var n = e("./$").setDesc,
          o = e("./$.has"),
          i = e("./$.wks")("toStringTag");
      t.exports = function(e, t, r) {
        e && !o(e = r ? e : e.prototype, i) && n(e, i, {
          configurable: !0,
          value: t
        });
      };
    }, {
      "./$": 60,
      "./$.has": 46,
      "./$.wks": 82
    }],
    72: [function(e, t, r) {
      var n = e("./$.global"),
          o = "__core-js_shared__",
          i = n[o] || (n[o] = {});
      t.exports = function(e) {
        return i[e] || (i[e] = {});
      };
    }, {"./$.global": 45}],
    73: [function(e, t, r) {
      var n = e("./$.an-object"),
          o = e("./$.a-function"),
          i = e("./$.wks")("species");
      t.exports = function(e, t) {
        var r,
            s = n(e).constructor;
        return void 0 === s || void 0 == (r = n(s)[i]) ? t : o(r);
      };
    }, {
      "./$.a-function": 30,
      "./$.an-object": 32,
      "./$.wks": 82
    }],
    74: [function(e, t, r) {
      t.exports = function(e, t, r) {
        if (!(e instanceof t))
          throw TypeError(r + ": use the 'new' operator!");
        return e;
      };
    }, {}],
    75: [function(e, t, r) {
      var n = e("./$.to-integer"),
          o = e("./$.defined");
      t.exports = function(e) {
        return function(t, r) {
          var i,
              s,
              a = String(o(t)),
              u = n(r),
              c = a.length;
          return 0 > u || u >= c ? e ? "" : void 0 : (i = a.charCodeAt(u), 55296 > i || i > 56319 || u + 1 === c || (s = a.charCodeAt(u + 1)) < 56320 || s > 57343 ? e ? a.charAt(u) : i : e ? a.slice(u, u + 2) : (i - 55296 << 10) + (s - 56320) + 65536);
        };
      };
    }, {
      "./$.defined": 37,
      "./$.to-integer": 77
    }],
    76: [function(e, t, r) {
      var n,
          o,
          i,
          s = e("./$.ctx"),
          a = e("./$.invoke"),
          u = e("./$.html"),
          c = e("./$.dom-create"),
          l = e("./$.global"),
          f = l.process,
          h = l.setImmediate,
          p = l.clearImmediate,
          d = l.MessageChannel,
          y = 0,
          b = {},
          v = "onreadystatechange",
          m = function() {
            var e = +this;
            if (b.hasOwnProperty(e)) {
              var t = b[e];
              delete b[e], t();
            }
          },
          g = function(e) {
            m.call(e.data);
          };
      h && p || (h = function(e) {
        for (var t = [],
            r = 1; arguments.length > r; )
          t.push(arguments[r++]);
        return b[++y] = function() {
          a("function" == typeof e ? e : Function(e), t);
        }, n(y), y;
      }, p = function(e) {
        delete b[e];
      }, "process" == e("./$.cof")(f) ? n = function(e) {
        f.nextTick(s(m, e, 1));
      } : d ? (o = new d, i = o.port2, o.port1.onmessage = g, n = s(i.postMessage, i, 1)) : l.addEventListener && "function" == typeof postMessage && !l.importScripts ? (n = function(e) {
        l.postMessage(e + "", "*");
      }, l.addEventListener("message", g, !1)) : n = v in c("script") ? function(e) {
        u.appendChild(c("script"))[v] = function() {
          u.removeChild(this), m.call(e);
        };
      } : function(e) {
        setTimeout(s(m, e, 1), 0);
      }), t.exports = {
        set: h,
        clear: p
      };
    }, {
      "./$.cof": 34,
      "./$.ctx": 36,
      "./$.dom-create": 39,
      "./$.global": 45,
      "./$.html": 48,
      "./$.invoke": 49
    }],
    77: [function(e, t, r) {
      var n = Math.ceil,
          o = Math.floor;
      t.exports = function(e) {
        return isNaN(e = +e) ? 0 : (e > 0 ? o : n)(e);
      };
    }, {}],
    78: [function(e, t, r) {
      var n = e("./$.iobject"),
          o = e("./$.defined");
      t.exports = function(e) {
        return n(o(e));
      };
    }, {
      "./$.defined": 37,
      "./$.iobject": 50
    }],
    79: [function(e, t, r) {
      var n = e("./$.to-integer"),
          o = Math.min;
      t.exports = function(e) {
        return e > 0 ? o(n(e), 9007199254740991) : 0;
      };
    }, {"./$.to-integer": 77}],
    80: [function(e, t, r) {
      var n = e("./$.defined");
      t.exports = function(e) {
        return Object(n(e));
      };
    }, {"./$.defined": 37}],
    81: [function(e, t, r) {
      var n = 0,
          o = Math.random();
      t.exports = function(e) {
        return "Symbol(".concat(void 0 === e ? "" : e, ")_", (++n + o).toString(36));
      };
    }, {}],
    82: [function(e, t, r) {
      var n = e("./$.shared")("wks"),
          o = e("./$.uid"),
          i = e("./$.global").Symbol;
      t.exports = function(e) {
        return n[e] || (n[e] = i && i[e] || (i || o)("Symbol." + e));
      };
    }, {
      "./$.global": 45,
      "./$.shared": 72,
      "./$.uid": 81
    }],
    83: [function(e, t, r) {
      var n = e("./$.classof"),
          o = e("./$.wks")("iterator"),
          i = e("./$.iterators");
      t.exports = e("./$.core").getIteratorMethod = function(e) {
        return void 0 != e ? e[o] || e["@@iterator"] || i[n(e)] : void 0;
      };
    }, {
      "./$.classof": 33,
      "./$.core": 35,
      "./$.iterators": 59,
      "./$.wks": 82
    }],
    84: [function(e, t, r) {
      "use strict";
      var n = e("./$.add-to-unscopables"),
          o = e("./$.iter-step"),
          i = e("./$.iterators"),
          s = e("./$.to-iobject");
      t.exports = e("./$.iter-define")(Array, "Array", function(e, t) {
        this._t = s(e), this._i = 0, this._k = t;
      }, function() {
        var e = this._t,
            t = this._k,
            r = this._i++;
        return !e || r >= e.length ? (this._t = void 0, o(1)) : "keys" == t ? o(0, r) : "values" == t ? o(0, e[r]) : o(0, [r, e[r]]);
      }, "values"), i.Arguments = i.Array, n("keys"), n("values"), n("entries");
    }, {
      "./$.add-to-unscopables": 31,
      "./$.iter-define": 56,
      "./$.iter-step": 58,
      "./$.iterators": 59,
      "./$.to-iobject": 78
    }],
    85: [function(e, t, r) {
      var n = e("./$.is-object");
      e("./$.object-sap")("freeze", function(e) {
        return function(t) {
          return e && n(t) ? e(t) : t;
        };
      });
    }, {
      "./$.is-object": 53,
      "./$.object-sap": 64
    }],
    86: [function(e, t, r) {
      var n = e("./$.to-iobject");
      e("./$.object-sap")("getOwnPropertyDescriptor", function(e) {
        return function(t, r) {
          return e(n(t), r);
        };
      });
    }, {
      "./$.object-sap": 64,
      "./$.to-iobject": 78
    }],
    87: [function(e, t, r) {
      var n = e("./$.to-object");
      e("./$.object-sap")("getPrototypeOf", function(e) {
        return function(t) {
          return e(n(t));
        };
      });
    }, {
      "./$.object-sap": 64,
      "./$.to-object": 80
    }],
    88: [function(e, t, r) {
      var n = e("./$.to-object");
      e("./$.object-sap")("keys", function(e) {
        return function(t) {
          return e(n(t));
        };
      });
    }, {
      "./$.object-sap": 64,
      "./$.to-object": 80
    }],
    89: [function(e, t, r) {
      var n = e("./$.export");
      n(n.S, "Object", {setPrototypeOf: e("./$.set-proto").set});
    }, {
      "./$.export": 41,
      "./$.set-proto": 69
    }],
    90: [function(e, t, r) {}, {}],
    91: [function(e, t, r) {
      "use strict";
      var n,
          o = e("./$"),
          i = e("./$.library"),
          s = e("./$.global"),
          a = e("./$.ctx"),
          u = e("./$.classof"),
          c = e("./$.export"),
          l = e("./$.is-object"),
          f = e("./$.an-object"),
          h = e("./$.a-function"),
          p = e("./$.strict-new"),
          d = e("./$.for-of"),
          y = e("./$.set-proto").set,
          b = e("./$.same-value"),
          v = e("./$.wks")("species"),
          m = e("./$.species-constructor"),
          g = e("./$.microtask"),
          _ = "Promise",
          O = s.process,
          j = "process" == u(O),
          E = s[_],
          w = function(e) {
            var t = new E(function() {});
            return e && (t.constructor = Object), E.resolve(t) === t;
          },
          k = function() {
            function t(e) {
              var r = new E(e);
              return y(r, t.prototype), r;
            }
            var r = !1;
            try {
              if (r = E && E.resolve && w(), y(t, E), t.prototype = o.create(E.prototype, {constructor: {value: t}}), t.resolve(5).then(function() {}) instanceof t || (r = !1), r && e("./$.descriptors")) {
                var n = !1;
                E.resolve(o.setDesc({}, "then", {get: function() {
                    n = !0;
                  }})), r = n;
              }
            } catch (i) {
              r = !1;
            }
            return r;
          }(),
          $ = function(e, t) {
            return i && e === E && t === n ? !0 : b(e, t);
          },
          P = function(e) {
            var t = f(e)[v];
            return void 0 != t ? t : e;
          },
          R = function(e) {
            var t;
            return l(e) && "function" == typeof(t = e.then) ? t : !1;
          },
          S = function(e) {
            var t,
                r;
            this.promise = new e(function(e, n) {
              if (void 0 !== t || void 0 !== r)
                throw TypeError("Bad Promise constructor");
              t = e, r = n;
            }), this.resolve = h(t), this.reject = h(r);
          },
          M = function(e) {
            try {
              e();
            } catch (t) {
              return {error: t};
            }
          },
          T = function(e, t) {
            if (!e.n) {
              e.n = !0;
              var r = e.c;
              g(function() {
                for (var n = e.v,
                    o = 1 == e.s,
                    i = 0,
                    a = function(t) {
                      var r,
                          i,
                          s = o ? t.ok : t.fail,
                          a = t.resolve,
                          u = t.reject;
                      try {
                        s ? (o || (e.h = !0), r = s === !0 ? n : s(n), r === t.promise ? u(TypeError("Promise-chain cycle")) : (i = R(r)) ? i.call(r, a, u) : a(r)) : u(n);
                      } catch (c) {
                        u(c);
                      }
                    }; r.length > i; )
                  a(r[i++]);
                r.length = 0, e.n = !1, t && setTimeout(function() {
                  var t,
                      r,
                      o = e.p;
                  x(o) && (j ? O.emit("unhandledRejection", n, o) : (t = s.onunhandledrejection) ? t({
                    promise: o,
                    reason: n
                  }) : (r = s.console) && r.error && r.error("Unhandled promise rejection", n)), e.a = void 0;
                }, 1);
              });
            }
          },
          x = function(e) {
            var t,
                r = e._d,
                n = r.a || r.c,
                o = 0;
            if (r.h)
              return !1;
            for (; n.length > o; )
              if (t = n[o++], t.fail || !x(t.promise))
                return !1;
            return !0;
          },
          A = function(e) {
            var t = this;
            t.d || (t.d = !0, t = t.r || t, t.v = e, t.s = 2, t.a = t.c.slice(), T(t, !0));
          },
          N = function(e) {
            var t,
                r = this;
            if (!r.d) {
              r.d = !0, r = r.r || r;
              try {
                if (r.p === e)
                  throw TypeError("Promise can't be resolved itself");
                (t = R(e)) ? g(function() {
                  var n = {
                    r: r,
                    d: !1
                  };
                  try {
                    t.call(e, a(N, n, 1), a(A, n, 1));
                  } catch (o) {
                    A.call(n, o);
                  }
                }) : (r.v = e, r.s = 1, T(r, !1));
              } catch (n) {
                A.call({
                  r: r,
                  d: !1
                }, n);
              }
            }
          };
      k || (E = function(e) {
        h(e);
        var t = this._d = {
          p: p(this, E, _),
          c: [],
          a: void 0,
          s: 0,
          d: !1,
          v: void 0,
          h: !1,
          n: !1
        };
        try {
          e(a(N, t, 1), a(A, t, 1));
        } catch (r) {
          A.call(t, r);
        }
      }, e("./$.redefine-all")(E.prototype, {
        then: function(e, t) {
          var r = new S(m(this, E)),
              n = r.promise,
              o = this._d;
          return r.ok = "function" == typeof e ? e : !0, r.fail = "function" == typeof t && t, o.c.push(r), o.a && o.a.push(r), o.s && T(o, !1), n;
        },
        "catch": function(e) {
          return this.then(void 0, e);
        }
      })), c(c.G + c.W + c.F * !k, {Promise: E}), e("./$.set-to-string-tag")(E, _), e("./$.set-species")(_), n = e("./$.core")[_], c(c.S + c.F * !k, _, {reject: function(e) {
          var t = new S(this),
              r = t.reject;
          return r(e), t.promise;
        }}), c(c.S + c.F * (!k || w(!0)), _, {resolve: function(e) {
          if (e instanceof E && $(e.constructor, this))
            return e;
          var t = new S(this),
              r = t.resolve;
          return r(e), t.promise;
        }}), c(c.S + c.F * !(k && e("./$.iter-detect")(function(e) {
        E.all(e)["catch"](function() {});
      })), _, {
        all: function(e) {
          var t = P(this),
              r = new S(t),
              n = r.resolve,
              i = r.reject,
              s = [],
              a = M(function() {
                d(e, !1, s.push, s);
                var r = s.length,
                    a = Array(r);
                r ? o.each.call(s, function(e, o) {
                  var s = !1;
                  t.resolve(e).then(function(e) {
                    s || (s = !0, a[o] = e, --r || n(a));
                  }, i);
                }) : n(a);
              });
          return a && i(a.error), r.promise;
        },
        race: function(e) {
          var t = P(this),
              r = new S(t),
              n = r.reject,
              o = M(function() {
                d(e, !1, function(e) {
                  t.resolve(e).then(r.resolve, n);
                });
              });
          return o && n(o.error), r.promise;
        }
      });
    }, {
      "./$": 60,
      "./$.a-function": 30,
      "./$.an-object": 32,
      "./$.classof": 33,
      "./$.core": 35,
      "./$.ctx": 36,
      "./$.descriptors": 38,
      "./$.export": 41,
      "./$.for-of": 43,
      "./$.global": 45,
      "./$.is-object": 53,
      "./$.iter-detect": 57,
      "./$.library": 62,
      "./$.microtask": 63,
      "./$.redefine-all": 66,
      "./$.same-value": 68,
      "./$.set-proto": 69,
      "./$.set-species": 70,
      "./$.set-to-string-tag": 71,
      "./$.species-constructor": 73,
      "./$.strict-new": 74,
      "./$.wks": 82
    }],
    92: [function(e, t, r) {
      "use strict";
      var n = e("./$.string-at")(!0);
      e("./$.iter-define")(String, "String", function(e) {
        this._t = String(e), this._i = 0;
      }, function() {
        var e,
            t = this._t,
            r = this._i;
        return r >= t.length ? {
          value: void 0,
          done: !0
        } : (e = n(t, r), this._i += e.length, {
          value: e,
          done: !1
        });
      });
    }, {
      "./$.iter-define": 56,
      "./$.string-at": 75
    }],
    93: [function(e, t, r) {
      "use strict";
      var n = e("./$"),
          o = e("./$.global"),
          i = e("./$.has"),
          s = e("./$.descriptors"),
          a = e("./$.export"),
          u = e("./$.redefine"),
          c = e("./$.fails"),
          l = e("./$.shared"),
          f = e("./$.set-to-string-tag"),
          h = e("./$.uid"),
          p = e("./$.wks"),
          d = e("./$.keyof"),
          y = e("./$.get-names"),
          b = e("./$.enum-keys"),
          v = e("./$.is-array"),
          m = e("./$.an-object"),
          g = e("./$.to-iobject"),
          _ = e("./$.property-desc"),
          O = n.getDesc,
          j = n.setDesc,
          E = n.create,
          w = y.get,
          k = o.Symbol,
          $ = o.JSON,
          P = $ && $.stringify,
          R = !1,
          S = p("_hidden"),
          M = n.isEnum,
          T = l("symbol-registry"),
          x = l("symbols"),
          A = "function" == typeof k,
          N = Object.prototype,
          C = s && c(function() {
            return 7 != E(j({}, "a", {get: function() {
                return j(this, "a", {value: 7}).a;
              }})).a;
          }) ? function(e, t, r) {
            var n = O(N, t);
            n && delete N[t], j(e, t, r), n && e !== N && j(N, t, n);
          } : j,
          I = function(e) {
            var t = x[e] = E(k.prototype);
            return t._k = e, s && R && C(N, e, {
              configurable: !0,
              set: function(t) {
                i(this, S) && i(this[S], e) && (this[S][e] = !1), C(this, e, _(1, t));
              }
            }), t;
          },
          D = function(e) {
            return "symbol" == typeof e;
          },
          U = function(e, t, r) {
            return r && i(x, t) ? (r.enumerable ? (i(e, S) && e[S][t] && (e[S][t] = !1), r = E(r, {enumerable: _(0, !1)})) : (i(e, S) || j(e, S, _(1, {})), e[S][t] = !0), C(e, t, r)) : j(e, t, r);
          },
          L = function(e, t) {
            m(e);
            for (var r,
                n = b(t = g(t)),
                o = 0,
                i = n.length; i > o; )
              U(e, r = n[o++], t[r]);
            return e;
          },
          F = function(e, t) {
            return void 0 === t ? E(e) : L(E(e), t);
          },
          B = function(e) {
            var t = M.call(this, e);
            return t || !i(this, e) || !i(x, e) || i(this, S) && this[S][e] ? t : !0;
          },
          H = function(e, t) {
            var r = O(e = g(e), t);
            return !r || !i(x, t) || i(e, S) && e[S][t] || (r.enumerable = !0), r;
          },
          q = function(e) {
            for (var t,
                r = w(g(e)),
                n = [],
                o = 0; r.length > o; )
              i(x, t = r[o++]) || t == S || n.push(t);
            return n;
          },
          Y = function(e) {
            for (var t,
                r = w(g(e)),
                n = [],
                o = 0; r.length > o; )
              i(x, t = r[o++]) && n.push(x[t]);
            return n;
          },
          G = function(e) {
            if (void 0 !== e && !D(e)) {
              for (var t,
                  r,
                  n = [e],
                  o = 1,
                  i = arguments; i.length > o; )
                n.push(i[o++]);
              return t = n[1], "function" == typeof t && (r = t), (r || !v(t)) && (t = function(e, t) {
                return r && (t = r.call(this, e, t)), D(t) ? void 0 : t;
              }), n[1] = t, P.apply($, n);
            }
          },
          K = c(function() {
            var e = k();
            return "[null]" != P([e]) || "{}" != P({a: e}) || "{}" != P(Object(e));
          });
      A || (k = function() {
        if (D(this))
          throw TypeError("Symbol is not a constructor");
        return I(h(arguments.length > 0 ? arguments[0] : void 0));
      }, u(k.prototype, "toString", function() {
        return this._k;
      }), D = function(e) {
        return e instanceof k;
      }, n.create = F, n.isEnum = B, n.getDesc = H, n.setDesc = U, n.setDescs = L, n.getNames = y.get = q, n.getSymbols = Y, s && !e("./$.library") && u(N, "propertyIsEnumerable", B, !0));
      var V = {
        "for": function(e) {
          return i(T, e += "") ? T[e] : T[e] = k(e);
        },
        keyFor: function(e) {
          return d(T, e);
        },
        useSetter: function() {
          R = !0;
        },
        useSimple: function() {
          R = !1;
        }
      };
      n.each.call("hasInstance,isConcatSpreadable,iterator,match,replace,search,species,split,toPrimitive,toStringTag,unscopables".split(","), function(e) {
        var t = p(e);
        V[e] = A ? t : I(t);
      }), R = !0, a(a.G + a.W, {Symbol: k}), a(a.S, "Symbol", V), a(a.S + a.F * !A, "Object", {
        create: F,
        defineProperty: U,
        defineProperties: L,
        getOwnPropertyDescriptor: H,
        getOwnPropertyNames: q,
        getOwnPropertySymbols: Y
      }), $ && a(a.S + a.F * (!A || K), "JSON", {stringify: G}), f(k, "Symbol"), f(Math, "Math", !0), f(o.JSON, "JSON", !0);
    }, {
      "./$": 60,
      "./$.an-object": 32,
      "./$.descriptors": 38,
      "./$.enum-keys": 40,
      "./$.export": 41,
      "./$.fails": 42,
      "./$.get-names": 44,
      "./$.global": 45,
      "./$.has": 46,
      "./$.is-array": 52,
      "./$.keyof": 61,
      "./$.library": 62,
      "./$.property-desc": 65,
      "./$.redefine": 67,
      "./$.set-to-string-tag": 71,
      "./$.shared": 72,
      "./$.to-iobject": 78,
      "./$.uid": 81,
      "./$.wks": 82
    }],
    94: [function(e, t, r) {
      e("./es6.array.iterator");
      var n = e("./$.iterators");
      n.NodeList = n.HTMLCollection = n.Array;
    }, {
      "./$.iterators": 59,
      "./es6.array.iterator": 84
    }],
    95: [function(e, t, r) {
      (function(r) {
        var n = "object" == typeof r ? r : "object" == typeof window ? window : "object" == typeof self ? self : this,
            o = n.regeneratorRuntime && Object.getOwnPropertyNames(n).indexOf("regeneratorRuntime") >= 0,
            i = o && n.regeneratorRuntime;
        if (n.regeneratorRuntime = void 0, t.exports = e("./runtime"), o)
          n.regeneratorRuntime = i;
        else
          try {
            delete n.regeneratorRuntime;
          } catch (s) {
            n.regeneratorRuntime = void 0;
          }
        t.exports = {
          "default": t.exports,
          __esModule: !0
        };
      }).call(this, "undefined" != typeof global ? global : "undefined" != typeof self ? self : "undefined" != typeof window ? window : {});
    }, {"./runtime": 96}],
    96: [function(e, t, r) {
      (function(r, n) {
        "use strict";
        function o(e) {
          return e && e.__esModule ? e : {"default": e};
        }
        var i = e("../core-js/promise"),
            s = o(i),
            a = e("../core-js/object/set-prototype-of"),
            u = o(a),
            c = e("../core-js/object/create"),
            l = o(c),
            f = e("../helpers/typeof"),
            h = o(f),
            p = e("../core-js/symbol/iterator"),
            d = o(p),
            y = e("../core-js/symbol"),
            b = o(y);
        !function(e) {
          function n(e, t, r, n) {
            var o = (0, l["default"])((t || i).prototype),
                s = new _(n || []);
            return o._invoke = v(e, r, s), o;
          }
          function o(e, t, r) {
            try {
              return {
                type: "normal",
                arg: e.call(t, r)
              };
            } catch (n) {
              return {
                type: "throw",
                arg: n
              };
            }
          }
          function i() {}
          function a() {}
          function c() {}
          function f(e) {
            ["next", "throw", "return"].forEach(function(t) {
              e[t] = function(e) {
                return this._invoke(t, e);
              };
            });
          }
          function p(e) {
            this.arg = e;
          }
          function y(e) {
            function t(t, r) {
              var n = e[t](r),
                  o = n.value;
              return o instanceof p ? s["default"].resolve(o.arg).then(i, a) : s["default"].resolve(o).then(function(e) {
                return n.value = e, n;
              });
            }
            function n(e, r) {
              function n() {
                return t(e, r);
              }
              return o = o ? o.then(n, n) : new s["default"](function(e) {
                e(n());
              });
            }
            "object" === ("undefined" == typeof r ? "undefined" : (0, h["default"])(r)) && r.domain && (t = r.domain.bind(t));
            var o,
                i = t.bind(e, "next"),
                a = t.bind(e, "throw");
            t.bind(e, "return");
            this._invoke = n;
          }
          function v(e, t, r) {
            var n = R;
            return function(i, s) {
              if (n === M)
                throw new Error("Generator is already running");
              if (n === T) {
                if ("throw" === i)
                  throw s;
                return j();
              }
              for (; ; ) {
                var a = r.delegate;
                if (a) {
                  if ("return" === i || "throw" === i && a.iterator[i] === E) {
                    r.delegate = null;
                    var u = a.iterator["return"];
                    if (u) {
                      var c = o(u, a.iterator, s);
                      if ("throw" === c.type) {
                        i = "throw", s = c.arg;
                        continue;
                      }
                    }
                    if ("return" === i)
                      continue;
                  }
                  var c = o(a.iterator[i], a.iterator, s);
                  if ("throw" === c.type) {
                    r.delegate = null, i = "throw", s = c.arg;
                    continue;
                  }
                  i = "next", s = E;
                  var l = c.arg;
                  if (!l.done)
                    return n = S, l;
                  r[a.resultName] = l.value, r.next = a.nextLoc, r.delegate = null;
                }
                if ("next" === i)
                  r._sent = s, n === S ? r.sent = s : r.sent = E;
                else if ("throw" === i) {
                  if (n === R)
                    throw n = T, s;
                  r.dispatchException(s) && (i = "next", s = E);
                } else
                  "return" === i && r.abrupt("return", s);
                n = M;
                var c = o(e, t, r);
                if ("normal" === c.type) {
                  n = r.done ? T : S;
                  var l = {
                    value: c.arg,
                    done: r.done
                  };
                  if (c.arg !== x)
                    return l;
                  r.delegate && "next" === i && (s = E);
                } else
                  "throw" === c.type && (n = T, i = "throw", s = c.arg);
              }
            };
          }
          function m(e) {
            var t = {tryLoc: e[0]};
            1 in e && (t.catchLoc = e[1]), 2 in e && (t.finallyLoc = e[2], t.afterLoc = e[3]), this.tryEntries.push(t);
          }
          function g(e) {
            var t = e.completion || {};
            t.type = "normal", delete t.arg, e.completion = t;
          }
          function _(e) {
            this.tryEntries = [{tryLoc: "root"}], e.forEach(m, this), this.reset(!0);
          }
          function O(e) {
            if (e) {
              var t = e[k];
              if (t)
                return t.call(e);
              if ("function" == typeof e.next)
                return e;
              if (!isNaN(e.length)) {
                var r = -1,
                    n = function o() {
                      for (; ++r < e.length; )
                        if (w.call(e, r))
                          return o.value = e[r], o.done = !1, o;
                      return o.value = E, o.done = !0, o;
                    };
                return n.next = n;
              }
            }
            return {next: j};
          }
          function j() {
            return {
              value: E,
              done: !0
            };
          }
          var E,
              w = Object.prototype.hasOwnProperty,
              k = "function" == typeof b["default"] && d["default"] || "@@iterator",
              $ = "object" === ("undefined" == typeof t ? "undefined" : (0, h["default"])(t)),
              P = e.regeneratorRuntime;
          if (P)
            return void($ && (t.exports = P));
          P = e.regeneratorRuntime = $ ? t.exports : {}, P.wrap = n;
          var R = "suspendedStart",
              S = "suspendedYield",
              M = "executing",
              T = "completed",
              x = {},
              A = c.prototype = i.prototype;
          a.prototype = A.constructor = c, c.constructor = a, a.displayName = "GeneratorFunction", P.isGeneratorFunction = function(e) {
            var t = "function" == typeof e && e.constructor;
            return t ? t === a || "GeneratorFunction" === (t.displayName || t.name) : !1;
          }, P.mark = function(e) {
            return u["default"] ? (0, u["default"])(e, c) : e.__proto__ = c, e.prototype = (0, l["default"])(A), e;
          }, P.awrap = function(e) {
            return new p(e);
          }, f(y.prototype), P.async = function(e, t, r, o) {
            var i = new y(n(e, t, r, o));
            return P.isGeneratorFunction(t) ? i : i.next().then(function(e) {
              return e.done ? e.value : i.next();
            });
          }, f(A), A[k] = function() {
            return this;
          }, A.toString = function() {
            return "[object Generator]";
          }, P.keys = function(e) {
            var t = [];
            for (var r in e)
              t.push(r);
            return t.reverse(), function n() {
              for (; t.length; ) {
                var r = t.pop();
                if (r in e)
                  return n.value = r, n.done = !1, n;
              }
              return n.done = !0, n;
            };
          }, P.values = O, _.prototype = {
            constructor: _,
            reset: function(e) {
              if (this.prev = 0, this.next = 0, this.sent = E, this.done = !1, this.delegate = null, this.tryEntries.forEach(g), !e)
                for (var t in this)
                  "t" === t.charAt(0) && w.call(this, t) && !isNaN(+t.slice(1)) && (this[t] = E);
            },
            stop: function() {
              this.done = !0;
              var e = this.tryEntries[0],
                  t = e.completion;
              if ("throw" === t.type)
                throw t.arg;
              return this.rval;
            },
            dispatchException: function(e) {
              function t(t, n) {
                return i.type = "throw", i.arg = e, r.next = t, !!n;
              }
              if (this.done)
                throw e;
              for (var r = this,
                  n = this.tryEntries.length - 1; n >= 0; --n) {
                var o = this.tryEntries[n],
                    i = o.completion;
                if ("root" === o.tryLoc)
                  return t("end");
                if (o.tryLoc <= this.prev) {
                  var s = w.call(o, "catchLoc"),
                      a = w.call(o, "finallyLoc");
                  if (s && a) {
                    if (this.prev < o.catchLoc)
                      return t(o.catchLoc, !0);
                    if (this.prev < o.finallyLoc)
                      return t(o.finallyLoc);
                  } else if (s) {
                    if (this.prev < o.catchLoc)
                      return t(o.catchLoc, !0);
                  } else {
                    if (!a)
                      throw new Error("try statement without catch or finally");
                    if (this.prev < o.finallyLoc)
                      return t(o.finallyLoc);
                  }
                }
              }
            },
            abrupt: function(e, t) {
              for (var r = this.tryEntries.length - 1; r >= 0; --r) {
                var n = this.tryEntries[r];
                if (n.tryLoc <= this.prev && w.call(n, "finallyLoc") && this.prev < n.finallyLoc) {
                  var o = n;
                  break;
                }
              }
              o && ("break" === e || "continue" === e) && o.tryLoc <= t && t <= o.finallyLoc && (o = null);
              var i = o ? o.completion : {};
              return i.type = e, i.arg = t, o ? this.next = o.finallyLoc : this.complete(i), x;
            },
            complete: function(e, t) {
              if ("throw" === e.type)
                throw e.arg;
              "break" === e.type || "continue" === e.type ? this.next = e.arg : "return" === e.type ? (this.rval = e.arg, this.next = "end") : "normal" === e.type && t && (this.next = t);
            },
            finish: function(e) {
              for (var t = this.tryEntries.length - 1; t >= 0; --t) {
                var r = this.tryEntries[t];
                if (r.finallyLoc === e)
                  return this.complete(r.completion, r.afterLoc), g(r), x;
              }
            },
            "catch": function(e) {
              for (var t = this.tryEntries.length - 1; t >= 0; --t) {
                var r = this.tryEntries[t];
                if (r.tryLoc === e) {
                  var n = r.completion;
                  if ("throw" === n.type) {
                    var o = n.arg;
                    g(r);
                  }
                  return o;
                }
              }
              throw new Error("illegal catch attempt");
            },
            delegateYield: function(e, t, r) {
              return this.delegate = {
                iterator: O(e),
                resultName: t,
                nextLoc: r
              }, x;
            }
          };
        }("object" === ("undefined" == typeof n ? "undefined" : (0, h["default"])(n)) ? n : "object" === ("undefined" == typeof window ? "undefined" : (0, h["default"])(window)) ? window : "object" === ("undefined" == typeof self ? "undefined" : (0, h["default"])(self)) ? self : void 0);
      }).call(this, e("_process"), "undefined" != typeof global ? global : "undefined" != typeof self ? self : "undefined" != typeof window ? window : {});
    }, {
      "../core-js/object/create": 1,
      "../core-js/object/set-prototype-of": 7,
      "../core-js/promise": 8,
      "../core-js/symbol": 9,
      "../core-js/symbol/iterator": 10,
      "../helpers/typeof": 19,
      _process: 97
    }],
    97: [function(e, t, r) {
      function n() {
        l = !1, a.length ? c = a.concat(c) : f = -1, c.length && o();
      }
      function o() {
        if (!l) {
          var e = setTimeout(n);
          l = !0;
          for (var t = c.length; t; ) {
            for (a = c, c = []; ++f < t; )
              a && a[f].run();
            f = -1, t = c.length;
          }
          a = null, l = !1, clearTimeout(e);
        }
      }
      function i(e, t) {
        this.fun = e, this.array = t;
      }
      function s() {}
      var a,
          u = t.exports = {},
          c = [],
          l = !1,
          f = -1;
      u.nextTick = function(e) {
        var t = new Array(arguments.length - 1);
        if (arguments.length > 1)
          for (var r = 1; r < arguments.length; r++)
            t[r - 1] = arguments[r];
        c.push(new i(e, t)), 1 !== c.length || l || setTimeout(o, 0);
      }, i.prototype.run = function() {
        this.fun.apply(null, this.array);
      }, u.title = "browser", u.browser = !0, u.env = {}, u.argv = [], u.version = "", u.versions = {}, u.on = s, u.addListener = s, u.once = s, u.off = s, u.removeListener = s, u.removeAllListeners = s, u.emit = s, u.binding = function(e) {
        throw new Error("process.binding is not supported");
      }, u.cwd = function() {
        return "/";
      }, u.chdir = function(e) {
        throw new Error("process.chdir is not supported");
      }, u.umask = function() {
        return 0;
      };
    }, {}],
    98: [function(t, r, n) {
      !function(t, n) {
        "function" == typeof e && e.amd ? e([], n) : "undefined" != typeof r && r.exports ? r.exports = n() : t.tv4 = n();
      }(this, function() {
        function e(e) {
          return encodeURI(e).replace(/%25[0-9][0-9]/g, function(e) {
            return "%" + e.substring(3);
          });
        }
        function t(t) {
          var r = "";
          h[t.charAt(0)] && (r = t.charAt(0), t = t.substring(1));
          var n = "",
              o = "",
              i = !0,
              s = !1,
              a = !1;
          "+" === r ? i = !1 : "." === r ? (o = ".", n = ".") : "/" === r ? (o = "/", n = "/") : "#" === r ? (o = "#", i = !1) : ";" === r ? (o = ";", n = ";", s = !0, a = !0) : "?" === r ? (o = "?", n = "&", s = !0) : "&" === r && (o = "&", n = "&", s = !0);
          for (var u = [],
              c = t.split(","),
              l = [],
              f = {},
              d = 0; d < c.length; d++) {
            var y = c[d],
                b = null;
            if (-1 !== y.indexOf(":")) {
              var v = y.split(":");
              y = v[0], b = parseInt(v[1], 10);
            }
            for (var m = {}; p[y.charAt(y.length - 1)]; )
              m[y.charAt(y.length - 1)] = !0, y = y.substring(0, y.length - 1);
            var g = {
              truncate: b,
              name: y,
              suffices: m
            };
            l.push(g), f[y] = g, u.push(y);
          }
          var _ = function(t) {
            for (var r = "",
                u = 0,
                c = 0; c < l.length; c++) {
              var f = l[c],
                  h = t(f.name);
              if (null === h || void 0 === h || Array.isArray(h) && 0 === h.length || "object" == typeof h && 0 === Object.keys(h).length)
                u++;
              else if (r += c === u ? o : n || ",", Array.isArray(h)) {
                s && (r += f.name + "=");
                for (var p = 0; p < h.length; p++)
                  p > 0 && (r += f.suffices["*"] ? n || "," : ",", f.suffices["*"] && s && (r += f.name + "=")), r += i ? encodeURIComponent(h[p]).replace(/!/g, "%21") : e(h[p]);
              } else if ("object" == typeof h) {
                s && !f.suffices["*"] && (r += f.name + "=");
                var d = !0;
                for (var y in h)
                  d || (r += f.suffices["*"] ? n || "," : ","), d = !1, r += i ? encodeURIComponent(y).replace(/!/g, "%21") : e(y), r += f.suffices["*"] ? "=" : ",", r += i ? encodeURIComponent(h[y]).replace(/!/g, "%21") : e(h[y]);
              } else
                s && (r += f.name, a && "" === h || (r += "=")), null != f.truncate && (h = h.substring(0, f.truncate)), r += i ? encodeURIComponent(h).replace(/!/g, "%21") : e(h);
            }
            return r;
          };
          return _.varNames = u, {
            prefix: o,
            substitution: _
          };
        }
        function r(e) {
          if (!(this instanceof r))
            return new r(e);
          for (var n = e.split("{"),
              o = [n.shift()],
              i = [],
              s = [],
              a = []; n.length > 0; ) {
            var u = n.shift(),
                c = u.split("}")[0],
                l = u.substring(c.length + 1),
                f = t(c);
            s.push(f.substitution), i.push(f.prefix), o.push(l), a = a.concat(f.substitution.varNames);
          }
          this.fill = function(e) {
            for (var t = o[0],
                r = 0; r < s.length; r++) {
              var n = s[r];
              t += n(e), t += o[r + 1];
            }
            return t;
          }, this.varNames = a, this.template = e;
        }
        function n(e, t) {
          if (e === t)
            return !0;
          if (e && t && "object" == typeof e && "object" == typeof t) {
            if (Array.isArray(e) !== Array.isArray(t))
              return !1;
            if (Array.isArray(e)) {
              if (e.length !== t.length)
                return !1;
              for (var r = 0; r < e.length; r++)
                if (!n(e[r], t[r]))
                  return !1;
            } else {
              var o;
              for (o in e)
                if (void 0 === t[o] && void 0 !== e[o])
                  return !1;
              for (o in t)
                if (void 0 === e[o] && void 0 !== t[o])
                  return !1;
              for (o in e)
                if (!n(e[o], t[o]))
                  return !1;
            }
            return !0;
          }
          return !1;
        }
        function o(e) {
          var t = String(e).replace(/^\s+|\s+$/g, "").match(/^([^:\/?#]+:)?(\/\/(?:[^:@]*(?::[^:@]*)?@)?(([^:\/?#]*)(?::(\d*))?))?([^?#]*)(\?[^#]*)?(#[\s\S]*)?/);
          return t ? {
            href: t[0] || "",
            protocol: t[1] || "",
            authority: t[2] || "",
            host: t[3] || "",
            hostname: t[4] || "",
            port: t[5] || "",
            pathname: t[6] || "",
            search: t[7] || "",
            hash: t[8] || ""
          } : null;
        }
        function i(e, t) {
          function r(e) {
            var t = [];
            return e.replace(/^(\.\.?(\/|$))+/, "").replace(/\/(\.(\/|$))+/g, "/").replace(/\/\.\.$/, "/../").replace(/\/?[^\/]*/g, function(e) {
              "/.." === e ? t.pop() : t.push(e);
            }), t.join("").replace(/^\//, "/" === e.charAt(0) ? "/" : "");
          }
          return t = o(t || ""), e = o(e || ""), t && e ? (t.protocol || e.protocol) + (t.protocol || t.authority ? t.authority : e.authority) + r(t.protocol || t.authority || "/" === t.pathname.charAt(0) ? t.pathname : t.pathname ? (e.authority && !e.pathname ? "/" : "") + e.pathname.slice(0, e.pathname.lastIndexOf("/") + 1) + t.pathname : e.pathname) + (t.protocol || t.authority || t.pathname ? t.search : t.search || e.search) + t.hash : null;
        }
        function s(e) {
          return e.split("#")[0];
        }
        function a(e, t) {
          if (e && "object" == typeof e)
            if (void 0 === t ? t = e.id : "string" == typeof e.id && (t = i(t, e.id), e.id = t), Array.isArray(e))
              for (var r = 0; r < e.length; r++)
                a(e[r], t);
            else {
              "string" == typeof e.$ref && (e.$ref = i(t, e.$ref));
              for (var n in e)
                "enum" !== n && a(e[n], t);
            }
        }
        function u(e) {
          e = e || "en";
          var t = O[e];
          return function(e) {
            var r = t[e.code] || _[e.code];
            if ("string" != typeof r)
              return "Unknown error code " + e.code + ": " + JSON.stringify(e.messageParams);
            var n = e.params;
            return r.replace(/\{([^{}]*)\}/g, function(e, t) {
              var r = n[t];
              return "string" == typeof r || "number" == typeof r ? r : e;
            });
          };
        }
        function c(e, t, r, n, o) {
          if (Error.call(this), void 0 === e)
            throw new Error("No error code supplied: " + n);
          this.message = "", this.params = t, this.code = e, this.dataPath = r || "", this.schemaPath = n || "", this.subErrors = o || null;
          var i = new Error(this.message);
          if (this.stack = i.stack || i.stacktrace, !this.stack)
            try {
              throw i;
            } catch (i) {
              this.stack = i.stack || i.stacktrace;
            }
        }
        function l(e, t) {
          if (t.substring(0, e.length) === e) {
            var r = t.substring(e.length);
            if (t.length > 0 && "/" === t.charAt(e.length - 1) || "#" === r.charAt(0) || "?" === r.charAt(0))
              return !0;
          }
          return !1;
        }
        function f(e) {
          var t,
              r,
              n = new d,
              o = {
                setErrorReporter: function(e) {
                  return "string" == typeof e ? this.language(e) : (r = e, !0);
                },
                addFormat: function() {
                  n.addFormat.apply(n, arguments);
                },
                language: function(e) {
                  return e ? (O[e] || (e = e.split("-")[0]), O[e] ? (t = e, e) : !1) : t;
                },
                addLanguage: function(e, t) {
                  var r;
                  for (r in v)
                    t[r] && !t[v[r]] && (t[v[r]] = t[r]);
                  var n = e.split("-")[0];
                  if (O[n]) {
                    O[e] = Object.create(O[n]);
                    for (r in t)
                      "undefined" == typeof O[n][r] && (O[n][r] = t[r]), O[e][r] = t[r];
                  } else
                    O[e] = t, O[n] = t;
                  return this;
                },
                freshApi: function(e) {
                  var t = f();
                  return e && t.language(e), t;
                },
                validate: function(e, o, i, s) {
                  var a = u(t),
                      c = r ? function(e, t, n) {
                        return r(e, t, n) || a(e, t, n);
                      } : a,
                      l = new d(n, !1, c, i, s);
                  "string" == typeof o && (o = {$ref: o}), l.addSchema("", o);
                  var f = l.validateAll(e, o, null, null, "");
                  return !f && s && (f = l.banUnknownProperties(e, o)), this.error = f, this.missing = l.missing, this.valid = null === f, this.valid;
                },
                validateResult: function() {
                  var e = {};
                  return this.validate.apply(e, arguments), e;
                },
                validateMultiple: function(e, o, i, s) {
                  var a = u(t),
                      c = r ? function(e, t, n) {
                        return r(e, t, n) || a(e, t, n);
                      } : a,
                      l = new d(n, !0, c, i, s);
                  "string" == typeof o && (o = {$ref: o}), l.addSchema("", o), l.validateAll(e, o, null, null, ""), s && l.banUnknownProperties(e, o);
                  var f = {};
                  return f.errors = l.errors, f.missing = l.missing, f.valid = 0 === f.errors.length, f;
                },
                addSchema: function() {
                  return n.addSchema.apply(n, arguments);
                },
                getSchema: function() {
                  return n.getSchema.apply(n, arguments);
                },
                getSchemaMap: function() {
                  return n.getSchemaMap.apply(n, arguments);
                },
                getSchemaUris: function() {
                  return n.getSchemaUris.apply(n, arguments);
                },
                getMissingUris: function() {
                  return n.getMissingUris.apply(n, arguments);
                },
                dropSchemas: function() {
                  n.dropSchemas.apply(n, arguments);
                },
                defineKeyword: function() {
                  n.defineKeyword.apply(n, arguments);
                },
                defineError: function(e, t, r) {
                  if ("string" != typeof e || !/^[A-Z]+(_[A-Z]+)*$/.test(e))
                    throw new Error("Code name must be a string in UPPER_CASE_WITH_UNDERSCORES");
                  if ("number" != typeof t || t % 1 !== 0 || 1e4 > t)
                    throw new Error("Code number must be an integer > 10000");
                  if ("undefined" != typeof v[e])
                    throw new Error("Error already defined: " + e + " as " + v[e]);
                  if ("undefined" != typeof m[t])
                    throw new Error("Error code already used: " + m[t] + " as " + t);
                  v[e] = t, m[t] = e, _[e] = _[t] = r;
                  for (var n in O) {
                    var o = O[n];
                    o[e] && (o[t] = o[t] || o[e]);
                  }
                },
                reset: function() {
                  n.reset(), this.error = null, this.missing = [], this.valid = !0;
                },
                missing: [],
                error: null,
                valid: !0,
                normSchema: a,
                resolveUrl: i,
                getDocumentUri: s,
                errorCodes: v
              };
          return o.language(e || "en"), o;
        }
        Object.keys || (Object.keys = function() {
          var e = Object.prototype.hasOwnProperty,
              t = !{toString: null}.propertyIsEnumerable("toString"),
              r = ["toString", "toLocaleString", "valueOf", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "constructor"],
              n = r.length;
          return function(o) {
            if ("object" != typeof o && "function" != typeof o || null === o)
              throw new TypeError("Object.keys called on non-object");
            var i = [];
            for (var s in o)
              e.call(o, s) && i.push(s);
            if (t)
              for (var a = 0; n > a; a++)
                e.call(o, r[a]) && i.push(r[a]);
            return i;
          };
        }()), Object.create || (Object.create = function() {
          function e() {}
          return function(t) {
            if (1 !== arguments.length)
              throw new Error("Object.create implementation only accepts one parameter.");
            return e.prototype = t, new e;
          };
        }()), Array.isArray || (Array.isArray = function(e) {
          return "[object Array]" === Object.prototype.toString.call(e);
        }), Array.prototype.indexOf || (Array.prototype.indexOf = function(e) {
          if (null === this)
            throw new TypeError;
          var t = Object(this),
              r = t.length >>> 0;
          if (0 === r)
            return -1;
          var n = 0;
          if (arguments.length > 1 && (n = Number(arguments[1]), n !== n ? n = 0 : 0 !== n && n !== 1 / 0 && n !== -(1 / 0) && (n = (n > 0 || -1) * Math.floor(Math.abs(n)))), n >= r)
            return -1;
          for (var o = n >= 0 ? n : Math.max(r - Math.abs(n), 0); r > o; o++)
            if (o in t && t[o] === e)
              return o;
          return -1;
        }), Object.isFrozen || (Object.isFrozen = function(e) {
          for (var t = "tv4_test_frozen_key"; e.hasOwnProperty(t); )
            t += Math.random();
          try {
            return e[t] = !0, delete e[t], !1;
          } catch (r) {
            return !0;
          }
        });
        var h = {
          "+": !0,
          "#": !0,
          ".": !0,
          "/": !0,
          ";": !0,
          "?": !0,
          "&": !0
        },
            p = {"*": !0};
        r.prototype = {
          toString: function() {
            return this.template;
          },
          fillFromObject: function(e) {
            return this.fill(function(t) {
              return e[t];
            });
          }
        };
        var d = function(e, t, r, n, o) {
          if (this.missing = [], this.missingMap = {}, this.formatValidators = e ? Object.create(e.formatValidators) : {}, this.schemas = e ? Object.create(e.schemas) : {}, this.collectMultiple = t, this.errors = [], this.handleError = t ? this.collectError : this.returnError, n && (this.checkRecursive = !0, this.scanned = [], this.scannedFrozen = [], this.scannedFrozenSchemas = [], this.scannedFrozenValidationErrors = [], this.validatedSchemasKey = "tv4_validation_id", this.validationErrorsKey = "tv4_validation_errors_id"), o && (this.trackUnknownProperties = !0, this.knownPropertyPaths = {}, this.unknownPropertyPaths = {}), this.errorReporter = r || u("en"), "string" == typeof this.errorReporter)
            throw new Error("debug");
          if (this.definedKeywords = {}, e)
            for (var i in e.definedKeywords)
              this.definedKeywords[i] = e.definedKeywords[i].slice(0);
        };
        d.prototype.defineKeyword = function(e, t) {
          this.definedKeywords[e] = this.definedKeywords[e] || [], this.definedKeywords[e].push(t);
        }, d.prototype.createError = function(e, t, r, n, o, i, s) {
          var a = new c(e, t, r, n, o);
          return a.message = this.errorReporter(a, i, s), a;
        }, d.prototype.returnError = function(e) {
          return e;
        }, d.prototype.collectError = function(e) {
          return e && this.errors.push(e), null;
        }, d.prototype.prefixErrors = function(e, t, r) {
          for (var n = e; n < this.errors.length; n++)
            this.errors[n] = this.errors[n].prefixWith(t, r);
          return this;
        }, d.prototype.banUnknownProperties = function(e, t) {
          for (var r in this.unknownPropertyPaths) {
            var n = this.createError(v.UNKNOWN_PROPERTY, {path: r}, r, "", null, e, t),
                o = this.handleError(n);
            if (o)
              return o;
          }
          return null;
        }, d.prototype.addFormat = function(e, t) {
          if ("object" == typeof e) {
            for (var r in e)
              this.addFormat(r, e[r]);
            return this;
          }
          this.formatValidators[e] = t;
        }, d.prototype.resolveRefs = function(e, t) {
          if (void 0 !== e.$ref) {
            if (t = t || {}, t[e.$ref])
              return this.createError(v.CIRCULAR_REFERENCE, {urls: Object.keys(t).join(", ")}, "", "", null, void 0, e);
            t[e.$ref] = !0, e = this.getSchema(e.$ref, t);
          }
          return e;
        }, d.prototype.getSchema = function(e, t) {
          var r;
          if (void 0 !== this.schemas[e])
            return r = this.schemas[e], this.resolveRefs(r, t);
          var n = e,
              o = "";
          if (-1 !== e.indexOf("#") && (o = e.substring(e.indexOf("#") + 1), n = e.substring(0, e.indexOf("#"))), "object" == typeof this.schemas[n]) {
            r = this.schemas[n];
            var i = decodeURIComponent(o);
            if ("" === i)
              return this.resolveRefs(r, t);
            if ("/" !== i.charAt(0))
              return;
            for (var s = i.split("/").slice(1),
                a = 0; a < s.length; a++) {
              var u = s[a].replace(/~1/g, "/").replace(/~0/g, "~");
              if (void 0 === r[u]) {
                r = void 0;
                break;
              }
              r = r[u];
            }
            if (void 0 !== r)
              return this.resolveRefs(r, t);
          }
          void 0 === this.missing[n] && (this.missing.push(n), this.missing[n] = n, this.missingMap[n] = n);
        }, d.prototype.searchSchemas = function(e, t) {
          if (Array.isArray(e))
            for (var r = 0; r < e.length; r++)
              this.searchSchemas(e[r], t);
          else if (e && "object" == typeof e) {
            "string" == typeof e.id && l(t, e.id) && void 0 === this.schemas[e.id] && (this.schemas[e.id] = e);
            for (var n in e)
              if ("enum" !== n)
                if ("object" == typeof e[n])
                  this.searchSchemas(e[n], t);
                else if ("$ref" === n) {
                  var o = s(e[n]);
                  o && void 0 === this.schemas[o] && void 0 === this.missingMap[o] && (this.missingMap[o] = o);
                }
          }
        }, d.prototype.addSchema = function(e, t) {
          if ("string" != typeof e || "undefined" == typeof t) {
            if ("object" != typeof e || "string" != typeof e.id)
              return;
            t = e, e = t.id;
          }
          e === s(e) + "#" && (e = s(e)), this.schemas[e] = t, delete this.missingMap[e], a(t, e), this.searchSchemas(t, e);
        }, d.prototype.getSchemaMap = function() {
          var e = {};
          for (var t in this.schemas)
            e[t] = this.schemas[t];
          return e;
        }, d.prototype.getSchemaUris = function(e) {
          var t = [];
          for (var r in this.schemas)
            (!e || e.test(r)) && t.push(r);
          return t;
        }, d.prototype.getMissingUris = function(e) {
          var t = [];
          for (var r in this.missingMap)
            (!e || e.test(r)) && t.push(r);
          return t;
        }, d.prototype.dropSchemas = function() {
          this.schemas = {}, this.reset();
        }, d.prototype.reset = function() {
          this.missing = [], this.missingMap = {}, this.errors = [];
        }, d.prototype.validateAll = function(e, t, r, n, o) {
          var i;
          if (t = this.resolveRefs(t), !t)
            return null;
          if (t instanceof c)
            return this.errors.push(t), t;
          var s,
              a = this.errors.length,
              u = null,
              l = null;
          if (this.checkRecursive && e && "object" == typeof e) {
            if (i = !this.scanned.length, e[this.validatedSchemasKey]) {
              var f = e[this.validatedSchemasKey].indexOf(t);
              if (-1 !== f)
                return this.errors = this.errors.concat(e[this.validationErrorsKey][f]), null;
            }
            if (Object.isFrozen(e) && (s = this.scannedFrozen.indexOf(e), -1 !== s)) {
              var h = this.scannedFrozenSchemas[s].indexOf(t);
              if (-1 !== h)
                return this.errors = this.errors.concat(this.scannedFrozenValidationErrors[s][h]), null;
            }
            if (this.scanned.push(e), Object.isFrozen(e))
              -1 === s && (s = this.scannedFrozen.length, this.scannedFrozen.push(e), this.scannedFrozenSchemas.push([])), u = this.scannedFrozenSchemas[s].length, this.scannedFrozenSchemas[s][u] = t, this.scannedFrozenValidationErrors[s][u] = [];
            else {
              if (!e[this.validatedSchemasKey])
                try {
                  Object.defineProperty(e, this.validatedSchemasKey, {
                    value: [],
                    configurable: !0
                  }), Object.defineProperty(e, this.validationErrorsKey, {
                    value: [],
                    configurable: !0
                  });
                } catch (p) {
                  e[this.validatedSchemasKey] = [], e[this.validationErrorsKey] = [];
                }
              l = e[this.validatedSchemasKey].length, e[this.validatedSchemasKey][l] = t, e[this.validationErrorsKey][l] = [];
            }
          }
          var d = this.errors.length,
              y = this.validateBasic(e, t, o) || this.validateNumeric(e, t, o) || this.validateString(e, t, o) || this.validateArray(e, t, o) || this.validateObject(e, t, o) || this.validateCombinations(e, t, o) || this.validateHypermedia(e, t, o) || this.validateFormat(e, t, o) || this.validateDefinedKeywords(e, t, o) || null;
          if (i) {
            for (; this.scanned.length; ) {
              var b = this.scanned.pop();
              delete b[this.validatedSchemasKey];
            }
            this.scannedFrozen = [], this.scannedFrozenSchemas = [];
          }
          if (y || d !== this.errors.length)
            for (; r && r.length || n && n.length; ) {
              var v = r && r.length ? "" + r.pop() : null,
                  m = n && n.length ? "" + n.pop() : null;
              y && (y = y.prefixWith(v, m)), this.prefixErrors(d, v, m);
            }
          return null !== u ? this.scannedFrozenValidationErrors[s][u] = this.errors.slice(a) : null !== l && (e[this.validationErrorsKey][l] = this.errors.slice(a)), this.handleError(y);
        }, d.prototype.validateFormat = function(e, t) {
          if ("string" != typeof t.format || !this.formatValidators[t.format])
            return null;
          var r = this.formatValidators[t.format].call(null, e, t);
          return "string" == typeof r || "number" == typeof r ? this.createError(v.FORMAT_CUSTOM, {message: r}, "", "/format", null, e, t) : r && "object" == typeof r ? this.createError(v.FORMAT_CUSTOM, {message: r.message || "?"}, r.dataPath || "", r.schemaPath || "/format", null, e, t) : null;
        }, d.prototype.validateDefinedKeywords = function(e, t, r) {
          for (var n in this.definedKeywords)
            if ("undefined" != typeof t[n])
              for (var o = this.definedKeywords[n],
                  i = 0; i < o.length; i++) {
                var s = o[i],
                    a = s(e, t[n], t, r);
                if ("string" == typeof a || "number" == typeof a)
                  return this.createError(v.KEYWORD_CUSTOM, {
                    key: n,
                    message: a
                  }, "", "", null, e, t).prefixWith(null, n);
                if (a && "object" == typeof a) {
                  var u = a.code;
                  if ("string" == typeof u) {
                    if (!v[u])
                      throw new Error("Undefined error code (use defineError): " + u);
                    u = v[u];
                  } else
                    "number" != typeof u && (u = v.KEYWORD_CUSTOM);
                  var c = "object" == typeof a.message ? a.message : {
                    key: n,
                    message: a.message || "?"
                  },
                      l = a.schemaPath || "/" + n.replace(/~/g, "~0").replace(/\//g, "~1");
                  return this.createError(u, c, a.dataPath || null, l, null, e, t);
                }
              }
          return null;
        }, d.prototype.validateBasic = function(e, t, r) {
          var n;
          return (n = this.validateType(e, t, r)) ? n.prefixWith(null, "type") : (n = this.validateEnum(e, t, r)) ? n.prefixWith(null, "type") : null;
        }, d.prototype.validateType = function(e, t) {
          if (void 0 === t.type)
            return null;
          var r = typeof e;
          null === e ? r = "null" : Array.isArray(e) && (r = "array");
          var n = t.type;
          Array.isArray(n) || (n = [n]);
          for (var o = 0; o < n.length; o++) {
            var i = n[o];
            if (i === r || "integer" === i && "number" === r && e % 1 === 0)
              return null;
          }
          return this.createError(v.INVALID_TYPE, {
            type: r,
            expected: n.join("/")
          }, "", "", null, e, t);
        }, d.prototype.validateEnum = function(e, t) {
          if (void 0 === t["enum"])
            return null;
          for (var r = 0; r < t["enum"].length; r++) {
            var o = t["enum"][r];
            if (n(e, o))
              return null;
          }
          return this.createError(v.ENUM_MISMATCH, {value: "undefined" != typeof JSON ? JSON.stringify(e) : e}, "", "", null, e, t);
        }, d.prototype.validateNumeric = function(e, t, r) {
          return this.validateMultipleOf(e, t, r) || this.validateMinMax(e, t, r) || this.validateNaN(e, t, r) || null;
        };
        var y = Math.pow(2, -51),
            b = 1 - y;
        d.prototype.validateMultipleOf = function(e, t) {
          var r = t.multipleOf || t.divisibleBy;
          if (void 0 === r)
            return null;
          if ("number" == typeof e) {
            var n = e / r % 1;
            if (n >= y && b > n)
              return this.createError(v.NUMBER_MULTIPLE_OF, {
                value: e,
                multipleOf: r
              }, "", "", null, e, t);
          }
          return null;
        }, d.prototype.validateMinMax = function(e, t) {
          if ("number" != typeof e)
            return null;
          if (void 0 !== t.minimum) {
            if (e < t.minimum)
              return this.createError(v.NUMBER_MINIMUM, {
                value: e,
                minimum: t.minimum
              }, "", "/minimum", null, e, t);
            if (t.exclusiveMinimum && e === t.minimum)
              return this.createError(v.NUMBER_MINIMUM_EXCLUSIVE, {
                value: e,
                minimum: t.minimum
              }, "", "/exclusiveMinimum", null, e, t);
          }
          if (void 0 !== t.maximum) {
            if (e > t.maximum)
              return this.createError(v.NUMBER_MAXIMUM, {
                value: e,
                maximum: t.maximum
              }, "", "/maximum", null, e, t);
            if (t.exclusiveMaximum && e === t.maximum)
              return this.createError(v.NUMBER_MAXIMUM_EXCLUSIVE, {
                value: e,
                maximum: t.maximum
              }, "", "/exclusiveMaximum", null, e, t);
          }
          return null;
        }, d.prototype.validateNaN = function(e, t) {
          return "number" != typeof e ? null : isNaN(e) === !0 || e === 1 / 0 || e === -(1 / 0) ? this.createError(v.NUMBER_NOT_A_NUMBER, {value: e}, "", "/type", null, e, t) : null;
        }, d.prototype.validateString = function(e, t, r) {
          return this.validateStringLength(e, t, r) || this.validateStringPattern(e, t, r) || null;
        }, d.prototype.validateStringLength = function(e, t) {
          return "string" != typeof e ? null : void 0 !== t.minLength && e.length < t.minLength ? this.createError(v.STRING_LENGTH_SHORT, {
            length: e.length,
            minimum: t.minLength
          }, "", "/minLength", null, e, t) : void 0 !== t.maxLength && e.length > t.maxLength ? this.createError(v.STRING_LENGTH_LONG, {
            length: e.length,
            maximum: t.maxLength
          }, "", "/maxLength", null, e, t) : null;
        }, d.prototype.validateStringPattern = function(e, t) {
          if ("string" != typeof e || "string" != typeof t.pattern && !(t.pattern instanceof RegExp))
            return null;
          var r;
          if (t.pattern instanceof RegExp)
            r = t.pattern;
          else {
            var n,
                o = "",
                i = t.pattern.match(/^\/(.+)\/([img]*)$/);
            i ? (n = i[1], o = i[2]) : n = t.pattern, r = new RegExp(n, o);
          }
          return r.test(e) ? null : this.createError(v.STRING_PATTERN, {pattern: t.pattern}, "", "/pattern", null, e, t);
        }, d.prototype.validateArray = function(e, t, r) {
          return Array.isArray(e) ? this.validateArrayLength(e, t, r) || this.validateArrayUniqueItems(e, t, r) || this.validateArrayItems(e, t, r) || null : null;
        }, d.prototype.validateArrayLength = function(e, t) {
          var r;
          return void 0 !== t.minItems && e.length < t.minItems && (r = this.createError(v.ARRAY_LENGTH_SHORT, {
            length: e.length,
            minimum: t.minItems
          }, "", "/minItems", null, e, t), this.handleError(r)) ? r : void 0 !== t.maxItems && e.length > t.maxItems && (r = this.createError(v.ARRAY_LENGTH_LONG, {
            length: e.length,
            maximum: t.maxItems
          }, "", "/maxItems", null, e, t), this.handleError(r)) ? r : null;
        }, d.prototype.validateArrayUniqueItems = function(e, t) {
          if (t.uniqueItems)
            for (var r = 0; r < e.length; r++)
              for (var o = r + 1; o < e.length; o++)
                if (n(e[r], e[o])) {
                  var i = this.createError(v.ARRAY_UNIQUE, {
                    match1: r,
                    match2: o
                  }, "", "/uniqueItems", null, e, t);
                  if (this.handleError(i))
                    return i;
                }
          return null;
        }, d.prototype.validateArrayItems = function(e, t, r) {
          if (void 0 === t.items)
            return null;
          var n,
              o;
          if (Array.isArray(t.items)) {
            for (o = 0; o < e.length; o++)
              if (o < t.items.length) {
                if (n = this.validateAll(e[o], t.items[o], [o], ["items", o], r + "/" + o))
                  return n;
              } else if (void 0 !== t.additionalItems)
                if ("boolean" == typeof t.additionalItems) {
                  if (!t.additionalItems && (n = this.createError(v.ARRAY_ADDITIONAL_ITEMS, {}, "/" + o, "/additionalItems", null, e, t), this.handleError(n)))
                    return n;
                } else if (n = this.validateAll(e[o], t.additionalItems, [o], ["additionalItems"], r + "/" + o))
                  return n;
          } else
            for (o = 0; o < e.length; o++)
              if (n = this.validateAll(e[o], t.items, [o], ["items"], r + "/" + o))
                return n;
          return null;
        }, d.prototype.validateObject = function(e, t, r) {
          return "object" != typeof e || null === e || Array.isArray(e) ? null : this.validateObjectMinMaxProperties(e, t, r) || this.validateObjectRequiredProperties(e, t, r) || this.validateObjectProperties(e, t, r) || this.validateObjectDependencies(e, t, r) || null;
        }, d.prototype.validateObjectMinMaxProperties = function(e, t) {
          var r,
              n = Object.keys(e);
          return void 0 !== t.minProperties && n.length < t.minProperties && (r = this.createError(v.OBJECT_PROPERTIES_MINIMUM, {
            propertyCount: n.length,
            minimum: t.minProperties
          }, "", "/minProperties", null, e, t), this.handleError(r)) ? r : void 0 !== t.maxProperties && n.length > t.maxProperties && (r = this.createError(v.OBJECT_PROPERTIES_MAXIMUM, {
            propertyCount: n.length,
            maximum: t.maxProperties
          }, "", "/maxProperties", null, e, t), this.handleError(r)) ? r : null;
        }, d.prototype.validateObjectRequiredProperties = function(e, t) {
          if (void 0 !== t.required)
            for (var r = 0; r < t.required.length; r++) {
              var n = t.required[r];
              if (void 0 === e[n]) {
                var o = this.createError(v.OBJECT_REQUIRED, {key: n}, "", "/required/" + r, null, e, t);
                if (this.handleError(o))
                  return o;
              }
            }
          return null;
        }, d.prototype.validateObjectProperties = function(e, t, r) {
          var n;
          for (var o in e) {
            var i = r + "/" + o.replace(/~/g, "~0").replace(/\//g, "~1"),
                s = !1;
            if (void 0 !== t.properties && void 0 !== t.properties[o] && (s = !0, n = this.validateAll(e[o], t.properties[o], [o], ["properties", o], i)))
              return n;
            if (void 0 !== t.patternProperties)
              for (var a in t.patternProperties) {
                var u = new RegExp(a);
                if (u.test(o) && (s = !0, n = this.validateAll(e[o], t.patternProperties[a], [o], ["patternProperties", a], i)))
                  return n;
              }
            if (s)
              this.trackUnknownProperties && (this.knownPropertyPaths[i] = !0, delete this.unknownPropertyPaths[i]);
            else if (void 0 !== t.additionalProperties) {
              if (this.trackUnknownProperties && (this.knownPropertyPaths[i] = !0, delete this.unknownPropertyPaths[i]), "boolean" == typeof t.additionalProperties) {
                if (!t.additionalProperties && (n = this.createError(v.OBJECT_ADDITIONAL_PROPERTIES, {key: o}, "", "/additionalProperties", null, e, t).prefixWith(o, null), this.handleError(n)))
                  return n;
              } else if (n = this.validateAll(e[o], t.additionalProperties, [o], ["additionalProperties"], i))
                return n;
            } else
              this.trackUnknownProperties && !this.knownPropertyPaths[i] && (this.unknownPropertyPaths[i] = !0);
          }
          return null;
        }, d.prototype.validateObjectDependencies = function(e, t, r) {
          var n;
          if (void 0 !== t.dependencies)
            for (var o in t.dependencies)
              if (void 0 !== e[o]) {
                var i = t.dependencies[o];
                if ("string" == typeof i) {
                  if (void 0 === e[i] && (n = this.createError(v.OBJECT_DEPENDENCY_KEY, {
                    key: o,
                    missing: i
                  }, "", "", null, e, t).prefixWith(null, o).prefixWith(null, "dependencies"), this.handleError(n)))
                    return n;
                } else if (Array.isArray(i))
                  for (var s = 0; s < i.length; s++) {
                    var a = i[s];
                    if (void 0 === e[a] && (n = this.createError(v.OBJECT_DEPENDENCY_KEY, {
                      key: o,
                      missing: a
                    }, "", "/" + s, null, e, t).prefixWith(null, o).prefixWith(null, "dependencies"), this.handleError(n)))
                      return n;
                  }
                else if (n = this.validateAll(e, i, [], ["dependencies", o], r))
                  return n;
              }
          return null;
        }, d.prototype.validateCombinations = function(e, t, r) {
          return this.validateAllOf(e, t, r) || this.validateAnyOf(e, t, r) || this.validateOneOf(e, t, r) || this.validateNot(e, t, r) || null;
        }, d.prototype.validateAllOf = function(e, t, r) {
          if (void 0 === t.allOf)
            return null;
          for (var n,
              o = 0; o < t.allOf.length; o++) {
            var i = t.allOf[o];
            if (n = this.validateAll(e, i, [], ["allOf", o], r))
              return n;
          }
          return null;
        }, d.prototype.validateAnyOf = function(e, t, r) {
          if (void 0 === t.anyOf)
            return null;
          var n,
              o,
              i = [],
              s = this.errors.length;
          this.trackUnknownProperties && (n = this.unknownPropertyPaths, o = this.knownPropertyPaths);
          for (var a = !0,
              u = 0; u < t.anyOf.length; u++) {
            this.trackUnknownProperties && (this.unknownPropertyPaths = {}, this.knownPropertyPaths = {});
            var c = t.anyOf[u],
                l = this.errors.length,
                f = this.validateAll(e, c, [], ["anyOf", u], r);
            if (null === f && l === this.errors.length) {
              if (this.errors = this.errors.slice(0, s), this.trackUnknownProperties) {
                for (var h in this.knownPropertyPaths)
                  o[h] = !0, delete n[h];
                for (var p in this.unknownPropertyPaths)
                  o[p] || (n[p] = !0);
                a = !1;
                continue;
              }
              return null;
            }
            f && i.push(f.prefixWith(null, "" + u).prefixWith(null, "anyOf"));
          }
          return this.trackUnknownProperties && (this.unknownPropertyPaths = n, this.knownPropertyPaths = o), a ? (i = i.concat(this.errors.slice(s)), this.errors = this.errors.slice(0, s), this.createError(v.ANY_OF_MISSING, {}, "", "/anyOf", i, e, t)) : void 0;
        }, d.prototype.validateOneOf = function(e, t, r) {
          if (void 0 === t.oneOf)
            return null;
          var n,
              o,
              i = null,
              s = [],
              a = this.errors.length;
          this.trackUnknownProperties && (n = this.unknownPropertyPaths, o = this.knownPropertyPaths);
          for (var u = 0; u < t.oneOf.length; u++) {
            this.trackUnknownProperties && (this.unknownPropertyPaths = {}, this.knownPropertyPaths = {});
            var c = t.oneOf[u],
                l = this.errors.length,
                f = this.validateAll(e, c, [], ["oneOf", u], r);
            if (null === f && l === this.errors.length) {
              if (null !== i)
                return this.errors = this.errors.slice(0, a), this.createError(v.ONE_OF_MULTIPLE, {
                  index1: i,
                  index2: u
                }, "", "/oneOf", null, e, t);
              if (i = u, this.trackUnknownProperties) {
                for (var h in this.knownPropertyPaths)
                  o[h] = !0, delete n[h];
                for (var p in this.unknownPropertyPaths)
                  o[p] || (n[p] = !0);
              }
            } else
              f && s.push(f);
          }
          return this.trackUnknownProperties && (this.unknownPropertyPaths = n, this.knownPropertyPaths = o), null === i ? (s = s.concat(this.errors.slice(a)), this.errors = this.errors.slice(0, a), this.createError(v.ONE_OF_MISSING, {}, "", "/oneOf", s, e, t)) : (this.errors = this.errors.slice(0, a), null);
        }, d.prototype.validateNot = function(e, t, r) {
          if (void 0 === t.not)
            return null;
          var n,
              o,
              i = this.errors.length;
          this.trackUnknownProperties && (n = this.unknownPropertyPaths, o = this.knownPropertyPaths, this.unknownPropertyPaths = {}, this.knownPropertyPaths = {});
          var s = this.validateAll(e, t.not, null, null, r),
              a = this.errors.slice(i);
          return this.errors = this.errors.slice(0, i), this.trackUnknownProperties && (this.unknownPropertyPaths = n, this.knownPropertyPaths = o), null === s && 0 === a.length ? this.createError(v.NOT_PASSED, {}, "", "/not", null, e, t) : null;
        }, d.prototype.validateHypermedia = function(e, t, n) {
          if (!t.links)
            return null;
          for (var o,
              i = 0; i < t.links.length; i++) {
            var s = t.links[i];
            if ("describedby" === s.rel) {
              for (var a = new r(s.href),
                  u = !0,
                  c = 0; c < a.varNames.length; c++)
                if (!(a.varNames[c] in e)) {
                  u = !1;
                  break;
                }
              if (u) {
                var l = a.fillFromObject(e),
                    f = {$ref: l};
                if (o = this.validateAll(e, f, [], ["links", i], n))
                  return o;
              }
            }
          }
        };
        var v = {
          INVALID_TYPE: 0,
          ENUM_MISMATCH: 1,
          ANY_OF_MISSING: 10,
          ONE_OF_MISSING: 11,
          ONE_OF_MULTIPLE: 12,
          NOT_PASSED: 13,
          NUMBER_MULTIPLE_OF: 100,
          NUMBER_MINIMUM: 101,
          NUMBER_MINIMUM_EXCLUSIVE: 102,
          NUMBER_MAXIMUM: 103,
          NUMBER_MAXIMUM_EXCLUSIVE: 104,
          NUMBER_NOT_A_NUMBER: 105,
          STRING_LENGTH_SHORT: 200,
          STRING_LENGTH_LONG: 201,
          STRING_PATTERN: 202,
          OBJECT_PROPERTIES_MINIMUM: 300,
          OBJECT_PROPERTIES_MAXIMUM: 301,
          OBJECT_REQUIRED: 302,
          OBJECT_ADDITIONAL_PROPERTIES: 303,
          OBJECT_DEPENDENCY_KEY: 304,
          ARRAY_LENGTH_SHORT: 400,
          ARRAY_LENGTH_LONG: 401,
          ARRAY_UNIQUE: 402,
          ARRAY_ADDITIONAL_ITEMS: 403,
          FORMAT_CUSTOM: 500,
          KEYWORD_CUSTOM: 501,
          CIRCULAR_REFERENCE: 600,
          UNKNOWN_PROPERTY: 1e3
        },
            m = {};
        for (var g in v)
          m[v[g]] = g;
        var _ = {
          INVALID_TYPE: "Invalid type: {type} (expected {expected})",
          ENUM_MISMATCH: "No enum match for: {value}",
          ANY_OF_MISSING: 'Data does not match any schemas from "anyOf"',
          ONE_OF_MISSING: 'Data does not match any schemas from "oneOf"',
          ONE_OF_MULTIPLE: 'Data is valid against more than one schema from "oneOf": indices {index1} and {index2}',
          NOT_PASSED: 'Data matches schema from "not"',
          NUMBER_MULTIPLE_OF: "Value {value} is not a multiple of {multipleOf}",
          NUMBER_MINIMUM: "Value {value} is less than minimum {minimum}",
          NUMBER_MINIMUM_EXCLUSIVE: "Value {value} is equal to exclusive minimum {minimum}",
          NUMBER_MAXIMUM: "Value {value} is greater than maximum {maximum}",
          NUMBER_MAXIMUM_EXCLUSIVE: "Value {value} is equal to exclusive maximum {maximum}",
          NUMBER_NOT_A_NUMBER: "Value {value} is not a valid number",
          STRING_LENGTH_SHORT: "String is too short ({length} chars), minimum {minimum}",
          STRING_LENGTH_LONG: "String is too long ({length} chars), maximum {maximum}",
          STRING_PATTERN: "String does not match pattern: {pattern}",
          OBJECT_PROPERTIES_MINIMUM: "Too few properties defined ({propertyCount}), minimum {minimum}",
          OBJECT_PROPERTIES_MAXIMUM: "Too many properties defined ({propertyCount}), maximum {maximum}",
          OBJECT_REQUIRED: "Missing required property: {key}",
          OBJECT_ADDITIONAL_PROPERTIES: "Additional properties not allowed",
          OBJECT_DEPENDENCY_KEY: "Dependency failed - key must exist: {missing} (due to key: {key})",
          ARRAY_LENGTH_SHORT: "Array is too short ({length}), minimum {minimum}",
          ARRAY_LENGTH_LONG: "Array is too long ({length}), maximum {maximum}",
          ARRAY_UNIQUE: "Array items are not unique (indices {match1} and {match2})",
          ARRAY_ADDITIONAL_ITEMS: "Additional items not allowed",
          FORMAT_CUSTOM: "Format validation failed ({message})",
          KEYWORD_CUSTOM: "Keyword failed: {key} ({message})",
          CIRCULAR_REFERENCE: "Circular $refs: {urls}",
          UNKNOWN_PROPERTY: "Unknown property (not in schema)"
        };
        c.prototype = Object.create(Error.prototype), c.prototype.constructor = c, c.prototype.name = "ValidationError", c.prototype.prefixWith = function(e, t) {
          if (null !== e && (e = e.replace(/~/g, "~0").replace(/\//g, "~1"), this.dataPath = "/" + e + this.dataPath), null !== t && (t = t.replace(/~/g, "~0").replace(/\//g, "~1"), this.schemaPath = "/" + t + this.schemaPath), null !== this.subErrors)
            for (var r = 0; r < this.subErrors.length; r++)
              this.subErrors[r].prefixWith(e, t);
          return this;
        };
        var O = {},
            j = f();
        return j.addLanguage("en-gb", _), j.tv4 = j, j;
      });
    }, {}],
    99: [function(e, t, r) {
      "use strict";
      var n = e("babel-runtime/helpers/create-class")["default"],
          o = e("babel-runtime/helpers/class-call-check")["default"];
      Object.defineProperty(r, "__esModule", {value: !0});
      var i = function() {
        function e(t, r, n, i, s, a) {
          o(this, e), this._guid = t, this._type = r, this._objectName = n, this._description = i, this._language = s, this._sourcePackageURL = a, this._signature = null, this._sourcePackage = null;
        }
        return n(e, [{
          key: "guid",
          get: function() {
            return this._guid;
          },
          set: function(e) {
            e && (this._guid = e);
          }
        }, {
          key: "type",
          get: function() {
            return this._type;
          },
          set: function(e) {
            e && (this._type = e);
          }
        }, {
          key: "objectName",
          get: function() {
            return this._objectName;
          },
          set: function(e) {
            e && (this._objectName = e);
          }
        }, {
          key: "description",
          get: function() {
            return this._description;
          },
          set: function(e) {
            e && (this._description = e);
          }
        }, {
          key: "language",
          get: function() {
            return this._language;
          },
          set: function(e) {
            e && (this._language = e);
          }
        }, {
          key: "signature",
          get: function() {
            return this._signature;
          },
          set: function(e) {
            e && (this._signature = e);
          }
        }, {
          key: "sourcePackage",
          get: function() {
            return this._sourcePackage;
          },
          set: function(e) {
            e && (this._sourcePackage = e);
          }
        }, {
          key: "sourcePackageURL",
          get: function() {
            return this._sourcePackageURL;
          },
          set: function(e) {
            e && (this._sourcePackageURL = e);
          }
        }]), e;
      }(),
          s = {
            HYPERTY: "hyperty",
            PROTOSTUB: "protostub",
            HYPERTY_RUNTIME: "hyperty_runtime",
            HYPERTY_INTERCEPTOR: "hyperty_inspector",
            HYPERTY_DATA_OBJECT: "hyperty_data_object",
            POLICY_ENFORCER: "policy_enforcer",
            DATA_SCHEMA: "data_schema"
          };
      r.CatalogueObjectType = s;
      var a = {
        JAVASCRIPT_ECMA6: "javascript_ecma6",
        JAVASCRIPT_ECMA5: "javascript_ecma5",
        JSON_SCHEMA_V4: "json_schema_v4",
        PYTHON: "python",
        TYPESCRIPT: "typescript"
      };
      r.DataObjectSourceLanguage = a, r["default"] = i;
    }, {
      "babel-runtime/helpers/class-call-check": 11,
      "babel-runtime/helpers/create-class": 13
    }],
    100: [function(e, t, r) {
      "use strict";
      var n = e("babel-runtime/helpers/get")["default"],
          o = e("babel-runtime/helpers/inherits")["default"],
          i = e("babel-runtime/helpers/create-class")["default"],
          s = e("babel-runtime/helpers/class-call-check")["default"],
          a = e("babel-runtime/helpers/interop-require-default")["default"];
      Object.defineProperty(r, "__esModule", {value: !0});
      var u = e("../reTHINKObject/RethinkObject"),
          c = a(u),
          l = e("./CatalogueDataObject"),
          f = a(l),
          h = e("./SourcePackage"),
          p = a(h),
          d = e("./HypertyDescriptor"),
          y = a(d),
          b = e("./ProtocolStubDescriptor"),
          v = a(b),
          m = e("./HypertyRuntimeDescriptor"),
          g = a(m),
          _ = e("./PolicyEnforcerDescriptor"),
          O = a(_),
          j = e("./DataObjectSchema"),
          E = a(j),
          w = function(e) {
            function t(e, r) {
              s(this, t), n(Object.getPrototypeOf(t.prototype), "constructor", this).call(this, e, r);
            }
            return o(t, e), i(t, [{
              key: "createCatalogueDataObject",
              value: function(e, t, r, n, o, i) {
                if ("undefined" == typeof e || "undefined" == typeof t || "undefined" == typeof r || "undefined" == typeof n || "undefined" == typeof o || "undefined" == typeof i)
                  throw new Error("Invalid parameters!");
                return new f["default"](e, t, r, n, o, i);
              }
            }, {
              key: "createHypertyDescriptorObject",
              value: function(e, t, r, n, o, i, s) {
                if ("undefined" == typeof e || "undefined" == typeof t || "undefined" == typeof r || "undefined" == typeof n || "undefined" == typeof o || "undefined" == typeof i || "undefined" == typeof s)
                  throw new Error("Invalid parameters!");
                return new y["default"](e, l.CatalogueObjectType.HYPERTY, t, r, n, o, i, s);
              }
            }, {
              key: "createProtoStubDescriptorObject",
              value: function(e, t, r, n, o, i, s, a) {
                if ("undefined" == typeof e || "undefined" == typeof t || "undefined" == typeof r || "undefined" == typeof n || "undefined" == typeof o || "undefined" == typeof i || "undefined" == typeof s || "undefined" == typeof a)
                  throw new Error("Invalid parameters!");
                return new v["default"](e, l.CatalogueObjectType.PROTOSTUB, t, r, n, o, i, s, a);
              }
            }, {
              key: "createHypertyRuntimeDescriptorObject",
              value: function(e, t, r, n, o, i, s, a) {
                if ("undefined" == typeof e || "undefined" == typeof t || "undefined" == typeof r || "undefined" == typeof n || "undefined" == typeof o || "undefined" == typeof i || "undefined" == typeof s || "undefined" == typeof a)
                  throw new Error("Invalid parameters!");
                return new g["default"](e, l.CatalogueObjectType.HYPERTY_RUNTIME, t, r, n, o, i, s, a);
              }
            }, {
              key: "createPolicyEnforcerDescriptorObject",
              value: function(e, t, r, n, o, i, s) {
                if ("undefined" == typeof e || "undefined" == typeof t || "undefined" == typeof r || "undefined" == typeof n || "undefined" == typeof o || "undefined" == typeof i || "undefined" == typeof s)
                  throw new Error("Invalid parameters!");
                return new O["default"](e, l.CatalogueObjectType.POLICY_ENFORCER, t, r, n, o, i, s);
              }
            }, {
              key: "createDataObjectSchema",
              value: function(e, t, r, n, o) {
                if ("undefined" == typeof e || "undefined" == typeof t || "undefined" == typeof r || "undefined" == typeof n || "undefined" == typeof o)
                  throw new Error("Invalid parameters!");
                return new E["default"](e, l.CatalogueObjectType.DATA_SCHEMA, t, r, n, o);
              }
            }, {
              key: "createSourcePackage",
              value: function(e, t) {
                if ("undefined" == typeof t || "undefined" == typeof e)
                  throw new Error("Invalid parameters!");
                return new p["default"](e, t);
              }
            }]), t;
          }(c["default"]);
      r["default"] = w, t.exports = r["default"];
    }, {
      "../reTHINKObject/RethinkObject": 110,
      "./CatalogueDataObject": 99,
      "./DataObjectSchema": 101,
      "./HypertyDescriptor": 102,
      "./HypertyRuntimeDescriptor": 103,
      "./PolicyEnforcerDescriptor": 104,
      "./ProtocolStubDescriptor": 105,
      "./SourcePackage": 106,
      "babel-runtime/helpers/class-call-check": 11,
      "babel-runtime/helpers/create-class": 13,
      "babel-runtime/helpers/get": 15,
      "babel-runtime/helpers/inherits": 16,
      "babel-runtime/helpers/interop-require-default": 17
    }],
    101: [function(e, t, r) {
      "use strict";
      var n = e("babel-runtime/helpers/get")["default"],
          o = e("babel-runtime/helpers/inherits")["default"],
          i = e("babel-runtime/helpers/class-call-check")["default"],
          s = e("babel-runtime/helpers/interop-require-default")["default"];
      Object.defineProperty(r, "__esModule", {value: !0});
      var a = e("./CatalogueDataObject"),
          u = s(a),
          c = function(e) {
            function t(e, r, o, s, a, u) {
              i(this, t), n(Object.getPrototypeOf(t.prototype), "constructor", this).call(this, e, r, o, s, a, u);
            }
            return o(t, e), t;
          }(u["default"]),
          l = function(e) {
            function t(e, r, o, s, a, u) {
              i(this, t), n(Object.getPrototypeOf(t.prototype), "constructor", this).call(this, e, r, o, s, a, u);
            }
            return o(t, e), t;
          }(c);
      r.MessageDataObjectSchema = l;
      var f = function(e) {
        function t(e, r, o, s, a, u, c) {
          i(this, t), n(Object.getPrototypeOf(t.prototype), "constructor", this).call(this, e, r, o, s, a, u), this._accessControlPolicy = c;
        }
        return o(t, e), t;
      }(c);
      r.HypertyDataObjectSchema = f;
      var h = function(e) {
        function t(e, r, o, s, a, u, c) {
          i(this, t), n(Object.getPrototypeOf(t.prototype), "constructor", this).call(this, e, r, o, s, a, u, c);
        }
        return o(t, e), t;
      }(f);
      r.CommunicationDataObjectSchema = h;
      var p = function(e) {
        function t(e, r, o, s, a, u, c) {
          i(this, t), n(Object.getPrototypeOf(t.prototype), "constructor", this).call(this, e, r, o, s, a, u, c);
        }
        return o(t, e), t;
      }(f);
      r.ConnectionDataObjectSchema = p;
      var d = function(e) {
        function t(e, r, o, s, a, u, c) {
          i(this, t), n(Object.getPrototypeOf(t.prototype), "constructor", this).call(this, e, r, o, s, a, u, c);
        }
        return o(t, e), t;
      }(f);
      r.IdentifyDataObjectSchema = d;
      var y = function(e) {
        function t(e, r, o, s, a, u, c) {
          i(this, t), n(Object.getPrototypeOf(t.prototype), "constructor", this).call(this, e, r, o, s, a, u, c);
        }
        return o(t, e), t;
      }(f);
      r.ContextDataObjectSchema = y, r["default"] = c;
    }, {
      "./CatalogueDataObject": 99,
      "babel-runtime/helpers/class-call-check": 11,
      "babel-runtime/helpers/get": 15,
      "babel-runtime/helpers/inherits": 16,
      "babel-runtime/helpers/interop-require-default": 17
    }],
    102: [function(e, t, r) {
      "use strict";
      var n = e("babel-runtime/helpers/get")["default"],
          o = e("babel-runtime/helpers/inherits")["default"],
          i = e("babel-runtime/helpers/create-class")["default"],
          s = e("babel-runtime/helpers/class-call-check")["default"],
          a = e("babel-runtime/helpers/interop-require-default")["default"];
      Object.defineProperty(r, "__esModule", {value: !0});
      var u = e("./CatalogueDataObject"),
          c = a(u),
          l = function(e) {
            function t(e, r, o, i, a, u, c, l) {
              s(this, t), n(Object.getPrototypeOf(t.prototype), "constructor", this).call(this, e, r, o, i, a, u), this._configuration = {}, this._constraints = {}, this._policies = {}, this._messageSchema = null, this._hypertyType = c, this._dataObjects = l;
            }
            return o(t, e), i(t, [{
              key: "hypertyType",
              get: function() {
                return this._hypertyType;
              },
              set: function(e) {
                e && (this._hypertyType = e);
              }
            }, {
              key: "dataObjects",
              get: function() {
                return this._dataObjects;
              },
              set: function(e) {
                e && (this._dataObjects = e);
              }
            }, {
              key: "configuration",
              get: function() {
                return this._configuration;
              },
              set: function(e) {
                e && (this._configuration = e);
              }
            }, {
              key: "constraints",
              get: function() {
                return this._constraints;
              },
              set: function(e) {
                e && (this._constraints = e);
              }
            }, {
              key: "messageSchema",
              get: function() {
                return this._messageSchema;
              },
              set: function(e) {
                e && (this._messageSchema = e);
              }
            }, {
              key: "policies",
              get: function() {
                return this._policies;
              },
              set: function(e) {
                e && (this._policies = e);
              }
            }]), t;
          }(c["default"]),
          f = {};
      r.RuntimeHypertyCapabilityType = f;
      var h = {
        COMMUNICATOR: "communicator",
        IDENTITY: "identity",
        CONTEXT: "context"
      };
      r.HypertyType = h, r["default"] = l;
    }, {
      "./CatalogueDataObject": 99,
      "babel-runtime/helpers/class-call-check": 11,
      "babel-runtime/helpers/create-class": 13,
      "babel-runtime/helpers/get": 15,
      "babel-runtime/helpers/inherits": 16,
      "babel-runtime/helpers/interop-require-default": 17
    }],
    103: [function(e, t, r) {
      "use strict";
      var n = e("babel-runtime/helpers/get")["default"],
          o = e("babel-runtime/helpers/inherits")["default"],
          i = e("babel-runtime/helpers/create-class")["default"],
          s = e("babel-runtime/helpers/class-call-check")["default"],
          a = e("babel-runtime/helpers/interop-require-default")["default"];
      Object.defineProperty(r, "__esModule", {value: !0});
      var u = e("./CatalogueDataObject"),
          c = a(u),
          l = function(e) {
            function t(e, r, o, i, a, u, c, l, f) {
              s(this, t), n(Object.getPrototypeOf(t.prototype), "constructor", this).call(this, e, r, o, i, a, u), this._runtimeType = c, l ? this._hypertyCapabilities = l : this._hypertyCapabilities = {}, f ? this._protocolCapabilities = f : this._protocolCapabilities = {};
            }
            return o(t, e), i(t, [{
              key: "runtimeType",
              get: function() {
                return this._runtimeType;
              },
              set: function(e) {
                e && (this._runtimeType = e);
              }
            }, {
              key: "hypertyCapabilities",
              get: function() {
                return this._hypertyCapabilities;
              },
              set: function(e) {
                e && (this._hypertyCapabilities = e);
              }
            }, {
              key: "protocolCapabilities",
              get: function() {
                return this._hypertyCapabilities;
              },
              set: function(e) {
                e && (this._protocolCapabilities = e);
              }
            }]), t;
          }(c["default"]),
          f = {
            BROWSER: "browser",
            STANDALONE: "standalone",
            SERVER: "server",
            GATEWAY: "gateway"
          };
      r.RuntimeType = f;
      var h = {
        MIC: "mic",
        CAMERA: "camera",
        SENSOR: "sensor",
        WEBRTC: "webrtc",
        ORTC: "ortc"
      };
      r.RuntimeHypertyCapabilityType = h;
      var p = {
        HTTP: "http",
        HTTPS: "https",
        WS: "ws",
        WSS: "wss",
        COAP: "coap",
        DATACHANEL: "datachannel"
      };
      r.RuntimeProtocolCapabilityType = p, r["default"] = l;
    }, {
      "./CatalogueDataObject": 99,
      "babel-runtime/helpers/class-call-check": 11,
      "babel-runtime/helpers/create-class": 13,
      "babel-runtime/helpers/get": 15,
      "babel-runtime/helpers/inherits": 16,
      "babel-runtime/helpers/interop-require-default": 17
    }],
    104: [function(e, t, r) {
      "use strict";
      var n = e("babel-runtime/helpers/get")["default"],
          o = e("babel-runtime/helpers/inherits")["default"],
          i = e("babel-runtime/helpers/create-class")["default"],
          s = e("babel-runtime/helpers/class-call-check")["default"],
          a = e("babel-runtime/helpers/interop-require-default")["default"];
      Object.defineProperty(r, "__esModule", {value: !0});
      var u = e("./CatalogueDataObject"),
          c = a(u),
          l = function(e) {
            function t(e, r, o, i, a, u, c, l) {
              s(this, t), n(Object.getPrototypeOf(t.prototype), "constructor", this).call(this, e, r, o, i, a, u), this._configuration = c, this._policies = l;
            }
            return o(t, e), i(t, [{
              key: "configuration",
              get: function() {
                return this._configuration;
              },
              set: function(e) {
                this._configuration = e;
              }
            }, {
              key: "policies",
              get: function() {
                return this._policies;
              },
              set: function(e) {
                this._policies = e;
              }
            }]), t;
          }(c["default"]);
      r["default"] = l, t.exports = r["default"];
    }, {
      "./CatalogueDataObject": 99,
      "babel-runtime/helpers/class-call-check": 11,
      "babel-runtime/helpers/create-class": 13,
      "babel-runtime/helpers/get": 15,
      "babel-runtime/helpers/inherits": 16,
      "babel-runtime/helpers/interop-require-default": 17
    }],
    105: [function(e, t, r) {
      "use strict";
      var n = e("babel-runtime/helpers/get")["default"],
          o = e("babel-runtime/helpers/inherits")["default"],
          i = e("babel-runtime/helpers/create-class")["default"],
          s = e("babel-runtime/helpers/class-call-check")["default"],
          a = e("babel-runtime/helpers/interop-require-default")["default"];
      Object.defineProperty(r, "__esModule", {value: !0});
      var u = e("./CatalogueDataObject"),
          c = a(u),
          l = e("./HypertyRuntimeDescriptor"),
          f = (a(l), function(e) {
            function t(e, r, o, i, a, u, c, l, f) {
              s(this, t), n(Object.getPrototypeOf(t.prototype), "constructor", this).call(this, e, r, o, i, a, u), this._messageSchemas = c, l ? this._configuration = l : this._configuration = {}, f ? this._constraints = f : this._constraints = {};
            }
            return o(t, e), i(t, [{
              key: "messageSchemas",
              get: function() {
                return this._messageSchemas;
              },
              set: function(e) {
                e && (this._messageSchemas = e);
              }
            }, {
              key: "constraints",
              get: function() {
                return this._constraints;
              },
              set: function(e) {
                e && (this._constraints = e);
              }
            }, {
              key: "configuration",
              get: function() {
                return this._configuration;
              },
              set: function(e) {
                e && (this._configuration = e);
              }
            }]), t;
          }(c["default"]));
      r["default"] = f, t.exports = r["default"];
    }, {
      "./CatalogueDataObject": 99,
      "./HypertyRuntimeDescriptor": 103,
      "babel-runtime/helpers/class-call-check": 11,
      "babel-runtime/helpers/create-class": 13,
      "babel-runtime/helpers/get": 15,
      "babel-runtime/helpers/inherits": 16,
      "babel-runtime/helpers/interop-require-default": 17
    }],
    106: [function(e, t, r) {
      "use strict";
      var n = e("babel-runtime/helpers/create-class")["default"],
          o = e("babel-runtime/helpers/class-call-check")["default"];
      Object.defineProperty(r, "__esModule", {value: !0});
      var i = function() {
        function e(t, r) {
          o(this, e), this._sourceCode = r, this._sourceCodeClassname = t, this._encoding = null, this._signature = null;
        }
        return n(e, [{
          key: "sourceCode",
          get: function() {
            return this._sourceCode;
          },
          set: function(e) {
            e && (this._sourceCode = e);
          }
        }, {
          key: "sourceCodeClassname",
          get: function() {
            return this._sourceCodeClassname;
          },
          set: function(e) {
            e && (this._sourceCodeClassname = e);
          }
        }, {
          key: "encoding",
          get: function() {
            return this._encoding;
          },
          set: function(e) {
            e && (this._encoding = e);
          }
        }, {
          key: "signature",
          get: function() {
            return this._signature;
          },
          set: function(e) {
            e && (this._signature = e);
          }
        }]), e;
      }();
      r["default"] = i, t.exports = r["default"];
    }, {
      "babel-runtime/helpers/class-call-check": 11,
      "babel-runtime/helpers/create-class": 13
    }],
    107: [function(e, t, r) {
      "use strict";
      var n = e("babel-runtime/helpers/create-class")["default"],
          o = e("babel-runtime/helpers/class-call-check")["default"];
      Object.defineProperty(r, "__esModule", {value: !0});
      var i = function() {
        function e(t, r, n, i, s) {
          o(this, e), this.id = t, this.from = r, this.to = n, this.type = i, this.body = s;
        }
        return n(e, [{
          key: "assertIdentity",
          value: function(e, t) {
            if (!e || !t)
              throw new Error("message, token to be removed, and assertedIdentity must be provided");
            var r = this.body;
            return r.idToken = null, r.assertedIdentity = t, this.body = r, this;
          }
        }, {
          key: "addIdToken",
          value: function(e) {
            if (!e)
              throw new Error("message, token to be added, must be provided");
            var t = this.body;
            return t.idToken = e, this.body = t, this;
          }
        }, {
          key: "addAccessToken",
          value: function(e) {
            if (!e)
              throw new Error("message, token to be added, must be provided");
            var t = this.body;
            return t.accessToken = e, this.body = t, this;
          }
        }]), e;
      }();
      r.Message = i;
      var s = {
        CREATE: "create",
        READ: "read",
        UPDATE: "update",
        DELETE: "delete",
        SUBSCRIBE: "subscribe",
        UNSUBSCRIBE: "unsubscribe",
        RESPONSE: "response",
        FORWARD: "forward"
      };
      r.MessageType = s, r["default"] = i;
    }, {
      "babel-runtime/helpers/class-call-check": 11,
      "babel-runtime/helpers/create-class": 13
    }],
    108: [function(e, t, r) {
      "use strict";
      function n(e) {
        var t = a(e).reduce(function(t, r) {
          return t[e[r]] = r, t;
        }, {});
        return u(a(e).reduce(function(t, r) {
          return t[r] = e[r], t;
        }, function(e) {
          return t[e];
        }));
      }
      var o = e("babel-runtime/helpers/class-call-check")["default"],
          i = e("babel-runtime/helpers/get")["default"],
          s = e("babel-runtime/helpers/inherits")["default"],
          a = e("babel-runtime/core-js/object/keys")["default"],
          u = e("babel-runtime/core-js/object/freeze")["default"];
      Object.defineProperty(r, "__esModule", {value: !0}), r.Enum = n;
      var c = function m(e, t, r, n, i) {
        o(this, m), this.idToken = e, this.accessToken = t, this.resource = r, this.schema = n, this.assertedIdentity = i;
      };
      r.MessageBody = c;
      var l = function(e) {
        function t(e, r, n, s, a, u, c) {
          if (o(this, t), !e)
            throw new Error("The value parameter is null");
          i(Object.getPrototypeOf(t.prototype), "constructor", this).call(this, n, s, a, u, c, u, c), this.value = e, r && (this.policy = r);
        }
        return s(t, e), t;
      }(c);
      r.CreateMessageBody = l;
      var f = function(e) {
        function t(e, r, n, s, a, u, c, l) {
          o(this, t), i(Object.getPrototypeOf(t.prototype), "constructor", this).call(this, e, r, n, s, a), u && (this.attribute = u), c && (this.criteriaSyntax = c), l && (this.criteria = l);
        }
        return s(t, e), t;
      }(c);
      r.ReadMessageBody = f;
      var h = function(e) {
        function t(e, r, n, s, a, u) {
          o(this, t), i(Object.getPrototypeOf(t.prototype), "constructor", this).call(this, e, r, n, s, a), u && (this.attribute = u);
        }
        return s(t, e), t;
      }(c);
      r.DeleteMessageBody = h;
      var p = function(e) {
        function t(e, r, n, s, a, u, c) {
          o(this, t), i(Object.getPrototypeOf(t.prototype), "constructor", this).call(this, e, r, n, s, a), this.attribute = u, this.value = c;
        }
        return s(t, e), t;
      }(c);
      r.UpdateMessageBody = p;
      var d = function(e) {
        function t(e, r, n, s, a, u) {
          o(this, t), i(Object.getPrototypeOf(t.prototype), "constructor", this).call(this, e, r, n, s, a), this.message = u;
        }
        return s(t, e), t;
      }(c);
      r.ForwardMessageBody = d;
      var y = function(e) {
        function t(e, r, n, s, a) {
          o(this, t), i(Object.getPrototypeOf(t.prototype), "constructor", this).call(this, e, r, n), s && (this.code = s, this.description = v[s]), a && (this.value = a);
        }
        return s(t, e), t;
      }(c);
      r.ResponseMessageBody = y;
      var b = n({
        100: "100",
        101: "101",
        200: "200",
        201: "201",
        202: "202",
        203: "203",
        204: "204",
        205: "205",
        206: "206",
        300: "300",
        301: "301",
        302: "302",
        303: "303",
        304: "304",
        305: "305",
        307: "307",
        400: "400",
        401: "401",
        402: "402",
        403: "403",
        404: "404",
        405: "405",
        406: "406",
        407: "407",
        408: "408",
        409: "409",
        410: "410",
        411: "411",
        412: "412",
        413: "413",
        414: "414",
        415: "415",
        416: "416",
        417: "417",
        426: "426",
        500: "500",
        501: "501",
        502: "502",
        503: "503",
        504: "504",
        505: "505"
      });
      r.RESPONSE_CODE = b;
      var v = n({
        100: "Continue",
        101: "Switching Protocols",
        200: "OK",
        201: "Created",
        202: "Accepted",
        203: "Non-Authoritative Information",
        204: "No Content",
        205: "Reset Content",
        206: "Partial Content",
        300: "Multiple Choices",
        301: "Moved Permanently",
        302: "Found",
        303: "See Other",
        304: "Not Modified",
        305: "Use Proxy",
        307: "Temporary Redirect",
        400: "Bad Request",
        401: "Unauthorized",
        402: "Payment Required",
        403: "Forbidden",
        404: "Not Found",
        405: "Method Not Allowed",
        406: "Not Acceptable",
        407: "Proxy Authentication Required",
        408: "Request Timeout",
        409: "Conflict",
        410: "Gone",
        411: "Length Required",
        412: "Precondition Failed",
        413: "Payload Too Large",
        414: "Request-URI Too Long",
        415: "Unsupported Media Type",
        416: "Range Not Satisfiable",
        417: "Expectation Failed",
        426: "Upgrade Required",
        500: "Internal Server Error",
        501: "Not Implemented",
        502: "Bad Gateway",
        503: "Service Unavailable",
        504: "Gateway Time-out",
        505: "HTTP Version Not Supported"
      });
      r.REASON_PHRASE = v, r["default"] = c;
    }, {
      "babel-runtime/core-js/object/freeze": 3,
      "babel-runtime/core-js/object/keys": 6,
      "babel-runtime/helpers/class-call-check": 11,
      "babel-runtime/helpers/get": 15,
      "babel-runtime/helpers/inherits": 16
    }],
    109: [function(e, t, r) {
      "use strict";
      var n = e("babel-runtime/helpers/get")["default"],
          o = e("babel-runtime/helpers/inherits")["default"],
          i = e("babel-runtime/helpers/create-class")["default"],
          s = e("babel-runtime/helpers/class-call-check")["default"],
          a = e("babel-runtime/regenerator")["default"],
          u = e("babel-runtime/helpers/interop-require-default")["default"];
      Object.defineProperty(r, "__esModule", {value: !0});
      var c = e("../reTHINKObject/RethinkObject.js"),
          l = u(c),
          f = e("./Message.js"),
          h = u(f),
          p = e("./MessageBody.js"),
          d = function(e) {
            function t(e, r) {
              s(this, t), n(Object.getPrototypeOf(t.prototype), "constructor", this).call(this, e, r), this.myGenerator = (new y).idMaker();
            }
            return o(t, e), i(t, [{
              key: "validate",
              value: function(e) {
                return n(Object.getPrototypeOf(t.prototype), "validate", this).call(this, e);
              }
            }, {
              key: "createCreateMessageRequest",
              value: function(e, t, r, n) {
                if (!e || !t || !r)
                  throw new Error("from, to, and value of object to be created MUST be specified");
                var o = this.myGenerator.next().value,
                    i = new p.CreateMessageBody(r, n, null, null, null, null, null),
                    s = new h["default"](o, e, t, f.MessageType.CREATE, i);
                return s;
              }
            }, {
              key: "createForwardMessageRequest",
              value: function(e, t, r) {
                if (!e || !t || !r)
                  throw new Error("from, to, and message to forward MUST be specified");
                var n = this.myGenerator.next().value,
                    o = new p.ForwardMessageBody(null, null, null, null, null, r),
                    i = new h["default"](n, e, t, f.MessageType.FORWARD, o);
                return i;
              }
            }, {
              key: "createDeleteMessageRequest",
              value: function(e, t, r, n) {
                if (!e || !t)
                  throw new Error("from and to parameters MUST be specified");
                var o = this.myGenerator.next().value,
                    i = new p.DeleteMessageBody(null, null, r, n, null, null),
                    s = new h["default"](o, e, t, f.MessageType.DELETE, i);
                return s;
              }
            }, {
              key: "createUpdateMessageRequest",
              value: function(e, t, r, n, o) {
                if (!e || !t || !r)
                  throw new Error("from, and to and value MUST be specified");
                var i = this.myGenerator.next().value,
                    s = new p.UpdateMessageBody(null, null, n, null, null, o, r),
                    a = new h["default"](i, e, t, f.MessageType.UPDATE, s);
                return a;
              }
            }, {
              key: "createReadMessageRequest",
              value: function(e, t, r, n) {
                if (!e || !t || !r)
                  throw new Error("from, to and the resource to read from MUST be specified");
                var o = this.myGenerator.next().value,
                    i = new p.ReadMessageBody(null, null, r, null, null, n, null, null),
                    s = new h["default"](o, e, t, f.MessageType.READ, i);
                return s;
              }
            }, {
              key: "createSubscribeMessageRequest",
              value: function(e, t, r) {
                if (!e || !t || !r)
                  throw new Error("from, to and the resource to subscribe to MUST be specified");
                var n = this.myGenerator.next().value,
                    o = new p.MessageBody(null, null, r, null, null),
                    i = new h["default"](n, e, t, f.MessageType.SUBSCRIBE, o);
                return i;
              }
            }, {
              key: "createUnsubscribeMessageRequest",
              value: function(e, t, r) {
                if (!e || !t || !r)
                  throw new Error("from, to and the resource to subscribe to MUST be specified");
                var n = this.myGenerator.next().value,
                    o = new p.MessageBody(null, null, r, null, null),
                    i = new h["default"](n, e, t, f.MessageType.UNSUBSCRIBE, o);
                return i;
              }
            }, {
              key: "createMessageResponse",
              value: function(e, t, r, n) {
                if (!t)
                  throw new Error("response Code MUST be specified");
                var o = new p.ResponseMessageBody(null, null, null, t, r, n);
                return new h["default"](e.id, e.to, e.from, f.MessageType.RESPONSE, o);
              }
            }, {
              key: "generateMessageResponse",
              value: function(e, t, r) {
                if (!e || !t)
                  throw new Error("message and response code MUST be specified");
                var n = e.body,
                    o = n.idToken,
                    i = n.accessToken,
                    s = n.resource,
                    a = new p.ResponseMessageBody(o, i, s, t, r),
                    u = this.myGenerator.next().value;
                return new h["default"](u, e.to, e.from, f.MessageType.RESPONSE, a);
              }
            }]), t;
          }(l["default"]),
          y = function() {
            function e() {
              s(this, e);
            }
            return i(e, [{
              key: "idMaker",
              value: a.mark(function t() {
                var e;
                return a.wrap(function(t) {
                  for (; ; )
                    switch (t.prev = t.next) {
                      case 0:
                        e = 1;
                      case 1:
                        if (!(1e5 > e)) {
                          t.next = 6;
                          break;
                        }
                        return t.next = 4, e++;
                      case 4:
                        t.next = 1;
                        break;
                      case 6:
                      case "end":
                        return t.stop();
                    }
                }, t, this);
              })
            }]), e;
          }();
      r.IdGenerator = y, r["default"] = d;
    }, {
      "../reTHINKObject/RethinkObject.js": 110,
      "./Message.js": 107,
      "./MessageBody.js": 108,
      "babel-runtime/helpers/class-call-check": 11,
      "babel-runtime/helpers/create-class": 13,
      "babel-runtime/helpers/get": 15,
      "babel-runtime/helpers/inherits": 16,
      "babel-runtime/helpers/interop-require-default": 17,
      "babel-runtime/regenerator": 95
    }],
    110: [function(e, t, r) {
      "use strict";
      var n = e("babel-runtime/helpers/create-class")["default"],
          o = e("babel-runtime/helpers/class-call-check")["default"],
          i = e("babel-runtime/helpers/interop-require-default")["default"];
      Object.defineProperty(r, "__esModule", {value: !0});
      var s = e("tv4"),
          a = i(s),
          u = function() {
            function e(t, r) {
              o(this, e);
              this.validation = t, this.schema = r;
            }
            return n(e, [{
              key: "validate",
              value: function(e) {
                return this.schema ? a["default"].validate(e, this.schema) : !1;
              }
            }]), e;
          }();
      r.RethinkObject = u, r["default"] = u;
    }, {
      "babel-runtime/helpers/class-call-check": 11,
      "babel-runtime/helpers/create-class": 13,
      "babel-runtime/helpers/interop-require-default": 17,
      tv4: 98
    }],
    111: [function(e, t, r) {
      "use strict";
      var n = e("babel-runtime/helpers/interop-require-default")["default"];
      Object.defineProperty(r, "__esModule", {value: !0});
      var o = e("./catalogue-factory/CatalogueDataObjectFactory"),
          i = n(o),
          s = e("./message-factory/MessageFactory"),
          a = n(s),
          u = e("./syncher/Syncher"),
          c = n(u),
          l = e("./syncher/DataObjectReporter"),
          f = n(l),
          h = e("./syncher/DataObjectObserver"),
          p = n(h),
          d = e("./catalogue-factory/HypertyDescriptor"),
          y = n(d),
          b = e("./catalogue-factory/ProtocolStubDescriptor"),
          v = n(b),
          m = e("./catalogue-factory/SourcePackage"),
          g = n(m);
      r.CatalogueFactory = i["default"], r.MessageFactory = a["default"], r.Syncher = c["default"], r.DataObjectReporter = f["default"], r.DataObjectObserver = p["default"], r.HypertyDescriptor = y["default"], r.ProtocolStubDescriptor = v["default"], r.SourcePackage = g["default"];
    }, {
      "./catalogue-factory/CatalogueDataObjectFactory": 100,
      "./catalogue-factory/HypertyDescriptor": 102,
      "./catalogue-factory/ProtocolStubDescriptor": 105,
      "./catalogue-factory/SourcePackage": 106,
      "./message-factory/MessageFactory": 109,
      "./syncher/DataObjectObserver": 114,
      "./syncher/DataObjectReporter": 115,
      "./syncher/Syncher": 118,
      "babel-runtime/helpers/interop-require-default": 17
    }],
    112: [function(e, t, r) {
      "use strict";
      var n = e("babel-runtime/helpers/create-class")["default"],
          o = e("babel-runtime/helpers/class-call-check")["default"],
          i = e("babel-runtime/core-js/object/keys")["default"],
          s = e("babel-runtime/core-js/promise")["default"],
          a = e("babel-runtime/helpers/interop-require-default")["default"];
      Object.defineProperty(r, "__esModule", {value: !0});
      var u = e("./SyncObject"),
          c = a(u),
          l = e("./DataObjectChild"),
          f = a(l),
          h = e("../utils/utils.js"),
          p = function() {
            function e(t, r, n, i, s, a) {
              o(this, e);
              var u = this;
              u._syncher = t, u._url = r, u._schema = n, u._status = i, u._syncObj = new c["default"](s), u._childrens = a, u._version = 0, u._childId = 0, u._childrenObjects = {}, u._childrenListeners = [], u._owner = t._owner, u._bus = t._bus;
            }
            return n(e, [{
              key: "_allocateListeners",
              value: function() {
                var e = this,
                    t = this,
                    r = t._url + "/children/";
                t._childrens && t._childrens.forEach(function(n) {
                  var o = r + n,
                      i = t._bus.addListener(o, function(r) {
                        if (console.log("DataObject-Children-RCV: ", r), r.from !== e._owner)
                          switch (r.type) {
                            case "create":
                              t._onChildrenCreate(r);
                              break;
                            case "delete":
                              console.log(r);
                              break;
                            default:
                              t._changeChildren(r);
                          }
                      });
                  t._childrenListeners.push(i);
                });
              }
            }, {
              key: "_releaseListeners",
              value: function() {
                var e = this;
                e._childrenListeners.forEach(function(e) {
                  e.remove();
                }), i(e._childrenObjects).forEach(function(t) {
                  e._childrenObjects[t]._releaseListeners();
                });
              }
            }, {
              key: "pause",
              value: function() {
                throw "Not implemented";
              }
            }, {
              key: "resume",
              value: function() {
                throw "Not implemented";
              }
            }, {
              key: "stop",
              value: function() {
                throw "Not implemented";
              }
            }, {
              key: "addChildren",
              value: function(e, t) {
                var r = this;
                r._childId++;
                var n = r._owner + "#" + r._childId,
                    o = r._url + "/children/" + e,
                    i = {
                      type: "create",
                      from: r._owner,
                      to: o,
                      body: {
                        resource: n,
                        value: t
                      }
                    };
                return new s(function(e) {
                  var s = r._bus.postMessage(i);
                  console.log("create-reporter-child( " + r._owner + " ): ", i);
                  var a = new f["default"](r, r._owner, n, s, t);
                  a.onChange(function(e) {
                    r._onChange(e, {
                      path: o,
                      childId: n
                    });
                  }), r._childrenObjects[n] = a, e(a);
                });
              }
            }, {
              key: "onAddChildren",
              value: function(e) {
                this._onAddChildrenHandler = e;
              }
            }, {
              key: "_onChildrenCreate",
              value: function(e) {
                var t = this,
                    r = e.body.resource;
                console.log("create-observer-child( " + t._owner + " ): ", e);
                var n = new f["default"](t, e.from, r, 0, e.body.value);
                t._childrenObjects[r] = n, setTimeout(function() {
                  t._bus.postMessage({
                    id: e.id,
                    type: "response",
                    from: e.to,
                    to: e.from,
                    body: {
                      code: 200,
                      source: t._owner
                    }
                  });
                });
                var o = {
                  type: e.type,
                  from: e.from,
                  url: e.to,
                  value: e.body.value,
                  childId: r
                };
                t._onAddChildrenHandler && (console.log("ADD-CHILDREN-EVENT: ", o), t._onAddChildrenHandler(o));
              }
            }, {
              key: "_onChange",
              value: function(e, t) {
                var r = this;
                if (r._version++, "on" === r._status) {
                  var n = {
                    type: "update",
                    from: r._url,
                    to: r._url + "/changes",
                    body: {
                      version: r._version,
                      attribute: e.field
                    }
                  };
                  e.oType === u.ObjectType.OBJECT ? e.cType !== u.ChangeType.REMOVE && (n.body.value = e.data) : (n.body.attributeType = e.oType, n.body.value = e.data, e.cType !== u.ChangeType.UPDATE && (n.body.operation = e.cType)), t && (n.to = t.path, n.body.resource = t.childId), r._bus.postMessage(n);
                }
              }
            }, {
              key: "_changeObject",
              value: function(e, t) {
                var r = this;
                if (r._version + 1 === t.body.version) {
                  r._version++;
                  var n = t.body.attribute,
                      o = (0, h.deepClone)(t.body.value),
                      i = e.findBefore(n);
                  if (t.body.attributeType === u.ObjectType.ARRAY)
                    if (t.body.operation === u.ChangeType.ADD) {
                      var s = i.obj,
                          a = i.last;
                      Array.prototype.splice.apply(s, [a, 0].concat(o));
                    } else if (t.body.operation === u.ChangeType.REMOVE) {
                      var s = i.obj,
                          a = i.last;
                      s.splice(a, o);
                    } else
                      i.obj[i.last] = o;
                  else
                    t.body.value ? i.obj[i.last] = o : delete i.obj[i.last];
                } else
                  console.log("UNSYNCHRONIZED VERSION: (data => " + r._version + ", msg => " + t.body.version + ")");
              }
            }, {
              key: "_changeChildren",
              value: function(e) {
                var t = this;
                console.log("Change children: ", t._owner, e);
                var r = e.body.resource,
                    n = t._childrenObjects[r];
                n ? t._changeObject(n._syncObj, e) : console.log("No children found for: ", r);
              }
            }, {
              key: "url",
              get: function() {
                return this._url;
              }
            }, {
              key: "schema",
              get: function() {
                return this._schema;
              }
            }, {
              key: "status",
              get: function() {
                return this._status;
              }
            }, {
              key: "data",
              get: function() {
                return this._syncObj.data;
              }
            }, {
              key: "children",
              get: function() {
                return this._childrenObjects;
              }
            }]), e;
          }();
      r["default"] = p, t.exports = r["default"];
    }, {
      "../utils/utils.js": 119,
      "./DataObjectChild": 113,
      "./SyncObject": 117,
      "babel-runtime/core-js/object/keys": 6,
      "babel-runtime/core-js/promise": 8,
      "babel-runtime/helpers/class-call-check": 11,
      "babel-runtime/helpers/create-class": 13,
      "babel-runtime/helpers/interop-require-default": 17
    }],
    113: [function(e, t, r) {
      "use strict";
      var n = e("babel-runtime/helpers/create-class")["default"],
          o = e("babel-runtime/helpers/class-call-check")["default"],
          i = e("babel-runtime/helpers/interop-require-default")["default"];
      Object.defineProperty(r, "__esModule", {value: !0});
      var s = e("./SyncObject"),
          a = i(s),
          u = function() {
            function e(t, r, n, i, s) {
              o(this, e);
              var u = this;
              u._parent = t, u._owner = r, u._childId = n, u._msgId = i, u._syncObj = new a["default"](s), u._bus = t._bus, u._allocateListeners();
            }
            return n(e, [{
              key: "_allocateListeners",
              value: function() {
                var e = this;
                e._listener = e._bus.addListener(e._owner, function(t) {
                  "response" === t.type && t.id === e._msgId && (console.log("DataObjectChild.onResponse:", t), e._onResponse(t));
                });
              }
            }, {
              key: "_releaseListeners",
              value: function() {
                var e = this;
                e._listener.remove();
              }
            }, {
              key: "delete",
              value: function() {
                var e = this;
                delete e._parent._children[e._childId], e._releaseListeners();
              }
            }, {
              key: "onChange",
              value: function(e) {
                this._syncObj.observe(function(t) {
                  e(t);
                });
              }
            }, {
              key: "onResponse",
              value: function(e) {
                this._onResponseHandler = e;
              }
            }, {
              key: "_onResponse",
              value: function(e) {
                var t = this,
                    r = {
                      type: e.type,
                      url: e.body.source,
                      code: e.body.code
                    };
                t._onResponseHandler && t._onResponseHandler(r);
              }
            }, {
              key: "childId",
              get: function() {
                return this._childId;
              }
            }, {
              key: "data",
              get: function() {
                return this._syncObj.data;
              }
            }]), e;
          }();
      r["default"] = u, t.exports = r["default"];
    }, {
      "./SyncObject": 117,
      "babel-runtime/helpers/class-call-check": 11,
      "babel-runtime/helpers/create-class": 13,
      "babel-runtime/helpers/interop-require-default": 17
    }],
    114: [function(e, t, r) {
      "use strict";
      var n = e("babel-runtime/helpers/get")["default"],
          o = e("babel-runtime/helpers/inherits")["default"],
          i = e("babel-runtime/helpers/create-class")["default"],
          s = e("babel-runtime/helpers/class-call-check")["default"],
          a = e("babel-runtime/core-js/object/keys")["default"],
          u = e("babel-runtime/helpers/interop-require-default")["default"];
      Object.defineProperty(r, "__esModule", {value: !0});
      var c = e("./DataObject"),
          l = u(c),
          f = {
            ANY: "any",
            START: "start",
            EXACT: "exact"
          },
          h = function(e) {
            function t(e, r, o, i, a, u, c) {
              s(this, t), n(Object.getPrototypeOf(t.prototype), "constructor", this).call(this, e, r, o, i, a, u);
              var l = this;
              l._version = c, l._filters = {}, l._syncObj.observe(function(e) {
                l._onFilter(e);
              }), l._allocateListeners();
            }
            return o(t, e), i(t, [{
              key: "_allocateListeners",
              value: function() {
                n(Object.getPrototypeOf(t.prototype), "_allocateListeners", this).call(this);
                var e = this;
                e._changeListener = e._bus.addListener(e._url + "/changes", function(t) {
                  console.log("DataObjectObserver-" + e._url + "-RCV: ", t), e._changeObject(e._syncObj, t);
                });
              }
            }, {
              key: "_releaseListeners",
              value: function() {
                n(Object.getPrototypeOf(t.prototype), "_releaseListeners", this).call(this);
                var e = this;
                e._changeListener.remove();
              }
            }, {
              key: "delete",
              value: function() {
                var e = this;
                e._releaseListeners(), delete e._syncher._observers[e._url];
              }
            }, {
              key: "unsubscribe",
              value: function() {
                var e = this,
                    t = {
                      type: "unsubscribe",
                      from: e._owner,
                      to: e._syncher._subURL,
                      body: {resource: e._url}
                    };
                e._bus.postMessage(t, function(t) {
                  console.log("DataObjectObserver-UNSUBSCRIBE: ", t), 200 === t.body.code && (e._releaseListeners(), delete e._syncher._observers[e._url]);
                });
              }
            }, {
              key: "onChange",
              value: function(e, t) {
                var r = e,
                    n = {
                      type: f.EXACT,
                      callback: t
                    },
                    o = e.indexOf("*");
                o === e.length - 1 && (0 === o ? n.type = f.ANY : (n.type = f.START, r = e.substr(0, e.length - 1))), this._filters[r] = n;
              }
            }, {
              key: "_onFilter",
              value: function(e) {
                var t = this;
                a(t._filters).forEach(function(r) {
                  var n = t._filters[r];
                  n.type === f.ANY ? n.callback(e) : n.type === f.START ? 0 === e.field.indexOf(r) && n.callback(e) : n.type === f.EXACT && e.field === r && n.callback(e);
                });
              }
            }]), t;
          }(l["default"]);
      r["default"] = h, t.exports = r["default"];
    }, {
      "./DataObject": 112,
      "babel-runtime/core-js/object/keys": 6,
      "babel-runtime/helpers/class-call-check": 11,
      "babel-runtime/helpers/create-class": 13,
      "babel-runtime/helpers/get": 15,
      "babel-runtime/helpers/inherits": 16,
      "babel-runtime/helpers/interop-require-default": 17
    }],
    115: [function(e, t, r) {
      "use strict";
      var n = e("babel-runtime/helpers/get")["default"],
          o = e("babel-runtime/helpers/inherits")["default"],
          i = e("babel-runtime/helpers/create-class")["default"],
          s = e("babel-runtime/helpers/class-call-check")["default"],
          a = e("babel-runtime/helpers/interop-require-default")["default"];
      Object.defineProperty(r, "__esModule", {value: !0});
      var u = e("./DataObject"),
          c = a(u),
          l = e("../utils/utils.js"),
          f = function(e) {
            function t(e, r, o, i, a, u) {
              s(this, t), n(Object.getPrototypeOf(t.prototype), "constructor", this).call(this, e, r, o, i, a, u);
              var c = this;
              c._subscriptions = {}, c._syncObj.observe(function(e) {
                console.log("DataObjectReporter-" + r + "-SEND: ", e), c._onChange(e);
              }), c._allocateListeners();
            }
            return o(t, e), i(t, [{
              key: "_allocateListeners",
              value: function() {
                n(Object.getPrototypeOf(t.prototype), "_allocateListeners", this).call(this);
                var e = this;
                e._responseListener = e._bus.addListener(e._url, function(t) {
                  "response" === t.type && e._onResponse(t);
                });
              }
            }, {
              key: "_releaseListeners",
              value: function() {
                n(Object.getPrototypeOf(t.prototype), "_releaseListeners", this).call(this);
                var e = this;
                e._responseListener.remove();
              }
            }, {
              key: "delete",
              value: function() {
                var e = this,
                    t = {
                      type: "delete",
                      from: e._owner,
                      to: e._syncher._subURL,
                      body: {resource: e._url}
                    };
                e._bus.postMessage(t, function(t) {
                  console.log("DataObjectReporter-DELETE: ", t), 200 === t.body.code && (e._releaseListeners(), delete e._syncher._reporters[e._url]);
                });
              }
            }, {
              key: "onSubscription",
              value: function(e) {
                this._onSubscriptionHandler = e;
              }
            }, {
              key: "onResponse",
              value: function(e) {
                this._onResponseHandler = e;
              }
            }, {
              key: "_onForward",
              value: function(e) {
                var t = this;
                switch (console.log("DataObjectReporter-RCV: ", e), e.body.type) {
                  case "subscribe":
                    t._onSubscribe(e);
                    break;
                  case "unsubscribe":
                    t._onUnSubscribe(e);
                }
              }
            }, {
              key: "_onSubscribe",
              value: function(e) {
                var t = this,
                    r = e.body.from,
                    n = {
                      type: e.body.type,
                      url: r,
                      accept: function() {
                        var n = {
                          url: r,
                          status: "on"
                        };
                        return t._subscriptions[r] = n, t._bus.postMessage({
                          id: e.id,
                          type: "response",
                          from: e.to,
                          to: e.from,
                          body: {
                            code: 200,
                            schema: t._schema,
                            version: t._version,
                            value: (0, l.deepClone)(t.data)
                          }
                        }), n;
                      },
                      reject: function(r) {
                        t._bus.postMessage({
                          id: e.id,
                          type: "response",
                          from: e.to,
                          to: e.from,
                          body: {
                            code: 403,
                            desc: r
                          }
                        });
                      }
                    };
                t._onSubscriptionHandler && (console.log("SUBSCRIPTION-EVENT: ", n), t._onSubscriptionHandler(n));
              }
            }, {
              key: "_onUnSubscribe",
              value: function(e) {
                var t = this,
                    r = e.body.from,
                    n = t._subscriptions[r];
                delete t._subscriptions[r];
                var o = {
                  type: e.body.type,
                  url: r,
                  object: n
                };
                t._onSubscriptionHandler && (console.log("UN-SUBSCRIPTION-EVENT: ", o), t._onSubscriptionHandler(o));
              }
            }, {
              key: "_onResponse",
              value: function(e) {
                var t = this,
                    r = {
                      type: e.type,
                      url: e.from,
                      code: e.body.code
                    };
                t._onResponseHandler && (console.log("RESPONSE-EVENT: ", r), t._onResponseHandler(r));
              }
            }, {
              key: "subscriptions",
              get: function() {
                return this._subscriptions;
              }
            }]), t;
          }(c["default"]);
      r["default"] = f, t.exports = r["default"];
    }, {
      "../utils/utils.js": 119,
      "./DataObject": 112,
      "babel-runtime/helpers/class-call-check": 11,
      "babel-runtime/helpers/create-class": 13,
      "babel-runtime/helpers/get": 15,
      "babel-runtime/helpers/inherits": 16,
      "babel-runtime/helpers/interop-require-default": 17
    }],
    116: [function(e, t, r) {
      "use strict";
      var n = e("babel-runtime/helpers/create-class")["default"],
          o = e("babel-runtime/helpers/class-call-check")["default"];
      Object.defineProperty(r, "__esModule", {value: !0});
      var i = function() {
        function e(t, r, n, i) {
          o(this, e);
          var s = this;
          s._owner = t, s._url = r, s._bus = n, s._children = i, s._changes = [], s._allocateListeners();
        }
        return n(e, [{
          key: "_allocateListeners",
          value: function() {
            var e = this;
            e._listener = e._bus.addListener(e._url, function(t) {
              console.log("DataProvisional-" + e._url + "-RCV: ", t), e._changes.push(t);
            });
          }
        }, {
          key: "_releaseListeners",
          value: function() {
            var e = this;
            e._listener.remove();
          }
        }, {
          key: "apply",
          value: function(e) {
            var t = this;
            t._changes.forEach(function(t) {
              e._changeObject(e._syncObj, t);
            });
          }
        }, {
          key: "children",
          get: function() {
            return this._children;
          }
        }]), e;
      }();
      r["default"] = i, t.exports = r["default"];
    }, {
      "babel-runtime/helpers/class-call-check": 11,
      "babel-runtime/helpers/create-class": 13
    }],
    117: [function(e, t, r) {
      "use strict";
      var n = e("babel-runtime/helpers/create-class")["default"],
          o = e("babel-runtime/helpers/class-call-check")["default"],
          i = e("babel-runtime/core-js/object/keys")["default"];
      Object.defineProperty(r, "__esModule", {value: !0});
      var s = e("../utils/utils.js"),
          a = function() {
            function e(t) {
              o(this, e);
              var r = this;
              r._observers = [], r._filters = {}, t ? r._data = (0, s.deepClone)(t) : r._data = {}, r._internalObserve(new u, r._data);
            }
            return n(e, [{
              key: "observe",
              value: function(e) {
                this._observers.push(e);
              }
            }, {
              key: "find",
              value: function(e) {
                var t = e.split(".");
                return this._findWithSplit(t);
              }
            }, {
              key: "findBefore",
              value: function(e) {
                var t = {},
                    r = e.split(".");
                return t.last = r.pop(), t.obj = this._findWithSplit(r), t;
              }
            }, {
              key: "_findWithSplit",
              value: function(e) {
                var t = this._data;
                return e.forEach(function(e) {
                  t = t[e];
                }), t;
              }
            }, {
              key: "_fireEvent",
              value: function(e) {
                this._observers.forEach(function(t) {
                  t(e);
                });
              }
            }, {
              key: "_isObservable",
              value: function(e) {
                return e.constructor === Object || e.constructor === Array ? !0 : !1;
              }
            }, {
              key: "_internalObserve",
              value: function(e, t) {
                var r = this;
                if (r._isObservable(t)) {
                  var n = function(t) {
                    r._onChanges(e, t);
                  };
                  if (t.constructor === Object) {
                    Object.observe(t, n);
                    for (var o in t)
                      r._isObservable(t[o]) && r._internalObserve(e["new"](o), t[o]);
                  } else if (t.constructor === Array) {
                    Array.observe(t, n);
                    for (var o in t)
                      if (r._isObservable(t[o])) {
                        var i = e["new"](new c(t[o], o));
                        r._internalObserve(i, t[o]);
                      }
                  }
                }
              }
            }, {
              key: "_onChanges",
              value: function(e, t) {
                var r = this;
                for (var n in t) {
                  var o = t[n].object,
                      i = void 0;
                  if (o.constructor === Object && (i = f.OBJECT), o.constructor === Array && (i = f.ARRAY), "splice" === t[n].type)
                    !function() {
                      var a = t[n].index,
                          u = e["new"]("" + a),
                          f = u.toString(),
                          h = t[n].removed.length;
                      if (0 !== h) {
                        var p = t[n].removed;
                        p.forEach(function(t, n) {
                          r._isObservable(t) && e.removeIndex(a + n);
                        }), r._fireEvent({
                          cType: l.REMOVE,
                          oType: i,
                          field: f,
                          data: h
                        });
                      }
                      var d = t[n].addedCount;
                      if (0 !== d) {
                        var y = o.slice(a, a + d);
                        y.forEach(function(t, n) {
                          if (r._isObservable(t)) {
                            var o = e["new"](new c(t, a + n));
                            r._internalObserve(o, t);
                          }
                        }), r._fireEvent({
                          cType: l.ADD,
                          oType: i,
                          field: f,
                          data: (0, s.deepClone)(y)
                        });
                      }
                      a !== o.length - 1 && e.reIndexFrom(o);
                    }();
                  else {
                    var a = e["new"](t[n].name),
                        u = a.toString();
                    if (-1 !== u.indexOf("Symbol"))
                      continue;
                    var h = o[t[n].name];
                    "update" === t[n].type && this._fireEvent({
                      cType: l.UPDATE,
                      oType: i,
                      field: u,
                      data: (0, s.deepClone)(h)
                    }), "add" === t[n].type && (this._internalObserve(a, h), this._fireEvent({
                      cType: l.ADD,
                      oType: i,
                      field: u,
                      data: (0, s.deepClone)(h)
                    })), "delete" === t[n].type && this._fireEvent({
                      cType: l.REMOVE,
                      oType: i,
                      field: u
                    });
                  }
                }
              }
            }, {
              key: "data",
              get: function() {
                return this._data;
              }
            }]), e;
          }(),
          u = function() {
            function e() {
              o(this, e), this._path = [], this._observables = {};
            }
            return n(e, [{
              key: "removeIndex",
              value: function(e) {
                delete this._observables[e];
              }
            }, {
              key: "reIndexFrom",
              value: function(e) {
                var t = this;
                i(this._observables).forEach(function(r) {
                  var n = t._observables[r],
                      o = e.indexOf(n.obj);
                  n.idx != o && (n.idx = o, delete t._observables[r], t._observables[o] = n);
                });
              }
            }, {
              key: "new",
              value: function(e) {
                e.constructor == c && (this._observables[e.idx] = e);
                var t = this.clone();
                return t._path.push(e), t;
              }
            }, {
              key: "clone",
              value: function() {
                var t = new e;
                return this._path.forEach(function(e) {
                  t._path.push(e);
                }), t;
              }
            }, {
              key: "toString",
              value: function() {
                var e = "";
                return this._path.forEach(function(t, r) {
                  0 === r ? e = t.toString() : e += "." + t.toString();
                }), e;
              }
            }]), e;
          }(),
          c = function() {
            function e(t, r) {
              o(this, e), this.obj = t, this.idx = r;
            }
            return n(e, [{
              key: "toString",
              value: function() {
                return this.idx.toString();
              }
            }]), e;
          }(),
          l = {
            UPDATE: "update",
            ADD: "add",
            REMOVE: "remove"
          };
      r.ChangeType = l;
      var f = {
        OBJECT: "object",
        ARRAY: "array"
      };
      r.ObjectType = f, r["default"] = a;
    }, {
      "../utils/utils.js": 119,
      "babel-runtime/core-js/object/keys": 6,
      "babel-runtime/helpers/class-call-check": 11,
      "babel-runtime/helpers/create-class": 13
    }],
    118: [function(e, t, r) {
      "use strict";
      var n = e("babel-runtime/helpers/create-class")["default"],
          o = e("babel-runtime/helpers/class-call-check")["default"],
          i = e("babel-runtime/core-js/promise")["default"],
          s = e("babel-runtime/helpers/interop-require-default")["default"];
      Object.defineProperty(r, "__esModule", {value: !0});
      var a = e("./DataObjectReporter"),
          u = s(a),
          c = e("./DataObjectObserver"),
          l = s(c),
          f = e("./DataProvisional"),
          h = s(f),
          p = function() {
            function e(t, r, n) {
              o(this, e);
              var i = this;
              i._owner = t, i._bus = r, i._subURL = n.runtimeURL + "/sm", i._reporters = {}, i._observers = {}, i._provisionals = {}, r.addListener(t, function(e) {
                switch (console.log("Syncher-RCV: ", e), e.type) {
                  case "forward":
                    i._onForward(e);
                    break;
                  case "create":
                    i._onRemoteCreate(e);
                    break;
                  case "delete":
                    i._onRemoteDelete(e);
                }
              });
            }
            return n(e, [{
              key: "create",
              value: function(e, t, r) {
                var n = this,
                    o = {
                      type: "create",
                      from: n._owner,
                      to: n._subURL,
                      body: {
                        schema: e,
                        value: r,
                        authorise: t
                      }
                    };
                return new i(function(t, i) {
                  n._bus.postMessage(o, function(o) {
                    if (console.log("create-response: ", o), 200 === o.body.code) {
                      var s = o.body.resource,
                          a = new u["default"](n, s, e, "on", r, o.body.childrenResources);
                      n._reporters[s] = a, t(a);
                    } else
                      i(o.body.desc);
                  });
                });
              }
            }, {
              key: "subscribe",
              value: function(e, t) {
                var r = this,
                    n = {
                      type: "subscribe",
                      from: r._owner,
                      to: r._subURL,
                      body: {
                        schema: e,
                        resource: t
                      }
                    };
                return new i(function(o, i) {
                  r._bus.postMessage(n, function(n) {
                    console.log("subscribe-response: ", n);
                    var s = r._provisionals[t];
                    if (delete r._provisionals[t], s && s._releaseListeners(), n.body.code < 200)
                      s = new h["default"](r._owner, t, r._bus, n.body.childrenResources), r._provisionals[t] = s;
                    else if (200 === n.body.code) {
                      var a = new l["default"](r, t, e, "on", n.body.value, s.children, n.body.version);
                      r._observers[t] = a, o(a), s.apply(a);
                    } else
                      i(n.body.desc);
                  });
                });
              }
            }, {
              key: "onNotification",
              value: function(e) {
                this._onNotificationHandler = e;
              }
            }, {
              key: "_onForward",
              value: function(e) {
                var t = this,
                    r = t._reporters[e.body.to];
                r._onForward(e);
              }
            }, {
              key: "_onRemoteCreate",
              value: function(e) {
                var t = this,
                    r = e.from.slice(0, -13),
                    n = {
                      type: e.type,
                      from: e.body.source,
                      url: r,
                      schema: e.body.schema,
                      value: e.body.value,
                      identity: e.body.idToken,
                      ack: function(r) {
                        var n = 200;
                        r && (n = r), t._bus.postMessage({
                          id: e.id,
                          type: "response",
                          from: e.to,
                          to: e.from,
                          body: {code: n}
                        });
                      }
                    };
                t._onNotificationHandler && (console.log("NOTIFICATION-EVENT: ", n), t._onNotificationHandler(n));
              }
            }, {
              key: "_onRemoteDelete",
              value: function(e) {
                var t = this,
                    r = e.from.slice(0, -13),
                    n = t._observers[r];
                if (n) {
                  var o = {
                    type: e.type,
                    url: r,
                    identity: e.body.idToken,
                    ack: function(r) {
                      var o = 200;
                      r && (o = r), 200 === o && n["delete"](), t._bus.postMessage({
                        id: e.id,
                        type: "response",
                        from: e.to,
                        to: e.from,
                        body: {
                          code: o,
                          source: t._owner
                        }
                      });
                    }
                  };
                  t._onNotificationHandler && (console.log("NOTIFICATION-EVENT: ", o), t._onNotificationHandler(o));
                } else
                  t._bus.postMessage({
                    id: e.id,
                    type: "response",
                    from: e.to,
                    to: e.from,
                    body: {
                      code: 404,
                      source: t._owner
                    }
                  });
              }
            }, {
              key: "owner",
              get: function() {
                return this._owner;
              }
            }, {
              key: "reporters",
              get: function() {
                return this._reporters;
              }
            }, {
              key: "observers",
              get: function() {
                return this._observers;
              }
            }]), e;
          }();
      r["default"] = p, t.exports = r["default"];
    }, {
      "./DataObjectObserver": 114,
      "./DataObjectReporter": 115,
      "./DataProvisional": 116,
      "babel-runtime/core-js/promise": 8,
      "babel-runtime/helpers/class-call-check": 11,
      "babel-runtime/helpers/create-class": 13,
      "babel-runtime/helpers/interop-require-default": 17
    }],
    119: [function(e, t, r) {
      "use strict";
      function n(e) {
        var t = /([a-zA-Z-]*):\/\/(?:\.)?([-a-zA-Z0-9@:%._\+~#=]{2,256})([-a-zA-Z0-9@:%._\+~#=\/]*)/gi,
            r = "$1,$2,$3",
            n = e.replace(t, r).split(",");
        n[0] === e && (n[0] = "https", n[1] = e);
        var o = {
          type: n[0],
          domain: n[1],
          identity: n[2]
        };
        return o;
      }
      function o(e) {
        return e ? JSON.parse(JSON.stringify(e)) : void 0;
      }
      Object.defineProperty(r, "__esModule", {value: !0}), r.divideURL = n, r.deepClone = o;
    }, {}]
  }, {}, [111])(111);
});

_removeDefine();
})();
(function() {
var _removeDefine = $__System.get("@@amd-helpers").createDefine();
define("17", ["47"], function(main) {
  return main;
});

_removeDefine();
})();
$__System.register("48", ["5", "6"], function (_export) {
  var _createClass, _classCallCheck, RegistryDataModel;

  return {
    setters: [function (_) {
      _createClass = _["default"];
    }, function (_2) {
      _classCallCheck = _2["default"];
    }],
    execute: function () {
      /**
      *   @author: Gil Dias (gil.dias@tecnico.ulisboa.pt)
      *   Registry Data Model includes all Objects to be handled by the Registry functionality including
      */
      "use strict";

      RegistryDataModel = (function () {
        function RegistryDataModel(id, url, descriptor, startingTime, lastModified, status, stubs, stubsConfiguration) {
          _classCallCheck(this, RegistryDataModel);

          var _this = this;

          _this._id = id;
          _this._url = url;
          _this._descriptor = descriptor;
          _this._startingTime = startingTime;
          _this._lastModified = lastModified;
          _this._status = status;
          _this._stubs = stubs;
          _this._stubsConfiguration = stubsConfiguration;
        }

        _createClass(RegistryDataModel, [{
          key: "id",
          get: function get() {
            var _this = this;
            return _this._id;
          }
        }, {
          key: "url",
          get: function get() {
            var _this = this;
            return _this._url;
          }
        }, {
          key: "descriptor",
          get: function get() {
            var _this = this;
            return _this._descriptor;
          }
        }]);

        return RegistryDataModel;
      })();

      _export("default", RegistryDataModel);
    }
  };
});
$__System.register('49', ['3', '4', '5', '6', '48'], function (_export) {
  var _get, _inherits, _createClass, _classCallCheck, RegistryDataModel, HypertyInstance;

  return {
    setters: [function (_) {
      _get = _['default'];
    }, function (_2) {
      _inherits = _2['default'];
    }, function (_3) {
      _createClass = _3['default'];
    }, function (_4) {
      _classCallCheck = _4['default'];
    }, function (_5) {
      RegistryDataModel = _5['default'];
    }],
    execute: function () {

      /**
      *   @author: Gil Dias (gil.dias@tecnico.ulisboa.pt)
      *   HypertyInstance Data Model used to model instances of Hyperties running in devices and servers.
      */
      'use strict';

      HypertyInstance = (function (_RegistryDataModel) {
        _inherits(HypertyInstance, _RegistryDataModel);

        function HypertyInstance(id, url, descriptor, hypertyURL, user, guid, runtime, context) {
          _classCallCheck(this, HypertyInstance);

          _get(Object.getPrototypeOf(HypertyInstance.prototype), 'constructor', this).call(this, id, url, descriptor);
          var _this = this;
          _this._hypertyURL = hypertyURL;
          _this._user = user;
          _this._guid = guid;
          _this._runtime = runtime;
          _this._context = context;
        }

        _createClass(HypertyInstance, [{
          key: 'user',
          set: function set(identity) {
            var _this = this;
            _this.user = identity;
          },
          get: function get() {
            var _this = this;
            return _this._user;
          }
        }, {
          key: 'hypertyURL',
          get: function get() {
            var _this = this;
            return _this._hypertyURL;
          }
        }]);

        return HypertyInstance;
      })(RegistryDataModel);

      _export('default', HypertyInstance);
    }
  };
});
$__System.register('4a', ['5', '6', 'c'], function (_export) {
  var _createClass, _classCallCheck, _Promise, AddressAllocation;

  return {
    setters: [function (_) {
      _createClass = _['default'];
    }, function (_2) {
      _classCallCheck = _2['default'];
    }, function (_c) {
      _Promise = _c['default'];
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
              body: { value: { number: number } }
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
                  resolve(reply.body.value.allocated);
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
$__System.register("4b", ["5", "6"], function (_export) {
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
$__System.registerDynamic("4c", ["1a", "4d"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $export = $__require('1a');
  $export($export.S, 'Object', {setPrototypeOf: $__require('4d').set});
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("4e", ["4c", "23"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  $__require('4c');
  module.exports = $__require('23').Object.setPrototypeOf;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("4f", ["4e"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": $__require('4e'),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("50", ["28"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = $__require('28');
  module.exports = function create(P, D) {
    return $.create(P, D);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("51", ["50"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": $__require('50'),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("4", ["51", "4f"], true, function($__require, exports, module) {
  "use strict";
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var _Object$create = $__require('51')["default"];
  var _Object$setPrototypeOf = $__require('4f')["default"];
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

$__System.registerDynamic("45", ["1a", "23", "2a"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $export = $__require('1a'),
      core = $__require('23'),
      fails = $__require('2a');
  module.exports = function(KEY, exec) {
    var fn = (core.Object || {})[KEY] || Object[KEY],
        exp = {};
    exp[KEY] = exec(fn);
    $export($export.S + $export.F * fails(function() {
      fn(1);
    }), 'Object', exp);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("52", ["53", "45"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var toIObject = $__require('53');
  $__require('45')('getOwnPropertyDescriptor', function($getOwnPropertyDescriptor) {
    return function getOwnPropertyDescriptor(it, key) {
      return $getOwnPropertyDescriptor(toIObject(it), key);
    };
  });
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("54", ["28", "52"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = $__require('28');
  $__require('52');
  module.exports = function getOwnPropertyDescriptor(it, key) {
    return $.getDesc(it, key);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("55", ["54"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": $__require('54'),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("3", ["55"], true, function($__require, exports, module) {
  "use strict";
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var _Object$getOwnPropertyDescriptor = $__require('55')["default"];
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

$__System.register('56', ['3', '4', '5', '6', '10', '17', '49', 'c', '4b', '4a'], function (_export) {
  var _get, _inherits, _createClass, _classCallCheck, divideURL, getUserEmailFromURL, MessageFactory, HypertyInstance, _Promise, EventEmitter, AddressAllocation, Registry;

  return {
    setters: [function (_) {
      _get = _['default'];
    }, function (_2) {
      _inherits = _2['default'];
    }, function (_3) {
      _createClass = _3['default'];
    }, function (_4) {
      _classCallCheck = _4['default'];
    }, function (_7) {
      divideURL = _7.divideURL;
      getUserEmailFromURL = _7.getUserEmailFromURL;
    }, function (_6) {
      MessageFactory = _6.MessageFactory;
    }, function (_5) {
      HypertyInstance = _5['default'];
    }, function (_c) {
      _Promise = _c['default'];
    }, function (_b) {
      EventEmitter = _b['default'];
    }, function (_a) {
      AddressAllocation = _a['default'];
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

        function Registry(runtimeURL, appSandbox, identityModule, remoteRegistry) {
          _classCallCheck(this, Registry);

          _get(Object.getPrototypeOf(Registry.prototype), 'constructor', this).call(this);

          // how some functions receive the parameters for example:
          // new Registry('hyperty-runtime://sp1/123', appSandbox, idModule, remoteRegistry);
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
          _this.idModule = identityModule;
          _this.identifier = Math.floor(Math.random() * 10000 + 1);

          _this.hypertiesListToRemove = {};
          _this.hypertiesList = [];
          _this.protostubsList = {};
          _this.sandboxesList = { stub: {}, hyperty: {}, domain: {} };
          _this.pepList = {};

          _this._domain = divideURL(_this.registryURL).domain;
          _this.sandboxesList.domain[_this._domain] = appSandbox;
          var msgFactory = new MessageFactory('false', '{}');
          _this.messageFactory = msgFactory;
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
          * Function to query the Domain registry, with an user email.
          */
        }, {
          key: 'getUserHyperty',
          value: function getUserHyperty(identifier) {
            var _this = this;
            var identityURL = undefined;
            var email = undefined;
            if (identifier.indexOf('@') > -1) {
              identityURL = 'user://' + identifier.substring(identifier.indexOf('@') + 1, identifier.length) + '/' + identifier.substring(0, identifier.indexOf('@'));
              email = identifier;
            } else {
              identityURL = identifier;
              email = getUserEmailFromURL(identifier);
            }
            var msg = {
              type: 'READ', from: _this.registryURL, to: 'domain://registry.' + _this._domain + '/', body: { resource: identityURL }
            };

            return new _Promise(function (resolve, reject) {

              _this._messageBus.postMessage(msg, function (reply) {
                //console.log('MESSAGE', reply);

                var hyperty = undefined;
                var mostRecent = undefined;
                var lastHyperty = undefined;
                var value = reply.body.value;
                console.log('reply', value);
                for (hyperty in value) {
                  if (value[hyperty].lastModified !== undefined) {
                    if (mostRecent === undefined) {
                      mostRecent = new Date(value[hyperty].lastModified);
                      lastHyperty = hyperty;
                    } else {
                      var hypertyDate = new Date(value[hyperty].lastModified);
                      if (mostRecent.getTime() < hypertyDate.getTime()) {
                        mostRecent = hypertyDate;
                        lastHyperty = hyperty;
                      }
                    }
                  }
                }
                var hypertyURL = lastHyperty;

                if (hypertyURL === undefined) {
                  return reject('User Hyperty not found');
                }

                var idPackage = {
                  id: email,
                  descriptor: value[hypertyURL].descriptor,
                  hypertyURL: hypertyURL
                };

                console.log('===> RegisterHyperty messageBundle: ', idPackage);
                resolve(idPackage);
              });
            });
          }

          /**
          *  function to delete an hypertyInstance in the Domain Registry
          */
        }, {
          key: 'deleteHypertyInstance',
          value: function deleteHypertyInstance(user, hypertyInstance) {
            //TODO working but the user
            var _this = this;

            var message = { type: 'DELETE', from: _this.registryURL,
              to: 'domain://registry.' + _this._domain + '/',
              body: { value: { user: user, hypertyURL: hypertyInstance } } };

            _this._messageBus.postMessage(message, function (reply) {
              console.log('delete hyperty Reply', reply);
            });
          }

          /**
          * Function to update an Hyperty
          */
        }, {
          key: 'updateHypertyInstance',
          value: function updateHypertyInstance(resource, value) {
            var _this = this;

            var message = { type: 'UPDATE', from: _this.registryURL,
              to: 'domain://registry.' + _this._domain + '/',
              body: { resource: resource, value: value } };

            _this._messageBus.post.postMessage(message, function (reply) {
              console.log('Updated hyperty reply', reply);
            });
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

            return new _Promise(function (resolve, reject) {

              _this.idModule.loginWithRP('google', 'me').then(function (result) {
                var email = result.email;
                var identityURL = 'user://' + email.substring(email.indexOf('@') + 1, email.length) + '/' + email.substring(0, email.indexOf('@'));

                if (_this._messageBus === undefined) {
                  reject('MessageBus not found on registerStub');
                } else {
                  //call check if the protostub exist
                  _this.resolve('hyperty-runtime://' + domainUrl).then(function () {

                    _this.registryDomain = domainUrl;

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

                      var hyperty = new HypertyInstance(_this.identifier, _this.registryURL, descriptor, adderessList[0], identityURL);

                      _this.hypertiesList.push(hyperty);
                      _this.sandboxesList.hyperty[adderessList[0]] = sandbox;

                      //message to register the new hyperty, within the domain registry
                      //TODO uncomment and remove the msg variable when the messageFactory is up.
                      /*let messageValue = {user: identityURL,  hypertyDescriptorURL: descriptor, hypertyURL: adderessList[0]};
                       let message = _this.messageFactory.createCreateMessageRequest(
                        _this.registryURL,
                        'domain://registry.' + _this.registryDomain + '/',
                        messageValue,
                        'policy'
                      );
                      console.log('messagefactory', message);*/
                      var msg = {
                        type: 'CREATE', from: _this.registryURL, to: 'domain://registry.' + _this.registryDomain + '/', body: { value: { user: identityURL, hypertyDescriptorURL: descriptor, hypertyURL: adderessList[0] } }
                      };

                      //console.log('messagenormal', msg);
                      _this._messageBus.postMessage(msg, function (reply) {
                        console.log('===> RegisterHyperty Reply: ', reply);
                      });

                      resolve(adderessList[0]);
                    });
                  })['catch'](function (reason) {
                    console.log('Address Reason: ', reason);
                    reject(reason);
                  });
                }
              }, function (err) {
                reject('Failed to obtain an identity');
              });
            });
          }

          /**
          * To unregister a previously registered Hyperty
          * @param  {HypertyURL}          HypertyURL url        url
          */
        }, {
          key: 'unregisterHyperty',
          value: function unregisterHyperty(url) {
            var _this = this;

            return new _Promise(function (resolve, reject) {

              var found = false;
              var index = 0;

              for (index = 0; index < _this.hypertiesList.length; index++) {
                var hyperty = _this.hypertiesList[index];
                if (hyperty !== undefined) {
                  if (hyperty.hypertyURL === url) {
                    found = true;
                    break;
                  }
                }
              }

              if (found === false) {
                reject('Hyperty not found');
              } else {
                delete _this.hypertiesList[index];
                resolve('Hyperty successfully deleted');
              }
            });
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

            return new _Promise(function (resolve, reject) {

              var request = _this.protostubsList[url];

              if (request === undefined) {
                reject('requestUpdate couldn\' get the ProtostubURL');
              } else {
                resolve(request);
              }
            });
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
            var runtimeProtoStubURL = undefined;

            return new _Promise(function (resolve, reject) {

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
              _this.sandboxesList.stub[runtimeProtoStubURL] = sandbox;

              // sandbox.addListener('*', function(msg) {
              //   _this._messageBus.postMessage(msg);
              // });

              resolve(runtimeProtoStubURL);

              _this._messageBus.addListener(runtimeProtoStubURL + '/status', function (msg) {
                if (msg.resource === msg.to + '/status') {
                  console.log('RuntimeProtostubURL/status message: ', msg.body.value);
                }
              });
            });
          }

          /**
          * To unregister a previously registered protocol stub
          * @param  {HypertyRuntimeURL}   HypertyRuntimeURL     hypertyRuntimeURL
          */
        }, {
          key: 'unregisterStub',
          value: function unregisterStub(hypertyRuntimeURL) {
            var _this = this;
            var runtimeProtoStubURL = undefined;

            return new _Promise(function (resolve, reject) {

              var data = _this.protostubsList[hypertyRuntimeURL];

              if (data === undefined) {
                reject('Error on unregisterStub: Hyperty not found');
              } else {
                delete _this.protostubsList[hypertyRuntimeURL];
                resolve('ProtostubURL removed');
              }
            });
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

            return new _Promise(function (resolve, reject) {
              //TODO check what parameter in the postMessage the pep is.
              _this.pepList[hyperty] = postMessage;
              resolve('PEP registered with success');
            });
          }

          /**
          * To unregister a previously registered protocol stub
          * @param  {HypertyRuntimeURL}   HypertyRuntimeURL     HypertyRuntimeURL
          */
        }, {
          key: 'unregisterPEP',
          value: function unregisterPEP(HypertyRuntimeURL) {
            var _this = this;

            return new _Promise(function (resolve, reject) {

              var result = _this.pepList[HypertyRuntimeURL];

              if (result === undefined) {
                reject('Pep Not found.');
              } else {
                resolve('PEP successfully removed.');
              }
            });
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
            var dividedURL = divideURL(url);

            var _this = this;
            return new _Promise(function (resolve, reject) {

              var request = undefined;
              if (url.includes('msg-node')) {
                request = _this.sandboxesList.stub[url];

                if (request === undefined) {
                  for (var stub in _this.sandboxesList.stub) {
                    if (stub.includes(url)) {

                      request = _this.sandboxesList.stub[stub];
                      break;
                    }
                  }
                }
              } else if (url.includes('hyperty')) {
                request = _this.sandboxesList.hyperty[url];

                if (request === undefined) {
                  for (var hyperty in _this.sandboxesList.hyperty) {
                    if (hyperty.includes(url)) {
                      request = _this.sandboxesList.hyperty[hyperty];
                      break;
                    }
                  }
                }
              }
              if (request === undefined) {
                request = _this.sandboxesList.domain[url];

                if (request === undefined) {
                  for (var domain in _this.sandboxesList.domain) {
                    if (domain.includes(dividedURL.domain)) {
                      request = _this.sandboxesList.domain[domain];
                      break;
                    }
                  }
                }
                if (request === undefined) {
                  reject('Sandbox not found');
                } else {
                  resolve(request);
                }
              } else {
                resolve(request);
              }
            });
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

            return new _Promise(function (resolve, reject) {

              if (!domainUrl.indexOf('msg-node.') || !domainUrl.indexOf('registry.')) {
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
$__System.registerDynamic("44", ["32"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var defined = $__require('32');
  module.exports = function(it) {
    return Object(defined(it));
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("57", ["28", "44", "58", "2a"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = $__require('28'),
      toObject = $__require('44'),
      IObject = $__require('58');
  module.exports = $__require('2a')(function() {
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

$__System.registerDynamic("59", ["1a", "57"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $export = $__require('1a');
  $export($export.S + $export.F, 'Object', {assign: $__require('57')});
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("5a", ["59", "23"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  $__require('59');
  module.exports = $__require('23').Object.assign;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("5b", ["5a"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": $__require('5a'),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("5c", ["5d"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var ITERATOR = $__require('5d')('iterator'),
      SAFE_CLOSING = false;
  try {
    var riter = [7][ITERATOR]();
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
          iter = arr[ITERATOR]();
      iter.next = function() {
        safe = true;
      };
      arr[ITERATOR] = function() {
        return iter;
      };
      exec(arr);
    } catch (e) {}
    return safe;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("37", ["23", "28", "30", "5d"], true, function($__require, exports, module) {
  "use strict";
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var core = $__require('23'),
      $ = $__require('28'),
      DESCRIPTORS = $__require('30'),
      SPECIES = $__require('5d')('species');
  module.exports = function(KEY) {
    var C = core[KEY];
    if (DESCRIPTORS && C && !C[SPECIES])
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

$__System.registerDynamic("2c", ["5e"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var redefine = $__require('5e');
  module.exports = function(target, src) {
    for (var key in src)
      redefine(target, key, src[key]);
    return target;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("5f", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("60", ["5f"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = $__require('5f');
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("61", ["60"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = $__System._nodeRequire ? process : $__require('60');
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("40", ["61"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = $__require('61');
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("62", ["2e", "29"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var isObject = $__require('2e'),
      document = $__require('29').document,
      is = isObject(document) && isObject(document.createElement);
  module.exports = function(it) {
    return is ? document.createElement(it) : {};
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("63", ["29"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = $__require('29').document && document.documentElement;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("64", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("65", ["31", "64", "63", "62", "29", "66", "40"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  (function(process) {
    var ctx = $__require('31'),
        invoke = $__require('64'),
        html = $__require('63'),
        cel = $__require('62'),
        global = $__require('29'),
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
      if ($__require('66')(process) == 'process') {
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
  })($__require('40'));
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("67", ["29", "65", "66", "40"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  (function(process) {
    var global = $__require('29'),
        macrotask = $__require('65').set,
        Observer = global.MutationObserver || global.WebKitMutationObserver,
        process = global.process,
        Promise = global.Promise,
        isNode = $__require('66')(process) == 'process',
        head,
        last,
        notify;
    var flush = function() {
      var parent,
          domain,
          fn;
      if (isNode && (parent = process.domain)) {
        process.domain = null;
        parent.exit();
      }
      while (head) {
        domain = head.domain;
        fn = head.fn;
        if (domain)
          domain.enter();
        fn();
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
    } else if (Promise && Promise.resolve) {
      notify = function() {
        Promise.resolve().then(flush);
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
  })($__require('40'));
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("68", ["69", "6a", "5d"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var anObject = $__require('69'),
      aFunction = $__require('6a'),
      SPECIES = $__require('5d')('species');
  module.exports = function(O, D) {
    var C = anObject(O).constructor,
        S;
    return C === undefined || (S = anObject(C)[SPECIES]) == undefined ? D : aFunction(S);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("6b", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("4d", ["28", "2e", "69", "31"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var getDesc = $__require('28').getDesc,
      isObject = $__require('2e'),
      anObject = $__require('69');
  var check = function(O, proto) {
    anObject(O);
    if (!isObject(proto) && proto !== null)
      throw TypeError(proto + ": can't set as prototype!");
  };
  module.exports = {
    set: Object.setPrototypeOf || ('__proto__' in {} ? function(test, buggy, set) {
      try {
        set = $__require('31')(Function.call, getDesc(Object.prototype, '__proto__').set, 2);
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

$__System.registerDynamic("6c", ["26", "5d", "6d", "23"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var classof = $__require('26'),
      ITERATOR = $__require('5d')('iterator'),
      Iterators = $__require('6d');
  module.exports = $__require('23').getIteratorMethod = function(it) {
    if (it != undefined)
      return it[ITERATOR] || it['@@iterator'] || Iterators[classof(it)];
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("6e", ["6f"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var toInteger = $__require('6f'),
      min = Math.min;
  module.exports = function(it) {
    return it > 0 ? min(toInteger(it), 0x1fffffffffffff) : 0;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("70", ["6d", "5d"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var Iterators = $__require('6d'),
      ITERATOR = $__require('5d')('iterator'),
      ArrayProto = Array.prototype;
  module.exports = function(it) {
    return it !== undefined && (Iterators.Array === it || ArrayProto[ITERATOR] === it);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("71", ["69"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var anObject = $__require('69');
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

$__System.registerDynamic("25", ["31", "71", "70", "69", "6e", "6c"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var ctx = $__require('31'),
      call = $__require('71'),
      isArrayIter = $__require('70'),
      anObject = $__require('69'),
      toLength = $__require('6e'),
      getIterFn = $__require('6c');
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

$__System.registerDynamic("2d", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("69", ["2e"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var isObject = $__require('2e');
  module.exports = function(it) {
    if (!isObject(it))
      throw TypeError(it + ' is not an object!');
    return it;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("2e", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("26", ["66", "5d"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var cof = $__require('66'),
      TAG = $__require('5d')('toStringTag'),
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

$__System.registerDynamic("72", ["28", "73", "29", "31", "26", "1a", "2e", "69", "6a", "2d", "25", "4d", "6b", "5d", "68", "67", "30", "2c", "2f", "37", "23", "5c", "40"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  (function(process) {
    'use strict';
    var $ = $__require('28'),
        LIBRARY = $__require('73'),
        global = $__require('29'),
        ctx = $__require('31'),
        classof = $__require('26'),
        $export = $__require('1a'),
        isObject = $__require('2e'),
        anObject = $__require('69'),
        aFunction = $__require('6a'),
        strictNew = $__require('2d'),
        forOf = $__require('25'),
        setProto = $__require('4d').set,
        same = $__require('6b'),
        SPECIES = $__require('5d')('species'),
        speciesConstructor = $__require('68'),
        asap = $__require('67'),
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
    var USE_NATIVE = function() {
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
        if (works && $__require('30')) {
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
    var PromiseCapability = function(C) {
      var resolve,
          reject;
      this.promise = new C(function($$resolve, $$reject) {
        if (resolve !== undefined || reject !== undefined)
          throw TypeError('Bad Promise constructor');
        resolve = $$resolve;
        reject = $$reject;
      });
      this.resolve = aFunction(resolve), this.reject = aFunction(reject);
    };
    var perform = function(exec) {
      try {
        exec();
      } catch (e) {
        return {error: e};
      }
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
        var run = function(reaction) {
          var handler = ok ? reaction.ok : reaction.fail,
              resolve = reaction.resolve,
              reject = reaction.reject,
              result,
              then;
          try {
            if (handler) {
              if (!ok)
                record.h = true;
              result = handler === true ? value : handler(value);
              if (result === reaction.promise) {
                reject(TypeError('Promise-chain cycle'));
              } else if (then = isThenable(result)) {
                then.call(result, resolve, reject);
              } else
                resolve(result);
            } else
              reject(value);
          } catch (e) {
            reject(e);
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
      var record = promise._d,
          chain = record.a || record.c,
          i = 0,
          reaction;
      if (record.h)
        return false;
      while (chain.length > i) {
        reaction = chain[i++];
        if (reaction.fail || !isUnhandled(reaction.promise))
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
        if (record.p === value)
          throw TypeError("Promise can't be resolved itself");
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
    if (!USE_NATIVE) {
      P = function Promise(executor) {
        aFunction(executor);
        var record = this._d = {
          p: strictNew(this, P, PROMISE),
          c: [],
          a: undefined,
          s: 0,
          d: false,
          v: undefined,
          h: false,
          n: false
        };
        try {
          executor(ctx($resolve, record, 1), ctx($reject, record, 1));
        } catch (err) {
          $reject.call(record, err);
        }
      };
      $__require('2c')(P.prototype, {
        then: function then(onFulfilled, onRejected) {
          var reaction = new PromiseCapability(speciesConstructor(this, P)),
              promise = reaction.promise,
              record = this._d;
          reaction.ok = typeof onFulfilled == 'function' ? onFulfilled : true;
          reaction.fail = typeof onRejected == 'function' && onRejected;
          record.c.push(reaction);
          if (record.a)
            record.a.push(reaction);
          if (record.s)
            notify(record, false);
          return promise;
        },
        'catch': function(onRejected) {
          return this.then(undefined, onRejected);
        }
      });
    }
    $export($export.G + $export.W + $export.F * !USE_NATIVE, {Promise: P});
    $__require('2f')(P, PROMISE);
    $__require('37')(PROMISE);
    Wrapper = $__require('23')[PROMISE];
    $export($export.S + $export.F * !USE_NATIVE, PROMISE, {reject: function reject(r) {
        var capability = new PromiseCapability(this),
            $$reject = capability.reject;
        $$reject(r);
        return capability.promise;
      }});
    $export($export.S + $export.F * (!USE_NATIVE || testResolve(true)), PROMISE, {resolve: function resolve(x) {
        if (x instanceof P && sameConstructor(x.constructor, this))
          return x;
        var capability = new PromiseCapability(this),
            $$resolve = capability.resolve;
        $$resolve(x);
        return capability.promise;
      }});
    $export($export.S + $export.F * !(USE_NATIVE && $__require('5c')(function(iter) {
      P.all(iter)['catch'](function() {});
    })), PROMISE, {
      all: function all(iterable) {
        var C = getConstructor(this),
            capability = new PromiseCapability(C),
            resolve = capability.resolve,
            reject = capability.reject,
            values = [];
        var abrupt = perform(function() {
          forOf(iterable, false, values.push, values);
          var remaining = values.length,
              results = Array(remaining);
          if (remaining)
            $.each.call(values, function(promise, index) {
              var alreadyCalled = false;
              C.resolve(promise).then(function(value) {
                if (alreadyCalled)
                  return;
                alreadyCalled = true;
                results[index] = value;
                --remaining || resolve(results);
              }, reject);
            });
          else
            resolve(results);
        });
        if (abrupt)
          reject(abrupt.error);
        return capability.promise;
      },
      race: function race(iterable) {
        var C = getConstructor(this),
            capability = new PromiseCapability(C),
            reject = capability.reject;
        var abrupt = perform(function() {
          forOf(iterable, false, function(promise) {
            C.resolve(promise).then(capability.resolve, reject);
          });
        });
        if (abrupt)
          reject(abrupt.error);
        return capability.promise;
      }
    });
  })($__require('40'));
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("66", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("58", ["66"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var cof = $__require('66');
  module.exports = Object('z').propertyIsEnumerable(0) ? Object : function(it) {
    return cof(it) == 'String' ? it.split('') : Object(it);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("53", ["58", "32"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var IObject = $__require('58'),
      defined = $__require('32');
  module.exports = function(it) {
    return IObject(defined(it));
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("34", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("74", [], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = function() {};
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("75", ["74", "34", "6d", "53", "33"], true, function($__require, exports, module) {
  "use strict";
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var addToUnscopables = $__require('74'),
      step = $__require('34'),
      Iterators = $__require('6d'),
      toIObject = $__require('53');
  module.exports = $__require('33')(Array, 'Array', function(iterated, kind) {
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
  addToUnscopables('keys');
  addToUnscopables('values');
  addToUnscopables('entries');
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("22", ["75", "6d"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  $__require('75');
  var Iterators = $__require('6d');
  Iterators.NodeList = Iterators.HTMLCollection = Iterators.Array;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("35", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("76", ["29"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var global = $__require('29'),
      SHARED = '__core-js_shared__',
      store = global[SHARED] || (global[SHARED] = {});
  module.exports = function(key) {
    return store[key] || (store[key] = {});
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("5d", ["76", "35", "29"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var store = $__require('76')('wks'),
      uid = $__require('35'),
      Symbol = $__require('29').Symbol;
  module.exports = function(name) {
    return store[name] || (store[name] = Symbol && Symbol[name] || (Symbol || uid)('Symbol.' + name));
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("2f", ["28", "36", "5d"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var def = $__require('28').setDesc,
      has = $__require('36'),
      TAG = $__require('5d')('toStringTag');
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

$__System.registerDynamic("77", ["28", "78", "2f", "2b", "5d"], true, function($__require, exports, module) {
  "use strict";
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = $__require('28'),
      descriptor = $__require('78'),
      setToStringTag = $__require('2f'),
      IteratorPrototype = {};
  $__require('2b')(IteratorPrototype, $__require('5d')('iterator'), function() {
    return this;
  });
  module.exports = function(Constructor, NAME, next) {
    Constructor.prototype = $.create(IteratorPrototype, {next: descriptor(1, next)});
    setToStringTag(Constructor, NAME + ' Iterator');
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("6d", [], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {};
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("36", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("2a", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("30", ["2a"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = !$__require('2a')(function() {
    return Object.defineProperty({}, 'a', {get: function() {
        return 7;
      }}).a != 7;
  });
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("78", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("2b", ["28", "78", "30"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = $__require('28'),
      createDesc = $__require('78');
  module.exports = $__require('30') ? function(object, key, value) {
    return $.setDesc(object, key, createDesc(1, value));
  } : function(object, key, value) {
    object[key] = value;
    return object;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("5e", ["2b"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = $__require('2b');
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("6a", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("31", ["6a"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var aFunction = $__require('6a');
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

$__System.registerDynamic("23", [], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var core = module.exports = {version: '1.2.6'};
  if (typeof __e == 'number')
    __e = core;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("29", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("1a", ["29", "23", "31"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var global = $__require('29'),
      core = $__require('23'),
      ctx = $__require('31'),
      PROTOTYPE = 'prototype';
  var $export = function(type, name, source) {
    var IS_FORCED = type & $export.F,
        IS_GLOBAL = type & $export.G,
        IS_STATIC = type & $export.S,
        IS_PROTO = type & $export.P,
        IS_BIND = type & $export.B,
        IS_WRAP = type & $export.W,
        exports = IS_GLOBAL ? core : core[name] || (core[name] = {}),
        target = IS_GLOBAL ? global : IS_STATIC ? global[name] : (global[name] || {})[PROTOTYPE],
        key,
        own,
        out;
    if (IS_GLOBAL)
      source = name;
    for (key in source) {
      own = !IS_FORCED && target && key in target;
      if (own && key in exports)
        continue;
      out = own ? target[key] : source[key];
      exports[key] = IS_GLOBAL && typeof target[key] != 'function' ? source[key] : IS_BIND && own ? ctx(out, global) : IS_WRAP && target[key] == out ? (function(C) {
        var F = function(param) {
          return this instanceof C ? new C(param) : C(param);
        };
        F[PROTOTYPE] = C[PROTOTYPE];
        return F;
      })(out) : IS_PROTO && typeof out == 'function' ? ctx(Function.call, out) : out;
      if (IS_PROTO)
        (exports[PROTOTYPE] || (exports[PROTOTYPE] = {}))[key] = out;
    }
  };
  $export.F = 1;
  $export.G = 2;
  $export.S = 4;
  $export.P = 8;
  $export.B = 16;
  $export.W = 32;
  module.exports = $export;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("73", [], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = true;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("33", ["73", "1a", "5e", "2b", "36", "6d", "77", "2f", "28", "5d"], true, function($__require, exports, module) {
  "use strict";
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var LIBRARY = $__require('73'),
      $export = $__require('1a'),
      redefine = $__require('5e'),
      hide = $__require('2b'),
      has = $__require('36'),
      Iterators = $__require('6d'),
      $iterCreate = $__require('77'),
      setToStringTag = $__require('2f'),
      getProto = $__require('28').getProto,
      ITERATOR = $__require('5d')('iterator'),
      BUGGY = !([].keys && 'next' in [].keys()),
      FF_ITERATOR = '@@iterator',
      KEYS = 'keys',
      VALUES = 'values';
  var returnThis = function() {
    return this;
  };
  module.exports = function(Base, NAME, Constructor, next, DEFAULT, IS_SET, FORCED) {
    $iterCreate(Constructor, NAME, next);
    var getMethod = function(kind) {
      if (!BUGGY && kind in proto)
        return proto[kind];
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
        DEF_VALUES = DEFAULT == VALUES,
        VALUES_BUG = false,
        proto = Base.prototype,
        $native = proto[ITERATOR] || proto[FF_ITERATOR] || DEFAULT && proto[DEFAULT],
        $default = $native || getMethod(DEFAULT),
        methods,
        key;
    if ($native) {
      var IteratorPrototype = getProto($default.call(new Base));
      setToStringTag(IteratorPrototype, TAG, true);
      if (!LIBRARY && has(proto, FF_ITERATOR))
        hide(IteratorPrototype, ITERATOR, returnThis);
      if (DEF_VALUES && $native.name !== VALUES) {
        VALUES_BUG = true;
        $default = function values() {
          return $native.call(this);
        };
      }
    }
    if ((!LIBRARY || FORCED) && (BUGGY || VALUES_BUG || !proto[ITERATOR])) {
      hide(proto, ITERATOR, $default);
    }
    Iterators[NAME] = $default;
    Iterators[TAG] = returnThis;
    if (DEFAULT) {
      methods = {
        values: DEF_VALUES ? $default : getMethod(VALUES),
        keys: IS_SET ? $default : getMethod(KEYS),
        entries: !DEF_VALUES ? $default : getMethod('entries')
      };
      if (FORCED)
        for (key in methods) {
          if (!(key in proto))
            redefine(proto, key, methods[key]);
        }
      else
        $export($export.P + $export.F * (BUGGY || VALUES_BUG), NAME, methods);
    }
    return methods;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("32", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("6f", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("79", ["6f", "32"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var toInteger = $__require('6f'),
      defined = $__require('32');
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

$__System.registerDynamic("21", ["79", "33"], true, function($__require, exports, module) {
  "use strict";
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $at = $__require('79')(true);
  $__require('33')(String, 'String', function(iterated) {
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

$__System.registerDynamic("20", [], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  "format cjs";
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("7a", ["20", "21", "22", "72", "23"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  $__require('20');
  $__require('21');
  $__require('22');
  $__require('72');
  module.exports = $__require('23').Promise;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("c", ["7a"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": $__require('7a'),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("6", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("28", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("7b", ["28"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = $__require('28');
  module.exports = function defineProperty(it, key, desc) {
    return $.setDesc(it, key, desc);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("7c", ["7b"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": $__require('7b'),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("5", ["7c"], true, function($__require, exports, module) {
  "use strict";
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var _Object$defineProperty = $__require('7c')["default"];
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

$__System.register('7d', ['5', '6', '10', '15', '16', '42', '56', 'c', '5b', '3e', '3b'], function (_export) {
  var _createClass, _classCallCheck, divideURL, emptyObject, SyncherManager, RuntimeCatalogue, IdentityModule, Registry, _Promise, _Object$assign, PolicyEngine, MessageBus, RuntimeUA;

  return {
    setters: [function (_) {
      _createClass = _['default'];
    }, function (_2) {
      _classCallCheck = _2['default'];
    }, function (_7) {
      divideURL = _7.divideURL;
      emptyObject = _7.emptyObject;
    }, function (_6) {
      SyncherManager = _6['default'];
    }, function (_5) {
      RuntimeCatalogue = _5['default'];
    }, function (_4) {
      IdentityModule = _4['default'];
    }, function (_3) {
      Registry = _3['default'];
    }, function (_c) {
      _Promise = _c['default'];
    }, function (_b) {
      _Object$assign = _b['default'];
    }, function (_e) {
      PolicyEngine = _e['default'];
    }, function (_b2) {
      MessageBus = _b2['default'];
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
       * @property {GraphConnector} graphConnector - Graph Connector handling GUID and contacts
       */

      //import GraphConnector from '../graphconnector/GraphConnector';

      'use strict';

      RuntimeUA = (function () {

        /**
         * Create a new instance of Runtime User Agent
         * @param {sandboxFactory} sandboxFactory - Specific implementation for the environment where the core runtime will run;
         * @param {domain} domainURL - specify the domain base for the runtime;
         */

        function RuntimeUA(sandboxFactory, domain) {
          _classCallCheck(this, RuntimeUA);

          if (!sandboxFactory) throw new Error('The sandbox factory is a needed parameter');
          if (!domain) throw new Error('You need the domain of runtime');

          var _this = this;

          _this.sandboxFactory = sandboxFactory;

          _this.runtimeCatalogue = new RuntimeCatalogue();

          // TODO: post and return registry/hypertyRuntimeInstance to and from Back-end Service
          // the response is like: runtime://sp1/123

          var runtimeURL = 'runtime://' + domain + '/' + Math.floor(Math.random() * 10000 + 1);
          _this.runtimeURL = runtimeURL;
          _this.domain = domain;

          // TODO: check if runtime catalogue need the runtimeURL;
          _this.runtimeCatalogue.runtimeURL = runtimeURL;

          // Instantiate the identity Module
          _this.identityModule = new IdentityModule();

          // Use the sandbox factory to create an AppSandbox;
          // In the future can be decided by policyEngine if we need
          // create a AppSandbox or not;
          var appSandbox = sandboxFactory.createAppSandbox();

          // Instantiate the Registry Module
          _this.registry = new Registry(runtimeURL, appSandbox, _this.identityModule);

          // Instantiate the Policy Engine
          _this.policyEngine = new PolicyEngine(_this.identityModule, _this.registry);

          // Instantiate the Message Bus
          _this.messageBus = new MessageBus(_this.registry);
          _this.messageBus.pipeline.handlers = [

          // Policy message authorise
          function (ctx) {
            _this.policyEngine.authorise(ctx.msg).then(function (changedMgs) {
              ctx.msg = changedMgs;
              ctx.next();
            })['catch'](function (reason) {
              console.error(reason);
              ctx.fail(reason);
            });
          }];

          // Add to App Sandbox the listener;
          appSandbox.addListener('*', function (msg) {
            _this.messageBus.postMessage(msg);
          });

          // Register messageBus on Registry
          _this.registry.messageBus = _this.messageBus;

          _this.registry.addEventListener('runtime:loadStub', function (domainURL) {

            _this.loadStub(domainURL).then(function () {
              _this.registry.trigger('runtime:stubLoaded', domainURL);
            })['catch'](function (reason) {
              console.error(reason);
            });
          });

          // Use sandbox factory to use specific methods
          // and set the message bus to the factory
          sandboxFactory.messageBus = _this.messageBus;

          // Instanciate the SyncherManager;
          _this.syncherManager = new SyncherManager(_this.runtimeURL, _this.messageBus, {}, _this.runtimeCatalogue);

          // Instantiate the Graph Connector
          //_this.graphConnector = new GraphConnector(_this.runtimeURL, _this.messageBus);
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
          * @param  {URL.HypertyCatalogueURL}    hyperty hypertyDescriptor url;
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
                reject(reason);
              };

              // Get Hyperty descriptor
              // TODO: the request Module should be changed,
              // because at this moment it is incompatible with nodejs;
              // Probably we need to pass a factory like we do for sandboxes;
              console.info('------------------ Hyperty ------------------------');
              console.info('Get hyperty descriptor for :', hypertyDescriptorURL);
              _this.runtimeCatalogue.getHypertyDescriptor(hypertyDescriptorURL).then(function (hypertyDescriptor) {
                // at this point, we have completed "step 2 and 3" as shown in https://github.com/reTHINK-project/core-framework/blob/master/docs/specs/runtime/dynamic-view/basics/deploy-hyperty.md
                console.info('1: return hyperty descriptor', hypertyDescriptor);

                // hyperty contains the full path of the catalogue URL, e.g.
                // catalogue.rethink.eu/.well-known/..........
                _hypertyDescriptor = hypertyDescriptor;

                var sourcePackageURL = hypertyDescriptor.sourcePackageURL;

                if (sourcePackageURL === '/sourcePackage') {
                  return hypertyDescriptor.sourcePackage;
                }

                // Get the hyperty source code
                return _this.runtimeCatalogue.getSourcePackageFromURL(sourcePackageURL);
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
                console.info('3: return policy engine result: ', policyResult);

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

                    var domain = divideURL(hypertyDescriptorURL).domain;

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
                var sandbox = _this.sandboxFactory.createSandbox();

                sandbox.addListener('*', function (msg) {
                  _this.messageBus.postMessage(msg);
                });

                return sandbox;
              }).then(function (sandbox) {
                console.info('5: return sandbox and register');

                _hypertySandbox = sandbox;

                // Register hyperty
                return _this.registry.registerHyperty(sandbox, hypertyDescriptorURL);
              }).then(function (hypertyURL) {
                console.info('6: Hyperty url, after register hyperty', hypertyURL);

                // we have completed step 16 of https://github.com/reTHINK-project/core-framework/blob/master/docs/specs/runtime/dynamic-view/basics/deploy-hyperty.md right now.

                _hypertyURL = hypertyURL;

                console.log(_hypertyDescriptor);

                // Extend original hyperty configuration;
                var configuration = {};
                if (!emptyObject(_hypertyDescriptor.configuration)) {
                  try {
                    configuration = _Object$assign({}, JSON.parse(_hypertyDescriptor.configuration));
                  } catch (e) {
                    configuration = _hypertyDescriptor.configuration;
                  }
                }
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
          value: function loadStub(protostubURL) {

            var _this = this;

            if (!protostubURL) throw new Error('domain parameter is needed');

            return new _Promise(function (resolve, reject) {

              var domain = divideURL(protostubURL).domain;

              if (!domain) {
                domain = protostubURL;
              }

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
                return _this.runtimeCatalogue.getStubDescriptor(protostubURL);
              }).then(function (stubDescriptor) {

                console.info('2. return the ProtoStub descriptor:', stubDescriptor);

                // we have completed step 5 https://github.com/reTHINK-project/core-framework/blob/master/docs/specs/runtime/dynamic-view/basics/deploy-protostub.md

                _stubDescriptor = stubDescriptor;

                var sourcePackageURL = stubDescriptor.sourcePackageURL;

                if (sourcePackageURL === '/sourcePackage') {
                  return stubDescriptor.sourcePackage;
                }

                // we need to get ProtoStub Source code from descriptor - step 6 https://github.com/reTHINK-project/core-framework/blob/master/docs/specs/runtime/dynamic-view/basics/deploy-protostub.md
                return _this.runtimeCatalogue.getSourcePackageFromURL(sourcePackageURL);
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
                console.info('5. Sandbox was not found, creating a new one', reason);

                // check if the sandbox is registed for this stub descriptor url;
                // Make Steps xxx --- xxx
                // Instantiate the Sandbox
                var sandbox = _this.sandboxFactory.createSandbox();
                sandbox.addListener('*', function (msg) {
                  _this.messageBus.postMessage(msg);
                });

                return sandbox;
              }).then(function (sandbox) {
                console.info('6. return the sandbox instance and register', sandbox, 'to domain ', domain);

                _stubSandbox = sandbox;

                // we need register stub on registry - step xxx https://github.com/reTHINK-project/core-framework/blob/master/docs/specs/runtime/dynamic-view/basics/deploy-protostub.md
                return _this.registry.registerStub(_stubSandbox, domain);
              }).then(function (runtimeProtoStubURL) {

                console.info('7. return the runtime protostub url: ', runtimeProtoStubURL);

                // we have completed step xxx https://github.com/reTHINK-project/core-framework/blob/master/docs/specs/runtime/dynamic-view/basics/deploy-protostub.md

                _runtimeProtoStubURL = runtimeProtoStubURL;

                console.log(_stubDescriptor);

                // Extend original hyperty configuration;
                var configuration = _Object$assign({}, JSON.parse(_stubDescriptor.configuration));
                configuration.runtimeURL = _this.runtimeURL;

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
$__System.register('1', ['7d', 'e'], function (_export) {
    'use strict';

    var RuntimeUA, SandboxFactory, runtime;

    function returnHyperty(source, hyperty) {
        source.postMessage({ to: 'runtime:loadedHyperty', body: hyperty }, '*');
    }

    return {
        setters: [function (_d) {
            RuntimeUA = _d['default'];
        }, function (_e) {
            SandboxFactory = _e['default'];
        }],
        execute: function () {
            runtime = new RuntimeUA(SandboxFactory, 'localhost');

            window.addEventListener('message', function (event) {
                if (event.data.to === 'core:loadHyperty') {
                    (function () {
                        var descriptor = event.data.body.descriptor;
                        var hyperty = runtime.registry.hypertiesList.find(function (hi, index, array) {
                            return hi.descriptor === descriptor;
                        });
                        if (hyperty) {
                            returnHyperty(event.source, { runtimeHypertyURL: hyperty.hypertyURL });
                        } else {
                            runtime.loadHyperty(descriptor).then(returnHyperty.bind(null, event.source));
                        }
                    })();
                } else if (event.data.to === 'core:loadStub') {
                    runtime.loadStub(event.data.body.domain);
                }
            }, false);
        }
    };
});
})
(function(factory) {
  factory();
});
//# sourceMappingURL=core.js.map