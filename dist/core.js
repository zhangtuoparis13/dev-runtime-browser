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
    g.MiniBus = f();
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
      function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {'default': obj};
      }
      function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
          throw new TypeError('Cannot call a class as a function');
        }
      }
      var _Pipeline = require('./Pipeline');
      var _Pipeline2 = _interopRequireDefault(_Pipeline);
      var MiniBus = (function() {
        function MiniBus() {
          _classCallCheck(this, MiniBus);
          var _this = this;
          _this._msgId = 0;
          _this._subscriptions = {};
          _this._responseTimeOut = 3000;
          _this._responseCallbacks = {};
          _this._pipeline = new _Pipeline2['default'](function(error) {
            console.log('PIPELINE-ERROR: ', JSON.stringify(error));
          });
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
          value: function postMessage(inMsg, responseCallback) {
            var _this = this;
            if (!inMsg.id || inMsg.id === 0) {
              _this._msgId++;
              inMsg.id = _this._msgId;
            }
            _this._pipeline.process(inMsg, function(msg) {
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
            });
            return inMsg.id;
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
        }, {
          key: 'pipeline',
          get: function get() {
            return this._pipeline;
          }
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
    }, {"./Pipeline": 2}],
    2: [function(require, module, exports) {
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
      var Pipeline = (function() {
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
      var PipeContext = (function() {
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
      var Iterator = (function() {
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
      exports["default"] = Pipeline;
      module.exports = exports["default"];
    }, {}],
    3: [function(require, module, exports) {
      'use strict';
      Object.defineProperty(exports, '__esModule', {value: true});
      function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {'default': obj};
      }
      var _busMiniBus = require('./bus/MiniBus');
      var _busMiniBus2 = _interopRequireDefault(_busMiniBus);
      exports.MiniBus = _busMiniBus2['default'];
    }, {"./bus/MiniBus": 1}]
  }, {}, [3])(3);
});

_removeDefine();
})();
$__System.register('3', ['2', '4', '5', '6', '7', '8'], function (_export) {
    var MiniBus, _get, _inherits, _createClass, _classCallCheck, Sandbox, SandboxRegistry, SandboxApp;

    return {
        setters: [function (_6) {
            MiniBus = _6.MiniBus;
        }, function (_) {
            _get = _['default'];
        }, function (_2) {
            _inherits = _2['default'];
        }, function (_3) {
            _createClass = _3['default'];
        }, function (_4) {
            _classCallCheck = _4['default'];
        }, function (_5) {
            Sandbox = _5.Sandbox;
            SandboxRegistry = _5.SandboxRegistry;
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
(function() {
var _removeDefine = $__System.get("@@amd-helpers").createDefine();
(function(f) {
  if (typeof exports === "object" && typeof module !== "undefined") {
    module.exports = f();
  } else if (typeof define === "function" && define.amd) {
    define("8", [], f);
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
    g.sandbox = f();
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
      function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {'default': obj};
      }
      function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
          throw new TypeError('Cannot call a class as a function');
        }
      }
      var _Pipeline = require('./Pipeline');
      var _Pipeline2 = _interopRequireDefault(_Pipeline);
      var MiniBus = (function() {
        function MiniBus() {
          _classCallCheck(this, MiniBus);
          var _this = this;
          _this._msgId = 0;
          _this._subscriptions = {};
          _this._responseTimeOut = 3000;
          _this._responseCallbacks = {};
          _this._pipeline = new _Pipeline2['default'](function(error) {
            console.log('PIPELINE-ERROR: ', JSON.stringify(error));
          });
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
          value: function postMessage(inMsg, responseCallback) {
            var _this = this;
            if (!inMsg.id || inMsg.id === 0) {
              _this._msgId++;
              inMsg.id = _this._msgId;
            }
            _this._pipeline.process(inMsg, function(msg) {
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
            });
            return inMsg.id;
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
        }, {
          key: 'pipeline',
          get: function get() {
            return this._pipeline;
          }
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
    }, {"./Pipeline": 2}],
    2: [function(require, module, exports) {
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
      var Pipeline = (function() {
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
      var PipeContext = (function() {
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
      var Iterator = (function() {
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
      exports["default"] = Pipeline;
      module.exports = exports["default"];
    }, {}],
    3: [function(require, module, exports) {
      'use strict';
      Object.defineProperty(exports, '__esModule', {value: true});
      function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {'default': obj};
      }
      var _sandboxSandbox = require('./sandbox/Sandbox');
      var _sandboxSandbox2 = _interopRequireDefault(_sandboxSandbox);
      var _sandboxSandboxRegistry = require('./sandbox/SandboxRegistry');
      var _sandboxSandboxRegistry2 = _interopRequireDefault(_sandboxSandboxRegistry);
      exports.Sandbox = _sandboxSandbox2['default'];
      exports.SandboxRegistry = _sandboxSandboxRegistry2['default'];
    }, {
      "./sandbox/Sandbox": 4,
      "./sandbox/SandboxRegistry": 5
    }],
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
      "../bus/MiniBus": 1,
      "../sandbox/SandboxRegistry": 5
    }],
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
    }, {}]
  }, {}, [3])(3);
});

_removeDefine();
})();
$__System.registerDynamic("7", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("9", ["a"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = $__require('a');
  module.exports = function defineProperty(it, key, desc) {
    return $.setDesc(it, key, desc);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("b", ["9"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": $__require('9'),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("6", ["b"], true, function($__require, exports, module) {
  "use strict";
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var _Object$defineProperty = $__require('b')["default"];
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

$__System.registerDynamic("c", ["d"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var isObject = $__require('d');
  module.exports = function(it) {
    if (!isObject(it))
      throw TypeError(it + ' is not an object!');
    return it;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("d", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("e", ["a", "d", "c", "f"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var getDesc = $__require('a').getDesc,
      isObject = $__require('d'),
      anObject = $__require('c');
  var check = function(O, proto) {
    anObject(O);
    if (!isObject(proto) && proto !== null)
      throw TypeError(proto + ": can't set as prototype!");
  };
  module.exports = {
    set: Object.setPrototypeOf || ('__proto__' in {} ? function(test, buggy, set) {
      try {
        set = $__require('f')(Function.call, getDesc(Object.prototype, '__proto__').set, 2);
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

$__System.registerDynamic("10", ["11", "e"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $export = $__require('11');
  $export($export.S, 'Object', {setPrototypeOf: $__require('e').set});
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("12", ["10", "13"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  $__require('10');
  module.exports = $__require('13').Object.setPrototypeOf;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("14", ["12"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": $__require('12'),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("15", ["a"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = $__require('a');
  module.exports = function create(P, D) {
    return $.create(P, D);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("16", ["15"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": $__require('15'),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("5", ["16", "14"], true, function($__require, exports, module) {
  "use strict";
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var _Object$create = $__require('16')["default"];
  var _Object$setPrototypeOf = $__require('14')["default"];
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

$__System.registerDynamic("17", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("18", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("f", ["18"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var aFunction = $__require('18');
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

$__System.registerDynamic("13", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("19", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("11", ["19", "13", "f"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var global = $__require('19'),
      core = $__require('13'),
      ctx = $__require('f'),
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

$__System.registerDynamic("1a", ["11", "13", "17"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $export = $__require('11'),
      core = $__require('13'),
      fails = $__require('17');
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

$__System.registerDynamic("1b", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("1c", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("1d", ["1c"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var cof = $__require('1c');
  module.exports = Object('z').propertyIsEnumerable(0) ? Object : function(it) {
    return cof(it) == 'String' ? it.split('') : Object(it);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("1e", ["1d", "1b"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var IObject = $__require('1d'),
      defined = $__require('1b');
  module.exports = function(it) {
    return IObject(defined(it));
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("1f", ["1e", "1a"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var toIObject = $__require('1e');
  $__require('1a')('getOwnPropertyDescriptor', function($getOwnPropertyDescriptor) {
    return function getOwnPropertyDescriptor(it, key) {
      return $getOwnPropertyDescriptor(toIObject(it), key);
    };
  });
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("a", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("20", ["a", "1f"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = $__require('a');
  $__require('1f');
  module.exports = function getOwnPropertyDescriptor(it, key) {
    return $.getDesc(it, key);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("21", ["20"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": $__require('20'),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("4", ["21"], true, function($__require, exports, module) {
  "use strict";
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var _Object$getOwnPropertyDescriptor = $__require('21')["default"];
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

$__System.register('22', ['4', '5', '6', '7', '8'], function (_export) {
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
            Sandbox = _5.Sandbox;
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
$__System.register('23', ['3', '22'], function (_export) {

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
        setters: [function (_2) {
            SandboxApp = _2['default'];
        }, function (_) {
            SandboxWorker = _['default'];
        }],
        execute: function () {
            _export('default', { createSandbox: createSandbox, createAppSandbox: createAppSandbox });
        }
    };
});
(function() {
var _removeDefine = $__System.get("@@amd-helpers").createDefine();
(function(f) {
  if (typeof exports === "object" && typeof module !== "undefined") {
    module.exports = f();
  } else if (typeof define === "function" && define.amd) {
    define("24", [], f);
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
    }, {}],
    2: [function(require, module, exports) {
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
              if (r instanceof Object && a instanceof Object && r !== a) {
                for (var x in a) {
                  r[x] = hello.utils.extend(r[x], a[x]);
                }
              } else {
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
            for (x in this.services) {
              if (this.services.hasOwnProperty(x)) {
                this.services[x].scope = this.services[x].scope || {};
              }
            }
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
              scope: 'basic',
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
            var scope = (opts.scope || '').toString() + ',' + p.qs.scope;
            if (session && 'scope' in session && session.scope instanceof String) {
              scope += ',' + session.scope;
            }
            scope = scope.split(SCOPE_SPLIT);
            scope = utils.unique(scope).filter(filterEmpty);
            p.qs.state.scope = scope.join(',');
            scope = scope.map(function(item) {
              if (item in provider.scope) {
                return provider.scope[item];
              } else {
                for (var x in _this.services) {
                  var serviceScopes = _this.services[x].scope;
                  if (serviceScopes && item in serviceScopes) {
                    return '';
                  }
                }
                return item;
              }
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
                utils.store(p.name, '');
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
            var open = function(url) {
              var popup = window.open(url, '_blank', optionsArray.join(','));
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
                          popup.addEventListener('exit', function() {
                            setTimeout(function() {
                              open(location);
                            }, 1000);
                          });
                        },
                        search: a.search,
                        hash: a.hash,
                        href: a.href
                      },
                      close: function() {
                        if (popup.close) {
                          popup.close();
                        }
                      }
                    };
                    hello.utils.responseHandler(_popup, window);
                    _popup.close();
                  });
                }
              } catch (e) {}
              if (popup && popup.focus) {
                popup.focus();
              }
              return popup;
            };
            if (navigator.userAgent.indexOf('Safari') !== -1 && navigator.userAgent.indexOf('Chrome') === -1) {
              url = redirectUri + '#oauth_redirect=' + encodeURIComponent(encodeURIComponent(url));
            }
            return open(url);
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
        });
        hello.utils.Event.call(hello);
        hello.utils.responseHandler(window, window.opener || window.parent);
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
            if (obj === null || typeof(obj) !== 'object' || obj instanceof Date || 'nodeName' in obj || this.isBinary(obj)) {
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
                photos: 'user_photos,user_videos',
                videos: 'user_photos,user_videos',
                friends: 'user_friends',
                files: 'user_photos,user_videos',
                publish_files: 'user_photos,user_videos,publish_actions',
                publish: 'publish_actions',
                offline_access: 'offline_access'
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
              scope: {
                basic: '',
                email: 'user:email'
              },
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
                friends: 'relationships',
                publish: 'likes comments'
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
                start: 'start_meeting'
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
                friends: '',
                publish: 'w_share'
              },
              scope_delim: ' ',
              base: 'https://api.linkedin.com/v1/',
              get: {
                me: 'people/~:(picture-url,first-name,last-name,id,formatted-name,email-address)',
                'me/friends': 'people/~/connections?count=@{limit|500}',
                'me/followers': 'people/~/connections?count=@{limit|500}',
                'me/following': 'people/~/connections?count=@{limit|500}',
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
                basic: '',
                email: 'email',
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
      }).call(this, require('_process'));
    }, {"_process": 1}],
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
    }, {"./MiniBus": 4}],
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
      function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {'default': obj};
      }
      function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
          throw new TypeError('Cannot call a class as a function');
        }
      }
      var _Pipeline = require('./Pipeline');
      var _Pipeline2 = _interopRequireDefault(_Pipeline);
      var MiniBus = (function() {
        function MiniBus() {
          _classCallCheck(this, MiniBus);
          var _this = this;
          _this._msgId = 0;
          _this._subscriptions = {};
          _this._responseTimeOut = 3000;
          _this._responseCallbacks = {};
          _this._pipeline = new _Pipeline2['default'](function(error) {
            console.log('PIPELINE-ERROR: ', JSON.stringify(error));
          });
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
          value: function postMessage(inMsg, responseCallback) {
            var _this = this;
            if (!inMsg.id || inMsg.id === 0) {
              _this._msgId++;
              inMsg.id = _this._msgId;
            }
            _this._pipeline.process(inMsg, function(msg) {
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
            });
            return inMsg.id;
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
        }, {
          key: 'pipeline',
          get: function get() {
            return this._pipeline;
          }
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
    }, {"./Pipeline": 5}],
    5: [function(require, module, exports) {
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
      var Pipeline = (function() {
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
      var PipeContext = (function() {
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
      var Iterator = (function() {
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
      exports["default"] = Pipeline;
      module.exports = exports["default"];
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
      function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {'default': obj};
      }
      function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
          throw new TypeError('Cannot call a class as a function');
        }
      }
      var _hellojs = require('hellojs');
      var _hellojs2 = _interopRequireDefault(_hellojs);
      var IdentityModule = (function() {
        function IdentityModule() {
          _classCallCheck(this, IdentityModule);
          var _this = this;
          _this.identities = [];
        }
        _createClass(IdentityModule, [{
          key: 'registerIdentity',
          value: function registerIdentity() {}
        }, {
          key: 'registerWithRP',
          value: function registerWithRP() {}
        }, {
          key: 'getIdentities',
          value: function getIdentities() {
            var _this = this;
            return _this.identities;
          }
        }, {
          key: 'loginWithRP',
          value: function loginWithRP(identifier, scope) {
            var _this = this;
            var VALIDURL = 'https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=';
            var USERINFURL = 'https://www.googleapis.com/oauth2/v1/userinfo?access_token=';
            var acToken = undefined;
            var tokenType = undefined;
            var expiresIn = undefined;
            var user = undefined;
            var tokenID = undefined;
            var loggedIn = false;
            return new Promise(function(resolve, reject) {
              if (_this.token !== undefined) {
                return resolve(_this.token);
              }
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
                      tokenID = JSON.parse(req.responseText);
                      _this.token = tokenID;
                      var email = tokenID.email;
                      var identityURL = 'user://' + email.substring(email.indexOf('@') + 1, email.length) + '/' + email.substring(0, email.indexOf('@'));
                      var identityBundle = {
                        identity: identityURL,
                        token: tokenID
                      };
                      _this.identities.push(identityBundle);
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
              _hellojs2['default'].init({google: '808329566012-tqr8qoh111942gd2kg007t0s8f277roi.apps.googleusercontent.com'});
              (0, _hellojs2['default'])('google').login({scope: 'email'}).then(function(token) {
                validateToken(token.authResponse.access_token);
              }, function(error) {
                console.log('errorValidating ', error);
                reject(error);
              });
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
    }, {"hellojs": 2}],
    7: [function(require, module, exports) {
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
                  var assertedID = _this.idModule.getIdentities();
                  message.body.assertedIdentity = assertedID[0].identity;
                  message.body.idToken = JSON.stringify(value);
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
      var _RegistryDataModel2 = require('./RegistryDataModel');
      var _RegistryDataModel3 = _interopRequireDefault(_RegistryDataModel2);
      var HypertyInstance = (function(_RegistryDataModel) {
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
      })(_RegistryDataModel3['default']);
      exports['default'] = HypertyInstance;
      module.exports = exports['default'];
    }, {"./RegistryDataModel": 11}],
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
      var _utilsEventEmitter = require('../utils/EventEmitter');
      var _utilsEventEmitter2 = _interopRequireDefault(_utilsEventEmitter);
      var _AddressAllocation = require('./AddressAllocation');
      var _AddressAllocation2 = _interopRequireDefault(_AddressAllocation);
      var _HypertyInstance = require('./HypertyInstance');
      var _HypertyInstance2 = _interopRequireDefault(_HypertyInstance);
      var _utilsUtilsJs = require('../utils/utils.js');
      var Registry = (function(_EventEmitter) {
        _inherits(Registry, _EventEmitter);
        function Registry(runtimeURL, appSandbox, identityModule, remoteRegistry) {
          _classCallCheck(this, Registry);
          _get(Object.getPrototypeOf(Registry.prototype), 'constructor', this).call(this);
          if (!runtimeURL)
            throw new Error('runtimeURL is missing.');
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
          key: 'getUserHyperty',
          value: function getUserHyperty(email) {
            var _this = this;
            var identityURL = 'user://' + email.substring(email.indexOf('@') + 1, email.length) + '/' + email.substring(0, email.indexOf('@'));
            var msg = {
              id: 98,
              type: 'READ',
              from: _this.registryURL,
              to: 'domain://registry.ua.pt/',
              body: {user: identityURL}
            };
            return new Promise(function(resolve, reject) {
              _this._messageBus.postMessage(msg, function(reply) {
                var hypertyURL = reply.body.last;
                if (hypertyURL === undefined) {
                  return reject('User Hyperty not found');
                }
                var fixedHypertyURL = 'hyperty:/' + hypertyURL.substring(hypertyURL.indexOf(':') + 1, hypertyURL.length);
                var idPackage = {
                  id: email,
                  descriptor: reply.body.hyperties[hypertyURL].descriptor,
                  hypertyURL: fixedHypertyURL
                };
                console.log('===> RegisterHyperty messageBundle: ', idPackage);
                resolve(idPackage);
              });
            });
          }
        }, {
          key: 'registerHyperty',
          value: function registerHyperty(sandbox, descriptor) {
            var _this = this;
            var domainUrl = (0, _utilsUtilsJs.divideURL)(descriptor).domain;
            var identities = _this.idModule.getIdentities();
            var promise = new Promise(function(resolve, reject) {
              if (_this._messageBus === undefined) {
                reject('MessageBus not found on registerStub');
              } else {
                return _this.resolve('hyperty-runtime://' + domainUrl).then(function() {
                  var numberOfAddresses = 1;
                  _this.addressAllocation.create(domainUrl, numberOfAddresses).then(function(adderessList) {
                    adderessList.forEach(function(address) {
                      _this._messageBus.addListener(address + '/status', function(msg) {
                        console.log('Message addListener for : ', address + '/status -> ' + msg);
                      });
                    });
                    var hyperty = new _HypertyInstance2['default'](_this.identifier, _this.registryURL, descriptor, adderessList[0], identities[0].identity);
                    _this.hypertiesList.push(hyperty);
                    var msg = {
                      id: 99,
                      type: 'CREATE',
                      from: _this.registryURL,
                      to: 'domain://registry.ua.pt/',
                      body: {
                        user: identities[0].identity,
                        hypertyDescriptorURL: descriptor,
                        hypertyURL: adderessList[0]
                      }
                    };
                    _this._messageBus.postMessage(msg, function(reply) {
                      console.log('===> RegisterHyperty Reply: ', reply);
                    });
                    resolve(adderessList[0]);
                  });
                })['catch'](function(reason) {
                  console.log('Address Reason: ', reason);
                  reject(reason);
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
              _this.sandboxesList[domainURL] = sandbox;
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
              if (!domainUrl.indexOf('msg-node.') || !domainUrl.indexOf('registry.')) {
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
      "../utils/EventEmitter": 17,
      "../utils/utils.js": 18,
      "./AddressAllocation": 8,
      "./HypertyInstance": 9
    }],
    11: [function(require, module, exports) {
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
      var RegistryDataModel = (function() {
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
      exports["default"] = RegistryDataModel;
      module.exports = exports["default"];
    }, {}],
    12: [function(require, module, exports) {
      'use strict';
      Object.defineProperty(exports, '__esModule', {value: true});
      function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {'default': obj};
      }
      var _runtimeRuntimeUA = require('./runtime/RuntimeUA');
      var _runtimeRuntimeUA2 = _interopRequireDefault(_runtimeRuntimeUA);
      exports['default'] = {RuntimeUA: _runtimeRuntimeUA2['default']};
      module.exports = exports['default'];
    }, {"./runtime/RuntimeUA": 14}],
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
      function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
          throw new TypeError('Cannot call a class as a function');
        }
      }
      var RuntimeCatalogue = (function() {
        function RuntimeCatalogue() {
          _classCallCheck(this, RuntimeCatalogue);
          var _this = this;
          _this._makeExternalRequest('../resources/descriptors/Hyperties.json').then(function(result) {
            _this.Hyperties = JSON.parse(result);
          });
          _this._makeExternalRequest('../resources/descriptors/ProtoStubs.json').then(function(result) {
            _this.ProtoStubs = JSON.parse(result);
          });
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
              var hypertyDescriptor = _this.Hyperties[hypertyName];
              resolve(hypertyDescriptor);
            });
          }
        }, {
          key: 'getHypertySourcePackage',
          value: function getHypertySourcePackage(hypertyPackage) {
            var _this = this;
            return new Promise(function(resolve, reject) {
              _this._makeExternalRequest(hypertyPackage).then(function(result) {
                try {
                  var sourcePackage = JSON.parse(result);
                  var sourceCode = window.atob(sourcePackage.sourceCode);
                  sourcePackage.sourceCode = sourceCode;
                  resolve(sourcePackage);
                } catch (e) {
                  reject(e);
                }
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
              var stubDescriptor = _this.ProtoStubs[domainURL];
              resolve(stubDescriptor);
            });
          }
        }, {
          key: 'getStubSourcePackage',
          value: function getStubSourcePackage(sourcePackageURL) {
            var _this = this;
            return new Promise(function(resolve, reject) {
              _this._makeExternalRequest(sourcePackageURL).then(function(result) {
                try {
                  var sourcePackage = JSON.parse(result);
                  var sourceCode = window.atob(sourcePackage.sourceCode);
                  sourcePackage.sourceCode = sourceCode;
                  resolve(sourcePackage);
                } catch (e) {
                  reject(e);
                }
              })['catch'](function(reason) {
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
      exports['default'] = RuntimeCatalogue;
      module.exports = exports['default'];
    }, {}],
    14: [function(require, module, exports) {
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
          _this.identityModule = new _identityIdentityModule2['default']();
          var appSandbox = sandboxFactory.createAppSandbox();
          _this.registry = new _registryRegistry2['default'](runtimeURL, appSandbox, _this.identityModule);
          _this.policyEngine = new _policyPolicyEngine2['default'](_this.identityModule, _this.registry);
          _this.messageBus = new _busMessageBus2['default'](_this.registry);
          _this.messageBus.pipeline.handlers = [function(ctx) {
            _this.policyEngine.authorise(ctx.msg).then(function(changedMgs) {
              ctx.msg = changedMgs;
              ctx.next();
            })['catch'](function(reason) {
              console.error(reason);
              ctx.fail(reason);
            });
          }];
          appSandbox.addListener('*', function(msg) {
            _this.messageBus.postMessage(msg);
          });
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
              var _hypertySourcePackage = undefined;
              var errorReason = function errorReason(reason) {
                console.error(reason);
                reject(reason);
              };
              console.info('------------------ Hyperty ------------------------');
              console.info('Get hyperty descriptor for :', hypertyDescriptorURL);
              _this.runtimeCatalogue.getHypertyDescriptor(hypertyDescriptorURL).then(function(hypertyDescriptor) {
                console.info('1: return hyperty descriptor', hypertyDescriptor);
                _hypertyDescriptor = hypertyDescriptor;
                var sourcePackageURL = hypertyDescriptor.sourcePackageURL;
                return _this.runtimeCatalogue.getHypertySourcePackage(sourcePackageURL);
              }).then(function(sourcePackage) {
                console.info('2: return hyperty source code');
                _hypertySourcePackage = sourcePackage;
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
                console.error('4.1: try to register a new sandbox', reason);
                var sandbox = _this.sandboxFactory.createSandbox();
                sandbox.addListener('*', function(msg) {
                  _this.messageBus.postMessage(msg);
                });
                return sandbox;
              }).then(function(sandbox) {
                console.info('5: return sandbox and register');
                _hypertySandbox = sandbox;
                return _this.registry.registerHyperty(sandbox, hypertyDescriptorURL);
              }).then(function(hypertyURL) {
                console.info('6: Hyperty url, after register hyperty', hypertyURL);
                _hypertyURL = hypertyURL;
                var configuration = Object.assign({}, _hypertyDescriptor.configuration);
                configuration.runtimeURL = _this.runtimeURL;
                return _hypertySandbox.deployComponent(_hypertySourcePackage.sourceCode, _hypertyURL, configuration);
              }).then(function(deployComponentStatus) {
                console.info('7: Deploy component status for hyperty: ', deployComponentStatus);
                _this.messageBus.addListener(_hypertyURL, function(msg) {
                  _hypertySandbox.postMessage(msg);
                });
                var hyperty = {
                  runtimeHypertyURL: _hypertyURL,
                  status: deployComponentStatus
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
              var _stubSourcePackage = undefined;
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
              }).then(function(stubDescriptor) {
                console.info('2. return the ProtoStub descriptor:', stubDescriptor);
                _stubDescriptor = stubDescriptor;
                var sourcePackageURL = stubDescriptor.sourcePackageURL;
                console.log(stubDescriptor.sourcePackageURL);
                return _this.runtimeCatalogue.getStubSourcePackage(sourcePackageURL);
              }).then(function(stubSourcePackage) {
                console.info('3. return the ProtoStub Source Code: ', stubSourcePackage);
                _stubSourcePackage = stubSourcePackage;
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
                var sandbox = _this.sandboxFactory.createSandbox();
                sandbox.addListener('*', function(msg) {
                  _this.messageBus.postMessage(msg);
                });
                return sandbox;
              }).then(function(sandbox) {
                console.info('6. return the sandbox instance and the register', sandbox);
                _stubSandbox = sandbox;
                return _this.registry.registerStub(_stubSandbox, domain);
              }).then(function(runtimeProtoStubURL) {
                console.info('7. return the runtime protostub url: ', runtimeProtoStubURL);
                _runtimeProtoStubURL = runtimeProtoStubURL;
                var configuration = Object.assign({}, _stubDescriptor.configuration);
                configuration.runtimeURL = _this.runtimeURL;
                console.log(_stubSourcePackage);
                return _stubSandbox.deployComponent(_stubSourcePackage.sourceCode, runtimeProtoStubURL, configuration);
              }).then(function(deployComponentStatus) {
                console.info('8: return deploy component for sandbox status: ', deployComponentStatus);
                _this.messageBus.addListener(_runtimeProtoStubURL, function(msg) {
                  _stubSandbox.postMessage(msg);
                });
                var stub = {
                  runtimeProtoStubURL: _runtimeProtoStubURL,
                  status: deployComponentStatus
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
      "../bus/MessageBus": 3,
      "../identity/IdentityModule": 6,
      "../policy/PolicyEngine": 7,
      "../registry/Registry": 10,
      "../syncher/SyncherManager": 16,
      "./RuntimeCatalogue": 13
    }],
    15: [function(require, module, exports) {
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
    16: [function(require, module, exports) {
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
      "../utils/utils": 18,
      "./ObjectAllocation": 15
    }],
    17: [function(require, module, exports) {
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
    18: [function(require, module, exports) {
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
  }, {}, [12])(12);
});

_removeDefine();
})();
$__System.register('1', ['23', '24'], function (_export) {
    'use strict';

    var SandboxFactory, RuntimeUA, runtime;

    function returnHyperty(source, hyperty) {
        source.postMessage({ to: 'runtime:loadedHyperty', body: hyperty }, '*');
    }

    return {
        setters: [function (_2) {
            SandboxFactory = _2['default'];
        }, function (_) {
            RuntimeUA = _.RuntimeUA;
        }],
        execute: function () {
            runtime = new RuntimeUA(SandboxFactory);

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