(function() {

'use strict';

var net          = require('net');
var EventEmitter = require('events').EventEmitter;
var util         = require('util');

var GraphiteClient = function(options) {

  var that = this;

  this.ip = options.ip || '127.0.0.1';
  this.port = options.port || 2003;
  this.prefix = options.prefix || '';
  this.throttle = options.throttle || 500 * 1024; // max 500kB/s

  this.totalCount = 0;
  this.successCount = 0;

  this.queue = [];
  this.interval = -1;

  this.socket = new net.Socket();
  this.connected = false;

  this.drained = true;

  this.connect = function(callback) {
    if (that.connected === false) {
      that.socket.connect(that.port, that.ip, function() {
        that.connected = true;
        that.emit('connected');

        that.socket.on('close', function() {
          that.connected = false;
          that.emit('close');
        });
        that.socket.on('drain', function() {
          // kernel write buffer free (again)
          that.drained = true;
        });
        callback();
      });
    }
    else {
      callback({msg: 'GraphiteClient is already connected'});
    }
  };

  this.isConnected = function() {
    return that.connected;
  };

  this.send = function(data, callback) {
    if (that.connected === true) {
      that.socket.write(data.join('\n'));
      callback();
    }
    else {
      callback({msg: 'Not connected to graphite.'});
    }
  };
  //
  // send a complete blob to graphite;
  // used for export existing datatables
  //
  // metric: "foo.bar.baz"
  // data:   [{"timestamp": 123456789, "value": 3.8},{...}]
  //
  this.sendBlob = function(metric, data, callback) {
    var i;
    var chunk = '';
    var row = '';
    var prefix;
    var timestamp;

    function _startQueue() {
      if (that.interval === -1) {
        // console.log('**** starting queue');
        that.interval = setInterval(function() {
          _send();
        }, 1000);
      }
    }


    function _send() {
      if (that.connected === true) {
        if (that.queue.length > 0) {
          if (that.drained) {
            if (!that.socket.write(that.queue.shift())) {
              // kernel write buffer full; prevent 
              that.drained = false;
            }
            // console.log('**** chunk sent');
            _finish();
          }
          else {
            // write buffer not empty, pause for a second
          }
        }
      }
      else {
        callback({msg: 'Not connected to graphite.'});
      }
    }
    
    function _finish() {
      that.successCount++;
      // console.log('**** _finish(): successCount = ' + that.successCount + ', totalCount = ' + that.totalCount);
      if (that.successCount === that.totalCount) {
        // console.log('**** _finish():  queue empty');
        clearInterval(that.interval);
        that.interval = -1;
        that.successCount = 0;
        that.totalCount = 0;
        if (typeof callback === 'function') {
          callback();
        }
      }
    }

    _startQueue();

    // prepare data
    if (that.prefix.length > 0){
      prefix = that.prefix + '.';
    }
    for (i = 0; i < data.length; i++) {
      timestamp = Math.round((parseInt(data[i].timestamp, 10) / 1000)).toString();
      row = prefix +
            metric +
            ' ' +
            data[i].value +
            ' ' +
            timestamp + '\n';

      // throttle bandwidth
      if (chunk.length + row.length > that.throttle) {
        that.queue.push(chunk);
        // console.log('**** queued chunk of length ' + chunk.length + ', total chunk count: ' + that.totalCount);
        chunk = row;
        that.totalCount++;
      }
      else {
        chunk += row;
      }
    }
    // send the last chunk
    if (chunk.length > 0) {
      // console.log('**** last chunk, size: ' + chunk.length);
      that.queue.push(chunk);
      chunk = '';
      that.totalCount++;
    }
  };
  this.close = function() {
    if (that.connected === true) {
      that.socket.end();
    }
  };
};

util.inherits(GraphiteClient, EventEmitter);

module.exports = GraphiteClient;

})();