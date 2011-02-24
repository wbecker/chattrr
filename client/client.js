/*
    Copyright 2011 William Becker

    This file is part of Chattrr.

    Chattrr is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    Chattrr is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with Chattrr.  If not, see <http://www.gnu.org/licenses/>.
*/

/*jslint white: true, onevar: true, undef: true, newcap: true, nomen: false, regexp: true, plusplus: true, bitwise: true, browser: true, maxerr: 5, maxlen: 80, indent: 2 */
/*global _, window, io, console*/
(function () {
  var myIp, port, userToken, 
    messageReceived, connectSendButton, sendButtonConnected = false,
    startSockets, socketHolder = {}, retryCount, retryTimeout,
    history = [], historyIndex = 0, 
    lostMessages = {}, messageIndex = 1,
    lastSetNameTime = 0, lastMessageTime = 0,
    f = {};
  myIp = window.__chattrrHost;
  port = window.__chattrrPort ? parseInt(window.__chattrrPort, 10) : 80;
  userToken = window.__userToken;
  messageReceived = function (messageRaw) { 
    console.debug(messageRaw);
    var message = JSON.parse(messageRaw),
        topBarText,
        parent, tbody, holder, nameHolder, idHolder, timeHolder, msgHolder;
    if (message.closing) {
      if (socketHolder.socket) {
        socketHolder.socket.disconnect();
      }
      if (retryTimeout) {
        clearInterval(retryTimeout);
      }
      retryTimeout = setInterval(startSockets, 2000);
      messageReceived(JSON.stringify({
        name: "chattrr",
        id: 0,
        time: new Date(),
        msg: "Server shutting down. We'll listen for it to come back again."
      }));
      return;
    }
    if (message.count) {
      topBarText = document.getElementById("chattrr_topBarText");
      topBarText.textContent = message.count + " Chattrrers lurking";
    }
    if (!message.msg) {
      return;
    }

    parent = document.getElementById("chattrr_out");
    tbody = document.getElementById("chattrr_out_tablebody");
    holder = document.createElement("tr");
    nameHolder = document.createElement("td");
    idHolder = document.createElement("td");
    timeHolder = document.createElement("td");
    msgHolder = document.createElement("td");
    if (lostMessages[message.seq]) {
      delete lostMessages[message.seq];
    }
    nameHolder.className = "chattrr_nameHolder";
    idHolder.className = "chattrr_idHolder";
    timeHolder.className = "chattrr_timeHolder";
    msgHolder.className = "chattrr_msgHolder";

    nameHolder.textContent = message.name;
    idHolder.textContent = message.id;
    timeHolder.textContent = new Date(message.time).toLocaleTimeString();
    msgHolder.textContent = message.msg;
    holder.className = "chattrr_message";
    tbody.appendChild(holder);
    holder.appendChild(nameHolder);
    holder.appendChild(idHolder);
    holder.appendChild(timeHolder);
    holder.appendChild(msgHolder);
    //the extra amount takes into account the extra height added 
    //by the box-shadow in firefox only (Chrome doesn't do it)
    parent.scrollTop = parent.scrollHeight - parent.offsetHeight - 
      ((navigator.userAgent.indexOf("Firefox") > 0) ? 15 : 0);
  };
  connectSendButton = function () {
    if (sendButtonConnected) {
      return;
    }
    sendButtonConnected = true;
    var send = function () {
      var el = document.getElementById('chattrr_in'),
          msg = {}, 
          text = el.value,
          historyCountText,
          historyCountValue,
          seq;
      if (text.match(/^set name:/)) {
        f.grabName(msg, text.substring(9));
      }
      else if (text.match(/^\\nick /)) {
        f.grabName(msg, text.substring(6));
      }
      if (text.match(/^set history depth:/)) {
        historyCountText = text.substring(18).trim();
        if (historyCountText) {
          historyCountValue = parseInt(historyCountText, 10);
          if (!isNaN(historyCountValue) && (historyCountValue >= 0)) {
            msg.historyCount = historyCountValue;
          }
        }
      }
      else {
        f.grabMessage(msg, text);
      }
      history.push(msg);
      historyIndex = history.length;
      seq = messageIndex;
      messageIndex += 1;
      msg.seq = seq;
      lostMessages[seq] = msg;
      if (socketHolder.socket && socketHolder.socket.connected) {
        socketHolder.socket.send(JSON.stringify(msg));
      }
      msg.msg = text;
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
  };
  f.grabName = function (msg, text) {
    var now = new Date().getTime();
    if (now - lastSetNameTime > 10000) {
      msg.name = text.trim().substring(0, 16);
      lastSetNameTime = now;
    }
    else {
      messageReceived(JSON.stringify({
        name: "chattrr",
        id: 0,
        time: new Date(),
        msg: "You can only set your name once every 10 seconds. Calm down!"
      }));
    }
  };
  f.grabMessage = function (msg, text) {
    var now = new Date().getTime();
    if (now - lastMessageTime > 1000) {
      msg.msg = text.substring(0, 200);
      lastMessageTime = now;
    }
    else {
      messageReceived(JSON.stringify({
        name: "chattrr",
        id: 0,
        time: new Date(),
        msg: "You can't send more than 1 message every second. Calm down!"
      }));
    }
  };
  startSockets = function () {
    var tryReconnect, socket, connectionLost;
    messageReceived(JSON.stringify({
      name: "chattrr",
      id: 0,
      time: new Date(),
      msg: "Initialising connection, please wait..."
    }));
    retryCount = 0;

    socket = new io.Socket(myIp, {port: port});
    tryReconnect = function () {
      if (retryCount >= 1) {
        if (retryTimeout) {
          clearInterval(retryTimeout);
        }
        socket.disconnect();
        startSockets();
      }
      else {
        retryCount += 1;
        socket.connect();
      }
    };
    tryReconnect();
    socket.on("connect_failed", function () {
      connectionLost(1);
    });
    socket.on('connect', function () {
      socketHolder.socket = socket;
      if (retryTimeout) {
        clearInterval(retryTimeout);
      }
      var connectMessage = {};
      connectMessage.url = document.location.host + document.location.pathname;
      connectMessage.userToken = userToken;
      socket.send(JSON.stringify(connectMessage));
      _(lostMessages).keys().sort().forEach(function (key) {
        socket.send(JSON.stringify(lostMessages[key]));
      });
      connectSendButton();
    });
    socket.on('disconnect', function () { 
      connectionLost(2);
    });
    connectionLost = function (id) {
      if (socketHolder.socket) {
        delete socketHolder.socket;
      }
      messageReceived(JSON.stringify({
        name: "chattrr",
        id: 0,
        time: new Date(),
        msg: "Connection lost, attempting to reconnect... (" + id + ")"
      }));
      clearInterval(retryTimeout);
      retryTimeout = setInterval(tryReconnect, 2000);
    };
    socket.on('message', messageReceived);
  };
  (function () {
    var style, bodyStyle, chattrr, topBar, topBarText, out, table, tableBody, 
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

    topBar = document.createElement("div");
    topBar.id = "chattrr_topBar";
    chattrr.appendChild(topBar);

    topBarText = document.createElement("span");
    topBarText.id = "chattrr_topBarText";
    topBar.appendChild(topBarText);

  
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
