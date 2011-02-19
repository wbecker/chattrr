/*jslint white: true, onevar: true, undef: true, newcap: true, nomen: false, regexp: true, plusplus: true, bitwise: true, browser: true, maxerr: 5, maxlen: 80, indent: 2 */
/*global window, io, console*/
var myIp = window.__chattrHost;
var port = window.__chattrPort ? parseInt(window.__chattrPort, 10) : 80;
var userToken = window.__userToken;
var startSockets = function () {
  var socket = new io.Socket(myIp, {port: port});
  socket.connect();
  socket.on('connect', function () {
    var connectMessage = {};
    connectMessage.url = document.URL;
    if (userToken) {
      connectMessage.userToken = userToken;
    }
    socket.send(JSON.stringify(connectMessage));
  });
  socket.on('message', function (messageRaw) { 
    var parent = document.getElementById("out"),
        holder = document.createElement("div"),
        message = JSON.parse(messageRaw),
        nameHolder = document.createElement("span"),
        timeHolder = document.createElement("span"),
        msgHolder = document.createElement("span");
    nameHolder.className = "nameHolder";
    timeHolder.className = "timeHolder";
    msgHolder.className = "msgHolder";
    nameHolder.textContent = message.name;
    timeHolder.textContent = new Date(message.time).toLocaleTimeString();
    msgHolder.textContent = message.msg;
    holder.className = "message";
    parent.appendChild(holder);
    holder.appendChild(nameHolder);
    holder.appendChild(timeHolder);
    holder.appendChild(msgHolder);
    parent.scrollTop = parent.scrollHeight;
  });
  socket.on('disconnect', function () { 
    console.debug("disconnected", arguments); 
  });

  (function () {
    var send = function () {
      var el = document.getElementById('in'),
          msg = {}, 
          text = el.value;
      if (text.match(/^set name:/)) {
        msg.name = text.substring(10).trim(); 
      }
      else {
        msg.msg = text;
      }
      socket.send(JSON.stringify(msg));
      el.value = "";
      el.focus();
    };
    document.getElementById('send').addEventListener('click', send, false);
    document.getElementById("in").addEventListener("keypress",
      function (event) {
        if (event.which === 13) {
          send();
        }
      }, false);
  }());
};
(function () {
  var style, chattr, out, inputHolder, input, send;
  style = document.createElement("link");
  style.rel = "stylesheet";
  style.type = "text/css";
  style.href = "http://" + myIp + ":" + port + "/client.css";
  document.getElementsByTagName("head")[0].appendChild(style);

  chattr = document.createElement("div");
  chattr.id = "chattr";
  document.body.appendChild(chattr);

  out = document.createElement("div");
  out.id = "out";
  chattr.appendChild(out);

  inputHolder = document.createElement("div");
  inputHolder.id = "inputHolder";
  chattr.appendChild(inputHolder);

  input = document.createElement("input");
  input.type = "text";
  input.id = "in";
  inputHolder.appendChild(input);
  
  send = document.createElement("input");
  send.type = "button";
  send.id = "send";
  send.value = "Send";
  inputHolder.appendChild(send);
  input.focus();
}());

(function () {
  var script = document.createElement("script");
  script.src = "http://" + myIp + ":" + port + "/socket.io/socket.io.js";
  script.onload = startSockets;
  document.body.appendChild(script);
}());
