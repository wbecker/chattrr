/*jslint white: true, onevar: true, undef: true, newcap: true, nomen: false, regexp: true, plusplus: true, bitwise: true, maxerr: 5, maxlen: 80, indent: 2 */
/*global require */

(function () {
  var http = require('http'), 
      io = require('../../socket.io-node'),
      fs = require('fs'),
      util = require('util'),
      redis = require("redis"),
      hash = require("hashlib"),
      _ = require("../../underscore/underscore"),
      db, server, socket, clients,
      f = {};

  db = redis.createClient();
  server = http.createServer(function (req, res) {
    var url = req.url;
    if (url === "/") {
      url += "client.htm";
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
    var address = client.connection.address(), 
      name = client.connection.address();
    clients[client.sessionId] = client;
    name = address.address + ":" + address.port;
    f.setName(client, name);
    util.log(name + ' connected');
    client.on('message', f.handleMessage(client));
    client.on('disconnect', f.handleDisconnect(client)); 
  };
  f.handleMessage = function (client) {
    return function (rawMessage) { 
      util.log('message: ' + rawMessage); 
      var message = JSON.parse(rawMessage);
      f.handleUrl(client, message);
    };
  };
  f.handleUrl = function (client, message) {
    var clientUrlKey = f.getClientUrlKey(client), urlHash;
    if (message.url) {
      urlHash = hash.md5(message.url);
      db.get("url:" + urlHash, function (err, urlId) {
        if (!urlId) {
          db.incr("nextUrlId", function (err, urlId) {
            db.set("url:" + urlHash, urlId);
            f.handleNewUrl(client, message, clientUrlKey, urlId);
          });
        }
        f.handleNewUrl(client, message, clientUrlKey, urlId);
      });
    }
    else {
      db.get(clientUrlKey, function (err, urlId) {
        f.handleMessageContents(client, message, urlId);
      });
    }
  };
  f.handleNewUrl = function (client, message, clientUrlKey, urlId) {
    db.sadd(f.getMembersKey(urlId), client.sessionId);
    db.set(clientUrlKey, urlId);
    f.sendInitialHistory(client, urlId);
    f.handleMessageContents(client, message, urlId);
  };
  f.handleMessageContents = function (client, message, urlId) {
    if (message.name) {
      f.setName(client, message.name, function (oldName) {
        var toSend = "\"" + oldName + "\" is now called \"" + 
          message.name + "\"";
        f.sendMessage(toSend, client, urlId);
      });
    }
    else if (message.msg) {
      if (message.msg.match(/^help$/)) {
        f.sendMessage("set name: <name>", client, urlId);
      }
      else {
        f.saveMessage(message.msg, client, urlId);
        f.sendMessage(message.msg, client, urlId, true);
      }
    }
  };
  f.sendInitialHistory = function (client, urlId) {
    var send = function (message) {
      client.send(message);
    };
    db.lrange(f.getMessagesName(urlId), -5, -1, 
      function (err, res) {
        res.forEach(function (msgJson) {
          var message = JSON.parse(msgJson);
          f.formatMessage(
            {sessionId: message.client}, 
            new Date(message.time), 
            message.msg, 
            function (toSend) {
              client.send(toSend);
            }
          );
        });
      }
    );
  };
  f.setName = function (client, name, cb) {
    var oldName, nameVar, multi;
    nameVar = f.createNameVar(client);
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
  f.createNameVar = function (client) {
    return "client:" + client.sessionId + ":name";
  };
  f.saveMessage = function (message, client, urlId) {
    db.rpush(f.getMessagesName(urlId), 
      JSON.stringify({
        client: client.sessionId, 
        msg: message,
        time: new Date()
      })
    );
  };
  f.getMessagesName = function (urlId) {
    return "messages:" + urlId;
  };
  f.sendMessage = function (toSend, client, urlId, broadcast) {
    f.formatMessage(client, new Date(), toSend, function (message) {
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
  f.formatMessage = function (client, time, message, cb) {
    db.get(f.createNameVar(client), function (err, name) {
      cb(JSON.stringify({name: name, time: time, msg: message}));
    });
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
    multi.exec();
  };
  f.getMembersKey = function (urlId) {
    return "board:" + urlId + ":clients";
  };
  f.getClientUrlKey = function (client) {
    return "client:" + client.sessionId + ":url";
  };
  socket.on('connection', f.createConnection);
}());
