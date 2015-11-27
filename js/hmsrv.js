/*
 * hmsrv.js
 *
 * Receive and send data from Homematic CCU, store data in sqlite3 db and
 * make data accessible via XHR/Websocket for web applications.
 * 
 * 
 *   
 *
 * CC BY-NC 3.0
 *
 * Commercial use disallowed
 *
 *
 */

(function() {

'use strict';

var fs       = require ('fs');

if (!fs.existsSync(__dirname + '/options.json')) {
  console.error('File js/options.json is missing - copy js/options.dist.json to js/options.json and adapt to your ip adresses');
  process.exit(1);
}

var log      = require('./logger.js');
var mail     = require('./mail.js');
var utils    = require('./utils');
var options  = require('./options.json');

//
// REGA
//
var Rega     = require('./rega.js');
var regaData = ['channels', 'datapoints', 'devices', 'rooms'];
var regaHss;
var regaUp   = false;

//
// RPC
//
// var rpcType = 'plain';
var rpcType = 'bin';
var rpc     = (rpcType === 'bin') ? require('binrpc') : require('homematic-xmlrpc');
var rpcClient;
var rpcServer;
var rpcEventReceiverConnected = false;
var rpcReconectTimeout = 20000;
var rpcReconectCount = 0;

//
// Filesystem
//
var directories = {
  data: __dirname + '/../data',
  db  : __dirname + '/../db',
  log : __dirname + '/../log'
};

//
// DB
//
var db       = require('./db');
var dbDir    = directories.db;
var dbFile   = "hmsrv.sqlite";
var dbOpened = false;

var tableValues =
  'timestamp     INTEGER, ' +
  'id            INTEGER, ' +
  'value         REAL     ';

var tableValuesFull =
  'timestamp     INTEGER, ' +
  'id            INTEGER, ' +
  'value         REAL     ';

var tableDevices = 
  'Id            INTEGER, ' +
  'Address       TEXT   , ' + 
  'HssType       TEXT   , ' + 
  'Interface     TEXT   , ' + 
  'Name          TEXT   , ' + 
  'TypeName      TEXT   , ';

var tableChannels =
  'Id            INTEGER, ' + 
  'Address       TEXT   , ' + 
  'ChannelType   INTEGER, ' +
  'ChnDirection  INTEGER, ' +
  'ChnLabel      TEXT   , ' +
  'HssType       TEXT   , ' +
  'Name          TEXT   , ' +
  'Parent        INTEGER, ' +
  'TypeName      TEXT     ';

var tableDatapoints = 
  'Id            INTEGER, ' + 
  'Name          TEXT   , ' + 
  'Operations    INTEGER, ' + 
  'Parent        INTEGER, ' + 
  'Timestamp     INTEGER, ' + 
  'TypeName      TEXT   , ' + 
  'Value         INTEGER, ' + // boolean
  'ValueType     INTEGER, ' + 
  'ValueUnit     TEXT     ' +
  'record        INTEGER  ';

var tableRooms = 
  'Id            INTEGER, ' + 
  'EnumInfo      TEXT   , ' + 
  'Name          TEXT,    ' + 
  'TypeName      TEXT,    ';

var dbTables = [{'name': 'vals', 'sql': tableValues, 'data': null, 'clear': true},
                {'name': 'valsFull', 'sql': tableValuesFull, 'data': null, 'clear': true}];
var dbCacheVals = [];
var dbCacheValsFull = [];
var dbFlushId = 0;
var dbFlushInterval = 60000;

//
// Homematic data
//
var devices;
var channels;
var datapoints;
var rooms;
var dpIndex  = {};  // index of homematic adress > homeatic id
var dpValues = [];  // latest datapoint values to identify unchanged

var stopping = false;


/******************************************************************************
 *
 * REGA
 *
 */
function setupRega(callback) {
  regaHss = new Rega({
    ccuIp: options.ccu.ip,
    ready: function() {
      log.info('CCU: rega is ready.');
      regaUp = true;
      if (typeof callback === "function") {
        callback();
      }
    },
    down: function() {
      log.error('CCU: rega is down.');
    },
    unreachable: function() {
      log.error('CCU: rega is unreachable.');
    }
  });
}

function loadRegaData(index, callback) {
  if (index === 0) {
    regaHss.checkTime(function() {
    });
  }

  regaHss.runScriptFile(regaData[index], function(res, err) {
    if (!err) {
      var data = JSON.parse(res.stdout);

      if (regaData[index] === 'channels') {
        channels = data;
      }
      else if (regaData[index] === 'datapoints') {
        datapoints = data;
      }
      else if (regaData[index] === 'devices') {
        devices = data;
      }
      else if (regaData[index] === 'rooms') {
        rooms = data;
      }
      log.info('REGA: ' + regaData[index] + ' successfully read.');

      // save persistent data to disk for further processing
      fs.writeFile(directories.data + '/persistence-' + regaData[index] + '.json', JSON.stringify(data));

      index++;
      if (index < regaData.length) {
        loadRegaData(index, callback);
      }
      else {
        if (typeof callback === 'function') {
          callback();
        }
      }
    }
  });
}

function loadPersistentRegaData(index, callback) {
  if (!fs.existsSync(directories.data + '/persistence-' + regaData[index] + '.json')) {
    log.warn('REGA: File not found: ' + directories.data + '/persistence-' + regaData[index] + '.json');
    log.info('REGA: Persistent rega data not found, trying to fetch from CCU...');
    loadRegaData(0, function() {
      if (typeof callback === 'function') {
        callback();
      }
    });
  }
  else {
    fs.readFile(__dirname + '/../data/persistence-' + regaData[index] + '.json', function(err, data) {
      if (!err) {
        if (regaData[index] === 'channels') {
          channels = JSON.parse(data);
        }
        else if (regaData[index] === 'datapoints') {
          datapoints = JSON.parse(data);
        }
        else if (regaData[index] === 'devices') {
          devices = JSON.parse(data);
        }
        else if (regaData[index] === 'rooms') {
          rooms = JSON.parse(data);
        }
        log.info('REGA: ' + directories.data + '/persistence-' + regaData[index] + '.json successfully read.');

        index++;
        if (index < regaData.length) {
          loadPersistentRegaData(index, callback);
        }
        else {
          if (typeof callback === 'function') {
            callback();
          }
        }
      }
    });
  }
}


/******************************************************************************
 *
 * RPC
 *
 */
function setupRpc(callback) {
  setupRpcServer();
  // setup client delayed to ensure server is up
  setTimeout(function() {
    setupRpcClient(callback);
  }, 1000);
}

function setupRpcServer() {
  rpcServer = rpc.createServer({host: options.hmsrv.ip, port: options.hmsrv.rpcPort.toString()});

  rpcServer.on('system.listMethods', function (err, params, callback) {
      callback(['system.listMethods', 'system.multicall']);
  });
  rpcServer.on('system.multicall', function (err, params, callback) {
    for (var i in params[0]) {
      logEvent(params[0][i].params);
    }
    callback([]);
  });
  rpcServer.on('event', function (err, params, callback) {
    logEvent(params);
    if (typeof callback === 'function') {
      callback();
    }
  });
  rpcServer.on('NotFound', function (err, params, callback) {
    log.warn('RPC: "NotFound" occured on method ' + err);
    if (typeof callback === 'function') {
      callback();
    }
  });
}

function setupRpcClient(callback) {
  rpcClient = rpc.createClient({host: options.ccu.ip, port: options.ccu.rpcPort.toString()});

  // these methods are only available in xmlrpc_bin library
  if (rpcType === 'bin') {
    rpcClient.on('error', function(err) {
      // to do
      log.error('RPC: an error occured: ' + JSON.stringify(err));
    });
    rpcClient.on('connecting', function() {
      log.info('RPC: connecting...');
    });
    rpcClient.on('reconnecting', function() {
      log.info('RPC: reconnecting...');
    });
    rpcClient.on('connect', function() {
      rpcReconectCount = 0;
      log.info('RPC: client connected.');
      initRpcEventReceiver(callback);
      callback = null; // do not callback on re-connect
    });
    rpcClient.on('close', function() {
      rpcEventReceiverConnected = false;
      if (!stopping) {
        // reconnect
        rpcReconectCount++;
        setTimeout(function() {
          log.info('RPC: try to reconnect, approach ' + rpcReconectCount.toString());
          rpcClient.connect(true);
        }, rpcReconectTimeout);
      }
      log.info('RPC: connection closed.');
    });
  }
  else {
    initRpcEventReceiver(callback);
  }
}

function initRpcEventReceiver(callback) {
  var type = (rpcType === 'plain')? 'http://' : 'xmlrpc_bin://';
  rpcClient.methodCall('init', [
      type + options.hmsrv.ip + ':' + options.hmsrv.rpcPort.toString(),
      '123456'
    ],
    function (err, res) {
      if (err) {
        rpcEventReceiverConnected = false;
        log.error('RPC: "init" failed, retry in ' + rpcReconectTimeout.toString() + 's. ' + JSON.stringify(err));
      }
      else {
        rpcEventReceiverConnected = true;
        log.info('RPC: "init" successful.');
      }
      if (typeof callback === 'function') {
        callback();
      }
    }
  );
}

function closeRpc(callback) {
  if (rpcEventReceiverConnected) {
    var type = (rpcType === 'plain')? 'http://' : 'xmlrpc_bin://';
    rpcClient.methodCall('init', [
        type + options.hmsrv.ip + ':' + options.hmsrv.rpcPort.toString(),
        ''
      ],
      function (err, res) {
        if (err) {
          log.error('RPC: error closing connection to ccu.');
        }
        else {
          rpcEventReceiverConnected = false;
          log.info('RPC: connection closed successfully');
        }
        if (typeof callback === 'function') {
          callback();
        }
      }
    );
  }
  else {
    if (typeof callback === 'function') {
      callback();
    }
  }
}


/******************************************************************************
 *
 * DB
 *
 */
function setupDatabase(callback) {
  log.info('DB: Initialize Database');
  if (!fs.existsSync(dbDir + '/' + dbFile)) {
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir);
    }
    db.open(dbDir + '/' + dbFile, function() {
      dbOpened = true;
      db.createTables(dbTables, function() {
        log.info('DB: database created successfully.');
        callback();
      });
    });
  }
  else {
    db.open(dbDir + '/' + dbFile, function() {
      dbOpened = true;
      log.info('DB: opened successfully.');
      callback();
    });
  }
}

function flushDatabase(callback) {
  if (dbCacheVals.length > 0) {
    var vals = dbCacheVals;
    dbCacheVals = [];
    var valsFull = dbCacheValsFull;
    dbCacheValsFull = [];

    db.insertValues(dbTables[0], vals, function(count) {
      log.info('DB: flushed ' + count + ' values into table VALS');
      db.insertValues(dbTables[1], valsFull, function(count) {
        log.info('DB: flushed ' + count + ' values into table VALSFULL');
        if (typeof callback === 'function') {
          callback();
        }
      });
    });
  }
  else {
    if (typeof callback === 'function') {
      callback();
    }
  }
}

/******************************************************************************
 *
 * Filesystem
 *
 */
function setupFileSystem(callback) {
  // verify that all directories exist
  for (var i in directories) {
    if (!fs.existsSync(directories[i])) {
      fs.mkdirSync(directories[i]);
    }
  }
  if (typeof callback === 'function') {
    callback();
  }
}

function logEvent(event) {
  if (!stopping) {
    var timestamp = new Date().getTime();
    var id;
    var address = event[1];
    var name = event[2];
    var value = parseInt(event[3], 10);
    var status;
    var log = true;

    if (isNaN(value)) {
      if (typeof event[3] === 'boolean') {
        value = (event[3] === true)? 1 : 0;
        log.info('RPC: converted non numeric (boolean) to integer: ' + address + ', ' + name + ', ' + event[3] + ' -> ' + value);
      }
      else {
        log = false;
        log.warn('RPC: non numeric value: ' + address + ', ' + name + ', ' + event[3]);
      }
    }
    if (log) {
      id = dpIndex['BidCos-RF.' + address + '.' + name];

      if (id !== undefined) {
        status = '';
        if (dpValues[id] === undefined) {
          status = 'new';
          dpValues[id] = value;
          // push to db queue
          dbCacheVals.push({timestamp: timestamp, id: id, value: value});
        }
        else if (dpValues[id] === value) {
          status = 'unchanged';
        }
        else {
          status = 'changed';
          dpValues[id] = value;
          dbCacheVals.push({timestamp: timestamp, id: id, value: value});
        }
        log.verbose('HMSRV: ' + status + ' - ' + id + ', ' + address + ', ' + name + ', ' + value);
        dbCacheValsFull.push({timestamp: timestamp, id: id, value: value});
      }
      else {
        log.verbose('HMSRV: <unknown> ' + address + ', ' + name + ', ' + value);
      }
    }
  }
}


//
// ensure graceful shutdown
//
process.on('SIGTERM', shutdown.bind(null, {event: 'SIGTERM'}));
process.on('SIGINT', shutdown.bind(null, {event: 'SIGINT'}));

function shutdown(params) {
  if (!stopping) {
    stopping = true;
    log.info('HMSRV: received "' + params.event + '", shutting down...');

    closeRpc(function() {
      flushDatabase(function() {
        if (dbOpened) {
          db.close(function(err) {
            if (!err) {
              dbOpened = false;
              log.info('DB: closed successfully.');
            }
            else {
              log.warn('DB: error closing database.');
            }
          });
        }
        setTimeout(function() {
          process.exit();
        }, 2000);
      });
    });
  }
}


/******************************************************************************
 *
 * MAIN
 *
 */
var startTime = log.time();

setupFileSystem(function () {
  setupDatabase(function() {
    setupRega(function() {
      loadPersistentRegaData(0, function() {
        setupRpc(function() {

          var dpCount = 0;
          // build dpIndex for name <> id
          for (var i in datapoints) {
            dpIndex[unescape(datapoints[i].Name)] = i;
            dpCount++;
          }
          for (i in dpIndex) {
            log.verbose('HMSRV: dpIndex[' + i + '] = ' + dpIndex[i]);
          }
          log.info('HMSRV: dpIndex successfully build, ' + dpCount.toString() + ' entries.');

          var dbFlushId = setInterval(function() {
            flushDatabase();
          }, dbFlushInterval);

          log.time(startTime, 'HMSRV: Startup finished successfully after ');

          // // prevent node app from running as root permanently
          // var uid = parseInt(process.env.SUDO_UID);
          // // Set our server's uid to that user
          // if (uid){
          //   process.setuid(uid);
          // }
          // log.info('Server\'s UID is now ' + process.getuid());
        });
      });
    });
  });
});
// mail.send('Huhuuu', 'test message', function() {
// });

})();