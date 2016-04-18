// jshint browser:true, jquery: true

// var messageBus;

export function startPoliciesGUI(bus) {
  $('.app').addClass('hide');
  $('.identities-gui').addClass('hide');
  $('.policies-gui').removeClass('hide');
  /*messageBus = bus;
    messageBus.addListener('*', (message) => {
    if (message.to === 'domain://localhost/policies-gui') {
      let method = message.body.method;
      switch (method) {
        case 'getGroupsNames':
          showGroupsNames(message.body.value);
          break;
        case 'getGroup':
          showGroupMembers(message.body.value);
          break;
        case 'getTimeRestrictions':
          showTimeRestrictionsList(message.body.value);
          break;
        case 'getTimeRestrictionById':
          showTimeRestriction(message.body.value);
          break;
      }
    }
  });*/
  $('.back').on('click', goHome);
  $('.new-user').on('click', showNewUserPanel);
  $('.add-user').on('click', addUser);
  $('.new-group').on('.click', showNewGroupPanel);
  $('.cancel-new-group').on('click', closeGroup);
  $('.add-group').on('click', addGroup);
  $('.close-new-group').on('click', closeGroupCreation);

  requestGroupsNames();
  addGroupsListener();
  addGroupMembersListener();

  $('.time-new').on('click', showNewTimeRestrictionPanel);
  $('.time-allow').on('click', addTimeRestriction(true));
  $('.time-block').on('click', addTimeRestriction(false));
  $('.time-change-allow').on('click', changeTimeRestriction(true));
  $('.time-change-block').on('click', changeTimeRestriction(false));
  $('.time-cancel').on('click', cancelTimeDetails);
  $('.time-cancel-new').on('click', cancelNewTimeRestriction);
  requestTimeRestrictions();
  addTimeListListener();
}

export function goHome() {
  $('.app').removeClass('hide');
  $('.policies-gui').addClass('hide');
}

function addGroupsListener() {
  document.getElementById('groupsList').addEventListener('click', function (e) {
    let groupName = document.getElementById(e.target.id).id;
    requestGroup(groupName);
    document.getElementById('groupName').innerHTML = groupName;
  });
}

function requestGroupsNames() {
  let message = {
    type:'execute',
    to: 'domain://localhost/policy-engine',
    from: 'domain://localhost/policies-gui',
    body: {
      method: 'getGroupsNames'
    }
  };
  /*messageBus.postMessage(message, function (response) {
    showGroupsNames(response.body.value);
  });*/
}

function showGroupsNames(groupsNames) {
  let myList = document.getElementById('groupsList');
  let numGroups = groupsNames.length;
  if (numGroups === 0) {
    myList.innerHTML = '<p>There are no groups to display.</p>';
  } else {
    myList.innerHTML = '';
    for (let i = 0; i < numGroups; i++) {
      let a = document.createElement('a');
      a.className = 'collection-item';
      a.id = groupsNames[i];
      a.appendChild(document.createTextNode(groupsNames[i]));
      myList.appendChild(a);
    }
  }
}

function requestGroup(groupName) {
  let message = {
    type:'execute',
    to: 'domain://localhost/policy-engine',
    from: 'domain://localhost/policies-gui',
    body: {
      method: 'getGroup',
      params: {
        groupName: groupName
      }
    }
  };
  //messageBus.postMessage(message);
}

function showGroupMembers(groupMembers) {
  $('.newGroup').addClass('hide');
  $('.myGroups').addClass('hide');
  let blockButton = document.getElementById('block');
  blockButton.onclick = function() {
    let groupName = document.getElementById('groupName').innerText;
    $('.members').addClass('hide');
    requestAddPolicy('group', groupName, false);
    $('.newGroup').removeClass('hide');
    $('.myGroups').removeClass('hide');
  };
  let allowButton = document.getElementById('allow');
  allowButton.onclick = function() {
    let groupName = document.getElementById('groupName').innerText;
    $('.members').addClass('hide');
    requestAddPolicy('group', groupName, true);
    $('.newGroup').removeClass('hide');
    $('.myGroups').removeClass('hide');
  };
  let deleteButton = document.getElementById('delete');
  deleteButton.onclick = function() {
    let groupName = document.getElementById('groupName').innerText;
    $('.members').addClass('hide');
    requestRemoveGroup(groupName);
    requestGroupsNames();
    $('.newGroup').removeClass('hide');
    $('.myGroups').removeClass('hide');
  };

  let members = $('.members');
  members.removeClass('hide');
  let myList = document.getElementById('groupMembers');
  myList.innerHTML = '<ul id=\'groupMembers\'></ul>';

  let numMembers = groupMembers.length;
  if (numMembers === 0) {
    myList.innerHTML = '<p>This groups has no members.</p>';
  } else {
    let list = document.createElement('ul');
    for (let i = 0; i < numMembers; i++) {
      let item = document.createElement('li');
      item.appendChild(document.createTextNode(groupMembers[i]));
      item.id = groupMembers[i];
      let removeBtn = document.createElement('button');
      removeBtn.className = 'waves-effect waves-light btn';
      removeBtn.id = 'member:' + groupMembers[i];
      removeBtn.innerHTML = 'Remove';
      removeBtn.type = 'button';
      item.appendChild(removeBtn);
      list.appendChild(item);
    }
    myList.appendChild(list);
  }
}

function requestRemoveGroup(groupName) {
  let message = {
    type:'execute', to: 'domain://localhost/policy-engine',
    from: 'domain://localhost/policies-gui',
    body: {
      method: 'removeGroup',
      params: {
        groupName: groupName
      }
    }
  };
  //messageBus.postMessage(message);
}

export function showNewGroupPanel() {
  $('.newGroupPanel').removeClass('hide');
  $('.members').addClass('hide');
  $('#newGroupName').val('');
}

export function addGroup() {
  $('.newGroupPanel').addClass('hide');
  let newGroupName = $('#newGroupName').val();
  requestCreateGroup(newGroupName);
  requestGroupsNames();
}

export function closeGroupCreation() {
  $('.newGroupPanel').addClass('hide');
}

export function closeGroup() {
  $('.members').addClass('hide');
  $('.myGroups').removeClass('hide');
  $('.newGroup').removeClass('hide');
}

function requestCreateGroup(groupName) {
  let message = {
    type:'execute', to: 'domain://localhost/policy-engine',
    from: 'domain://localhost/policies-gui',
    body: {
      method: 'createGroup',
      params: {
        groupName: groupName
      }
    }
  };
  //messageBus.postMessage(message);
}

export function showNewUserPanel() {
  $('.newUser').removeClass('hide');
  $('#newUserEmail').val('');
}

export function addUser() {
  let newUserEmail = $('#newUserEmail').val();
  let groupName = document.getElementById('groupName').innerText;
  requestAddUser(newUserEmail, groupName);
  requestGroup(groupName);
  $('.newUser').addClass('hide');
}

function cancelUser() {
  $('.members').addClass('hide');
  $('.newGroup').removeClass('hide');
}

function requestAddUser(userEmail, groupName) {
  let message = {
    type:'execute', to: 'domain://localhost/policy-engine',
    from: 'domain://localhost/policies-gui',
    body: {
      method: 'addToGroup',
      params: {
        userEmail: userEmail,
        groupName: groupName
      }
    }
  };
  //messageBus.postMessage(message);
}

function requestAddPolicy(type, params, authorise) {
  let policy = {};
  if (typeof params === 'string') {
    policy = {
      id: [type, params].join('-'), //group-groupname
      scope: 'user',
      condition: [type, params].join(' '), //group groupname
      authorise: authorise,
      actions: []
    };
  } else {
    policy = {
      id: [type, params.join('-')].join('-'), //time-1:00-2:00
      scope: 'user',
      condition: [type, params.join(' ')].join(' '), //time 1:00 2:00
      authorise: authorise,
      actions: []
    };
  }
  let message = {
    type:'execute',
    to: 'domain://localhost/policy-engine',
    from: 'domain://localhost/policies-gui',
    body: {
      method: 'addPolicies',
      params: {
        policies: [policy],
        scope: 'user'
      }
    }
  };
  //messageBus.postMessage(message);
}

function addGroupMembersListener() {
  document.getElementById('groupMembers').addEventListener('click', function(e) {
    let userEmail = document.getElementById(e.target.id).id.slice(7);
    let groupName = document.getElementById('groupName').innerText;
    removeUserFromGroup(userEmail, groupName);
    requestGroup(groupName);
  });
}

function removeUserFromGroup(userEmail, groupName) {
  let message = {
    type:'execute',
    to: 'domain://localhost/policy-engine',
    from: 'domain://localhost/policies-gui',
    body: {
      method: 'removeFromGroup',
      params: {
        userEmail: userEmail,
        groupName: groupName
      }
    }
  };
  //messageBus.postMessage(message);
}

/*******************************************************/
function requestTimeRestrictions() {
  let message = {
    type:'execute',
    to: 'domain://localhost/policy-engine',
    from: 'domain://localhost/policies-gui',
    body: {
      method: 'getTimeRestrictions'
    }
  };
  //messageBus.postMessage(message);
}

function addTimeListListener() {
  document.getElementById('timeRestrictionsList').addEventListener('click', function(e) {
    let timeslot = e.target.id; //time-1-2
    let time = timeslot.split('-');
    document.getElementById('timeslot').innerHTML = 'Time slot: from ' + time[1] + ' to ' + time[2];
    requestTimeRestriction(timeslot);

    //requestRemoveTimeRestriction(e.target.id);
    //requestTimeRestrictions();
  });
}

function requestTimeRestriction(id) {
  let message = {
    type:'execute',
    to: 'domain://localhost/policy-engine',
    from: 'domain://localhost/policies-gui',
    body: {
      method: 'getTimeRestrictionById',
      params: {
        policyID: id,
        scope: 'user'
      }
    }
  };
  //messageBus.postMessage(message);
}

function showTimeRestrictionsList(timeRestrictions) {
  $('.showTimeRestrictions').removeClass('hide');
  let myList = document.getElementById('timeRestrictionsList');

  let numRestrictions = timeRestrictions.length;
  if (numRestrictions === 0) {
    myList.innerHTML = '<p>There are no time restrictions set.<p>';
  } else {
    myList.innerHTML = '';
    for (let i = 0; i < numRestrictions; i++) {
      let array = timeRestrictions[i].split(' ');
      array.shift();
      let a = document.createElement('a');
      a.className = 'collection-item';
      a.id = 'time-' + array.join('-');
      a.appendChild(document.createTextNode(array.join(' - ')));
      myList.appendChild(a);
    }
  }
}

function showTimeRestriction(timeRestriction) {
  $('.showTimeRestrictions').addClass('hide');
  $('.newRestriction').addClass('hide');
  $('.newRestrictionPanel').addClass('hide');
  $('.timeRestriction').removeClass('hide');

  let are = timeRestriction.authorise ? ' are ' : ' are not ';
  document.getElementById('timeDetails').innerHTML = '<p>You' + are + 'available in this timeslot.</p>';
}

function requestRemoveTimeRestriction(timeRestrictionID) {
  let message = {
    type:'execute',
    to: 'domain://localhost/policy-engine',
    from: 'domain://localhost/policies-gui',
    body: {
      method: 'removePolicies',
      params: {
        policyID: timeRestrictionID,
        scope: 'user'
      }
    }
  };
  //messageBus.postMessage(message);
}

function showNewTimeRestrictionPanel() {
  $('.newRestrictionPanel').removeClass('hide');
  $('#startTime').val('');
  $('#endTime').val('');
}

function addTimeRestriction(authorise) {
  $('.newRestrictionPanel').addClass('hide');
  let start = $('#startTime').val();
  let end = $('#endTime').val();
  requestAddPolicy('time', [start, end], authorise);
  requestTimeRestrictions();
}

function cancelNewTimeRestriction() {
  $('.showTimeRestrictions').removeClass('hide');
  $('.newRestrictionPanel').addClass('hide');
}

function changeTimeRestriction(authorise) {
  let timeslot = document.getElementById('timeslot').innerText;
  let time = timeslot.split(' ');
  let policyID = 'time-' + time[3] + '-' + time[5];
  requestChangeTimePolicy(policyID, authorise);
  cancelTimeDetails();
}

function requestChangeTimePolicy(policyID, authorise) {
  let message = {
    type:'execute',
    to: 'domain://localhost/policy-engine',
    from: 'domain://localhost/policies-gui',
    body: {
      method: 'changeTimePolicy',
      params: {
        policyID: policyID,
        authorise: authorise,
        scope: 'user'
      }
    }
  };
  //messageBus.postMessage(message);
}

function cancelTimeDetails() {
  $('.timeRestriction').addClass('hide');
  $('.showTimeRestrictions').removeClass('hide');
  $('striction').removeClass('hide');
}
