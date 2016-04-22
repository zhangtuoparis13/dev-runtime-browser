(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.policiesGui = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

// jshint browser:true, jquery: true

var PoliciesGUI = function () {
  function PoliciesGUI(policyEngine) {
    _classCallCheck(this, PoliciesGUI);

    if (!policyEngine) throw Error('Policy Engine not set!');
    var _this = this;

    _this.policyEngine = policyEngine;

    $('.policies-btn').on('click', function () {
      _this.showPoliciesGUI();
    });
  }

  _createClass(PoliciesGUI, [{
    key: 'showPoliciesGUI',
    value: function showPoliciesGUI() {
      var _this = this;

      $('.policies-gui').removeClass('hide');
      $('.back').on('click', function (event) {
        return _this.goHome();
      });

      $('.group-new').on('click', function (event) {
        return _this.showNewGroupPanel();
      });
      $('.group-add').on('click', function (event) {
        return _this.addGroup();
      });
      $('.group-new-close').on('click', function (event) {
        return _this.goToPoliciesHome();
      });
      $('.group-user-new').on('click', function (event) {
        return _this.showNewUserPanel();
      });
      $('.group-user-add').on('click', function (event) {
        return _this.addUser();
      });
      $('.group-allow').on('click', function (event) {
        return _this.changeGroupReachability(true);
      });
      $('.group-block').on('click', function (event) {
        return _this.changeGroupReachability(false);
      });
      $('.group-delete').on('click', function (event) {
        return _this.deleteGroup();
      });
      $('.group-cancel').on('click', function (event) {
        return _this.goToPoliciesHome();
      });

      _this.showMyGroups();

      $('.timeslot-creation').on('click', function (event) {
        return _this.showNewTimeslotPanel();
      });
      $('.timeslot-new-allow').on('click', function (event) {
        return _this.addTimeslot(true);
      });
      $('.timeslot-new-block').on('click', function (event) {
        return _this.addTimeslot(false);
      });
      $('.timeslot-new-cancel').on('click', function (event) {
        return _this.goToPoliciesHome();
      });
      $('.timeslot-change-allow').on('click', function (event) {
        return _this.changeTimeslot(true);
      });
      $('.timeslot-change-block').on('click', function (event) {
        return _this.changeTimeslot(false);
      });
      $('.timeslot-delete').on('click', function (event) {
        return _this.deleteTimeslot();
      });
      $('.timeslot-cancel').on('click', function (event) {
        return _this.goToPoliciesHome();
      });

      _this.showMyTimeslots();
    }
  }, {
    key: 'goHome',
    value: function goHome() {
      $('.policies-gui').addClass('hide');
      $('.identities-gui').addClass('hide');
    }
  }, {
    key: 'goToPoliciesHome',
    value: function goToPoliciesHome() {
      $('.group-main').removeClass('hide');
      $('.group-details').addClass('hide');
      $('.group-new').removeClass('hide');
      $('.group-new-panel').addClass('hide');

      $('.timeslots-main').removeClass('hide');
      $('.timeslot-details').addClass('hide');
      $('.timeslot-creation').removeClass('hide');
      $('.timeslot-new-panel').addClass('hide');
    }
  }, {
    key: 'showMyGroups',
    value: function showMyGroups() {
      var _this = this;
      var groupsNames = _this.policyEngine.getGroupsNames();
      var numGroups = groupsNames.length;

      var $myGroups = $('.groups-names');
      $myGroups.html('');
      if (numGroups === 0) {
        $myGroups.append('<p>There are no groups to display.</p>');
      } else {
        for (var i = 0; i < numGroups; i++) {
          var a = document.createElement('a');
          a.className = 'collection-item';
          a.appendChild(document.createTextNode(groupsNames[i]));
          $myGroups.append(a);
        }
      }

      $('.groups-names').removeClass('hide');
      $('.groups-names').on('click', function (event) {
        return _this.showGroupDetails();
      });
    }
  }, {
    key: 'showGroupDetails',
    value: function showGroupDetails(groupMembers) {
      var _this = this;

      var groupName = void 0;
      if (groupMembers === undefined) {
        groupName = event.target.innerText;
        $('.group-name').html(groupName);
        groupMembers = _this.policyEngine.getGroup(groupName);
      } else {
        groupName = $('.group-name').text();
      }

      var numMembers = groupMembers.length;

      var $members = $('.group-members');
      if (numMembers === 0) {
        $members.html('<p>This group has no members.</p>');
      } else {
        $members.html('');
        var table = document.createElement('table');
        table.className = 'centered';

        var tbody = document.createElement('tbody');
        for (var i = 0; i < numMembers; i++) {
          var tr = document.createElement('tr');
          var td = document.createElement('td');
          td.textContent = groupMembers[i];
          tr.appendChild(td);
          td = document.createElement('td');
          var btn = document.createElement('button');
          btn.textContent = 'Remove';
          btn.className = 'remove-id waves-effect waves-light btn';
          td.appendChild(btn);
          tr.appendChild(td);
          tbody.appendChild(tr);
        }

        table.appendChild(tbody);
        $members.append(table);

        $('.remove-id').on('click', function (event) {
          return _this.deleteUser(groupName);
        });
      }

      var isReachable = _this.policyEngine.getGroupReachability(groupName);
      var status = 'not set';
      if (isReachable !== undefined) {
        status = isReachable ? 'allowed' : 'blocked';
      }

      $('.group-reachability').html('<p><b>Reachability status: </b> ' + status + '</p>');
      $('.group-main').addClass('hide');
      $('.group-details').removeClass('hide');
      $('.group-new').addClass('hide');
    }
  }, {
    key: 'createTableRow',
    value: function createTableRow(member) {
      var tr = document.createElement('tr');

      var td = document.createElement('td');
      td.textContent = member;
      td.className = 'clickable-cell';
      td.style = 'cursor: pointer';
      tr.appendChild(td);
      td = document.createElement('td');
      var btn = document.createElement('button');
      btn.textContent = 'Remove';
      btn.className = 'remove-id waves-effect waves-light btn';
      td.appendChild(btn);
      tr.appendChild(td);

      return tr;
    }
  }, {
    key: 'deleteUser',
    value: function deleteUser(groupName) {
      var _this = this;
      var email = event.target.parentNode.parentNode.children[0].innerText;
      _this.policyEngine.removeFromGroup(email, groupName);
      Materialize.toast('User \'' + email + '\' succesfuly removed from \'' + groupName + '\' group!', 2000);
      _this.showGroupDetails(_this.policyEngine.getGroup(groupName));
    }
  }, {
    key: 'showNewGroupPanel',
    value: function showNewGroupPanel() {
      $('.group-new-panel').removeClass('hide');
      $('.group-details').addClass('hide');
      $('#newGroupName').val('');
    }
  }, {
    key: 'addGroup',
    value: function addGroup() {
      var _this = this;
      $('.group-new-panel').addClass('hide');
      var newGroupName = $('#newGroupName').val();
      _this.policyEngine.createGroup(newGroupName);
      Materialize.toast('Group \'' + newGroupName + '\' succesfuly created!', 2000);
      _this.showMyGroups();
    }
  }, {
    key: 'showNewUserPanel',
    value: function showNewUserPanel() {
      var _this = this;
      $('#newUserEmail').val('');
      $('.group-user-new-panel').removeClass('hide');
    }
  }, {
    key: 'addUser',
    value: function addUser() {
      var _this = this;
      var newUserEmail = $('#newUserEmail').val();
      var groupName = $('.group-name').text();
      _this.policyEngine.addToGroup(newUserEmail, groupName);
      _this.showGroupDetails(_this.policyEngine.getGroup(groupName));
      Materialize.toast('User \'' + newUserEmail + '\' successfully added to \'' + groupName + '\' group!', 2000);
      $('.group-user-new-panel').addClass('hide');
    }
  }, {
    key: 'addPolicy',
    value: function addPolicy(type, params, authorise) {
      var _this = this;
      var policy = {};
      if (typeof params === 'string') {
        policy = {
          scope: 'user',
          condition: [type, params].join(' '), //group groupname
          authorise: authorise,
          actions: []
        };
      } else {
        policy = {
          scope: 'user',
          condition: [type, params.join(' ')].join(' '), //time 1:00 2:00
          authorise: authorise,
          actions: []
        };
      }

      _this.policyEngine.addPolicies([policy]);
    }
  }, {
    key: 'changeGroupReachability',
    value: function changeGroupReachability(authorise) {
      var _this = this;
      var groupName = $('groupName').text();
      _this.policyEngine.changePolicy('group ' + groupName, authorise);
      var status = authorise ? 'allowed' : 'blocked';
      Materialize.toast('Reachability of \'' + groupName + '\' group succesfuly changed to ' + status + '!', 2000);
      $('.group-reachability').html('<p><b>Reachability status: </b> ' + status + '</p>');
    }
  }, {
    key: 'deleteGroup',
    value: function deleteGroup() {
      var _this = this;
      var groupName = $('.group-name').text();
      _this.policyEngine.removeGroup(groupName);
      Materialize.toast('Group \'' + groupName + '\' succesfuly deleted!', 2000);
      _this.goToPoliciesHome();
      _this.showMyGroups();
    }

    /*******************************************************/

  }, {
    key: 'showMyTimeslots',
    value: function showMyTimeslots() {
      var _this = this;
      var timeslots = _this.policyEngine.getTimeslots();
      var numTimeslots = timeslots.length;
      var $myTimeslots = $('.timeslots');
      $myTimeslots.html('');
      if (numTimeslots === 0) {
        $myTimeslots.append('<p>There are no time restrictions set.</p>');
      } else {
        for (var i = 0; i < numTimeslots; i++) {
          var array = timeslots[i].split(' ');
          array.shift();
          var a = document.createElement('a');
          a.className = 'collection-item';
          a.appendChild(document.createTextNode(timeslots[i]));
          $myTimeslots.append(a);
        }
      }

      $('.timeslots').removeClass('hide');
      $('.timeslots').on('click', function (event) {
        return _this.showTimeslotDetails();
      });
    }
  }, {
    key: 'showTimeslotDetails',
    value: function showTimeslotDetails() {
      var _this = this;
      var id = event.target.innerText;
      $('.timeslot').html(id);
      var timeslot = _this.policyEngine.getTimeslotById(id);
      var status = timeslot.authorise ? 'allowed' : 'blocked';
      $('.timeslot-reachability').html('<p><b>Reachability status: </b> ' + status + '</p>');

      $('.timeslots-main').addClass('hide');
      $('.timeslot-details').removeClass('hide');
      $('.timeslot-creation').addClass('hide');
    }
  }, {
    key: 'showNewTimeslotPanel',
    value: function showNewTimeslotPanel() {
      $('.timeslot-new-panel').removeClass('hide');
      $('#startTime').val('');
      $('#endTime').val('');
    }
  }, {
    key: 'addTimeslot',
    value: function addTimeslot(authorise) {
      var _this = this;
      var start = $('#startTime').val();
      var end = $('#endTime').val();
      _this.addPolicy('time', [start, end], authorise);
      Materialize.toast('Timeslot ' + start + ' to ' + end + ' succesfuly created!', 2000);
      _this.goToPoliciesHome();
      _this.showMyTimeslots();
    }
  }, {
    key: 'changeTimeslot',
    value: function changeTimeslot(authorise) {
      var _this = this;
      var timeslot = $('.timeslot').text();
      _this.policyEngine.changePolicy(timeslot, authorise);
      var status = authorise ? 'allowed' : 'blocked';
      Materialize.toast('Timeslot reachability succesfuly changed to ' + status + '!', 2000);
      $('.timeslot-reachability').html('<p><b>Reachability status: </b> ' + status + '</p>');
    }
  }, {
    key: 'deleteTimeslot',
    value: function deleteTimeslot() {
      var _this = this;
      var timeslot = $('.timeslot').text();
      _this.policyEngine.removePolicies(timeslot, 'user');
      var time = timeslot.split(' ');
      Materialize.toast('Timeslot ' + time[1] + ' to ' + time[2] + ' succesfuly deleted!', 2000);
      _this.goToPoliciesHome();
      _this.showMyTimeslots();
    }
  }]);

  return PoliciesGUI;
}();

exports.default = PoliciesGUI;

},{}]},{},[1])(1)
});


//# sourceMappingURL=policies-gui.js.map
