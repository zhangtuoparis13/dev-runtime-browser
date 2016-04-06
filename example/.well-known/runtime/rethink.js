!function(e){function r(e,r,o){return 4===arguments.length?t.apply(this,arguments):void n(e,{declarative:!0,deps:r,declare:o})}function t(e,r,t,o){n(e,{declarative:!1,deps:r,executingRequire:t,execute:o})}function n(e,r){r.name=e,e in p||(p[e]=r),r.normalizedDeps=r.deps}function o(e,r){if(r[e.groupIndex]=r[e.groupIndex]||[],-1==v.call(r[e.groupIndex],e)){r[e.groupIndex].push(e);for(var t=0,n=e.normalizedDeps.length;n>t;t++){var a=e.normalizedDeps[t],u=p[a];if(u&&!u.evaluated){var d=e.groupIndex+(u.declarative!=e.declarative);if(void 0===u.groupIndex||u.groupIndex<d){if(void 0!==u.groupIndex&&(r[u.groupIndex].splice(v.call(r[u.groupIndex],u),1),0==r[u.groupIndex].length))throw new TypeError("Mixed dependency cycle detected");u.groupIndex=d}o(u,r)}}}}function a(e){var r=p[e];r.groupIndex=0;var t=[];o(r,t);for(var n=!!r.declarative==t.length%2,a=t.length-1;a>=0;a--){for(var u=t[a],i=0;i<u.length;i++){var s=u[i];n?d(s):l(s)}n=!n}}function u(e){return x[e]||(x[e]={name:e,dependencies:[],exports:{},importers:[]})}function d(r){if(!r.module){var t=r.module=u(r.name),n=r.module.exports,o=r.declare.call(e,function(e,r){if(t.locked=!0,"object"==typeof e)for(var o in e)n[o]=e[o];else n[e]=r;for(var a=0,u=t.importers.length;u>a;a++){var d=t.importers[a];if(!d.locked)for(var i=0;i<d.dependencies.length;++i)d.dependencies[i]===t&&d.setters[i](n)}return t.locked=!1,r},r.name);t.setters=o.setters,t.execute=o.execute;for(var a=0,i=r.normalizedDeps.length;i>a;a++){var l,s=r.normalizedDeps[a],c=p[s],v=x[s];v?l=v.exports:c&&!c.declarative?l=c.esModule:c?(d(c),v=c.module,l=v.exports):l=f(s),v&&v.importers?(v.importers.push(t),t.dependencies.push(v)):t.dependencies.push(null),t.setters[a]&&t.setters[a](l)}}}function i(e){var r,t=p[e];if(t)t.declarative?c(e,[]):t.evaluated||l(t),r=t.module.exports;else if(r=f(e),!r)throw new Error("Unable to load dependency "+e+".");return(!t||t.declarative)&&r&&r.__useDefault?r["default"]:r}function l(r){if(!r.module){var t={},n=r.module={exports:t,id:r.name};if(!r.executingRequire)for(var o=0,a=r.normalizedDeps.length;a>o;o++){var u=r.normalizedDeps[o],d=p[u];d&&l(d)}r.evaluated=!0;var c=r.execute.call(e,function(e){for(var t=0,n=r.deps.length;n>t;t++)if(r.deps[t]==e)return i(r.normalizedDeps[t]);throw new TypeError("Module "+e+" not declared as a dependency.")},t,n);c&&(n.exports=c),t=n.exports,t&&t.__esModule?r.esModule=t:r.esModule=s(t)}}function s(r){if(r===e)return r;var t={};if("object"==typeof r||"function"==typeof r)if(g){var n;for(var o in r)(n=Object.getOwnPropertyDescriptor(r,o))&&h(t,o,n)}else{var a=r&&r.hasOwnProperty;for(var o in r)(!a||r.hasOwnProperty(o))&&(t[o]=r[o])}return t["default"]=r,h(t,"__useDefault",{value:!0}),t}function c(r,t){var n=p[r];if(n&&!n.evaluated&&n.declarative){t.push(r);for(var o=0,a=n.normalizedDeps.length;a>o;o++){var u=n.normalizedDeps[o];-1==v.call(t,u)&&(p[u]?c(u,t):f(u))}n.evaluated||(n.evaluated=!0,n.module.execute.call(e))}}function f(e){if(D[e])return D[e];if("@node/"==e.substr(0,6))return y(e.substr(6));var r=p[e];if(!r)throw"Module "+e+" not present.";return a(e),c(e,[]),p[e]=void 0,r.declarative&&h(r.module.exports,"__esModule",{value:!0}),D[e]=r.declarative?r.module.exports:r.esModule}var p={},v=Array.prototype.indexOf||function(e){for(var r=0,t=this.length;t>r;r++)if(this[r]===e)return r;return-1},g=!0;try{Object.getOwnPropertyDescriptor({a:0},"a")}catch(m){g=!1}var h;!function(){try{Object.defineProperty({},"a",{})&&(h=Object.defineProperty)}catch(e){h=function(e,r,t){try{e[r]=t.value||t.get.call(e)}catch(n){}}}}();var x={},y="undefined"!=typeof System&&System._nodeRequire||"undefined"!=typeof require&&require.resolve&&"undefined"!=typeof process&&require,D={"@empty":{}};return function(e,n,o){return function(a){a(function(a){for(var u={_nodeRequire:y,register:r,registerDynamic:t,get:f,set:function(e,r){D[e]=r},newModule:function(e){return e}},d=0;d<n.length;d++)(function(e,r){r&&r.__esModule?D[e]=r:D[e]=s(r)})(n[d],arguments[d]);o(u);var i=f(e[0]);if(e.length>1)for(var d=1;d<e.length;d++)f(e[d]);return i.__useDefault?i["default"]:i})}}}("undefined"!=typeof self?self:global)

(["1"], [], function($__System) {

!function(){var t=$__System;if("undefined"!=typeof window&&"undefined"!=typeof document&&window.location)var s=location.protocol+"//"+location.hostname+(location.port?":"+location.port:"");t.set("@@cjs-helpers",t.newModule({getPathVars:function(t){var n,o=t.lastIndexOf("!");n=-1!=o?t.substr(0,o):t;var e=n.split("/");return e.pop(),e=e.join("/"),"file:///"==n.substr(0,8)?(n=n.substr(7),e=e.substr(7),isWindows&&(n=n.substr(1),e=e.substr(1))):s&&n.substr(0,s.length)===s&&(n=n.substr(s.length),e=e.substr(s.length)),{filename:n,dirname:e}}}))}();
$__System.registerDynamic("2", [], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  "format cjs";
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("3", ["4", "5"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var toInteger = $__require('4'),
      defined = $__require('5');
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

$__System.registerDynamic("6", ["3", "7"], true, function($__require, exports, module) {
  "use strict";
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $at = $__require('3')(true);
  $__require('7')(String, 'String', function(iterated) {
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

$__System.registerDynamic("8", [], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = function() {};
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("9", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("a", ["b", "c", "d", "e", "f"], true, function($__require, exports, module) {
  "use strict";
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = $__require('b'),
      descriptor = $__require('c'),
      setToStringTag = $__require('d'),
      IteratorPrototype = {};
  $__require('e')(IteratorPrototype, $__require('f')('iterator'), function() {
    return this;
  });
  module.exports = function(Constructor, NAME, next) {
    Constructor.prototype = $.create(IteratorPrototype, {next: descriptor(1, next)});
    setToStringTag(Constructor, NAME + ' Iterator');
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("7", ["10", "11", "12", "e", "13", "14", "a", "d", "b", "f"], true, function($__require, exports, module) {
  "use strict";
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var LIBRARY = $__require('10'),
      $export = $__require('11'),
      redefine = $__require('12'),
      hide = $__require('e'),
      has = $__require('13'),
      Iterators = $__require('14'),
      $iterCreate = $__require('a'),
      setToStringTag = $__require('d'),
      getProto = $__require('b').getProto,
      ITERATOR = $__require('f')('iterator'),
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

$__System.registerDynamic("15", ["8", "9", "14", "16", "7"], true, function($__require, exports, module) {
  "use strict";
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var addToUnscopables = $__require('8'),
      step = $__require('9'),
      Iterators = $__require('14'),
      toIObject = $__require('16');
  module.exports = $__require('7')(Array, 'Array', function(iterated, kind) {
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

$__System.registerDynamic("17", ["15", "14"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  $__require('15');
  var Iterators = $__require('14');
  Iterators.NodeList = Iterators.HTMLCollection = Iterators.Array;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("10", [], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = true;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("18", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("19", ["1a"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var anObject = $__require('1a');
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

$__System.registerDynamic("1b", ["14", "f"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var Iterators = $__require('14'),
      ITERATOR = $__require('f')('iterator'),
      ArrayProto = Array.prototype;
  module.exports = function(it) {
    return it !== undefined && (Iterators.Array === it || ArrayProto[ITERATOR] === it);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("4", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("1c", ["4"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var toInteger = $__require('4'),
      min = Math.min;
  module.exports = function(it) {
    return it > 0 ? min(toInteger(it), 0x1fffffffffffff) : 0;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("1d", ["1e", "f"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var cof = $__require('1e'),
      TAG = $__require('f')('toStringTag'),
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

$__System.registerDynamic("14", [], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {};
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("1f", ["1d", "f", "14", "20"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var classof = $__require('1d'),
      ITERATOR = $__require('f')('iterator'),
      Iterators = $__require('14');
  module.exports = $__require('20').getIteratorMethod = function(it) {
    if (it != undefined)
      return it[ITERATOR] || it['@@iterator'] || Iterators[classof(it)];
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("21", ["22", "19", "1b", "1a", "1c", "1f"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var ctx = $__require('22'),
      call = $__require('19'),
      isArrayIter = $__require('1b'),
      anObject = $__require('1a'),
      toLength = $__require('1c'),
      getIterFn = $__require('1f');
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
  module.exports = Object.is || function is(x, y) {
    return x === y ? x !== 0 || 1 / x === 1 / y : x != x && y != y;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("24", ["1a", "25", "f"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var anObject = $__require('1a'),
      aFunction = $__require('25'),
      SPECIES = $__require('f')('species');
  module.exports = function(O, D) {
    var C = anObject(O).constructor,
        S;
    return C === undefined || (S = anObject(C)[SPECIES]) == undefined ? D : aFunction(S);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("26", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("27", ["28"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = $__require('28').document && document.documentElement;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("29", ["2a", "28"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var isObject = $__require('2a'),
      document = $__require('28').document,
      is = isObject(document) && isObject(document.createElement);
  module.exports = function(it) {
    return is ? document.createElement(it) : {};
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("2b", ["22", "26", "27", "29", "28", "1e", "2c"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  (function(process) {
    var ctx = $__require('22'),
        invoke = $__require('26'),
        html = $__require('27'),
        cel = $__require('29'),
        global = $__require('28'),
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
      if ($__require('1e')(process) == 'process') {
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
  })($__require('2c'));
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("2d", ["28", "2b", "1e", "2c"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  (function(process) {
    var global = $__require('28'),
        macrotask = $__require('2b').set,
        Observer = global.MutationObserver || global.WebKitMutationObserver,
        process = global.process,
        Promise = global.Promise,
        isNode = $__require('1e')(process) == 'process',
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
  })($__require('2c'));
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("c", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("e", ["b", "c", "2e"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = $__require('b'),
      createDesc = $__require('c');
  module.exports = $__require('2e') ? function(object, key, value) {
    return $.setDesc(object, key, createDesc(1, value));
  } : function(object, key, value) {
    object[key] = value;
    return object;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("12", ["e"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = $__require('e');
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("2f", ["12"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var redefine = $__require('12');
  module.exports = function(target, src) {
    for (var key in src)
      redefine(target, key, src[key]);
    return target;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("13", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("d", ["b", "13", "f"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var def = $__require('b').setDesc,
      has = $__require('13'),
      TAG = $__require('f')('toStringTag');
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

$__System.registerDynamic("2e", ["30"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = !$__require('30')(function() {
    return Object.defineProperty({}, 'a', {get: function() {
        return 7;
      }}).a != 7;
  });
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("31", ["20", "b", "2e", "f"], true, function($__require, exports, module) {
  "use strict";
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var core = $__require('20'),
      $ = $__require('b'),
      DESCRIPTORS = $__require('2e'),
      SPECIES = $__require('f')('species');
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

$__System.registerDynamic("32", ["28"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var global = $__require('28'),
      SHARED = '__core-js_shared__',
      store = global[SHARED] || (global[SHARED] = {});
  module.exports = function(key) {
    return store[key] || (store[key] = {});
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("33", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("f", ["32", "33", "28"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var store = $__require('32')('wks'),
      uid = $__require('33'),
      Symbol = $__require('28').Symbol;
  module.exports = function(name) {
    return store[name] || (store[name] = Symbol && Symbol[name] || (Symbol || uid)('Symbol.' + name));
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("34", ["f"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var ITERATOR = $__require('f')('iterator'),
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

$__System.registerDynamic("35", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("36", ["35"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = $__require('35');
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("37", ["36"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = $__System._nodeRequire ? process : $__require('36');
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("2c", ["37"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = $__require('37');
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("38", ["b", "10", "28", "22", "1d", "11", "2a", "1a", "25", "18", "21", "39", "23", "f", "24", "2d", "2e", "2f", "d", "31", "20", "34", "2c"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  (function(process) {
    'use strict';
    var $ = $__require('b'),
        LIBRARY = $__require('10'),
        global = $__require('28'),
        ctx = $__require('22'),
        classof = $__require('1d'),
        $export = $__require('11'),
        isObject = $__require('2a'),
        anObject = $__require('1a'),
        aFunction = $__require('25'),
        strictNew = $__require('18'),
        forOf = $__require('21'),
        setProto = $__require('39').set,
        same = $__require('23'),
        SPECIES = $__require('f')('species'),
        speciesConstructor = $__require('24'),
        asap = $__require('2d'),
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
        if (works && $__require('2e')) {
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
      $__require('2f')(P.prototype, {
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
    $__require('d')(P, PROMISE);
    $__require('31')(PROMISE);
    Wrapper = $__require('20')[PROMISE];
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
    $export($export.S + $export.F * !(USE_NATIVE && $__require('34')(function(iter) {
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
  })($__require('2c'));
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("3a", ["2", "6", "17", "38", "20"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  $__require('2');
  $__require('6');
  $__require('17');
  $__require('38');
  module.exports = $__require('20').Promise;
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

$__System.register('3c', ['40', '41', '42', '3d', '3e', '3f', '3b'], function (_export) {
  var _classCallCheck, SandboxRegistry, MiniBus, _get, _inherits, _createClass, _Promise, SandboxType, Sandbox;

  return {
    setters: [function (_) {
      _classCallCheck = _['default'];
    }, function (_2) {
      SandboxRegistry = _2['default'];
    }, function (_3) {
      MiniBus = _3['default'];
    }, function (_d) {
      _get = _d['default'];
    }, function (_e) {
      _inherits = _e['default'];
    }, function (_f) {
      _createClass = _f['default'];
    }, function (_b) {
      _Promise = _b['default'];
    }],
    execute: function () {
      // import MessageFactory from '../../resources/MessageFactory';

      'use strict';

      SandboxType = { APP: 'app', NORMAL: 'normal' };

      _export('SandboxType', SandboxType);

      /**
       * @author micaelpedrosa@gmail.com
       * Base class to implement external sandbox component
       */

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
$__System.register('41', ['40', '3f'], function (_export) {
  var _classCallCheck, _createClass, SandboxRegistry;

  return {
    setters: [function (_) {
      _classCallCheck = _['default'];
    }, function (_f) {
      _createClass = _f['default'];
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
$__System.registerDynamic("1e", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("43", ["1e"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var cof = $__require('1e');
  module.exports = Object('z').propertyIsEnumerable(0) ? Object : function(it) {
    return cof(it) == 'String' ? it.split('') : Object(it);
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("5", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("16", ["43", "5"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var IObject = $__require('43'),
      defined = $__require('5');
  module.exports = function(it) {
    return IObject(defined(it));
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("30", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("44", ["11", "20", "30"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $export = $__require('11'),
      core = $__require('20'),
      fails = $__require('30');
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

$__System.registerDynamic("45", ["16", "44"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var toIObject = $__require('16');
  $__require('44')('getOwnPropertyDescriptor', function($getOwnPropertyDescriptor) {
    return function getOwnPropertyDescriptor(it, key) {
      return $getOwnPropertyDescriptor(toIObject(it), key);
    };
  });
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("46", ["b", "45"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = $__require('b');
  $__require('45');
  module.exports = function getOwnPropertyDescriptor(it, key) {
    return $.getDesc(it, key);
  };
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

$__System.registerDynamic("3d", ["47"], true, function($__require, exports, module) {
  "use strict";
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var _Object$getOwnPropertyDescriptor = $__require('47')["default"];
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

$__System.registerDynamic("48", ["b"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = $__require('b');
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

$__System.registerDynamic("28", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("11", ["28", "20", "22"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var global = $__require('28'),
      core = $__require('20'),
      ctx = $__require('22'),
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

$__System.registerDynamic("2a", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("1a", ["2a"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var isObject = $__require('2a');
  module.exports = function(it) {
    if (!isObject(it))
      throw TypeError(it + ' is not an object!');
    return it;
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("25", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("22", ["25"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var aFunction = $__require('25');
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

$__System.registerDynamic("39", ["b", "2a", "1a", "22"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var getDesc = $__require('b').getDesc,
      isObject = $__require('2a'),
      anObject = $__require('1a');
  var check = function(O, proto) {
    anObject(O);
    if (!isObject(proto) && proto !== null)
      throw TypeError(proto + ": can't set as prototype!");
  };
  module.exports = {
    set: Object.setPrototypeOf || ('__proto__' in {} ? function(test, buggy, set) {
      try {
        set = $__require('22')(Function.call, getDesc(Object.prototype, '__proto__').set, 2);
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

$__System.registerDynamic("4a", ["11", "39"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $export = $__require('11');
  $export($export.S, 'Object', {setPrototypeOf: $__require('39').set});
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("20", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("4b", ["4a", "20"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  $__require('4a');
  module.exports = $__require('20').Object.setPrototypeOf;
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("4c", ["4b"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  module.exports = {
    "default": $__require('4b'),
    __esModule: true
  };
  global.define = __define;
  return module.exports;
});

$__System.registerDynamic("3e", ["49", "4c"], true, function($__require, exports, module) {
  "use strict";
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var _Object$create = $__require('49')["default"];
  var _Object$setPrototypeOf = $__require('4c')["default"];
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

$__System.registerDynamic("b", [], true, function($__require, exports, module) {
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

$__System.registerDynamic("4d", ["b"], true, function($__require, exports, module) {
  ;
  var global = this,
      __define = global.define;
  global.define = undefined;
  var $ = $__require('b');
  module.exports = function defineProperty(it, key, desc) {
    return $.setDesc(it, key, desc);
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
  var _Object$defineProperty = $__require('4e')["default"];
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

$__System.registerDynamic("40", [], true, function($__require, exports, module) {
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

$__System.register('4f', ['40', '3f'], function (_export) {
  var _classCallCheck, _createClass, Bus, MsgListener;

  return {
    setters: [function (_) {
      _classCallCheck = _['default'];
    }, function (_f) {
      _createClass = _f['default'];
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
$__System.register('42', ['40', '3d', '3e', '3f', '4f'], function (_export) {
  var _classCallCheck, _get, _inherits, _createClass, Bus, MiniBus;

  return {
    setters: [function (_) {
      _classCallCheck = _['default'];
    }, function (_d) {
      _get = _d['default'];
    }, function (_e) {
      _inherits = _e['default'];
    }, function (_f) {
      _createClass = _f['default'];
    }, function (_f2) {
      Bus = _f2['default'];
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
$__System.register('50', ['41', '42', '3c'], function (_export) {
    /**
    * Copyright 2016 PT Inovação e Sistemas SA
    * Copyright 2016 INESC-ID
    * Copyright 2016 QUOBIS NETWORKS SL
    * Copyright 2016 FRAUNHOFER-GESELLSCHAFT ZUR FOERDERUNG DER ANGEWANDTEN FORSCHUNG E.V
    * Copyright 2016 ORANGE SA
    * Copyright 2016 Deutsche Telekom AG
    * Copyright 2016 Apizee
    * Copyright 2016 TECHNISCHE UNIVERSITAT BERLIN
    *
    * Licensed under the Apache License, Version 2.0 (the "License");
    * you may not use this file except in compliance with the License.
    * You may obtain a copy of the License at
    *
    *   http://www.apache.org/licenses/LICENSE-2.0
    *
    * Unless required by applicable law or agreed to in writing, software
    * distributed under the License is distributed on an "AS IS" BASIS,
    * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    * See the License for the specific language governing permissions and
    * limitations under the License.
    **/
    'use strict';

    var SandboxRegistry, MiniBus, Sandbox;

    function create(iframe) {
        window._miniBus = new MiniBus();
        window._miniBus._onPostMessage = function (msg) {
            iframe.contentWindow.postMessage(msg, '*');
        };
        window.addEventListener('message', function (event) {
            if (event.data.to.startsWith('runtime:loadedHyperty')) return;

            window._miniBus._onMessage(event.data);
        }, false);

        window._registry = new SandboxRegistry(window._miniBus);
        window._registry._create = function (url, sourceCode, config) {
            eval(sourceCode);
            return activate(url, window._miniBus, config);
        };
    }

    function getHyperty(hypertyDescriptor) {
        return window._registry.components[hypertyDescriptor];
    }return {
        setters: [function (_) {
            SandboxRegistry = _['default'];
        }, function (_2) {
            MiniBus = _2['default'];
        }, function (_c) {
            Sandbox = _c['default'];
        }],
        execute: function () {
            ;;

            _export('default', { create: create, getHyperty: getHyperty });
        }
    };
});
$__System.register('51', [], function (_export) {
    /**
    * Copyright 2016 PT Inovação e Sistemas SA
    * Copyright 2016 INESC-ID
    * Copyright 2016 QUOBIS NETWORKS SL
    * Copyright 2016 FRAUNHOFER-GESELLSCHAFT ZUR FOERDERUNG DER ANGEWANDTEN FORSCHUNG E.V
    * Copyright 2016 ORANGE SA
    * Copyright 2016 Deutsche Telekom AG
    * Copyright 2016 Apizee
    * Copyright 2016 TECHNISCHE UNIVERSITAT BERLIN
    *
    * Licensed under the Apache License, Version 2.0 (the "License");
    * you may not use this file except in compliance with the License.
    * You may obtain a copy of the License at
    *
    *   http://www.apache.org/licenses/LICENSE-2.0
    *
    * Unless required by applicable law or agreed to in writing, software
    * distributed under the License is distributed on an "AS IS" BASIS,
    * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    * See the License for the specific language governing permissions and
    * limitations under the License.
    **/
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
$__System.register('52', ['50', '51', '3b'], function (_export) {
    var app, createIframe, _Promise, RethinkBrowser;

    return {
        setters: [function (_) {
            app = _['default'];
        }, function (_2) {
            createIframe = _2.create;
        }, function (_b) {
            _Promise = _b['default'];
        }],
        execute: function () {
            /**
            * Copyright 2016 PT Inovação e Sistemas SA
            * Copyright 2016 INESC-ID
            * Copyright 2016 QUOBIS NETWORKS SL
            * Copyright 2016 FRAUNHOFER-GESELLSCHAFT ZUR FOERDERUNG DER ANGEWANDTEN FORSCHUNG E.V
            * Copyright 2016 ORANGE SA
            * Copyright 2016 Deutsche Telekom AG
            * Copyright 2016 Apizee
            * Copyright 2016 TECHNISCHE UNIVERSITAT BERLIN
            *
            * Licensed under the Apache License, Version 2.0 (the "License");
            * you may not use this file except in compliance with the License.
            * You may obtain a copy of the License at
            *
            *   http://www.apache.org/licenses/LICENSE-2.0
            *
            * Unless required by applicable law or agreed to in writing, software
            * distributed under the License is distributed on an "AS IS" BASIS,
            * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
            * See the License for the specific language governing permissions and
            * limitations under the License.
            **/
            'use strict';

            RethinkBrowser = {
                install: function install(domain) {
                    var iframe = createIframe('https://' + domain + '/.well-known/runtime/index.html');
                    app.create(iframe);

                    return {
                        requireHyperty: function requireHyperty(hypertyDescriptor) {
                            return new _Promise(function (resolve, reject) {
                                var loaded = function loaded(e) {
                                    if (e.data.to === 'runtime:loadedHyperty') {
                                        window.removeEventListener('message', loaded);
                                        resolve(app.getHyperty(e.data.body.runtimeHypertyURL));
                                    }
                                };
                                window.addEventListener('message', loaded);
                                iframe.contentWindow.postMessage({ to: 'core:loadHyperty', body: { descriptor: hypertyDescriptor } }, '*');
                            });
                        },

                        requireProtostub: function requireProtostub(domain) {
                            iframe.contentWindow.postMessage({ to: 'core:loadStub', body: { "domain": domain } }, '*');
                        }
                    };
                }
            };

            _export('default', RethinkBrowser);
        }
    };
});
$__System.register('53', ['52'], function (_export) {
    /**
    * Copyright 2016 PT Inovação e Sistemas SA
    * Copyright 2016 INESC-ID
    * Copyright 2016 QUOBIS NETWORKS SL
    * Copyright 2016 FRAUNHOFER-GESELLSCHAFT ZUR FOERDERUNG DER ANGEWANDTEN FORSCHUNG E.V
    * Copyright 2016 ORANGE SA
    * Copyright 2016 Deutsche Telekom AG
    * Copyright 2016 Apizee
    * Copyright 2016 TECHNISCHE UNIVERSITAT BERLIN
    *
    * Licensed under the Apache License, Version 2.0 (the "License");
    * you may not use this file except in compliance with the License.
    * You may obtain a copy of the License at
    *
    *   http://www.apache.org/licenses/LICENSE-2.0
    *
    * Unless required by applicable law or agreed to in writing, software
    * distributed under the License is distributed on an "AS IS" BASIS,
    * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    * See the License for the specific language governing permissions and
    * limitations under the License.
    **/
    'use strict';

    var RethinkBrowser, rethink;
    return {
        setters: [function (_) {
            RethinkBrowser = _['default'];
        }],
        execute: function () {
            rethink = undefined;

            if (typeof window != undefined && window != null) {
                rethink = RethinkBrowser;
            } else {
                rethink = undefined;
            }

            _export('default', rethink);
        }
    };
});
$__System.register('1', ['53'], function (_export) {
  'use strict';

  var rethink;
  return {
    setters: [function (_) {
      rethink = _['default'];
    }],
    execute: function () {

      window.rethink = rethink;
    }
  };
});
})
(function(factory) {
  factory();
});
//# sourceMappingURL=rethink.js.map