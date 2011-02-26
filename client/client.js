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
/*global _, window, io */
(function () {
  var myIp, port, userToken, 
    sendButtonConnected = false,
    startSockets, socketHolder = {}, retryCount, retryTimeout,
    history = [], historyIndex = 0, 
    lostMessages = {}, messageIndex = 1,
    lastSetNameTime = 0, lastMessageTime = 0,
    originalMarginBottom, 
    f = {};
  myIp = window.__chattrrHost;
  port = window.__chattrrPort ? parseInt(window.__chattrrPort, 10) : 80;
  userToken = window.__userToken;
  f.messageReceived = function (messageRaw) { 
    var message = JSON.parse(messageRaw), topBarText;
    if (message.closing) {
      if (socketHolder.socket) {
        socketHolder.socket.disconnect();
      }
      if (retryTimeout) {
        clearInterval(retryTimeout);
      }
      retryTimeout = setInterval(startSockets, 2000);
      f.messageReceived(JSON.stringify({
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
    if (message.urls) {
      f.writePopularUrlsToDom(message);  
    }
    if (!message.msg) {
      return;
    }
    f.writeMessageToDom(message);
  };
  f.writePopularUrlsToDom = function (message) {
    var infoHolder = document.getElementById("chattrr_out_info_tablebody");
    while (infoHolder.hasChildNodes()) {
      infoHolder.removeChild(infoHolder.lastChild);
    }
    message.urls.forEach(function (urlInfo) {
      var line, url, users;
      line = document.createElement("tr");
      line.className = "chattrr_out_info_line";
      infoHolder.appendChild(line);

      users = document.createElement("td");
      users.className = "chattrr_out_info_line_users";
      line.appendChild(users);

      url = document.createElement("td");
      url.className = "chattrr_out_info_line_url";
      line.appendChild(url);

      users.textContent = urlInfo[1];
      url.textContent = urlInfo[0];
    });
  };
  f.writeMessageToDom = function (message) {
    var atBottom, parent, tbody, holder, nameHolder, idHolder, 
      timeHolder, msgHolder;
    parent = document.getElementById("chattrr_out_tableHolder");
    if (!parent) {
      //it's probably been closed
      return;
    }
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

    atBottom = (parent.scrollHeight - parent.clientHeight) <
      (parent.scrollTop + 5);

    tbody.appendChild(holder);
    holder.appendChild(nameHolder);
    holder.appendChild(idHolder);
    holder.appendChild(timeHolder);
    holder.appendChild(msgHolder);

    if (atBottom) {
      parent.scrollTop = parent.scrollHeight - parent.clientHeight;
    }
  };
  f.connectSendButton = function () {
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
      else if (text.match(/^\/nick /)) {
        f.grabName(msg, text.substring(6));
      }
      else if (text.match(/^\/quit/)) {
        f.closeWindow();
      }
      else if (text.match(/^set history depth:/)) {
        historyCountText = text.substring(18).trim();
        if (historyCountText) {
          historyCountValue = parseInt(historyCountText, 10);
          if (!isNaN(historyCountValue) && (historyCountValue >= 0)) {
            if (historyCountValue > 20) {
              historyCountValue = 20;
            }
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
      f.messageReceived(JSON.stringify({
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
      f.messageReceived(JSON.stringify({
        name: "chattrr",
        id: 0,
        time: new Date(),
        msg: "You can't send more than 1 message every second. Calm down!"
      }));
    }
  };
  f.closeWindow = function () {
    var chattrr = document.getElementById("chattrr");
    chattrr.parentNode.removeChild(chattrr);
    document.body.style.marginBottom = originalMarginBottom;
    if (socketHolder.socket) {
      socketHolder.socket.disconnect();
    }
    _(document.body.getElementsByTagName("script")).forEach(function (script) {
      if (script && 
        ((script.src.indexOf("underscore-min.js") > 0) ||
        (script.src.indexOf("client.js") > 0) ||
        (script.src.indexOf("socket.io/socket.io.js") > 0))) {
        script.parentNode.removeChild(script);
      }
    });
  };
  startSockets = function () {
    var tryReconnect, socket, connectionLost;
    f.messageReceived(JSON.stringify({
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
      f.connectSendButton();
    });
    socket.on('disconnect', function () { 
      connectionLost(2);
    });
    connectionLost = function (id) {
      if (socketHolder.socket) {
        delete socketHolder.socket;
      }
      f.messageReceived(JSON.stringify({
        name: "chattrr",
        id: 0,
        time: new Date(),
        msg: "Connection lost, attempting to reconnect... (" + id + ")"
      }));
      clearInterval(retryTimeout);
      retryTimeout = setInterval(tryReconnect, 2000);
    };
    socket.on('message', f.messageReceived);
  };
  (function () {
    var chattrrStyle, originalScrollTop, bodyStyle, chattrr, topBar, 
      topBarText; 
    chattrrStyle = document.createElement("link");
    chattrrStyle.rel = "stylesheet";
    chattrrStyle.type = "text/css";
    chattrrStyle.href = "http://" + myIp + ":" + port + "/client.css";
    document.getElementsByTagName("head")[0].appendChild(chattrrStyle);
  
    originalScrollTop = document.body.parentNode.scrollTop;

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
    topBarText.textContent = "Welcome to Chattrr";
    topBar.appendChild(topBarText);
  
    (function () {
      var out, outTableHolder, outTable, outTableBody, 
      infoTableHolder, infoTable, infoTableBody;

      out = document.createElement("div");
      out.id = "chattrr_out";
      chattrr.appendChild(out);

      outTableHolder = document.createElement("div");
      outTableHolder.id = "chattrr_out_tableHolder";
      out.appendChild(outTableHolder);
      
      outTable = document.createElement("table");
      outTable.id = "chattrr_out_table";
      outTable.cellSpacing = 0;
      outTable.cellPadding = 0;
      outTableHolder.appendChild(outTable);
  
      outTableBody = document.createElement("tbody");
      outTableBody.id = "chattrr_out_tablebody";
      outTable.appendChild(outTableBody);
  
      infoTableHolder = document.createElement("div");
      infoTableHolder.id = "chattrr_out_infoTableHolder";
      out.appendChild(infoTableHolder);

      infoTable = document.createElement("table");
      infoTable.id = "chattrr_out_infoTable";
      infoTable.cellSpacing = 0;
      infoTable.cellPadding = 0;
      infoTableHolder.appendChild(infoTable);
  
      infoTableBody = document.createElement("tbody");
      infoTableBody.id = "chattrr_out_info_tablebody";
      infoTable.appendChild(infoTableBody);
    }());
  
    (function () {
      var inputHolder, input, send;
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
      
      originalMarginBottom = bodyStyle.marginBottom;
      document.body.style.marginBottom += 15 * 15 + "px";
      
      input.focus();
    }());

    document.body.parentNode.scrollTop = originalScrollTop;
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
