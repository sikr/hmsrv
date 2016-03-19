(function() {

'use strict';

var Graphite = require('./graphite.js');
var net      = require('net');
var i        = 0;

var testChunk = [
  {metric: "bla.foo.bar.baz", timestamp: 1456579605, value: 3.6},
  {metric: "bla.foo.bar.baz", timestamp: 1456579605, value: 3.6},
  {metric: "bla.foo.bar.baz", timestamp: 1456579605, value: 3.6},
  {metric: "bla.foo.bar.baz", timestamp: 1456579605, value: 3.6},
  {metric: "bla.foo.bar.baz", timestamp: 1456579605, value: 3.6},
  {metric: "bla.foo.bar.baz", timestamp: 1456579605, value: 3.6},
  {metric: "bla.foo.bar.baz", timestamp: 1456579605, value: 3.6},
  {metric: "bla.foo.bar.baz", timestamp: 1456579605, value: 3.6},
  {metric: "bla.foo.bar.baz", timestamp: 1456579605, value: 3.6},
  {metric: "bla.foo.bar.baz", timestamp: 1456579605, value: 3.6}
];

/*
 * SERVER
 *
 */
var server = net.createServer(function (client) {
  client.on('connection', function (data) {
    console.log('connection');
  });
  client.on('data', function (data) {
    console.log(data.toString());
  });
  client.on('end', function () {
    console.log('disconnected');
  });
  client.on('error', function (e) {
    console.log('error ' + JSON.stringify(e));
  });
});

server.listen(2003, '127.0.0.1', function () {
    console.log('Listening...');
});

/*
 * Client
 *
 */
var options = {
  ip: '127.0.0.1',
  port: 2003,
  prefix: 'test'
};
var graphite = new Graphite(options);

graphite.connect(function(err) {
  if (!err) {
    graphite.send(testChunk, function(err) {
      if(!err) {
        console.log('Data successfully written to graphite.');
      }
      else {
        console.error('Error writing data to graphite.');
      }
      graphite.close();
    });
  }
});


})();

