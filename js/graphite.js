(function() {

'use strict';

var net          = require('net');
var EventEmitter = require('events').EventEmitter;
var util         = require('util');

var GraphiteClient = function(options) {

  var self = this;

  var ip = options.ip || '127.0.0.1';
  var port = options.port || 2003;
  var prefix = options.prefix || '';

  // properties for sending blobs
  // var throttle = options.throttle || 500 * 1024; // max 500kB/s
  // var totalCount = 0;
  // var successCount = 0;
  // var queue = [];
  // var interval = -1;

  var socket = new net.Socket();

  var connected = false;
  var drained = true;
  var reconnectTimeout = 10;
  var stop = false;

  /****************************************************************************
   *
   * Socket events
   *
   */
  socket.on('close', function() {
    connected = false;
    if (!stop) {
      // reconnect
      setTimeout(() => {
          self.connect();
        }, reconnectTimeout * 1000
      );
    }
  }); // on close()

  socket.on('connect', function() {
    connected = true;
    self.emit('connect');
  }) // on connect()

  socket.on('error', function(err) {
    self.emit('error', err);
  }); // on error()

  socket.on('drain', function() {
    // kernel write buffer free (again)
    drained = true;
  }); // on drain



  /****************************************************************************
   *
   * public interface
   *
   */
  this.connect = function() {
    if (connected === false) {
      socket.connect(port, ip);
    }
    else {
      self.emit("error", "already connected")
    }
  }; // connect()

  this.isConnected = function() {
    return connected;
  }; // isConnected()

  this.send = function(data) {
    return new Promise(function(resolve, reject) {
      if (connected === true) {
        var row;
        var prefixFull = '';
        var timestamp;
        var preparedData = [];

        // prepare data
        if (prefix.length > 0) {
          prefixFull = prefix + '.';
        }

        for (var i = 0; i < data.length; i++) {
          timestamp = Math.round((parseInt(data[i].timestamp, 10) / 1000)).toString();
          row = prefixFull +
                data[i].path +
                ' ' +
                data[i].value +
                ' ' +
                timestamp + '\n';
          preparedData.push(row);
        }
        socket.write(preparedData.join(''), () => {
          resolve();
        });
      }
      else {
        reject("not connected");
      }
    });
  }; // send()

  // /*
  //  * send a complete blob to graphite;
  //  * used for export existing datatables
  //  *
  //  * metric: "foo.bar.baz"
  //  * data:   [{"timestamp": 123456789, "value": 3.8},{...}]
  //  */
  // this.sendBlob = function(metric, data, callback) {
  //   var i;
  //   var chunk = '';
  //   var row = '';
  //   var prefixFull = '';
  //   var timestamp;

  //   function _startQueue() {
  //     if (interval === -1) {
  //       // console.log('**** starting queue');
  //       interval = setInterval(function() {
  //         _send();
  //       }, 1000);
  //     }
  //   }


  //   function _send() {
  //     if (connected === true) {
  //       if (queue.length > 0) {
  //         if (drained) {
  //           if (!socket.write(queue.shift())) {
  //             // kernel write buffer full; prevent 
  //             drained = false;
  //           }
  //           // console.log('**** chunk sent');
  //           _finish();
  //         }
  //         else {
  //           // write buffer not empty, pause for a second
  //         }
  //       }
  //     }
  //     else {
  //       if (typeof callback === 'function') {
  //         callback({msg: 'Not connected to graphite.'});
  //       }
  //     }
  //   }
    
  //   function _finish() {
  //     successCount++;
  //     // console.log('**** _finish(): successCount = ' + successCount + ', totalCount = ' + totalCount);
  //     if (successCount === totalCount) {
  //       // console.log('**** _finish():  queue empty');
  //       clearInterval(interval);
  //       interval = -1;
  //       successCount = 0;
  //       totalCount = 0;
  //       if (typeof callback === 'function') {
  //         callback();
  //       }
  //     }
  //   }

  //   _startQueue();

  //   // prepare data
  //   if (prefix.length > 0) {
  //     prefixFull = prefix + '.';
  //   }
  //   for (i = 0; i < data.length; i++) {
  //     timestamp = Math.round((parseInt(data[i].timestamp, 10) / 1000)).toString();
  //     row = prefixFull +
  //           metric +
  //           ' ' +
  //           data[i].value +
  //           ' ' +
  //           timestamp + '\n';

  //     // throttle bandwidth
  //     if (chunk.length + row.length > throttle) {
  //       queue.push(chunk);
  //       // console.log('**** queued chunk of length ' + chunk.length + ', total chunk count: ' + totalCount);
  //       chunk = row;
  //       totalCount++;
  //     }
  //     else {
  //       chunk += row;
  //     }
  //   }
  //   // send the last chunk
  //   if (chunk.length > 0) {
  //     // console.log('**** last chunk, size: ' + chunk.length);
  //     queue.push(chunk);
  //     chunk = '';
  //     totalCount++;
  //   }
  // }; // sendBlob()

  this.close = function() {
    if (connected === true) {
      self.emit("close");
      stop = true;
      socket.destroy();
    }
  }; // close()
};

util.inherits(GraphiteClient, EventEmitter);

module.exports = GraphiteClient;

})();