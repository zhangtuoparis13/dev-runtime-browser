// jshint browser:true, jquery: true

//var idModule;

var identities = [
  { email: 'user10@gmail.com', domain: 'google.com' },
  { email: 'camila@orange.fr', domain: 'orange.fr' },
  { email: 'user20@gmail.com', domain: 'facebook.com' }
];

//export function startIdentitiesGUI(identityModule) {
  //var idModule = identityModule;
  //console.log('IDENTITY MODULE @ start', idModule);
//}

export function showIdentitiesGUI() {
  //console.log('IDENTITY MODULE @ show', idModule);

  // ------------------------------- TEMPORARY -------------------------------//
  $('.app').addClass('hide');
  $('.policies-gui').addClass('hide');
  $('.identities-gui').removeClass('hide');
  showCurrentID({ email: 'user10@gmail.com', domain: 'google.com' });
  showMyIdentities(identities);
  $('.idp').on('click', obtainNewIdentity);

  // -------------------------------------------------------------------------//

  $('.back').on('click', goHome);
  sendRequest('getCurrentIdentity', '');
  sendRequest('getIdentities', '');
}

function goHome() {
  $('.app').removeClass('hide');
  $('.policies-gui').addClass('hide');
  $('.identities-gui').addClass('hide');
}

function showCurrentID(identity) {
  $('.current-id').html('<b>Current identity: </b>' + identity.email + ' from ' + identity.domain);
}

function showMyIdentities(identities) {
  let myIdentities = document.getElementById('my-ids');
  myIdentities.innerHTML = '';

  let table = createTable();

  let tbody = document.createElement('tbody');
  let numIdentities = identities.length;
  for (let i = 0; i < numIdentities; i++) {
    let tr = createTableRow(identities[i]);
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  myIdentities.appendChild(table);
  $('.clickable-cell').on('click', changeID);
  $('.remove-id').on('click', removeID);
}

function createTable() {
  let table = document.createElement('table');
  table.className = 'centered';
  let thead = document.createElement('thead');
  let tr = document.createElement('tr');
  let thEmail = document.createElement('th');
  thEmail.textContent = 'Email';
  tr.appendChild(thEmail);
  let thDomain = document.createElement('th');
  thDomain.textContent = 'Domain';
  tr.appendChild(thDomain);
  thead.appendChild(tr);
  table.appendChild(thead);
  return table;
}

function createTableRow(identity) {
  let tr = document.createElement('tr');

  let td = document.createElement('td');
  td.textContent = identity.email;
  td.className = 'clickable-cell';
  td.style = 'cursor: pointer';
  tr.appendChild(td);
  td = document.createElement('td');
  td.textContent = identity.domain;
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

function changeID() {
  let idToUse = $(this).context.parentNode.children[0].textContent;
  let domain = $(this).context.parentNode.children[1].textContent;
  sendRequest('setIdentity', { email: idToUse, domain: domain });
  Materialize.toast('Identity succesfuly changed!', 2000);
  showCurrentID({ email: idToUse, domain: domain });
}

function removeID() {
  let row = $(this)[0].parentNode.parentNode;
  let idToRemove = row.children[0].textContent;
  let domain = row.children[1].textContent;
  sendRequest('deleteIdentity', { email: idToRemove, domain: domain });

  // ------------------------------- TEMPORARY -------------------------------//
  let numIdentities = identities.length;
  for (let i = 0; i < numIdentities; i++) {
    if (identities[i].email === idToRemove) {
      identities.splice(i, 1);
      break;
    }
  }

  showMyIdentities(identities);

  // -------------------------------------------------------------------------//

  sendRequest('getIdentities', '');
  Materialize.toast('Identity succesfuly deleted!', 2000);
}

function obtainNewIdentity() {
  console.log('obtainNewIdentity');
  let idProvider = $(this).context.id;
  sendRequest('obtainNewIdentity', idProvider);
}

function showPopUp(url) {
    // TODO
}

function sendRequest(method, param) {
  let request = {
    from: 'domain://IdentityGUI',
    to: 'runtime://IdentityModule',
    body: {
      value: {
        method: method,
        param: param
      }
    }
  };

  /*messageBus.postMessage(request), function(response) {
    let result = response.body.value;
    if (typeof result === 'array') {
      showMyIdentities(result);
    } else if (typeof result === 'string') {
      showPopUp(result);
      //TODO: do Materialize.toast('Identity successfully added!', 2000);
      //TODO: do sendRequest('getIdentities', '') after the new identity is provided
    } else if (typeof result === 'object') {
      showCurrentID(result);
    }
  };*/
}
