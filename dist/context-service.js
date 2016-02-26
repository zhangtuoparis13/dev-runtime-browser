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
    t = "undefined" != typeof window ? window : "undefined" != typeof global ? global : "undefined" != typeof self ? self : this, t.sandbox = e();
  }
}(function() {
  return function e(t, n, o) {
    function r(i, u) {
      if (!n[i]) {
        if (!t[i]) {
          var a = "function" == typeof require && require;
          if (!u && a)
            return a(i, !0);
          if (s)
            return s(i, !0);
          var l = new Error("Cannot find module '" + i + "'");
          throw l.code = "MODULE_NOT_FOUND", l;
        }
        var c = n[i] = {exports: {}};
        t[i][0].call(c.exports, function(e) {
          var n = t[i][1][e];
          return r(n ? n : e);
        }, c, c.exports, e, t, n, o);
      }
      return n[i].exports;
    }
    for (var s = "function" == typeof require && require,
        i = 0; i < o.length; i++)
      r(o[i]);
    return r;
  }({
    1: [function(e, t, n) {
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
          s = function() {
            function e() {
              o(this, e);
              var t = this;
              t._msgId = 0, t._subscriptions = {}, t._responseTimeOut = 5e3, t._responseCallbacks = {}, t._registerExternalListener();
            }
            return r(e, [{
              key: "addListener",
              value: function(e, t) {
                var n = this,
                    o = new i(n._subscriptions, e, t),
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
              key: "bind",
              value: function(e, t, n) {
                var o = this,
                    r = this,
                    s = r.addListener(e, function(e) {
                      n.postMessage(e);
                    }),
                    i = n.addListener(t, function(e) {
                      r.postMessage(e);
                    });
                return {
                  thisListener: s,
                  targetListener: i,
                  unbind: function() {
                    o.thisListener.remove(), o.targetListener.remove();
                  }
                };
              }
            }, {
              key: "_publishOnDefault",
              value: function(e) {
                var t = this._subscriptions["*"];
                t && this._publishOn(t, e);
              }
            }, {
              key: "_publishOn",
              value: function(e, t) {
                e.forEach(function(e) {
                  e._callback(t);
                });
              }
            }, {
              key: "_responseCallback",
              value: function(e, t) {
                var n = this;
                t && !function() {
                  var o = e.from + e.id;
                  n._responseCallbacks[o] = t, setTimeout(function() {
                    var t = n._responseCallbacks[o];
                    if (delete n._responseCallbacks[o], t) {
                      var r = {
                        id: e.id,
                        type: "response",
                        body: {
                          code: 408,
                          desc: "Response timeout!",
                          value: e
                        }
                      };
                      t(r);
                    }
                  }, n._responseTimeOut);
                }();
              }
            }, {
              key: "_onResponse",
              value: function(e) {
                var t = this;
                if ("response" === e.type) {
                  var n = e.to + e.id,
                      o = t._responseCallbacks[n];
                  if (e.body.code >= 200 && delete t._responseCallbacks[n], o)
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
                  n ? t._publishOn(n, e) : t._publishOnDefault(e);
                }
              }
            }, {
              key: "_genId",
              value: function(e) {
                e.id && 0 !== e.id || (this._msgId++, e.id = this._msgId);
              }
            }, {
              key: "postMessage",
              value: function(e, t) {}
            }, {
              key: "_onPostMessage",
              value: function(e) {}
            }, {
              key: "_registerExternalListener",
              value: function() {}
            }]), e;
          }(),
          i = function() {
            function e(t, n, r) {
              o(this, e);
              var s = this;
              s._subscriptions = t, s._url = n, s._callback = r;
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
      n["default"] = s, t.exports = n["default"];
    }, {}],
    2: [function(e, t, n) {
      "use strict";
      function o(e) {
        return e && e.__esModule ? e : {"default": e};
      }
      function r(e, t) {
        if (!(e instanceof t))
          throw new TypeError("Cannot call a class as a function");
      }
      function s(e, t) {
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
          u = function(e, t, n) {
            for (var o = !0; o; ) {
              var r = e,
                  s = t,
                  i = n;
              o = !1, null === r && (r = Function.prototype);
              var u = Object.getOwnPropertyDescriptor(r, s);
              if (void 0 !== u) {
                if ("value" in u)
                  return u.value;
                var a = u.get;
                if (void 0 === a)
                  return;
                return a.call(i);
              }
              var l = Object.getPrototypeOf(r);
              if (null === l)
                return;
              e = l, t = s, n = i, o = !0, u = l = void 0;
            }
          },
          a = e("./Bus"),
          l = o(a),
          c = function(e) {
            function t() {
              r(this, t), u(Object.getPrototypeOf(t.prototype), "constructor", this).call(this);
            }
            return s(t, e), i(t, [{
              key: "postMessage",
              value: function(e, t) {
                var n = this;
                return n._genId(e), n._responseCallback(e, t), n._onPostMessage(e), e.id;
              }
            }, {
              key: "_onMessage",
              value: function(e) {
                var t = this;
                if (!t._onResponse(e)) {
                  var n = t._subscriptions[e.to];
                  n ? (t._publishOn(n, e), e.to.startsWith("hyperty") || t._publishOnDefault(e)) : t._publishOnDefault(e);
                }
              }
            }]), t;
          }(l["default"]);
      n["default"] = c, t.exports = n["default"];
    }, {"./Bus": 1}],
    3: [function(e, t, n) {
      "use strict";
      function o(e) {
        return e && e.__esModule ? e : {"default": e};
      }
      Object.defineProperty(n, "__esModule", {value: !0});
      var r = e("./sandbox/Sandbox"),
          s = o(r),
          i = e("./sandbox/SandboxRegistry"),
          u = o(i);
      n.Sandbox = s["default"], n.SandboxRegistry = u["default"];
    }, {
      "./sandbox/Sandbox": 4,
      "./sandbox/SandboxRegistry": 5
    }],
    4: [function(e, t, n) {
      "use strict";
      function o(e) {
        return e && e.__esModule ? e : {"default": e};
      }
      function r(e, t) {
        if (!(e instanceof t))
          throw new TypeError("Cannot call a class as a function");
      }
      function s(e, t) {
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
          u = function(e, t, n) {
            for (var o = !0; o; ) {
              var r = e,
                  s = t,
                  i = n;
              o = !1, null === r && (r = Function.prototype);
              var u = Object.getOwnPropertyDescriptor(r, s);
              if (void 0 !== u) {
                if ("value" in u)
                  return u.value;
                var a = u.get;
                if (void 0 === a)
                  return;
                return a.call(i);
              }
              var l = Object.getPrototypeOf(r);
              if (null === l)
                return;
              e = l, t = s, n = i, o = !0, u = l = void 0;
            }
          },
          a = e("../sandbox/SandboxRegistry"),
          l = o(a),
          c = e("../bus/MiniBus"),
          f = o(c),
          d = function(e) {
            function t() {
              r(this, t), u(Object.getPrototypeOf(t.prototype), "constructor", this).call(this);
            }
            return s(t, e), i(t, [{
              key: "deployComponent",
              value: function(e, t, n) {
                var o = this;
                return new Promise(function(r, s) {
                  var i = {
                    type: "create",
                    from: l["default"].ExternalDeployAddress,
                    to: l["default"].InternalDeployAddress,
                    body: {
                      url: t,
                      sourceCode: e,
                      config: n
                    }
                  };
                  o.postMessage(i, function(e) {
                    200 === e.body.code ? r("deployed") : s(e.body.desc);
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
                    from: l["default"].ExternalDeployAddress,
                    to: l["default"].InternalDeployAddress,
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
      "../sandbox/SandboxRegistry": 5
    }],
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
          s = function() {
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
                    s = {};
                return n && (s.code = n), o && (s.desc = o), r.body = s, r;
              }
            }, {
              key: "_onDeploy",
              value: function(e) {
                var t = this,
                    n = e.body.config,
                    o = e.body.url,
                    r = e.body.sourceCode,
                    s = void 0,
                    i = void 0;
                if (t._components.hasOwnProperty(o))
                  s = 500, i = "Instance " + o + " already exist!";
                else
                  try {
                    t._components[o] = t._create(o, r, n), s = 200;
                  } catch (u) {
                    s = 500, i = u;
                  }
                var a = t._responseMsg(e, s, i);
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
                var s = t._responseMsg(e, o, r);
                t._bus.postMessage(s);
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
      s.ExternalDeployAddress = "hyperty-runtime://sandbox/external", s.InternalDeployAddress = "hyperty-runtime://sandbox/internal", n["default"] = s, t.exports = n["default"];
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
    var t;
    t = "undefined" != typeof window ? window : "undefined" != typeof global ? global : "undefined" != typeof self ? self : this, t.MiniBus = e();
  }
}(function() {
  return function e(t, n, r) {
    function o(s, u) {
      if (!n[s]) {
        if (!t[s]) {
          var a = "function" == typeof require && require;
          if (!u && a)
            return a(s, !0);
          if (i)
            return i(s, !0);
          var l = new Error("Cannot find module '" + s + "'");
          throw l.code = "MODULE_NOT_FOUND", l;
        }
        var f = n[s] = {exports: {}};
        t[s][0].call(f.exports, function(e) {
          var n = t[s][1][e];
          return o(n ? n : e);
        }, f, f.exports, e, t, n, r);
      }
      return n[s].exports;
    }
    for (var i = "function" == typeof require && require,
        s = 0; s < r.length; s++)
      o(r[s]);
    return o;
  }({
    1: [function(e, t, n) {
      "use strict";
      function r(e, t) {
        if (!(e instanceof t))
          throw new TypeError("Cannot call a class as a function");
      }
      Object.defineProperty(n, "__esModule", {value: !0});
      var o = function() {
        function e(e, t) {
          for (var n = 0; n < t.length; n++) {
            var r = t[n];
            r.enumerable = r.enumerable || !1, r.configurable = !0, "value" in r && (r.writable = !0), Object.defineProperty(e, r.key, r);
          }
        }
        return function(t, n, r) {
          return n && e(t.prototype, n), r && e(t, r), t;
        };
      }(),
          i = function() {
            function e() {
              r(this, e);
              var t = this;
              t._msgId = 0, t._subscriptions = {}, t._responseTimeOut = 5e3, t._responseCallbacks = {}, t._registerExternalListener();
            }
            return o(e, [{
              key: "addListener",
              value: function(e, t) {
                var n = this,
                    r = new s(n._subscriptions, e, t),
                    o = n._subscriptions[e];
                return o || (o = [], n._subscriptions[e] = o), o.push(r), r;
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
              key: "bind",
              value: function(e, t, n) {
                var r = this,
                    o = this,
                    i = o.addListener(e, function(e) {
                      n.postMessage(e);
                    }),
                    s = n.addListener(t, function(e) {
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
              key: "_publishOnDefault",
              value: function(e) {
                var t = this._subscriptions["*"];
                t && this._publishOn(t, e);
              }
            }, {
              key: "_publishOn",
              value: function(e, t) {
                e.forEach(function(e) {
                  e._callback(t);
                });
              }
            }, {
              key: "_responseCallback",
              value: function(e, t) {
                var n = this;
                t && !function() {
                  var r = e.from + e.id;
                  n._responseCallbacks[r] = t, setTimeout(function() {
                    var t = n._responseCallbacks[r];
                    if (delete n._responseCallbacks[r], t) {
                      var o = {
                        id: e.id,
                        type: "response",
                        body: {
                          code: 408,
                          desc: "Response timeout!",
                          value: e
                        }
                      };
                      t(o);
                    }
                  }, n._responseTimeOut);
                }();
              }
            }, {
              key: "_onResponse",
              value: function(e) {
                var t = this;
                if ("response" === e.type) {
                  var n = e.to + e.id,
                      r = t._responseCallbacks[n];
                  if (e.body.code >= 200 && delete t._responseCallbacks[n], r)
                    return r(e), !0;
                }
                return !1;
              }
            }, {
              key: "_onMessage",
              value: function(e) {
                var t = this;
                if (!t._onResponse(e)) {
                  var n = t._subscriptions[e.to];
                  n ? t._publishOn(n, e) : t._publishOnDefault(e);
                }
              }
            }, {
              key: "_genId",
              value: function(e) {
                e.id && 0 !== e.id || (this._msgId++, e.id = this._msgId);
              }
            }, {
              key: "postMessage",
              value: function(e, t) {}
            }, {
              key: "_onPostMessage",
              value: function(e) {}
            }, {
              key: "_registerExternalListener",
              value: function() {}
            }]), e;
          }(),
          s = function() {
            function e(t, n, o) {
              r(this, e);
              var i = this;
              i._subscriptions = t, i._url = n, i._callback = o;
            }
            return o(e, [{
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
    2: [function(e, t, n) {
      "use strict";
      function r(e) {
        return e && e.__esModule ? e : {"default": e};
      }
      function o(e, t) {
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
            var r = t[n];
            r.enumerable = r.enumerable || !1, r.configurable = !0, "value" in r && (r.writable = !0), Object.defineProperty(e, r.key, r);
          }
        }
        return function(t, n, r) {
          return n && e(t.prototype, n), r && e(t, r), t;
        };
      }(),
          u = function(e, t, n) {
            for (var r = !0; r; ) {
              var o = e,
                  i = t,
                  s = n;
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
              e = l, t = i, n = s, r = !0, u = l = void 0;
            }
          },
          a = e("./Bus"),
          l = r(a),
          f = function(e) {
            function t() {
              o(this, t), u(Object.getPrototypeOf(t.prototype), "constructor", this).call(this);
            }
            return i(t, e), s(t, [{
              key: "postMessage",
              value: function(e, t) {
                var n = this;
                return n._genId(e), n._responseCallback(e, t), n._onPostMessage(e), e.id;
              }
            }, {
              key: "_onMessage",
              value: function(e) {
                var t = this;
                if (!t._onResponse(e)) {
                  var n = t._subscriptions[e.to];
                  n ? (t._publishOn(n, e), e.to.startsWith("hyperty") || t._publishOnDefault(e)) : t._publishOnDefault(e);
                }
              }
            }]), t;
          }(l["default"]);
      n["default"] = f, t.exports = n["default"];
    }, {"./Bus": 1}],
    3: [function(e, t, n) {
      "use strict";
      function r(e) {
        return e && e.__esModule ? e : {"default": e};
      }
      Object.defineProperty(n, "__esModule", {value: !0});
      var o = e("./bus/MiniBus"),
          i = r(o);
      n["default"] = i["default"], t.exports = n["default"];
    }, {"./bus/MiniBus": 2}]
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