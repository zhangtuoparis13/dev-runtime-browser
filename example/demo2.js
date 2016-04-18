// jshint browser:true, jquery: true
/* global Handlebars */
/* global Materialize */

//import config from '../system.config.json!json';
import {ready, errorMessage} from './support';
import {showPoliciesGUI} from '../src/admin/policiesGUI';
import {showIdentitiesGUI} from '../src/admin/identitiesGUI';

// polyfills
import 'babel-polyfill';
import 'indexeddbshim';
import 'mutationobserver-shim';
import 'object.observe';
import 'array.observe';

//import InstallerFactory from '../resources/factories/InstallerFactory';
//import RuntimeLoader from '../src/runtime-loader/RuntimeLoader';

// reTHINK modules
// import RuntimeUA from 'runtime-core/dist/runtimeUA';

// import SandboxFactory from '../resources/sandboxes/SandboxFactory';
// let sandboxFactory = new SandboxFactory();
let avatar = 'https://lh3.googleusercontent.com/-XdUIqdMkCWA/AAAAAAAAAAI/AAAAAAAAAAA/4252rscbv5M/photo.jpg';

// You can change this at your own domain
let domain = 'localhost';

// Hack because the GraphConnector jsrsasign module;
window.KJUR = {};

// Check if the document is ready
if (document.readyState === 'complete') {
  documentReady();
} else {
  window.addEventListener('onload', documentReady, false);
  document.addEventListener('DOMContentLoaded', documentReady, false);
}

var runtimeLoader;

function documentReady() {

  ready();

  let hypertyHolder = $('.hyperties');
  hypertyHolder.removeClass('hide');

  //let installerFactory = new InstallerFactory();
  //let runtimeURL = 'hyperty-catalogue://' + domain + '/.well-known/runtime/RuntimeUA';
  window.rethink.default.install(domain)
      .then(runtimeInstalled)
      .catch(errorMessage);
}

function runtimeInstalled(runtime) {

  let hyperty = 'hyperty-catalogue://' + domain + '/.well-known/hyperty/HypertyChat';

  // Load First Hyperty
  runtime.requireHyperty(hyperty).then(hypertyDeployed).catch(function (reason) {
    errorMessage(reason);
  });

}

let hypertyChat;

function hypertyDeployed(result) {
  hypertyChat = result.instance;

  let loginPanel = $('.login-panel');
  let cardAction = loginPanel.find('.card-action');
  let hypertyInfo = '<div class="row"><div class="col s12"><span class="white-text"><p><b>hypertyURL:</b> ' + result.runtimeHypertyURL + '</br><b>status:</b> ' + result.status + '</p></span></div></div><div class="row"><div class="col s3 offset-s3"><button class="policies-btn waves-effect waves-light btn">Policies</button></div><div class="col s3"><button class="identities-btn waves-effect waves-light btn">Identities</button></div></div>';

  loginPanel.attr('data-url', result.runtimeHypertyURL);
  cardAction.append(hypertyInfo);

  $('.policies-btn').on('click', showPoliciesGUI);
  $('.identities-btn').on('click', showIdentitiesGUI);

  let messageChat = $('.chat');
  messageChat.removeClass('hide');

  let chatSection = $('.chat-section');
  chatSection.removeClass('hide');

  // Create Chat section
  let createRoomModal = $('.create-chat');
  let participantsForm = createRoomModal.find('.participants-form');
  let createRoomBtn = createRoomModal.find('.btn-create');
  let addParticipantBtn = createRoomModal.find('.btn-add');

  let countParticipants = 0;

  addParticipantBtn.on('click', function (event) {

    event.preventDefault();

    countParticipants++;

    let participantEl = '<div class="row">' +
      '<div class="input-field col s8">' +
      '  <input class="input-email" name="email" id="email-' + countParticipants + '" required aria-required="true" type="text">' +
      '  <label for="email-' + countParticipants + '">Participant Email</label>' +
      '</div>' +
      '<div class="input-field col s4">' +
      '  <input class="input-domain" name="domain" id="domain-' + countParticipants + '" type="text">' +
      '  <label for="domain-' + countParticipants + '">Participant domain</label>' +
      '</div>' +
    '</div>';

    let participants = createRoomModal.find('.participants-form');
    participants.append(participantEl);

  });

  createRoomBtn.on('click', function (event) {
    event.preventDefault();

    let participants = [];
    /* participantsForm.find('.input-email').each(function() {
      participants.push($(this).val());
    });*/
    console.log(participantsForm);
    let serializedObject = $(participantsForm).serializeObjectArray();

    // Prepare the chat
    let name = createRoomModal.find('.input-name').val();

    console.log(serializedObject);

    if (serializedObject.hasOwnProperty('email')) {

      serializedObject.email.forEach(function (value, index) {
        participants.push({ email: value, domain: serializedObject.domain[index] });
      });

    }

    console.log('Participants: ', participants);

    hypertyChat.create(name, participants).then(function (chatGroup) {

      prepareChat(chatGroup);

    }).catch(function (reason) {
      console.error(reason);
    });
  });

  hypertyChat.addEventListener('chat:subscribe', function (chatGroup) {
    prepareChat(chatGroup);
  });

  // Join Chat Modal
  let joinModal = $('.join-chat');
  let joinBtn = joinModal.find('.btn-join');
  joinBtn.on('click', function (event) {

    event.preventDefault();

    let resource = joinModal.find('.input-name').val();

    hypertyChat.join(resource).then(function (chatGroup) {
      prepareChat(chatGroup);
    }).catch(function (reason) {
      console.error(reason);
    });

  });

  // Add actions
  Handlebars.getTemplate('chat-actions').then(function (template) {

    let html = template();
    $('.chat-section').append(html);

    let createBtn = $('.create-room-btn');
    let joinBtn = $('.join-room-btn');

    createBtn.on('click', createRoom);
    joinBtn.on('click', joinRoom);
  });
}

function createRoom(event) {
  event.preventDefault();

  let createRoomModal = $('.create-chat');
  createRoomModal.openModal();

}

function joinRoom(event) {
  event.preventDefault();

  let joinModal = $('.join-chat');
  joinModal.openModal();

}

function prepareChat(chatGroup) {

  Handlebars.getTemplate('chat-section').then(function (html) {
    $('.chat-section').append(html);

    chatManagerReady(chatGroup);

    console.log('Chat Group Controller: ', chatGroup);

    chatGroup.addEventListener('have:new:notification', function (event) {
      console.log('have:new:notification: ', event);
      Materialize.toast('Have new notification', 3000, 'rounded');
    });

    chatGroup.addEventListener('new:message:recived', function (message) {
      console.info('new message recived: ', message);
      processMessage(message);
    });

    chatGroup.addEventListener('participant:added', function (participant) {
      console.info('new participant', participant);
      addParticipant(participant);
    });

  });

}

function chatManagerReady(chatGroup) {

  let chatSection = $('.chat-section');
  let addParticipantBtn = chatSection.find('.add-participant-btn');

  let addParticipantModal = $('.add-participant');
  let btnAdd = addParticipantModal.find('.btn-add');
  let btnCancel = addParticipantModal.find('.btn-cancel');

  let messageForm = chatSection.find('.message-form');
  let textArea = messageForm.find('.materialize-textarea');

  Handlebars.getTemplate('chat-header').then(function(template) {
    let name = chatGroup.dataObject.data.communication.id;
    let resource = chatGroup.dataObject._url;

    let html = template({name: name, resource: resource});
    $('.chat-header').append(html);
  });

  let roomsSections = $('.rooms');
  let collection = roomsSections.find('.collection');
  let item = '<li class="collection-item active">' + chatGroup.dataObject.data.communication.id + '</li>';
  collection.append(item);

  let badge = collection.find('.collection-header .badge');
  let items = collection.find('.collection-item').length;
  badge.html(items);

  textArea.on('keyup', function(event) {

    if (event.keyCode === 13 && !event.shiftKey) {
      messageForm.submit();
    }

  });

  messageForm.on('submit', function(event) {
    event.preventDefault();

    let object = $(this).serializeObject();
    let message = object.message;
    chatGroup.send(message).then(function(result) {
      console.log('message sent', result);
      messageForm[0].reset();
    }).catch(function(reason) {
      console.error('message error', reason);
    });

  });

  btnAdd.on('click', function (event) {
    event.preventDefault();

    let emailValue = addParticipantModal.find('.input-name').val();
    chatGroup.addParticipant(emailValue).then(function(result) {
      console.log('hyperty', result);
    }).catch(function(reason) {
      console.error(reason);
    });

  });

  btnCancel.on('click', function (event) {
    event.preventDefault();
  });

  addParticipantBtn.on('click', function (event) {
    event.preventDefault();
    addParticipantModal.openModal();
  });

}

function processMessage(message) {

  let chatSection = $('.chat-section');
  let messagesList = chatSection.find('.messages .collection');

  let list = `<li class="collection-item avatar">
    <img src="` + avatar + `" alt="" class="circle">
    <span class="title">` + message.from + `</span>
    <p>` + message.value.chatMessage.replace(/\n/g, '<br>') + `</p>
  </li>`;

  messagesList.append(list);
}

function addParticipant(participant) {

  let section = $('.conversations');
  let collection = section.find('.participant-list');
  let collectionItem = '<li class="chip" data-name="' + participant.hypertyResource + '"><img src="' + avatar + '" alt="Contact Person">' + participant.hypertyResource + '<i class="material-icons close">close</i></li>';

  collection.removeClass('center-align');
  collection.append(collectionItem);

  let closeBtn = collection.find('.close');
  closeBtn.on('click', function(e) {
    e.preventDefault();

    let item = $(e.currentTarget).parent().attr('data-name');
    removeParticipant(item);
  });
}

function removeParticipant(item) {
  let section = $('.conversations');
  let collection = section.find('.participant-list');
  let element = collection.find('li[data-name="' + item + '"]');
  element.remove();
}

Handlebars.getTemplate = function (name) {

  return new Promise(function (resolve, reject) {

    if (Handlebars.templates === undefined || Handlebars.templates[name] === undefined) {
      Handlebars.templates = {};
    } else {
      resolve(Handlebars.templates[name]);
    }

    $.ajax({
      url: 'templates/' + name + '.hbs',
      success: function (data) {
        Handlebars.templates[name] = Handlebars.compile(data);
        resolve(Handlebars.templates[name]);
      },

      fail: function (reason) {
        reject(reason);
      }
    });

  });

};
