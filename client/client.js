/*jslint white: true, onevar: true, undef: true, newcap: true, nomen: false, regexp: true, plusplus: true, bitwise: true, browser: true, maxerr: 5, maxlen: 80, indent: 2 */
/*global io, console*/
var socket = new io.Socket();
socket.connect();
socket.on('connect', function () { 
});
socket.on('message', function (message) { 
  var parent = document.getElementById("out"),
      holder = document.createElement("div");
  holder.className = "message";
  holder.textContent = message;
  parent.appendChild(holder);
});
socket.on('disconnect', function () { 
  console.debug("disconnected", arguments); 
});

document.getElementById('send').addEventListener('click', 
  function () {
    var el = document.getElementById('in'),
        text = el.value;
    socket.send(text);
    el.value = "";
  }, false);

