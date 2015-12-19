/*
 * SCSW - Skeleton of a secure (https) client with websocket
 */
$(function() {


'use strict';

var socket = io.connect('https://' + location.hostname);

socket.on('update', function (data) {
  console.log(data);
});

var getFoo = function(bar, callback) {
  $.getJSON(location.href + 'foo?bar=' + bar, {}, function cb(result) {
    if (callback) {
      callback(result);
    }
  });
};

$('#b1').click(function result() {
  socket.emit('system', '{"msg": "shutdown"}');
});

});