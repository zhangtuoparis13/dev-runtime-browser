(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.activate = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});

var _createClass = (function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ('value' in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; })();

exports['default'] = activate;

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError('Cannot call a class as a function'); } }

var HelloHyperty = (function () {
  function HelloHyperty(hypertyURL, bus, configuration) {
    _classCallCheck(this, HelloHyperty);

    var _this = this;
    _this.bus = bus;
    _this.configuration = configuration;
    _this.hypertyURL = hypertyURL;

    _this.bus.addListener(hypertyURL, function (msg) {
      if (_this._onMessage) _this._onMessage(msg);
    });
  }

  _createClass(HelloHyperty, [{
    key: 'sendMessage',
    value: function sendMessage(toURL, text) {

      var _this = this;

      _this.bus.postMessage({
        from: _this.hypertyURL,
        to: toURL,
        type: 'MESSAGE',

        body: {
          value: text
        }
      });
    }
  }, {
    key: 'onMessage',
    set: function set(value) {
      this._onMessage = value;
    }
  }]);

  return HelloHyperty;
})();

function activate(hypertyURL, bus, configuration) {

  return {
    hypertyName: 'HelloHyperty',
    hypertyCode: new HelloHyperty(hypertyURL, bus, configuration)
  };
}

module.exports = exports['default'];

},{}]},{},[1])(1)
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCIvVXNlcnMvZHZpbGNoZXovd29ya3NwYWNlL3JldGhpbmsvZGV2LXJ1bnRpbWUtYnJvd3Nlci9yZXNvdXJjZXMvSGVsbG9IeXBlcnR5LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBOzs7Ozs7Ozs7cUJDc0N3QixRQUFROzs7O0lBdEMxQixZQUFZO0FBRUwsV0FGUCxZQUFZLENBRUosVUFBVSxFQUFFLEdBQUcsRUFBRSxhQUFhLEVBQUU7MEJBRnhDLFlBQVk7O0FBSWQsUUFBSSxLQUFLLEdBQUcsSUFBSSxDQUFDO0FBQ2pCLFNBQUssQ0FBQyxHQUFHLEdBQUcsR0FBRyxDQUFDO0FBQ2hCLFNBQUssQ0FBQyxhQUFhLEdBQUcsYUFBYSxDQUFDO0FBQ3BDLFNBQUssQ0FBQyxVQUFVLEdBQUcsVUFBVSxDQUFDOztBQUU5QixTQUFLLENBQUMsR0FBRyxDQUFDLFdBQVcsQ0FBQyxVQUFVLEVBQUUsVUFBUyxHQUFHLEVBQUU7QUFDNUMsVUFBRyxLQUFLLENBQUMsVUFBVSxFQUNmLEtBQUssQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLENBQUM7S0FDN0IsQ0FBQyxDQUFDO0dBRUo7O2VBZEcsWUFBWTs7V0FvQkwscUJBQUMsS0FBSyxFQUFFLElBQUksRUFBRTs7QUFFdkIsVUFBSSxLQUFLLEdBQUcsSUFBSSxDQUFDOztBQUVqQixXQUFLLENBQUMsR0FBRyxDQUFDLFdBQVcsQ0FBQztBQUNsQixZQUFJLEVBQUUsS0FBSyxDQUFDLFVBQVU7QUFDdEIsVUFBRSxFQUFFLEtBQUs7QUFDVCxZQUFJLEVBQUUsU0FBUzs7QUFFZixZQUFJLEVBQUU7QUFDSixlQUFLLEVBQUUsSUFBSTtTQUNaO09BQ0osQ0FBQyxDQUFDO0tBRUo7OztTQWxCWSxhQUFDLEtBQUssRUFBQztBQUNoQixVQUFJLENBQUMsVUFBVSxHQUFHLEtBQUssQ0FBQztLQUMzQjs7O1NBbEJHLFlBQVk7OztBQXNDSCxTQUFTLFFBQVEsQ0FBQyxVQUFVLEVBQUUsR0FBRyxFQUFFLGFBQWEsRUFBRTs7QUFFL0QsU0FBTztBQUNMLGVBQVcsRUFBRSxjQUFjO0FBQzNCLGVBQVcsRUFBRSxJQUFJLFlBQVksQ0FBQyxVQUFVLEVBQUUsR0FBRyxFQUFFLGFBQWEsQ0FBQztHQUM5RCxDQUFDO0NBRUgiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiY2xhc3MgSGVsbG9IeXBlcnR5IHtcblxuICBjb25zdHJ1Y3RvcihoeXBlcnR5VVJMLCBidXMsIGNvbmZpZ3VyYXRpb24pIHtcblxuICAgIGxldCBfdGhpcyA9IHRoaXM7XG4gICAgX3RoaXMuYnVzID0gYnVzO1xuICAgIF90aGlzLmNvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uO1xuICAgIF90aGlzLmh5cGVydHlVUkwgPSBoeXBlcnR5VVJMO1xuXG4gICAgX3RoaXMuYnVzLmFkZExpc3RlbmVyKGh5cGVydHlVUkwsIGZ1bmN0aW9uKG1zZykge1xuICAgICAgICBpZihfdGhpcy5fb25NZXNzYWdlKVxuICAgICAgICAgICAgX3RoaXMuX29uTWVzc2FnZShtc2cpO1xuICAgIH0pO1xuXG4gIH1cbiAgXG4gIHNldCBvbk1lc3NhZ2UodmFsdWUpe1xuICAgICAgdGhpcy5fb25NZXNzYWdlID0gdmFsdWU7XG4gIH1cblxuICBzZW5kTWVzc2FnZSh0b1VSTCwgdGV4dCkge1xuXG4gICAgdmFyIF90aGlzID0gdGhpcztcblxuICAgIF90aGlzLmJ1cy5wb3N0TWVzc2FnZSh7XG4gICAgICAgIGZyb206IF90aGlzLmh5cGVydHlVUkwsXG4gICAgICAgIHRvOiB0b1VSTCxcbiAgICAgICAgdHlwZTogJ01FU1NBR0UnLFxuXG4gICAgICAgIGJvZHk6IHtcbiAgICAgICAgICB2YWx1ZTogdGV4dFxuICAgICAgICB9XG4gICAgfSk7XG5cbiAgfVxuXG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIGFjdGl2YXRlKGh5cGVydHlVUkwsIGJ1cywgY29uZmlndXJhdGlvbikge1xuXG4gIHJldHVybiB7XG4gICAgaHlwZXJ0eU5hbWU6ICdIZWxsb0h5cGVydHknLFxuICAgIGh5cGVydHlDb2RlOiBuZXcgSGVsbG9IeXBlcnR5KGh5cGVydHlVUkwsIGJ1cywgY29uZmlndXJhdGlvbilcbiAgfTtcblxufVxuIl19
