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
      if (typeof exports == 'object' || typeof exports == 'function') {
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
    function r(s, a) {
      if (!n[s]) {
        if (!t[s]) {
          var u = "function" == typeof require && require;
          if (!a && u)
            return u(s, !0);
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
      function o() {
        l = !1, a.length ? c = a.concat(c) : f = -1, c.length && r();
      }
      function r() {
        if (!l) {
          var e = setTimeout(o);
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
          for (var n = 1; n < arguments.length; n++)
            t[n - 1] = arguments[n];
        c.push(new i(e, t)), 1 !== c.length || l || setTimeout(r, 0);
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
    2: [function(e, t, n) {
      (function(e) {
        Object.create || (Object.create = function() {
          function e() {}
          return function(t) {
            if (1 != arguments.length)
              throw new Error("Object.create implementation only accepts one parameter.");
            return e.prototype = t, new e;
          };
        }()), Object.keys || (Object.keys = function(e, t, n) {
          n = [];
          for (t in e)
            n.hasOwnProperty.call(e, t) && n.push(t);
          return n;
        }), Array.prototype.indexOf || (Array.prototype.indexOf = function(e) {
          for (var t = 0; t < this.length; t++)
            if (this[t] === e)
              return t;
          return -1;
        }), Array.prototype.forEach || (Array.prototype.forEach = function(e) {
          if (void 0 === this || null === this)
            throw new TypeError;
          var t = Object(this),
              n = t.length >>> 0;
          if ("function" != typeof e)
            throw new TypeError;
          for (var o = arguments.length >= 2 ? arguments[1] : void 0,
              r = 0; n > r; r++)
            r in t && e.call(o, t[r], r, t);
          return this;
        }), Array.prototype.filter || (Array.prototype.filter = function(e, t) {
          var n = [];
          return this.forEach(function(o, r, i) {
            e.call(t || void 0, o, r, i) && n.push(o);
          }), n;
        }), Array.prototype.map || (Array.prototype.map = function(e, t) {
          var n = [];
          return this.forEach(function(o, r, i) {
            n.push(e.call(t || void 0, o, r, i));
          }), n;
        }), Array.isArray || (Array.isArray = function(e) {
          return "[object Array]" === Object.prototype.toString.call(e);
        }), "object" != typeof window || "object" != typeof window.location || window.location.assign || (window.location.assign = function(e) {
          window.location = e;
        }), Function.prototype.bind || (Function.prototype.bind = function(e) {
          function t() {}
          if ("function" != typeof this)
            throw new TypeError("Function.prototype.bind - what is trying to be bound is not callable");
          var n = [].slice,
              o = n.call(arguments, 1),
              r = this,
              i = function() {
                return r.apply(this instanceof t ? this : e || window, o.concat(n.call(arguments)));
              };
          return t.prototype = this.prototype, i.prototype = new t, i;
        });
        var n = function(e) {
          return n.use(e);
        };
        n.utils = {extend: function(e) {
            return Array.prototype.slice.call(arguments, 1).forEach(function(t) {
              if (e instanceof Object && t instanceof Object && e !== t)
                for (var o in t)
                  e[o] = n.utils.extend(e[o], t[o]);
              else
                e = t;
            }), e;
          }}, n.utils.extend(n, {
          settings: {
            redirect_uri: window.location.href.split("#")[0],
            response_type: "token",
            display: "popup",
            state: "",
            oauth_proxy: "https://auth-server.herokuapp.com/proxy",
            timeout: 2e4,
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
          use: function(e) {
            var t = Object.create(this);
            return t.settings = Object.create(this.settings), e && (t.settings.default_service = e), t.utils.Event.call(t), t;
          },
          init: function(e, t) {
            var n = this.utils;
            if (!e)
              return this.services;
            for (var o in e)
              e.hasOwnProperty(o) && "object" != typeof e[o] && (e[o] = {id: e[o]});
            n.extend(this.services, e);
            for (o in this.services)
              this.services.hasOwnProperty(o) && (this.services[o].scope = this.services[o].scope || {});
            return t && (n.extend(this.settings, t), "redirect_uri" in t && (this.settings.redirect_uri = n.url(t.redirect_uri).href)), this;
          },
          login: function() {
            function e(e, t) {
              n.emit(e, t);
            }
            function t(e) {
              return e;
            }
            function o(e) {
              return !!e;
            }
            var r,
                i = this,
                s = i.utils,
                a = s.error,
                u = s.Promise(),
                c = s.args({
                  network: "s",
                  options: "o",
                  callback: "f"
                }, arguments),
                l = s.diffKey(c.options, i.settings),
                f = c.options = s.merge(i.settings, c.options || {});
            if (f.popup = s.merge(i.settings.popup, c.options.popup || {}), c.network = c.network || i.settings.default_service, u.proxy.then(c.callback, c.callback), u.proxy.then(e.bind(this, "auth.login auth"), e.bind(this, "auth.failed auth")), "string" != typeof c.network || !(c.network in i.services))
              return u.reject(a("invalid_network", "The provided network was not recognized"));
            var d = i.services[c.network],
                p = s.globalEvent(function(e) {
                  var t;
                  t = e ? JSON.parse(e) : a("cancelled", "The authentication was not completed"), t.error ? u.reject(t) : (s.store(t.network, t), u.fulfill({
                    network: t.network,
                    authResponse: t
                  }));
                }),
                m = s.url(f.redirect_uri).href,
                h = d.oauth.response_type || f.response_type;
            /\bcode\b/.test(h) && !d.oauth.grant && (h = h.replace(/\bcode\b/, "token")), c.qs = s.merge(l, {
              client_id: encodeURIComponent(d.id),
              response_type: encodeURIComponent(h),
              redirect_uri: encodeURIComponent(m),
              display: f.display,
              scope: "basic",
              state: {
                client_id: d.id,
                network: c.network,
                display: f.display,
                callback: p,
                state: f.state,
                redirect_uri: m
              }
            });
            var g = s.store(c.network),
                y = /[,\s]+/,
                v = (f.scope || "").toString() + "," + c.qs.scope;
            if (g && "scope" in g && g.scope instanceof String && (v += "," + g.scope), v = v.split(y), v = s.unique(v).filter(o), c.qs.state.scope = v.join(","), v = v.map(function(e) {
              if (e in d.scope)
                return d.scope[e];
              for (var t in i.services) {
                var n = i.services[t].scope;
                if (n && e in n)
                  return "";
              }
              return e;
            }), v = v.join(",").split(y), v = s.unique(v).filter(o), c.qs.scope = v.join(d.scope_delim || ","), f.force === !1 && g && "access_token" in g && g.access_token && "expires" in g && g.expires > (new Date).getTime() / 1e3) {
              var b = s.diff((g.scope || "").split(y), (c.qs.state.scope || "").split(y));
              if (0 === b.length)
                return u.fulfill({
                  unchanged: !0,
                  network: c.network,
                  authResponse: g
                }), u;
            }
            if ("page" === f.display && f.page_uri && (c.qs.state.page_uri = s.url(f.page_uri).href), "login" in d && "function" == typeof d.login && d.login(c), (!/\btoken\b/.test(h) || parseInt(d.oauth.version, 10) < 2 || "none" === f.display && d.oauth.grant && g && g.refresh_token) && (c.qs.state.oauth = d.oauth, c.qs.state.oauth_proxy = f.oauth_proxy), c.qs.state = encodeURIComponent(JSON.stringify(c.qs.state)), 1 === parseInt(d.oauth.version, 10) ? r = s.qs(f.oauth_proxy, c.qs, t) : "none" === f.display && d.oauth.grant && g && g.refresh_token ? (c.qs.refresh_token = g.refresh_token, r = s.qs(f.oauth_proxy, c.qs, t)) : r = s.qs(d.oauth.auth, c.qs, t), "none" === f.display)
              s.iframe(r, m);
            else if ("popup" === f.display)
              var _ = s.popup(r, m, f.popup),
                  w = setInterval(function() {
                    if ((!_ || _.closed) && (clearInterval(w), !u.state)) {
                      var e = a("cancelled", "Login has been cancelled");
                      _ || (e = a("blocked", "Popup was blocked")), e.network = c.network, u.reject(e);
                    }
                  }, 100);
            else
              window.location = r;
            return u.proxy;
          },
          logout: function() {
            function e(e, t) {
              n.emit(e, t);
            }
            var t = this,
                o = t.utils,
                r = o.error,
                i = o.Promise(),
                s = o.args({
                  name: "s",
                  options: "o",
                  callback: "f"
                }, arguments);
            if (s.options = s.options || {}, i.proxy.then(s.callback, s.callback), i.proxy.then(e.bind(this, "auth.logout auth"), e.bind(this, "error")), s.name = s.name || this.settings.default_service, s.authResponse = o.store(s.name), !s.name || s.name in t.services)
              if (s.name && s.authResponse) {
                var a = function(e) {
                  o.store(s.name, ""), i.fulfill(n.utils.merge({network: s.name}, e || {}));
                },
                    u = {};
                if (s.options.force) {
                  var c = t.services[s.name].logout;
                  if (c)
                    if ("function" == typeof c && (c = c(a, s)), "string" == typeof c)
                      o.iframe(c), u.force = null, u.message = "Logout success on providers site was indeterminate";
                    else if (void 0 === c)
                      return i.proxy;
                }
                a(u);
              } else
                i.reject(r("invalid_session", "There was no session to remove"));
            else
              i.reject(r("invalid_network", "The network was unrecognized"));
            return i.proxy;
          },
          getAuthResponse: function(e) {
            return e = e || this.settings.default_service, e && e in this.services ? this.utils.store(e) || null : null;
          },
          events: {}
        }), n.utils.extend(n.utils, {
          error: function(e, t) {
            return {error: {
                code: e,
                message: t
              }};
          },
          qs: function(e, t, n) {
            if (t) {
              n = n || encodeURIComponent;
              for (var o in t) {
                var r = "([\\?\\&])" + o + "=[^\\&]*",
                    i = new RegExp(r);
                e.match(i) && (e = e.replace(i, "$1" + o + "=" + n(t[o])), delete t[o]);
              }
            }
            return this.isEmpty(t) ? e : e + (e.indexOf("?") > -1 ? "&" : "?") + this.param(t, n);
          },
          param: function(e, t) {
            var n,
                o,
                r = {};
            if ("string" == typeof e) {
              if (t = t || decodeURIComponent, o = e.replace(/^[\#\?]/, "").match(/([^=\/\&]+)=([^\&]+)/g))
                for (var i = 0; i < o.length; i++)
                  n = o[i].match(/([^=]+)=(.*)/), r[n[1]] = t(n[2]);
              return r;
            }
            t = t || encodeURIComponent;
            var s = e;
            r = [];
            for (var a in s)
              s.hasOwnProperty(a) && s.hasOwnProperty(a) && r.push([a, "?" === s[a] ? "?" : t(s[a])].join("="));
            return r.join("&");
          },
          store: function() {
            function e() {
              var e = {};
              try {
                e = JSON.parse(n.getItem("hello")) || {};
              } catch (t) {}
              return e;
            }
            function t(e) {
              n.setItem("hello", JSON.stringify(e));
            }
            for (var n,
                o = ["localStorage", "sessionStorage"],
                r = -1,
                i = "test"; o[++r]; )
              try {
                n = window[o[r]], n.setItem(i + r, r), n.removeItem(i + r);
                break;
              } catch (s) {
                n = null;
              }
            if (!n) {
              var a = null;
              n = {
                getItem: function(e) {
                  e += "=";
                  for (var t = document.cookie.split(";"),
                      n = 0; n < t.length; n++) {
                    var o = t[n].replace(/(^\s+|\s+$)/, "");
                    if (o && 0 === o.indexOf(e))
                      return o.substr(e.length);
                  }
                  return a;
                },
                setItem: function(e, t) {
                  a = t, document.cookie = e + "=" + t;
                }
              }, a = n.getItem("hello");
            }
            return function(n, o, r) {
              var i = e();
              if (n && void 0 === o)
                return i[n] || null;
              if (n && null === o)
                try {
                  delete i[n];
                } catch (s) {
                  i[n] = null;
                }
              else {
                if (!n)
                  return i;
                i[n] = o;
              }
              return t(i), i || null;
            };
          }(),
          append: function(e, t, n) {
            var o = "string" == typeof e ? document.createElement(e) : e;
            if ("object" == typeof t)
              if ("tagName" in t)
                n = t;
              else
                for (var r in t)
                  if (t.hasOwnProperty(r))
                    if ("object" == typeof t[r])
                      for (var i in t[r])
                        t[r].hasOwnProperty(i) && (o[r][i] = t[r][i]);
                    else
                      "html" === r ? o.innerHTML = t[r] : /^on/.test(r) ? o[r] = t[r] : o.setAttribute(r, t[r]);
            return "body" === n ? !function s() {
              document.body ? document.body.appendChild(o) : setTimeout(s, 16);
            }() : "object" == typeof n ? n.appendChild(o) : "string" == typeof n && document.getElementsByTagName(n)[0].appendChild(o), o;
          },
          iframe: function(e) {
            this.append("iframe", {
              src: e,
              style: {
                position: "absolute",
                left: "-1000px",
                bottom: 0,
                height: "1px",
                width: "1px"
              }
            }, "body");
          },
          merge: function() {
            var e = Array.prototype.slice.call(arguments);
            return e.unshift({}), this.extend.apply(null, e);
          },
          args: function(e, t) {
            var n = {},
                o = 0,
                r = null,
                i = null;
            for (i in e)
              if (e.hasOwnProperty(i))
                break;
            if (1 === t.length && "object" == typeof t[0] && "o!" != e[i])
              for (i in t[0])
                if (e.hasOwnProperty(i) && i in e)
                  return t[0];
            for (i in e)
              if (e.hasOwnProperty(i))
                if (r = typeof t[o], "function" == typeof e[i] && e[i].test(t[o]) || "string" == typeof e[i] && (e[i].indexOf("s") > -1 && "string" === r || e[i].indexOf("o") > -1 && "object" === r || e[i].indexOf("i") > -1 && "number" === r || e[i].indexOf("a") > -1 && "object" === r || e[i].indexOf("f") > -1 && "function" === r))
                  n[i] = t[o++];
                else if ("string" == typeof e[i] && e[i].indexOf("!") > -1)
                  return !1;
            return n;
          },
          url: function(e) {
            if (e) {
              if (window.URL && URL instanceof Function && 0 !== URL.length)
                return new URL(e, window.location);
              var t = document.createElement("a");
              return t.href = e, t.cloneNode(!1);
            }
            return window.location;
          },
          diff: function(e, t) {
            return t.filter(function(t) {
              return -1 === e.indexOf(t);
            });
          },
          diffKey: function(e, t) {
            if (e || !t) {
              var n = {};
              for (var o in e)
                o in t || (n[o] = e[o]);
              return n;
            }
            return e;
          },
          unique: function(e) {
            return Array.isArray(e) ? e.filter(function(t, n) {
              return e.indexOf(t) === n;
            }) : [];
          },
          isEmpty: function(e) {
            if (!e)
              return !0;
            if (Array.isArray(e))
              return !e.length;
            if ("object" == typeof e)
              for (var t in e)
                if (e.hasOwnProperty(t))
                  return !1;
            return !0;
          },
          Promise: function() {
            var t = 0,
                n = 1,
                o = 2,
                r = function(e) {
                  return this instanceof r ? (this.id = "Thenable/1.0.6", this.state = t, this.fulfillValue = void 0, this.rejectReason = void 0, this.onFulfilled = [], this.onRejected = [], this.proxy = {then: this.then.bind(this)}, void("function" == typeof e && e.call(this, this.fulfill.bind(this), this.reject.bind(this)))) : new r(e);
                };
            r.prototype = {
              fulfill: function(e) {
                return i(this, n, "fulfillValue", e);
              },
              reject: function(e) {
                return i(this, o, "rejectReason", e);
              },
              then: function(e, t) {
                var n = this,
                    o = new r;
                return n.onFulfilled.push(u(e, o, "fulfill")), n.onRejected.push(u(t, o, "reject")), s(n), o.proxy;
              }
            };
            var i = function(e, n, o, r) {
              return e.state === t && (e.state = n, e[o] = r, s(e)), e;
            },
                s = function(e) {
                  e.state === n ? a(e, "onFulfilled", e.fulfillValue) : e.state === o && a(e, "onRejected", e.rejectReason);
                },
                a = function(t, n, o) {
                  if (0 !== t[n].length) {
                    var r = t[n];
                    t[n] = [];
                    var i = function() {
                      for (var e = 0; e < r.length; e++)
                        r[e](o);
                    };
                    "object" == typeof e && "function" == typeof e.nextTick ? e.nextTick(i) : "function" == typeof setImmediate ? setImmediate(i) : setTimeout(i, 0);
                  }
                },
                u = function(e, t, n) {
                  return function(o) {
                    if ("function" != typeof e)
                      t[n].call(t, o);
                    else {
                      var r;
                      try {
                        r = e(o);
                      } catch (i) {
                        return void t.reject(i);
                      }
                      c(t, r);
                    }
                  };
                },
                c = function(e, t) {
                  if (e === t || e.proxy === t)
                    return void e.reject(new TypeError("cannot resolve promise with itself"));
                  var n;
                  if ("object" == typeof t && null !== t || "function" == typeof t)
                    try {
                      n = t.then;
                    } catch (o) {
                      return void e.reject(o);
                    }
                  if ("function" != typeof n)
                    e.fulfill(t);
                  else {
                    var r = !1;
                    try {
                      n.call(t, function(n) {
                        r || (r = !0, n === t ? e.reject(new TypeError("circular thenable chain")) : c(e, n));
                      }, function(t) {
                        r || (r = !0, e.reject(t));
                      });
                    } catch (o) {
                      r || e.reject(o);
                    }
                  }
                };
            return r;
          }(),
          Event: function() {
            var e = /[\s\,]+/;
            return this.parent = {
              events: this.events,
              findEvents: this.findEvents,
              parent: this.parent,
              utils: this.utils
            }, this.events = {}, this.on = function(t, n) {
              if (n && "function" == typeof n)
                for (var o = t.split(e),
                    r = 0; r < o.length; r++)
                  this.events[o[r]] = [n].concat(this.events[o[r]] || []);
              return this;
            }, this.off = function(e, t) {
              return this.findEvents(e, function(e, n) {
                t && this.events[e][n] !== t || (this.events[e][n] = null);
              }), this;
            }, this.emit = function(e) {
              var t = Array.prototype.slice.call(arguments, 1);
              t.push(e);
              for (var n = function(n, o) {
                t[t.length - 1] = "*" === n ? e : n, this.events[n][o].apply(this, t);
              },
                  o = this; o && o.findEvents; )
                o.findEvents(e + ",*", n), o = o.parent;
              return this;
            }, this.emitAfter = function() {
              var e = this,
                  t = arguments;
              return setTimeout(function() {
                e.emit.apply(e, t);
              }, 0), this;
            }, this.findEvents = function(t, n) {
              var o = t.split(e);
              for (var r in this.events)
                if (this.events.hasOwnProperty(r) && o.indexOf(r) > -1)
                  for (var i = 0; i < this.events[r].length; i++)
                    this.events[r][i] && n.call(this, r, i);
            }, this;
          },
          globalEvent: function(e, t) {
            return t = t || "_hellojs_" + parseInt(1e12 * Math.random(), 10).toString(36), window[t] = function() {
              try {
                e.apply(this, arguments) && delete window[t];
              } catch (n) {
                console.error(n);
              }
            }, t;
          },
          popup: function(e, t, o) {
            var r = document.documentElement;
            if (o.height) {
              var i = void 0 !== window.screenTop ? window.screenTop : screen.top,
                  s = screen.height || window.innerHeight || r.clientHeight;
              o.top = parseInt((s - o.height) / 2, 10) + i;
            }
            if (o.width) {
              var a = void 0 !== window.screenLeft ? window.screenLeft : screen.left,
                  u = screen.width || window.innerWidth || r.clientWidth;
              o.left = parseInt((u - o.width) / 2, 10) + a;
            }
            var c = [];
            Object.keys(o).forEach(function(e) {
              var t = o[e];
              c.push(e + (null !== t ? "=" + t : ""));
            });
            var l = function(e) {
              var o = window.open(e, "_blank", c.join(","));
              try {
                if (o && o.addEventListener) {
                  var r = n.utils.url(t),
                      i = r.origin || r.protocol + "//" + r.hostname;
                  o.addEventListener("loadstart", function(e) {
                    var t = e.url;
                    if (0 === t.indexOf(i)) {
                      var r = n.utils.url(t),
                          s = {
                            location: {
                              assign: function(e) {
                                o.addEventListener("exit", function() {
                                  setTimeout(function() {
                                    l(e);
                                  }, 1e3);
                                });
                              },
                              search: r.search,
                              hash: r.hash,
                              href: r.href
                            },
                            close: function() {
                              o.close && o.close();
                            }
                          };
                      n.utils.responseHandler(s, window), s.close();
                    }
                  });
                }
              } catch (s) {}
              return o && o.focus && o.focus(), o;
            };
            return -1 !== navigator.userAgent.indexOf("Safari") && -1 === navigator.userAgent.indexOf("Chrome") && (e = t + "#oauth_redirect=" + encodeURIComponent(encodeURIComponent(e))), l(e);
          },
          responseHandler: function(e, t) {
            function n(e, t, n) {
              var r = e.callback,
                  s = e.network;
              if (i.store(s, e), !("display" in e && "page" === e.display)) {
                if (n && r && r in n) {
                  try {
                    delete e.callback;
                  } catch (a) {}
                  i.store(s, e);
                  var u = JSON.stringify(e);
                  try {
                    n[r](u);
                  } catch (a) {}
                }
                o();
              }
            }
            function o() {
              try {
                e.close();
              } catch (t) {}
              e.addEventListener && e.addEventListener("load", function() {
                e.close();
              });
            }
            var r,
                i = this,
                s = e.location;
            if (r = i.param(s.search), r && r.state && (r.code || r.oauth_token)) {
              var a = JSON.parse(r.state);
              r.redirect_uri = a.redirect_uri || s.href.replace(/[\?\#].*$/, "");
              var u = a.oauth_proxy + "?" + i.param(r);
              return void s.assign(u);
            }
            if (r = i.merge(i.param(s.search || ""), i.param(s.hash || "")), r && "state" in r) {
              try {
                var c = JSON.parse(r.state);
                i.extend(r, c);
              } catch (l) {
                console.error("Could not decode state parameter");
              }
              if ("access_token" in r && r.access_token && r.network)
                r.expires_in && 0 !== parseInt(r.expires_in, 10) || (r.expires_in = 0), r.expires_in = parseInt(r.expires_in, 10), r.expires = (new Date).getTime() / 1e3 + (r.expires_in || 31536e3), n(r, e, t);
              else if ("error" in r && r.error && r.network)
                r.error = {
                  code: r.error,
                  message: r.error_message || r.error_description
                }, n(r, e, t);
              else if (r.callback && r.callback in t) {
                var f = "result" in r && r.result ? JSON.parse(r.result) : !1;
                t[r.callback](f), o();
              }
              r.page_uri && s.assign(r.page_uri);
            } else if ("oauth_redirect" in r)
              return void s.assign(decodeURIComponent(r.oauth_redirect));
          }
        }), n.utils.Event.call(n), n.utils.responseHandler(window, window.opener || window.parent), function(e) {
          var t = {},
              n = {};
          e.on("auth.login, auth.logout", function(n) {
            n && "object" == typeof n && n.network && (t[n.network] = e.utils.store(n.network) || {});
          }), function o() {
            var r = (new Date).getTime() / 1e3,
                i = function(t) {
                  e.emit("auth." + t, {
                    network: s,
                    authResponse: a
                  });
                };
            for (var s in e.services)
              if (e.services.hasOwnProperty(s)) {
                if (!e.services[s].id)
                  continue;
                var a = e.utils.store(s) || {},
                    u = e.services[s],
                    c = t[s] || {};
                if (a && "callback" in a) {
                  var l = a.callback;
                  try {
                    delete a.callback;
                  } catch (f) {}
                  e.utils.store(s, a);
                  try {
                    window[l](a);
                  } catch (f) {}
                }
                if (a && "expires" in a && a.expires < r) {
                  var d = u.refresh || a.refresh_token;
                  !d || s in n && !(n[s] < r) ? d || s in n || (i("expired"), n[s] = !0) : (e.emit("notice", s + " has expired trying to resignin"), e.login(s, {
                    display: "none",
                    force: !1
                  }), n[s] = r + 600);
                  continue;
                }
                if (c.access_token === a.access_token && c.expires === a.expires)
                  continue;
                !a.access_token && c.access_token ? i("logout") : a.access_token && !c.access_token ? i("login") : a.expires !== c.expires && i("update"), t[s] = a, s in n && delete n[s];
              }
            setTimeout(o, 1e3);
          }();
        }(n), n.api = function() {
          function e(e) {
            e = e.replace(/\@\{([a-z\_\-]+)(\|.*?)?\}/gi, function(e, t, n) {
              var s = n ? n.replace(/^\|/, "") : "";
              return t in i.query ? (s = i.query[t], delete i.query[t]) : i.data && t in i.data ? (s = i.data[t], delete i.data[t]) : n || r.reject(o("missing_attribute", "The attribute " + t + " is missing from the request")), s;
            }), e.match(/^https?:\/\//) || (e = c.base + e), i.url = e, n.request(i, function(e, t) {
              if (!i.formatResponse)
                return void(("object" == typeof t ? t.statusCode >= 400 : "object" == typeof e && "error" in e) ? r.reject(e) : r.fulfill(e));
              if (e === !0 ? e = {success: !0} : e || (e = {}), "delete" === i.method && (e = !e || n.isEmpty(e) ? {success: !0} : e), c.wrap && (i.path in c.wrap || "default" in c.wrap)) {
                var o = i.path in c.wrap ? i.path : "default",
                    s = ((new Date).getTime(), c.wrap[o](e, t, i));
                s && (e = s);
              }
              e && "paging" in e && e.paging.next && ("?" === e.paging.next[0] ? e.paging.next = i.path + e.paging.next : e.paging.next += "#" + i.path), !e || "error" in e ? r.reject(e) : r.fulfill(e);
            });
          }
          var t = this,
              n = t.utils,
              o = n.error,
              r = n.Promise(),
              i = n.args({
                path: "s!",
                query: "o",
                method: "s",
                data: "o",
                timeout: "i",
                callback: "f"
              }, arguments);
          i.method = (i.method || "get").toLowerCase(), i.headers = i.headers || {}, i.query = i.query || {}, ("get" === i.method || "delete" === i.method) && (n.extend(i.query, i.data), i.data = {});
          var s = i.data = i.data || {};
          if (r.then(i.callback, i.callback), !i.path)
            return r.reject(o("invalid_path", "Missing the path parameter from the request"));
          i.path = i.path.replace(/^\/+/, "");
          var a = (i.path.split(/[\/\:]/, 2) || [])[0].toLowerCase();
          if (a in t.services) {
            i.network = a;
            var u = new RegExp("^" + a + ":?/?");
            i.path = i.path.replace(u, "");
          }
          i.network = t.settings.default_service = i.network || t.settings.default_service;
          var c = t.services[i.network];
          if (!c)
            return r.reject(o("invalid_network", "Could not match the service requested: " + i.network));
          if (i.method in c && i.path in c[i.method] && c[i.method][i.path] === !1)
            return r.reject(o("invalid_path", "The provided path is not available on the selected network"));
          i.oauth_proxy || (i.oauth_proxy = t.settings.oauth_proxy), "proxy" in i || (i.proxy = i.oauth_proxy && c.oauth && 1 === parseInt(c.oauth.version, 10)), "timeout" in i || (i.timeout = t.settings.timeout), "formatResponse" in i || (i.formatResponse = !0), i.authResponse = t.getAuthResponse(i.network), i.authResponse && i.authResponse.access_token && (i.query.access_token = i.authResponse.access_token);
          var l,
              f = i.path;
          i.options = n.clone(i.query), i.data = n.clone(s);
          var d = c[{"delete": "del"}[i.method] || i.method] || {};
          if ("get" === i.method) {
            var p = f.split(/[\?#]/)[1];
            p && (n.extend(i.query, n.param(p)), f = f.replace(/\?.*?(#|$)/, "$1"));
          }
          return (l = f.match(/#(.+)/, "")) ? (f = f.split("#")[0], i.path = l[1]) : f in d ? (i.path = f, f = d[f]) : "default" in d && (f = d["default"]), i.redirect_uri = t.settings.redirect_uri, i.xhr = c.xhr, i.jsonp = c.jsonp, i.form = c.form, "function" == typeof f ? f(i, e) : e(f), r.proxy;
        }, n.utils.extend(n.utils, {
          request: function(e, t) {
            function n(e, t) {
              var n;
              e.authResponse && e.authResponse.oauth && 1 === parseInt(e.authResponse.oauth.version, 10) && (n = e.query.access_token, delete e.query.access_token, e.proxy = !0), !e.data || "get" !== e.method && "delete" !== e.method || (o.extend(e.query, e.data), e.data = null);
              var r = o.qs(e.url, e.query);
              e.proxy && (r = o.qs(e.oauth_proxy, {
                path: r,
                access_token: n || "",
                then: e.proxy_response_type || ("get" === e.method.toLowerCase() ? "redirect" : "proxy"),
                method: e.method.toLowerCase(),
                suppress_response_codes: !0
              })), t(r);
            }
            var o = this,
                r = o.error;
            o.isEmpty(e.data) || "FileList" in window || !o.hasBinary(e.data) || (e.xhr = !1, e.jsonp = !1);
            var i = this.request_cors(function() {
              return void 0 === e.xhr || e.xhr && ("function" != typeof e.xhr || e.xhr(e, e.query));
            });
            if (i)
              return void n(e, function(n) {
                var r = o.xhr(e.method, n, e.headers, e.data, t);
                r.onprogress = e.onprogress || null, r.upload && e.onuploadprogress && (r.upload.onprogress = e.onuploadprogress);
              });
            var s = e.query;
            if (e.query = o.clone(e.query), e.callbackID = o.globalEvent(), e.jsonp !== !1) {
              if (e.query.callback = e.callbackID, "function" == typeof e.jsonp && e.jsonp(e, e.query), "get" === e.method)
                return void n(e, function(n) {
                  o.jsonp(n, t, e.callbackID, e.timeout);
                });
              e.query = s;
            }
            if (e.form !== !1) {
              e.query.redirect_uri = e.redirect_uri, e.query.state = JSON.stringify({callback: e.callbackID});
              var a;
              if ("function" == typeof e.form && (a = e.form(e, e.query)), "post" === e.method && a !== !1)
                return void n(e, function(n) {
                  o.post(n, e.data, a, t, e.callbackID, e.timeout);
                });
            }
            t(r("invalid_request", "There was no mechanism for handling this request"));
          },
          request_cors: function(e) {
            return "withCredentials" in new XMLHttpRequest && e();
          },
          domInstance: function(e, t) {
            var n = "HTML" + (e || "").replace(/^[a-z]/, function(e) {
              return e.toUpperCase();
            }) + "Element";
            return t ? window[n] ? t instanceof window[n] : window.Element ? t instanceof window.Element && (!e || t.tagName && t.tagName.toLowerCase() === e) : !(t instanceof Object || t instanceof Array || t instanceof String || t instanceof Number) && t.tagName && t.tagName.toLowerCase() === e : !1;
          },
          clone: function(e) {
            if (null === e || "object" != typeof e || e instanceof Date || "nodeName" in e || this.isBinary(e))
              return e;
            if (Array.isArray(e))
              return e.map(this.clone.bind(this));
            var t = {};
            for (var n in e)
              t[n] = this.clone(e[n]);
            return t;
          },
          xhr: function(e, t, n, o, r) {
            function i(e) {
              for (var t,
                  n = {},
                  o = /([a-z\-]+):\s?(.*);?/gi; t = o.exec(e); )
                n[t[1]] = t[2];
              return n;
            }
            var s = new XMLHttpRequest,
                a = this.error,
                u = !1;
            "blob" === e && (u = e, e = "GET"), e = e.toUpperCase(), s.onload = function(t) {
              var n = s.response;
              try {
                n = JSON.parse(s.responseText);
              } catch (o) {
                401 === s.status && (n = a("access_denied", s.statusText));
              }
              var u = i(s.getAllResponseHeaders());
              u.statusCode = s.status, r(n || ("GET" === e ? a("empty_response", "Could not get resource") : {}), u);
            }, s.onerror = function(e) {
              var t = s.responseText;
              try {
                t = JSON.parse(s.responseText);
              } catch (n) {}
              r(t || a("access_denied", "Could not get resource"));
            };
            var c;
            if ("GET" === e || "DELETE" === e)
              o = null;
            else if (o && "string" != typeof o && !(o instanceof FormData) && !(o instanceof File) && !(o instanceof Blob)) {
              var l = new FormData;
              for (c in o)
                o.hasOwnProperty(c) && (o[c] instanceof HTMLInputElement ? "files" in o[c] && o[c].files.length > 0 && l.append(c, o[c].files[0]) : o[c] instanceof Blob ? l.append(c, o[c], o.name) : l.append(c, o[c]));
              o = l;
            }
            if (s.open(e, t, !0), u && ("responseType" in s ? s.responseType = u : s.overrideMimeType("text/plain; charset=x-user-defined")), n)
              for (c in n)
                s.setRequestHeader(c, n[c]);
            return s.send(o), s;
          },
          jsonp: function(e, t, n, o) {
            var r,
                i = this,
                s = i.error,
                a = 0,
                u = document.getElementsByTagName("head")[0],
                c = s("server_error", "server_error"),
                l = function() {
                  a++ || window.setTimeout(function() {
                    t(c), u.removeChild(f);
                  }, 0);
                };
            n = i.globalEvent(function(e) {
              return c = e, !0;
            }, n), e = e.replace(new RegExp("=\\?(&|$)"), "=" + n + "$1");
            var f = i.append("script", {
              id: n,
              name: n,
              src: e,
              async: !0,
              onload: l,
              onerror: l,
              onreadystatechange: function() {
                /loaded|complete/i.test(this.readyState) && l();
              }
            });
            window.navigator.userAgent.toLowerCase().indexOf("opera") > -1 && (r = i.append("script", {text: "document.getElementById('" + n + "').onerror();"}), f.async = !1), o && window.setTimeout(function() {
              c = s("timeout", "timeout"), l();
            }, o), u.appendChild(f), r && u.appendChild(r);
          },
          post: function(e, t, n, o, r, i) {
            var s,
                a = this,
                u = a.error,
                c = document,
                l = null,
                f = [],
                d = 0,
                p = null,
                m = 0,
                h = function(e) {
                  m++ || o(e);
                };
            a.globalEvent(h, r);
            var g;
            try {
              g = c.createElement('<iframe name="' + r + '">');
            } catch (y) {
              g = c.createElement("iframe");
            }
            if (g.name = r, g.id = r, g.style.display = "none", n && n.callbackonload && (g.onload = function() {
              h({
                response: "posted",
                message: "Content was posted"
              });
            }), i && setTimeout(function() {
              h(u("timeout", "The post operation timed out"));
            }, i), c.body.appendChild(g), a.domInstance("form", t)) {
              for (l = t.form, d = 0; d < l.elements.length; d++)
                l.elements[d] !== t && l.elements[d].setAttribute("disabled", !0);
              t = l;
            }
            if (a.domInstance("form", t))
              for (l = t, d = 0; d < l.elements.length; d++)
                l.elements[d].disabled || "file" !== l.elements[d].type || (l.encoding = l.enctype = "multipart/form-data", l.elements[d].setAttribute("name", "file"));
            else {
              for (p in t)
                t.hasOwnProperty(p) && a.domInstance("input", t[p]) && "file" === t[p].type && (l = t[p].form, l.encoding = l.enctype = "multipart/form-data");
              l || (l = c.createElement("form"), c.body.appendChild(l), s = l);
              var v;
              for (p in t)
                if (t.hasOwnProperty(p)) {
                  var b = a.domInstance("input", t[p]) || a.domInstance("textArea", t[p]) || a.domInstance("select", t[p]);
                  if (b && t[p].form === l)
                    b && t[p].name !== p && (t[p].setAttribute("name", p), t[p].name = p);
                  else {
                    var _ = l.elements[p];
                    if (v)
                      for (_ instanceof NodeList || (_ = [_]), d = 0; d < _.length; d++)
                        _[d].parentNode.removeChild(_[d]);
                    v = c.createElement("input"), v.setAttribute("type", "hidden"), v.setAttribute("name", p), b ? v.value = t[p].value : a.domInstance(null, t[p]) ? v.value = t[p].innerHTML || t[p].innerText : v.value = t[p], l.appendChild(v);
                  }
                }
              for (d = 0; d < l.elements.length; d++)
                v = l.elements[d], v.name in t || v.getAttribute("disabled") === !0 || (v.setAttribute("disabled", !0), f.push(v));
            }
            l.setAttribute("method", "POST"), l.setAttribute("target", r), l.target = r, l.setAttribute("action", e), setTimeout(function() {
              l.submit(), setTimeout(function() {
                try {
                  s && s.parentNode.removeChild(s);
                } catch (e) {
                  try {
                    console.error("HelloJS: could not remove iframe");
                  } catch (t) {}
                }
                for (var n = 0; n < f.length; n++)
                  f[n] && (f[n].setAttribute("disabled", !1), f[n].disabled = !1);
              }, 0);
            }, 100);
          },
          hasBinary: function(e) {
            for (var t in e)
              if (e.hasOwnProperty(t) && this.isBinary(e[t]))
                return !0;
            return !1;
          },
          isBinary: function(e) {
            return e instanceof Object && (this.domInstance("input", e) && "file" === e.type || "FileList" in window && e instanceof window.FileList || "File" in window && e instanceof window.File || "Blob" in window && e instanceof window.Blob);
          },
          toBlob: function(e) {
            var t = /^data\:([^;,]+(\;charset=[^;,]+)?)(\;base64)?,/i,
                n = e.match(t);
            if (!n)
              return e;
            for (var o = atob(e.replace(t, "")),
                r = [],
                i = 0; i < o.length; i++)
              r.push(o.charCodeAt(i));
            return new Blob([new Uint8Array(r)], {type: n[1]});
          }
        }), function(e) {
          var t = e.api,
              n = e.utils;
          n.extend(n, {
            dataToJSON: function(e) {
              var t = this,
                  n = window,
                  o = e.data;
              if (t.domInstance("form", o) ? o = t.nodeListToJSON(o.elements) : "NodeList" in n && o instanceof NodeList ? o = t.nodeListToJSON(o) : t.domInstance("input", o) && (o = t.nodeListToJSON([o])), ("File" in n && o instanceof n.File || "Blob" in n && o instanceof n.Blob || "FileList" in n && o instanceof n.FileList) && (o = {file: o}), !("FormData" in n && o instanceof n.FormData))
                for (var r in o)
                  if (o.hasOwnProperty(r))
                    if ("FileList" in n && o[r] instanceof n.FileList)
                      1 === o[r].length && (o[r] = o[r][0]);
                    else {
                      if (t.domInstance("input", o[r]) && "file" === o[r].type)
                        continue;
                      t.domInstance("input", o[r]) || t.domInstance("select", o[r]) || t.domInstance("textArea", o[r]) ? o[r] = o[r].value : t.domInstance(null, o[r]) && (o[r] = o[r].innerHTML || o[r].innerText);
                    }
              return e.data = o, o;
            },
            nodeListToJSON: function(e) {
              for (var t = {},
                  n = 0; n < e.length; n++) {
                var o = e[n];
                !o.disabled && o.name && ("file" === o.type ? t[o.name] = o : t[o.name] = o.value || o.innerHTML);
              }
              return t;
            }
          }), e.api = function() {
            var e = n.args({
              path: "s!",
              method: "s",
              data: "o",
              timeout: "i",
              callback: "f"
            }, arguments);
            return e.data && n.dataToJSON(e), t.call(this, e);
          };
        }(n), "object" == typeof chrome && "object" == typeof chrome.identity && chrome.identity.launchWebAuthFlow && !function() {
          function e(t, o) {
            var r = {closed: !1};
            return chrome.identity.launchWebAuthFlow({
              url: t,
              interactive: o
            }, function(t) {
              if (void 0 === t)
                return void(r.closed = !0);
              var o = n.utils.url(t),
                  i = {
                    location: {
                      assign: function(t) {
                        e(t, !1);
                      },
                      search: o.search,
                      hash: o.hash,
                      href: o.href
                    },
                    close: function() {}
                  };
              n.utils.responseHandler(i, window);
            }), r;
          }
          n.utils.popup = function(t) {
            return e(t, !0);
          }, n.utils.iframe = function(t) {
            e(t, !1);
          }, n.utils.request_cors = function(e) {
            return e(), !0;
          };
          var t = {};
          chrome.storage.local.get("hello", function(e) {
            t = e.hello || {};
          }), n.utils.store = function(e, n) {
            return 0 === arguments.length ? t : 1 === arguments.length ? t[e] || null : n ? (t[e] = n, chrome.storage.local.set({hello: t}), n) : null === n ? (delete t[e], chrome.storage.local.set({hello: t}), null) : void 0;
          };
        }(), function(e) {
          function t(e) {
            e && "error" in e && (e.error = {
              code: "server_error",
              message: e.error.message || e.error
            });
          }
          function n(t, n, o) {
            if (!("object" != typeof t || "undefined" != typeof Blob && t instanceof Blob || "undefined" != typeof ArrayBuffer && t instanceof ArrayBuffer || "error" in t)) {
              var r = ("app_folder" !== t.root ? t.root : "") + t.path.replace(/\&/g, "%26");
              r = r.replace(/^\//, ""), t.thumb_exists && (t.thumbnail = o.oauth_proxy + "?path=" + encodeURIComponent("https://api-content.dropbox.com/1/thumbnails/auto/" + r + "?format=jpeg&size=m") + "&access_token=" + o.options.access_token), t.type = t.is_dir ? "folder" : t.mime_type, t.name = t.path.replace(/.*\//g, ""), t.is_dir ? t.files = r.replace(/^\//, "") : (t.downloadLink = e.settings.oauth_proxy + "?path=" + encodeURIComponent("https://api-content.dropbox.com/1/files/auto/" + r) + "&access_token=" + o.options.access_token, t.file = "https://api-content.dropbox.com/1/files/auto/" + r), t.id || (t.id = t.path.replace(/^\//, ""));
            }
          }
          function o(e) {
            return function(t, n) {
              delete t.query.limit, n(e);
            };
          }
          var r = {
            version: "1.0",
            auth: "https://www.dropbox.com/1/oauth/authorize",
            request: "https://api.dropbox.com/1/oauth/request_token",
            token: "https://api.dropbox.com/1/oauth/access_token"
          },
              i = {
                version: 2,
                auth: "https://www.dropbox.com/1/oauth2/authorize",
                grant: "https://api.dropbox.com/1/oauth2/token"
              };
          e.init({dropbox: {
              name: "Dropbox",
              oauth: i,
              login: function(t) {
                t.qs.scope = "", delete t.qs.display;
                var n = decodeURIComponent(t.qs.redirect_uri);
                0 === n.indexOf("http:") && 0 !== n.indexOf("http://localhost/") ? e.services.dropbox.oauth = r : e.services.dropbox.oauth = i, t.options.popup.width = 1e3, t.options.popup.height = 1e3;
              },
              base: "https://api.dropbox.com/1/",
              root: "sandbox",
              get: {
                me: "account/info",
                "me/files": o("metadata/auto/@{parent|}"),
                "me/folder": o("metadata/auto/@{id}"),
                "me/folders": o("metadata/auto/"),
                "default": function(e, t) {
                  e.path.match("https://api-content.dropbox.com/1/files/") && (e.method = "blob"), t(e.path);
                }
              },
              post: {
                "me/files": function(t, n) {
                  var o = t.data.parent,
                      r = t.data.name;
                  t.data = {file: t.data.file}, "string" == typeof t.data.file && (t.data.file = e.utils.toBlob(t.data.file)), n("https://api-content.dropbox.com/1/files_put/auto/" + o + "/" + r);
                },
                "me/folders": function(t, n) {
                  var o = t.data.name;
                  t.data = {}, n("fileops/create_folder?root=@{root|sandbox}&" + e.utils.param({path: o}));
                }
              },
              del: {
                "me/files": "fileops/delete?root=@{root|sandbox}&path=@{id}",
                "me/folder": "fileops/delete?root=@{root|sandbox}&path=@{id}"
              },
              wrap: {
                me: function(e) {
                  if (t(e), !e.uid)
                    return e;
                  e.name = e.display_name;
                  var n = e.name.split(" ");
                  return e.first_name = n.shift(), e.last_name = n.join(" "), e.id = e.uid, delete e.uid, delete e.display_name, e;
                },
                "default": function(e, o, r) {
                  return t(e), e.is_dir && e.contents && (e.data = e.contents, delete e.contents, e.data.forEach(function(t) {
                    t.root = e.root, n(t, o, r);
                  })), n(e, o, r), e.is_deleted && (e.success = !0), e;
                }
              },
              xhr: function(e) {
                if (e.data && e.data.file) {
                  var t = e.data.file;
                  t && (t.files ? e.data = t.files[0] : e.data = t);
                }
                return "delete" === e.method && (e.method = "post"), !0;
              },
              form: function(e, t) {
                delete t.state, delete t.redirect_uri;
              }
            }});
        }(n), function(e) {
          function t(e) {
            return e.id && (e.thumbnail = e.picture = "https://graph.facebook.com/" + e.id + "/picture"), e;
          }
          function n(e) {
            return "data" in e && e.data.forEach(t), e;
          }
          function o(e, t, n) {
            if ("boolean" == typeof e && (e = {success: e}), e && "data" in e) {
              var o = n.query.access_token;
              e.data.forEach(function(e) {
                e.picture && (e.thumbnail = e.picture), e.pictures = (e.images || []).sort(function(e, t) {
                  return e.width - t.width;
                }), e.cover_photo && e.cover_photo.id && (e.thumbnail = r + e.cover_photo.id + "/picture?access_token=" + o), "album" === e.type && (e.files = e.photos = r + e.id + "/photos"), e.can_upload && (e.upload_location = r + e.id + "/photos");
              });
            }
            return e;
          }
          e.init({facebook: {
              name: "Facebook",
              oauth: {
                version: 2,
                auth: "https://www.facebook.com/dialog/oauth/",
                grant: "https://graph.facebook.com/oauth/access_token"
              },
              scope: {
                basic: "public_profile",
                email: "email",
                share: "user_posts",
                birthday: "user_birthday",
                events: "user_events",
                photos: "user_photos,user_videos",
                videos: "user_photos,user_videos",
                friends: "user_friends",
                files: "user_photos,user_videos",
                publish_files: "user_photos,user_videos,publish_actions",
                publish: "publish_actions",
                offline_access: "offline_access"
              },
              refresh: !0,
              login: function(e) {
                e.options.force && (e.qs.auth_type = "reauthenticate"), e.options.popup.width = 580, e.options.popup.height = 400;
              },
              logout: function(t, n) {
                var o = e.utils.globalEvent(t),
                    r = encodeURIComponent(e.settings.redirect_uri + "?" + e.utils.param({
                      callback: o,
                      result: JSON.stringify({force: !0}),
                      state: "{}"
                    })),
                    i = (n.authResponse || {}).access_token;
                return e.utils.iframe("https://www.facebook.com/logout.php?next=" + r + "&access_token=" + i), i ? void 0 : !1;
              },
              base: "https://graph.facebook.com/v2.4/",
              get: {
                me: "me?fields=email,first_name,last_name,name,timezone,verified",
                "me/friends": "me/friends",
                "me/following": "me/friends",
                "me/followers": "me/friends",
                "me/share": "me/feed",
                "me/like": "me/likes",
                "me/files": "me/albums",
                "me/albums": "me/albums?fields=cover_photo,name",
                "me/album": "@{id}/photos?fields=picture",
                "me/photos": "me/photos",
                "me/photo": "@{id}",
                "friend/albums": "@{id}/albums",
                "friend/photos": "@{id}/photos"
              },
              post: {
                "me/share": "me/feed",
                "me/photo": "@{id}"
              },
              wrap: {
                me: t,
                "me/friends": n,
                "me/following": n,
                "me/followers": n,
                "me/albums": o,
                "me/photos": o,
                "me/files": o,
                "default": o
              },
              xhr: function(t, n) {
                return ("get" === t.method || "post" === t.method) && (n.suppress_response_codes = !0), "post" === t.method && t.data && "string" == typeof t.data.file && (t.data.file = e.utils.toBlob(t.data.file)), !0;
              },
              jsonp: function(t, n) {
                var o = t.method;
                "get" === o || e.utils.hasBinary(t.data) ? "delete" === t.method && (n.method = "delete", t.method = "post") : (t.data.method = o, t.method = "get");
              },
              form: function(e) {
                return {callbackonload: !0};
              }
            }});
          var r = "https://graph.facebook.com/";
        }(n), function(e) {
          function t(t, n, o) {
            var r = (o ? "" : "flickr:") + "?method=" + t + "&api_key=" + e.services.flickr.id + "&format=json";
            for (var i in n)
              n.hasOwnProperty(i) && (r += "&" + i + "=" + n[i]);
            return r;
          }
          function n(t) {
            var n = e.getAuthResponse("flickr");
            t(n && n.user_nsid ? n.user_nsid : null);
          }
          function o(e, o) {
            return o || (o = {}), function(r, i) {
              n(function(n) {
                o.user_id = n, i(t(e, o, !0));
              });
            };
          }
          function r(e, t) {
            var n = "https://www.flickr.com/images/buddyicon.gif";
            return e.nsid && e.iconserver && e.iconfarm && (n = "https://farm" + e.iconfarm + ".staticflickr.com/" + e.iconserver + "/buddyicons/" + e.nsid + (t ? "_" + t : "") + ".jpg"), n;
          }
          function i(e, t, n, o, r) {
            return r = r ? "_" + r : "", "https://farm" + t + ".staticflickr.com/" + n + "/" + e + "_" + o + r + ".jpg";
          }
          function s(e) {
            e && e.stat && "ok" != e.stat.toLowerCase() && (e.error = {
              code: "invalid_request",
              message: e.message
            });
          }
          function a(e) {
            if (e.photoset || e.photos) {
              var t = "photoset" in e ? "photoset" : "photos";
              e = c(e, t), f(e), e.data = e.photo, delete e.photo;
              for (var n = 0; n < e.data.length; n++) {
                var o = e.data[n];
                o.name = o.title, o.picture = i(o.id, o.farm, o.server, o.secret, ""), o.pictures = u(o.id, o.farm, o.server, o.secret), o.source = i(o.id, o.farm, o.server, o.secret, "b"), o.thumbnail = i(o.id, o.farm, o.server, o.secret, "m");
              }
            }
            return e;
          }
          function u(e, t, n, o) {
            var r = 2048,
                s = [{
                  id: "t",
                  max: 100
                }, {
                  id: "m",
                  max: 240
                }, {
                  id: "n",
                  max: 320
                }, {
                  id: "",
                  max: 500
                }, {
                  id: "z",
                  max: 640
                }, {
                  id: "c",
                  max: 800
                }, {
                  id: "b",
                  max: 1024
                }, {
                  id: "h",
                  max: 1600
                }, {
                  id: "k",
                  max: 2048
                }, {
                  id: "o",
                  max: r
                }];
            return s.map(function(r) {
              return {
                source: i(e, t, n, o, r.id),
                width: r.max,
                height: r.max
              };
            });
          }
          function c(e, t) {
            return t in e ? e = e[t] : "error" in e || (e.error = {
              code: "invalid_request",
              message: e.message || "Failed to get data from Flickr"
            }), e;
          }
          function l(e) {
            if (s(e), e.contacts) {
              e = c(e, "contacts"), f(e), e.data = e.contact, delete e.contact;
              for (var t = 0; t < e.data.length; t++) {
                var n = e.data[t];
                n.id = n.nsid, n.name = n.realname || n.username, n.thumbnail = r(n, "m");
              }
            }
            return e;
          }
          function f(e) {
            e.page && e.pages && e.page !== e.pages && (e.paging = {next: "?page=" + ++e.page});
          }
          e.init({flickr: {
              name: "Flickr",
              oauth: {
                version: "1.0a",
                auth: "https://www.flickr.com/services/oauth/authorize?perms=read",
                request: "https://www.flickr.com/services/oauth/request_token",
                token: "https://www.flickr.com/services/oauth/access_token"
              },
              base: "https://api.flickr.com/services/rest",
              get: {
                me: o("flickr.people.getInfo"),
                "me/friends": o("flickr.contacts.getList", {per_page: "@{limit|50}"}),
                "me/following": o("flickr.contacts.getList", {per_page: "@{limit|50}"}),
                "me/followers": o("flickr.contacts.getList", {per_page: "@{limit|50}"}),
                "me/albums": o("flickr.photosets.getList", {per_page: "@{limit|50}"}),
                "me/album": o("flickr.photosets.getPhotos", {photoset_id: "@{id}"}),
                "me/photos": o("flickr.people.getPhotos", {per_page: "@{limit|50}"})
              },
              wrap: {
                me: function(e) {
                  if (s(e), e = c(e, "person"), e.id) {
                    if (e.realname) {
                      e.name = e.realname._content;
                      var t = e.name.split(" ");
                      e.first_name = t.shift(), e.last_name = t.join(" ");
                    }
                    e.thumbnail = r(e, "l"), e.picture = r(e, "l");
                  }
                  return e;
                },
                "me/friends": l,
                "me/followers": l,
                "me/following": l,
                "me/albums": function(e) {
                  return s(e), e = c(e, "photosets"), f(e), e.photoset && (e.data = e.photoset, e.data.forEach(function(e) {
                    e.name = e.title._content, e.photos = "https://api.flickr.com/services/rest" + t("flickr.photosets.getPhotos", {photoset_id: e.id}, !0);
                  }), delete e.photoset), e;
                },
                "me/photos": function(e) {
                  return s(e), a(e);
                },
                "default": function(e) {
                  return s(e), a(e);
                }
              },
              xhr: !1,
              jsonp: function(e, t) {
                "get" == e.method && (delete t.callback, t.jsoncallback = e.callbackID);
              }
            }});
        }(n), function(e) {
          function t(e) {
            !e.meta || 400 !== e.meta.code && 401 !== e.meta.code || (e.error = {
              code: "access_denied",
              message: e.meta.errorDetail
            });
          }
          function n(e) {
            e && e.id && (e.thumbnail = e.photo.prefix + "100x100" + e.photo.suffix, e.name = e.firstName + " " + e.lastName, e.first_name = e.firstName, e.last_name = e.lastName, e.contact && e.contact.email && (e.email = e.contact.email));
          }
          function o(e, t) {
            var n = t.access_token;
            return delete t.access_token, t.oauth_token = n, t.v = 20121125, !0;
          }
          e.init({foursquare: {
              name: "Foursquare",
              oauth: {
                version: 2,
                auth: "https://foursquare.com/oauth2/authenticate",
                grant: "https://foursquare.com/oauth2/access_token"
              },
              refresh: !0,
              base: "https://api.foursquare.com/v2/",
              get: {
                me: "users/self",
                "me/friends": "users/self/friends",
                "me/followers": "users/self/friends",
                "me/following": "users/self/friends"
              },
              wrap: {
                me: function(e) {
                  return t(e), e && e.response && (e = e.response.user, n(e)), e;
                },
                "default": function(e) {
                  return t(e), e && "response" in e && "friends" in e.response && "items" in e.response.friends && (e.data = e.response.friends.items, e.data.forEach(n), delete e.response), e;
                }
              },
              xhr: o,
              jsonp: o
            }});
        }(n), function(e) {
          function t(e, t) {
            var n = t ? t.statusCode : e && "meta" in e && "status" in e.meta && e.meta.status;
            (401 === n || 403 === n) && (e.error = {
              code: "access_denied",
              message: e.message || (e.data ? e.data.message : "Could not get response")
            }, delete e.message);
          }
          function n(e) {
            e.id && (e.thumbnail = e.picture = e.avatar_url, e.name = e.login);
          }
          function o(e, t, n) {
            if (e.data && e.data.length && t && t.Link) {
              var o = t.Link.match(/<(.*?)>;\s*rel=\"next\"/);
              o && (e.paging = {next: o[1]});
            }
          }
          e.init({github: {
              name: "GitHub",
              oauth: {
                version: 2,
                auth: "https://github.com/login/oauth/authorize",
                grant: "https://github.com/login/oauth/access_token",
                response_type: "code"
              },
              scope: {
                basic: "",
                email: "user:email"
              },
              base: "https://api.github.com/",
              get: {
                me: "user",
                "me/friends": "user/following?per_page=@{limit|100}",
                "me/following": "user/following?per_page=@{limit|100}",
                "me/followers": "user/followers?per_page=@{limit|100}",
                "me/like": "user/starred?per_page=@{limit|100}"
              },
              wrap: {
                me: function(e, o) {
                  return t(e, o), n(e), e;
                },
                "default": function(e, r, i) {
                  return t(e, r), Array.isArray(e) && (e = {data: e}), e.data && (o(e, r, i), e.data.forEach(n)), e;
                }
              },
              xhr: function(e) {
                return "get" !== e.method && e.data && (e.headers = e.headers || {}, e.headers["Content-Type"] = "application/json", "object" == typeof e.data && (e.data = JSON.stringify(e.data))), !0;
              }
            }});
        }(n), function(e) {
          function t(e) {
            return parseInt(e, 10);
          }
          function n(e) {
            return l(e), e.data = e.items, delete e.items, e;
          }
          function o(e) {
            return e.error ? void 0 : (e.name || (e.name = e.title || e.message), e.picture || (e.picture = e.thumbnailLink), e.thumbnail || (e.thumbnail = e.thumbnailLink), "application/vnd.google-apps.folder" === e.mimeType && (e.type = "folder", e.files = "https://www.googleapis.com/drive/v2/files?q=%22" + e.id + "%22+in+parents"), e);
          }
          function r(e) {
            return {
              source: e.url,
              width: e.width,
              height: e.height
            };
          }
          function i(e) {
            e.data = e.feed.entry.map(c), delete e.feed;
          }
          function s(e) {
            if (l(e), "feed" in e && "entry" in e.feed)
              e.data = e.feed.entry.map(c), delete e.feed;
            else {
              if ("entry" in e)
                return c(e.entry);
              "items" in e ? (e.data = e.items.map(o), delete e.items) : o(e);
            }
            return e;
          }
          function a(e) {
            e.name = e.displayName || e.name, e.picture = e.picture || (e.image ? e.image.url : null), e.thumbnail = e.picture;
          }
          function u(e, t, n) {
            l(e);
            if ("feed" in e && "entry" in e.feed) {
              for (var o = n.query.access_token,
                  r = 0; r < e.feed.entry.length; r++) {
                var i = e.feed.entry[r];
                if (i.id = i.id.$t, i.name = i.title.$t, delete i.title, i.gd$email && (i.email = i.gd$email && i.gd$email.length > 0 ? i.gd$email[0].address : null, i.emails = i.gd$email, delete i.gd$email), i.updated && (i.updated = i.updated.$t), i.link) {
                  var s = i.link.length > 0 ? i.link[0].href : null;
                  s && i.link[0].gd$etag && (s += (s.indexOf("?") > -1 ? "&" : "?") + "access_token=" + o, i.picture = s, i.thumbnail = s), delete i.link;
                }
                i.category && delete i.category;
              }
              e.data = e.feed.entry, delete e.feed;
            }
            return e;
          }
          function c(e) {
            var t,
                n = e.media$group,
                o = n.media$content.length ? n.media$content[0] : {},
                i = n.media$content || [],
                s = n.media$thumbnail || [],
                a = i.concat(s).map(r).sort(function(e, t) {
                  return e.width - t.width;
                }),
                u = 0,
                c = {
                  id: e.id.$t,
                  name: e.title.$t,
                  description: e.summary.$t,
                  updated_time: e.updated.$t,
                  created_time: e.published.$t,
                  picture: o ? o.url : null,
                  pictures: a,
                  images: [],
                  thumbnail: o ? o.url : null,
                  width: o.width,
                  height: o.height
                };
            if ("link" in e)
              for (u = 0; u < e.link.length; u++) {
                var l = e.link[u];
                if (l.rel.match(/\#feed$/)) {
                  c.upload_location = c.files = c.photos = l.href;
                  break;
                }
              }
            if ("category" in e && e.category.length)
              for (t = e.category, u = 0; u < t.length; u++)
                t[u].scheme && t[u].scheme.match(/\#kind$/) && (c.type = t[u].term.replace(/^.*?\#/, ""));
            return "media$thumbnail" in n && n.media$thumbnail.length && (t = n.media$thumbnail, c.thumbnail = t[0].url, c.images = t.map(r)), t = n.media$content, t && t.length && c.images.push(r(t[0])), c;
          }
          function l(e) {
            if ("feed" in e && e.feed.openSearch$itemsPerPage) {
              var n = t(e.feed.openSearch$itemsPerPage.$t),
                  o = t(e.feed.openSearch$startIndex.$t),
                  r = t(e.feed.openSearch$totalResults.$t);
              r > o + n && (e.paging = {next: "?start=" + (o + n)});
            } else
              "nextPageToken" in e && (e.paging = {next: "?pageToken=" + e.nextPageToken});
          }
          function f() {
            function e(e) {
              var n = new FileReader;
              n.onload = function(n) {
                t(btoa(n.target.result), e.type + i + "Content-Transfer-Encoding: base64");
              }, n.readAsBinaryString(e);
            }
            function t(e, t) {
              n.push(i + "Content-Type: " + t + i + i + e), r--, a();
            }
            var n = [],
                o = (1e10 * Math.random()).toString(32),
                r = 0,
                i = "\r\n",
                s = i + "--" + o,
                a = function() {},
                u = /^data\:([^;,]+(\;charset=[^;,]+)?)(\;base64)?,/i;
            this.append = function(n, o) {
              "string" != typeof n && "length" in Object(n) || (n = [n]);
              for (var s = 0; s < n.length; s++) {
                r++;
                var a = n[s];
                if ("undefined" != typeof File && a instanceof File || "undefined" != typeof Blob && a instanceof Blob)
                  e(a);
                else if ("string" == typeof a && a.match(u)) {
                  var c = a.match(u);
                  t(a.replace(u, ""), c[1] + i + "Content-Transfer-Encoding: base64");
                } else
                  t(a, o);
              }
            }, this.onready = function(e) {
              (a = function() {
                0 === r && (n.unshift(""), n.push("--"), e(n.join(s), o), n = []);
              })();
            };
          }
          function d(e, t) {
            var n = {};
            e.data && "undefined" != typeof HTMLInputElement && e.data instanceof HTMLInputElement && (e.data = {file: e.data}), !e.data.name && Object(Object(e.data.file).files).length && "post" === e.method && (e.data.name = e.data.file.files[0].name), "post" === e.method ? e.data = {
              title: e.data.name,
              parents: [{id: e.data.parent || "root"}],
              file: e.data.file
            } : (n = e.data, e.data = {}, n.parent && (e.data.parents = [{id: e.data.parent || "root"}]), n.file && (e.data.file = n.file), n.name && (e.data.title = n.name));
            var o;
            if ("file" in e.data && (o = e.data.file, delete e.data.file, "object" == typeof o && "files" in o && (o = o.files), !o || !o.length))
              return void t({error: {
                  code: "request_invalid",
                  message: "There were no files attached with this request to upload"
                }});
            var r = new f;
            r.append(JSON.stringify(e.data), "application/json"), o && r.append(o), r.onready(function(o, r) {
              e.headers["content-type"] = 'multipart/related; boundary="' + r + '"', e.data = o, t("upload/drive/v2/files" + (n.id ? "/" + n.id : "") + "?uploadType=multipart");
            });
          }
          function p(e) {
            if ("object" == typeof e.data)
              try {
                e.data = JSON.stringify(e.data), e.headers["content-type"] = "application/json";
              } catch (t) {}
          }
          var m = "https://www.google.com/m8/feeds/contacts/default/full?v=3.0&alt=json&max-results=@{limit|1000}&start-index=@{start|1}";
          e.init({google: {
              name: "Google Plus",
              oauth: {
                version: 2,
                auth: "https://accounts.google.com/o/oauth2/auth",
                grant: "https://accounts.google.com/o/oauth2/token"
              },
              scope: {
                basic: "https://www.googleapis.com/auth/plus.me profile",
                email: "email",
                birthday: "",
                events: "",
                photos: "https://picasaweb.google.com/data/",
                videos: "http://gdata.youtube.com",
                friends: "https://www.google.com/m8/feeds, https://www.googleapis.com/auth/plus.login",
                files: "https://www.googleapis.com/auth/drive.readonly",
                publish: "",
                publish_files: "https://www.googleapis.com/auth/drive",
                create_event: "",
                offline_access: ""
              },
              scope_delim: " ",
              login: function(e) {
                "none" === e.qs.display && (e.qs.display = ""), "code" === e.qs.response_type && (e.qs.access_type = "offline"), e.options.force && (e.qs.approval_prompt = "force");
              },
              base: "https://www.googleapis.com/",
              get: {
                me: "plus/v1/people/me",
                "me/friends": "plus/v1/people/me/people/visible?maxResults=@{limit|100}",
                "me/following": m,
                "me/followers": m,
                "me/contacts": m,
                "me/share": "plus/v1/people/me/activities/public?maxResults=@{limit|100}",
                "me/feed": "plus/v1/people/me/activities/public?maxResults=@{limit|100}",
                "me/albums": "https://picasaweb.google.com/data/feed/api/user/default?alt=json&max-results=@{limit|100}&start-index=@{start|1}",
                "me/album": function(e, t) {
                  var n = e.query.id;
                  delete e.query.id, t(n.replace("/entry/", "/feed/"));
                },
                "me/photos": "https://picasaweb.google.com/data/feed/api/user/default?alt=json&kind=photo&max-results=@{limit|100}&start-index=@{start|1}",
                "me/files": "drive/v2/files?q=%22@{parent|root}%22+in+parents+and+trashed=false&maxResults=@{limit|100}",
                "me/folders": "drive/v2/files?q=%22@{id|root}%22+in+parents+and+mimeType+=+%22application/vnd.google-apps.folder%22+and+trashed=false&maxResults=@{limit|100}",
                "me/folder": "drive/v2/files?q=%22@{id|root}%22+in+parents+and+trashed=false&maxResults=@{limit|100}"
              },
              post: {
                "me/files": d,
                "me/folders": function(e, t) {
                  e.data = {
                    title: e.data.name,
                    parents: [{id: e.data.parent || "root"}],
                    mimeType: "application/vnd.google-apps.folder"
                  }, t("drive/v2/files");
                }
              },
              put: {"me/files": d},
              del: {
                "me/files": "drive/v2/files/@{id}",
                "me/folder": "drive/v2/files/@{id}"
              },
              wrap: {
                me: function(e) {
                  return e.id && (e.last_name = e.family_name || (e.name ? e.name.familyName : null), e.first_name = e.given_name || (e.name ? e.name.givenName : null), e.emails && e.emails.length && (e.email = e.emails[0].value), a(e)), e;
                },
                "me/friends": function(e) {
                  return e.items && (l(e), e.data = e.items, e.data.forEach(a), delete e.items), e;
                },
                "me/contacts": u,
                "me/followers": u,
                "me/following": u,
                "me/share": n,
                "me/feed": n,
                "me/albums": s,
                "me/photos": i,
                "default": s
              },
              xhr: function(e) {
                return ("post" === e.method || "put" === e.method) && p(e), !0;
              },
              form: !1
            }});
        }(n), function(e) {
          function t(e) {
            return {
              source: e.url,
              width: e.width,
              height: e.height
            };
          }
          function n(e) {
            return "string" == typeof e ? {error: {
                code: "invalid_request",
                message: e
              }} : (e && "meta" in e && "error_type" in e.meta && (e.error = {
              code: e.meta.error_type,
              message: e.meta.error_message
            }), e);
          }
          function o(e) {
            return i(e), e && "data" in e && e.data.forEach(r), e;
          }
          function r(e) {
            e.id && (e.thumbnail = e.profile_picture, e.name = e.full_name || e.username);
          }
          function i(e) {
            "pagination" in e && (e.paging = {next: e.pagination.next_url}, delete e.pagination);
          }
          e.init({instagram: {
              name: "Instagram",
              oauth: {
                version: 2,
                auth: "https://instagram.com/oauth/authorize/",
                grant: "https://api.instagram.com/oauth/access_token"
              },
              refresh: !0,
              scope: {
                basic: "basic",
                friends: "relationships",
                publish: "likes comments"
              },
              scope_delim: " ",
              login: function(e) {
                e.qs.display = "";
              },
              base: "https://api.instagram.com/v1/",
              get: {
                me: "users/self",
                "me/feed": "users/self/feed?count=@{limit|100}",
                "me/photos": "users/self/media/recent?min_id=0&count=@{limit|100}",
                "me/friends": "users/self/follows?count=@{limit|100}",
                "me/following": "users/self/follows?count=@{limit|100}",
                "me/followers": "users/self/followed-by?count=@{limit|100}",
                "friend/photos": "users/@{id}/media/recent?min_id=0&count=@{limit|100}"
              },
              post: {"me/like": function(e, t) {
                  var n = e.data.id;
                  e.data = {}, t("media/" + n + "/likes");
                }},
              del: {"me/like": "media/@{id}/likes"},
              wrap: {
                me: function(e) {
                  return n(e), "data" in e && (e.id = e.data.id, e.thumbnail = e.data.profile_picture, e.name = e.data.full_name || e.data.username), e;
                },
                "me/friends": o,
                "me/following": o,
                "me/followers": o,
                "me/photos": function(e) {
                  return n(e), i(e), "data" in e && (e.data = e.data.filter(function(e) {
                    return "image" === e.type;
                  }), e.data.forEach(function(e) {
                    e.name = e.caption ? e.caption.text : null, e.thumbnail = e.images.thumbnail.url, e.picture = e.images.standard_resolution.url, e.pictures = Object.keys(e.images).map(function(n) {
                      var o = e.images[n];
                      return t(o);
                    }).sort(function(e, t) {
                      return e.width - t.width;
                    });
                  })), e;
                },
                "default": function(e) {
                  return e = n(e), i(e), e;
                }
              },
              xhr: function(e, t) {
                var n = e.method,
                    o = "get" !== n;
                return o && ("post" !== n && "put" !== n || !e.query.access_token || (e.data.access_token = e.query.access_token, delete e.query.access_token), e.proxy = o), o;
              },
              form: !1
            }});
        }(n), function(e) {
          function t(e, t) {
            var n,
                r;
            return e && "Message" in e && (r = e.Message, delete e.Message, "ErrorCode" in e ? (n = e.ErrorCode, delete e.ErrorCode) : n = o(t), e.error = {
              code: n,
              message: r,
              details: e
            }), e;
          }
          function n(e, t) {
            var n = t.access_token;
            return delete t.access_token, e.headers.Authorization = "Bearer " + n, "get" !== e.method && e.data && (e.headers["Content-Type"] = "application/json", "object" == typeof e.data && (e.data = JSON.stringify(e.data))), "put" === e.method && (e.method = "patch"), !0;
          }
          function o(e) {
            switch (e.statusCode) {
              case 400:
                return "invalid_request";
              case 403:
                return "stale_token";
              case 401:
                return "invalid_token";
              case 500:
                return "server_error";
              default:
                return "server_error";
            }
          }
          e.init({joinme: {
              name: "join.me",
              oauth: {
                version: 2,
                auth: "https://secure.join.me/api/public/v1/auth/oauth2",
                grant: "https://secure.join.me/api/public/v1/auth/oauth2"
              },
              refresh: !1,
              scope: {
                basic: "user_info",
                user: "user_info",
                scheduler: "scheduler",
                start: "start_meeting"
              },
              scope_delim: " ",
              login: function(e) {
                e.options.popup.width = 400, e.options.popup.height = 700;
              },
              base: "https://api.join.me/v1/",
              get: {
                me: "user",
                meetings: "meetings",
                "meetings/info": "meetings/@{id}"
              },
              post: {
                "meetings/start/adhoc": function(e, t) {
                  t("meetings/start");
                },
                "meetings/start/scheduled": function(e, t) {
                  var n = e.data.meetingId;
                  e.data = {}, t("meetings/" + n + "/start");
                },
                "meetings/schedule": function(e, t) {
                  t("meetings");
                }
              },
              patch: {"meetings/update": function(e, t) {
                  t("meetings/" + e.data.meetingId);
                }},
              del: {"meetings/delete": "meetings/@{id}"},
              wrap: {
                me: function(e, n) {
                  return t(e, n), e.email ? (e.name = e.fullName, e.first_name = e.name.split(" ")[0], e.last_name = e.name.split(" ")[1], e.id = e.email, e) : e;
                },
                "default": function(e, n) {
                  return t(e, n), e;
                }
              },
              xhr: n
            }});
        }(n), function(e) {
          function t(e) {
            e && "errorCode" in e && (e.error = {
              code: e.status,
              message: e.message
            });
          }
          function n(e) {
            return e.error ? void 0 : (e.first_name = e.firstName, e.last_name = e.lastName, e.name = e.formattedName || e.first_name + " " + e.last_name, e.thumbnail = e.pictureUrl, e.email = e.emailAddress, e);
          }
          function o(e) {
            return t(e), r(e), e.values && (e.data = e.values.map(n), delete e.values), e;
          }
          function r(e) {
            "_count" in e && "_start" in e && e._count + e._start < e._total && (e.paging = {next: "?start=" + (e._start + e._count) + "&count=" + e._count});
          }
          function i(e, t) {
            "{}" === JSON.stringify(e) && 200 === t.statusCode && (e.success = !0);
          }
          function s(e) {
            e.access_token && (e.oauth2_access_token = e.access_token, delete e.access_token);
          }
          function a(e, t) {
            e.headers["x-li-format"] = "json";
            var n = e.data.id;
            e.data = ("delete" !== e.method).toString(), e.method = "put", t("people/~/network/updates/key=" + n + "/is-liked");
          }
          e.init({linkedin: {
              oauth: {
                version: 2,
                response_type: "code",
                auth: "https://www.linkedin.com/uas/oauth2/authorization",
                grant: "https://www.linkedin.com/uas/oauth2/accessToken"
              },
              refresh: !0,
              scope: {
                basic: "r_basicprofile",
                email: "r_emailaddress",
                friends: "",
                publish: "w_share"
              },
              scope_delim: " ",
              base: "https://api.linkedin.com/v1/",
              get: {
                me: "people/~:(picture-url,first-name,last-name,id,formatted-name,email-address)",
                "me/friends": "people/~/connections?count=@{limit|500}",
                "me/followers": "people/~/connections?count=@{limit|500}",
                "me/following": "people/~/connections?count=@{limit|500}",
                "me/share": "people/~/network/updates?count=@{limit|250}"
              },
              post: {
                "me/share": function(e, t) {
                  var n = {visibility: {code: "anyone"}};
                  e.data.id ? n.attribution = {share: {id: e.data.id}} : (n.comment = e.data.message, e.data.picture && e.data.link && (n.content = {
                    "submitted-url": e.data.link,
                    "submitted-image-url": e.data.picture
                  })), e.data = JSON.stringify(n), t("people/~/shares?format=json");
                },
                "me/like": a
              },
              del: {"me/like": a},
              wrap: {
                me: function(e) {
                  return t(e), n(e), e;
                },
                "me/friends": o,
                "me/following": o,
                "me/followers": o,
                "me/share": function(e) {
                  return t(e), r(e), e.values && (e.data = e.values.map(n), e.data.forEach(function(e) {
                    e.message = e.headline;
                  }), delete e.values), e;
                },
                "default": function(e, n) {
                  t(e), i(e, n), r(e);
                }
              },
              jsonp: function(e, t) {
                s(t), "get" === e.method && (t.format = "jsonp", t["error-callback"] = e.callbackID);
              },
              xhr: function(e, t) {
                return "get" !== e.method ? (s(t), e.headers["Content-Type"] = "application/json", e.headers["x-li-format"] = "json", e.proxy = !0, !0) : !1;
              }
            }});
        }(n), function(e) {
          function t(e, t) {
            var n = t.access_token;
            return delete t.access_token, t.oauth_token = n, t["_status_code_map[302]"] = 200, !0;
          }
          function n(e) {
            return e.id && (e.picture = e.avatar_url, e.thumbnail = e.avatar_url, e.name = e.username || e.full_name), e;
          }
          function o(e) {
            "next_href" in e && (e.paging = {next: e.next_href});
          }
          e.init({soundcloud: {
              name: "SoundCloud",
              oauth: {
                version: 2,
                auth: "https://soundcloud.com/connect",
                grant: "https://soundcloud.com/oauth2/token"
              },
              base: "https://api.soundcloud.com/",
              get: {
                me: "me.json",
                "me/friends": "me/followings.json",
                "me/followers": "me/followers.json",
                "me/following": "me/followings.json",
                "default": function(e, t) {
                  t(e.path + ".json");
                }
              },
              wrap: {
                me: function(e) {
                  return n(e), e;
                },
                "default": function(e) {
                  return Array.isArray(e) && (e = {data: e.map(n)}), o(e), e;
                }
              },
              xhr: t,
              jsonp: t
            }});
        }(n), function(e) {
          function t(e) {
            if (e.id) {
              if (e.name) {
                var t = e.name.split(" ");
                e.first_name = t.shift(), e.last_name = t.join(" ");
              }
              e.thumbnail = e.profile_image_url_https || e.profile_image_url;
            }
            return e;
          }
          function n(e) {
            return o(e), r(e), e.users && (e.data = e.users.map(t), delete e.users), e;
          }
          function o(e) {
            if (e.errors) {
              var t = e.errors[0];
              e.error = {
                code: "request_failed",
                message: t.message
              };
            }
          }
          function r(e) {
            "next_cursor_str" in e && (e.paging = {next: "?cursor=" + e.next_cursor_str});
          }
          function i(e) {
            return Array.isArray(e) ? {data: e} : e;
          }
          var s = "https://api.twitter.com/";
          e.init({twitter: {
              oauth: {
                version: "1.0a",
                auth: s + "oauth/authenticate",
                request: s + "oauth/request_token",
                token: s + "oauth/access_token"
              },
              login: function(e) {
                var t = "?force_login=true";
                this.oauth.auth = this.oauth.auth.replace(t, "") + (e.options.force ? t : "");
              },
              base: s + "1.1/",
              get: {
                me: "account/verify_credentials.json",
                "me/friends": "friends/list.json?count=@{limit|200}",
                "me/following": "friends/list.json?count=@{limit|200}",
                "me/followers": "followers/list.json?count=@{limit|200}",
                "me/share": "statuses/user_timeline.json?count=@{limit|200}",
                "me/like": "favorites/list.json?count=@{limit|200}"
              },
              post: {
                "me/share": function(t, n) {
                  var o = t.data;
                  t.data = null;
                  var r = [];
                  o.message && (r.push(o.message), delete o.message), o.link && (r.push(o.link), delete o.link), o.picture && (r.push(o.picture), delete o.picture), r.length && (o.status = r.join(" ")), o.file ? (o["media[]"] = o.file, delete o.file, t.data = o, n("statuses/update_with_media.json")) : "id" in o ? n("statuses/retweet/" + o.id + ".json") : (e.utils.extend(t.query, o), n("statuses/update.json?include_entities=1"));
                },
                "me/like": function(e, t) {
                  var n = e.data.id;
                  e.data = null, t("favorites/create.json?id=" + n);
                }
              },
              del: {"me/like": function() {
                  p.method = "post";
                  var e = p.data.id;
                  p.data = null, callback("favorites/destroy.json?id=" + e);
                }},
              wrap: {
                me: function(e) {
                  return o(e), t(e), e;
                },
                "me/friends": n,
                "me/followers": n,
                "me/following": n,
                "me/share": function(e) {
                  return o(e), r(e), !e.error && "length" in e ? {data: e} : e;
                },
                "default": function(e) {
                  return e = i(e), r(e), e;
                }
              },
              xhr: function(e) {
                return "get" !== e.method;
              }
            }});
        }(n), function(e) {
          function t(e, t) {
            return null !== e && "response" in e && null !== e.response && e.response.length && (e = e.response[0], e.id = e.uid, e.thumbnail = e.picture = e.photo_max, e.name = e.first_name + " " + e.last_name, t.authResponse && null !== t.authResponse.email && (e.email = t.authResponse.email)), e;
          }
          function n(e) {
            if (e.error) {
              var t = e.error;
              e.error = {
                code: t.error_code,
                message: t.error_msg
              };
            }
          }
          e.init({vk: {
              name: "Vk",
              oauth: {
                version: 2,
                auth: "https://oauth.vk.com/authorize",
                grant: "https://oauth.vk.com/access_token"
              },
              scope: {
                basic: "",
                email: "email",
                offline_access: "offline"
              },
              refresh: !0,
              login: function(e) {
                e.qs.display = window.navigator && window.navigator.userAgent && /ipad|phone|phone|android/.test(window.navigator.userAgent.toLowerCase()) ? "mobile" : "popup";
              },
              base: "https://api.vk.com/method/",
              get: {me: function(e, t) {
                  e.query.fields = "id,first_name,last_name,photo_max", t("users.get");
                }},
              wrap: {me: function(e, o, r) {
                  return n(e), t(e, r);
                }},
              xhr: !1,
              jsonp: !0,
              form: !1
            }});
        }(n), function(e) {
          function t(e) {
            return "data" in e && e.data.forEach(function(e) {
              e.picture && (e.thumbnail = e.picture), e.images && (e.pictures = e.images.map(n).sort(function(e, t) {
                return e.width - t.width;
              }));
            }), e;
          }
          function n(e) {
            return {
              width: e.width,
              height: e.height,
              source: e.source
            };
          }
          function o(e) {
            return "data" in e && e.data.forEach(function(e) {
              e.photos = e.files = "https://apis.live.net/v5.0/" + e.id + "/photos";
            }), e;
          }
          function r(e, t, n) {
            if (e.id) {
              var o = n.query.access_token;
              if (e.emails && (e.email = e.emails.preferred), e.is_friend !== !1) {
                var r = e.user_id || e.id;
                e.thumbnail = e.picture = "https://apis.live.net/v5.0/" + r + "/picture?access_token=" + o;
              }
            }
            return e;
          }
          function i(e, t, n) {
            return "data" in e && e.data.forEach(function(e) {
              r(e, t, n);
            }), e;
          }
          e.init({windows: {
              name: "Windows live",
              oauth: {
                version: 2,
                auth: "https://login.live.com/oauth20_authorize.srf",
                grant: "https://login.live.com/oauth20_token.srf"
              },
              refresh: !0,
              logout: function() {
                return "http://login.live.com/oauth20_logout.srf?ts=" + (new Date).getTime();
              },
              scope: {
                basic: "wl.signin,wl.basic",
                email: "wl.emails",
                birthday: "wl.birthday",
                events: "wl.calendars",
                photos: "wl.photos",
                videos: "wl.photos",
                friends: "wl.contacts_emails",
                files: "wl.skydrive",
                publish: "wl.share",
                publish_files: "wl.skydrive_update",
                create_event: "wl.calendars_update,wl.events_create",
                offline_access: "wl.offline_access"
              },
              base: "https://apis.live.net/v5.0/",
              get: {
                me: "me",
                "me/friends": "me/friends",
                "me/following": "me/contacts",
                "me/followers": "me/friends",
                "me/contacts": "me/contacts",
                "me/albums": "me/albums",
                "me/album": "@{id}/files",
                "me/photo": "@{id}",
                "me/files": "@{parent|me/skydrive}/files",
                "me/folders": "@{id|me/skydrive}/files",
                "me/folder": "@{id|me/skydrive}/files"
              },
              post: {
                "me/albums": "me/albums",
                "me/album": "@{id}/files/",
                "me/folders": "@{id|me/skydrive/}",
                "me/files": "@{parent|me/skydrive}/files"
              },
              del: {
                "me/album": "@{id}",
                "me/photo": "@{id}",
                "me/folder": "@{id}",
                "me/files": "@{id}"
              },
              wrap: {
                me: r,
                "me/friends": i,
                "me/contacts": i,
                "me/followers": i,
                "me/following": i,
                "me/albums": o,
                "me/photos": t,
                "default": t
              },
              xhr: function(t) {
                return "get" === t.method || "delete" === t.method || e.utils.hasBinary(t.data) || ("string" == typeof t.data.file ? t.data.file = e.utils.toBlob(t.data.file) : (t.data = JSON.stringify(t.data), t.headers = {"Content-Type": "application/json"})), !0;
              },
              jsonp: function(t) {
                "get" === t.method || e.utils.hasBinary(t.data) || (t.data.method = t.method, t.method = "get");
              }
            }});
        }(n), function(e) {
          function t(e) {
            e && "meta" in e && "error_type" in e.meta && (e.error = {
              code: e.meta.error_type,
              message: e.meta.error_message
            });
          }
          function n(e) {
            if (t(e), e.query && e.query.results && e.query.results.profile) {
              e = e.query.results.profile, e.id = e.guid, e.last_name = e.familyName, e.first_name = e.givenName || e.nickname;
              var n = [];
              e.first_name && n.push(e.first_name), e.last_name && n.push(e.last_name), e.name = n.join(" "), e.email = e.emails && e.emails[0] ? e.emails[0].handle : null, e.thumbnail = e.image ? e.image.imageUrl : null;
            }
            return e;
          }
          function o(e, n, o) {
            t(e), i(e, n, o);
            return e.query && e.query.results && e.query.results.contact && (e.data = e.query.results.contact, delete e.query, Array.isArray(e.data) || (e.data = [e.data]), e.data.forEach(r)), e;
          }
          function r(e) {
            e.id = null, (e.fields || []).forEach(function(t) {
              "email" === t.type && (e.email = t.value), "name" === t.type && (e.first_name = t.value.givenName, e.last_name = t.value.familyName, e.name = t.value.givenName + " " + t.value.familyName), "yahooid" === t.type && (e.id = t.value);
            });
          }
          function i(e, t, n) {
            return e.query && e.query.count && n.options && (e.paging = {next: "?start=" + (e.query.count + (+n.options.start || 1))}), e;
          }
          function s(e) {
            return "https://query.yahooapis.com/v1/yql?q=" + (e + " limit @{limit|100} offset @{start|0}").replace(/\s/g, "%20") + "&format=json";
          }
          e.init({yahoo: {
              oauth: {
                version: "1.0a",
                auth: "https://api.login.yahoo.com/oauth/v2/request_auth",
                request: "https://api.login.yahoo.com/oauth/v2/get_request_token",
                token: "https://api.login.yahoo.com/oauth/v2/get_token"
              },
              login: function(e) {
                e.options.popup.width = 560;
                try {
                  delete e.qs.state.scope;
                } catch (t) {}
              },
              base: "https://social.yahooapis.com/v1/",
              get: {
                me: s("select * from social.profile(0) where guid=me"),
                "me/friends": s("select * from social.contacts(0) where guid=me"),
                "me/following": s("select * from social.contacts(0) where guid=me")
              },
              wrap: {
                me: n,
                "me/friends": o,
                "me/following": o,
                "default": i
              }
            }});
        }(n), "function" == typeof define && define.amd && define(function() {
          return n;
        }), "object" == typeof t && t.exports && (t.exports = n);
      }).call(this, e("_process"));
    }, {_process: 1}],
    3: [function(e, t, n) {
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
          a = function(e, t, n) {
            for (var o = !0; o; ) {
              var r = e,
                  i = t,
                  s = n;
              o = !1, null === r && (r = Function.prototype);
              var a = Object.getOwnPropertyDescriptor(r, i);
              if (void 0 !== a) {
                if ("value" in a)
                  return a.value;
                var u = a.get;
                if (void 0 === u)
                  return;
                return u.call(s);
              }
              var c = Object.getPrototypeOf(r);
              if (null === c)
                return;
              e = c, t = i, n = s, o = !0, a = c = void 0;
            }
          },
          u = e("./MiniBus"),
          c = o(u),
          l = function(e) {
            function t(e) {
              r(this, t), a(Object.getPrototypeOf(t.prototype), "constructor", this).call(this), this._registry = e;
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
    }, {"./MiniBus": 4}],
    4: [function(e, t, n) {
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
          s = e("./Pipeline"),
          a = o(s),
          u = function() {
            function e() {
              r(this, e);
              var t = this;
              t._msgId = 0, t._subscriptions = {}, t._responseTimeOut = 3e3, t._responseCallbacks = {}, t._pipeline = new a["default"](function(e) {
                console.log("PIPELINE-ERROR: ", JSON.stringify(e));
              }), t._registerExternalListener();
            }
            return i(e, [{
              key: "addListener",
              value: function(e, t) {
                var n = this,
                    o = new c(n._subscriptions, e, t),
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
                return e.id && 0 !== e.id || (n._msgId++, e.id = n._msgId), n._pipeline.process(e, function(e) {
                  if (t && !function() {
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
                }), e.id;
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
            }, {
              key: "pipeline",
              get: function() {
                return this._pipeline;
              }
            }]), e;
          }(),
          c = function() {
            function e(t, n, o) {
              r(this, e);
              var i = this;
              i._subscriptions = t, i._url = n, i._callback = o;
            }
            return i(e, [{
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
      n["default"] = u, t.exports = n["default"];
    }, {"./Pipeline": 5}],
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
            function e(t) {
              o(this, e);
              var n = this;
              n.handlers = [], n.onFail = t;
            }
            return r(e, [{
              key: "process",
              value: function(e, t) {
                var n = this;
                if (n.handlers.length > 0) {
                  var o = new a(n.handlers);
                  o.next(new s(n, o, e, t));
                } else
                  t(e);
              }
            }]), e;
          }(),
          s = function() {
            function e(t, n, r, i) {
              o(this, e);
              var s = this;
              s._inStop = !1, s._pipeline = t, s._iter = n, s._msg = r, s._onDeliver = i;
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
                var t = this;
                t._inStop || (t._inStop = !0, t._pipeline.onFail && t._pipeline.onFail(e));
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
          a = function() {
            function e(t) {
              o(this, e), this._index = -1, this._array = t;
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
          s = e("hellojs"),
          a = o(s),
          u = function() {
            function e() {
              r(this, e);
              var t = this;
              t.identities = [];
            }
            return i(e, [{
              key: "registerIdentity",
              value: function() {}
            }, {
              key: "registerWithRP",
              value: function() {}
            }, {
              key: "getIdentities",
              value: function() {
                var e = this;
                return e.identities;
              }
            }, {
              key: "loginWithRP",
              value: function(e, t) {
                var n = this,
                    o = "https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=",
                    r = "https://www.googleapis.com/oauth2/v1/userinfo?access_token=",
                    i = void 0;
                return new Promise(function(e, t) {
                  function s(e) {
                    var n = new XMLHttpRequest;
                    n.open("GET", o + e, !0), n.onreadystatechange = function(o) {
                      4 == n.readyState && (200 == n.status ? u(e) : t(400 == n.status ? "There was an error processing the token" : "something else other than 200 was returned"));
                    }, n.send();
                  }
                  function u(o) {
                    var s = new XMLHttpRequest;
                    s.open("GET", r + o, !0), s.onreadystatechange = function(o) {
                      if (4 == s.readyState)
                        if (200 == s.status) {
                          i = JSON.parse(s.responseText), n.token = i;
                          var r = i.email,
                              a = "user://" + r.substring(r.indexOf("@") + 1, r.length) + "/" + r.substring(0, r.indexOf("@")),
                              u = {
                                identity: a,
                                token: i
                              };
                          n.identities.push(u), e(i);
                        } else
                          t(400 == s.status ? "There was an error processing the token" : "something else other than 200 was returned");
                    }, s.send();
                  }
                  return void 0 !== n.token ? e(n.token) : (a["default"].init({google: "808329566012-tqr8qoh111942gd2kg007t0s8f277roi.apps.googleusercontent.com"}), void(0, a["default"])("google").login({scope: "email"}).then(function(e) {
                    s(e.authResponse.access_token);
                  }, function(e) {
                    console.log("errorValidating ", e), t(e);
                  }));
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
      n["default"] = u, t.exports = n["default"];
    }, {hellojs: 2}],
    7: [function(require, module, exports) {
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
                  "allow" == t.checkPolicies(e) ? t.idModule.loginWithRP("google identity", "scope").then(function(o) {
                    var r = t.idModule.getIdentities();
                    e.body.assertedIdentity = r[0].identity, e.body.idToken = JSON.stringify(o), e.body.authorised = !0, n(e);
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
    9: [function(e, t, n) {
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
          a = function(e, t, n) {
            for (var o = !0; o; ) {
              var r = e,
                  i = t,
                  s = n;
              o = !1, null === r && (r = Function.prototype);
              var a = Object.getOwnPropertyDescriptor(r, i);
              if (void 0 !== a) {
                if ("value" in a)
                  return a.value;
                var u = a.get;
                if (void 0 === u)
                  return;
                return u.call(s);
              }
              var c = Object.getPrototypeOf(r);
              if (null === c)
                return;
              e = c, t = i, n = s, o = !0, a = c = void 0;
            }
          },
          u = e("./RegistryDataModel"),
          c = o(u),
          l = function(e) {
            function t(e, n, o, i, s, u, c, l) {
              r(this, t), a(Object.getPrototypeOf(t.prototype), "constructor", this).call(this, e, n, o);
              var f = this;
              f._hypertyURL = i, f._user = s, f._guid = u, f._runtime = c, f._context = l;
            }
            return i(t, e), s(t, [{
              key: "user",
              set: function(e) {
                var t = this;
                t.user = e;
              },
              get: function() {
                var e = this;
                return e._user;
              }
            }, {
              key: "hypertyURL",
              get: function() {
                var e = this;
                return e._hypertyURL;
              }
            }]), t;
          }(c["default"]);
      n["default"] = l, t.exports = n["default"];
    }, {"./RegistryDataModel": 11}],
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
          a = function(e, t, n) {
            for (var o = !0; o; ) {
              var r = e,
                  i = t,
                  s = n;
              o = !1, null === r && (r = Function.prototype);
              var a = Object.getOwnPropertyDescriptor(r, i);
              if (void 0 !== a) {
                if ("value" in a)
                  return a.value;
                var u = a.get;
                if (void 0 === u)
                  return;
                return u.call(s);
              }
              var c = Object.getPrototypeOf(r);
              if (null === c)
                return;
              e = c, t = i, n = s, o = !0, a = c = void 0;
            }
          },
          u = e("../utils/EventEmitter"),
          c = o(u),
          l = e("./AddressAllocation"),
          f = o(l),
          d = e("./HypertyInstance"),
          p = o(d),
          m = e("../utils/utils.js"),
          h = function(e) {
            function t(e, n, o, i) {
              if (r(this, t), a(Object.getPrototypeOf(t.prototype), "constructor", this).call(this), !e)
                throw new Error("runtimeURL is missing.");
              var s = this;
              s.registryURL = e + "/registry/123", s.appSandbox = n, s.runtimeURL = e, s.remoteRegistry = i, s.idModule = o, s.identifier = Math.floor(1e4 * Math.random() + 1), s.hypertiesListToRemove = {}, s.hypertiesList = [], s.protostubsList = {}, s.sandboxesList = {}, s.pepList = {};
            }
            return i(t, e), s(t, [{
              key: "getAppSandbox",
              value: function() {
                var e = this;
                return e.appSandbox;
              }
            }, {
              key: "getUserHyperty",
              value: function(e) {
                var t = this,
                    n = "user://" + e.substring(e.indexOf("@") + 1, e.length) + "/" + e.substring(0, e.indexOf("@")),
                    o = {
                      id: 98,
                      type: "READ",
                      from: t.registryURL,
                      to: "domain://registry.ua.pt/",
                      body: {user: n}
                    };
                return new Promise(function(n, r) {
                  t._messageBus.postMessage(o, function(t) {
                    var o = t.body.last;
                    if (void 0 === o)
                      return r("User Hyperty not found");
                    var i = "hyperty:/" + o.substring(o.indexOf(":") + 1, o.length),
                        s = {
                          id: e,
                          descriptor: t.body.hyperties[o].descriptor,
                          hypertyURL: i
                        };
                    console.log("===> RegisterHyperty messageBundle: ", s), n(s);
                  });
                });
              }
            }, {
              key: "registerHyperty",
              value: function(e, t) {
                var n = this,
                    o = (0, m.divideURL)(t).domain,
                    r = n.idModule.getIdentities(),
                    i = new Promise(function(e, i) {
                      return void 0 !== n._messageBus ? n.resolve("hyperty-runtime://" + o).then(function() {
                        var i = 1;
                        n.addressAllocation.create(o, i).then(function(o) {
                          o.forEach(function(e) {
                            n._messageBus.addListener(e + "/status", function(t) {
                              console.log("Message addListener for : ", e + "/status -> " + t);
                            });
                          });
                          var i = new p["default"](n.identifier, n.registryURL, t, o[0], r[0].identity);
                          n.hypertiesList.push(i);
                          var s = {
                            id: 99,
                            type: "CREATE",
                            from: n.registryURL,
                            to: "domain://registry.ua.pt/",
                            body: {
                              user: r[0].identity,
                              hypertyDescriptorURL: t,
                              hypertyURL: o[0]
                            }
                          };
                          n._messageBus.postMessage(s, function(e) {
                            console.log("===> RegisterHyperty Reply: ", e);
                          }), e(o[0]);
                        });
                      })["catch"](function(e) {
                        console.log("Address Reason: ", e), i(e);
                      }) : void i("MessageBus not found on registerStub");
                    });
                return i;
              }
            }, {
              key: "unregisterHyperty",
              value: function(e) {
                var t = this,
                    n = new Promise(function(n, o) {
                      var r = !1,
                          i = 0;
                      for (i = 0; i < t.hypertiesList.length; i++) {
                        var s = t.hypertiesList[i];
                        if (void 0 !== s && s.hypertyURL === e) {
                          r = !0;
                          break;
                        }
                      }
                      r === !1 ? o("Hyperty not found") : (delete t.hypertiesList[i], n("Hyperty successfully deleted"));
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
                      void 0 === o._messageBus && i("MessageBus not found on registerStub"), t.indexOf("msg-node.") || (t = t.substring(t.indexOf(".") + 1)), n = "msg-node." + t + "/protostub/" + Math.floor(1e4 * Math.random() + 1), o.protostubsList[t] = n, o.sandboxesList[t] = e, e.addListener("*", function(e) {
                        o._messageBus.postMessage(e);
                      }), r(n), o._messageBus.addListener(n + "/status", function(e) {
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
                    n = (0, m.divideURL)(e).domain,
                    o = new Promise(function(e, o) {
                      n.indexOf("msg-node.") && n.indexOf("registry.") || (n = n.substring(n.indexOf(".") + 1));
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
      n["default"] = h, t.exports = n["default"];
    }, {
      "../utils/EventEmitter": 17,
      "../utils/utils.js": 18,
      "./AddressAllocation": 8,
      "./HypertyInstance": 9
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
            function e(t, n, r, i, s, a, u, c) {
              o(this, e);
              var l = this;
              l._id = t, l._url = n, l._descriptor = r, l._startingTime = i, l._lastModified = s, l._status = a, l._stubs = u, l._stubsConfiguration = c;
            }
            return r(e, [{
              key: "id",
              get: function() {
                var e = this;
                return e._id;
              }
            }, {
              key: "url",
              get: function() {
                var e = this;
                return e._url;
              }
            }, {
              key: "descriptor",
              get: function() {
                var e = this;
                return e._descriptor;
              }
            }]), e;
          }();
      n["default"] = i, t.exports = n["default"];
    }, {}],
    12: [function(e, t, n) {
      "use strict";
      function o(e) {
        return e && e.__esModule ? e : {"default": e};
      }
      Object.defineProperty(n, "__esModule", {value: !0});
      var r = e("./runtime/RuntimeUA"),
          i = o(r);
      n["default"] = {RuntimeUA: i["default"]}, t.exports = n["default"];
    }, {"./runtime/RuntimeUA": 14}],
    13: [function(e, t, n) {
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
              t._makeExternalRequest("../resources/descriptors/Hyperties.json").then(function(e) {
                t.Hyperties = JSON.parse(e);
              }), t._makeExternalRequest("../resources/descriptors/ProtoStubs.json").then(function(e) {
                t.ProtoStubs = JSON.parse(e);
              });
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
                      i = t.Hyperties[r];
                  n(i);
                });
              }
            }, {
              key: "getHypertySourcePackage",
              value: function(e) {
                var t = this;
                return new Promise(function(n, o) {
                  t._makeExternalRequest(e).then(function(e) {
                    try {
                      var t = JSON.parse(e),
                          r = window.atob(t.sourceCode);
                      t.sourceCode = r, n(t);
                    } catch (i) {
                      o(i);
                    }
                  })["catch"](function(e) {
                    o(e);
                  });
                });
              }
            }, {
              key: "getStubDescriptor",
              value: function(e) {
                var t = this;
                return new Promise(function(n, o) {
                  var r = t.ProtoStubs[e];
                  n(r);
                });
              }
            }, {
              key: "getStubSourcePackage",
              value: function(e) {
                var t = this;
                return new Promise(function(n, o) {
                  t._makeExternalRequest(e).then(function(e) {
                    try {
                      var t = JSON.parse(e),
                          r = window.atob(t.sourceCode);
                      t.sourceCode = r, n(t);
                    } catch (i) {
                      o(i);
                    }
                  })["catch"](function(e) {
                    console.error(e), o(e);
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
    14: [function(e, t, n) {
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
          a = o(s),
          u = e("../identity/IdentityModule"),
          c = o(u),
          l = e("../policy/PolicyEngine"),
          f = o(l),
          d = e("../bus/MessageBus"),
          p = o(d),
          m = e("./RuntimeCatalogue"),
          h = o(m),
          g = e("../syncher/SyncherManager"),
          y = o(g),
          v = function() {
            function e(t) {
              if (r(this, e), !t)
                throw new Error("The sandbox factory is a needed parameter");
              var n = this;
              n.sandboxFactory = t, n.runtimeCatalogue = new h["default"];
              var o = "runtime://ua.pt/" + Math.floor(1e4 * Math.random() + 1);
              n.runtimeURL = o, n.runtimeCatalogue.runtimeURL = o;
              var i = t.createAppSandbox();
              n.identityModule = new c["default"], n.registry = new a["default"](o, i, n.identityModule), n.policyEngine = new f["default"](n.identityModule, n.registry), n.messageBus = new p["default"](n.registry), n.messageBus.pipeline.handlers = [function(e) {
                n.policyEngine.authorise(e.msg).then(function(t) {
                  e.msg = t, e.next();
                })["catch"](function(t) {
                  console.error(t), e.fail(t);
                });
              }], n.registry.messageBus = n.messageBus, n.registry.addEventListener("runtime:loadStub", function(e) {
                n.loadStub(e).then(function(t) {
                  n.registry.trigger("runtime:stubLoaded", e);
                })["catch"](function(e) {
                  console.error(e);
                });
              }), t.messageBus = n.messageBus, n.syncherManager = new y["default"](n.runtimeURL, n.messageBus, {});
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
                      a = void 0,
                      u = function(e) {
                        console.error(e), o(e);
                      };
                  console.info("------------------ Hyperty ------------------------"), console.info("Get hyperty descriptor for :", e), t.runtimeCatalogue.getHypertyDescriptor(e).then(function(e) {
                    console.info("1: return hyperty descriptor", e), s = e;
                    var n = e.sourcePackageURL;
                    return t.runtimeCatalogue.getHypertySourcePackage(n);
                  }).then(function(e) {
                    console.info("2: return hyperty source code"), a = e;
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
                    return console.error("4.1: try to register a new sandbox", e), t.sandboxFactory.createSandbox();
                  }).then(function(n) {
                    return console.info("5: return sandbox and register"), i = n, t.registry.registerHyperty(n, e);
                  }).then(function(e) {
                    console.info("6: Hyperty url, after register hyperty", e), r = e;
                    var n = Object.assign({}, s.configuration);
                    return n.runtimeURL = t.runtimeURL, i.deployComponent(a.sourceCode, r, n);
                  }).then(function(e) {
                    console.info("7: Deploy component status for hyperty: ", e), t.messageBus.addListener(r, function(e) {
                      i.postMessage(e);
                    });
                    var o = {
                      runtimeHypertyURL: r,
                      status: e
                    };
                    n(o), console.log("------------------ END ------------------------");
                  })["catch"](u);
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
                      a = void 0,
                      u = function(e) {
                        console.error(e), o(e);
                      };
                  console.info("------------------- ProtoStub ---------------------------\n"), console.info("Discover or Create a new ProtoStub for domain: ", e), t.registry.discoverProtostub(e).then(function(e) {
                    return console.info("1. Proto Stub Discovered: ", e), i = e;
                  }, function(n) {
                    return console.info("1. Proto Stub not found:", n), t.runtimeCatalogue.getStubDescriptor(e);
                  }).then(function(e) {
                    console.info("2. return the ProtoStub descriptor:", e), i = e;
                    var n = e.sourcePackageURL;
                    return console.log(e.sourcePackageURL), t.runtimeCatalogue.getStubSourcePackage(n);
                  }).then(function(e) {
                    console.info("3. return the ProtoStub Source Code: ", e), a = e;
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
                    console.info("7. return the runtime protostub url: ", e), s = e;
                    var n = Object.assign({}, i.configuration);
                    return n.runtimeURL = t.runtimeURL, console.log(a), r.deployComponent(a.sourceCode, e, n);
                  }).then(function(e) {
                    console.info("8: return deploy component for sandbox status: ", e), t.messageBus.addListener(s, function(e) {
                      r.postMessage(e);
                    });
                    var o = {
                      runtimeProtoStubURL: s,
                      status: e
                    };
                    n(o), console.info("------------------- END ---------------------------\n");
                  })["catch"](u);
                });
              }
            }, {
              key: "checkForUpdate",
              value: function(e) {}
            }]), e;
          }();
      n["default"] = v, t.exports = n["default"];
    }, {
      "../bus/MessageBus": 3,
      "../identity/IdentityModule": 6,
      "../policy/PolicyEngine": 7,
      "../registry/Registry": 10,
      "../syncher/SyncherManager": 16,
      "./RuntimeCatalogue": 13
    }],
    15: [function(e, t, n) {
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
    16: [function(e, t, n) {
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
          a = e("./ObjectAllocation"),
          u = o(a),
          c = function() {
            function e(t, n, o, i) {
              r(this, e);
              var s = this;
              s._domain = "ua.pt", s._bus = n, s._registry = o, s._url = t + "/sm", s._objectURL = t + "/object-allocation", s._subscriptions = {}, i ? s._allocator = i : s._allocator = new u["default"](s._objectURL, n), n.addListener(s._url, function(e) {
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
                      a = t._bus.addListener(r, function(e) {
                        console.log(r + "-RCV: ", e), t._subscriptions[r].subs.forEach(function(n) {
                          var o = (0, s.deepClone)(e);
                          o.id = 0, o.from = r, o.to = n, t._bus.postMessage(o);
                        });
                      }),
                      u = t._bus.addListener(i, function(e) {
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
                    sl: u,
                    cl: a,
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
                  var a = {
                    type: "forward",
                    from: n._url,
                    to: r.owner,
                    body: {
                      type: t.type,
                      from: t.from,
                      to: e
                    }
                  };
                  t.body && (a.body.body = t.body), n._bus.postMessage(a, function(r) {
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
      "../utils/utils": 18,
      "./ObjectAllocation": 15
    }],
    17: [function(e, t, n) {
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
    18: [function(e, t, n) {
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
  }, {}, [12])(12);
});

_removeDefine();
})();
$__System.registerDynamic("3", [], true, function(req, exports, module) {
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

$__System.registerDynamic("4", [], true, function(req, exports, module) {
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

$__System.registerDynamic("5", ["4"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var cof = req('4');
  module.exports = Object('z').propertyIsEnumerable(0) ? Object : function(it) {
    return cof(it) == 'String' ? it.split('') : Object(it);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("6", [], true, function(req, exports, module) {
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

$__System.registerDynamic("7", ["5", "6"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var IObject = req('5'),
      defined = req('6');
  module.exports = function(it) {
    return IObject(defined(it));
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("8", [], true, function(req, exports, module) {
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

$__System.registerDynamic("9", [], true, function(req, exports, module) {
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

$__System.registerDynamic("a", [], true, function(req, exports, module) {
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

$__System.registerDynamic("b", ["a"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var aFunction = req('a');
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

$__System.registerDynamic("c", ["8", "9", "b"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var global = req('8'),
      core = req('9'),
      ctx = req('b'),
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

$__System.registerDynamic("d", [], true, function(req, exports, module) {
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

$__System.registerDynamic("e", ["c", "9", "d"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $export = req('c'),
      core = req('9'),
      fails = req('d');
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

$__System.registerDynamic("f", ["7", "e"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var toIObject = req('7');
  req('e')('getOwnPropertyDescriptor', function($getOwnPropertyDescriptor) {
    return function getOwnPropertyDescriptor(it, key) {
      return $getOwnPropertyDescriptor(toIObject(it), key);
    };
  });
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("10", ["3", "f"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = req('3');
  req('f');
  module.exports = function getOwnPropertyDescriptor(it, key) {
    return $.getDesc(it, key);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("11", ["10"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": req('10'),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("12", ["11"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  "use strict";
  var _Object$getOwnPropertyDescriptor = req('11')["default"];
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

$__System.registerDynamic("13", ["3"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = req('3');
  module.exports = function create(P, D) {
    return $.create(P, D);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("14", ["13"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": req('13'),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("15", [], true, function(req, exports, module) {
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

$__System.registerDynamic("16", ["15"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var isObject = req('15');
  module.exports = function(it) {
    if (!isObject(it))
      throw TypeError(it + ' is not an object!');
    return it;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("17", ["3", "15", "16", "b"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var getDesc = req('3').getDesc,
      isObject = req('15'),
      anObject = req('16');
  var check = function(O, proto) {
    anObject(O);
    if (!isObject(proto) && proto !== null)
      throw TypeError(proto + ": can't set as prototype!");
  };
  module.exports = {
    set: Object.setPrototypeOf || ('__proto__' in {} ? function(test, buggy, set) {
      try {
        set = req('b')(Function.call, getDesc(Object.prototype, '__proto__').set, 2);
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

$__System.registerDynamic("18", ["c", "17"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $export = req('c');
  $export($export.S, 'Object', {setPrototypeOf: req('17').set});
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("19", ["18", "9"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  req('18');
  module.exports = req('9').Object.setPrototypeOf;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("1a", ["19"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": req('19'),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("1b", ["14", "1a"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  "use strict";
  var _Object$create = req('14')["default"];
  var _Object$setPrototypeOf = req('1a')["default"];
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

$__System.registerDynamic("1c", ["3"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = req('3');
  module.exports = function defineProperty(it, key, desc) {
    return $.setDesc(it, key, desc);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("1d", ["1c"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": req('1c'),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("1e", ["1d"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  "use strict";
  var _Object$defineProperty = req('1d')["default"];
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

$__System.registerDynamic("1f", [], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  "use strict";
  exports["default"] = function(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
      throw new TypeError("Cannot call a class as a function");
    }
  };
  exports.__esModule = true;
  global.define = __define;
  return module.exports;
});

(function() {
var _removeDefine = $__System.get("@@amd-helpers").createDefine();
!function(e) {
  if ("object" == typeof exports && "undefined" != typeof module)
    module.exports = e();
  else if ("function" == typeof define && define.amd)
    define("20", [], e);
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
$__System.register('21', ['12', '20', '1b', '1e', '1f'], function (_export) {
    var _get, Sandbox, _inherits, _createClass, _classCallCheck, SandboxWorker;

    return {
        setters: [function (_) {
            _get = _['default'];
        }, function (_2) {
            Sandbox = _2.Sandbox;
        }, function (_b) {
            _inherits = _b['default'];
        }, function (_e) {
            _createClass = _e['default'];
        }, function (_f) {
            _classCallCheck = _f['default'];
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
$__System.register('22', ['12', '20', '1b', '1e', '1f'], function (_export) {
   var _get, Sandbox, _inherits, _createClass, _classCallCheck, SandboxIframe;

   return {
      setters: [function (_) {
         _get = _['default'];
      }, function (_2) {
         Sandbox = _2.Sandbox;
      }, function (_b) {
         _inherits = _b['default'];
      }, function (_e) {
         _createClass = _e['default'];
      }, function (_f) {
         _classCallCheck = _f['default'];
      }],
      execute: function () {
         'use strict';

         SandboxIframe = (function (_Sandbox) {
            _inherits(SandboxIframe, _Sandbox);

            function SandboxIframe(scriptUrl) {
               _classCallCheck(this, SandboxIframe);

               _get(Object.getPrototypeOf(SandboxIframe.prototype), 'constructor', this).call(this, scriptUrl);

               this.sandbox = document.getElementById('sandbox');

               if (!!!this.sandbox) {
                  this.sandbox = document.createElement('iframe');
                  this.sandbox.setAttribute('id', 'sandbox');
                  this.sandbox.setAttribute('seamless', '');
                  this.sandbox.setAttribute('url', 'http://127.0.0.1:8080/example/');
                  this.sandbox.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
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
$__System.registerDynamic("23", [], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  "format cjs";
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("24", [], true, function(req, exports, module) {
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

$__System.registerDynamic("25", ["24", "6"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var toInteger = req('24'),
      defined = req('6');
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

$__System.registerDynamic("26", [], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = true;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("27", [], true, function(req, exports, module) {
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

$__System.registerDynamic("28", ["d"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = !req('d')(function() {
    return Object.defineProperty({}, 'a', {get: function() {
        return 7;
      }}).a != 7;
  });
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("29", ["3", "27", "28"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = req('3'),
      createDesc = req('27');
  module.exports = req('28') ? function(object, key, value) {
    return $.setDesc(object, key, createDesc(1, value));
  } : function(object, key, value) {
    object[key] = value;
    return object;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("2a", ["29"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = req('29');
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("2b", [], true, function(req, exports, module) {
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

$__System.registerDynamic("2c", [], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {};
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("2d", ["8"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var global = req('8'),
      SHARED = '__core-js_shared__',
      store = global[SHARED] || (global[SHARED] = {});
  module.exports = function(key) {
    return store[key] || (store[key] = {});
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("2e", [], true, function(req, exports, module) {
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

$__System.registerDynamic("2f", ["2d", "2e", "8"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var store = req('2d')('wks'),
      uid = req('2e'),
      Symbol = req('8').Symbol;
  module.exports = function(name) {
    return store[name] || (store[name] = Symbol && Symbol[name] || (Symbol || uid)('Symbol.' + name));
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("30", ["3", "2b", "2f"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var def = req('3').setDesc,
      has = req('2b'),
      TAG = req('2f')('toStringTag');
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

$__System.registerDynamic("31", ["3", "27", "30", "29", "2f"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var $ = req('3'),
      descriptor = req('27'),
      setToStringTag = req('30'),
      IteratorPrototype = {};
  req('29')(IteratorPrototype, req('2f')('iterator'), function() {
    return this;
  });
  module.exports = function(Constructor, NAME, next) {
    Constructor.prototype = $.create(IteratorPrototype, {next: descriptor(1, next)});
    setToStringTag(Constructor, NAME + ' Iterator');
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("32", ["26", "c", "2a", "29", "2b", "2c", "31", "30", "3", "2f"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var LIBRARY = req('26'),
      $export = req('c'),
      redefine = req('2a'),
      hide = req('29'),
      has = req('2b'),
      Iterators = req('2c'),
      $iterCreate = req('31'),
      setToStringTag = req('30'),
      getProto = req('3').getProto,
      ITERATOR = req('2f')('iterator'),
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

$__System.registerDynamic("33", ["25", "32"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var $at = req('25')(true);
  req('32')(String, 'String', function(iterated) {
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

$__System.registerDynamic("34", [], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = function() {};
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("35", [], true, function(req, exports, module) {
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

$__System.registerDynamic("36", ["34", "35", "2c", "7", "32"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var addToUnscopables = req('34'),
      step = req('35'),
      Iterators = req('2c'),
      toIObject = req('7');
  module.exports = req('32')(Array, 'Array', function(iterated, kind) {
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

$__System.registerDynamic("37", ["36", "2c"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  req('36');
  var Iterators = req('2c');
  Iterators.NodeList = Iterators.HTMLCollection = Iterators.Array;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("38", ["4", "2f"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var cof = req('4'),
      TAG = req('2f')('toStringTag'),
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

$__System.registerDynamic("39", [], true, function(req, exports, module) {
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

$__System.registerDynamic("3a", ["16"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var anObject = req('16');
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

$__System.registerDynamic("3b", ["2c", "2f"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var Iterators = req('2c'),
      ITERATOR = req('2f')('iterator'),
      ArrayProto = Array.prototype;
  module.exports = function(it) {
    return it !== undefined && (Iterators.Array === it || ArrayProto[ITERATOR] === it);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("3c", ["24"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var toInteger = req('24'),
      min = Math.min;
  module.exports = function(it) {
    return it > 0 ? min(toInteger(it), 0x1fffffffffffff) : 0;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("3d", ["38", "2f", "2c", "9"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var classof = req('38'),
      ITERATOR = req('2f')('iterator'),
      Iterators = req('2c');
  module.exports = req('9').getIteratorMethod = function(it) {
    if (it != undefined)
      return it[ITERATOR] || it['@@iterator'] || Iterators[classof(it)];
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("3e", ["b", "3a", "3b", "16", "3c", "3d"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var ctx = req('b'),
      call = req('3a'),
      isArrayIter = req('3b'),
      anObject = req('16'),
      toLength = req('3c'),
      getIterFn = req('3d');
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

$__System.registerDynamic("3f", [], true, function(req, exports, module) {
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

$__System.registerDynamic("40", ["16", "a", "2f"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var anObject = req('16'),
      aFunction = req('a'),
      SPECIES = req('2f')('species');
  module.exports = function(O, D) {
    var C = anObject(O).constructor,
        S;
    return C === undefined || (S = anObject(C)[SPECIES]) == undefined ? D : aFunction(S);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("41", [], true, function(req, exports, module) {
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

$__System.registerDynamic("42", ["8"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = req('8').document && document.documentElement;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("43", ["15", "8"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var isObject = req('15'),
      document = req('8').document,
      is = isObject(document) && isObject(document.createElement);
  module.exports = function(it) {
    return is ? document.createElement(it) : {};
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("44", [], true, function(req, exports, module) {
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

$__System.registerDynamic("45", ["44"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = req('44');
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("46", ["45"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = $__System._nodeRequire ? process : req('45');
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("47", ["46"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = req('46');
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("48", ["b", "41", "42", "43", "8", "4", "47"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  (function(process) {
    var ctx = req('b'),
        invoke = req('41'),
        html = req('42'),
        cel = req('43'),
        global = req('8'),
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
      if (req('4')(process) == 'process') {
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
  })(req('47'));
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("49", ["8", "48", "4", "47"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  (function(process) {
    var global = req('8'),
        macrotask = req('48').set,
        Observer = global.MutationObserver || global.WebKitMutationObserver,
        process = global.process,
        Promise = global.Promise,
        isNode = req('4')(process) == 'process',
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
  })(req('47'));
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("4a", ["2a"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var redefine = req('2a');
  module.exports = function(target, src) {
    for (var key in src)
      redefine(target, key, src[key]);
    return target;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("4b", ["9", "3", "28", "2f"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  'use strict';
  var core = req('9'),
      $ = req('3'),
      DESCRIPTORS = req('28'),
      SPECIES = req('2f')('species');
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

$__System.registerDynamic("4c", ["2f"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var ITERATOR = req('2f')('iterator'),
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

$__System.registerDynamic("4d", ["3", "26", "8", "b", "38", "c", "15", "16", "a", "39", "3e", "17", "3f", "2f", "40", "49", "28", "4a", "30", "4b", "9", "4c", "47"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  (function(process) {
    'use strict';
    var $ = req('3'),
        LIBRARY = req('26'),
        global = req('8'),
        ctx = req('b'),
        classof = req('38'),
        $export = req('c'),
        isObject = req('15'),
        anObject = req('16'),
        aFunction = req('a'),
        strictNew = req('39'),
        forOf = req('3e'),
        setProto = req('17').set,
        same = req('3f'),
        SPECIES = req('2f')('species'),
        speciesConstructor = req('40'),
        asap = req('49'),
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
        if (works && req('28')) {
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
      req('4a')(P.prototype, {
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
    req('30')(P, PROMISE);
    req('4b')(PROMISE);
    Wrapper = req('9')[PROMISE];
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
    $export($export.S + $export.F * !(USE_NATIVE && req('4c')(function(iter) {
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
  })(req('47'));
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("4e", ["23", "33", "37", "4d", "9"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  req('23');
  req('33');
  req('37');
  req('4d');
  module.exports = req('9').Promise;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("4f", ["4e"], true, function(req, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": req('4e'),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

$__System.register('50', ['4f'], function (_export) {
    var _Promise, postMessage, addListener, deployComponent;

    return {
        setters: [function (_f) {
            _Promise = _f['default'];
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
$__System.register('51', ['21', '22', '50'], function (_export) {

    //TODO: resources url dependency
    'use strict';

    var SandboxWorker, SandboxIframe, SandboxAppStub;
    function createSandbox() {
        return new SandboxWorker('../dist/context-service.js');
    }

    function createAppSandbox() {
        return SandboxAppStub;
    }

    return {
        setters: [function (_) {
            SandboxWorker = _['default'];
        }, function (_2) {
            SandboxIframe = _2['default'];
        }, function (_3) {
            SandboxAppStub = _3['default'];
        }],
        execute: function () {
            _export('default', { createSandbox: createSandbox, createAppSandbox: createAppSandbox });
        }
    };
});
$__System.register('1', ['2', '51'], function (_export) {
    'use strict';

    var RuntimeUA, SandboxFactory, runtime;
    return {
        setters: [function (_) {
            RuntimeUA = _.RuntimeUA;
        }, function (_2) {
            SandboxFactory = _2['default'];
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