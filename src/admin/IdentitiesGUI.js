// jshint browser:true, jquery: true

class IdentitiesGUI {

  constructor(identityModule) {
    if (!identityModule) throw Error('Identity Module not set!');
    let _this = this;

    _this.identityModule = identityModule;
    $('.identities-btn').on('click', function () {
      _this.showIdentitiesGUI();
    });
  }

  showIdentitiesGUI() {
    let _this = this;

    $('.policies-gui').addClass('hide');
    $('.identities-gui').removeClass('hide');

    _this.showMyIdentities();
    _this.showCurrentID();
    $('.idp').on('click', (event) => _this.obtainNewIdentity());
    $('.back').on('click', (event) => _this.goHome());
  }

  goHome() {
    $('.policies-gui').addClass('hide');
    $('.identities-gui').addClass('hide');
  }

  showCurrentID() {
    let _this = this;
    //let identity = _this.identityModule.getCurrentIdentity();
    let identity = { email: 'user10@gmail.com', domain: 'google.com' };
    $('.current-id').html('<b>Current identity: </b>' + identity.email + ' from ' + identity.domain);
  }

  showMyIdentities() {
    let _this = this;

    // let identities = _this.identityModule.getIdentities();
    let identities = [
      { email: 'user10@gmail.com', domain: 'google.com' },
      { email: 'camila@orange.fr', domain: 'orange.fr' },
      { email: 'user20@gmail.com', domain: 'facebook.com' }
    ];
    let myIdentities = document.getElementById('my-ids');
    myIdentities.innerHTML = '';

    let table = _this.createTable();

    let tbody = document.createElement('tbody');
    let numIdentities = identities.length;
    for (let i = 0; i < numIdentities; i++) {
      let tr = _this.createTableRow(identities[i]);
      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    myIdentities.appendChild(table);
    $('.clickable-cell').on('click', (event) => _this.changeID());
    $('.remove-id').on('click', (event) => _this.removeID());
  }

  createTable() {
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

  createTableRow(identity) {
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

  changeID() {
    let _this = this;
    let idToUse = event.target.innerText;
    let domain = event.target.parentNode.children[1].innerText;
    // _this.identityModule.setIdentity({email: idToUse, domain: domain});
    Materialize.toast('Identity succesfuly changed!', 2000);
    _this.showCurrentID();
  }

  removeID() {
    let _this = this;
    let row = event.target.parentNode.parentNode;
    let idToRemove = row.children[0].textContent;
    let domain = row.children[1].textContent;
    //_this.identityModule.deleteIdentity({ email: idToRemove, domain: domain });

    // ------------------------------- TEMPORARY -------------------------------//
    let identities = [
      { email: 'user10@gmail.com', domain: 'google.com' },
      { email: 'camila@orange.fr', domain: 'orange.fr' },
      { email: 'user20@gmail.com', domain: 'facebook.com' }
    ];
    let numIdentities = identities.length;
    for (let i = 0; i < numIdentities; i++) {
      if (identities[i].email === idToRemove) {
        identities.splice(i, 1);
        break;
      }
    }
    // -------------------------------------------------------------------------//
    _this.showMyIdentities();

    Materialize.toast('Identity succesfuly deleted!', 2000);
  }

  obtainNewIdentity() {
    let _this = this;
    let idProvider = event.target.id;
    //_this.identityModule.obtainNewIdentity(idProvider);
  }

  showPopUp(url) {
    // TODO
  }

}

export default IdentitiesGUI;
