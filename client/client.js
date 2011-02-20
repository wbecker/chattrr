/*jslint white: true, onevar: true, undef: true, newcap: true, nomen: false, regexp: true, plusplus: true, bitwise: true, browser: true, maxerr: 5, maxlen: 80, indent: 2 */
/*global _, window, io, console*/
(function () {
  var myIp, port, userToken, startSockets, 
    history = [], historyIndex = 0, 
    lostMessages = {}, messageIndex = 0;
  myIp = window.__chattrrHost;
  port = window.__chattrrPort ? parseInt(window.__chattrrPort, 10) : 80;
  userToken = window.__userToken;
  startSockets = function () {
    var tryReconnect, socket, messageReceived, tellConnectionLost;
    socket = new io.Socket(myIp, {port: port});
    tryReconnect = function () {
      socket.connect();
    };
    tryReconnect();
    socket.on("connect_failed", function () {
      setTimeout(tryReconnect, 1000);
      tellConnectionLost();
    });
    socket.on('connect', function () {
      var connectMessage = {};
      connectMessage.url = document.URL;
      connectMessage.userToken = userToken;
      socket.send(JSON.stringify(connectMessage));
      _(lostMessages).keys().sort().forEach(function (key) {
        socket.send(JSON.stringify(lostMessages[key]));
      });
    });
    socket.on('disconnect', function () { 
      setTimeout(tryReconnect, 1000);
      tellConnectionLost();
    });
    tellConnectionLost = function () {
      messageReceived(JSON.stringify({
        name: "chattrr",
        time: new Date(),
        msg: "Connection lost, attempting to reconnect..."
      }));
    };

    messageReceived = function (messageRaw) { 
      var parent = document.getElementById("chattrr_out"),
          tbody = document.getElementById("chattrr_out_tablebody"),
          holder = document.createElement("tr"),
          message = JSON.parse(messageRaw),
          nameHolder = document.createElement("td"),
          timeHolder = document.createElement("td"),
          msgHolder = document.createElement("td");
      if (lostMessages[message.seq]) {
        delete lostMessages[message.seq];
      }
      nameHolder.className = "chattrr_nameHolder";
      timeHolder.className = "chattrr_timeHolder";
      msgHolder.className = "chattrr_msgHolder";
      nameHolder.textContent = message.name;
      timeHolder.textContent = new Date(message.time).toLocaleTimeString();
      msgHolder.textContent = message.msg;
      holder.className = "chattrr_message";
      tbody.appendChild(holder);
      holder.appendChild(nameHolder);
      holder.appendChild(timeHolder);
      holder.appendChild(msgHolder);
      //the extra amount takes into account the extra height added 
      //by the box-shadow
      parent.scrollTop = parent.scrollHeight - parent.offsetHeight - 15;
    };
    socket.on('message', messageReceived);
  
    (function () {
      var send = function () {
        var el = document.getElementById('chattrr_in'),
            msg = {}, 
            text = el.value,
            historyCountText,
            historyCountValue,
            seq;
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
        seq = messageIndex;
        messageIndex += 1;
        msg.seq = seq;
        lostMessages[seq] = msg;
        if (socket.connected) {
          socket.send(JSON.stringify(msg));
        }
        el.value = "";
        el.focus();
      };
      document.getElementById('chattrr_send').addEventListener(
        'click', send, false);
      document.getElementById("chattrr_in").addEventListener("keydown",
        function (event) {
          var el = document.getElementById("chattrr_in");
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
      document.getElementById("chattrr_in").addEventListener("keypress",
        function (event) {
          if (event.which === 13) {
            send();
          }
        }, false);
    }());
  };
  (function () {
    var style, bodyStyle, chattrr, out, table, tableBody, 
      inputHolder, input, send;
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
    
    table = document.createElement("table");
    table.id = "chattrr_out_table";
    table.cellSpacing = 0;
    table.cellPadding = 0;
    out.appendChild(table);
    
    tableBody = document.createElement("tbody");
    tableBody.id = "chattrr_out_tablebody";
    table.appendChild(tableBody);
  
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
    var script, ensureLoaded, underscoreLoaded = false, socketsLoaded = false;
    ensureLoaded = function () {
      if (underscoreLoaded && socketsLoaded) {
        startSockets();
      }
    };
    script = document.createElement("script");
    script.src = "http://github.com/documentcloud/underscore/" +
      "raw/master/underscore-min.js";
    script.onload = function () {
      underscoreLoaded = true;
      ensureLoaded();
    };
    document.body.appendChild(script);

    script = document.createElement("script");
    script.src = "http://" + myIp + ":" + port + "/socket.io/socket.io.js";
    script.onload = function () {
      socketsLoaded = true;
      ensureLoaded();
    };
    document.body.appendChild(script);
  }());
}());
