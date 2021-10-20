var socket = io.connect(location.origin);

socket.on('update', function (data) {
  console.log(data);
});

document.querySelector('#command-shutdown').addEventListener("click", () => {
  socket.emit('system', '{"cmd": {"call": "shutdown"}}');
});
document.querySelector('#lowbat-true').addEventListener("click", () => {
  socket.emit('system', '{"cmd": {"call": "handleLowBat", "value": true, "datapoint": "30012"}}');
});
document.querySelector('#lowbat-false').addEventListener("click", () => {
  socket.emit('system', '{"cmd": {"call": "handleLowBat", "value": false, "datapoint": "30012"}}');
});

