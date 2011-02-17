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
        f.sendInitialHistory(client, urls[message.url]);
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
          urls[client.url].history.push(message.msg);
          f.sendMessage(message.msg, client, true);
        }
      }
    };
  };
  f.sendInitialHistory = function (client, url) {
    var send = function (message) {
      client.send(message);
    };
    if (url.history.length < 5) {
      url.history.forEach(send);
    }
    else {
      _(url.history).rest(-5).forEach(send);
    }
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
  f.sendMessage = function (toSend, client, broadcast) {
    db.get(f.createNameVar(client), function (err, name) {
      var sessionId, localClients, now = new Date();
      toSend = name + "@" + now.toLocaleTimeString() + ": " + toSend;
      if (broadcast) {
        localClients = urls[client.url].clients;
        for (sessionId in localClients) {
          if (localClients.hasOwnProperty(sessionId)) {
            localClients[sessionId].send(toSend);
          }
        }
      }
      else {
        client.send(toSend);
      } 
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
