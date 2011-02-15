var socket = new io.Socket();
socket.connect();
socket.on('connect', function () { 
})
socket.on('message', function(message) { 
  document.getElementById("out").value+=message+"\n";
})
socket.on('disconnect', function(){ console.debug("disconnected", arguments); })

document.getElementById('send').addEventListener('click', 
  function () {
    var el = document.getElementById('in'),
        text = el.value;
    socket.send(text);
    el.value = "";
  }, false);

