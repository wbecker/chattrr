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

/*jslint white: true, onevar: true, undef: true, newcap: true, nomen: false, regexp: true, plusplus: true, bitwise: true, maxerr: 5, maxlen: 80, indent: 2 */
/*global require, setInterval, clearInterval, process */

(function () {
  var http = require("http"), 
      urlLib = require("url"),
      fs = require("fs"),
      util = require("util"),
      io, redis, hash, _, logs, express,
      db, server, socket, clients = {}, 
      bgsavesInterval, sendRegularInfoInterval, popularCount,
      bgsavesIntervalObj, sendRegularInfoIntervalObj,
      logInfoToConsole, logErrorsToConsole,
      minBoardSize, maxBoardSize, serverPort, everyoneUrl, serverName,
      anonymousName,
      start, f = {};
  f.bgsaves = function () {
    db.bgsave();
  };
  f.sendRegularInfo = function () {
    db.get(f.getNextUrlIdVar(), function (err, maxUrlId) {
      var urlId, membersByUrlId, getUrls, memberAssigner;
      getUrls = db.multi();
      membersByUrlId = {};
      memberAssigner = function (urlId) {
        return function (err, members) {
          membersByUrlId[urlId] = members;
        };
      };
      for (urlId = 1; urlId <= maxUrlId; urlId += 1) {
        getUrls.smembers(f.getUrlMembersVar(urlId), memberAssigner(urlId));
      }
      getUrls.exec(function () {
        var urlId, clientCount, urlMessage, 
        getUrls, urlsBySize, urlsBySizeNames;
        urlsBySize = _(membersByUrlId).keys();
        urlsBySize = _(urlsBySize).select(function (urlId) {
          return membersByUrlId[urlId].length > 0;
        });
        urlsBySize = _(urlsBySize).sortBy(function (urlId) {
          return -membersByUrlId[urlId].length;
        });
        urlsBySize = _(urlsBySize).first(popularCount);
        urlsBySizeNames = new Array(urlsBySize.length);
        getUrls = db.multi();
        urlsBySize.forEach(function (urlId, index) {
          getUrls.get(f.getUrlForUrlIdVar(urlId), _(function (index, err, url) {
            urlsBySizeNames[index] = url;
          }).bind(this, index));
        });
        getUrls.exec(function () {
          var clientId, client, clientIndex, 
            getUrlSize, memberStats, urlNamesOrdered;
          memberStats = {};
          getUrlSize = function (urlId) {
            return membersByUrlId[urlId].length;
          };
          for (urlId = 1; urlId <= maxUrlId; urlId += 1) {
            clientCount = membersByUrlId[urlId].length;
            memberStats[urlId] = {
              count: clientCount,
              urls: _.zip(urlsBySizeNames, _(urlsBySize).map(getUrlSize))
            };
          }
          for (urlId = 1; urlId <= maxUrlId; urlId += 1) {
            clientCount = membersByUrlId[urlId].length;
            urlMessage = JSON.stringify(memberStats[urlId]);
            for (clientIndex = 0; clientIndex < clientCount; clientIndex += 1) {
              clientId = membersByUrlId[urlId][clientIndex];
              client = clients[clientId];
              if (client) {
                client.send(urlMessage);
              }
              else {
                f.removeClient({sessionId: clientId});
              }
            }
          }
        });
      });
    });
  };
  f.initLogging = function () {
    var now = new Date(),
        pad = function (x) {
          if (x < 10) {
            return "0" + x.toString();
          }
          return x.toString();
        };

    logs.add(logs.transports.File, {
      filename: "logs/chattrr_" +
        now.getUTCFullYear() + "-" +
        pad(now.getUTCMonth() + 1) + "-" +
        pad(now.getUTCDate()) + "_" +
        pad(now.getUTCHours()) + ":" +
        pad(now.getUTCMinutes()) + ":" +
        pad(now.getUTCSeconds()) + ".log",
      level: "info"
    });
    if (!logInfoToConsole) {
      logs.remove(logs.transports.Console);
      if (logErrorsToConsole) {
        logs.add(logs.transports.Console, {
          level: "error"
        });
      }
    }
  };
  f.addProcessHandlers = function () {
    process.on("exit", f.handleExit);
    process.on("SIGINT", function () {
      process.exit();
    });
    process.on("uncaughtException", function (err) {
      logs.error(err);
    });
  };
  f.handleExit = function () {
    logs.info("Shutting down...");
    clearInterval(bgsavesIntervalObj);
    clearInterval(sendRegularInfoIntervalObj);
    if (socket) {
      _(socket.clients).values().forEach(function (client) {
        client.send(JSON.stringify({closing: true}));
      });
    }
    (function () {
      try {
        server.close();
        logs.info("Server shutdown cleanly.");
      }
      catch (e) {
        logs.error("Problem closing server");
        logs.error(e);
      }
    }());
    (function () {
      try {
        db.save();
        logs.info("Database saved.");
      }
      catch (e) {
        logs.error("Problem closing database");
        logs.error(e);
      }
    }());
    logs.info("Shutdown complete");
  };
  f.createServer = function () {
    server = express.createServer();
    server.configure(function () {
      server.use(express.staticProvider("client"));
    });
    server.get("/", function (req, res) {
      var url = req.url;
      if (url === "/") {
        url += "client.htm";
        res.redirect("/client.htm?userToken=" + 
          hash.md5(Math.random().toString()));
      }
    });

    server.listen(serverPort);
    socket = io.listen(server, {
      log: logs.info
    });
    socket.on("connection", f.createConnection);
  };
  f.createConnection = function (client) {
    var address = client.connection.address();
    clients[client.sessionId] = client;
    logs.info("client connected: " + f.formatAddress(client));
    client.on("message", f.handleMessage(client));
    client.on("disconnect", f.handleDisconnect(client)); 
  };
  f.handleMessage = function (client) {
    return function (rawMessage) { 
      logs.info("message received from: " + f.formatAddress(client) + 
        " - " + rawMessage); 
      var message = JSON.parse(rawMessage);
      f.handleUserToken(client, message);
    };
  };
  f.handleUserToken = function (client, message) {
    var userToken = message.userToken, 
      clientUserTokenVar = f.getClientUserTokenVar(client),
      userIdVar = f.getUserIdVar(userToken);

    if (userToken) {
      db.set(clientUserTokenVar, userToken);
      db.sadd(f.getUserOpenClientsVar(userToken), client.sessionId);
      db.get(f.getNameVar(userToken), function (err, res) {
        if (!res) {
          db.incr(f.getAnonIndex(), function (err, res) {
            f.setName(userToken, anonymousName + res);
            db.set(userIdVar, res);
          });
        }
        else {
          //If they don't have a user var because they weren't around
          //when I was making them, make one!
          db.get(userIdVar, function (err, userId) {
            if (!userId) {
              db.incr(f.getAnonIndex(), function (err, newUserId) {
                db.set(userIdVar, newUserId);
              });
            }
          });
        }
      });
      f.handlePassword(client, userToken, message);
    }
    else {
      db.get(clientUserTokenVar, function (err, userToken) {
        f.handlePassword(client, userToken, message);
      });
    }
  };
  f.handlePassword = function (client, userToken, message) {
    var clientPasswordSetVar, needsPassword, password, multi;
    clientPasswordSetVar = f.getClientPasswordSetVar(client);
    multi = db.multi();
    multi.get(f.getUserPasswordVar(userToken), function (err, dbPassword) {
      needsPassword = !!dbPassword;
      password = dbPassword;
    });
    multi.get(clientPasswordSetVar, function (err, isSet) {
      if (needsPassword && !isSet) {
        if (message.password === password) {
          db.set(clientPasswordSetVar, true);
          f.handleUrl(client, userToken, message);
        }
        else {
          client.send(JSON.stringify({
            passwordFailed: true
          }));
        }
      }
      else {
        f.handleUrl(client, userToken, message);
      }
    });
    multi.exec();
  };
  f.handleUrl = function (client, userToken, message) {
    if (message.forceUrl) {
      db.get(f.getClientUrlIdVar(client), function (err, urlId) {
        var useUrl = function () {
          f.handleDecidedUrl(client, userToken, message, message.url);
        };
        if (urlId) {
          db.srem(f.getUrlMembersVar(urlId), client.sessionId, useUrl);
        }
        else {
          useUrl();
        }
      });
    }
    else if (message.url) {
      f.decideUrl(client, userToken, message);
    }
    else {
      db.get(f.getClientUrlIdVar(client), function (err, urlId) {
        f.handleMessageContents(client, userToken, message, urlId);
      });
    }
  };
  f.decideUrl = function (client, userToken, message) {
    var urlObj, host, pathname, paths, urlsToCheck, builtUrl;
    if (message.url === "about://") {
      f.handleDecidedUrl(client, userToken, message, everyoneUrl);
      return;
    }
    urlObj = urlLib.parse(message.url); 
    host = urlObj.protocol + "//" + urlObj.hostname;
    pathname = urlObj.pathname;
    if (pathname.charAt(0) === "/") {
      pathname = pathname.substring(1);
    }
    urlsToCheck = [];
    urlsToCheck.push(everyoneUrl);
    urlsToCheck.push(host);
    if (pathname.indexOf("/") >= 0) {
      paths = pathname.split("/");
      builtUrl = host;
      _(paths).first(paths.length - 1).forEach(function (path) {
        builtUrl += "/" + path;
        urlsToCheck.push(builtUrl);
      });
    }
    urlsToCheck.push(host + "/" + pathname);
    urlsToCheck = urlsToCheck.reverse();
    (function () {
      var getHashes, urlIds, addUrl, urlIdAssigner,
        minBoardSizeToUse, maxBoardSizeToUse;
      getHashes = db.multi();
      urlIds = [];
      urlIdAssigner = function (err, urlId) {
        urlIds.push(urlId);
      };
      urlsToCheck.forEach(function (url, index) {
        getHashes.get(f.getUrlIdForHashVar(hash.md5(url)), urlIdAssigner);
      });
      getHashes.get(f.getUserMinBoardSizeVar(userToken), 
        function (err, userMinBoardSize) {
          if (userMinBoardSize) {
            minBoardSizeToUse = userMinBoardSize;
          }
          else {
            minBoardSizeToUse = minBoardSize;
          }
        }
      );
      getHashes.get(f.getUserMaxBoardSizeVar(userToken), 
        function (err, userMaxBoardSize) {
          if (userMaxBoardSize) {
            maxBoardSizeToUse = userMaxBoardSize;
          }
          else {
            maxBoardSizeToUse = maxBoardSize;
          }
        }
      );
      getHashes.exec(function () {
        var getMembers, urlCounts, urlCountAssigner;
        urlCounts = [];
        getMembers = db.multi();
        urlCountAssigner = function (err, members) {
          urlCounts.push(members.length);
        };
        urlIds.forEach(function (urlId, index) {
          getMembers.smembers(f.getUrlMembersVar(urlId), urlCountAssigner);
        });
        getMembers.exec(function () {
          var i, ii;
          for (i = 0, ii = urlsToCheck.length - 1; i < ii; i += 1) {
            if (
               (urlCounts[i] >= minBoardSizeToUse) || 
               (urlCounts[i + 1] > maxBoardSizeToUse)
             ) {
              f.handleDecidedUrl(client, userToken, message, urlsToCheck[i]);
              return;
            }
          }
          f.handleDecidedUrl(client, userToken, message, everyoneUrl);
        });
      });
    }());
  };
  f.handleDecidedUrl = function (client, userToken, message, url) {
    logs.info("decided on " + url + " for " + f.formatAddress(client));
    var urlHash, urlIdForHashVar;
    urlHash = hash.md5(url);
    urlIdForHashVar = f.getUrlIdForHashVar(urlHash);
    db.get(urlIdForHashVar, function (err, urlId) {
      if (!urlId) {
        db.incr(f.getNextUrlIdVar(), function (err, urlId) {
          db.set(urlIdForHashVar, urlId);
          db.set(f.getUrlForUrlIdVar(urlId), url, function () {
            f.handleNewUrl(client, userToken, message, urlId, url);
          });
        });
      }
      else {
        f.handleNewUrl(client, userToken, message, urlId, url);
      }
    });
  };
  
  f.handleNewUrl = function (client, userToken, message, urlId, url) {
    var userId, hasPass, multi, clientUrlIdVar = f.getClientUrlIdVar(client);
    db.sadd(f.getUrlMembersVar(urlId), client.sessionId);
    db.set(clientUrlIdVar, urlId);
    f.sendInitialHistory(client, userToken, urlId);

    multi = db.multi();
    multi.get(f.getUserIdVar(userToken), function (err, res) {
      userId = res;
    });
    multi.get(f.getUserFlashesVar(userToken), function (err, flashes) {
      client.send(JSON.stringify({
        url: url,
        flash: (flashes ? flashes === "true" : true),
        userId: userId
      }));
      f.sendAnnouncement("Welcome to chattrr! You are talking on " + url, 
        client);
      f.sendAnnouncement(" Type '/help' for more information", client);
      f.handleMessageContents(client, userToken, message, urlId);
    });
    multi.exec();
  };
  f.handleMessageContents = function (client, userToken, message, urlId) {
    if (message.name) {
      message.name = message.name.substring(0, 16);
      f.setName(userToken, message.name, function (oldName) {
        f.doOnOpenClients(userToken, function (openClient) {
          db.get(f.getClientUrlIdVar(openClient), 
            function (err, urlIdForClient) {
              var toSend = "\"" + oldName + "\" is now called \"" + 
                message.name + "\"";
              f.broadcastMessage(toSend, urlIdForClient, serverName);
            }
          );
        });
      });
    }
    else if (message.forceUrl) {
      //handled elsewhere  
      message.forceUrl = message.forceUrl;
    }
    else if (!_.isUndefined(message.newPassword)) {
      f.setPassword(client, userToken, message, urlId);
    }
    else if (message.minbs) {
      db.set(f.getUserMinBoardSizeVar(userToken), message.minbs);
      f.doOnOpenClients(userToken, function (openClient) {
        f.sendAnnouncement("You now go to boards that have at least " + 
          message.minbs + " people on them", openClient);
      });
    }
    else if (message.maxbs) {
      db.set(f.getUserMaxBoardSizeVar(userToken), message.maxbs);
      f.doOnOpenClients(userToken, function (openClient) {
        f.sendAnnouncement("You now will not go to boards that have more " +
          "than " + message.maxbs + " people on them", openClient);
      });
    }
    else if (!_.isUndefined(message.flash)) {
      db.set(f.getUserFlashesVar(userToken), message.flash === true); 
      f.doOnOpenClients(userToken, function (openClient) {
        openClient.send(JSON.stringify({
          flash: (message.flash === true)
        }));
        f.sendAnnouncement("You have set title flashing " + 
          ((message.flash === true) ? "on" : "off"), openClient);
      });
    }
    else if (message.historyCount && (message.historyCount > 0)) {
      db.set(f.getUserHistoryDepthVar(userToken), 
        (message.historyCount > 20) ? 20 : message.historyCount, 
        function () {
          f.sendInitialHistory(client, userToken, urlId);
        }
      );
    }
    else if (message.msg) {
      message.msg = message.msg.substring(0, 200);
      f.saveMessage(message.msg, userToken, urlId);
      f.broadcastMessage(message.msg, urlId, userToken, message.seq);
    }
  };
  f.setPassword = function (client, userToken, message, urlId) {
    db.get(f.getUserPasswordVar(userToken), function (err, password) {
      var passwordExists = !!password;
      if ((!passwordExists && (message.password === "")) || 
        (password === message.password)) {
        db.set(f.getUserPasswordVar(userToken), message.newPassword);
        f.doOnOpenClients(userToken, function (openClient) {
          f.sendAnnouncement("Your password has now been set. You will be " +
            " prompted for this when you now start chattrr.", openClient);
        });
      }
      else {
        f.sendAnnouncement("Your old password did not match your existing " +
          "password. Your new password has not been set.", client);
      }
    });
  };
  f.doOnOpenClients = function (userToken, action) {
    db.smembers(f.getUserOpenClientsVar(userToken), function (err, clientIds) {
      clientIds.forEach(function (sessionId) {
        var exists = clients.hasOwnProperty(sessionId);
        if (exists) {
          action(clients[sessionId]);
        }
        else {
          db.srem(f.getUserOpenClientsVar(userToken), sessionId);
        }
      });
    });
  };
  f.sendInitialHistory = function (client, userToken, urlId) {
    var send = function (message) {
      client.send(message);
    };
    db.get(f.getUserHistoryDepthVar(userToken), function (err, res) {
      var historyDepth = 5;
      if (res) {
        historyDepth = parseInt(res, 10);
      }
      db.lrange(f.getUrlMessagesVar(urlId), -historyDepth, -1, 
        function (err, res) {
          res.forEach(function (msgJson) {
            var message = JSON.parse(msgJson);
            f.formatMessage(
              message.userToken, 
              new Date(message.time), 
              message.msg, 
              null,
              function (toSend) {
                client.send(toSend);
              }
            );
          });
        }
      );
    });
  };
  f.setName = function (userToken, name, cb) {
    var oldName, nameVar, multi;
    nameVar = f.getNameVar(userToken);
    multi = db.multi();
    if (cb) {
      multi.get(nameVar, function (err, res) {
        oldName = res;
      });
    }
    multi.set(nameVar, name, function (err, res) {
      if (cb) {
        cb(oldName); 
      }
    });
    multi.exec();
  }; 
  f.saveMessage = function (message, userToken, urlId) {
    db.rpush(f.getUrlMessagesVar(urlId), 
      JSON.stringify({
        userToken: userToken, 
        msg: message,
        time: new Date()
      })
    );
  };
  f.broadcastMessage = function (toSend, urlId, userToken, seq) {
    f.formatMessage(userToken, new Date(), toSend, seq, function (message) {
      var getUrlMembersVar = f.getUrlMembersVar(urlId);
      db.smembers(getUrlMembersVar, function (err, clientSessionIds) {
        clientSessionIds.forEach(function (sessionId) {
          if (clients.hasOwnProperty(sessionId)) {
            clients[sessionId].send(message);
          }
          else {
            //Don't know "sessionId" anymore
            db.srem(getUrlMembersVar, sessionId);
          }
        });
      });
    });
  };
  f.sendAnnouncement = function (toSend, client) {
    f.formatMessage(serverName, new Date(), toSend, null, function (message) {
      client.send(message);
    });
  };
  f.formatMessage = function (userToken, time, message, seq, cb) {
    var multi, name, formatter = function (name, id) {
      var msgObj = {
        name: name, 
        time: time.getTime(), 
        msg: message,
        id: id
      };
      if (seq) {
        msgObj.seq = seq;
      }
      cb(JSON.stringify(msgObj));
    };
    if (userToken === serverName) {
      formatter(userToken, 0);
    }
    else {
      multi = db.multi();
      multi.get(f.getNameVar(userToken), function (err, userName) {
        name = userName;
      });
      multi.get(f.getUserIdVar(userToken), function (err, userId) {
        formatter(name, userId);
      });
      multi.exec();
    }
  };
  f.handleDisconnect = function (client) {
    return function () { 
      var con = client.connection;
      logs.info("client disconnected: " + 
        con.remoteAddress + ":" + con.remotePort); 
      f.removeClient(client);
      delete clients[client.sessionId];
    };
  };
  f.removeClient = function (client) {
    var clientUrlVar = f.getClientUrlIdVar(client),
        clientUserTokenVar = f.getClientUserTokenVar(client),
        multi = db.multi();
    multi.get(clientUrlVar, function (err, urlId) {
      db.srem(f.getUrlMembersVar(urlId), client.sessionId);
    });
    multi.get(clientUserTokenVar, function (err, userToken) {
      db.srem(f.getUserOpenClientsVar(userToken), client.sessionId);
    });
    multi.del(clientUrlVar);
    multi.del(clientUserTokenVar);
    multi.del(f.getClientPasswordSetVar(client));
    multi.exec();
  };
  f.formatAddress = function (client) {
    var con = client.connection,
        addr = con.address();
    return con.remoteAddress + ":" + con.remotePort + 
      "(" + addr.address + ":" + addr.port + ")";
  };

  //Redis keys
  //"url:nextUrlId" - int 
  //  the id to use for the next url
  f.getNextUrlIdVar = function () {
    return "url:nextUrlId";
  };
  //"url:<urlId>":url" - string(url)
  //  the actual url for the urlId
  f.getUrlForUrlIdVar = function (urlId) {
    return "url:" + urlId + ":url";
  };
  //"url:<urlHash>:urlId" - string(hash of url)
  //  the urlId for the given url's hash
  f.getUrlIdForHashVar = function (urlHash) {
    return "url:" + urlHash + ":urlId";
  };
  //"url:<urlId>:clients" - set(client.sessionId) 
  //  the clients currently viewing the given url
  f.getUrlMembersVar = function (urlId) {
    return "url:" + urlId + ":clients";
  };
  //"url:<urlId>:messages" - set(message json)
  //  the messages saved for the given url
  f.getUrlMessagesVar = function (urlId) {
    return "url:" + urlId + ":messages";
  };
  //"user:<userToken>:name" - string 
  //  the screen name for the given user
  f.getNameVar = function (userToken) {
    return "user:" + userToken + ":name";
  };
  //"user:<userToken>:historyDepth" - int 
  //  how much history to show for the given user.
  f.getUserHistoryDepthVar = function (userToken) {
    return "user:" + userToken + ":historyDepth";
  };
  f.getUserIdVar = function (userToken) {
    return "user:" + userToken + ":id";
  };
  f.getUserPasswordVar = function (userToken) {
    return "user:" + userToken + ":password";
  };
  f.getUserMinBoardSizeVar = function (userToken) {
    return "user:" + userToken + ":minbs";
  };
  f.getUserMaxBoardSizeVar = function (userToken) {
    return "user:" + userToken + ":maxbs";
  };
  f.getUserFlashesVar = function (userToken) {
    return "user:" + userToken + ":flash";
  };
  f.getUserOpenClientsVar = function (userToken) {
    return "user:" + userToken + ":clients";
  };
  //"user:uniqueId
  f.getAnonIndex = function () {
    return "user:nextAnonId";
  };
  //"client:<client.sessionId>:userToken" - string 
  //  who the client actually is
  f.getClientUserTokenVar = function (client) {
    return "client:" + client.sessionId + ":userToken";
  };
  //"client:<client.sessionId>:url" - string 
  //  the url that the given client is viewing
  f.getClientUrlIdVar = function (client) {
    return "client:" + client.sessionId + ":url";
  };
  f.getClientPasswordSetVar = function (client) {
    return "client:" + client.sessionId + ":pwset";
  };

  //Start up
  start = function () {
    f.initLogging();
    db = redis.createClient();
    bgsavesIntervalObj = setInterval(f.bgsaves, bgsavesInterval * 1000);
    sendRegularInfoIntervalObj = setInterval(f.sendRegularInfo, 
      sendRegularInfoInterval * 1000);
    f.addProcessHandlers();
    try {
      f.createServer();
    }
    catch (ex) {
      logs.error("Couldn't start server - are you using a port to which " +
        "you do not have permission?. Exiting");
      logs.error(ex);
      process.exit(1);
    }
  };
  fs.readFile("config", function (err, configText) {
    var c = {};
    if (configText) {
      try {
        c = JSON.parse(configText);
      }
      catch (ex) {
        util.log("Config file malformed");
        util.log(err);
      }
    }
    io = require(c.socket_io ? c.socket_io : "socket.io");
    redis = require(c.redis ? c.redis : "redis");
    hash = require(c.hashlib ? c.hashlib : "hashlib");
    _ = require(c.underscore ? c.underscore : "underscore");
    logs = require(c.winston ? c.winston : "winston");
    express = require(c.express ? c.express : "express");
    minBoardSize = c.minBoardSize ? c.minBoardSize : 4;
    maxBoardSize = c.maxBoardSize ? c.maxBoardSize : 10;
    everyoneUrl = c.everyoneUrl ? c.everyoneUrl : "http://chattrr.net";
    bgsavesInterval = c.bgsavesInterval ? c.bgsavesInterval : 300;
    sendRegularInfoInterval = c.sendRegularInfoInterval ? 
      c.sendRegularInfoInterval : 20;
    serverName = c.serverName ? c.serverName : "chattrr";
    serverPort = c.serverPort ? c.serverPort : 80;
    popularCount = c.popularCount ? c.popularCount : 20;
    logInfoToConsole = !_.isUndefined(c.logInfoToConsole) ? 
      c.logInfoToConsole : false;
    logErrorsToConsole = !_.isUndefined(c.logErrorsToConsole) ? 
      c.logErrorsToConsole : true;
    anonymousName = c.anonymousName ? c.anonymousName : "Anonymous_";
    start();
  });
}());
