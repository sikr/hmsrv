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
    return new Promise(function(resolve, reject) {
      adapter.log.debug('RPC[' + adapter.options.namespace + ']: start()');
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
    return new Promise(function(resolve, reject) {
      adapter.log.debug('RPC[' + adapter.options.namespace + ']: serverStart()');
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
        adapter.log.verbose('RPC[' + adapter.options.namespace + ']: system.multicall called');
        clientUpdateConnection();
        for (var i in params[0]) {
          adapter.event(params[0][i].params);
        }
        callback(null);
      });
      server.on('event', function (err, params, callback) {
        adapter.log.verbose('RPC[' + adapter.options.namespace + ']: event called');
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
    return new Promise(function(resolve, reject) {
      adapter.log.debug('RPC[' + adapter.options.namespace + ']: serverStop()');
      if (server) {
        try {
          if (server.close) {
            server.close(
              function() {
                adapter.log.info('RPC[' + adapter.options.namespace + ']: server shut down successful.');
                // server.unref();
                resolve();
              }
            );
          }
          else if (server.server && server.server.close) {
            server.server.close(
              function() {
                adapter.log.info('RPC[' + adapter.options.namespace + ']: server shut down successful.');
                // server.unref();
                resolve();
              }
            );
          }
        }
        catch (err) {
          adapter.log.warn('RPC[' + adapter.options.namespace + ']: server shut down failed: ' + err);
          resolve();
        }
      }
      if (client && client.socket && client.socket.destroy) {
        // hm has destroy
        client.socket.destroy();
      }
    });
  }

  /****************************************************************************
   *
   *
   */
  function clientConnect() {
    return new Promise(function(resolve, reject) {
      adapter.log.debug('RPC[' + adapter.options.namespace + ']: clientConnect()');
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
    const url = protocol + adapter.options.localIp + ':' + parseInt(adapter.options.localPort, 10);
    try {
      client.methodCall('init', [url, adapter.options.namespace],
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
  }

  /****************************************************************************
   *
   *
   */
  function clientDisconnect() {
    return new Promise(function(resolve, reject) {
      adapter.log.debug(`RPC[${adapter.options.namespace}]: clientDisconnect()`);
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
              adapter.log.error('RPC[' + adapter.options.namespace + ']: "ping" failed: ' + err);
              clientConnect();
            }
            else {
              clientConnected = true;
              adapter.log.verbose('RPC[' + adapter.options.namespace + ']: "ping" successful.');
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
        clientConnect();
      }
    }
  }
  this.stop = function() {
    return new Promise(function (resolve, reject) {
      adapter.log.debug(`RPC[${adapter.options.namespace}]: stop()`);
      stop = true;
      clientDisconnect()
      .then(() => {
        adapter.log.debug("foo");
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
