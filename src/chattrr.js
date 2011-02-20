/*jslint white: true, onevar: true, undef: true, newcap: true, nomen: false, regexp: true, plusplus: true, bitwise: true, maxerr: 5, maxlen: 80, indent: 2 */
/*global require, setInterval */

(function () {
  var http = require('http'), 
      io = require('socket.io'),
      fs = require('fs'),
      util = require('util'),
      redis = require("redis"),
      hash = require("hashlib"),
      _ = require("underscore"),
      express = require("express"),
      db, server, socket, clients,
      f = {serverName: "chattrr"};

  db = redis.createClient();
  setInterval(function () {
    db.bgsave();
  }, 5 * 60 * 1000);

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
    fs.readFile('client' + url, "binary", function (err, file) {
      if (!err) {
        var content = 'text/html';
        if (url.substring(url.lastIndexOf('.')) === ".css") {
          content = "text/css";
        }
        res.writeHead(200, {'Content-Type': content});
        res.write(file, 'binary');
      }
      else {
        res.writeHead(500, {'Content-Type': 'text/html'});
        res.write(err);
      }
      res.end();
    });
  });

  server.listen(8000);
  socket = io.listen(server);

  clients = {};
  f.createConnection = function (client) {
    clients[client.sessionId] = client;
    util.log(client.connection.address() + ' connected');
    client.on('message', f.handleMessage(client));
    client.on('disconnect', f.handleDisconnect(client)); 
  };
  f.handleMessage = function (client) {
    return function (rawMessage) { 
      util.log('message: ' + rawMessage); 
      var message = JSON.parse(rawMessage);
      f.handleUserToken(client, message);
    };
  };
  f.handleUserToken = function (client, message) {
    var userToken = message.userToken, 
      clientUserTokenVar = f.createClientUserTokenVar(client);

    if (userToken) {
      db.set(clientUserTokenVar, userToken);
      db.get(f.createNameVar(userToken), function (err, res) {
        if (!res) {
          var address = client.connection.address();
          f.setName(userToken, address.address + ":" + address.port);
        }
      });
      f.handleUrl(client, userToken, message);
    }
    else {
      db.get(clientUserTokenVar, function (err, userToken) {
        f.handleUrl(client, userToken, message);
      });
    }
  };
  f.handleUrl = function (client, userToken, message) {
    var clientUrlKey = f.getClientUrlKey(client), urlHash, urlIdForHashKey;
    if (message.url) {
      urlHash = hash.md5(message.url);
      urlIdForHashKey = f.getUrlIdForHashKey(urlHash);
      db.get(urlIdForHashKey, function (err, urlId) {
        if (!urlId) {
          db.incr(f.getNextUrlIdKey(), function (err, urlId) {
            db.set(urlIdForHashKey, urlId);
            db.set(f.getUrlForUrlId(urlId), message.url, function () {
              f.handleNewUrl(client, userToken, message, clientUrlKey, urlId);
            });
          });
        }
        f.handleNewUrl(client, userToken, message, clientUrlKey, urlId);
      });
    }
    else {
      db.get(clientUrlKey, function (err, urlId) {
        f.handleMessageContents(client, userToken, message, urlId);
      });
    }
  };
  
  f.handleNewUrl = function (client, userToken, message, clientUrlKey, urlId) {
    db.sadd(f.getMembersKey(urlId), client.sessionId);
    db.set(clientUrlKey, urlId);
    f.sendInitialHistory(client, userToken, urlId);
    db.get(f.getUrlForUrlId(urlId), function (err, url) {
      f.sendMessage("Welcome to chattrr! You are talking on " + url, 
        client, f.serverName, urlId);
      f.sendMessage(" Type 'help' for more information", 
        client, f.serverName, urlId);
    });
    f.handleMessageContents(client, userToken, message, urlId);
  };
  f.handleMessageContents = function (client, userToken, message, urlId) {
    if (message.name) {
      f.setName(userToken, message.name, function (oldName) {
        var toSend = "\"" + oldName + "\" is now called \"" + 
          message.name + "\"";
        f.sendMessage(toSend, client, f.serverName, urlId, true);
      });
    }
    else if (message.historyCount) {
      db.set(f.getHistoryDepthVar(userToken), message.historyCount, 
        function () {
          f.sendInitialHistory(client, userToken, urlId);
        }
      );
    }
    else if (message.msg) {
      if (message.msg.match(/^help$/)) {
        f.sendMessage("Available commands:", client, f.serverName, urlId);
        f.sendMessage("  1. 'set name: <name>'", client, f.serverName, urlId);
        f.sendMessage("  2. 'set history depth: <numberOfLines>'", client, 
          f.serverName, urlId);
      }
      else {
        f.saveMessage(message.msg, userToken, urlId);
        f.sendMessage(message.msg, client, userToken, urlId, true);
      }
    }
  };
  f.sendInitialHistory = function (client, userToken, urlId) {
    var send = function (message) {
      client.send(message);
    };
    db.get(f.getHistoryDepthVar(userToken), function (err, res) {
      var historyDepth = 5;
      if (res) {
        historyDepth = parseInt(res, 10);
      }
      db.lrange(f.getMessagesName(urlId), -historyDepth, -1, 
        function (err, res) {
          res.forEach(function (msgJson) {
            var message = JSON.parse(msgJson);
            f.formatMessage(
              message.userToken, 
              new Date(message.time), 
              message.msg, 
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
    nameVar = f.createNameVar(userToken);
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
    db.rpush(f.getMessagesName(urlId), 
      JSON.stringify({
        userToken: userToken, 
        msg: message,
        time: new Date()
      })
    );
  };
  f.sendMessage = function (toSend, client, userToken, urlId, broadcast) {
    f.formatMessage(userToken, new Date(), toSend, function (message) {
      if (broadcast) {
        var membersKey = f.getMembersKey(urlId);
        db.smembers(membersKey, function (err, clientSessionIds) {
          clientSessionIds.forEach(function (sessionId) {
            if (clients.hasOwnProperty(sessionId)) {
              clients[sessionId].send(message);
            }
            else {
              //Don't know "sessionId" anymore
              db.srem(membersKey, sessionId);
            }
          });
        });
      }
      else {
        client.send(message);
      } 
    });
  };
  f.formatMessage = function (userToken, time, message, cb) {
    var formatter = function (err, name) {
      cb(JSON.stringify({name: name, time: time, msg: message}));
    };
    if (userToken === f.serverName) {
      formatter(null, userToken);
    }
    else {
      db.get(f.createNameVar(userToken), formatter);
    }
  };
  f.handleDisconnect = function (client) {
    return function () { 
      util.log('disconnected'); 
      f.removeClient(client);
      delete clients[client.sessionId];
    };
  };
  f.removeClient = function (client) {
    var clientUrlKey = f.getClientUrlKey(client),
        multi = db.multi();
    multi.get(clientUrlKey, function (err, urlId) {
      db.srem(f.getMembersKey(urlId), client.sessionId);
    });
    multi.del(clientUrlKey);
    multi.del(f.createClientUserTokenVar(client));
    multi.exec();
  };
  socket.on('connection', f.createConnection);
  //Redis keys
  //"url:nextUrlId" - int 
  //  the id to use for the next url
  f.getNextUrlIdKey = function () {
    return "url:nextUrlId";
  };
  //"url:<urlId>":url" - string(url)
  //  the actual url for the urlId
  f.getUrlForUrlId = function (urlId) {
    return "url:" + urlId + ":url";
  };
  //"url:<urlHash>:urlId" - string(hash of url)
  //  the urlId for the given url's hash
  f.getUrlIdForHashKey = function (urlHash) {
    return "url:" + urlHash + ":urlId";
  };
  //"url:<urlId>:clients" - set(client.sessionId) 
  //  the clients currently viewing the given url
  f.getMembersKey = function (urlId) {
    return "url:" + urlId + ":clients";
  };
  //"url:<urlId>:messages" - set(message json)
  //  the messages saved for the given url
  f.getMessagesName = function (urlId) {
    return "url:" + urlId + ":messages";
  };
  //"user:<userToken>:name" - string 
  //  the screen name for the given user
  f.createNameVar = function (userToken) {
    return "user:" + userToken + ":name";
  };
  //"user:<userToken>:historyDepth" - int 
  //  how much history to show for the given user.
  f.getHistoryDepthVar = function (userToken) {
    return "user:" + userToken + ":historyDepth";
  };
  //"client:<client.sessionId>:userToken" - string 
  //  who the client actually is
  f.createClientUserTokenVar = function (client) {
    return "client:" + client.sessionId + ":userToken";
  };
  //"client:<client.sessionId>:url" - string 
  //  the url that the given client is viewing
  f.getClientUrlKey = function (client) {
    return "client:" + client.sessionId + ":url";
  };
}());
