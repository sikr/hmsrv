var socket = io.connect(location.origin);

socket.on('update', function (data) {
  console.log(data);
});
