!function(e){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=e();else if("function"==typeof define&&define.amd)define([],e);else{var n;n="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof self?self:this,(n.policiesGui||(n.policiesGui={})).bundle=e()}}(function(){return function e(n,i,t){function o(s,a){if(!i[s]){if(!n[s]){var u="function"==typeof require&&require;if(!a&&u)return u(s,!0);if(r)return r(s,!0);var l=new Error("Cannot find module '"+s+"'");throw l.code="MODULE_NOT_FOUND",l}var c=i[s]={exports:{}};n[s][0].call(c.exports,function(e){var i=n[s][1][e];return o(i?i:e)},c,c.exports,e,n,i,t)}return i[s].exports}for(var r="function"==typeof require&&require,s=0;s<t.length;s++)o(t[s]);return o}({1:[function(e,n,i){"use strict";function t(e,n){if(!(e instanceof n))throw new TypeError("Cannot call a class as a function")}var o=function(){function e(e,n){for(var i=0;i<n.length;i++){var t=n[i];t.enumerable=t.enumerable||!1,t.configurable=!0,"value"in t&&(t.writable=!0),Object.defineProperty(e,t.key,t)}}return function(n,i,t){return i&&e(n.prototype,i),t&&e(n,t),n}}();(function(){function e(){t(this,e)}return o(e,[{key:"PoliciesGUI",value:function(e){this.policyEngine=e}},{key:"showPoliciesGUI",value:function(){console.log("POLICY ENGINE @ show",this.policyEngine),$(".app").addClass("hide"),$(".identities-gui").addClass("hide"),$(".policies-gui").removeClass("hide"),$(".back").on("click",goHome),$(".new-user").on("click",showNewUserPanel),$(".add-user").on("click",addUser),$(".new-group").on(".click",showNewGroupPanel),$(".cancel-new-group").on("click",closeGroup),$(".add-group").on("click",addGroup),$(".close-new-group").on("click",closeGroupCreation),requestGroupsNames(),addGroupsListener(),addGroupMembersListener(),$(".time-new").on("click",showNewTimeRestrictionPanel),$(".time-allow").on("click",addTimeRestriction(!0)),$(".time-block").on("click",addTimeRestriction(!1)),$(".time-change-allow").on("click",changeTimeRestriction(!0)),$(".time-change-block").on("click",changeTimeRestriction(!1)),$(".time-cancel").on("click",cancelTimeDetails),$(".time-cancel-new").on("click",cancelNewTimeRestriction),requestTimeRestrictions(),addTimeListListener()}},{key:"goHome",value:function(){$(".app").removeClass("hide"),$(".policies-gui").addClass("hide")}},{key:"addGroupsListener",value:function(){document.getElementById("groupsList").addEventListener("click",function(e){var n=document.getElementById(e.target.id).id;requestGroup(n),document.getElementById("groupName").innerHTML=n})}},{key:"requestGroupsNames",value:function(){}},{key:"showGroupsNames",value:function(e){var n=document.getElementById("groupsList"),i=e.length;if(0===i)n.innerHTML="<p>There are no groups to display.</p>";else{n.innerHTML="";for(var t=0;i>t;t++){var o=document.createElement("a");o.className="collection-item",o.id=e[t],o.appendChild(document.createTextNode(e[t])),n.appendChild(o)}}}},{key:"requestGroup",value:function(e){}},{key:"showGroupMembers",value:function(e){$(".newGroup").addClass("hide"),$(".myGroups").addClass("hide");var n=document.getElementById("block");n.onclick=function(){var e=document.getElementById("groupName").innerText;$(".members").addClass("hide"),requestAddPolicy("group",e,!1),$(".newGroup").removeClass("hide"),$(".myGroups").removeClass("hide")};var i=document.getElementById("allow");i.onclick=function(){var e=document.getElementById("groupName").innerText;$(".members").addClass("hide"),requestAddPolicy("group",e,!0),$(".newGroup").removeClass("hide"),$(".myGroups").removeClass("hide")};var t=document.getElementById("delete");t.onclick=function(){var e=document.getElementById("groupName").innerText;$(".members").addClass("hide"),requestRemoveGroup(e),requestGroupsNames(),$(".newGroup").removeClass("hide"),$(".myGroups").removeClass("hide")};var o=$(".members");o.removeClass("hide");var r=document.getElementById("groupMembers");r.innerHTML="<ul id='groupMembers'></ul>";var s=e.length;if(0===s)r.innerHTML="<p>This groups has no members.</p>";else{for(var a=document.createElement("ul"),u=0;s>u;u++){var l=document.createElement("li");l.appendChild(document.createTextNode(e[u])),l.id=e[u];var c=document.createElement("button");c.className="waves-effect waves-light btn",c.id="member:"+e[u],c.innerHTML="Remove",c.type="button",l.appendChild(c),a.appendChild(l)}r.appendChild(a)}}},{key:"requestRemoveGroup",value:function(e){}},{key:"showNewGroupPanel",value:function(){$(".newGroupPanel").removeClass("hide"),$(".members").addClass("hide"),$("#newGroupName").val("")}},{key:"addGroup",value:function(){$(".newGroupPanel").addClass("hide");var e=$("#newGroupName").val();requestCreateGroup(e),requestGroupsNames()}},{key:"closeGroupCreation",value:function(){$(".newGroupPanel").addClass("hide")}},{key:"closeGroup",value:function(){$(".members").addClass("hide"),$(".myGroups").removeClass("hide"),$(".newGroup").removeClass("hide")}},{key:"requestCreateGroup",value:function(e){}},{key:"showNewUserPanel",value:function(){$(".newUser").removeClass("hide"),$("#newUserEmail").val("")}},{key:"addUser",value:function(){var e=$("#newUserEmail").val(),n=document.getElementById("groupName").innerText;requestAddUser(e,n),requestGroup(n),$(".newUser").addClass("hide")}},{key:"cancelUser",value:function(){$(".members").addClass("hide"),$(".newGroup").removeClass("hide")}},{key:"requestAddUser",value:function(e,n){}},{key:"requestAddPolicy",value:function(e,n,i){var t={};t="string"==typeof n?{id:[e,n].join("-"),scope:"user",condition:[e,n].join(" "),authorise:i,actions:[]}:{id:[e,n.join("-")].join("-"),scope:"user",condition:[e,n.join(" ")].join(" "),authorise:i,actions:[]}}},{key:"addGroupMembersListener",value:function(){document.getElementById("groupMembers").addEventListener("click",function(e){var n=document.getElementById(e.target.id).id.slice(7),i=document.getElementById("groupName").innerText;removeUserFromGroup(n,i),requestGroup(i)})}},{key:"removeUserFromGroup",value:function(e,n){}},{key:"requestTimeRestrictions",value:function(){}},{key:"addTimeListListener",value:function(){document.getElementById("timeRestrictionsList").addEventListener("click",function(e){var n=e.target.id,i=n.split("-");document.getElementById("timeslot").innerHTML="Time slot: from "+i[1]+" to "+i[2],requestTimeRestriction(n)})}},{key:"requestTimeRestriction",value:function(e){}},{key:"showTimeRestrictionsList",value:function(e){$(".showTimeRestrictions").removeClass("hide");var n=document.getElementById("timeRestrictionsList"),i=e.length;if(0===i)n.innerHTML="<p>There are no time restrictions set.<p>";else{n.innerHTML="";for(var t=0;i>t;t++){var o=e[t].split(" ");o.shift();var r=document.createElement("a");r.className="collection-item",r.id="time-"+o.join("-"),r.appendChild(document.createTextNode(o.join(" - "))),n.appendChild(r)}}}},{key:"showTimeRestriction",value:function(e){$(".showTimeRestrictions").addClass("hide"),$(".newRestriction").addClass("hide"),$(".newRestrictionPanel").addClass("hide"),$(".timeRestriction").removeClass("hide");var n=e.authorise?" are ":" are not ";document.getElementById("timeDetails").innerHTML="<p>You"+n+"available in this timeslot.</p>"}},{key:"requestRemoveTimeRestriction",value:function(e){}},{key:"showNewTimeRestrictionPanel",value:function(){$(".newRestrictionPanel").removeClass("hide"),$("#startTime").val(""),$("#endTime").val("")}},{key:"addTimeRestriction",value:function(e){$(".newRestrictionPanel").addClass("hide");var n=$("#startTime").val(),i=$("#endTime").val();requestAddPolicy("time",[n,i],e),requestTimeRestrictions()}},{key:"cancelNewTimeRestriction",value:function(){$(".showTimeRestrictions").removeClass("hide"),$(".newRestrictionPanel").addClass("hide")}},{key:"changeTimeRestriction",value:function(e){var n=document.getElementById("timeslot").innerText,i=n.split(" "),t="time-"+i[3]+"-"+i[5];requestChangeTimePolicy(t,e),cancelTimeDetails()}},{key:"requestChangeTimePolicy",value:function(e,n){}},{key:"cancelTimeDetails",value:function(){$(".timeRestriction").addClass("hide"),$(".showTimeRestrictions").removeClass("hide"),$("striction").removeClass("hide")}}]),e})()},{}]},{},[1])(1)});
//# sourceMappingURL=policies-gui.bundle.js.map
