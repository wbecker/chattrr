/*jslint white: true, onevar: true, undef: true, newcap: true, nomen: false, regexp: true, plusplus: true, bitwise: true, maxerr: 5, maxlen: 80, indent: 2 */
/*global require */

(function () {
  var http = require('http'), 
      io = require('../../socket.io-node'),
      fs = require('fs'),
      util = require('util'),
      server, socket, clients;
  server = http.createServer(function (req, res) {
    util.log(req.url);
    var url = req.url;
    if (url === "/") {
      url += "client.htm";
    }
    fs.readFile('client' + url, "binary", function (err, file) {
      if (!err) {
        res.writeHead(200, {'Content-Type': 'text/html'});
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

  socket.on('connection', function (client) {
    clients[client.sessionId] = client;
    util.log('connected');
    
    client.on('message', function (message) { 
      var sessionId, toSend, now = new Date();
      util.log('message: ' + message); 
      toSend = now.toLocaleTimeString() + ": " + message;
      for (sessionId in clients) {
        if (clients.hasOwnProperty(sessionId)) {
          clients[sessionId].send(toSend);
        }
      }
    });

    client.on('disconnect', function () { 
      util.log('disconnected'); 
      delete clients[client.sessionId];
    });
  });
}());
