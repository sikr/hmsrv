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
 * Notes:
 *
 * convert to localtime in sqlite: "SELECT datetime(timestamp / 1000, 'unixepoch', 'localtime')"
 *
 *
 */

(function() {

'use strict';

var fs = require ('fs');

if (!fs.existsSync(__dirname + '/options.json')) {
  console.error('File js/options.json is missing - copy js/options.dist.json to js/options.json and adapt to your ip adresses');
  process.exit(1);
}

var log     = require('./logger.js');
var mail    = require('./mail.js');
var utils   = require('./utils');
var options = require('./options.json');
var CronJob = require('cron').CronJob;

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
var rpcServerUp = false;
var rpcEventReceiverConnected = false;
var rpcReconectTimeout = 20;
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
// Homematic data
//
var devices;
var channels;
var datapoints;
var rooms;
var dpIndex  = {};  // index of homematic adress > homeatic id
var dpValues = [];  // latest datapoint values to identify changes

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

var tableDevices = 
  'Id            INTEGER, ' +
  'Address       TEXT,    ' + 
  'HssType       TEXT,    ' + 
  'Interface     TEXT,    ' + 
  'Name          TEXT,    ' + 
  'TypeName      TEXT     ';

var tableChannels =
  'Id            INTEGER, ' + 
  'Address       TEXT,    ' + 
  'ChannelType   INTEGER, ' +
  'ChnDirection  INTEGER, ' +
  'ChnLabel      TEXT,    ' +
  'HssType       TEXT,    ' +
  'Name          TEXT,    ' +
  'Parent        INTEGER, ' +
  'TypeName      TEXT     ';

var tableDatapoints = 
  'Id            INTEGER, ' + 
  'Name          TEXT,    ' + 
  'Operations    INTEGER, ' + 
  'Parent        INTEGER, ' + 
  'Timestamp     INTEGER, ' + 
  'TypeName      TEXT,    ' + 
  'Value         INTEGER, ' + // boolean
  'ValueList     TEXT,    ' +
  'ValueType     INTEGER, ' + 
  'ValueUnit     TEXT,    ' +
  'record        INTEGER  ';

var tableRooms = 
  'Id            INTEGER, ' + 
  'EnumInfo      TEXT,    ' + 
  'Name          TEXT,    ' + 
  'TypeName      TEXT     ';

var dbTables = {'values':     {'name': 'vals', 'sql': tableValues, 'data': null, 'clear': false},
                'valuesFull': {'name': 'valsFull', 'sql': tableValues, 'data': null, 'clear': false},
                'devices':    {'name': 'devices', 'sql': tableDevices, 'data': null, 'clear': false},
                'channels':   {'name': 'channels', 'sql': tableChannels, 'data': null, 'clear': false},
                'datapoints': {'name': 'datapoints', 'sql': tableDatapoints, 'data': null, 'clear': false},
                'rooms':      {'name': 'rooms', 'sql': tableRooms, 'data': null, 'clear': false}};
var dbCacheValues = [];
var dbCacheValuesFull = [];
var dbFlushId = 0;
var dbFlushInterval = 60; // flush once a minute to db
var countValues = 0;
var countValuesFull = 0;


var stopping = false;
var shutdownCount = 0;


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

function loadRegaData(callback) {
  db.readTableCount(dbTables.devices, function (err, data) {
    if (err) {
      log.error('HMSRV: error reading from database, ' + JSON.stringify(err));
    }
    else {
      var tables = [dbTables.devices, dbTables.channels, dbTables.datapoints, dbTables.rooms];

      if (data[0].count === 0) {
        loadRegaDataFromCCU(0, function () {

          // clean datapoints
          for (var i in datapoints) {
            datapoints[i].Timestamp = 0;
            if (datapoints[i].ValueUnit === '') {
              datapoints[i].ValueUnit = '';
            }
            if (datapoints[i].ValueList === undefined) {
              datapoints[i].ValueList = '';
            }
          }
          // write CCU rega data to db
          db.fillTables(tables, function() {
            if (typeof callback === 'function') {
              callback();
            }
          });
        });
      }
      else {
        // read rega data from db
        db.readTables(tables, function(_tables) {
          devices = _tables.devices;
          channels = _tables.channels;
          datapoints = _tables.datapoints;
          rooms = _tables.rooms;
          if (typeof callback === 'function') {
            callback();
          }
        });
      }
    }
  });
}

function loadRegaDataFromCCU(index, callback) {
  if (index === 0) {
    regaHss.checkTime(function() {
    });
  }

  regaHss.runScriptFile(regaData[index], function(res, err) {
    if (!err) {
      var data = JSON.parse(unescape(res.stdout));

      if (regaData[index] === 'channels') {
        channels =  dbTables.channels.data = data;
      }
      else if (regaData[index] === 'datapoints') {
        datapoints = dbTables.datapoints.data = data;
      }
      else if (regaData[index] === 'devices') {
        devices = dbTables.devices.data = data;
      }
      else if (regaData[index] === 'rooms') {
        rooms = dbTables.rooms.data = data;
      }
      log.info('REGA: ' + regaData[index] + ' successfully read, ' + data.length + ' entries.');

      // save persistent data to disk for further processing
      fs.writeFile(directories.data + '/persistence-' + regaData[index] + '.json', JSON.stringify(data));

      index++;
      if (index < regaData.length) {
        loadRegaDataFromCCU(index, callback);
      }
      else {
        if (typeof callback === 'function') {
          callback();
        }
      }
    }
  });
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
  if (rpcServerUp) {
    log.warn('RPC: server is already up; wont start again');
  }
  else {
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
        }, rpcReconectTimeout * 1000);
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
        log.error('RPC: "init" failed.');
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
      log.info('RPC: already closed');
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
  debugger;
  log.info('DB: Initialize Database');
  db.open(dbDir + '/' + dbFile, function() {
    dbOpened = true;
    log.info('DB: opened successfully.');
    db.initialize(dbTables, function(err) {
      if (!err) {
        log.info('DB: database initialized successfully.');
        callback();
      }
      else {
        log.error('DB: ' + err.msg);
        // unrecoverable error: shutdown
      }
    });
  });
}

function flushDatabase(callback) {
  if (dbCacheValues.length > 0) {
    var values = dbCacheValues;
    dbCacheValues = [];
    var valuesFull = dbCacheValuesFull;
    dbCacheValuesFull = [];

    db.insertValues(dbTables.values, values, function(count) {
      log.info('DB: flushed ' + count + ' values into table VALUES');
      countValues += count;
      db.insertValues(dbTables.valuesFull, valuesFull, function(count) {
        log.info('DB: flushed ' + count + ' values into table VALUESFULL');
        countValuesFull += count;
        if (typeof callback === 'function') {
          callback();
        }
      });
    });
  }
  else {
    if (typeof callback === 'function') {
      log.info('DB: nothing to flush');
      callback();
    }
  }
}

function closeDatabase(callback) {
  if (dbOpened) {
    db.close(function(err) {
      if (!err) {
        dbOpened = false;
        log.info('DB: closed successfully.');
      }
      else {
        log.warn('DB: error closing database. ' + JSON.stringify(err));
        setTimeout(closeDatabase, 5000);
      }
      if (typeof callback === 'function') {
        callback(err);
      }
    });
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
    var value = parseFloat(event[3]);
    var status;
    var store = true;


    if (isNaN(value)) {
      if (typeof event[3] === 'boolean') {
        value = (event[3] === true)? 1 : 0;
        log.info('RPC: converted non numeric (boolean) to integer: ' + address + ', ' + name + ', ' + event[3] + ' -> ' + value);
      }
      else {
        store = false;
        log.warn('RPC: non numeric value: ' + address + ', ' + name + ', ' + event[3]);
      }
    }
    if (store) {
      id = dpIndex['BidCos-RF.' + address + '.' + name];

      if (id !== undefined) {
        status = '';
        if (dpValues[id] === undefined) {
          status = 'new';
          dpValues[id] = value;
          // push to db queue
          dbCacheValues.push({timestamp: timestamp, id: id, value: value});
        }
        else if (dpValues[id] === value) {
          status = 'unchanged';
        }
        else {
          status = 'changed';
          dpValues[id] = value;
          dbCacheValues.push({timestamp: timestamp, id: id, value: value});
        }
        log.verbose('HMSRV: ' + status + ' - ' + id + ', ' + address + ', ' + name + ', ' + value);
        dbCacheValuesFull.push({timestamp: timestamp, id: id, value: value});
      }
      else {
        log.verbose('HMSRV: <unknown> ' + address + ', ' + name + ', ' + value);
      }
    }
  }
}

/******************************************************************************
 *
 * Cron
 *
 */
function setupCron() {
  var job = new CronJob({
    cronTime: '0 0 12 * * 0-6',
    onTick:  function () {
      var summary = 'Wrote ' + countValues + ' values to table VALUES, ' +
                    countValuesFull + ' to table VALUESFULL\n\n Cheers, hmsrv';
      mail.send('hmsrv summary', summary, function() {
      });
      countValues = 0;
      countValuesFull = 0;
    },
    start: true
  });
}



//
// ensure graceful shutdown
//
process.on('SIGTERM', shutdown.bind(null, {event: 'SIGTERM'}));
process.on('SIGINT', shutdown.bind(null, {event: 'SIGINT'}));
process.on("uncaughtException", function(err) {
  try {
    var msg = JSON.stringify(err.stack);
    if (options.hmsrv.productive === true) {
      mail.send('hmsrv uncaughtException', msg, function() {
      });
    }
    log.error(msg);
    shutdown.bind(null, {event: 'uncaughtException'});
  } catch (e) {
    // ...?
  }
});

function shutdown(params) {
  if (!stopping) {
    stopping = true;
    log.info('HMSRV: "' + params.event + '", shutting down...');

    closeRpc(function() {
      flushDatabase(function() {
        closeDatabase(function() {
          exit();
        });
      });
    });
  }
}

function exit() {
  shutdownCount++;
  if (!rpcEventReceiverConnected && !dbOpened) {
    log.info('HMSRV: shutdown successful, bye!');
    process.exit();
  }
  else if (shutdownCount > 2) {
    log.warn('HMSRV: shutdown failed for 3 times, bye anyway!');
    process.exit();
  }
  else {
    log.info('HMSRV: shutdown still in progress...');
    setTimeout(function() {
      exit();
    }, 10000);
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
      loadRegaData(function() {
        setupRpc(function() {

          var dpCount = 0;
          // build datapoint Index name <> id
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
          }, dbFlushInterval * 1000);

          setupCron();

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

})();