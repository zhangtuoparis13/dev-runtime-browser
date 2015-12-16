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
    var t;
    t = "undefined" != typeof window ? window : "undefined" != typeof global ? global : "undefined" != typeof self ? self : this, t.runtimeCore = e();
  }
}(function() {
  var define,
      module,
      exports;
  return function e(t, n, o) {
    function r(s, u) {
      if (!n[s]) {
        if (!t[s]) {
          var a = "function" == typeof require && require;
          if (!u && a)
            return a(s, !0);
          if (i)
            return i(s, !0);
          var c = new Error("Cannot find module '" + s + "'");
          throw c.code = "MODULE_NOT_FOUND", c;
        }
        var l = n[s] = {exports: {}};
        t[s][0].call(l.exports, function(e) {
          var n = t[s][1][e];
          return r(n ? n : e);
        }, l, l.exports, e, t, n, o);
      }
      return n[s].exports;
    }
    for (var i = "function" == typeof require && require,
        s = 0; s < o.length; s++)
      r(o[s]);
    return r;
  }({
    1: [function(e, t, n) {
      "use strict";
      function o(e) {
        return e && e.__esModule ? e : {"default": e};
      }
      function r(e, t) {
        if (!(e instanceof t))
          throw new TypeError("Cannot call a class as a function");
      }
      function i(e, t) {
        if ("function" != typeof t && null !== t)
          throw new TypeError("Super expression must either be null or a function, not " + typeof t);
        e.prototype = Object.create(t && t.prototype, {constructor: {
            value: e,
            enumerable: !1,
            writable: !0,
            configurable: !0
          }}), t && (Object.setPrototypeOf ? Object.setPrototypeOf(e, t) : e.__proto__ = t);
      }
      Object.defineProperty(n, "__esModule", {value: !0});
      var s = function() {
        function e(e, t) {
          for (var n = 0; n < t.length; n++) {
            var o = t[n];
            o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, o.key, o);
          }
        }
        return function(t, n, o) {
          return n && e(t.prototype, n), o && e(t, o), t;
        };
      }(),
          u = function(e, t, n) {
            for (var o = !0; o; ) {
              var r = e,
                  i = t,
                  s = n;
              o = !1, null === r && (r = Function.prototype);
              var u = Object.getOwnPropertyDescriptor(r, i);
              if (void 0 !== u) {
                if ("value" in u)
                  return u.value;
                var a = u.get;
                if (void 0 === a)
                  return;
                return a.call(s);
              }
              var c = Object.getPrototypeOf(r);
              if (null === c)
                return;
              e = c, t = i, n = s, o = !0, u = c = void 0;
            }
          },
          a = e("./MiniBus"),
          c = o(a),
          l = function(e) {
            function t(e) {
              r(this, t), u(Object.getPrototypeOf(t.prototype), "constructor", this).call(this), this._registry = e;
            }
            return i(t, e), s(t, [{
              key: "_onPostMessage",
              value: function(e) {
                var t = this;
                t._registry.resolve(e.to).then(function(n) {
                  var o = t._subscriptions[n];
                  o && t._publishOn(o, e);
                })["catch"](function(e) {
                  console.log("PROTO-STUB-ERROR: ", e);
                });
              }
            }]), t;
          }(c["default"]);
      n["default"] = l, t.exports = n["default"];
    }, {"./MiniBus": 2}],
    2: [function(e, t, n) {
      "use strict";
      function o(e, t) {
        if (!(e instanceof t))
          throw new TypeError("Cannot call a class as a function");
      }
      Object.defineProperty(n, "__esModule", {value: !0});
      var r = function() {
        function e(e, t) {
          for (var n = 0; n < t.length; n++) {
            var o = t[n];
            o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, o.key, o);
          }
        }
        return function(t, n, o) {
          return n && e(t.prototype, n), o && e(t, o), t;
        };
      }(),
          i = function() {
            function e() {
              o(this, e);
              var t = this;
              t._msgId = 0, t._subscriptions = {}, t._responseTimeOut = 3e3, t._responseCallbacks = {}, t._registerExternalListener();
            }
            return r(e, [{
              key: "addListener",
              value: function(e, t) {
                var n = this,
                    o = new s(n._subscriptions, e, t),
                    r = n._subscriptions[e];
                return r || (r = [], n._subscriptions[e] = r), r.push(o), o;
              }
            }, {
              key: "addResponseListener",
              value: function(e, t, n) {
                this._responseCallbacks[e + t] = n;
              }
            }, {
              key: "removeResponseListener",
              value: function(e, t) {
                delete this._responseCallbacks[e + t];
              }
            }, {
              key: "removeAllListenersOf",
              value: function(e) {
                delete this._subscriptions[e];
              }
            }, {
              key: "postMessage",
              value: function(e, t) {
                var n = this;
                if (e.id && 0 !== e.id || (n._msgId++, e.id = n._msgId), t && !function() {
                  var o = e.from + e.id;
                  n._responseCallbacks[o] = t, setTimeout(function() {
                    var t = n._responseCallbacks[o];
                    if (delete n._responseCallbacks[o], t) {
                      var r = {
                        id: e.id,
                        type: "response",
                        body: {
                          code: "error",
                          desc: "Response timeout!"
                        }
                      };
                      t(r);
                    }
                  }, n._responseTimeOut);
                }(), !n._onResponse(e)) {
                  var o = n._subscriptions[e.to];
                  o ? n._publishOn(o, e) : n._onPostMessage(e);
                }
                return e.id;
              }
            }, {
              key: "bind",
              value: function(e, t, n) {
                var o = this,
                    r = this,
                    i = r.addListener(e, function(e) {
                      n.postMessage(e);
                    }),
                    s = n.addListener(t, function(e) {
                      r.postMessage(e);
                    });
                return {
                  thisListener: i,
                  targetListener: s,
                  unbind: function() {
                    o.thisListener.remove(), o.targetListener.remove();
                  }
                };
              }
            }, {
              key: "_publishOn",
              value: function(e, t) {
                e.forEach(function(e) {
                  e._callback(t);
                });
              }
            }, {
              key: "_onResponse",
              value: function(e) {
                var t = this;
                if ("response" === e.type) {
                  var n = e.to + e.id,
                      o = t._responseCallbacks[n];
                  if (delete t._responseCallbacks[n], o)
                    return o(e), !0;
                }
                return !1;
              }
            }, {
              key: "_onMessage",
              value: function(e) {
                var t = this;
                if (!t._onResponse(e)) {
                  var n = t._subscriptions[e.to];
                  n ? t._publishOn(n, e) : (n = t._subscriptions["*"], n && t._publishOn(n, e));
                }
              }
            }, {
              key: "_onPostMessage",
              value: function(e) {}
            }, {
              key: "_registerExternalListener",
              value: function() {}
            }]), e;
          }(),
          s = function() {
            function e(t, n, r) {
              o(this, e);
              var i = this;
              i._subscriptions = t, i._url = n, i._callback = r;
            }
            return r(e, [{
              key: "remove",
              value: function() {
                var e = this,
                    t = e._subscriptions[e._url];
                if (t) {
                  var n = t.indexOf(e);
                  t.splice(n, 1), 0 === t.length && delete e._subscriptions[e._url];
                }
              }
            }, {
              key: "url",
              get: function() {
                return this._url;
              }
            }]), e;
          }();
      n["default"] = i, t.exports = n["default"];
    }, {}],
    3: [function(e, t, n) {
      "use strict";
      function o(e, t) {
        if (!(e instanceof t))
          throw new TypeError("Cannot call a class as a function");
      }
      Object.defineProperty(n, "__esModule", {value: !0});
      var r = function() {
        function e(e, t) {
          for (var n = 0; n < t.length; n++) {
            var o = t[n];
            o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, o.key, o);
          }
        }
        return function(t, n, o) {
          return n && e(t.prototype, n), o && e(t, o), t;
        };
      }(),
          i = function() {
            function e() {
              o(this, e);
            }
            return r(e, [{
              key: "registerIdentity",
              value: function() {}
            }, {
              key: "registerWithRP",
              value: function() {}
            }, {
              key: "loginWithRP",
              value: function(e, t) {
                function n(e, t) {
                  t = t.replace(/[\[]/, "\\[").replace(/[\]]/, "\\]");
                  var n = "[\\#&]" + t + "=([^&#]*)",
                      o = new RegExp(n),
                      r = o.exec(e);
                  return null === r ? "" : r[1];
                }
                var o = "https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=",
                    r = "https://www.googleapis.com/oauth2/v1/userinfo?access_token=",
                    i = "https://accounts.google.com/o/oauth2/auth?",
                    s = "email%20profile",
                    u = "808329566012-tqr8qoh111942gd2kg007t0s8f277roi.apps.googleusercontent.com",
                    a = "http://127.0.0.1:8080/",
                    c = "token",
                    l = i + "scope=" + s + "&client_id=" + u + "&redirect_uri=" + a + "&response_type=" + c,
                    f = void 0,
                    d = void 0,
                    p = void 0,
                    y = void 0;
                return new Promise(function(e, t) {
                  function i(e) {
                    var n = new XMLHttpRequest;
                    n.open("GET", o + e, !0), n.onreadystatechange = function(o) {
                      4 == n.readyState && (200 == n.status ? s(e) : t(400 == n.status ? "There was an error processing the token" : "something else other than 200 was returned"));
                    }, n.send();
                  }
                  function s(n) {
                    var o = new XMLHttpRequest;
                    o.open("GET", r + n, !0), o.onreadystatechange = function(n) {
                      4 == o.readyState && (200 == o.status ? (console.log("getUserInfo ", o), y = JSON.parse(o.responseText), e(y)) : t(400 == o.status ? "There was an error processing the token" : "something else other than 200 was returned"));
                    }, o.send();
                  }
                  var u = window.open(l, "openIDrequest", "width=800, height=600"),
                      c = window.setInterval(function() {
                        try {
                          if (u.closed && (t("Some error occured."), clearInterval(c)), -1 != u.document.URL.indexOf(a)) {
                            window.clearInterval(c);
                            var e = u.document.URL;
                            f = n(e, "access_token"), d = n(e, "token_type"), p = n(e, "expires_in"), u.close(), i(f);
                          }
                        } catch (o) {}
                      }, 500);
                });
              }
            }, {
              key: "setHypertyIdentity",
              value: function() {}
            }, {
              key: "generateAssertion",
              value: function(e, t, n) {}
            }, {
              key: "validateAssertion",
              value: function(e) {}
            }, {
              key: "getAssertionTrustLevel",
              value: function(e) {}
            }]), e;
          }();
      n["default"] = i, t.exports = n["default"];
    }, {}],
    4: [function(require, module, exports) {
      "use strict";
      function _classCallCheck(e, t) {
        if (!(e instanceof t))
          throw new TypeError("Cannot call a class as a function");
      }
      Object.defineProperty(exports, "__esModule", {value: !0});
      var _createClass = function() {
        function e(e, t) {
          for (var n = 0; n < t.length; n++) {
            var o = t[n];
            o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, o.key, o);
          }
        }
        return function(t, n, o) {
          return n && e(t.prototype, n), o && e(t, o), t;
        };
      }(),
          PolicyEngine = function() {
            function PolicyEngine(e, t) {
              _classCallCheck(this, PolicyEngine);
              var n = this;
              n.idModule = e, n.registry = t, n.policiesTable = new Object, n.blacklist = [];
            }
            return _createClass(PolicyEngine, [{
              key: "addPolicies",
              value: function(e, t) {
                var n = this;
                n.policiesTable[e] = t;
              }
            }, {
              key: "removePolicies",
              value: function(e) {
                var t = this;
                delete t.policiesTable[e];
              }
            }, {
              key: "authorise",
              value: function(e) {
                var t = this;
                return console.log(t.policiesTable), new Promise(function(n, o) {
                  "allow" == t.checkPolicies(e) ? t.idModule.loginWithRP("google identity", "scope").then(function(t) {
                    e.body.assertedIdentity = JSON.stringify(t), e.body.authorised = !0, n(e);
                  }, function(e) {
                    o(e);
                  }) : n(!1);
                });
              }
            }, {
              key: "checkPolicies",
              value: function checkPolicies(message) {
                var _this = this,
                    _results = ["allow"],
                    _policies = _this.policiesTable[message.body.hypertyURL];
                if (void 0 != _policies)
                  for (var _numPolicies = _policies.length,
                      i = 0; _numPolicies > i; i++) {
                    var _policy = _policies[i];
                    console.log(_policy), "blacklist" == _policy.target && _this.blacklist.indexOf(eval(_policy.subject)) > -1 && (console.log("Is in blacklist!"), _results.push(_policy.action)), "whitelist" == _policy.target && _this.whitelist.indexOf(eval(_policy.subject)) > -1 && (console.log("Is in whitelist!"), _results.push(_policy.action));
                  }
                return console.log(_results), _results.indexOf("deny") > -1 ? "deny" : "allow";
              }
            }]), PolicyEngine;
          }();
      exports["default"] = PolicyEngine, module.exports = exports["default"];
    }, {}],
    5: [function(e, t, n) {
      "use strict";
      function o(e, t) {
        if (!(e instanceof t))
          throw new TypeError("Cannot call a class as a function");
      }
      Object.defineProperty(n, "__esModule", {value: !0});
      var r = function() {
        function e(e, t) {
          for (var n = 0; n < t.length; n++) {
            var o = t[n];
            o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, o.key, o);
          }
        }
        return function(t, n, o) {
          return n && e(t.prototype, n), o && e(t, o), t;
        };
      }(),
          i = function() {
            function e(t, n) {
              o(this, e);
              var r = this;
              r._url = t, r._bus = n;
            }
            return r(e, [{
              key: "create",
              value: function(e, t) {
                var n = this,
                    o = {
                      type: "create",
                      from: n._url,
                      to: "domain://msg-node." + e + "/hyperty-address-allocation",
                      body: {number: t}
                    };
                return new Promise(function(e, t) {
                  n._bus.postMessage(o, function(n) {
                    200 === n.body.code ? e(n.body.allocated) : t(n.body.desc);
                  });
                });
              }
            }, {
              key: "url",
              get: function() {
                return this._url;
              }
            }]), e;
          }();
      n["default"] = i, t.exports = n["default"];
    }, {}],
    6: [function(e, t, n) {
      "use strict";
      function o(e) {
        return e && e.__esModule ? e : {"default": e};
      }
      function r(e, t) {
        if (!(e instanceof t))
          throw new TypeError("Cannot call a class as a function");
      }
      function i(e, t) {
        if ("function" != typeof t && null !== t)
          throw new TypeError("Super expression must either be null or a function, not " + typeof t);
        e.prototype = Object.create(t && t.prototype, {constructor: {
            value: e,
            enumerable: !1,
            writable: !0,
            configurable: !0
          }}), t && (Object.setPrototypeOf ? Object.setPrototypeOf(e, t) : e.__proto__ = t);
      }
      Object.defineProperty(n, "__esModule", {value: !0});
      var s = function() {
        function e(e, t) {
          for (var n = 0; n < t.length; n++) {
            var o = t[n];
            o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, o.key, o);
          }
        }
        return function(t, n, o) {
          return n && e(t.prototype, n), o && e(t, o), t;
        };
      }(),
          u = function(e, t, n) {
            for (var o = !0; o; ) {
              var r = e,
                  i = t,
                  s = n;
              o = !1, null === r && (r = Function.prototype);
              var u = Object.getOwnPropertyDescriptor(r, i);
              if (void 0 !== u) {
                if ("value" in u)
                  return u.value;
                var a = u.get;
                if (void 0 === a)
                  return;
                return a.call(s);
              }
              var c = Object.getPrototypeOf(r);
              if (null === c)
                return;
              e = c, t = i, n = s, o = !0, u = c = void 0;
            }
          },
          a = e("../utils/EventEmitter"),
          c = o(a),
          l = e("./AddressAllocation"),
          f = o(l),
          d = e("../utils/utils.js"),
          p = function(e) {
            function t(e, n, o) {
              if (r(this, t), u(Object.getPrototypeOf(t.prototype), "constructor", this).call(this), !e)
                throw new Error("runtimeURL is missing.");
              var i = this;
              i.registryURL = e + "/registry/123", i.appSandbox = n, i.runtimeURL = e, i.remoteRegistry = o, i.hypertiesList = {}, i.protostubsList = {}, i.sandboxesList = {}, i.pepList = {};
            }
            return i(t, e), s(t, [{
              key: "getAppSandbox",
              value: function() {
                var e = this;
                return e.appSandbox;
              }
            }, {
              key: "registerHyperty",
              value: function(e, t) {
                var n = this,
                    o = (0, d.divideURL)(t).domain,
                    r = o + "/identity",
                    i = new Promise(function(t, i) {
                      return void 0 !== n._messageBus ? n.resolve("hyperty-runtime://" + o).then(function() {
                        n.hypertiesList.hasOwnProperty(o) && (n.hypertiesList[o] = {identity: r}), n.sandboxesList.hasOwnProperty(o) || (n.sandboxesList[o] = e, e.addListener("*", function(e) {
                          n._messageBus.postMessage(e);
                        }));
                        var s = 1;
                        n.addressAllocation.create(o, s).then(function(e) {
                          e.forEach(function(e) {
                            n._messageBus.addListener(e + "/status", function(t) {
                              console.log("Message addListener for : ", e + "/status -> " + t);
                            });
                          }), t(e[0]);
                        })["catch"](function(e) {
                          console.log("Address Reason: ", e), i(e);
                        });
                      }) : void i("MessageBus not found on registerStub");
                    });
                return i;
              }
            }, {
              key: "unregisterHyperty",
              value: function(e) {
                var t = this,
                    n = new Promise(function(n, o) {
                      var r = t.hypertiesList[e];
                      void 0 === r ? o("Hyperty not found") : n("Hyperty successfully deleted");
                    });
                return n;
              }
            }, {
              key: "discoverProtostub",
              value: function(e) {
                if (!e)
                  throw new Error("Parameter url needed");
                var t = this,
                    n = new Promise(function(n, o) {
                      var r = t.protostubsList[e];
                      void 0 === r ? o("requestUpdate couldn' get the ProtostubURL") : n(r);
                    });
                return n;
              }
            }, {
              key: "registerStub",
              value: function(e, t) {
                var n,
                    o = this,
                    r = new Promise(function(r, i) {
                      void 0 === o._messageBus && i("MessageBus not found on registerStub"), t.indexOf("msg-node.") || (t = t.substring(t.indexOf(".") + 1)), n = "msg-node." + t + "/protostub/" + Math.floor(1e4 * Math.random() + 1), o.protostubsList[t] = n, o.sandboxesList[n] = e, r(n), o._messageBus.addListener(n + "/status", function(e) {
                        e.resource === e.to + "/status" && console.log("RuntimeProtostubURL/status message: ", e.body.value);
                      });
                    });
                return r;
              }
            }, {
              key: "unregisterStub",
              value: function(e) {
                var t = this,
                    n = new Promise(function(n, o) {
                      var r = t.protostubsList[e];
                      void 0 === r ? o("Error on unregisterStub: Hyperty not found") : (delete t.protostubsList[e], n("ProtostubURL removed"));
                    });
                return n;
              }
            }, {
              key: "registerPEP",
              value: function(e, t) {
                var n = this,
                    o = new Promise(function(o, r) {
                      n.pepList[t] = e, o("PEP registered with success");
                    });
                return o;
              }
            }, {
              key: "unregisterPEP",
              value: function(e) {
                var t = this,
                    n = new Promise(function(n, o) {
                      var r = t.pepList[e];
                      void 0 === r ? o("Pep Not found.") : n("PEP successfully removed.");
                    });
                return n;
              }
            }, {
              key: "onEvent",
              value: function(e) {}
            }, {
              key: "getSandbox",
              value: function(e) {
                if (!e)
                  throw new Error("Parameter url needed");
                var t = this,
                    n = new Promise(function(n, o) {
                      var r = t.sandboxesList[e];
                      void 0 === r ? o("Sandbox not found") : n(r);
                    });
                return n;
              }
            }, {
              key: "resolve",
              value: function(e) {
                console.log("resolve " + e);
                var t = this,
                    n = (0, d.divideURL)(e).domain,
                    o = new Promise(function(e, o) {
                      n.indexOf("msg-node.") || (n = n.substring(n.indexOf(".") + 1));
                      var r = t.protostubsList[n];
                      t.addEventListener("runtime:stubLoaded", function(t) {
                        e(t);
                      }), void 0 !== r ? e(r) : t.trigger("runtime:loadStub", n);
                    });
                return o;
              }
            }, {
              key: "messageBus",
              get: function() {
                var e = this;
                return e._messageBus;
              },
              set: function(e) {
                var t = this;
                t._messageBus = e;
                var n = new f["default"](t.registryURL, e);
                t.addressAllocation = n;
              }
            }]), t;
          }(c["default"]);
      n["default"] = p, t.exports = n["default"];
    }, {
      "../utils/EventEmitter": 14,
      "../utils/utils.js": 15,
      "./AddressAllocation": 5
    }],
    7: [function(e, t, n) {
      "use strict";
      function o(e) {
        return e && e.__esModule ? e : {"default": e};
      }
      Object.defineProperty(n, "__esModule", {value: !0});
      var r = e("./runtime/RuntimeUA"),
          i = o(r),
          s = e("./sandbox/Sandbox"),
          u = o(s),
          a = e("./bus/MiniBus"),
          c = o(a),
          l = e("./sandbox/SandboxRegistry"),
          f = o(l);
      n.RuntimeUA = i["default"], n.Sandbox = u["default"], n.MiniBus = c["default"], n.SandboxRegistry = f["default"];
    }, {
      "./bus/MiniBus": 2,
      "./runtime/RuntimeUA": 9,
      "./sandbox/Sandbox": 10,
      "./sandbox/SandboxRegistry": 11
    }],
    8: [function(e, t, n) {
      "use strict";
      function o(e, t) {
        if (!(e instanceof t))
          throw new TypeError("Cannot call a class as a function");
      }
      Object.defineProperty(n, "__esModule", {value: !0});
      var r = function() {
        function e(e, t) {
          for (var n = 0; n < t.length; n++) {
            var o = t[n];
            o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, o.key, o);
          }
        }
        return function(t, n, o) {
          return n && e(t.prototype, n), o && e(t, o), t;
        };
      }(),
          i = function() {
            function e() {
              o(this, e), console.log("runtime catalogue");
            }
            return r(e, [{
              key: "getHypertyRuntimeURL",
              value: function() {
                return _hypertyRuntimeURL;
              }
            }, {
              key: "_makeExternalRequest",
              value: function(e) {
                return new Promise(function(t, n) {
                  var o = new XMLHttpRequest;
                  o.onreadystatechange = function(e) {
                    var o = e.currentTarget;
                    4 === o.readyState && (200 === o.status ? t(o.responseText) : n(o.responseText));
                  }, o.open("GET", e, !0), o.send();
                });
              }
            }, {
              key: "getHypertyDescriptor",
              value: function(e) {
                var t = this;
                return new Promise(function(n, o) {
                  var r = e.substr(e.lastIndexOf("/") + 1),
                      i = {
                        guid: "guid",
                        id: "idHyperty",
                        classname: r,
                        description: "description of " + r,
                        kind: "hyperty",
                        catalogueURL: "....",
                        sourceCode: "../resources/" + r + ".ES5.js",
                        dataObject: "",
                        type: "",
                        messageSchema: "",
                        configuration: {runtimeURL: t._runtimeURL},
                        policies: "",
                        constraints: "",
                        hypertyCapabilities: "",
                        protocolCapabilities: ""
                      };
                  n(i);
                });
              }
            }, {
              key: "getHypertySourceCode",
              value: function(e) {
                var t = this;
                return new Promise(function(n, o) {
                  t._makeExternalRequest(e).then(function(e) {
                    n(e);
                  })["catch"](function(e) {
                    o(e);
                  });
                });
              }
            }, {
              key: "getStubDescriptor",
              value: function(e) {
                var t = this;
                return new Promise(function(e, n) {
                  var o = {
                    guid: "guid",
                    id: "idProtoStub",
                    classname: "VertxProtoStub",
                    description: "description of ProtoStub",
                    kind: "hyperty",
                    catalogueURL: "....",
                    sourceCode: "../resources/VertxProtoStub.js",
                    dataObject: "",
                    type: "",
                    messageSchema: "",
                    configuration: {
                      url: "ws://localhost:9090/ws",
                      runtimeURL: t._runtimeURL
                    },
                    policies: "",
                    constraints: "",
                    hypertyCapabilities: "",
                    protocolCapabilities: ""
                  };
                  e(o);
                });
              }
            }, {
              key: "getStubSourceCode",
              value: function(e) {
                var t = this;
                return new Promise(function(n, o) {
                  t._makeExternalRequest(e).then(function(e) {
                    n(e);
                  })["catch"](function(e) {
                    o(e);
                  });
                });
              }
            }, {
              key: "runtimeURL",
              set: function(e) {
                var t = this;
                t._runtimeURL = e;
              },
              get: function() {
                var e = this;
                return e._runtimeURL;
              }
            }]), e;
          }();
      n["default"] = i, t.exports = n["default"];
    }, {}],
    9: [function(e, t, n) {
      "use strict";
      function o(e) {
        return e && e.__esModule ? e : {"default": e};
      }
      function r(e, t) {
        if (!(e instanceof t))
          throw new TypeError("Cannot call a class as a function");
      }
      Object.defineProperty(n, "__esModule", {value: !0});
      var i = function() {
        function e(e, t) {
          for (var n = 0; n < t.length; n++) {
            var o = t[n];
            o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, o.key, o);
          }
        }
        return function(t, n, o) {
          return n && e(t.prototype, n), o && e(t, o), t;
        };
      }(),
          s = e("../registry/Registry"),
          u = o(s),
          a = e("../identity/IdentityModule"),
          c = o(a),
          l = e("../policy/PolicyEngine"),
          f = o(l),
          d = e("../bus/MessageBus"),
          p = o(d),
          y = e("./RuntimeCatalogue"),
          b = o(y),
          v = e("../syncher/SyncherManager"),
          g = o(v),
          h = function() {
            function e(t) {
              if (r(this, e), !t)
                throw new Error("The sandbox factory is a needed parameter");
              var n = this;
              n.sandboxFactory = t, n.runtimeCatalogue = new b["default"];
              var o = "runtime://ua.pt/" + Math.floor(1e4 * Math.random() + 1);
              n.runtimeURL = o, n.runtimeCatalogue.runtimeURL = o;
              var i = t.createAppSandbox();
              n.identityModule = new c["default"], n.policyEngine = new f["default"], n.registry = new u["default"](o, i), n.messageBus = new p["default"](n.registry), n.registry.messageBus = n.messageBus, n.registry.addEventListener("runtime:loadStub", function(e) {
                n.loadStub(e).then(function(t) {
                  n.registry.trigger("runtime:stubLoaded", e);
                })["catch"](function(e) {
                  console.error(e);
                });
              }), t.messageBus = n.messageBus, n.syncherManager = new g["default"](n.runtimeURL, n.messageBus, {});
            }
            return i(e, [{
              key: "discoverHiperty",
              value: function(e) {}
            }, {
              key: "registerHyperty",
              value: function(e, t) {}
            }, {
              key: "loadHyperty",
              value: function(e) {
                var t = this;
                if (!e)
                  throw new Error("Hyperty descriptor url parameter is needed");
                return new Promise(function(n, o) {
                  var r = void 0,
                      i = void 0,
                      s = void 0,
                      u = void 0,
                      a = function(e) {
                        console.error(e), o(e);
                      };
                  console.log("------------------ Hyperty ------------------------"), console.info("Get hyperty descriptor for :", e), t.runtimeCatalogue.getHypertyDescriptor(e).then(function(e) {
                    console.info("1: return hyperty descriptor", e), s = e;
                    var n = e.sourceCode;
                    return t.runtimeCatalogue.getHypertySourceCode(n);
                  }).then(function(e) {
                    console.info("2: return hyperty source code"), u = e;
                    var t = !0;
                    return t;
                  }).then(function(e) {
                    console.info("3: return policy engine result");
                    var n = !0,
                        o = void 0;
                    return o = n ? t.registry.getAppSandbox() : t.registry.getSandbox(domain);
                  }).then(function(e) {
                    return console.info("4: return the sandbox", e), e;
                  }, function(e) {
                    return console.info("4.1: try to register a new sandbox", e), t.sandboxFactory.createSandbox();
                  }).then(function(n) {
                    return console.info("5: return sandbox and register"), i = n, t.registry.registerHyperty(n, e);
                  }).then(function(e) {
                    return console.info("6: Hyperty url, after register hyperty", e), r = e, i.deployComponent(u, r, s.configuration);
                  }).then(function(e) {
                    console.info("7: Deploy component status for hyperty: ", r), t.messageBus.addListener(r, function(e) {
                      i.postMessage(e);
                    });
                    var o = {
                      runtimeHypertyURL: r,
                      status: "Deployed"
                    };
                    n(o), console.log("------------------ END ------------------------");
                  })["catch"](a);
                });
              }
            }, {
              key: "loadStub",
              value: function(e) {
                var t = this;
                if (!e)
                  throw new Error("domain parameter is needed");
                return new Promise(function(n, o) {
                  var r = void 0,
                      i = void 0,
                      s = void 0,
                      u = void 0,
                      a = function(e) {
                        console.error(e), o(e);
                      };
                  console.info("------------------- ProtoStub ---------------------------\n"), console.info("Discover or Create a new ProtoStub for domain: ", e), t.registry.discoverProtostub(e).then(function(e) {
                    return console.info("1. Proto Stub Discovered: ", e), i = e;
                  }, function(n) {
                    return console.info("1. Proto Stub not found:", n), t.runtimeCatalogue.getStubDescriptor(e);
                  }).then(function(e) {
                    console.info("2. return the ProtoStub descriptor:", e), i = e;
                    var n = e.sourceCode;
                    return t.runtimeCatalogue.getStubSourceCode(n);
                  }).then(function(e) {
                    console.info("3. return the ProtoStub Source Code: "), u = e;
                    var t = !0;
                    return t;
                  }).then(function(n) {
                    return t.registry.getSandbox(e);
                  }).then(function(e) {
                    return console.info("4. if the sandbox is registered then return the sandbox", e), r = e, e;
                  }, function(e) {
                    return console.info("5. Sandbox was not found, creating a new one"), t.sandboxFactory.createSandbox();
                  }).then(function(n) {
                    return console.info("6. return the sandbox instance and the register", n), r = n, t.registry.registerStub(r, e);
                  }).then(function(e) {
                    return console.info("7. return the runtime protostub url: ", e), s = e, r.deployComponent(u, e, i.configuration);
                  }).then(function(e) {
                    console.info("8: return deploy component for sandbox status"), t.messageBus.addListener(s, function(e) {
                      r.postMessage(e);
                    }), r.addListener("*", function(e) {
                      t.messageBus.postMessage(e);
                    });
                    var o = {
                      runtimeProtoStubURL: s,
                      status: "Deployed"
                    };
                    n(o), console.info("------------------- END ---------------------------\n");
                  })["catch"](a);
                });
              }
            }, {
              key: "checkForUpdate",
              value: function(e) {}
            }]), e;
          }();
      n["default"] = h, t.exports = n["default"];
    }, {
      "../bus/MessageBus": 1,
      "../identity/IdentityModule": 3,
      "../policy/PolicyEngine": 4,
      "../registry/Registry": 6,
      "../syncher/SyncherManager": 13,
      "./RuntimeCatalogue": 8
    }],
    10: [function(e, t, n) {
      "use strict";
      function o(e) {
        return e && e.__esModule ? e : {"default": e};
      }
      function r(e, t) {
        if (!(e instanceof t))
          throw new TypeError("Cannot call a class as a function");
      }
      function i(e, t) {
        if ("function" != typeof t && null !== t)
          throw new TypeError("Super expression must either be null or a function, not " + typeof t);
        e.prototype = Object.create(t && t.prototype, {constructor: {
            value: e,
            enumerable: !1,
            writable: !0,
            configurable: !0
          }}), t && (Object.setPrototypeOf ? Object.setPrototypeOf(e, t) : e.__proto__ = t);
      }
      Object.defineProperty(n, "__esModule", {value: !0});
      var s = function() {
        function e(e, t) {
          for (var n = 0; n < t.length; n++) {
            var o = t[n];
            o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, o.key, o);
          }
        }
        return function(t, n, o) {
          return n && e(t.prototype, n), o && e(t, o), t;
        };
      }(),
          u = function(e, t, n) {
            for (var o = !0; o; ) {
              var r = e,
                  i = t,
                  s = n;
              o = !1, null === r && (r = Function.prototype);
              var u = Object.getOwnPropertyDescriptor(r, i);
              if (void 0 !== u) {
                if ("value" in u)
                  return u.value;
                var a = u.get;
                if (void 0 === a)
                  return;
                return a.call(s);
              }
              var c = Object.getPrototypeOf(r);
              if (null === c)
                return;
              e = c, t = i, n = s, o = !0, u = c = void 0;
            }
          },
          a = e("../sandbox/SandboxRegistry"),
          c = o(a),
          l = e("../bus/MiniBus"),
          f = o(l),
          d = function(e) {
            function t() {
              r(this, t), u(Object.getPrototypeOf(t.prototype), "constructor", this).call(this);
            }
            return i(t, e), s(t, [{
              key: "deployComponent",
              value: function(e, t, n) {
                var o = this;
                return new Promise(function(r, i) {
                  var s = {
                    type: "create",
                    from: c["default"].ExternalDeployAddress,
                    to: c["default"].InternalDeployAddress,
                    body: {
                      url: t,
                      sourceCode: e,
                      config: n
                    }
                  };
                  o.postMessage(s, function(e) {
                    200 === e.body.code ? r("deployed") : i(e.body.desc);
                  });
                });
              }
            }, {
              key: "removeComponent",
              value: function(e) {
                var t = this;
                return new Promise(function(n, o) {
                  var r = {
                    type: "delete",
                    from: c["default"].ExternalDeployAddress,
                    to: c["default"].InternalDeployAddress,
                    body: {url: e}
                  };
                  t.postMessage(r, function(e) {
                    200 === e.body.code ? n("undeployed") : o(e.body.desc);
                  });
                });
              }
            }]), t;
          }(f["default"]);
      n["default"] = d, t.exports = n["default"];
    }, {
      "../bus/MiniBus": 2,
      "../sandbox/SandboxRegistry": 11
    }],
    11: [function(e, t, n) {
      "use strict";
      function o(e, t) {
        if (!(e instanceof t))
          throw new TypeError("Cannot call a class as a function");
      }
      Object.defineProperty(n, "__esModule", {value: !0});
      var r = function() {
        function e(e, t) {
          for (var n = 0; n < t.length; n++) {
            var o = t[n];
            o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, o.key, o);
          }
        }
        return function(t, n, o) {
          return n && e(t.prototype, n), o && e(t, o), t;
        };
      }(),
          i = function() {
            function e(t) {
              o(this, e);
              var n = this;
              n._bus = t, n._components = {}, t.addListener(e.InternalDeployAddress, function(e) {
                switch (e.type) {
                  case "create":
                    n._onDeploy(e);
                    break;
                  case "delete":
                    n._onRemove(e);
                }
              });
            }
            return r(e, [{
              key: "_responseMsg",
              value: function(t, n, o) {
                var r = {
                  id: t.id,
                  type: "response",
                  from: e.InternalDeployAddress,
                  to: e.ExternalDeployAddress
                },
                    i = {};
                return n && (i.code = n), o && (i.desc = o), r.body = i, r;
              }
            }, {
              key: "_onDeploy",
              value: function(e) {
                var t = this,
                    n = e.body.config,
                    o = e.body.url,
                    r = e.body.sourceCode,
                    i = void 0,
                    s = void 0;
                if (t._components.hasOwnProperty(o))
                  i = 500, s = "Instance " + o + " already exist!";
                else
                  try {
                    t._components[o] = t._create(o, r, n), i = 200;
                  } catch (u) {
                    i = 500, s = u;
                  }
                var a = t._responseMsg(e, i, s);
                t._bus.postMessage(a);
              }
            }, {
              key: "_onRemove",
              value: function(e) {
                var t = this,
                    n = e.body.url,
                    o = void 0,
                    r = void 0;
                t._components.hasOwnProperty(n) ? (delete t._components[n], t._bus.removeAllListenersOf(n), o = 200) : (o = 500, r = "Instance " + n + " doesn't exist!");
                var i = t._responseMsg(e, o, r);
                t._bus.postMessage(i);
              }
            }, {
              key: "_create",
              value: function(e, t, n) {}
            }, {
              key: "components",
              get: function() {
                return this._components;
              }
            }]), e;
          }();
      i.ExternalDeployAddress = "sandbox://external", i.InternalDeployAddress = "sandbox://internal", n["default"] = i, t.exports = n["default"];
    }, {}],
    12: [function(e, t, n) {
      "use strict";
      function o(e, t) {
        if (!(e instanceof t))
          throw new TypeError("Cannot call a class as a function");
      }
      Object.defineProperty(n, "__esModule", {value: !0});
      var r = function() {
        function e(e, t) {
          for (var n = 0; n < t.length; n++) {
            var o = t[n];
            o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, o.key, o);
          }
        }
        return function(t, n, o) {
          return n && e(t.prototype, n), o && e(t, o), t;
        };
      }(),
          i = function() {
            function e(t, n) {
              o(this, e);
              var r = this;
              r._url = t, r._bus = n;
            }
            return r(e, [{
              key: "create",
              value: function(e, t) {
                var n = this,
                    o = {
                      type: "create",
                      from: n._url,
                      to: "domain://msg-node." + e + "/object-address-allocation",
                      body: {number: t}
                    };
                return new Promise(function(e, t) {
                  n._bus.postMessage(o, function(n) {
                    200 === n.body.code ? e(n.body.allocated) : t(n.body.desc);
                  });
                });
              }
            }, {
              key: "url",
              get: function() {
                return this._url;
              }
            }]), e;
          }();
      n["default"] = i, t.exports = n["default"];
    }, {}],
    13: [function(e, t, n) {
      "use strict";
      function o(e) {
        return e && e.__esModule ? e : {"default": e};
      }
      function r(e, t) {
        if (!(e instanceof t))
          throw new TypeError("Cannot call a class as a function");
      }
      Object.defineProperty(n, "__esModule", {value: !0});
      var i = function() {
        function e(e, t) {
          for (var n = 0; n < t.length; n++) {
            var o = t[n];
            o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, o.key, o);
          }
        }
        return function(t, n, o) {
          return n && e(t.prototype, n), o && e(t, o), t;
        };
      }(),
          s = e("../utils/utils"),
          u = e("./ObjectAllocation"),
          a = o(u),
          c = function() {
            function e(t, n, o, i) {
              r(this, e);
              var s = this;
              s._domain = "ua.pt", s._bus = n, s._registry = o, s._url = t + "/sm", s._objectURL = t + "/object-allocation", s._subscriptions = {}, s._allocator = new a["default"](s._objectURL, n), n.addListener(s._url, function(e) {
                switch (console.log("SyncherManager-RCV: ", e), e.type) {
                  case "create":
                    s._onCreate(e);
                    break;
                  case "delete":
                    s._onDelete(e);
                }
              });
            }
            return i(e, [{
              key: "_onCreate",
              value: function(e) {
                var t = this,
                    n = e.from;
                t._allocator.create(t._domain, 1).then(function(o) {
                  var r = o[0],
                      i = r + "/subscription",
                      u = t._bus.addListener(r, function(e) {
                        console.log(r + "-RCV: ", e), t._subscriptions[r].subs.forEach(function(n) {
                          var o = (0, s.deepClone)(e);
                          o.id = 0, o.from = r, o.to = n, t._bus.postMessage(o);
                        });
                      }),
                      a = t._bus.addListener(i, function(e) {
                        switch (console.log(i + "-RCV: ", e), e.type) {
                          case "subscribe":
                            t._onSubscribe(r, e);
                            break;
                          case "unsubscribe":
                            t._onUnSubscribe(r, e);
                        }
                      });
                  t._subscriptions[r] = {
                    owner: n,
                    sl: a,
                    cl: u,
                    subs: []
                  }, t._bus.postMessage({
                    id: e.id,
                    type: "response",
                    from: e.to,
                    to: n,
                    body: {
                      code: 200,
                      resource: r
                    }
                  }), setTimeout(function() {
                    e.body.authorise.forEach(function(o) {
                      t._bus.postMessage({
                        type: "create",
                        from: n,
                        to: o,
                        body: {
                          schema: e.body.schema,
                          resource: r,
                          value: e.body.value
                        }
                      });
                    });
                  });
                })["catch"](function(o) {
                  t._bus.postMessage({
                    id: e.id,
                    type: "response",
                    from: e.to,
                    to: n,
                    body: {
                      code: 500,
                      desc: o
                    }
                  });
                });
              }
            }, {
              key: "_onDelete",
              value: function(e) {
                var t = this,
                    n = "<objURL>";
                delete t._subscriptions[n], t._bus.removeAllListenersOf(n), t._bus.removeAllListenersOf(n + "/subscription");
              }
            }, {
              key: "_onSubscribe",
              value: function(e, t) {
                var n = this,
                    o = t.from,
                    r = n._subscriptions[e];
                if (r[o]) {
                  var i = {
                    id: t.id,
                    type: "response",
                    from: t.to,
                    to: o,
                    body: {
                      code: 500,
                      desc: "Subscription for (" + e + " : " + o + ") already exists!"
                    }
                  };
                  return void n._bus.postMessage(i);
                }
                var s = "sub/pub";
                if ("sub/pub" === s) {
                  var u = {
                    type: "forward",
                    from: n._url,
                    to: r.owner,
                    body: {
                      type: t.type,
                      from: t.from,
                      to: e
                    }
                  };
                  t.body && (u.body.body = t.body), n._bus.postMessage(u, function(r) {
                    console.log("forward-reply: ", r), 200 === r.body.code && n._subscriptions[e].subs.push(o), n._bus.postMessage({
                      id: t.id,
                      type: "response",
                      from: t.to,
                      to: o,
                      body: r.body
                    });
                  });
                }
              }
            }, {
              key: "_onUnSubscribe",
              value: function(e, t) {
                var n = this,
                    o = t.from,
                    r = n._subscriptions[e].subs,
                    i = r.indexOf(o);
                r.splice(i, 1);
              }
            }, {
              key: "url",
              get: function() {
                return this._url;
              }
            }]), e;
          }();
      n["default"] = c, t.exports = n["default"];
    }, {
      "../utils/utils": 15,
      "./ObjectAllocation": 12
    }],
    14: [function(e, t, n) {
      "use strict";
      function o(e, t) {
        if (!(e instanceof t))
          throw new TypeError("Cannot call a class as a function");
      }
      Object.defineProperty(n, "__esModule", {value: !0});
      var r = function() {
        function e(e, t) {
          for (var n = 0; n < t.length; n++) {
            var o = t[n];
            o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, o.key, o);
          }
        }
        return function(t, n, o) {
          return n && e(t.prototype, n), o && e(t, o), t;
        };
      }(),
          i = function() {
            function e() {
              o(this, e);
            }
            return r(e, [{
              key: "addEventListener",
              value: function(e, t) {
                var n = this;
                n[e] = t;
              }
            }, {
              key: "trigger",
              value: function(e, t) {
                var n = this;
                n[e] && n[e](t);
              }
            }]), e;
          }();
      n["default"] = i, t.exports = n["default"];
    }, {}],
    15: [function(e, t, n) {
      "use strict";
      function o(e) {
        var t = /([a-zA-Z-]*):\/\/(?:\.)?([-a-zA-Z0-9@:%._\+~#=]{2,256})([-a-zA-Z0-9@:%._\+~#=\/]*)/gi,
            n = "$1,$2,$3",
            o = e.replace(t, n).split(","),
            r = {
              type: o[0],
              domain: o[1],
              identity: o[2]
            };
        return r;
      }
      function r(e) {
        return JSON.parse(JSON.stringify(e));
      }
      Object.defineProperty(n, "__esModule", {value: !0}), n.divideURL = o, n.deepClone = r;
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
                self.postMessage(msg);
            };
            self.addEventListener('message', function (event) {
                self._miniBus._onMessage(event.data);
            });

            self._registry = new SandboxRegistry(self._miniBus);
            self._registry._create = function (url, sourceCode, config) {
                var activate = eval(sourceCode);
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