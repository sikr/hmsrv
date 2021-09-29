'use strict';

function HomematicRpc(adapter) {
  let rpc;
  let client = null;
  let server;
  let protocol;
  let clientConnected = false;
  let clientConnectIntervalHandle = null;
  const clientConnectInterval = adapter.options.clientConnectInterval || 30;
  let clientKeepAliveIntervalHandle = null;
  const clientKeepAliveInterval = adapter.options.clientKeepAliveInterval || 60;
  let clientInitSuccessful = false;
  let lastEvent = 0;
  let stop = false;

  const protocolBin = 'xmlrpc_bin://';
  const protocolXml = adapter.options.useHttps ? 'https://' : 'http://';

  if (adapter.options.type === 'bin') {
    rpc = require('binrpc');
    protocol = protocolBin;
  }
  else {
    rpc = require('homematic-xmlrpc');
    protocol = protocolXml;
  }

  /****************************************************************************
   *
   *
   */
  this.start = function() {
    adapter.log.debug('RPC[' + adapter.options.namespace + ']: start()');
    return new Promise(function(resolve, reject) {
      if (server) {
        adapter.log.warn('RPC[' + adapter.options.namespace + ']: server already up.');
        return;
      }
      // Promise.all([serverStart, clientConnect])
      serverStart()
      .then(() => {
        clientConnect()
        .then(() => {
          resolve();
        })
      })
    });
  };

  /****************************************************************************
   *
   *
   */
  function serverStart() {
    adapter.log.debug('RPC[' + adapter.options.namespace + ']: serverStart()');
    return new Promise(function(resolve, reject) {
      server = rpc.createServer({host: adapter.options.localIp, port: parseInt(adapter.options.localPort, 10)});
      adapter.log.info('RPC[' + adapter.options.namespace + ']: server listening on ' + adapter.options.localIp + ':' + parseInt(adapter.options.localPort, 10));

      server.on('system.listMethods', function (err, params, callback) {
        adapter.log.info('RPC[' + adapter.options.namespace + ']: system.listMethods called');
        callback(null, ['event', 'listDevices', /*'newDevices', */'system.listMethods', 'system.multicall']);
      });
      server.on('listDevices', function (err, params, callback) {
        adapter.log.info('RPC[' + adapter.options.namespace + ']: listDevices called, params: ' + JSON.stringify(params));
        callback(null);
      });
      server.on('system.multicall', function (err, params, callback) {
        adapter.log.debug(`RPC[${adapter.options.namespace}]: system.multicall called; ${params[0].length} events`);
        clientUpdateConnection();
        for (var i in params[0]) {
          adapter.event(params[0][i].params);
        }
        callback(null);
      });
      server.on('event', function (err, params, callback) {
        adapter.log.debug('RPC[' + adapter.options.namespace + ']: event called');
        clientUpdateConnection();
        adapter.event(params);
        if (typeof callback === 'function') {
          callback(null);
        }
      });
      server.on('NotFound', function (err, params, callback) {
        adapter.log.warn('RPC[' + adapter.options.namespace + ']: "NotFound" occured on method ' + err);
        if (typeof callback === 'function') {
          callback(null);
        }
      });
      resolve();
    });
   }

  /****************************************************************************
   *
   *
   */
  function serverStop() {
    adapter.log.debug('RPC[' + adapter.options.namespace + ']: serverStop()');
    return new Promise(function(resolve, reject) {
      if (client && client.socket && client.socket.destroy) {
        client.socket.destroy();
      }
      if (server) {
        try {
          if (server.close) {
            server.close(
              function() {
                adapter.log.info('RPC[' + adapter.options.namespace + ']: server shut down successful.');
                resolve();
              }
            );
          }
          else if (server.server && server.server.close) {
            server.server.close(
              function() {
                adapter.log.info('RPC[' + adapter.options.namespace + ']: server shut down successful.');
                resolve();
              }
            );
          }
        }
        catch (err) {
          adapter.log.warn('RPC[' + adapter.options.namespace + ']: server shut down failed: ' + err);
          reject();
        }
      }
    });
  }

  /****************************************************************************
   *
   *
   */
  function clientConnect() {
    adapter.log.debug('RPC[' + adapter.options.namespace + ']: clientConnect()');
    return new Promise(function(resolve, reject) {
      if (!client) {
        adapter.log.info('RPC[' + adapter.options.namespace + ']: creating client on ' + adapter.options.ccuIp + ':' + parseInt(adapter.options.ccuPort, 10) + '...');
        client = rpc.createClient({host: adapter.options.ccuIp, port: parseInt(adapter.options.ccuPort, 10)});
      }
      if (!clientInitSuccessful) {
        clientInit();
      }
      if (!clientConnectIntervalHandle) {
        clientConnectIntervalHandle = setInterval(clientInit, clientConnectInterval * 1000);
      }
      resolve();
    });
  }

  /****************************************************************************
   *
   *
   */
  function clientInit() {
    adapter.log.debug('RPC[' + adapter.options.namespace + ']: clientInit()');
    // if (!clientConnected) {
      const url = protocol + adapter.options.localIp + ':' + parseInt(adapter.options.localPort, 10);
      try {
        client.methodCall('init', [url, `${adapter.options.namespace}_${adapter.instanceId}_${adapter.runMode}`],
          function (err) {
            if (err) {
              clientConnected = false;
              adapter.log.error('RPC[' + adapter.options.namespace + ']: "init" failed: ' + err);
            }
            else {
              clientInitSuccessful = true;
              clientUpdateConnection();
              adapter.log.info('RPC[' + adapter.options.namespace + ']: "init" client successful.');
            }
          }
        );
      }
      catch (err) {
        adapter.log.error('RPC[' + adapter.options.namespace + ']: (exception) "init" failed: ' + err);
      }
    // }
  }

  /****************************************************************************
   *
   *
   */
  function clientDisconnect() {
    adapter.log.debug(`RPC[${adapter.options.namespace}]: clientDisconnect()`);
    return new Promise(function(resolve, reject) {
      if (client) {
        const url = protocol + adapter.options.localIp + ':' + parseInt(adapter.options.localPort, 10);
        try {
          client.methodCall('init', [url, ''],
            function (err) {
              if (err) {
                clientConnected = false;
                adapter.log.error(`RPC[${adapter.options.namespace}]: disconnect failed: ${err}`);
              }
              else {
                clientConnected = false;
                adapter.log.info(`RPC[${adapter.options.namespace}]: client disconnected successful.`);
              }
              resolve();
            }
          );
        }
        catch (err) {
          adapter.log.error(`RPC[${adapter.options.namespace}]: (exception) disconnect failed: ${err}`);
          resolve();
        }
      }
      resolve();
    });
  }
  
  /****************************************************************************
   *
   *
   */
  function clientUpdateConnection() {
    adapter.log.debug('RPC[' + adapter.options.namespace + ']: clientUpdateConnection()');
    lastEvent = new Date().getTime();

    if (!clientConnected) {
      clientConnected = true;
      adapter.log.info('RPC[' + adapter.options.namespace + ']: client connected');
    }

    if (!clientInitSuccessful) {
      clientInit();
    }

    if (clientConnectIntervalHandle) {
      clearTimeout(clientConnectIntervalHandle);
      clientConnectIntervalHandle = null;
    }
    if (!clientKeepAliveIntervalHandle) {
      adapter.log.info('RPC[' + adapter.options.namespace + ']: starting ping interval...');
      clientKeepAliveIntervalHandle = setInterval(clientKeepAlive, clientKeepAliveInterval * 1000 / 2);
    }
  }

  /****************************************************************************
   *
   *
   */
  function clientKeepAlive() {
    adapter.log.debug('RPC[' + adapter.options.namespace + ']: clientKeepAlive()');
    if (!stop) {
      if (clientConnectIntervalHandle) {
        clearTimeout(clientConnectIntervalHandle);
        clientConnectIntervalHandle = null;
      }
      var now = new Date().getTime();

      adapter.log.debug(`RPC[${adapter.options.namespace}]: last event is ${(now - lastEvent) / 1000} s ago...`);

      if (!lastEvent || (now - lastEvent) > clientKeepAliveInterval * 1000) {
        clientConnect();
      }
      else {
        clientPing();
      }
    }
  }

  /****************************************************************************
   *
   *
   */
  function clientPing() {
    adapter.log.debug('RPC[' + adapter.options.namespace + ']: clientPing()');
    if (client) {
      // const url = protocol + adapter.options.localIp + ':' + parseInt(adapter.options.localPort, 10);
      try {
        client.methodCall('ping', [adapter.options.namespace],
          function (err/*, res*/) {
            if (err) {
              clientConnected = false;
              clientInitSuccessful = false;
              adapter.log.error('RPC[' + adapter.options.namespace + ']: "ping" failed: ' + err);
              clientConnect();
            }
            else {
              clientConnected = true;
              adapter.log.debug('RPC[' + adapter.options.namespace + ']: "ping" successful.');
            }
          }
        );
      }
      catch (err) {
        adapter.log.error('RPC[' + adapter.options.namespace + ']: (exception) - "ping" failed: ' + err);
      }
    }
    else {
      adapter.log.warn('RPC[' + adapter.options.namespace + ']: client not connected.');
      if (clientConnected) {
        clientConnected = false;
        clientInitSuccessful = false;
        clientConnect();
      }
    }
  }
  this.stop = function() {
    adapter.log.debug(`RPC[${adapter.options.namespace}]: stop()`);
    return new Promise(function (resolve, reject) {
      stop = true;
      clientDisconnect()
      .then(() => {
        serverStop()
        .then(() => {
          resolve();
        })
      });
    });
  }
}
module.exports = {
  HomematicRpc: HomematicRpc
};
