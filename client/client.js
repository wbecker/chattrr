/*jslint white: true, onevar: true, undef: true, newcap: true, nomen: false, regexp: true, plusplus: true, bitwise: true, browser: true, maxerr: 5, maxlen: 80, indent: 2 */
/*global io, console*/

var startSockets = function () {
  var socket = new io.Socket();
  socket.connect();
  socket.on('connect', function () {});
  socket.on('message', function (message) { 
    var parent = document.getElementById("out"),
        holder = document.createElement("div");
    holder.className = "message";
    holder.textContent = message;
    parent.appendChild(holder);
    parent.scrollTop = parent.scrollHeight;
  });
  socket.on('disconnect', function () { 
    console.debug("disconnected", arguments); 
  });

  (function () {
    var send = function () {
      var el = document.getElementById('in'),
          text = el.value;
      socket.send(text);
      el.value = "";
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
  style.href = "client.css";
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
  script.src = "../../socket.io/socket.io.js";
  script.onload = startSockets;
  document.body.appendChild(script);
}());
