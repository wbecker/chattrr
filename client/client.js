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
/*global _, window, io, linkify, Crypto */
(function () {
  var myIp, port, userToken, 
    haveBeenConnected = false,
    sendButtonConnected = false,
    currentPassword, justSetPasswordUsingExisting = false,
    startSockets, socketHolder = {}, retryCount, retryTimeout,
    history = [], historyIndex = 0, 
    lostMessages = {}, messageIndex = 1,
    lastSetNameTime = 0, lastMessageTime = 0,
    originalMarginBottom, closed,
    allowFlashing = true, titleFlashing = false, titleFlashingTimeout,
    defaultBoardUrlText = "<loading board name>", 
    boardUrl = defaultBoardUrlText,
    userId, justStarted = true, justStartedTimeout,
    passwordMode = false,
    f = {};
  myIp = window.__chattrrHost;
  port = window.__chattrrPort ? parseInt(window.__chattrrPort, 10) : 80;
  userToken = window.__userToken;
  f.showMessage = function (text) {
    f.messageReceived(JSON.stringify({
      name: "chattrr",
      id: 0,
      time: new Date().getTime(),
      msg: text
    }));
  };
  f.messageReceived = function (messageRaw) { 
    var message = JSON.parse(messageRaw);
    if (message.closing) {
      if (socketHolder.socket) {
        socketHolder.socket.disconnect();
      }
      if (retryTimeout) {
        clearInterval(retryTimeout);
      }
      retryTimeout = setInterval(startSockets, 2000);
      f.showMessage(
        "Server shutting down. We'll listen for it to come back again.");
      return;
    }
    if (message.passwordFailed) {
      if (currentPassword && !justSetPasswordUsingExisting) {
        f.sendConnectMessage(currentPassword);
        justSetPasswordUsingExisting = true;
      }
      else {
        f.promptForPassword();
      }
      return;
    }
    justSetPasswordUsingExisting = false;
    if (message.url) {
      boardUrl = message.url;
    }
    if (message.userId) {
      userId = message.userId;
      justStarted = true;
      if (justStartedTimeout) {
        clearTimeout(justStartedTimeout);
      }
      justStartedTimeout = setTimeout(function () {
        justStarted = false;
      }, 5000);
    }
    if (!_.isUndefined(message.flash)) {
      allowFlashing = message.flash === true;
    }
    if (message.language) {
      f.setLanguage(message);
    }
    if (message.count) {
      f.showLurkers(message);
    }
    if (message.urls) {
      f.writePopularUrlsToDom(message);  
    }
    if (message.users) {
      f.showUsers(message);
    }
    if (!message.msg) {
      return;
    }
    f.writeMessageToDom(message);
  };
  f.promptForPassword = function () {
    var messageField, parent, field;
    f.showMessage("Please enter your password");
    messageField = document.getElementById("chattrr_in");
    messageField.style.display = "none";
    
    parent = document.getElementById("chattrr_inputHolder");
    field = document.createElement("input");
    field.type = "password";
    field.id = "chattrr_in_password";
    parent.appendChild(field);
    //TODO: disconnect the send button
    field.addEventListener("keypress", function (event) {
      if (event.which === 13) {
        parent.removeChild(field);
        messageField.style.display = "";
        if (socketHolder.socket && socketHolder.socket.connected) {
          currentPassword = Crypto.SHA256(field.value);
          f.sendConnectMessage(currentPassword);
        }
        else {
          f.showMessage("Cannot send password while unconnected to chattrr.");
        }
        messageField.focus();
      }
    }, false);
    field.focus();
  };
  f.setLanguage = function (message) {
    var select, lang, options, option, i, ii;
    select = document.getElementById("chattrr_languageSelect");
    lang = message.language;
    options = select.options;
    for (i = 0, ii = options.length; i < ii; i += 1) {
      option = select.options[i];
      if (option.value === lang) {
        option.selected = true;
        break;
      }
    }
  };
  f.showLurkers = function (message) {
    var text, link, topBarText;
    topBarText = document.getElementById("chattrr_topBarText");
    while (topBarText.hasChildNodes()) {
      topBarText.removeChild(topBarText.lastChild);
    }
    text = document.createElement("span");
    text.textContent = message.count + " Chattrrers lurking on ";

    link = document.createElement("a");
    link.textContent = boardUrl;
    link.href = "http://" + myIp + ":" + port + "/log/" + 
      encodeURIComponent(boardUrl) + "?offset=0";
    link.target = "_blank";

    topBarText.appendChild(text);
    topBarText.appendChild(link);
  };
  f.showUsers = function (message) {
    var users, infoHolder;
    infoHolder = document.getElementById("chattrr_out_info_tablebody");
    while (infoHolder.hasChildNodes()) {
      infoHolder.removeChild(infoHolder.lastChild);
    }
    users = message.users;
    _.keys(users).forEach(function (name) {
      var line, url, link, nameCell, id;
      line = document.createElement("tr");
      line.className = "chattrr_out_info_line";
      infoHolder.appendChild(line);

      id = document.createElement("td");
      id.className = "chattrr_out_info_line_users";
      line.appendChild(id);

      nameCell = document.createElement("td");
      nameCell.className = "chattrr_out_info_line_url";
      line.appendChild(nameCell);
      
      id.textContent = users[name];
      nameCell.textContent = name;
    });
  };
  f.writePopularUrlsToDom = function (message) {
    var infoHolder = document.getElementById("chattrr_out_info_tablebody");
    while (infoHolder.hasChildNodes()) {
      infoHolder.removeChild(infoHolder.lastChild);
    }
    message.urls.forEach(function (urlInfo) {
      var line, url, link, users;
      line = document.createElement("tr");
      line.className = "chattrr_out_info_line";
      infoHolder.appendChild(line);

      users = document.createElement("td");
      users.className = "chattrr_out_info_line_users";
      line.appendChild(users);

      url = document.createElement("td");
      url.className = "chattrr_out_info_line_url";
      line.appendChild(url);
      
      link = document.createElement("a");
      link.className = "chattrr_out_info_line_urllink";
      url.appendChild(link);

      users.textContent = urlInfo[1];
      link.href = urlInfo[0];
      link.textContent = urlInfo[0];
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
    timeHolder.title = new Date(message.time).toLocaleDateString();
    f.assignMessage(msgHolder, message.msg);
    if (message.origMsg) {
      msgHolder.title = message.origMsg;
      msgHolder.className += " chattrr_translatedText";
    }
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
    if (!justStarted && (message.id !== 0) && (message.id !== userId)) {
      titleFlashing = true;
      f.flashTitle(false);
    }
  };
  f.assignMessage = function (msgHolder, msg) {
    linkify(msg, {callback: function (text, href) {
      var el;
      if (href) {
        el = document.createElement("a");
        el.href = href;
        el.target = "_blank";
        el.textContent = f.processLinkText(text);
        el.title = text;
      }
      else {
        el = document.createElement("span");
        el.textContent = text = f.processMessageText(text);
      }
      msgHolder.appendChild(el);
    }});
  };
  f.processLinkText = function (rawText) {
    var text;
    if (rawText.length > 30) {
      text = rawText.substring(0, 15) + "\u2026" + 
        rawText.substring(rawText.length - 15);
    }
    else {
      text = rawText;
    }
    return text;
  };
  f.processMessageText = function (rawText) {
    var text;
    text = rawText.split(' ').map(f.processMessageWord).join(' ');
    return text;
  };
  f.processMessageWord = function (word) {
    var res = "";
    while (word.length > 10) {
      if (word.length > 20) {
        res += word.substring(0, 10) + "\u200B";
        word = word.substring(10);
      }
      else {
        res += word;
        word = "";
      }
    }
    res += word;
    return res;
  };
  f.flashTitle = function (flashedOnce) {
    if (allowFlashing && titleFlashing && !titleFlashingTimeout) {
      titleFlashingTimeout = setTimeout(function () {
        titleFlashingTimeout = null;
        document.title = "*!" +
          (flashedOnce ? document.title.substring(2) : document.title);
        titleFlashingTimeout = setTimeout(function () {
          titleFlashingTimeout = null;
          document.title = "* " + document.title.substring(2);
          f.flashTitle(true);
        }, 1000);
      }, flashedOnce ? 1000 : (10 * 1000));
    }
    else if (!titleFlashing) {
      clearTimeout(titleFlashingTimeout);
      if ((document.title.substring(0, 2) === "*!") ||
          (document.title.substring(0, 2) === "* ")) {
        document.title = document.title.substring(2);
      }
    }
  };
  f.connectSendButton = function () {
    if (sendButtonConnected) {
      return;
    }
    sendButtonConnected = true;
    var send = function () {
      var el = document.getElementById("chattrr_in"),
          msg = {}, 
          text = el.value,
          seq,
          sendText = true,
          sendMessage = true;
      if (text.trim().length === 0) {
        return;
      }
      if (text.match(/^set name:/)) {
        sendText = false;
        f.grabName(msg, text.substring(9));
      }
      else if (text.match(/^\/nick /)) {
        sendText = false;
        f.grabName(msg, text.substring(6));
      }
      else if ((text.match(/^\/quit/)) || 
               (text.match(/^\/exit/)) || 
               (text.match(/^\/close/))) {
        f.closeWindow();
        return;
      }
      else if (text.match(/^\/clear/)) {
        f.clearHistory();
        sendMessage = false;
        sendText = false;
      }
      else if (text.match(/^\/reload/)) {
        f.reloadWindow();
        return;
      }
      else if (text.match(/^\/force/)) {
        f.forceUrl(msg);
        sendText = false;
      }
      else if (text.match(/^set history depth:/)) {
        sendText = false;
        f.grabDepth(msg, text.substring(18));
      }
      else if (text.match(/^\/depth/)) {
        sendText = false;
        f.grabDepth(msg, text.substring(7));
      }
      else if (text.match(/^\/help/)) {
        f.showHelp();
        sendMessage = false;
        sendText = false;
      }
      else if (text.match(/^\/users/)) {
        f.requestUsers(msg);
        sendText = false;
      }
      else if (text.match(/^\/minbs /)) {
        f.grabMinBoardSize(msg, text.substring(7));
        sendText = false;
      }
      else if (text.match(/^\/maxbs /)) {
        f.grabMaxBoardSize(msg, text.substring(7));
        sendText = false;
      }
      else if (text.match(/^\/flash /)) {
        f.grabFlash(msg, text.substring(7));
        sendText = false;
      }
      else if (text.match(/^\/password/)) {
        f.setPassword();
        el.value = "";
        msg.msg = text;
        history.push(msg);
        historyIndex = history.length;
        return;
      }
      else {
        f.grabMessage(msg, text);
      }
      if (sendText) {
        seq = messageIndex;
        messageIndex += 1;
        msg.seq = seq;
        msg.msg = text;
        lostMessages[seq] = msg;
      }
      history.push(msg);
      historyIndex = history.length;
      if (sendMessage) {
        if (socketHolder.socket && socketHolder.socket.connected) {
          socketHolder.socket.send(JSON.stringify(msg));
        }
      }
      if (!sendText) {
        msg.msg = text;
      }
      el.value = "";
      el.focus();
    };
    document.body.addEventListener("mousemove", function () {
      titleFlashing = false;
    }, false);
    document.getElementById("chattrr_send").addEventListener(
      "click", send, false);
    document.getElementById("chattrr_in").addEventListener("keydown",
      function (event) {
        var el = document.getElementById("chattrr_in");
        titleFlashing = false;
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
        event.stopPropagation();
      }, false);
    document.getElementById("chattrr_in").addEventListener("keyup",
      function (event) {
        event.stopPropagation();
      }, false);
    document.getElementById("chattrr_in").addEventListener("keypress",
      function (event) {
        if (event.which === 13) {
          send();
        }
        event.stopPropagation();
      }, false);
  };
  f.grabName = function (msg, text) {
    var now = new Date().getTime();
    if (now - lastSetNameTime > 10000) {
      msg.name = text.trim().substring(0, 16);
      lastSetNameTime = now;
    }
    else {
      f.showMessage(
        "You can only set your name once every 10 seconds. Calm down!");
    }
  };
  f.grabDepth = function (msg, text) {
    var historyCountText, historyCountValue;
    historyCountText = text.trim();
    if (historyCountText) {
      historyCountValue = parseInt(historyCountText, 10);
      if (!isNaN(historyCountValue) && (historyCountValue >= 0)) {
        if (historyCountValue > 20) {
          historyCountValue = 20;
        }
        msg.historyCount = historyCountValue;
      }
    }
  };
  f.showHelp = function () {
    f.showMessage("Welcome to chattrr, an in-place chat application!");
    f.showMessage("On the left is where the messages go. On the right, " +
      "you will see the most popular channels.");
    f.showMessage("When you load chattrr, it will talk on the current " +
      "url if there is enough activity. Otherwise it will keeping " +
      "going up a path, up to the host name, until it finds one where " +
      "there is sufficient activity. If there are not enough people " +
      "talking on the host, then you will talk on the common " +
      "'everybody' chattrr channel. You can override this behaviour " +
      "with the /force command (see below)");
    f.showMessage("Available commands:");
    f.showMessage("  1. '/nick <name>' - set your display name");
    f.showMessage("  2. '/depth: <numberOfLines>' - set how many lines " +
      "display when you reload, and shows that many rows right away.");
    f.showMessage("  3. '/quit' - closes chattrr, keeping your website " +
      "open");
    f.showMessage("  4. '/clear' - clear your message history");
    f.showMessage("  5. '/flash {on,off}' - turn title flashing on or off");
    f.showMessage("  6. '/password - set a password for your account");
    f.showMessage("  6. '/users - show who is on the channel");
    f.showMessage("  7. '/force' - forces chattrr to talk on the " +
      "current url, regardless of its activity");
    f.showMessage("  8. '/minbs <number>' - set the minimum board size - " +
      "when deciding which board to go to, don't go to boards with less " +
      "than this amount of people chatting.");
    f.showMessage("  9. '/maxbs <number>' - set the maximum board size - " +
      "when deciding which board to go to, start a new one rather than go " +
      "to a board with more than this amount of people.");
  };
  f.requestUsers = function (msg) {
    msg.showUsers = true;
  };
  f.grabMinBoardSize = function (msg, text) {
    var val = parseInt(text, 10);
    if (!isNaN(val) && (val > 0)) {
      msg.minbs = val;
    }
    else {
      f.showMessage(
        "Bad value for minimum board size - must be a positive integer");
    }
  };
  f.grabMaxBoardSize = function (msg, text) {
    var val = parseInt(text, 10);
    if (!isNaN(val) && (val > 0)) {
      msg.maxbs = val;
    }
    else {
      f.showMessage(
        "Bad value for maximum board size - must be a positive integer");
    }
  };
  f.grabFlash = function (msg, text) {
    if (text === "on") {
      msg.flash = true;
      allowFlashing = true;
    }
    else if (text === "off") {
      msg.flash = false;
      allowFlashing = false;
    }
    else {
      f.showMessage("Bad value for flash - useage: '/flash on'or '/flash off'");
    }
  };
  f.setPassword = function () {
    var oldPass, newPass1, newPass2, messageField;

    messageField = document.getElementById("chattrr_in");
    messageField.style.display = "none";

    oldPass = f.createPasswordField("chattrr_oldPass", "Old password");
    newPass1 = f.createPasswordField("chattrr_newPass1", "New password");
    newPass2 = f.createPasswordField("chattrr_newPass2", "Verify new password");

    newPass2[1].addEventListener("keyup", function (event) {
      if (event.which === 13) {
        var parent = document.getElementById("chattrr_inputHolder");
        parent.removeChild(oldPass[0]);
        parent.removeChild(newPass1[0]);
        parent.removeChild(newPass2[0]);
        messageField.style.display = "";
        
        if (newPass1[1].value === newPass2[1].value) {
          if (socketHolder.socket && socketHolder.socket.connected) {
            socketHolder.socket.send(JSON.stringify({
              password: (oldPass[1].value === "") ? "" :
                Crypto.SHA256(oldPass[1].value),
              newPassword: (newPass1[1].value === "") ? "" : 
                Crypto.SHA256(newPass1[1].value)
            }));
          }
          else {
            f.showMessage("Cannot set password while unconnected to chattrr.");
          }
        }
        else {
          f.showMessage("Passwords do not match");
        }
        messageField.focus();
      }
    }, false);

    passwordMode = true;
    oldPass[1].focus();
  };
  f.createPasswordField = function (id, text) {
    var passwordHolder, textHolder, field, keyListener;

    passwordHolder = document.createElement("div");
    passwordHolder.className = "chattrr_passwordHolder";
    document.getElementById("chattrr_inputHolder").appendChild(passwordHolder);

    textHolder = document.createElement("span");
    textHolder.textContent = text;
    passwordHolder.appendChild(textHolder);

    field = document.createElement("input");
    field.type = "password";
    field.id = id;

    keyListener = function () {
      textHolder.style.display = (field.value.length > 0) ? "none" : "";
    };
    field.addEventListener("keypress", keyListener, false);
    field.addEventListener("keyup", keyListener, false);
    passwordHolder.appendChild(field);

    return [passwordHolder, field];
  };

  f.grabMessage = function (msg, text) {
    var now = new Date().getTime();
    if (now - lastMessageTime > 600) {
      msg.msg = text.substring(0, 200);
      lastMessageTime = now;
    }
    else {
      f.showMessage(
        "You can't send more than 2 messages every second. Calm down!");
    }
  };
  f.closeWindow = function () {
    var chattrr = document.getElementById("chattrr");
    chattrr.parentNode.removeChild(chattrr);
    document.body.style.marginBottom = originalMarginBottom;
    closed = true;
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
  f.clearHistory = function () {
    var tableBody = document.getElementById("chattrr_out_tablebody");
    while (tableBody.hasChildNodes()) {
      tableBody.removeChild(tableBody.lastChild);
    }
  };
  f.reloadWindow = function () {
    var script;
    f.closeWindow();
    script = document.createElement("script");
    script.src = "http://" + myIp + ":" + port + "/client.js";
    document.body.appendChild(script);
  };
  f.forceUrl = function (msg) {
    msg.forceUrl = true;
    msg.url = f.createUrl();
    boardUrl = msg.url;
  };
  f.createUrl = function () {
    var loc = document.location;
    return loc.protocol + "//" + loc.host + loc.pathname;
  };
  startSockets = function () {
    var tryReconnect, socket, connectionLost;
    f.showMessage("Initialising connection, please wait...");
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
    socket.on("connect", function () {
      socketHolder.socket = socket;
      if (retryTimeout) {
        clearInterval(retryTimeout);
      }
      f.sendConnectMessage();
      f.connectSendButton();
      haveBeenConnected = true;
    });
    socket.on("disconnect", function () { 
      connectionLost(2);
    });
    connectionLost = function (id) {
      if (closed) {
        return;
      }
      if (socketHolder.socket) {
        delete socketHolder.socket;
      }
      f.showMessage(
        "Connection lost, attempting to reconnect... (" + id + ")");
      clearInterval(retryTimeout);
      retryTimeout = setInterval(tryReconnect, 2000);
    };
    socket.on("message", f.messageReceived);
  };
  f.sendConnectMessage = function (password) {
    var connectMessage = {};
    if (haveBeenConnected && (boardUrl !== defaultBoardUrlText)) {
      connectMessage.url = boardUrl;
      connectMessage.forceUrl = true;
    }
    else {
      connectMessage.url = f.createUrl();
    }
    if (password) {
      connectMessage.password = password;
    }
    connectMessage.userToken = userToken;
    if (socketHolder.socket) {
      socketHolder.socket.send(JSON.stringify(connectMessage));
      _(lostMessages).keys().sort().forEach(function (key) {
        socketHolder.socket.send(JSON.stringify(lostMessages[key]));
      });
    }
  };
  f.selectLanguage = function (event) {
    var select = event.target, 
      value = select.options[select.selectedIndex].value;
    if (socketHolder.socket) {
      socketHolder.socket.send(JSON.stringify({
        language: value
      }));
    }
  };
  (function () {
    var chattrrStyle, originalScrollTop, bodyStyle, chattrr; 
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

    (function () {
      var topBar, logoText, logoTextLink, topBarText, urlsText, 
        languages, topBarLanguage, languageSelect, name, option,
        showUsers, userClick; 
      topBar = document.createElement("div");
      topBar.id = "chattrr_topBar";
      chattrr.appendChild(topBar);
  
      logoText = document.createElement("span");
      logoText.id = "chattrr_logo";
      topBar.appendChild(logoText);

      logoTextLink = document.createElement("a");
      logoTextLink.id = "chattrr_logolink";
      logoTextLink.href = "http://chattrr.net";
      logoTextLink.target = "_blank";
      logoTextLink.textContent = "Chattrr";
      logoText.appendChild(logoTextLink);

      topBarText = document.createElement("span");
      topBarText.id = "chattrr_topBarText";
      topBarText.textContent = "Welcome to Chattrr";
      topBar.appendChild(topBarText);

      languages = {
        LITERAL_TEXT: "none",
        AFRIKAANS: "af", 
        ALBANIAN: "sq", 
        //AMHARIC: "am", 
        //ARABIC: "ar", 
        //ARMENIAN: "hy", 
        //AZERBAIJANI: "az", 
        //BASQUE: "eu", 
        BELARUSIAN: "be",
        //BENGALI: "bn", 
        //BIHARI: "bh", 
        BULGARIAN: "bg", 
        //BURMESE: "my", 
        //BRETON:  "br", 
        CATALAN: "ca", 
        //CHEROKEE: "chr", 
        CHINESE: "zh", 
        CHINESE_SIMPLIFIED: "zh-CN", 
        CHINESE_TRADITIONAL: "zh-TW",
        //CORSICAN: "co", 
        CROATIAN: "hr", 
        CZECH: "cs", 
        DANISH: "da",
        //DHIVEHI: "dv", 
        DUTCH: "nl", 
        ENGLISH: "en", 
        //ESPERANTO: "eo",
        ESTONIAN: "et", 
        FAROESE: "fo", 
        //FILIPINO: "tl", 
        FINNISH: "fi",
        FRENCH: "fr", 
        //FRISIAN: "fy", 
        GALICIAN: "gl", 
        //GEORGIAN: "ka", 
        GERMAN: "de", 
        GREEK: "el", 
        //GUJARATI: "gu", 
        HAITIAN_CREOLE: "ht", 
        HEBREW: "iw", 
        HINDI: "hi", 
        HUNGARIAN: "hu", 
        ICELANDIC: "is", 
        INDONESIAN: "id", 
        //INUKTITUT: "iu", 
        IRISH: "ga", 
        ITALIAN: "it", 
        JAPANESE: "ja", 
        //JAVANESE: "jw", 
        //KANNADA: "kn", 
        //KAZAKH: "kk", 
        //KHMER: "km", 
        KOREAN: "ko", 
        //KURDISH: "ku", 
        //KYRGYZ: "ky", 
        //LAO: "lo", 
        //LAOTHIAN: "lo", 
        //LATIN: "la", 
        LATVIAN: "lv", 
        LITHUANIAN: "lt", 
        //LUXEMBOURGISH: "lb", 
        MACEDONIAN: "mk", 
        MALAY: "ms", 
        //MALAYALAM: "ml", 
        MALTESE: "mt", 
        //MAORI: "mi", 
        //MARATHI: "mr", 
        //MONGOLIAN: "mn", 
        //NEPALI: "ne", 
        NORWEGIAN: "no", 
        //OCCITAN: "oc", 
        //ORIYA: "or", 
        //PASHTO: "ps", 
        PERSIAN: "fa",  
        POLISH: "pl", 
        PORTUGUESE: "pt", 
        PORTUGUESE_PORTUGAL: "pt-PT", 
        //PUNJABI: "pa", 
        //QUECHUA: "qu", 
        ROMANIAN: "ro", 
        RUSSIAN: "ru", 
        //SANSKRIT: "sa", 
        //SCOTS_GAELIC: "gd", 
        SERBIAN: "sr", 
        //SINDHI: "sd", 
        //SINHALESE: "si", 
        SLOVAK: "sk", 
        //SLOVENIAN: "sl", 
        SPANISH: "es", 
        //SUNDANESE: "su", 
        SWAHILI: "sw", 
        SWEDISH: "sv", 
        //SYRIAC: "syr", 
        //TAJIK: "tg", 
        //TAMIL: "ta", 
        TAGALOG: "tl", 
        //TATAR: "tt", 
        //TELUGU: "te", 
        THAI: "th", 
        //TIBETAN: "bo", 
        //TONGA: "to",
        TURKISH: "tr",
        UKRAINIAN: "uk",
        //URDU: "ur", 
        //UZBEK: "uz", 
        //UIGHUR: "ug", 
        VIETNAMESE: "vi", 
        WELSH: "cy",
        YIDDISH: "yi"
        //YORUBA: "yo"
      }; 
      
      topBarLanguage = document.createElement("span");
      topBarLanguage.id = "chattrr_language";
      topBarLanguage.textContent = "Chatting in";
      topBar.appendChild(topBarLanguage);

      languageSelect = document.createElement("select");
      languageSelect.id = "chattrr_languageSelect"; 
      topBarLanguage.appendChild(languageSelect);
      for (name in languages) {
        if (languages.hasOwnProperty(name)) {
          option = document.createElement("option");
          option.value = languages[name];
          option.textContent = name.substring(0, 1) + 
            name.substring(1).toLowerCase().replace("_", " ");
          if (languages[name] === "none") {
            option.selected = true;
          }
          languageSelect.appendChild(option);
        }
      }
      languageSelect.addEventListener("change", f.selectLanguage, false);
      urlsText = document.createElement("span");
      urlsText.id = "chattrr_topBarUrls";
      urlsText.textContent = "Top chattrrs";
      topBar.appendChild(urlsText);

      showUsers = document.createElement("span");
      showUsers.id = "chattrr_topBarShowUsers";
      topBar.appendChild(showUsers);

      userClick = document.createElement("a");
      userClick.textContent = "Show Users";
      userClick.addEventListener("click", function () {
        if (socketHolder.socket && socketHolder.socket.connected) {
          socketHolder.socket.send(JSON.stringify({showUsers: true}));
        }
      }, false);
      showUsers.appendChild(userClick);
    }());
  
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
      var inputHolder, inputArea, input, send;
      inputHolder = document.createElement("div");
      inputHolder.id = "chattrr_inputHolder";
      chattrr.appendChild(inputHolder);

      inputArea = document.createElement("div");
      inputArea.id = "chattrr_inputArea";
      inputHolder.appendChild(inputArea);
  
      input = document.createElement("input");
      input.type = "text";
      input.id = "chattrr_in";
      inputArea.appendChild(input);
      
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
    var script, ensureLoaded, 
      underscoreLoaded = false, 
      linkifyLoaded = false, 
      hashLoaded = false,
      socketsLoaded = false;
    ensureLoaded = function () {
      if (linkifyLoaded && underscoreLoaded && hashLoaded && socketsLoaded) {
        closed = false;
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
    script.src = "https://github.com/cowboy/javascript-linkify/" +
      "raw/master/ba-linkify.js";
    script.onload = function () {
      linkifyLoaded = true;
      ensureLoaded();
    };
    document.body.appendChild(script);

    script = document.createElement("script");
    script.src = "http://crypto-js.googlecode.com/files/2.0.0-crypto-sha256.js";
    script.onload = function () {
      hashLoaded = true;
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
