// jshint browser:true, jquery: true

class PoliciesGUI {

  constructor(policyEngine) {
    if (!policyEngine) throw Error('Policy Engine not set!');
    let _this = this;

    _this.policyEngine = policyEngine;

    $('.policies-btn').on('click', function () {
      _this.showPoliciesGUI();
    });

    _this.setButtons();
  }

  setButtons() {
    let _this = this;
    $('.back').on('click', (event) => _this.goHome());

    $('.group-new').on('click', (event) => _this.showNewGroupPanel());
    $('.group-add').on('click', (event) => _this.addGroup());
    $('.group-new-close').on('click', (event) => _this.goToPoliciesHome());
    $('.group-user-new').on('click', (event) => _this.showNewUserPanel());
    $('.group-user-add').on('click', (event) => _this.addUser());
    $('.group-allow').on('click', (event) => _this.changeGroupReachability(true));
    $('.group-block').on('click', (event) => _this.changeGroupReachability(false));
    $('.group-delete').on('click', (event) => _this.deleteGroup());
    $('.group-cancel').on('click', (event) => _this.goToPoliciesHome());

    $('.timeslot-creation').on('click', (event) => _this.showNewTimeslotPanel());
    $('.timeslot-new-allow').on('click', (event) => _this.addTimeslot(true));
    $('.timeslot-new-block').on('click', (event) => _this.addTimeslot(false));
    $('.timeslot-new-cancel').on('click', (event) => _this.goToPoliciesHome());
    $('.timeslot-change-allow').on('click', (event) => _this.changeTimeslot(true));
    $('.timeslot-change-block').on('click', (event) => _this.changeTimeslot(false));
    $('.timeslot-delete').on('click', (event) => _this.deleteTimeslot());
    $('.timeslot-cancel').on('click', (event) => _this.goToPoliciesHome());
  }

  showPoliciesGUI() {
    let _this = this;
    _this.showMyGroups();
    _this.showMyTimeslots();

    $('.policies-gui').removeClass('hide');
  }

  goHome() {
    $('.policies-gui').addClass('hide');
    $('.identities-gui').addClass('hide');
  }

  goToPoliciesHome() {
    $('.group-main').removeClass('hide');
    $('.group-details').addClass('hide');
    $('.group-new').removeClass('hide');
    $('.group-new-panel').addClass('hide');

    $('.timeslots-main').removeClass('hide');
    $('.timeslot-details').addClass('hide');
    $('.timeslot-creation').removeClass('hide');
    $('.timeslot-new-panel').addClass('hide');
  }

  showMyGroups() {
    let _this = this;
    let groupsNames = _this.policyEngine.getGroupsNames();
    let numGroups = groupsNames.length;

    let $myGroups = $('.groups-names');
    $myGroups.html('');
    if (numGroups === 0) {
      $myGroups.append('<p>There are no groups to display.</p>');
    } else {
      for (let i = 0; i < numGroups; i++) {
        let a = document.createElement('a');
        a.className = 'collection-item';
        a.appendChild(document.createTextNode(groupsNames[i]));
        $myGroups.append(a);
      }
    }

    $('.groups-names').removeClass('hide');
    $('.groups-names').on('click', (event) => _this.showGroupDetails());
  }

  showGroupDetails(groupMembers) {
    let _this = this;

    let groupName;
    if (groupMembers === undefined) {
      groupName = event.target.innerText;
      $('.group-name').html(groupName);
      groupMembers = _this.policyEngine.getGroup(groupName);
    } else {
      groupName = $('.group-name').text();
    }

    let numMembers = groupMembers.length;

    let $members = $('.group-members');
    if (numMembers === 0) {
      $members.html('<p>This group has no members.</p>');
    } else {
      $members.html('');
      let table = document.createElement('table');
      table.className = 'centered';

      let tbody = document.createElement('tbody');
      for (let i = 0; i < numMembers; i++) {
        let tr = document.createElement('tr');
        let td = document.createElement('td');
        td.textContent = groupMembers[i];
        tr.appendChild(td);
        td = document.createElement('td');
        let btn = document.createElement('button');
        btn.textContent = 'Remove';
        btn.className = 'remove-id waves-effect waves-light btn';
        td.appendChild(btn);
        tr.appendChild(td);
        tbody.appendChild(tr);
      }

      table.appendChild(tbody);
      $members.append(table);

      $('.remove-id').on('click', (event) => _this.deleteUser(groupName));
    }

    let isReachable = _this.policyEngine.getGroupReachability(groupName);
    let status = 'not set';
    if (isReachable !== undefined) {
      status = isReachable ? 'allowed' : 'blocked';
    }

    $('.group-reachability').html('<p><b>Reachability status: </b> ' + status + '</p>');
    $('.group-main').addClass('hide');
    $('.group-details').removeClass('hide');
    $('.group-new').addClass('hide');
  }

  createTableRow(member) {
    let tr = document.createElement('tr');

    let td = document.createElement('td');
    td.textContent = member;
    td.className = 'clickable-cell';
    td.style = 'cursor: pointer';
    tr.appendChild(td);
    td = document.createElement('td');
    let btn = document.createElement('button');
    btn.textContent = 'Remove';
    btn.className = 'remove-id waves-effect waves-light btn';
    td.appendChild(btn);
    tr.appendChild(td);

    return tr;
  }

  deleteUser(groupName) {
    let _this = this;
    let email = event.target.parentNode.parentNode.children[0].innerText;
    _this.policyEngine.removeFromGroup(email, groupName);
    Materialize.toast('User \'' + email + '\' succesfuly removed from \'' + groupName + '\' group!', 2000);
    _this.showGroupDetails(_this.policyEngine.getGroup(groupName));
  }

  showNewGroupPanel() {
    $('.group-new-panel').removeClass('hide');
    $('.group-details').addClass('hide');
    $('#newGroupName').val('');
  }

  addGroup() {
    let _this = this;
    $('.group-new-panel').addClass('hide');
    let newGroupName = $('#newGroupName').val();
    _this.policyEngine.createGroup(newGroupName);
    Materialize.toast('Group \'' + newGroupName + '\' succesfuly created!', 2000);
    _this.showMyGroups();
  }

  showNewUserPanel() {
    let _this = this;
    $('#newUserEmail').val('');
    $('.group-user-new-panel').removeClass('hide');
  }

  addUser() {
    let _this = this;
    let newUserEmail = $('#newUserEmail').val();
    let groupName = $('.group-name').text();
    _this.policyEngine.addToGroup(newUserEmail, groupName);
    _this.showGroupDetails(_this.policyEngine.getGroup(groupName));
    Materialize.toast('User \'' + newUserEmail + '\' successfully added to \'' + groupName + '\' group!', 2000);
    $('.group-user-new-panel').addClass('hide');
  }

  addPolicy(condition, authorise) {
    let _this = this;
    let policy = {
      scope: 'user',
      condition: condition,
      authorise: authorise,
      actions: []
    };

    _this.policyEngine.addPolicies([policy]);
  }

  changeGroupReachability(authorise) {
    let _this = this;
    let groupName = $('.group-name').text();
    _this.policyEngine.changePolicy('group ' + groupName, authorise);
    let status = authorise ? 'allowed' : 'blocked';
    Materialize.toast('Reachability of \'' + groupName + '\' group succesfuly changed to ' + status + '!', 2000);
    $('.group-reachability').html('<p><b>Reachability status: </b> ' + status + '</p>');
  }

  deleteGroup() {
    let _this = this;
    let groupName = $('.group-name').text();
    _this.policyEngine.removeGroup(groupName);
    Materialize.toast('Group \'' + groupName + '\' succesfuly deleted!', 2000);
    _this.goToPoliciesHome();
    _this.showMyGroups();
  }

  /*******************************************************/

  showMyTimeslots() {
    let _this = this;
    let timeslots = _this.policyEngine.getTimeslots();
    let numTimeslots = timeslots.length;
    let $myTimeslots = $('.timeslots');
    $myTimeslots.html('');
    if (numTimeslots === 0) {
      $myTimeslots.append('<p>There are no time restrictions set.</p>');
    } else {
      for (let i = 0; i < numTimeslots; i++) {
        let array = timeslots[i].split(' ');
        array.shift();
        let a = document.createElement('a');
        a.className = 'collection-item';
        let time = timeslots[i].split(' ');
        a.appendChild(document.createTextNode(time[1] + ' - ' + time[2]));
        $myTimeslots.append(a);
      }
    }

    $('.timeslots').removeClass('hide');
    $('.timeslots').on('click', (event) => _this.showTimeslotDetails());
  }

  showTimeslotDetails() {
    let _this = this;
    let timeslot = event.target.innerText;

    $('.timeslot').html(timeslot);
    let time = timeslot.split(' - ');
    let policy = _this.policyEngine.getTimeslotById('time ' + time[0] + ' ' + time[1]);
    let status = policy.authorise ? 'allowed' : 'blocked';
    $('.timeslot-reachability').html('<p><b>Reachability status: </b> ' + status + '</p>');

    $('.timeslots-main').addClass('hide');
    $('.timeslot-details').removeClass('hide');
    $('.timeslot-creation').addClass('hide');
  }

  showNewTimeslotPanel() {
    $('.timeslot-new-panel').removeClass('hide');
    $('#startTime').val('');
    $('#endTime').val('');
  }

  addTimeslot(authorise) {
    let _this = this;
    let start = $('#startTime').val();
    let end = $('#endTime').val();
    _this.addPolicy('time ' + start + ' ' + end, authorise);
    Materialize.toast('Timeslot ' + start + ' to ' + end + ' succesfuly created!', 2000);
    _this.goToPoliciesHome();
    _this.showMyTimeslots();
  }

  changeTimeslot(authorise) {
    let _this = this;
    let timeslot = $('.timeslot').text();
    let time = timeslot.split(' - ');
    _this.policyEngine.changePolicy('time ' + time[0] + ' ' + time[1], authorise);
    let status = authorise ? 'allowed' : 'blocked';
    Materialize.toast('Timeslot reachability succesfuly changed to ' + status + '!', 2000);
    $('.timeslot-reachability').html('<p><b>Reachability status: </b> ' + status + '</p>');
  }

  deleteTimeslot() {
    let _this = this;
    let timeslot = $('.timeslot').text();
    let time = timeslot.split(' - ');
    _this.policyEngine.removePolicies('time ' + time[0] + ' ' + time[1], 'user');
    Materialize.toast('Timeslot ' + time[0] + ' to ' + time[1] + ' succesfuly deleted!', 2000);
    _this.goToPoliciesHome();
    _this.showMyTimeslots();
  }
}

export default PoliciesGUI;
