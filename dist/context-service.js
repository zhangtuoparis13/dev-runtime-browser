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
!function(e) {
  if ("object" == typeof exports && "undefined" != typeof module)
    module.exports = e();
  else if ("function" == typeof define && define.amd)
    define("2", [], e);
  else {
    var n;
    n = "undefined" != typeof window ? window : "undefined" != typeof global ? global : "undefined" != typeof self ? self : this, n.sandbox = e();
  }
}(function() {
  return function e(n, t, r) {
    function o(s, u) {
      if (!t[s]) {
        if (!n[s]) {
          var a = "function" == typeof require && require;
          if (!u && a)
            return a(s, !0);
          if (i)
            return i(s, !0);
          var l = new Error("Cannot find module '" + s + "'");
          throw l.code = "MODULE_NOT_FOUND", l;
        }
        var c = t[s] = {exports: {}};
        n[s][0].call(c.exports, function(e) {
          var t = n[s][1][e];
          return o(t ? t : e);
        }, c, c.exports, e, n, t, r);
      }
      return t[s].exports;
    }
    for (var i = "function" == typeof require && require,
        s = 0; s < r.length; s++)
      o(r[s]);
    return o;
  }({
    1: [function(e, n, t) {
      "use strict";
      function r(e) {
        return e && e.__esModule ? e : {"default": e};
      }
      function o(e, n) {
        if (!(e instanceof n))
          throw new TypeError("Cannot call a class as a function");
      }
      Object.defineProperty(t, "__esModule", {value: !0});
      var i = function() {
        function e(e, n) {
          for (var t = 0; t < n.length; t++) {
            var r = n[t];
            r.enumerable = r.enumerable || !1, r.configurable = !0, "value" in r && (r.writable = !0), Object.defineProperty(e, r.key, r);
          }
        }
        return function(n, t, r) {
          return t && e(n.prototype, t), r && e(n, r), n;
        };
      }(),
          s = e("./Pipeline"),
          u = r(s),
          a = function() {
            function e() {
              o(this, e);
              var n = this;
              n._msgId = 0, n._subscriptions = {}, n._responseTimeOut = 3e3, n._responseCallbacks = {}, n._pipeline = new u["default"](function(e) {
                console.log("PIPELINE-ERROR: ", JSON.stringify(e));
              }), n._registerExternalListener();
            }
            return i(e, [{
              key: "addListener",
              value: function(e, n) {
                var t = this,
                    r = new l(t._subscriptions, e, n),
                    o = t._subscriptions[e];
                return o || (o = [], t._subscriptions[e] = o), o.push(r), r;
              }
            }, {
              key: "addResponseListener",
              value: function(e, n, t) {
                this._responseCallbacks[e + n] = t;
              }
            }, {
              key: "removeResponseListener",
              value: function(e, n) {
                delete this._responseCallbacks[e + n];
              }
            }, {
              key: "removeAllListenersOf",
              value: function(e) {
                delete this._subscriptions[e];
              }
            }, {
              key: "postMessage",
              value: function(e, n) {
                var t = this;
                return e.id && 0 !== e.id || (t._msgId++, e.id = t._msgId), t._pipeline.process(e, function(e) {
                  if (n && !function() {
                    var r = e.from + e.id;
                    t._responseCallbacks[r] = n, setTimeout(function() {
                      var n = t._responseCallbacks[r];
                      if (delete t._responseCallbacks[r], n) {
                        var o = {
                          id: e.id,
                          type: "response",
                          body: {
                            code: "error",
                            desc: "Response timeout!"
                          }
                        };
                        n(o);
                      }
                    }, t._responseTimeOut);
                  }(), !t._onResponse(e)) {
                    var r = t._subscriptions[e.to];
                    r ? t._publishOn(r, e) : t._onPostMessage(e);
                  }
                }), e.id;
              }
            }, {
              key: "bind",
              value: function(e, n, t) {
                var r = this,
                    o = this,
                    i = o.addListener(e, function(e) {
                      t.postMessage(e);
                    }),
                    s = t.addListener(n, function(e) {
                      o.postMessage(e);
                    });
                return {
                  thisListener: i,
                  targetListener: s,
                  unbind: function() {
                    r.thisListener.remove(), r.targetListener.remove();
                  }
                };
              }
            }, {
              key: "_publishOn",
              value: function(e, n) {
                e.forEach(function(e) {
                  e._callback(n);
                });
              }
            }, {
              key: "_onResponse",
              value: function(e) {
                var n = this;
                if ("response" === e.type) {
                  var t = e.to + e.id,
                      r = n._responseCallbacks[t];
                  if (delete n._responseCallbacks[t], r)
                    return r(e), !0;
                }
                return !1;
              }
            }, {
              key: "_onMessage",
              value: function(e) {
                var n = this;
                if (!n._onResponse(e)) {
                  var t = n._subscriptions[e.to];
                  t ? n._publishOn(t, e) : (t = n._subscriptions["*"], t && n._publishOn(t, e));
                }
              }
            }, {
              key: "_onPostMessage",
              value: function(e) {}
            }, {
              key: "_registerExternalListener",
              value: function() {}
            }, {
              key: "pipeline",
              get: function() {
                return this._pipeline;
              }
            }]), e;
          }(),
          l = function() {
            function e(n, t, r) {
              o(this, e);
              var i = this;
              i._subscriptions = n, i._url = t, i._callback = r;
            }
            return i(e, [{
              key: "remove",
              value: function() {
                var e = this,
                    n = e._subscriptions[e._url];
                if (n) {
                  var t = n.indexOf(e);
                  n.splice(t, 1), 0 === n.length && delete e._subscriptions[e._url];
                }
              }
            }, {
              key: "url",
              get: function() {
                return this._url;
              }
            }]), e;
          }();
      t["default"] = a, n.exports = t["default"];
    }, {"./Pipeline": 2}],
    2: [function(e, n, t) {
      "use strict";
      function r(e, n) {
        if (!(e instanceof n))
          throw new TypeError("Cannot call a class as a function");
      }
      Object.defineProperty(t, "__esModule", {value: !0});
      var o = function() {
        function e(e, n) {
          for (var t = 0; t < n.length; t++) {
            var r = n[t];
            r.enumerable = r.enumerable || !1, r.configurable = !0, "value" in r && (r.writable = !0), Object.defineProperty(e, r.key, r);
          }
        }
        return function(n, t, r) {
          return t && e(n.prototype, t), r && e(n, r), n;
        };
      }(),
          i = function() {
            function e(n) {
              r(this, e);
              var t = this;
              t.handlers = [], t.onFail = n;
            }
            return o(e, [{
              key: "process",
              value: function(e, n) {
                var t = this;
                if (t.handlers.length > 0) {
                  var r = new u(t.handlers);
                  r.next(new s(t, r, e, n));
                } else
                  n(e);
              }
            }]), e;
          }(),
          s = function() {
            function e(n, t, o, i) {
              r(this, e);
              var s = this;
              s._inStop = !1, s._pipeline = n, s._iter = t, s._msg = o, s._onDeliver = i;
            }
            return o(e, [{
              key: "next",
              value: function() {
                var e = this;
                e._inStop || (e._iter.hasNext ? e._iter.next(e) : e._onDeliver(e._msg));
              }
            }, {
              key: "deliver",
              value: function() {
                var e = this;
                e._inStop || (e._inStop = !0, e._onDeliver(e._msg));
              }
            }, {
              key: "fail",
              value: function(e) {
                var n = this;
                n._inStop || (n._inStop = !0, n._pipeline.onFail && n._pipeline.onFail(e));
              }
            }, {
              key: "pipeline",
              get: function() {
                return this._pipeline;
              }
            }, {
              key: "msg",
              get: function() {
                return this._msg;
              },
              set: function(e) {
                this._msg = e;
              }
            }]), e;
          }(),
          u = function() {
            function e(n) {
              r(this, e), this._index = -1, this._array = n;
            }
            return o(e, [{
              key: "hasNext",
              get: function() {
                return this._index < this._array.length - 1;
              }
            }, {
              key: "next",
              get: function() {
                return this._index++, this._array[this._index];
              }
            }]), e;
          }();
      t["default"] = i, n.exports = t["default"];
    }, {}],
    3: [function(e, n, t) {
      "use strict";
      function r(e) {
        return e && e.__esModule ? e : {"default": e};
      }
      Object.defineProperty(t, "__esModule", {value: !0});
      var o = e("./sandbox/Sandbox"),
          i = r(o),
          s = e("./sandbox/SandboxRegistry"),
          u = r(s);
      t.Sandbox = i["default"], t.SandboxRegistry = u["default"];
    }, {
      "./sandbox/Sandbox": 4,
      "./sandbox/SandboxRegistry": 5
    }],
    4: [function(e, n, t) {
      "use strict";
      function r(e) {
        return e && e.__esModule ? e : {"default": e};
      }
      function o(e, n) {
        if (!(e instanceof n))
          throw new TypeError("Cannot call a class as a function");
      }
      function i(e, n) {
        if ("function" != typeof n && null !== n)
          throw new TypeError("Super expression must either be null or a function, not " + typeof n);
        e.prototype = Object.create(n && n.prototype, {constructor: {
            value: e,
            enumerable: !1,
            writable: !0,
            configurable: !0
          }}), n && (Object.setPrototypeOf ? Object.setPrototypeOf(e, n) : e.__proto__ = n);
      }
      Object.defineProperty(t, "__esModule", {value: !0});
      var s = function() {
        function e(e, n) {
          for (var t = 0; t < n.length; t++) {
            var r = n[t];
            r.enumerable = r.enumerable || !1, r.configurable = !0, "value" in r && (r.writable = !0), Object.defineProperty(e, r.key, r);
          }
        }
        return function(n, t, r) {
          return t && e(n.prototype, t), r && e(n, r), n;
        };
      }(),
          u = function(e, n, t) {
            for (var r = !0; r; ) {
              var o = e,
                  i = n,
                  s = t;
              r = !1, null === o && (o = Function.prototype);
              var u = Object.getOwnPropertyDescriptor(o, i);
              if (void 0 !== u) {
                if ("value" in u)
                  return u.value;
                var a = u.get;
                if (void 0 === a)
                  return;
                return a.call(s);
              }
              var l = Object.getPrototypeOf(o);
              if (null === l)
                return;
              e = l, n = i, t = s, r = !0, u = l = void 0;
            }
          },
          a = e("../sandbox/SandboxRegistry"),
          l = r(a),
          c = e("../bus/MiniBus"),
          f = r(c),
          d = function(e) {
            function n() {
              o(this, n), u(Object.getPrototypeOf(n.prototype), "constructor", this).call(this);
            }
            return i(n, e), s(n, [{
              key: "deployComponent",
              value: function(e, n, t) {
                var r = this;
                return new Promise(function(o, i) {
                  var s = {
                    type: "create",
                    from: l["default"].ExternalDeployAddress,
                    to: l["default"].InternalDeployAddress,
                    body: {
                      url: n,
                      sourceCode: e,
                      config: t
                    }
                  };
                  r.postMessage(s, function(e) {
                    200 === e.body.code ? o("deployed") : i(e.body.desc);
                  });
                });
              }
            }, {
              key: "removeComponent",
              value: function(e) {
                var n = this;
                return new Promise(function(t, r) {
                  var o = {
                    type: "delete",
                    from: l["default"].ExternalDeployAddress,
                    to: l["default"].InternalDeployAddress,
                    body: {url: e}
                  };
                  n.postMessage(o, function(e) {
                    200 === e.body.code ? t("undeployed") : r(e.body.desc);
                  });
                });
              }
            }]), n;
          }(f["default"]);
      t["default"] = d, n.exports = t["default"];
    }, {
      "../bus/MiniBus": 1,
      "../sandbox/SandboxRegistry": 5
    }],
    5: [function(e, n, t) {
      "use strict";
      function r(e, n) {
        if (!(e instanceof n))
          throw new TypeError("Cannot call a class as a function");
      }
      Object.defineProperty(t, "__esModule", {value: !0});
      var o = function() {
        function e(e, n) {
          for (var t = 0; t < n.length; t++) {
            var r = n[t];
            r.enumerable = r.enumerable || !1, r.configurable = !0, "value" in r && (r.writable = !0), Object.defineProperty(e, r.key, r);
          }
        }
        return function(n, t, r) {
          return t && e(n.prototype, t), r && e(n, r), n;
        };
      }(),
          i = function() {
            function e(n) {
              r(this, e);
              var t = this;
              t._bus = n, t._components = {}, n.addListener(e.InternalDeployAddress, function(e) {
                switch (e.type) {
                  case "create":
                    t._onDeploy(e);
                    break;
                  case "delete":
                    t._onRemove(e);
                }
              });
            }
            return o(e, [{
              key: "_responseMsg",
              value: function(n, t, r) {
                var o = {
                  id: n.id,
                  type: "response",
                  from: e.InternalDeployAddress,
                  to: e.ExternalDeployAddress
                },
                    i = {};
                return t && (i.code = t), r && (i.desc = r), o.body = i, o;
              }
            }, {
              key: "_onDeploy",
              value: function(e) {
                var n = this,
                    t = e.body.config,
                    r = e.body.url,
                    o = e.body.sourceCode,
                    i = void 0,
                    s = void 0;
                if (n._components.hasOwnProperty(r))
                  i = 500, s = "Instance " + r + " already exist!";
                else
                  try {
                    n._components[r] = n._create(r, o, t), i = 200;
                  } catch (u) {
                    i = 500, s = u;
                  }
                var a = n._responseMsg(e, i, s);
                n._bus.postMessage(a);
              }
            }, {
              key: "_onRemove",
              value: function(e) {
                var n = this,
                    t = e.body.url,
                    r = void 0,
                    o = void 0;
                n._components.hasOwnProperty(t) ? (delete n._components[t], n._bus.removeAllListenersOf(t), r = 200) : (r = 500, o = "Instance " + t + " doesn't exist!");
                var i = n._responseMsg(e, r, o);
                n._bus.postMessage(i);
              }
            }, {
              key: "_create",
              value: function(e, n, t) {}
            }, {
              key: "components",
              get: function() {
                return this._components;
              }
            }]), e;
          }();
      i.ExternalDeployAddress = "sandbox://external", i.InternalDeployAddress = "sandbox://internal", t["default"] = i, n.exports = t["default"];
    }, {}]
  }, {}, [3])(3);
});

_removeDefine();
})();
(function() {
var _removeDefine = $__System.get("@@amd-helpers").createDefine();
!function(e) {
  if ("object" == typeof exports && "undefined" != typeof module)
    module.exports = e();
  else if ("function" == typeof define && define.amd)
    define("3", [], e);
  else {
    var n;
    n = "undefined" != typeof window ? window : "undefined" != typeof global ? global : "undefined" != typeof self ? self : this, n.MiniBus = e();
  }
}(function() {
  return function e(n, t, i) {
    function r(o, u) {
      if (!t[o]) {
        if (!n[o]) {
          var a = "function" == typeof require && require;
          if (!u && a)
            return a(o, !0);
          if (s)
            return s(o, !0);
          var l = new Error("Cannot find module '" + o + "'");
          throw l.code = "MODULE_NOT_FOUND", l;
        }
        var f = t[o] = {exports: {}};
        n[o][0].call(f.exports, function(e) {
          var t = n[o][1][e];
          return r(t ? t : e);
        }, f, f.exports, e, n, t, i);
      }
      return t[o].exports;
    }
    for (var s = "function" == typeof require && require,
        o = 0; o < i.length; o++)
      r(i[o]);
    return r;
  }({
    1: [function(e, n, t) {
      "use strict";
      function i(e) {
        return e && e.__esModule ? e : {"default": e};
      }
      function r(e, n) {
        if (!(e instanceof n))
          throw new TypeError("Cannot call a class as a function");
      }
      Object.defineProperty(t, "__esModule", {value: !0});
      var s = function() {
        function e(e, n) {
          for (var t = 0; t < n.length; t++) {
            var i = n[t];
            i.enumerable = i.enumerable || !1, i.configurable = !0, "value" in i && (i.writable = !0), Object.defineProperty(e, i.key, i);
          }
        }
        return function(n, t, i) {
          return t && e(n.prototype, t), i && e(n, i), n;
        };
      }(),
          o = e("./Pipeline"),
          u = i(o),
          a = function() {
            function e() {
              r(this, e);
              var n = this;
              n._msgId = 0, n._subscriptions = {}, n._responseTimeOut = 3e3, n._responseCallbacks = {}, n._pipeline = new u["default"](function(e) {
                console.log("PIPELINE-ERROR: ", JSON.stringify(e));
              }), n._registerExternalListener();
            }
            return s(e, [{
              key: "addListener",
              value: function(e, n) {
                var t = this,
                    i = new l(t._subscriptions, e, n),
                    r = t._subscriptions[e];
                return r || (r = [], t._subscriptions[e] = r), r.push(i), i;
              }
            }, {
              key: "addResponseListener",
              value: function(e, n, t) {
                this._responseCallbacks[e + n] = t;
              }
            }, {
              key: "removeResponseListener",
              value: function(e, n) {
                delete this._responseCallbacks[e + n];
              }
            }, {
              key: "removeAllListenersOf",
              value: function(e) {
                delete this._subscriptions[e];
              }
            }, {
              key: "postMessage",
              value: function(e, n) {
                var t = this;
                return e.id && 0 !== e.id || (t._msgId++, e.id = t._msgId), t._pipeline.process(e, function(e) {
                  if (n && !function() {
                    var i = e.from + e.id;
                    t._responseCallbacks[i] = n, setTimeout(function() {
                      var n = t._responseCallbacks[i];
                      if (delete t._responseCallbacks[i], n) {
                        var r = {
                          id: e.id,
                          type: "response",
                          body: {
                            code: "error",
                            desc: "Response timeout!"
                          }
                        };
                        n(r);
                      }
                    }, t._responseTimeOut);
                  }(), !t._onResponse(e)) {
                    var i = t._subscriptions[e.to];
                    i ? t._publishOn(i, e) : t._onPostMessage(e);
                  }
                }), e.id;
              }
            }, {
              key: "bind",
              value: function(e, n, t) {
                var i = this,
                    r = this,
                    s = r.addListener(e, function(e) {
                      t.postMessage(e);
                    }),
                    o = t.addListener(n, function(e) {
                      r.postMessage(e);
                    });
                return {
                  thisListener: s,
                  targetListener: o,
                  unbind: function() {
                    i.thisListener.remove(), i.targetListener.remove();
                  }
                };
              }
            }, {
              key: "_publishOn",
              value: function(e, n) {
                e.forEach(function(e) {
                  e._callback(n);
                });
              }
            }, {
              key: "_onResponse",
              value: function(e) {
                var n = this;
                if ("response" === e.type) {
                  var t = e.to + e.id,
                      i = n._responseCallbacks[t];
                  if (delete n._responseCallbacks[t], i)
                    return i(e), !0;
                }
                return !1;
              }
            }, {
              key: "_onMessage",
              value: function(e) {
                var n = this;
                if (!n._onResponse(e)) {
                  var t = n._subscriptions[e.to];
                  t ? n._publishOn(t, e) : (t = n._subscriptions["*"], t && n._publishOn(t, e));
                }
              }
            }, {
              key: "_onPostMessage",
              value: function(e) {}
            }, {
              key: "_registerExternalListener",
              value: function() {}
            }, {
              key: "pipeline",
              get: function() {
                return this._pipeline;
              }
            }]), e;
          }(),
          l = function() {
            function e(n, t, i) {
              r(this, e);
              var s = this;
              s._subscriptions = n, s._url = t, s._callback = i;
            }
            return s(e, [{
              key: "remove",
              value: function() {
                var e = this,
                    n = e._subscriptions[e._url];
                if (n) {
                  var t = n.indexOf(e);
                  n.splice(t, 1), 0 === n.length && delete e._subscriptions[e._url];
                }
              }
            }, {
              key: "url",
              get: function() {
                return this._url;
              }
            }]), e;
          }();
      t["default"] = a, n.exports = t["default"];
    }, {"./Pipeline": 2}],
    2: [function(e, n, t) {
      "use strict";
      function i(e, n) {
        if (!(e instanceof n))
          throw new TypeError("Cannot call a class as a function");
      }
      Object.defineProperty(t, "__esModule", {value: !0});
      var r = function() {
        function e(e, n) {
          for (var t = 0; t < n.length; t++) {
            var i = n[t];
            i.enumerable = i.enumerable || !1, i.configurable = !0, "value" in i && (i.writable = !0), Object.defineProperty(e, i.key, i);
          }
        }
        return function(n, t, i) {
          return t && e(n.prototype, t), i && e(n, i), n;
        };
      }(),
          s = function() {
            function e(n) {
              i(this, e);
              var t = this;
              t.handlers = [], t.onFail = n;
            }
            return r(e, [{
              key: "process",
              value: function(e, n) {
                var t = this;
                if (t.handlers.length > 0) {
                  var i = new u(t.handlers);
                  i.next(new o(t, i, e, n));
                } else
                  n(e);
              }
            }]), e;
          }(),
          o = function() {
            function e(n, t, r, s) {
              i(this, e);
              var o = this;
              o._inStop = !1, o._pipeline = n, o._iter = t, o._msg = r, o._onDeliver = s;
            }
            return r(e, [{
              key: "next",
              value: function() {
                var e = this;
                e._inStop || (e._iter.hasNext ? e._iter.next(e) : e._onDeliver(e._msg));
              }
            }, {
              key: "deliver",
              value: function() {
                var e = this;
                e._inStop || (e._inStop = !0, e._onDeliver(e._msg));
              }
            }, {
              key: "fail",
              value: function(e) {
                var n = this;
                n._inStop || (n._inStop = !0, n._pipeline.onFail && n._pipeline.onFail(e));
              }
            }, {
              key: "pipeline",
              get: function() {
                return this._pipeline;
              }
            }, {
              key: "msg",
              get: function() {
                return this._msg;
              },
              set: function(e) {
                this._msg = e;
              }
            }]), e;
          }(),
          u = function() {
            function e(n) {
              i(this, e), this._index = -1, this._array = n;
            }
            return r(e, [{
              key: "hasNext",
              get: function() {
                return this._index < this._array.length - 1;
              }
            }, {
              key: "next",
              get: function() {
                return this._index++, this._array[this._index];
              }
            }]), e;
          }();
      t["default"] = s, n.exports = t["default"];
    }, {}],
    3: [function(e, n, t) {
      "use strict";
      function i(e) {
        return e && e.__esModule ? e : {"default": e};
      }
      Object.defineProperty(t, "__esModule", {value: !0});
      var r = e("./bus/MiniBus"),
          s = i(r);
      t["default"] = s["default"], n.exports = t["default"];
    }, {"./bus/MiniBus": 1}]
  }, {}, [3])(3);
});

_removeDefine();
})();
$__System.register('1', ['2', '3'], function (_export) {
    'use strict';

    var Sandbox, SandboxRegistry, MiniBus;
    return {
        setters: [function (_2) {
            Sandbox = _2.Sandbox;
            SandboxRegistry = _2.SandboxRegistry;
        }, function (_) {
            MiniBus = _['default'];
        }],
        execute: function () {

            self._miniBus = new MiniBus();
            self._miniBus._onPostMessage = function (msg) {
                self.postMessage(msg);
            };
            self.addEventListener('message', function (event) {
                self._miniBus._onMessage(event.data);
            });

            self._registry = new SandboxRegistry(self._miniBus);
            self._registry._create = function (url, sourceCode, config) {
                eval(sourceCode);
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