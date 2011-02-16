/*jslint white: true, onevar: true, undef: true, newcap: true, nomen: false, regexp: true, plusplus: true, bitwise: true, maxerr: 5, maxlen: 80, indent: 2 */
/*global require */

(function () {
  var http = require('http'), 
      io = require('../../socket.io-node'),
      fs = require('fs'),
      util = require('util'),
      server, socket, clients, urls,
      f = {};

  server = http.createServer(function (req, res) {
    util.log(req.url);
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
    var address = client.connection.address();
    clients[client.sessionId] = client;
    client.name = address.address + ":" + address.port;
    util.log(client.name + 'connected');
    client.on('message', f.handleMessage(client));
    client.on('disconnect', f.handleDisconnect(client)); 
  };
  f.handleMessage = function (client) {
    return function (rawMessage) { 
      var message, toSend, broadcast = true, now = new Date();
      util.log('message: ' + rawMessage); 
      message = JSON.parse(rawMessage);
      if (message.url) {
        client.url = message.url;
        if (!urls[message.url]) {
          urls[message.url] = {history: [], clients: {}}; 
        }
        urls[message.url].clients[client.sessionId] = client;
      }
      if (message.name) {
        toSend = f.setName(client, message.name);
      }
      else if (message.msg) {
        if (message.msg.match(/^help$/)) {
          toSend = "set name: <name>";
          broadcast = false;
        }
        else {
          toSend = message.msg;
        }
      }
      if (toSend) {
        toSend = client.name + "@" + now.toLocaleTimeString() + ": " + toSend;
        f.sendMessage(toSend, client, broadcast); 
      }
    };
  };
  f.setName = function (client, name) {
    var oldName;
    oldName = client.name;
    client.name = name;
    return "\"" + oldName + "\" is now called \"" + name + "\""; 
  }; 
  f.sendMessage = function (toSend, client, broadcast) {
    var sessionId, localClients;
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
  };
  f.handleDisconnect = function (client) {
    return function () { 
      util.log('disconnected'); 
      delete clients[client.sessionId];
    };
  };
  socket.on('connection', f.createConnection);
}());
