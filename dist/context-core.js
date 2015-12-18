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
$__System.registerDynamic("2", ["3"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var SYMBOL_ITERATOR = $__require('3')('iterator'),
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

$__System.registerDynamic("4", ["5"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $redef = $__require('5');
  module.exports = function(target, src) {
    for (var key in src)
      $redef(target, key, src[key]);
    return target;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("6", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("7", ["6"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = $__require('6');
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("8", ["7"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = $__System._nodeRequire ? process : $__require('7');
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("9", ["8"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = $__require('8');
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("a", ["b", "c"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var isObject = $__require('b'),
      document = $__require('c').document,
      is = isObject(document) && isObject(document.createElement);
  module.exports = function(it) {
    return is ? document.createElement(it) : {};
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("d", ["c"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = $__require('c').document && document.documentElement;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("e", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("f", ["10", "e", "d", "a", "c", "11", "9"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  (function(process) {
    'use strict';
    var ctx = $__require('10'),
        invoke = $__require('e'),
        html = $__require('d'),
        cel = $__require('a'),
        global = $__require('c'),
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
      if ($__require('11')(process) == 'process') {
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
  })($__require('9'));
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("12", ["c", "f", "11", "9"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  (function(process) {
    var global = $__require('c'),
        macrotask = $__require('f').set,
        Observer = global.MutationObserver || global.WebKitMutationObserver,
        process = global.process,
        isNode = $__require('11')(process) == 'process',
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
  })($__require('9'));
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("13", ["14", "15", "3"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var anObject = $__require('14'),
      aFunction = $__require('15'),
      SPECIES = $__require('3')('species');
  module.exports = function(O, D) {
    var C = anObject(O).constructor,
        S;
    return C === undefined || (S = anObject(C)[SPECIES]) == undefined ? D : aFunction(S);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("16", ["17", "3", "18"], true, function($__require, exports, module) {
  "use strict";
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = $__require('17'),
      SPECIES = $__require('3')('species');
  module.exports = function(C) {
    if ($__require('18') && !(SPECIES in C))
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

$__System.registerDynamic("19", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("1a", ["1b", "3", "1c", "1d"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var classof = $__require('1b'),
      ITERATOR = $__require('3')('iterator'),
      Iterators = $__require('1c');
  module.exports = $__require('1d').getIteratorMethod = function(it) {
    if (it != undefined)
      return it[ITERATOR] || it['@@iterator'] || Iterators[classof(it)];
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("1e", ["1f"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var toInteger = $__require('1f'),
      min = Math.min;
  module.exports = function(it) {
    return it > 0 ? min(toInteger(it), 0x1fffffffffffff) : 0;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("20", ["1c", "3"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var Iterators = $__require('1c'),
      ITERATOR = $__require('3')('iterator');
  module.exports = function(it) {
    return (Iterators.Array || Array.prototype[ITERATOR]) === it;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("21", ["14"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var anObject = $__require('14');
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

$__System.registerDynamic("22", ["10", "21", "20", "14", "1e", "1a"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var ctx = $__require('10'),
      call = $__require('21'),
      isArrayIter = $__require('20'),
      anObject = $__require('14'),
      toLength = $__require('1e'),
      getIterFn = $__require('1a');
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

$__System.registerDynamic("23", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("1b", ["11", "3"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var cof = $__require('11'),
      TAG = $__require('3')('toStringTag'),
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

$__System.registerDynamic("24", ["17", "25", "c", "10", "1b", "26", "b", "14", "15", "23", "22", "27", "19", "16", "3", "13", "28", "12", "18", "4", "29", "1d", "2", "9"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  (function(process) {
    'use strict';
    var $ = $__require('17'),
        LIBRARY = $__require('25'),
        global = $__require('c'),
        ctx = $__require('10'),
        classof = $__require('1b'),
        $def = $__require('26'),
        isObject = $__require('b'),
        anObject = $__require('14'),
        aFunction = $__require('15'),
        strictNew = $__require('23'),
        forOf = $__require('22'),
        setProto = $__require('27').set,
        same = $__require('19'),
        species = $__require('16'),
        SPECIES = $__require('3')('species'),
        speciesConstructor = $__require('13'),
        RECORD = $__require('28')('record'),
        asap = $__require('12'),
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
        if (works && $__require('18')) {
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
      $__require('4')(P.prototype, {
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
    $__require('29')(P, PROMISE);
    species(P);
    species(Wrapper = $__require('1d')[PROMISE]);
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
    $def($def.S + $def.F * !(useNative && $__require('2')(function(iter) {
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
  })($__require('9'));
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("2a", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("2b", [], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = function() {};
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("2c", ["2b", "2a", "1c", "2d", "2e"], true, function($__require, exports, module) {
  "use strict";
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var setUnscope = $__require('2b'),
      step = $__require('2a'),
      Iterators = $__require('1c'),
      toIObject = $__require('2d');
  $__require('2e')(Array, 'Array', function(iterated, kind) {
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

$__System.registerDynamic("2f", ["2c", "1c"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  $__require('2c');
  var Iterators = $__require('1c');
  Iterators.NodeList = Iterators.HTMLCollection = Iterators.Array;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("29", ["17", "30", "3"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var def = $__require('17').setDesc,
      has = $__require('30'),
      TAG = $__require('3')('toStringTag');
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

$__System.registerDynamic("31", ["17", "32", "3", "33", "29"], true, function($__require, exports, module) {
  "use strict";
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = $__require('17'),
      IteratorPrototype = {};
  $__require('32')(IteratorPrototype, $__require('3')('iterator'), function() {
    return this;
  });
  module.exports = function(Constructor, NAME, next) {
    Constructor.prototype = $.create(IteratorPrototype, {next: $__require('33')(1, next)});
    $__require('29')(Constructor, NAME + ' Iterator');
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("1c", [], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {};
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("28", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("34", ["c"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var global = $__require('c'),
      SHARED = '__core-js_shared__',
      store = global[SHARED] || (global[SHARED] = {});
  module.exports = function(key) {
    return store[key] || (store[key] = {});
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("3", ["34", "c", "28"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var store = $__require('34')('wks'),
      Symbol = $__require('c').Symbol;
  module.exports = function(name) {
    return store[name] || (store[name] = Symbol && Symbol[name] || (Symbol || $__require('28'))('Symbol.' + name));
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("30", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("18", ["35"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = !$__require('35')(function() {
    return Object.defineProperty({}, 'a', {get: function() {
        return 7;
      }}).a != 7;
  });
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("33", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("32", ["17", "33", "18"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = $__require('17'),
      createDesc = $__require('33');
  module.exports = $__require('18') ? function(object, key, value) {
    return $.setDesc(object, key, createDesc(1, value));
  } : function(object, key, value) {
    object[key] = value;
    return object;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("5", ["32"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = $__require('32');
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("25", [], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = true;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("2e", ["25", "26", "5", "32", "30", "3", "1c", "31", "17", "29"], true, function($__require, exports, module) {
  "use strict";
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var LIBRARY = $__require('25'),
      $def = $__require('26'),
      $redef = $__require('5'),
      hide = $__require('32'),
      has = $__require('30'),
      SYMBOL_ITERATOR = $__require('3')('iterator'),
      Iterators = $__require('1c'),
      BUGGY = !([].keys && 'next' in [].keys()),
      FF_ITERATOR = '@@iterator',
      KEYS = 'keys',
      VALUES = 'values';
  var returnThis = function() {
    return this;
  };
  module.exports = function(Base, NAME, Constructor, next, DEFAULT, IS_SET, FORCE) {
    $__require('31')(Constructor, NAME, next);
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
      var IteratorPrototype = $__require('17').getProto(_default.call(new Base));
      $__require('29')(IteratorPrototype, TAG, true);
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

$__System.registerDynamic("1f", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("36", ["1f", "37"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var toInteger = $__require('1f'),
      defined = $__require('37');
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

$__System.registerDynamic("38", ["36", "2e"], true, function($__require, exports, module) {
  "use strict";
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $at = $__require('36')(true);
  $__require('2e')(String, 'String', function(iterated) {
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

$__System.registerDynamic("39", [], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  "format cjs";
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("3a", ["39", "38", "2f", "24", "1d"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  $__require('39');
  $__require('38');
  $__require('2f');
  $__require('24');
  module.exports = $__require('1d').Promise;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("3b", ["3a"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": $__require('3a'),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

$__System.register('3c', ['3b'], function (_export) {
    var _Promise, postMessage, addListener, deployComponent;

    return {
        setters: [function (_b) {
            _Promise = _b['default'];
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
$__System.register('3d', ['40', '41', '42', '3f', '3e'], function (_export) {
   var _inherits, _createClass, _classCallCheck, _get, Sandbox, SandboxIframe;

   return {
      setters: [function (_) {
         _inherits = _['default'];
      }, function (_2) {
         _createClass = _2['default'];
      }, function (_3) {
         _classCallCheck = _3['default'];
      }, function (_f) {
         _get = _f['default'];
      }, function (_e) {
         Sandbox = _e.Sandbox;
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
$__System.registerDynamic("42", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("43", ["17"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = $__require('17');
  module.exports = function defineProperty(it, key, desc) {
    return $.setDesc(it, key, desc);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("44", ["43"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": $__require('43'),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("41", ["44"], true, function($__require, exports, module) {
  "use strict";
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var _Object$defineProperty = $__require('44')["default"];
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

$__System.registerDynamic("15", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("10", ["15"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var aFunction = $__require('15');
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

$__System.registerDynamic("14", ["b"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var isObject = $__require('b');
  module.exports = function(it) {
    if (!isObject(it))
      throw TypeError(it + ' is not an object!');
    return it;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("b", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("27", ["17", "b", "14", "10"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var getDesc = $__require('17').getDesc,
      isObject = $__require('b'),
      anObject = $__require('14');
  var check = function(O, proto) {
    anObject(O);
    if (!isObject(proto) && proto !== null)
      throw TypeError(proto + ": can't set as prototype!");
  };
  module.exports = {
    set: Object.setPrototypeOf || ('__proto__' in {} ? function(test, buggy, set) {
      try {
        set = $__require('10')(Function.call, getDesc(Object.prototype, '__proto__').set, 2);
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

$__System.registerDynamic("45", ["26", "27"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $def = $__require('26');
  $def($def.S, 'Object', {setPrototypeOf: $__require('27').set});
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("46", ["45", "1d"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  $__require('45');
  module.exports = $__require('1d').Object.setPrototypeOf;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("47", ["46"], true, function($__require, exports, module) {
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

$__System.registerDynamic("48", ["17"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = $__require('17');
  module.exports = function create(P, D) {
    return $.create(P, D);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("49", ["48"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": $__require('48'),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("40", ["49", "47"], true, function($__require, exports, module) {
  "use strict";
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var _Object$create = $__require('49')["default"];
  var _Object$setPrototypeOf = $__require('47')["default"];
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

$__System.registerDynamic("35", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("1d", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("c", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("26", ["c", "1d"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var global = $__require('c'),
      core = $__require('1d'),
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

$__System.registerDynamic("4a", ["26", "1d", "35"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = function(KEY, exec) {
    var $def = $__require('26'),
        fn = ($__require('1d').Object || {})[KEY] || Object[KEY],
        exp = {};
    exp[KEY] = exec(fn);
    $def($def.S + $def.F * $__require('35')(function() {
      fn(1);
    }), 'Object', exp);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("37", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("11", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("4b", ["11"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var cof = $__require('11');
  module.exports = Object('z').propertyIsEnumerable(0) ? Object : function(it) {
    return cof(it) == 'String' ? it.split('') : Object(it);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("2d", ["4b", "37"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var IObject = $__require('4b'),
      defined = $__require('37');
  module.exports = function(it) {
    return IObject(defined(it));
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("4c", ["2d", "4a"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var toIObject = $__require('2d');
  $__require('4a')('getOwnPropertyDescriptor', function($getOwnPropertyDescriptor) {
    return function getOwnPropertyDescriptor(it, key) {
      return $getOwnPropertyDescriptor(toIObject(it), key);
    };
  });
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("17", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("4d", ["17", "4c"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = $__require('17');
  $__require('4c');
  module.exports = function getOwnPropertyDescriptor(it, key) {
    return $.getDesc(it, key);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("4e", ["4d"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": $__require('4d'),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("3f", ["4e"], true, function($__require, exports, module) {
  "use strict";
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var _Object$getOwnPropertyDescriptor = $__require('4e')["default"];
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

$__System.register('4f', ['40', '41', '42', '3f', '3e'], function (_export) {
    var _inherits, _createClass, _classCallCheck, _get, Sandbox, SandboxWorker;

    return {
        setters: [function (_) {
            _inherits = _['default'];
        }, function (_2) {
            _createClass = _2['default'];
        }, function (_3) {
            _classCallCheck = _3['default'];
        }, function (_f) {
            _get = _f['default'];
        }, function (_e) {
            Sandbox = _e.Sandbox;
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
$__System.register('50', ['4f', '3d', '3c'], function (_export) {

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
        setters: [function (_f) {
            SandboxWorker = _f['default'];
        }, function (_d) {
            SandboxIframe = _d['default'];
        }, function (_c) {
            SandboxAppStub = _c['default'];
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
    define("51", [], f);
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
define("3e", ["51"], function(main) {
  return main;
});

_removeDefine();
})();
$__System.register('1', ['50', '3e'], function (_export) {
    'use strict';

    var SandboxFactory, RuntimeUA, runtime;
    return {
        setters: [function (_) {
            SandboxFactory = _['default'];
        }, function (_e) {
            RuntimeUA = _e.RuntimeUA;
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