!function(e){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=e();else if("function"==typeof define&&define.amd)define([],e);else{var t;t="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof self?self:this,t.identitiesGui=e()}}(function(){return function e(t,n,i){function o(a,l){if(!n[a]){if(!t[a]){var c="function"==typeof require&&require;if(!l&&c)return c(a,!0);if(r)return r(a,!0);var d=new Error("Cannot find module '"+a+"'");throw d.code="MODULE_NOT_FOUND",d}var u=n[a]={exports:{}};t[a][0].call(u.exports,function(e){var n=t[a][1][e];return o(n?n:e)},u,u.exports,e,t,n,i)}return n[a].exports}for(var r="function"==typeof require&&require,a=0;a<i.length;a++)o(i[a]);return o}({1:[function(e,t,n){"use strict";function i(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}Object.defineProperty(n,"__esModule",{value:!0});var o=function(){function e(e,t){for(var n=0;n<t.length;n++){var i=t[n];i.enumerable=i.enumerable||!1,i.configurable=!0,"value"in i&&(i.writable=!0),Object.defineProperty(e,i.key,i)}}return function(t,n,i){return n&&e(t.prototype,n),i&&e(t,i),t}}(),r=function(){function e(t){if(i(this,e),!t)throw Error("Identity Module not set!");var n=this;n.identityModule=t,console.log(n.identityModule),$(".identities-btn").on("click",function(){n.showIdentitiesGUI()})}return o(e,[{key:"showIdentitiesGUI",value:function(){var e=this;$(".policies-gui").addClass("hide"),$(".identities-gui").removeClass("hide"),e.showMyIdentities(),e.showCurrentID(),$(".idp").on("click",function(t){return e.obtainNewIdentity()}),$(".back").on("click",function(t){return e.goHome()})}},{key:"goHome",value:function(){$(".policies-gui").addClass("hide"),$(".identities-gui").addClass("hide")}},{key:"showCurrentID",value:function(){var e={email:"user10@gmail.com",domain:"google.com"};$(".current-id").html("<b>Current identity: </b>"+e.email+" from "+e.domain)}},{key:"showMyIdentities",value:function(){var e=this,t=[{email:"user10@gmail.com",domain:"google.com"},{email:"camila@orange.fr",domain:"orange.fr"},{email:"user20@gmail.com",domain:"facebook.com"}],n=document.getElementById("my-ids");n.innerHTML="";for(var i=e.createTable(),o=document.createElement("tbody"),r=t.length,a=0;r>a;a++){var l=e.createTableRow(t[a]);o.appendChild(l)}i.appendChild(o),n.appendChild(i),$(".clickable-cell").on("click",function(t){return e.changeID()}),$(".remove-id").on("click",function(t){return e.removeID()})}},{key:"createTable",value:function(){var e=document.createElement("table");e.className="centered";var t=document.createElement("thead"),n=document.createElement("tr"),i=document.createElement("th");i.textContent="Email",n.appendChild(i);var o=document.createElement("th");return o.textContent="Domain",n.appendChild(o),t.appendChild(n),e.appendChild(t),e}},{key:"createTableRow",value:function(e){var t=document.createElement("tr"),n=document.createElement("td");n.textContent=e.email,n.className="clickable-cell",n.style="cursor: pointer",t.appendChild(n),n=document.createElement("td"),n.textContent=e.domain,n.className="clickable-cell",n.style="cursor: pointer",t.appendChild(n),n=document.createElement("td");var i=document.createElement("button");return i.textContent="Remove",i.className="remove-id waves-effect waves-light btn",n.appendChild(i),t.appendChild(n),t}},{key:"changeID",value:function(){var e=this;console.log(event);var t=(event.target.innerText,event.target.parentNode.children[1].innerText);console.log(t),Materialize.toast("Identity succesfuly changed!",2e3),e.showCurrentID()}},{key:"removeID",value:function(){var e=this;console.log(event);for(var t=event.target.parentNode.parentNode,n=t.children[0].textContent,i=(t.children[1].textContent,identities.length),o=0;i>o;o++)if(identities[o].email===n){identities.splice(o,1);break}e.showMyIdentities(),Materialize.toast("Identity succesfuly deleted!",2e3)}},{key:"obtainNewIdentity",value:function(){var e=event.target.id;console.log(e)}},{key:"showPopUp",value:function(e){}}]),e}();n["default"]=r},{}]},{},[1])(1)});
//# sourceMappingURL=identities-gui.js.map
