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
/*global require, setInterval, process */

(function () {
  var http = require('http'), 
      io = require('socket.io'),
      fs = require('fs'),
      util = require('util'),
      redis = require("redis"),
//      hash = require("../../hashlib/build/default/hashlib"),
      hash = require("hashlib"),
      _ = require("underscore"),
      logs = require("winston"),
      express = require("express"),
      db, server, socket, clients,
      f = {serverName: "chattrr"};

  db = redis.createClient();
  setInterval(function () {
    db.bgsave();
  }, 5 * 60 * 1000);

  (function () {
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
    logs.remove(logs.transports.Console);
    logs.add(logs.transports.Console, {
      level: "error"
    });
    /**/
  }());

  server = express.createServer();
  server.configure(function () {
    server.use(express.staticProvider("client"));
  });
  process.on("exit", function () {
    server.close();
    _(socket.clients).values().forEach(function (client) {
      client.send(JSON.stringify({closing: true}));
    });
    db.save();
    logs.info("Database saved. Closing.");
  });
  process.on("SIGINT", function () {
    process.exit();
  });
  process.on("uncaughtException", function (err) {
    logs.error(err);
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
  socket = io.listen(server, {
    log: logs.info
  });

  clients = {};
  f.createConnection = function (client) {
    var address = client.connection.address();
    clients[client.sessionId] = client;
    logs.info('client connected: ' + f.formatAddress(client));
    client.on('message', f.handleMessage(client));
    client.on('disconnect', f.handleDisconnect(client)); 
  };
  f.handleMessage = function (client) {
    return function (rawMessage) { 
      logs.info('message received from: ' + f.formatAddress(client) + 
        ' - ' + rawMessage); 
      var message = JSON.parse(rawMessage);
      f.handleUserToken(client, message);
    };
  };
  f.handleUserToken = function (client, message) {
    var userToken = message.userToken, 
      clientUserTokenVar = f.createClientUserTokenVar(client),
      userIdVar = f.getUserIdVar(userToken);

    if (userToken) {
      db.set(clientUserTokenVar, userToken);
      db.get(f.createNameVar(userToken), function (err, res) {
        if (!res) {
          db.incr(f.createAnonIndex(), function (err, res) {
            f.setName(userToken, "Anonymous_" + res);
            db.set(userIdVar, res);
          });
        }
        else {
          //If they don't have a user var because they weren't around
          //when I was making them, make one!
          db.get(userIdVar, function (err, userId) {
            if (!userId) {
              db.incr(f.createAnonIndex(), function (err, newUserId) {
                db.set(userIdVar, newUserId);
              });
            }
          });
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
        else {
          f.handleNewUrl(client, userToken, message, clientUrlKey, urlId);
        }
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
      message.name = message.name.substring(0, 16);
      f.setName(userToken, message.name, function (oldName) {
        var toSend = "\"" + oldName + "\" is now called \"" + 
          message.name + "\"";
        f.sendMessage(toSend, client, f.serverName, urlId, true);
      });
    }
    else if (message.historyCount && (message.historyCount > 0)) {
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
        message.msg = message.msg.substring(0, 200);
        f.saveMessage(message.msg, userToken, urlId);
        f.sendMessage(message.msg, client, userToken, urlId, true, 
          message.seq);
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
  f.sendMessage = function (toSend, client, userToken, urlId, broadcast, seq) {
    f.formatMessage(userToken, new Date(), toSend, seq, function (message) {
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
  f.formatMessage = function (userToken, time, message, seq, cb) {
    var multi, name, formatter = function (name, id) {
      var msgObj = {
        name: name, 
        time: time, 
        msg: message,
        id: id
      };
      if (seq) {
        msgObj.seq = seq;
      }
      cb(JSON.stringify(msgObj));
    };
    if (userToken === f.serverName) {
      formatter(userToken, 0);
    }
    else {
      multi = db.multi();
      multi.get(f.createNameVar(userToken), function (err, userName) {
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
      logs.info('client disconnected: ' + 
        con.remoteAddress + ":" + con.remotePort); 
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
  f.formatAddress = function (client) {
    var con = client.connection,
        addr = con.address();
    return addr.address + ":" + addr.port + "(" + con.remotePort + ")";
  };
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
  f.getUserIdVar = function (userToken) {
    return "user:" + userToken + ":id";
  };
  //"user:uniqueId
  f.createAnonIndex = function () {
    return "user:nextAnonId";
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
