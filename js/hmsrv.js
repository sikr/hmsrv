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

var log      = require('./logger.js');
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
// var rpc      = require('homematic-xmlrpc');
var rpc     = require('binrpc');
var rpcClient;
var rpcServer;
var rpcConnectionUp = false;

//
// DB
//
var db = require('./db');
var databaseDir  = "../db/";
var databaseFile = "hmsrv.sqlite";

var tableValues =
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

var databaseTables = [{'name': 'values', 'sql': tableValues, 'data': null, 'clear': true}];

//
// Homematic data
//
var devices;
var channels;
var datapoints;
var rooms;
var dpIndex  = {};  // index of homematic adress > homeatic id
var dpValues = [];  // latest datapoint values to identify unchanged


/******************************************************************************
 *
 * REGA
 *
 */
function setupRega(callback) {
  regaHss = new Rega({
    ccuIp: options.ccuIp,
    ready: function() {
      log.info('CCU rega is ready.');
      regaUp = true;
      if (typeof callback === "function") {
        callback();
      }
    },
    down: function() {
      log.error('CCU rega is down.');
    },
    unreachable: function() {
      log.error('CCU rega is unreachable.');
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
      fs.writeFile('../data/persistence-' + regaData[index] + '.json', JSON.stringify(data));

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
  if (!fs.existsSync(__dirname + '/../data/persistence-' + regaData[index] + '.json')) {
    log.error('File not found: ' + __dirname + '/../data/persistence-' + regaData[index] + '.json');
  }
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
      log.info('REGA: ../data/persistence-' + regaData[index] + '.json successfully read.');

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


/******************************************************************************
 *
 * RPC
 *
 */
function setupRpc(callback) {
  //
  // setup server
  //
  rpcServer = rpc.createServer({host: options.serverIp, port: options.serverPort.toString()});

  rpcServer.on('system.listMethods', function (err, params, callback) {
      callback(['system.listMethods', 'system.multicall']);
  });
  rpcServer.on('system.multicall', function (err, params, callback) {
    for (var i in params[0]) {
      logEvent(params[0][i].params);
      // log.info(params[0][i].params[1] + ', ' + 
      //          params[0][i].params[2] + ', ' +
      //          params[0][i].params[3]);
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
    log.warn('RPC "NotFound" occured on method ' + err);
    if (typeof callback === 'function') {
      callback();
    }
  });


  //
  // setup client (delayed to ensure server is started)
  //
  setTimeout(function() {
    rpcClient = rpc.createClient({host: options.ccuIp, port: options.ccuPort.toString()});

    rpcClient.on('error', function() {
      // to do
    });
    rpcClient.on('connecting', function() {
      // to do
    });
    rpcClient.on('connect', function() {
      rpcClient.methodCall('init', [
          // 'http://' + options.serverIp + ':' + options.serverPort.toString(),
          'xmlrpc_bin://' + options.serverIp + ':' + options.serverPort.toString(),
          '123456'
        ],
        function (err, res) {
          if (err) {
            log.error('RPC connecting to ccu rpc serverfailed.');
          }
          else {
            rpcConnectionUp = true;
            log.info('RPC connection to ccu successfully established.');
          }
          if (typeof callback === 'function') {
            callback();
          }
        }
      );
    });
    rpcClient.on('close', function() {
      // to do
      log.info('RPC connection closed!!!');
    });
  }, 1000);
}


/******************************************************************************
 *
 * DB
 *
 */
function setupDatabase(callback) {
  log.info('DB: Initialize Database');
  if (!fs.existsSync(databaseDir + databaseFile)) {
    if (!fs.existsSync(databaseDir)) {
      fs.mkdirSync(databaseDir);
    }
    db.open(databaseDir + databaseFile, function() {
      db.createTables(databaseDir + databaseFile, databaseTables);
      log.info('DB: database created successfully.');
      callback();
    });
  }
  else {
    db.open(databaseDir + databaseFile, function() {
      log.info('DB: opened successfully.');
      callback();
    });
  }
}

function logEvent(event) {
  if (isNaN(event[3])) {
    log.warn('RPC: non numeric value: ' + event[1] + ', ' + event[2] + ', ' + event[3]);
  }
  var id = dpIndex['BidCos-RF.' + event[1] + '.' + event[2]];

  if (id !== undefined) {

    var value = parseInt(event[3]);
    var state = '';

    if (dpValues[id] === undefined) {
      state = 'new';
      dpValues[id] = value;
    }
    else if (dpValues[id] === value) {
      state = 'unchanged';
    }
    else {
      state = 'changed';
      dpValues[id] = value;
    }
    log.verbose(state + ' - ' + id + ', ' + event[1] + ', ' + event[2] + ', ' + event[3]);
  }
  else {
    log.verbose('<unknown> ' + event[1] + ', ' + event[2] + ', ' + event[3]);
  }
}


//
// ensure graceful shutdown
//
process.on('SIGTERM', shutdown.bind(null, {event: 'SIGTERM'}));
process.on('SIGINT', shutdown.bind(null, {event: 'SIGINT'}));
process.on('exit', shutdown.bind(null, {event: 'exit'}));

function shutdown(params) {
  log.info('HMSRV received "' + params.event + '"');
  if (rpcConnectionUp) {
    log.info('RPC: closing xml rpc connection...');
    rpcClient.methodCall('init', [
        'http://' + options.serverIp + ':' + options.serverPort.toString(),
        ''
      ],
      function (err, res) {
        if (err) {
          log.error('RPC(init): error closing connection to ccu.');
        }
        else {
          rpcConnectionUp = false;
          log.info('RPC(init): connection to ccu closed.');
        }
        process.exit(0);
      }
    );
  }
  else {
    process.exit(0);
  }
}


/******************************************************************************
 *
 * MAIN
 *
 */

log.info('__dirname = ' + __dirname);

var t = log.time();

setupRega(function() {
  setupRpc(function() {
    loadPersistentRegaData(0, function() {
    // loadRegaData(0, function() {
      var dpCount = 0;
      // build dpIndex for name <> id
      for (var i in datapoints) {
        dpIndex[unescape(datapoints[i].Name)] = i;
        dpCount++;
      }
      for (i in dpIndex) {
        log.verbose('dpIndex[' + i + '] = ' + dpIndex[i]);
      }
      log.info('HMSRV: dpIndex successfully build, ' + dpCount.toString() + ' entries.');
      // setupDatabase(function() {
        log.time(t, 'Startup finished after ');
      // });
    });
  });
});



})();