/*jslint white: true, onevar: true, undef: true, newcap: true, nomen: false, regexp: true, plusplus: true, bitwise: true, maxerr: 5, maxlen: 80, indent: 2 */
/*global require */

(function () {
  var http = require('http'), 
      io = require('../../socket.io-node'),
      fs = require('fs'),
      util = require('util'),
      redis = require("redis"),
      _ = require("../../underscore/underscore"),
      db, server, socket, clients, urls,
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
  urls = {};
  f.createConnection = function (client) {
    var address = client.connection.address(), 
      name = client.connection.address();
    clients[client.sessionId] = client;
    name = address.address + ":" + address.port;
    f.setName(client, name);
    util.log(name + 'connected');
    client.on('message', f.handleMessage(client));
    client.on('disconnect', f.handleDisconnect(client)); 
  };
  f.handleMessage = function (client) {
    return function (rawMessage) { 
      var message, broadcast = true;
      util.log('message: ' + rawMessage); 
      message = JSON.parse(rawMessage);
      if (message.url) {
        client.url = message.url;
        if (!urls[message.url]) {
          urls[message.url] = {history: [], clients: {}}; 
        }
        urls[message.url].clients[client.sessionId] = client;
        f.sendInitialHistory(client, client.url);
      }
      if (message.name) {
        f.setName(client, message.name, function (oldName) {
          var toSend = "\"" + oldName + "\" is now called \"" + 
            message.name + "\"";
          f.sendMessage(toSend, client);
        });
      }
      else if (message.msg) {
        if (message.msg.match(/^help$/)) {
          f.sendMessage("set name: <name>", client);
        }
        else {
          f.saveMessage(message.msg, client);
          f.sendMessage(message.msg, client, true);
        }
      }
    };
  };
  f.sendInitialHistory = function (client) {
    var send = function (message) {
      client.send(message);
    };
    db.lrange(f.getMessagesName(client.url), -5, -1, 
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
      multi.get(client, function (err, res) {
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
  f.saveMessage = function (message, client) {
    db.rpush(f.getMessagesName(client.url), 
      JSON.stringify({
        client: client.sessionId, 
        msg: message,
        time: new Date()
      })
    );
  };
  f.getMessagesName = function (url) {
    return "messages:" + url;
  };
  f.sendMessage = function (toSend, client, broadcast) {
    f.formatMessage(client, new Date(), toSend, function (message) {
      var sessionId, localClients;
      if (broadcast) {
        localClients = urls[client.url].clients;
        for (sessionId in localClients) {
          if (localClients.hasOwnProperty(sessionId)) {
            localClients[sessionId].send(message);
          }
        }
      }
      else {
        client.send(message);
      } 
    });
  };
  f.formatMessage = function (client, time, message, cb) {
    db.get(f.createNameVar(client), function (err, name) {
      cb(name + "@" + time.toLocaleTimeString() + ": " + message);
    });
  };
  f.handleDisconnect = function (client) {
    return function () { 
      util.log('disconnected'); 
      delete clients[client.sessionId];
    };
  };
  socket.on('connection', f.createConnection);
}());
