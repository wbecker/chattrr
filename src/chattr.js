(function () {
  var http = require('http'), 
      io = require('../../socket.io-node'),
      fs = require('fs'),
      util = require('util'),
      server, socket, clients;
  server = http.createServer(function(req, res){
    fs.readFile('client/client.htm', "binary", function (err, file) {
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

  var socket = io.listen(server);

  var clients = {}
  socket.on('connection', function(client){
    clients[client.sessionId] = client;
    util.log('connected');
    
    client.on('message', function(message){ 
      util.log('message: '+message); 
      for (var c in clients) {
        if (c !== client.sessionId) {
          clients[c].send(message);
        }
      }
    })
    client.on('disconnect', function(){ 
      util.log('disconnected'); 
      delete clients[client.sessionId];
    })
  });
}());
