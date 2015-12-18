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
(function() {
var _removeDefine = $__System.get("@@amd-helpers").createDefine();
(function(f) {
  if (typeof exports === "object" && typeof module !== "undefined") {
    module.exports = f();
  } else if (typeof define === "function" && define.amd) {
    define("2", [], f);
  } else {
    var g;
    if (typeof window !== "undefined") {
      g = window;
    } else if (typeof global !== "undefined") {
      g = global;
    } else if (typeof self !== "undefined") {
      g = self;
    } else {
      g = this;
    }
    g.runtimeCore = f();
  }
})(function() {
  var define,
      module,
      exports;
  return (function e(t, n, r) {
    function s(o, u) {
      if (!n[o]) {
        if (!t[o]) {
          var a = typeof require == "function" && require;
          if (!u && a)
            return a(o, !0);
          if (i)
            return i(o, !0);
          var f = new Error("Cannot find module '" + o + "'");
          throw f.code = "MODULE_NOT_FOUND", f;
        }
        var l = n[o] = {exports: {}};
        t[o][0].call(l.exports, function(e) {
          var n = t[o][1][e];
          return s(n ? n : e);
        }, l, l.exports, e, t, n, r);
      }
      return n[o].exports;
    }
    var i = typeof require == "function" && require;
    for (var o = 0; o < r.length; o++)
      s(r[o]);
    return s;
  })({
    1: [function(require, module, exports) {
      'use strict';
      Object.defineProperty(exports, '__esModule', {value: true});
      var _createClass = (function() {
        function defineProperties(target, props) {
          for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];
            descriptor.enumerable = descriptor.enumerable || false;
            descriptor.configurable = true;
            if ('value' in descriptor)
              descriptor.writable = true;
            Object.defineProperty(target, descriptor.key, descriptor);
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
      var _get = function get(_x, _x2, _x3) {
        var _again = true;
        _function: while (_again) {
          var object = _x,
              property = _x2,
              receiver = _x3;
          _again = false;
          if (object === null)
            object = Function.prototype;
          var desc = Object.getOwnPropertyDescriptor(object, property);
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
          } else if ('value' in desc) {
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
      function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {'default': obj};
      }
      function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
          throw new TypeError('Cannot call a class as a function');
        }
      }
      function _inherits(subClass, superClass) {
        if (typeof superClass !== 'function' && superClass !== null) {
          throw new TypeError('Super expression must either be null or a function, not ' + typeof superClass);
        }
        subClass.prototype = Object.create(superClass && superClass.prototype, {constructor: {
            value: subClass,
            enumerable: false,
            writable: true,
            configurable: true
          }});
        if (superClass)
          Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
      }
      var _MiniBus2 = require('./MiniBus');
      var _MiniBus3 = _interopRequireDefault(_MiniBus2);
      var MessageBus = (function(_MiniBus) {
        _inherits(MessageBus, _MiniBus);
        function MessageBus(registry) {
          _classCallCheck(this, MessageBus);
          _get(Object.getPrototypeOf(MessageBus.prototype), 'constructor', this).call(this);
          this._registry = registry;
        }
        _createClass(MessageBus, [{
          key: '_onPostMessage',
          value: function _onPostMessage(msg) {
            var _this = this;
            _this._registry.resolve(msg.to).then(function(protoStubURL) {
              var itemList = _this._subscriptions[protoStubURL];
              if (itemList) {
                _this._publishOn(itemList, msg);
              }
            })['catch'](function(e) {
              console.log('PROTO-STUB-ERROR: ', e);
            });
          }
        }]);
        return MessageBus;
      })(_MiniBus3['default']);
      exports['default'] = MessageBus;
      module.exports = exports['default'];
    }, {"./MiniBus": 2}],
    2: [function(require, module, exports) {
      'use strict';
      Object.defineProperty(exports, '__esModule', {value: true});
      var _createClass = (function() {
        function defineProperties(target, props) {
          for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];
            descriptor.enumerable = descriptor.enumerable || false;
            descriptor.configurable = true;
            if ('value' in descriptor)
              descriptor.writable = true;
            Object.defineProperty(target, descriptor.key, descriptor);
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
      function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
          throw new TypeError('Cannot call a class as a function');
        }
      }
      var MiniBus = (function() {
        function MiniBus() {
          _classCallCheck(this, MiniBus);
          var _this = this;
          _this._msgId = 0;
          _this._subscriptions = {};
          _this._responseTimeOut = 3000;
          _this._responseCallbacks = {};
          _this._registerExternalListener();
        }
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
        }, {
          key: 'addResponseListener',
          value: function addResponseListener(url, msgId, responseListener) {
            this._responseCallbacks[url + msgId] = responseListener;
          }
        }, {
          key: 'removeResponseListener',
          value: function removeResponseListener(url, msgId) {
            delete this._responseCallbacks[url + msgId];
          }
        }, {
          key: 'removeAllListenersOf',
          value: function removeAllListenersOf(url) {
            delete this._subscriptions[url];
          }
        }, {
          key: 'postMessage',
          value: function postMessage(msg, responseCallback) {
            var _this = this;
            if (!msg.id || msg.id === 0) {
              _this._msgId++;
              msg.id = _this._msgId;
            }
            if (responseCallback) {
              (function() {
                var responseId = msg.from + msg.id;
                _this._responseCallbacks[responseId] = responseCallback;
                setTimeout(function() {
                  var responseFun = _this._responseCallbacks[responseId];
                  delete _this._responseCallbacks[responseId];
                  if (responseFun) {
                    var errorMsg = {
                      id: msg.id,
                      type: 'response',
                      body: {
                        code: 'error',
                        desc: 'Response timeout!'
                      }
                    };
                    responseFun(errorMsg);
                  }
                }, _this._responseTimeOut);
              })();
            }
            if (!_this._onResponse(msg)) {
              var itemList = _this._subscriptions[msg.to];
              if (itemList) {
                _this._publishOn(itemList, msg);
              } else {
                _this._onPostMessage(msg);
              }
            }
            return msg.id;
          }
        }, {
          key: 'bind',
          value: function bind(outUrl, inUrl, target) {
            var _this2 = this;
            var _this = this;
            var thisListn = _this.addListener(outUrl, function(msg) {
              target.postMessage(msg);
            });
            var targetListn = target.addListener(inUrl, function(msg) {
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
        }, {
          key: '_publishOn',
          value: function _publishOn(itemList, msg) {
            itemList.forEach(function(sub) {
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
        }, {
          key: '_onMessage',
          value: function _onMessage(msg) {
            var _this = this;
            if (!_this._onResponse(msg)) {
              var itemList = _this._subscriptions[msg.to];
              if (itemList) {
                _this._publishOn(itemList, msg);
              } else {
                itemList = _this._subscriptions['*'];
                if (itemList) {
                  _this._publishOn(itemList, msg);
                }
              }
            }
          }
        }, {
          key: '_onPostMessage',
          value: function _onPostMessage(msg) {}
        }, {
          key: '_registerExternalListener',
          value: function _registerExternalListener() {}
        }]);
        return MiniBus;
      })();
      var MsgListener = (function() {
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
      exports['default'] = MiniBus;
      module.exports = exports['default'];
    }, {}],
    3: [function(require, module, exports) {
      'use strict';
      Object.defineProperty(exports, '__esModule', {value: true});
      var _createClass = (function() {
        function defineProperties(target, props) {
          for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];
            descriptor.enumerable = descriptor.enumerable || false;
            descriptor.configurable = true;
            if ('value' in descriptor)
              descriptor.writable = true;
            Object.defineProperty(target, descriptor.key, descriptor);
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
      function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
          throw new TypeError('Cannot call a class as a function');
        }
      }
      var IdentityModule = (function() {
        function IdentityModule() {
          _classCallCheck(this, IdentityModule);
        }
        _createClass(IdentityModule, [{
          key: 'registerIdentity',
          value: function registerIdentity() {}
        }, {
          key: 'registerWithRP',
          value: function registerWithRP() {}
        }, {
          key: 'loginWithRP',
          value: function loginWithRP(identifier, scope) {
            var VALIDURL = 'https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=';
            var USERINFURL = 'https://www.googleapis.com/oauth2/v1/userinfo?access_token=';
            var OAUTHURL = 'https://accounts.google.com/o/oauth2/auth?';
            var SCOPE = 'email%20profile';
            var CLIENTID = '808329566012-tqr8qoh111942gd2kg007t0s8f277roi.apps.googleusercontent.com';
            var REDIRECT = 'http://127.0.0.1:8080/';
            var LOGOUT = 'http://accounts.google.com/Logout';
            var TYPE = 'token';
            var _url = OAUTHURL + 'scope=' + SCOPE + '&client_id=' + CLIENTID + '&redirect_uri=' + REDIRECT + '&response_type=' + TYPE;
            var acToken = undefined;
            var tokenType = undefined;
            var expiresIn = undefined;
            var user = undefined;
            var tokenID = undefined;
            var loggedIn = false;
            function gup(url, name) {
              name = name.replace(/[\[]/, '\\\[').replace(/[\]]/, '\\\]');
              var regexS = '[\\#&]' + name + '=([^&#]*)';
              var regex = new RegExp(regexS);
              var results = regex.exec(url);
              if (results === null)
                return '';
              else
                return results[1];
            }
            return new Promise(function(resolve, reject) {
              function validateToken(token) {
                var req = new XMLHttpRequest();
                req.open('GET', VALIDURL + token, true);
                req.onreadystatechange = function(e) {
                  if (req.readyState == 4) {
                    if (req.status == 200) {
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
              function getIDToken(token) {
                var req = new XMLHttpRequest();
                req.open('GET', USERINFURL + token, true);
                req.onreadystatechange = function(e) {
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
              var win = window.open(_url, 'openIDrequest', 'width=800, height=600');
              var pollTimer = window.setInterval(function() {
                try {
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
                    validateToken(acToken);
                  }
                } catch (e) {}
              }, 500);
            });
          }
        }, {
          key: 'setHypertyIdentity',
          value: function setHypertyIdentity() {}
        }, {
          key: 'generateAssertion',
          value: function generateAssertion(contents, origin, usernameHint) {}
        }, {
          key: 'validateAssertion',
          value: function validateAssertion(assertion) {}
        }, {
          key: 'getAssertionTrustLevel',
          value: function getAssertionTrustLevel(assertion) {}
        }]);
        return IdentityModule;
      })();
      exports['default'] = IdentityModule;
      module.exports = exports['default'];
    }, {}],
    4: [function(require, module, exports) {
      'use strict';
      Object.defineProperty(exports, '__esModule', {value: true});
      var _createClass = (function() {
        function defineProperties(target, props) {
          for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];
            descriptor.enumerable = descriptor.enumerable || false;
            descriptor.configurable = true;
            if ('value' in descriptor)
              descriptor.writable = true;
            Object.defineProperty(target, descriptor.key, descriptor);
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
      function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
          throw new TypeError('Cannot call a class as a function');
        }
      }
      var PolicyEngine = (function() {
        function PolicyEngine(identityModule, runtimeRegistry) {
          _classCallCheck(this, PolicyEngine);
          var _this = this;
          _this.idModule = identityModule;
          _this.registry = runtimeRegistry;
          _this.policiesTable = new Object();
          _this.blacklist = [];
        }
        _createClass(PolicyEngine, [{
          key: 'addPolicies',
          value: function addPolicies(hyperty, policies) {
            var _this = this;
            _this.policiesTable[hyperty] = policies;
          }
        }, {
          key: 'removePolicies',
          value: function removePolicies(hyperty) {
            var _this = this;
            delete _this.policiesTable[hyperty];
          }
        }, {
          key: 'authorise',
          value: function authorise(message) {
            var _this = this;
            console.log(_this.policiesTable);
            return new Promise(function(resolve, reject) {
              if (_this.checkPolicies(message) == 'allow') {
                _this.idModule.loginWithRP('google identity', 'scope').then(function(value) {
                  message.body.assertedIdentity = JSON.stringify(value);
                  message.body.authorised = true;
                  resolve(message);
                }, function(error) {
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
            var _results = ['allow'];
            var _policies = _this.policiesTable[message.body.hypertyURL];
            if (_policies != undefined) {
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
              return 'deny';
            } else {
              return 'allow';
            }
          }
        }]);
        return PolicyEngine;
      })();
      exports['default'] = PolicyEngine;
      module.exports = exports['default'];
    }, {}],
    5: [function(require, module, exports) {
      'use strict';
      Object.defineProperty(exports, '__esModule', {value: true});
      var _createClass = (function() {
        function defineProperties(target, props) {
          for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];
            descriptor.enumerable = descriptor.enumerable || false;
            descriptor.configurable = true;
            if ('value' in descriptor)
              descriptor.writable = true;
            Object.defineProperty(target, descriptor.key, descriptor);
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
      function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
          throw new TypeError('Cannot call a class as a function');
        }
      }
      var AddressAllocation = (function() {
        function AddressAllocation(url, bus) {
          _classCallCheck(this, AddressAllocation);
          var _this = this;
          _this._url = url;
          _this._bus = bus;
        }
        _createClass(AddressAllocation, [{
          key: 'create',
          value: function create(domain, number) {
            var _this = this;
            var msg = {
              type: 'create',
              from: _this._url,
              to: 'domain://msg-node.' + domain + '/hyperty-address-allocation',
              body: {number: number}
            };
            return new Promise(function(resolve, reject) {
              _this._bus.postMessage(msg, function(reply) {
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
      exports['default'] = AddressAllocation;
      module.exports = exports['default'];
    }, {}],
    6: [function(require, module, exports) {
      'use strict';
      Object.defineProperty(exports, '__esModule', {value: true});
      var _createClass = (function() {
        function defineProperties(target, props) {
          for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];
            descriptor.enumerable = descriptor.enumerable || false;
            descriptor.configurable = true;
            if ('value' in descriptor)
              descriptor.writable = true;
            Object.defineProperty(target, descriptor.key, descriptor);
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
      var _get = function get(_x, _x2, _x3) {
        var _again = true;
        _function: while (_again) {
          var object = _x,
              property = _x2,
              receiver = _x3;
          _again = false;
          if (object === null)
            object = Function.prototype;
          var desc = Object.getOwnPropertyDescriptor(object, property);
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
          } else if ('value' in desc) {
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
      function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {'default': obj};
      }
      function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
          throw new TypeError('Cannot call a class as a function');
        }
      }
      function _inherits(subClass, superClass) {
        if (typeof superClass !== 'function' && superClass !== null) {
          throw new TypeError('Super expression must either be null or a function, not ' + typeof superClass);
        }
        subClass.prototype = Object.create(superClass && superClass.prototype, {constructor: {
            value: subClass,
            enumerable: false,
            writable: true,
            configurable: true
          }});
        if (superClass)
          Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
      }
      var _utilsEventEmitter = require('../utils/EventEmitter');
      var _utilsEventEmitter2 = _interopRequireDefault(_utilsEventEmitter);
      var _AddressAllocation = require('./AddressAllocation');
      var _AddressAllocation2 = _interopRequireDefault(_AddressAllocation);
      var _utilsUtilsJs = require('../utils/utils.js');
      var Registry = (function(_EventEmitter) {
        _inherits(Registry, _EventEmitter);
        function Registry(runtimeURL, appSandbox, remoteRegistry) {
          _classCallCheck(this, Registry);
          _get(Object.getPrototypeOf(Registry.prototype), 'constructor', this).call(this);
          if (!runtimeURL)
            throw new Error('runtimeURL is missing.');
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
        _createClass(Registry, [{
          key: 'getAppSandbox',
          value: function getAppSandbox() {
            var _this = this;
            return _this.appSandbox;
          }
        }, {
          key: 'registerHyperty',
          value: function registerHyperty(sandbox, descriptor) {
            var _this = this;
            var domainUrl = (0, _utilsUtilsJs.divideURL)(descriptor).domain;
            var hypertyIdentity = domainUrl + '/identity';
            var promise = new Promise(function(resolve, reject) {
              if (_this._messageBus === undefined) {
                reject('MessageBus not found on registerStub');
              } else {
                return _this.resolve('hyperty-runtime://' + domainUrl).then(function() {
                  if (_this.hypertiesList.hasOwnProperty(domainUrl)) {
                    _this.hypertiesList[domainUrl] = {identity: hypertyIdentity};
                  }
                  if (!_this.sandboxesList.hasOwnProperty(domainUrl)) {
                    _this.sandboxesList[domainUrl] = sandbox;
                    sandbox.addListener('*', function(msg) {
                      _this._messageBus.postMessage(msg);
                    });
                  }
                  var numberOfAddresses = 1;
                  _this.addressAllocation.create(domainUrl, numberOfAddresses).then(function(adderessList) {
                    adderessList.forEach(function(address) {
                      _this._messageBus.addListener(address + '/status', function(msg) {
                        console.log('Message addListener for : ', address + '/status -> ' + msg);
                      });
                    });
                    resolve(adderessList[0]);
                  })['catch'](function(reason) {
                    console.log('Address Reason: ', reason);
                    reject(reason);
                  });
                });
              }
            });
            return promise;
          }
        }, {
          key: 'unregisterHyperty',
          value: function unregisterHyperty(url) {
            var _this = this;
            var promise = new Promise(function(resolve, reject) {
              var request = _this.hypertiesList[url];
              if (request === undefined) {
                reject('Hyperty not found');
              } else {
                resolve('Hyperty successfully deleted');
              }
            });
            return promise;
          }
        }, {
          key: 'discoverProtostub',
          value: function discoverProtostub(url) {
            if (!url)
              throw new Error('Parameter url needed');
            var _this = this;
            var promise = new Promise(function(resolve, reject) {
              var request = _this.protostubsList[url];
              if (request === undefined) {
                reject('requestUpdate couldn\' get the ProtostubURL');
              } else {
                resolve(request);
              }
            });
            return promise;
          }
        }, {
          key: 'registerStub',
          value: function registerStub(sandbox, domainURL) {
            var _this = this;
            var runtimeProtoStubURL;
            var promise = new Promise(function(resolve, reject) {
              if (_this._messageBus === undefined) {
                reject('MessageBus not found on registerStub');
              }
              if (!domainURL.indexOf('msg-node.')) {
                domainURL = domainURL.substring(domainURL.indexOf('.') + 1);
              }
              runtimeProtoStubURL = 'msg-node.' + domainURL + '/protostub/' + Math.floor(Math.random() * 10000 + 1);
              _this.protostubsList[domainURL] = runtimeProtoStubURL;
              _this.sandboxesList[runtimeProtoStubURL] = sandbox;
              resolve(runtimeProtoStubURL);
              _this._messageBus.addListener(runtimeProtoStubURL + '/status', function(msg) {
                if (msg.resource === msg.to + '/status') {
                  console.log('RuntimeProtostubURL/status message: ', msg.body.value);
                }
              });
            });
            return promise;
          }
        }, {
          key: 'unregisterStub',
          value: function unregisterStub(hypertyRuntimeURL) {
            var _this = this;
            var runtimeProtoStubURL;
            var promise = new Promise(function(resolve, reject) {
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
        }, {
          key: 'registerPEP',
          value: function registerPEP(postMessage, hyperty) {
            var _this = this;
            var promise = new Promise(function(resolve, reject) {
              _this.pepList[hyperty] = postMessage;
              resolve('PEP registered with success');
            });
            return promise;
          }
        }, {
          key: 'unregisterPEP',
          value: function unregisterPEP(HypertyRuntimeURL) {
            var _this = this;
            var promise = new Promise(function(resolve, reject) {
              var result = _this.pepList[HypertyRuntimeURL];
              if (result === undefined) {
                reject('Pep Not found.');
              } else {
                resolve('PEP successfully removed.');
              }
            });
            return promise;
          }
        }, {
          key: 'onEvent',
          value: function onEvent(event) {}
        }, {
          key: 'getSandbox',
          value: function getSandbox(url) {
            if (!url)
              throw new Error('Parameter url needed');
            var _this = this;
            var promise = new Promise(function(resolve, reject) {
              var request = _this.sandboxesList[url];
              if (request === undefined) {
                reject('Sandbox not found');
              } else {
                resolve(request);
              }
            });
            return promise;
          }
        }, {
          key: 'resolve',
          value: function resolve(url) {
            console.log('resolve ' + url);
            var _this = this;
            var domainUrl = (0, _utilsUtilsJs.divideURL)(url).domain;
            var promise = new Promise(function(resolve, reject) {
              if (!domainUrl.indexOf('msg-node.')) {
                domainUrl = domainUrl.substring(domainUrl.indexOf('.') + 1);
              }
              var request = _this.protostubsList[domainUrl];
              _this.addEventListener('runtime:stubLoaded', function(domainUrl) {
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
          set: function set(messageBus) {
            var _this = this;
            _this._messageBus = messageBus;
            var addressAllocation = new _AddressAllocation2['default'](_this.registryURL, messageBus);
            _this.addressAllocation = addressAllocation;
          }
        }]);
        return Registry;
      })(_utilsEventEmitter2['default']);
      exports['default'] = Registry;
      module.exports = exports['default'];
    }, {
      "../utils/EventEmitter": 14,
      "../utils/utils.js": 15,
      "./AddressAllocation": 5
    }],
    7: [function(require, module, exports) {
      'use strict';
      Object.defineProperty(exports, '__esModule', {value: true});
      function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {'default': obj};
      }
      var _runtimeRuntimeUA = require('./runtime/RuntimeUA');
      var _runtimeRuntimeUA2 = _interopRequireDefault(_runtimeRuntimeUA);
      var _sandboxSandbox = require('./sandbox/Sandbox');
      var _sandboxSandbox2 = _interopRequireDefault(_sandboxSandbox);
      var _busMiniBus = require('./bus/MiniBus');
      var _busMiniBus2 = _interopRequireDefault(_busMiniBus);
      var _sandboxSandboxRegistry = require('./sandbox/SandboxRegistry');
      var _sandboxSandboxRegistry2 = _interopRequireDefault(_sandboxSandboxRegistry);
      exports.RuntimeUA = _runtimeRuntimeUA2['default'];
      exports.Sandbox = _sandboxSandbox2['default'];
      exports.MiniBus = _busMiniBus2['default'];
      exports.SandboxRegistry = _sandboxSandboxRegistry2['default'];
    }, {
      "./bus/MiniBus": 2,
      "./runtime/RuntimeUA": 9,
      "./sandbox/Sandbox": 10,
      "./sandbox/SandboxRegistry": 11
    }],
    8: [function(require, module, exports) {
      'use strict';
      Object.defineProperty(exports, '__esModule', {value: true});
      var _createClass = (function() {
        function defineProperties(target, props) {
          for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];
            descriptor.enumerable = descriptor.enumerable || false;
            descriptor.configurable = true;
            if ('value' in descriptor)
              descriptor.writable = true;
            Object.defineProperty(target, descriptor.key, descriptor);
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
      function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
          throw new TypeError('Cannot call a class as a function');
        }
      }
      var RuntimeCatalogue = (function() {
        function RuntimeCatalogue() {
          _classCallCheck(this, RuntimeCatalogue);
          console.log('runtime catalogue');
        }
        _createClass(RuntimeCatalogue, [{
          key: 'getHypertyRuntimeURL',
          value: function getHypertyRuntimeURL() {
            return _hypertyRuntimeURL;
          }
        }, {
          key: '_makeExternalRequest',
          value: function _makeExternalRequest(url) {
            var _this = this;
            return new Promise(function(resolve, reject) {
              var xhr = new XMLHttpRequest();
              xhr.onreadystatechange = function(event) {
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
        }, {
          key: 'getHypertyDescriptor',
          value: function getHypertyDescriptor(hypertyURL) {
            var _this = this;
            return new Promise(function(resolve, reject) {
              var hypertyName = hypertyURL.substr(hypertyURL.lastIndexOf('/') + 1);
              var hypertyDescriptor = {
                guid: 'guid',
                id: 'idHyperty',
                classname: hypertyName,
                description: 'description of ' + hypertyName,
                kind: 'hyperty',
                catalogueURL: '....',
                sourceCode: '../resources/' + hypertyName + '.ES5.js',
                dataObject: '',
                type: '',
                messageSchema: '',
                configuration: {runtimeURL: _this._runtimeURL},
                policies: '',
                constraints: '',
                hypertyCapabilities: '',
                protocolCapabilities: ''
              };
              resolve(hypertyDescriptor);
            });
          }
        }, {
          key: 'getHypertySourceCode',
          value: function getHypertySourceCode(hypertySourceCodeURL) {
            var _this = this;
            return new Promise(function(resolve, reject) {
              _this._makeExternalRequest(hypertySourceCodeURL).then(function(result) {
                resolve(result);
              })['catch'](function(reason) {
                reject(reason);
              });
            });
          }
        }, {
          key: 'getStubDescriptor',
          value: function getStubDescriptor(domainURL) {
            var _this = this;
            return new Promise(function(resolve, reject) {
              var stubDescriptor = {
                guid: 'guid',
                id: 'idProtoStub',
                classname: 'VertxProtoStub',
                description: 'description of ProtoStub',
                kind: 'hyperty',
                catalogueURL: '....',
                sourceCode: '../resources/VertxProtoStub.js',
                dataObject: '',
                type: '',
                messageSchema: '',
                configuration: {
                  url: 'ws://localhost:9090/ws',
                  runtimeURL: _this._runtimeURL
                },
                policies: '',
                constraints: '',
                hypertyCapabilities: '',
                protocolCapabilities: ''
              };
              resolve(stubDescriptor);
            });
          }
        }, {
          key: 'getStubSourceCode',
          value: function getStubSourceCode(stubSourceCodeURL) {
            var _this = this;
            return new Promise(function(resolve, reject) {
              _this._makeExternalRequest(stubSourceCodeURL).then(function(result) {
                resolve(result);
              })['catch'](function(reason) {
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
      exports['default'] = RuntimeCatalogue;
      module.exports = exports['default'];
    }, {}],
    9: [function(require, module, exports) {
      'use strict';
      Object.defineProperty(exports, '__esModule', {value: true});
      var _createClass = (function() {
        function defineProperties(target, props) {
          for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];
            descriptor.enumerable = descriptor.enumerable || false;
            descriptor.configurable = true;
            if ('value' in descriptor)
              descriptor.writable = true;
            Object.defineProperty(target, descriptor.key, descriptor);
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
      function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {'default': obj};
      }
      function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
          throw new TypeError('Cannot call a class as a function');
        }
      }
      var _registryRegistry = require('../registry/Registry');
      var _registryRegistry2 = _interopRequireDefault(_registryRegistry);
      var _identityIdentityModule = require('../identity/IdentityModule');
      var _identityIdentityModule2 = _interopRequireDefault(_identityIdentityModule);
      var _policyPolicyEngine = require('../policy/PolicyEngine');
      var _policyPolicyEngine2 = _interopRequireDefault(_policyPolicyEngine);
      var _busMessageBus = require('../bus/MessageBus');
      var _busMessageBus2 = _interopRequireDefault(_busMessageBus);
      var _RuntimeCatalogue = require('./RuntimeCatalogue');
      var _RuntimeCatalogue2 = _interopRequireDefault(_RuntimeCatalogue);
      var _syncherSyncherManager = require('../syncher/SyncherManager');
      var _syncherSyncherManager2 = _interopRequireDefault(_syncherSyncherManager);
      var RuntimeUA = (function() {
        function RuntimeUA(sandboxFactory) {
          _classCallCheck(this, RuntimeUA);
          if (!sandboxFactory)
            throw new Error('The sandbox factory is a needed parameter');
          var _this = this;
          _this.sandboxFactory = sandboxFactory;
          _this.runtimeCatalogue = new _RuntimeCatalogue2['default']();
          var runtimeURL = 'runtime://ua.pt/' + Math.floor(Math.random() * 10000 + 1);
          _this.runtimeURL = runtimeURL;
          _this.runtimeCatalogue.runtimeURL = runtimeURL;
          var appSandbox = sandboxFactory.createAppSandbox();
          _this.identityModule = new _identityIdentityModule2['default']();
          _this.policyEngine = new _policyPolicyEngine2['default']();
          _this.registry = new _registryRegistry2['default'](runtimeURL, appSandbox);
          _this.messageBus = new _busMessageBus2['default'](_this.registry);
          _this.registry.messageBus = _this.messageBus;
          _this.registry.addEventListener('runtime:loadStub', function(domainURL) {
            _this.loadStub(domainURL).then(function(result) {
              _this.registry.trigger('runtime:stubLoaded', domainURL);
            })['catch'](function(reason) {
              console.error(reason);
            });
          });
          sandboxFactory.messageBus = _this.messageBus;
          _this.syncherManager = new _syncherSyncherManager2['default'](_this.runtimeURL, _this.messageBus, {});
        }
        _createClass(RuntimeUA, [{
          key: 'discoverHiperty',
          value: function discoverHiperty(descriptor) {}
        }, {
          key: 'registerHyperty',
          value: function registerHyperty(hypertyInstance, descriptor) {}
        }, {
          key: 'loadHyperty',
          value: function loadHyperty(hypertyDescriptorURL) {
            var _this = this;
            if (!hypertyDescriptorURL)
              throw new Error('Hyperty descriptor url parameter is needed');
            return new Promise(function(resolve, reject) {
              var _hypertyURL = undefined;
              var _hypertySandbox = undefined;
              var _hypertyDescriptor = undefined;
              var _hypertySourceCode = undefined;
              var errorReason = function errorReason(reason) {
                console.error(reason);
                reject(reason);
              };
              console.log('------------------ Hyperty ------------------------');
              console.info('Get hyperty descriptor for :', hypertyDescriptorURL);
              _this.runtimeCatalogue.getHypertyDescriptor(hypertyDescriptorURL).then(function(hypertyDescriptor) {
                console.info('1: return hyperty descriptor', hypertyDescriptor);
                _hypertyDescriptor = hypertyDescriptor;
                var hypertySourceCodeUrl = hypertyDescriptor.sourceCode;
                return _this.runtimeCatalogue.getHypertySourceCode(hypertySourceCodeUrl);
              }).then(function(hypertySourceCode) {
                console.info('2: return hyperty source code');
                _hypertySourceCode = hypertySourceCode;
                var policy = true;
                return policy;
              }).then(function(policyResult) {
                console.info('3: return policy engine result');
                var inSameSandbox = true;
                var sandbox = undefined;
                if (inSameSandbox) {
                  sandbox = _this.registry.getAppSandbox();
                } else {
                  sandbox = _this.registry.getSandbox(domain);
                }
                return sandbox;
              }).then(function(sandbox) {
                console.info('4: return the sandbox', sandbox);
                return sandbox;
              }, function(reason) {
                console.info('4.1: try to register a new sandbox', reason);
                return _this.sandboxFactory.createSandbox();
              }).then(function(sandbox) {
                console.info('5: return sandbox and register');
                _hypertySandbox = sandbox;
                return _this.registry.registerHyperty(sandbox, hypertyDescriptorURL);
              }).then(function(hypertyURL) {
                console.info('6: Hyperty url, after register hyperty', hypertyURL);
                _hypertyURL = hypertyURL;
                return _hypertySandbox.deployComponent(_hypertySourceCode, _hypertyURL, _hypertyDescriptor.configuration);
              }).then(function(deployComponentStatus) {
                console.info('7: Deploy component status for hyperty: ', _hypertyURL);
                _this.messageBus.addListener(_hypertyURL, function(msg) {
                  _hypertySandbox.postMessage(msg);
                });
                var hyperty = {
                  runtimeHypertyURL: _hypertyURL,
                  status: 'Deployed'
                };
                resolve(hyperty);
                console.log('------------------ END ------------------------');
              })['catch'](errorReason);
            });
          }
        }, {
          key: 'loadStub',
          value: function loadStub(domain) {
            var _this = this;
            if (!domain)
              throw new Error('domain parameter is needed');
            return new Promise(function(resolve, reject) {
              var _stubSandbox = undefined;
              var _stubDescriptor = undefined;
              var _runtimeProtoStubURL = undefined;
              var _protoStubSourceCode = undefined;
              var errorReason = function errorReason(reason) {
                console.error(reason);
                reject(reason);
              };
              console.info('------------------- ProtoStub ---------------------------\n');
              console.info('Discover or Create a new ProtoStub for domain: ', domain);
              _this.registry.discoverProtostub(domain).then(function(descriptor) {
                console.info('1. Proto Stub Discovered: ', descriptor);
                _stubDescriptor = descriptor;
                return _stubDescriptor;
              }, function(reason) {
                console.info('1. Proto Stub not found:', reason);
                return _this.runtimeCatalogue.getStubDescriptor(domain);
              }).then(function(descriptor) {
                console.info('2. return the ProtoStub descriptor:', descriptor);
                _stubDescriptor = descriptor;
                var componentDownloadURL = descriptor.sourceCode;
                return _this.runtimeCatalogue.getStubSourceCode(componentDownloadURL);
              }).then(function(protoStubSourceCode) {
                console.info('3. return the ProtoStub Source Code: ');
                _protoStubSourceCode = protoStubSourceCode;
                var policy = true;
                return policy;
              }).then(function(policy) {
                return _this.registry.getSandbox(domain);
              }).then(function(stubSandbox) {
                console.info('4. if the sandbox is registered then return the sandbox', stubSandbox);
                _stubSandbox = stubSandbox;
                return stubSandbox;
              }, function(reason) {
                console.info('5. Sandbox was not found, creating a new one');
                return _this.sandboxFactory.createSandbox();
              }).then(function(sandbox) {
                console.info('6. return the sandbox instance and the register', sandbox);
                _stubSandbox = sandbox;
                return _this.registry.registerStub(_stubSandbox, domain);
              }).then(function(runtimeProtoStubURL) {
                console.info('7. return the runtime protostub url: ', runtimeProtoStubURL);
                _runtimeProtoStubURL = runtimeProtoStubURL;
                return _stubSandbox.deployComponent(_protoStubSourceCode, runtimeProtoStubURL, _stubDescriptor.configuration);
              }).then(function(result) {
                console.info('8: return deploy component for sandbox status');
                _this.messageBus.addListener(_runtimeProtoStubURL, function(msg) {
                  _stubSandbox.postMessage(msg);
                });
                _stubSandbox.addListener('*', function(msg) {
                  _this.messageBus.postMessage(msg);
                });
                var stub = {
                  runtimeProtoStubURL: _runtimeProtoStubURL,
                  status: 'Deployed'
                };
                resolve(stub);
                console.info('------------------- END ---------------------------\n');
              })['catch'](errorReason);
            });
          }
        }, {
          key: 'checkForUpdate',
          value: function checkForUpdate(url) {}
        }]);
        return RuntimeUA;
      })();
      exports['default'] = RuntimeUA;
      module.exports = exports['default'];
    }, {
      "../bus/MessageBus": 1,
      "../identity/IdentityModule": 3,
      "../policy/PolicyEngine": 4,
      "../registry/Registry": 6,
      "../syncher/SyncherManager": 13,
      "./RuntimeCatalogue": 8
    }],
    10: [function(require, module, exports) {
      'use strict';
      Object.defineProperty(exports, '__esModule', {value: true});
      var _createClass = (function() {
        function defineProperties(target, props) {
          for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];
            descriptor.enumerable = descriptor.enumerable || false;
            descriptor.configurable = true;
            if ('value' in descriptor)
              descriptor.writable = true;
            Object.defineProperty(target, descriptor.key, descriptor);
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
      var _get = function get(_x, _x2, _x3) {
        var _again = true;
        _function: while (_again) {
          var object = _x,
              property = _x2,
              receiver = _x3;
          _again = false;
          if (object === null)
            object = Function.prototype;
          var desc = Object.getOwnPropertyDescriptor(object, property);
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
          } else if ('value' in desc) {
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
      function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {'default': obj};
      }
      function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
          throw new TypeError('Cannot call a class as a function');
        }
      }
      function _inherits(subClass, superClass) {
        if (typeof superClass !== 'function' && superClass !== null) {
          throw new TypeError('Super expression must either be null or a function, not ' + typeof superClass);
        }
        subClass.prototype = Object.create(superClass && superClass.prototype, {constructor: {
            value: subClass,
            enumerable: false,
            writable: true,
            configurable: true
          }});
        if (superClass)
          Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
      }
      var _sandboxSandboxRegistry = require('../sandbox/SandboxRegistry');
      var _sandboxSandboxRegistry2 = _interopRequireDefault(_sandboxSandboxRegistry);
      var _busMiniBus = require('../bus/MiniBus');
      var _busMiniBus2 = _interopRequireDefault(_busMiniBus);
      var Sandbox = (function(_MiniBus) {
        _inherits(Sandbox, _MiniBus);
        function Sandbox() {
          _classCallCheck(this, Sandbox);
          _get(Object.getPrototypeOf(Sandbox.prototype), 'constructor', this).call(this);
          var _this = this;
        }
        _createClass(Sandbox, [{
          key: 'deployComponent',
          value: function deployComponent(componentSourceCode, componentURL, configuration) {
            var _this = this;
            return new Promise(function(resolve, reject) {
              var deployMessage = {
                type: 'create',
                from: _sandboxSandboxRegistry2['default'].ExternalDeployAddress,
                to: _sandboxSandboxRegistry2['default'].InternalDeployAddress,
                body: {
                  url: componentURL,
                  sourceCode: componentSourceCode,
                  config: configuration
                }
              };
              _this.postMessage(deployMessage, function(reply) {
                if (reply.body.code === 200) {
                  resolve('deployed');
                } else {
                  reject(reply.body.desc);
                }
              });
            });
          }
        }, {
          key: 'removeComponent',
          value: function removeComponent(componentURL) {
            var _this = this;
            return new Promise(function(resolve, reject) {
              var removeMessage = {
                type: 'delete',
                from: _sandboxSandboxRegistry2['default'].ExternalDeployAddress,
                to: _sandboxSandboxRegistry2['default'].InternalDeployAddress,
                body: {url: componentURL}
              };
              _this.postMessage(removeMessage, function(reply) {
                if (reply.body.code === 200) {
                  resolve('undeployed');
                } else {
                  reject(reply.body.desc);
                }
              });
            });
          }
        }]);
        return Sandbox;
      })(_busMiniBus2['default']);
      exports['default'] = Sandbox;
      module.exports = exports['default'];
    }, {
      "../bus/MiniBus": 2,
      "../sandbox/SandboxRegistry": 11
    }],
    11: [function(require, module, exports) {
      'use strict';
      Object.defineProperty(exports, '__esModule', {value: true});
      var _createClass = (function() {
        function defineProperties(target, props) {
          for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];
            descriptor.enumerable = descriptor.enumerable || false;
            descriptor.configurable = true;
            if ('value' in descriptor)
              descriptor.writable = true;
            Object.defineProperty(target, descriptor.key, descriptor);
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
      function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
          throw new TypeError('Cannot call a class as a function');
        }
      }
      var SandboxRegistry = (function() {
        function SandboxRegistry(bus) {
          _classCallCheck(this, SandboxRegistry);
          var _this = this;
          _this._bus = bus;
          _this._components = {};
          bus.addListener(SandboxRegistry.InternalDeployAddress, function(msg) {
            switch (msg.type) {
              case 'create':
                _this._onDeploy(msg);
                break;
              case 'delete':
                _this._onRemove(msg);
                break;
            }
          });
        }
        _createClass(SandboxRegistry, [{
          key: '_responseMsg',
          value: function _responseMsg(msg, code, value) {
            var _this = this;
            var responseMsg = {
              id: msg.id,
              type: 'response',
              from: SandboxRegistry.InternalDeployAddress,
              to: SandboxRegistry.ExternalDeployAddress
            };
            var body = {};
            if (code)
              body.code = code;
            if (value)
              body.desc = value;
            responseMsg.body = body;
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
        }, {
          key: '_create',
          value: function _create(url, sourceCode, config) {}
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
      exports['default'] = SandboxRegistry;
      module.exports = exports['default'];
    }, {}],
    12: [function(require, module, exports) {
      'use strict';
      Object.defineProperty(exports, '__esModule', {value: true});
      var _createClass = (function() {
        function defineProperties(target, props) {
          for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];
            descriptor.enumerable = descriptor.enumerable || false;
            descriptor.configurable = true;
            if ('value' in descriptor)
              descriptor.writable = true;
            Object.defineProperty(target, descriptor.key, descriptor);
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
      function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
          throw new TypeError('Cannot call a class as a function');
        }
      }
      var ObjectAllocation = (function() {
        function ObjectAllocation(url, bus) {
          _classCallCheck(this, ObjectAllocation);
          var _this = this;
          _this._url = url;
          _this._bus = bus;
        }
        _createClass(ObjectAllocation, [{
          key: 'create',
          value: function create(domain, number) {
            var _this = this;
            var msg = {
              type: 'create',
              from: _this._url,
              to: 'domain://msg-node.' + domain + '/object-address-allocation',
              body: {number: number}
            };
            return new Promise(function(resolve, reject) {
              _this._bus.postMessage(msg, function(reply) {
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
      exports['default'] = ObjectAllocation;
      module.exports = exports['default'];
    }, {}],
    13: [function(require, module, exports) {
      'use strict';
      Object.defineProperty(exports, '__esModule', {value: true});
      var _createClass = (function() {
        function defineProperties(target, props) {
          for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];
            descriptor.enumerable = descriptor.enumerable || false;
            descriptor.configurable = true;
            if ('value' in descriptor)
              descriptor.writable = true;
            Object.defineProperty(target, descriptor.key, descriptor);
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
      function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {'default': obj};
      }
      function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
          throw new TypeError('Cannot call a class as a function');
        }
      }
      var _utilsUtils = require('../utils/utils');
      var _ObjectAllocation = require('./ObjectAllocation');
      var _ObjectAllocation2 = _interopRequireDefault(_ObjectAllocation);
      var SyncherManager = (function() {
        function SyncherManager(runtimeURL, bus, registry, allocator) {
          _classCallCheck(this, SyncherManager);
          var _this = this;
          _this._domain = 'ua.pt';
          _this._bus = bus;
          _this._registry = registry;
          _this._url = runtimeURL + '/sm';
          _this._objectURL = runtimeURL + '/object-allocation';
          _this._subscriptions = {};
          if (allocator) {
            _this._allocator = allocator;
          } else {
            _this._allocator = new _ObjectAllocation2['default'](_this._objectURL, bus);
          }
          bus.addListener(_this._url, function(msg) {
            console.log('SyncherManager-RCV: ', msg);
            switch (msg.type) {
              case 'create':
                _this._onCreate(msg);
                break;
              case 'delete':
                _this._onDelete(msg);
                break;
            }
          });
        }
        _createClass(SyncherManager, [{
          key: '_onCreate',
          value: function _onCreate(msg) {
            var _this = this;
            var owner = msg.from;
            _this._allocator.create(_this._domain, 1).then(function(allocated) {
              var objURL = allocated[0];
              var objSubscriptorURL = objURL + '/subscription';
              var changeListener = _this._bus.addListener(objURL, function(msg) {
                console.log(objURL + '-RCV: ', msg);
                _this._subscriptions[objURL].subs.forEach(function(hypertyUrl) {
                  var changeMsg = (0, _utilsUtils.deepClone)(msg);
                  changeMsg.id = 0;
                  changeMsg.from = objURL;
                  changeMsg.to = hypertyUrl;
                  _this._bus.postMessage(changeMsg);
                });
              });
              var subscriptorListener = _this._bus.addListener(objSubscriptorURL, function(msg) {
                console.log(objSubscriptorURL + '-RCV: ', msg);
                switch (msg.type) {
                  case 'subscribe':
                    _this._onSubscribe(objURL, msg);
                    break;
                  case 'unsubscribe':
                    _this._onUnSubscribe(objURL, msg);
                    break;
                }
              });
              _this._subscriptions[objURL] = {
                owner: owner,
                sl: subscriptorListener,
                cl: changeListener,
                subs: []
              };
              _this._bus.postMessage({
                id: msg.id,
                type: 'response',
                from: msg.to,
                to: owner,
                body: {
                  code: 200,
                  resource: objURL
                }
              });
              setTimeout(function() {
                msg.body.authorise.forEach(function(hypertyURL) {
                  _this._bus.postMessage({
                    type: 'create',
                    from: owner,
                    to: hypertyURL,
                    body: {
                      schema: msg.body.schema,
                      resource: objURL,
                      value: msg.body.value
                    }
                  });
                });
              });
            })['catch'](function(reason) {
              _this._bus.postMessage({
                id: msg.id,
                type: 'response',
                from: msg.to,
                to: owner,
                body: {
                  code: 500,
                  desc: reason
                }
              });
            });
          }
        }, {
          key: '_onDelete',
          value: function _onDelete(msg) {
            var _this = this;
            var objURL = '<objURL>';
            delete _this._subscriptions[objURL];
            _this._bus.removeAllListenersOf(objURL);
            _this._bus.removeAllListenersOf(objURL + '/subscription');
          }
        }, {
          key: '_onSubscribe',
          value: function _onSubscribe(objURL, msg) {
            var _this = this;
            var hypertyUrl = msg.from;
            var subscription = _this._subscriptions[objURL];
            if (subscription[hypertyUrl]) {
              var errorMsg = {
                id: msg.id,
                type: 'response',
                from: msg.to,
                to: hypertyUrl,
                body: {
                  code: 500,
                  desc: 'Subscription for (' + objURL + ' : ' + hypertyUrl + ') already exists!'
                }
              };
              _this._bus.postMessage(errorMsg);
              return;
            }
            var mode = 'sub/pub';
            if (mode === 'sub/pub') {
              var forwardMsg = {
                type: 'forward',
                from: _this._url,
                to: subscription.owner,
                body: {
                  type: msg.type,
                  from: msg.from,
                  to: objURL
                }
              };
              if (msg.body) {
                forwardMsg.body.body = msg.body;
              }
              _this._bus.postMessage(forwardMsg, function(reply) {
                console.log('forward-reply: ', reply);
                if (reply.body.code === 200) {
                  _this._subscriptions[objURL].subs.push(hypertyUrl);
                }
                _this._bus.postMessage({
                  id: msg.id,
                  type: 'response',
                  from: msg.to,
                  to: hypertyUrl,
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
          }
        }, {
          key: 'url',
          get: function get() {
            return this._url;
          }
        }]);
        return SyncherManager;
      })();
      exports['default'] = SyncherManager;
      module.exports = exports['default'];
    }, {
      "../utils/utils": 15,
      "./ObjectAllocation": 12
    }],
    14: [function(require, module, exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {value: true});
      var _createClass = (function() {
        function defineProperties(target, props) {
          for (var i = 0; i < props.length; i++) {
            var descriptor = props[i];
            descriptor.enumerable = descriptor.enumerable || false;
            descriptor.configurable = true;
            if ("value" in descriptor)
              descriptor.writable = true;
            Object.defineProperty(target, descriptor.key, descriptor);
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
      function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
          throw new TypeError("Cannot call a class as a function");
        }
      }
      var EventEmitter = (function() {
        function EventEmitter() {
          _classCallCheck(this, EventEmitter);
        }
        _createClass(EventEmitter, [{
          key: "addEventListener",
          value: function addEventListener(eventType, cb) {
            var _this = this;
            _this[eventType] = cb;
          }
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
      exports["default"] = EventEmitter;
      module.exports = exports["default"];
    }, {}],
    15: [function(require, module, exports) {
      'use strict';
      Object.defineProperty(exports, '__esModule', {value: true});
      exports.divideURL = divideURL;
      exports.deepClone = deepClone;
      function divideURL(url) {
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
        return JSON.parse(JSON.stringify(obj));
      }
    }, {}]
  }, {}, [7])(7);
});

_removeDefine();
})();
(function() {
var _removeDefine = $__System.get("@@amd-helpers").createDefine();
define("3", ["2"], function(main) {
  return main;
});

_removeDefine();
})();
$__System.register('1', ['3'], function (_export) {
    'use strict';

    var MiniBus, SandboxRegistry;
    return {
        setters: [function (_) {
            MiniBus = _.MiniBus;
            SandboxRegistry = _.SandboxRegistry;
        }],
        execute: function () {

            self._miniBus = new MiniBus();
            self._miniBus._onPostMessage = function (msg) {
                var response = {
                    body: {
                        code: msg.body.code,
                        desc: msg.body.desc ? msg.body.desc.toString() : null
                    },
                    from: msg.from,
                    to: msg.to,
                    id: msg.id,
                    type: msg.type
                };

                self.postMessage(response);
            };
            self.addEventListener('message', function (event) {
                self._miniBus._onMessage(event.data);
            });

            self._registry = new SandboxRegistry(self._miniBus);
            self._registry._create = function (url, sourceCode, config) {
                var activate = eval(sourceCode);
                //TODO: temp hack
                if (VertxProtoStub) return new VertxProtoStub(url, self._miniBus, config);
                return activate(url, self._miniBus, config);
            };
        }
    };
});
})
(function(factory) {
  factory();
});
//# sourceMappingURL=context-service.js.map