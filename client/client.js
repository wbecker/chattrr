/*jslint white: true, onevar: true, undef: true, newcap: true, nomen: false, regexp: true, plusplus: true, bitwise: true, browser: true, maxerr: 5, maxlen: 80, indent: 2 */
/*global window, io, console*/
(function () {
  var myIp, port, userToken, startSockets, history = [], historyIndex = 0;
  myIp = window.__chattrrHost;
  port = window.__chattrrPort ? parseInt(window.__chattrrPort, 10) : 80;
  userToken = window.__userToken;
  startSockets = function () {
    var socket = new io.Socket(myIp, {port: port});
    socket.connect();
    socket.on('connect', function () {
      var connectMessage = {};
      connectMessage.url = document.URL;
      connectMessage.userToken = userToken;
      socket.send(JSON.stringify(connectMessage));
    });
    socket.on('message', function (messageRaw) { 
      var parent = document.getElementById("out"),
          holder = document.createElement("div"),
          message = JSON.parse(messageRaw),
          nameHolder = document.createElement("span"),
          timeHolder = document.createElement("span"),
          msgHolder = document.createElement("span");
      nameHolder.className = "chattrr_nameHolder";
      timeHolder.className = "chattrr_timeHolder";
      msgHolder.className = "chattrr_msgHolder";
      nameHolder.textContent = message.name;
      timeHolder.textContent = new Date(message.time).toLocaleTimeString();
      msgHolder.textContent = message.msg;
      holder.className = "chattrr_message";
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
            text = el.value,
            historyCountText,
            historyCountValue;
        if (text.match(/^set name:/)) {
          msg.name = text.substring(10).trim(); 
        }
        if (text.match(/^set history depth:/)) {
          historyCountText = text.substring(18).trim();
          if (historyCountText) {
            historyCountValue = parseInt(historyCountText, 10);
            if (!isNaN(historyCountValue)) {
              msg.historyCount = historyCountValue;
            }
          }
        }
        else {
          msg.msg = text;
        }
        history.push(msg);
        historyIndex = history.length;
        socket.send(JSON.stringify(msg));
        el.value = "";
        el.focus();
      };
      document.getElementById('send').addEventListener('click', send, false);
      document.getElementById("in").addEventListener("keydown",
        function (event) {
          var el = document.getElementById("in");
          if (event.keyCode === 38) {
            //up
            if (historyIndex > 0) {
              historyIndex -= 1;
              el.value = history[historyIndex].msg;
            }
          }
          else if (event.keyCode === 40) {
            //down
            if (historyIndex < history.length - 1) {
              historyIndex += 1;
              el.value = history[historyIndex].msg;
            }
          }
        }, false);
      document.getElementById("in").addEventListener("keypress",
        function (event) {
          if (event.which === 13) {
            send();
          }
        }, false);
    }());
  };
  (function () {
    var style, bodyStyle, chattrr, out, inputHolder, input, send;
    style = document.createElement("link");
    style.rel = "stylesheet";
    style.type = "text/css";
    style.href = "http://" + myIp + ":" + port + "/client.css";
    document.getElementsByTagName("head")[0].appendChild(style);
  
    chattrr = document.createElement("div");
    chattrr.id = "chattrr";
    document.body.appendChild(chattrr);
    
    bodyStyle = window.getComputedStyle(document.body, null);
    if (bodyStyle.marginLeft) {
      chattrr.style.marginLeft = "-" + bodyStyle.marginLeft;
    }
  
    out = document.createElement("div");
    out.id = "chattrr_out";
    chattrr.appendChild(out);
  
    inputHolder = document.createElement("div");
    inputHolder.id = "chattrr_inputHolder";
    chattrr.appendChild(inputHolder);

    input = document.createElement("input");
    input.type = "text";
    input.id = "chattrr_in";
    inputHolder.appendChild(input);
    
    send = document.createElement("input");
    send.type = "button";
    send.id = "chattrr_send";
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
}());
