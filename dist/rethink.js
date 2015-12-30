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
$__System.register('2', [], function (_export) {
    'use strict';

    _export('create', create);

    function create(src) {
        var iframe = document.createElement('iframe');
        iframe.setAttribute('id', 'rethink');
        iframe.setAttribute('seamless', '');
        iframe.setAttribute('src', src);
        iframe.setAttribute('sandbox', 'allow-forms allow-scripts allow-same-origin allow-popups');
        iframe.style.display = 'none';
        document.querySelector('body').appendChild(iframe);

        return iframe;
    }

    return {
        setters: [],
        execute: function () {
            ;
        }
    };
});
(function() {
var _removeDefine = $__System.get("@@amd-helpers").createDefine();
(function(f) {
  if (typeof exports === "object" && typeof module !== "undefined") {
    module.exports = f();
  } else if (typeof define === "function" && define.amd) {
    define("3", [], f);
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
(function() {
var _removeDefine = $__System.get("@@amd-helpers").createDefine();
(function(f) {
  if (typeof exports === "object" && typeof module !== "undefined") {
    module.exports = f();
  } else if (typeof define === "function" && define.amd) {
    define("4", [], f);
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
$__System.register('5', ['3', '4'], function (_export) {
    'use strict';

    var SandboxRegistry, MiniBus;

    _export('create', create);

    function create(iframe) {
        window._miniBus = new MiniBus();
        window._miniBus._onPostMessage = function (msg) {
            iframe.contentWindow.postMessage(msg, '*');
        };
        window.addEventListener('message', function (event) {
            window._miniBus._onMessage(event.data);
        }, false);

        window._registry = new SandboxRegistry(window._miniBus);
        window._registry._create = function (url, sourceCode, config) {
            eval(sourceCode);
            return activate(url, window._miniBus, config);
        };
    }

    return {
        setters: [function (_2) {
            SandboxRegistry = _2.SandboxRegistry;
        }, function (_) {
            MiniBus = _.MiniBus;
        }],
        execute: function () {
            ;
        }
    };
});
$__System.register('1', ['2', '5'], function (_export) {
    'use strict';

    var createIframe, createApp, iframe;
    return {
        setters: [function (_2) {
            createIframe = _2.create;
        }, function (_) {
            createApp = _.create;
        }],
        execute: function () {
            iframe = createIframe('http://127.0.0.1:8080/dist/index.html');

            createApp(iframe);

            window.rethink = {
                requireHyperty: function requireHyperty(hypertyDescriptor) {
                    iframe.contentWindow.postMessage({ to: 'runtime:loadHyperty', body: { descriptor: hypertyDescriptor } }, '*');
                },

                requireProtostub: function requireProtostub(domain) {
                    iframe.contentWindow.postMessage({ to: 'runtime:loadStub', body: { "domain": domain } }, '*');
                }
            };
        }
    };
});
})
(function(factory) {
  factory();
});
//# sourceMappingURL=rethink.js.map