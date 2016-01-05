window.onload = ()=>loadHyperties()

var hypertiesList = ['hyperty-catalogue://ua.pt/HelloHyperty'];

function errorMessage(reason) {
  console.log(reason);
}

function deployedHyperties(hyperty, result) {

  var hypertyName = hyperty.substr(hyperty.lastIndexOf('/') + 1);
  var hypertyEl = document.querySelector('.' + hypertyName);

  hypertyEl.querySelector('.status').innerHTML = result.status;
  hypertyEl.querySelector('.name').innerHTML = hypertyName;
  hypertyEl.querySelector('.runtime-hyperty-url').innerHTML = result.hypertyCode.hypertyURL;
  hypertyEl.querySelector('.form').setAttribute('data-url', result.hypertyCode.hypertyURL);
  hypertyEl.querySelector('.send').addEventListener('click', function(e) {

    var target = e.target;
    var form = target.parentElement.parentElement;
    var fromHyperty = form.getAttribute('data-url');
    var toHyperty = form.querySelector('.toHyperty').value;
    var messageHypert = form.querySelector('.messageHyperty').value;

    if (fromHyperty && toHyperty && messageHypert) {
      sendMessage(fromHyperty, toHyperty, messageHypert);
      result.hypertyCode.sendMessage(toHyperty, messageHypert);
    }

    //form.reset();

    e.preventDefault();
  });

  result.hypertyCode.onMessage = newMessageRecived;
};

function newMessageRecived(msg) {

  var fromHyperty = msg.from;
  var toHyperty = msg.to;

  var elTo = document.querySelector('form[data-url="' + toHyperty + '"]');

  if (msg.body.hasOwnProperty('value') && msg.body.value.length) {
    var listTo = elTo.parentElement.querySelector('.list');
    var itemTo = document.createElement('li');

    itemTo.setAttribute('class', 'collection-item avatar right-align');
    itemTo.innerHTML = '<i class="material-icons circle green">call_received</i><label class="name title">' + fromHyperty + '</label><p class="message">' + msg.body.value.replace(/\n/g, '<br>') + '</p>';

    listTo.appendChild(itemTo);
  }

}

function sendMessage(from, to, message) {
  var form = document.querySelector('form[data-url="' + from + '"]');
  if (form) {
    var listFrom = form.parentElement.querySelector('.list');
    var itemFrom = document.createElement('li');
    itemFrom.setAttribute('class', 'collection-item avatar');
    itemFrom.innerHTML = '<i class="material-icons circle yellow">call_made</i><label class="name title">' + to + '</label><p class="message">' + message.replace(/\n/g, '<br>') + '</p>';

    listFrom.appendChild(itemFrom);
  }
}

function loadHyperties() {

  var time = 1;

  hypertiesList.forEach(function(hyperty) {

    setTimeout(function() {

      // Load First Hyperty
      window.rethink.requireHyperty(hyperty).then(function(result) {
        deployedHyperties(hyperty, result);
      }).catch(function(reason) {
        errorMessage(reason);
      });
    }, (100 * time));

    time++;

  });

}
