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

var log         = require('./logger.js');
var mail        = require('./mail.js');
var utils       = require('./utils');
var optionsFile = require('./options.json');
var persistence = require('../data/persistence.json');
var options     = null;
var CronJob     = require('cron').CronJob;
var summaryJob  = null;
var assert      = require('assert');
var os          = require('os');

//
// SERVER
//
var key         = fs.readFileSync('../ssl/key.pem');
var certificate = fs.readFileSync('../ssl/cert.pem');
var credentials = { key: key, cert: certificate};
var express     = require('express');
var app         = express();
var socketio    = require('socket.io');
var net         = require('net');
var webSockets  = [];
var io;
var https       = require('https');
var httpsServer = https.createServer(credentials, app);
var stats       = {
  startTime: new Date(),
  runMode: 'DEVELOPMENT',
  servedRequests: 0,
  servedRequestSize: 0,
  hostname: os.hostname()
};

//
// REGA
//
var Rega        = require('./rega.js');
var regaData    = ['channels', 'datapoints', 'devices', 'rooms'];
var regaHss;
var regaUp      = false;

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
var devices    = {};
var channels   = {};
var datapoints = {};
var rooms      = {};
var dpIndex    = {}; // index of homematic adress > homeatic id
var dpValues   = []; // latest datapoint values to identify changes

//
// DB
//
var db       = require('./db');
var dbDir    = directories.db;
var dbFile;
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
                'valuesFull': {'name': 'valsFull', 'sql': tableValues, 'data': null, 'clear': false}};
                // 'devices':    {'name': 'devices', 'sql': tableDevices, 'data': null, 'clear': false},
                // 'channels':   {'name': 'channels', 'sql': tableChannels, 'data': null, 'clear': false},
                // 'datapoints': {'name': 'datapoints', 'sql': tableDatapoints, 'data': null, 'clear': false},
                // 'rooms':      {'name': 'rooms', 'sql': tableRooms, 'data': null, 'clear': false}};
var dbCacheValues = [];
var dbCacheValuesFull = [];
var dbFlushingPaused = false;
var dbFlushId = 0;
var dbFlushInterval = 60; // flush once a minute to db
var countValues = 0;
var countValuesFull = 0;

var Graphite = require('./graphite.js');
var graphite;
var graphiteCacheValuesFull = [];

var stopping = false;
var shutdownCount = 0;


/******************************************************************************
 *
 * SERVER
 *
 */
function setupServer() {

  var response = '';

  // static content webserver
  app.use('/', express.static('../www/'));

  // logging
  app.use(function (req, res, next) {
    log.info('HMSRV: request:' + req.url);
    stats.servedRequests++;
    next();
  });

  app.get('/devices', function (req, res, next) {
    response = devices;
    next();
  }, sendResponse);

  app.get('/channels', function (req, res, next) {
    response = channels;
    next();
  }, sendResponse);

  app.get('/datapoints', function (req, res, next) {
    response = datapoints;
    next();
  }, sendResponse);

  app.get('/rooms', function (req, res, next) {
    response = rooms;
    next();
  }, sendResponse);

  app.get('/values', function (req, res, next) {
    var id = parseInt(req.query.id, 10);
    if (!isNaN(id)) {
      db.readId(dbTables.values, id, function(err, data) {
        if (!err) {
          response = data;
        }
        else {
          response = {'msg': 'error reading database'};
        }
      });
    }
    next();
  }, sendResponse);

  app.get('/value', function (req, res, next) {
    var id = parseInt(req.query.id, 10);
    if (!isNaN(id)) {
      if (dpValues[id] !== undefined) {
        response = {
          id: id,
          timestamp: dpValues[id].timstamp,
          value: dpValues[id].value
        };
      }
      else {
        response = {"msg": "not available"};
      }
    }
    next();
  }, sendResponse);

  app.get('/stats', function (req, res, next) {
    response = {stats: stats};
    next();
  }, sendResponse);

  function sendResponse(req, res) {
    res.header("Access-Control-Allow-Origin", "*");
    if (typeof response === 'object') {
      response = JSON.stringify(response);
    }
    stats.servedRequestSize += response.length;
    res.send(response);
  }

  // create secure server 
  var port = options.hmsrv.httpsPort || 443;
  httpsServer.listen(port);

  // websocket server
  io = socketio.listen(httpsServer);

  io.on('connection', function (socket) {
    webSockets.push(socket);
    log.info('HMSRV: websocket: %s successfully connected', socket.handshake.address);
    socket.on('disconnect', function (socket) {
      log.info('HMSRV: websocket: %s disconnected', this.handshake.address);
    });
    socket.on('system', function (data) {
      var msg = JSON.parse(data).msg;
      if (msg === 'shutdown') {
        shutdown({event: 'usershutdown'});
      }
      else if (msg === 'mail') {
        mail.send('hmsrv test mail\n\n', getSummary(), function() {
        });
      }
      else if (msg === 'graphite-export') {
        if (checkGraphiteConfig()) {
          log.info('HMSRV: starting graphite export...');
          graphiteExport(function(result) {
            pushToWebSockets({'graphite-export': result});
          });
        }
        else {
          info.warn('HMSRV: graphite export failed due to erroneous configuration');
        }
      }
      log.debug(data);
    });
    // socket.emit('ping');
  });
}

function pushToWebSockets(method, message) {
  for (var socket in webSockets) {
    webSockets[socket].emit(method, JSON.stringify(message));
  }
}


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
  loadRegaDataFromFile(function(ret) {
    if (ret === false) {
      loadRegaDataFromCCU(0, function () {

        // clean datapoints
        for (var i in datapoints) {
          datapoints[i].Timestamp = 0;
          // if (datapoints[i].ValueUnit === '') {
          //   datapoints[i].ValueUnit = '';
          // }
          // if (datapoints[i].ValueList === undefined) {
          //   datapoints[i].ValueList = '';
          // }
        }
        writeRegaDataToFile(callback);
      });
    }
    else {
      if (typeof callback === 'function') {
        callback();
      }
    }
  });

  // db.readTableCount(dbTables.devices, function (err, data) {
  //   if (err) {
  //     log.error('HMSRV: error reading from database, ' + JSON.stringify(err));
  //   }
  //   else {
  //     var tables = [dbTables.devices, dbTables.channels, dbTables.datapoints, dbTables.rooms];

  //     if (data[0].count === 0) {
  //       loadRegaDataFromCCU(0, function () {

  //         // clean datapoints
  //         for (var i in datapoints) {
  //           datapoints[i].Timestamp = 0;
  //           if (datapoints[i].ValueUnit === '') {
  //             datapoints[i].ValueUnit = '';
  //           }
  //           if (datapoints[i].ValueList === undefined) {
  //             datapoints[i].ValueList = '';
  //           }
  //         }
  //         // write CCU rega data to db
  //         db.fillTables(tables, function() {
  //           if (typeof callback === 'function') {
  //             callback();
  //           }
  //         });
  //       });
  //     }
  //     else {
  //       // read rega data from db
  //       db.readTables(tables, function(_tables) {
  //         devices = _tables.devices;
  //         channels = _tables.channels;
  //         datapoints = _tables.datapoints;
  //         rooms = _tables.rooms;
  //         if (typeof callback === 'function') {
  //           callback();
  //         }
  //       });
  //     }
  //   }
  // });
}

function writeRegaDataToFile(callback) {
  var _regaData = [];
  var i;

  for (i in regaData) {
    _regaData.push(regaData[i]);
  }

  function write(fileName) {
    if (fileName) {
      var mode = (stats.runMode !== 'PRODUCTION')? '.' + stats.runMode.toLowerCase() : '';
      var fullPath = __dirname + '/../data/' + fileName + mode + '.json';
      var data;
      switch (fileName) {
        case 'channels':
          data = JSON.stringify(channels);
          break;
        case 'datapoints' :
          data = JSON.stringify(datapoints);
          break;
        case 'devices' :
          data = JSON.stringify(devices);
          break;
        case 'rooms' :
          data = JSON.stringify(rooms);
          break;
        default:
          log.error('HMSRV: error writing rega data to file, unknown file: ' + fullPath);
          break;
      }
      fs.writeFile(fullPath, data, function(err, data) {
        if (err) {
          log.error('HMSRV: error reading rega data from file: ' + fullPath);
        }
        else {
        }
        return write(_regaData.shift());
      });
    }
    else {
      if (typeof callback === 'function') {
        callback(true);
      }
    }
  }
  write(_regaData.shift());
}

function loadRegaDataFromFile(callback) {
  var _regaData = [];
  var i;

  for (i in regaData) {
    _regaData.push(regaData[i]);
  }

  function read(fileName) {
    if (fileName) {
      var mode = (stats.runMode !== 'PRODUCTION')? '.' + stats.runMode.toLowerCase() : '';
      var fullPath = __dirname + '/../data/' + fileName + mode + '.json';
      fs.stat(fullPath, function(err, stats) {
        if (err) {
          // file does not exist
          callback(false);
        }
        else {
          if (stats.isFile()) {
            fs.readFile(fullPath, function(err, data) {
              if (err) {
                log.error('HMSRV: error reading rega data from file: ' + fullPath);
              }
              else {
                switch (fileName) {
                  case 'channels':
                    channels = JSON.parse(data);
                    break;
                  case 'datapoints':
                    datapoints = JSON.parse(data);
                    break;
                  case 'devices':
                    devices = JSON.parse(data);
                    break;
                  case 'rooms':
                    rooms = JSON.parse(data);
                    break;
                  default:
                    log.error('HMSRV: error reading rega data from file, unknown file: ' + fullPath);
                    break;
                }
              }
              return read(_regaData.shift());
            });
          }
          else {
            log.error('HMSRV: cannot read from file ' + fullPath);
            // unrecoverable error: shutdown
            shutdown({event: 'emergenacyshutdown'});
          }
        }
      });
    }
    else {
      if (typeof callback === 'function') {
        callback(true);
      }
    }
  }
  read(_regaData.shift());
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
      log.info('REGA: ' + regaData[index] + ' successfully read, ' + Object.keys(data).length + ' entries.');

      // // save persistent data to disk for further processing
      // fs.writeFile(directories.data + '/persistence-' + regaData[index] + '.json', JSON.stringify(data));

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
        if (rpcReconectCount == 10 && options.hmsrv.productive === true) {
          mail.send('HMSRV ERROR: RPC reconnect failed 10 times!!!',
            'Hi,\n\nthe RPC reconnect failed for 10 times now! Check this soon!\n\nCheers, HMSRV',
            function() {
          });
        }
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
  log.info('DB: Initialize Database - ' + dbDir + '/' + dbFile);
  db.open(dbDir + '/' + dbFile, function() {
    dbOpened = true;
    log.info('DB: opened successfully.');
    db.initialize(dbTables, function(err) {
      if (!err) {
        log.info('DB: database initialized successfully.');
        // db.readLatestValues(dbTables.values, function(err, data) {
        //   if (!err) {
        //     for (var i in data) {
        //       dpValues[data[i]._id] = {timestamp: data[i].timestamp, value: data[i].value};
        //     }
        //     callback();
        //   }
        //   else {
        //     log.error('DB: ' + err.msg);
        //     // unrecoverable error: shutdown
        //     shutdown({event: 'emergenacyshutdown'});
        //   }
        // });
        if (typeof callback === 'function') {
          callback();
        }
      }
      else {
        log.error('DB: ' + err.msg);
        // unrecoverable error: shutdown
        shutdown({event: 'emergenacyshutdown'});
      }
    });
  });
}

function flushDatabase(callback) {
  if (dbFlushingPaused) {
    log.info('DB: flushing paused');
    if (typeof callback === 'function') {
      callback();
    }
  }
  else if (dbCacheValuesFull.length > 0) {
    var values = dbCacheValues;
    dbCacheValues = [];
    var valuesFull = dbCacheValuesFull;
    dbCacheValuesFull = [];

    // db.insertValues(dbTables.values, values, function() {
    //   log.info('DB: ' + values.length + ' flushed');
    //   countValues += values.length;
    //   db.insertValues(dbTables.valuesFull, valuesFull, function() {
    //     log.info('DB: ' + valuesFull.length + ' flushed (full)');
    //     countValuesFull += valuesFull.length;
    //   });
    // });
  }
  else {
    log.info('DB: nothing to flush');
    if (typeof callback === 'function') {
      callback();
    }
  }
}

function closeDatabase(callback) {
  if (typeof callback !== 'function') {
    // throw
  }
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
      callback(err);
    });
  }
  else {
    callback();
  }
}


/******************************************************************************
 *
 * Graphite
 *
 */
function setupGraphite(callback) {
  if (checkGraphiteConfig()) {
    var _options = {
      ip: options.graphite.ip,
      port: options.graphite.port,
      prefix: options.graphite.prefix
    };
    graphite = new Graphite(_options);

    graphite.connect(function(err) {
      callback(err);
    });
  }
  else {
    log.warn('Incomplete Graphite config');
  }
} // setupGraphite()

function checkGraphiteConfig() {
  if (options.graphite &&
      options.graphite.ip &&
      options.graphite.port !== '0.0.0.0') {
    return true;
  }
  else {
    info.warn('HMSRV: incomplete graphite config');
  }
} // checkGraphiteConfig

function graphiteExport(callback) {
  assert(typeof callback === 'function');
  dbFlushingPaused = true;
  var metrics = [];
  var totalCount = 0;

  function startExport() {
    for (var i in persistence) {
      if (typeof persistence[i].graphite !== undefined) {
        metrics.push(i);
        totalCount++;
      }
    }
    log.info('HMSRV: ids to export to graphite: ' + metrics.join(','));
    _export(metrics.shift());
  }

  function _export(metric) {
    if (metric) {
      db.readIdRaw(dbTables.valuesFull, metric, function(err, data) {
        if (!err) {
          log.info('HMSRV: sending blob for datapoint ' + persistence[metric].graphite.path + ' with ' + data.length + ' entries to graphite');
          graphite.sendBlob(persistence[metric].graphite.path, data, function(err) {
            if (!err) {
              _export(metrics.shift());
            }
            else {
              callback(err);
            }
          });
        }
        else {
          log.error('HMSRV: error reading datapoint ' + persistence[metric].graphite.path);
        }
      });
    }
    else {
      log.info('HMSRV: export to Graphite finished');
      dbFlushingPaused = false;
      callback();
    }
  }
  startExport();
} // graphiteExport

function flushGraphite(callback) {
  if (graphiteCacheValuesFull.length > 0) {
    var graphiteValues = graphiteCacheValuesFull;
    graphiteCacheValuesFull = [];

    graphite.send(graphiteValues, function() {
      log.info('GRAPHITE: ' + graphiteValues.length + 'flushed');
      if (typeof callback === 'function') {
        callback();
      }
    });
  }
  else {
    log.info('Graphite: nothing to flush');
    if (typeof callback === 'function') {
      callback();
    }
  }
} //flushGraphite


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
          dpValues[id] = {timestamp: timestamp, value: value};
          // push to db queue
          dbCacheValues.push({timestamp: timestamp, id: id, value: value});
        }
        else if (dpValues[id].value === value) {
          status = 'unchanged';
        }
        else {
          status = 'changed';
          dpValues[id] = {timestamp: timestamp, value: value};
          dbCacheValues.push({timestamp: timestamp, id: id, value: value});
        }
        log.verbose('HMSRV: ' + status + ' - ' + id + ', ' + address + ', ' + name + ', ' + value);
        pushToWebSockets('update', {timestamp: timestamp, status: status, id: id, address: address, name: name, value: value});
        dbCacheValuesFull.push({timestamp: timestamp, id: id, value: value});
        if (persistence[id] && persistence[id].graphite) {
          graphiteCacheValuesFull.push({
            path: persistence[id].graphite.path,
            value: value,
            timestamp: timestamp
          });
        }
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
  summaryJob = new CronJob({
    cronTime: '0 0 12 * * 0-6',
    onTick:  function () {
      mail.send('hmsrv summary', getSummary(), function() {
      });
      countValues = 0;
      countValuesFull = 0;
    },
    start: true
  });
}

function stopCron() {
  summaryJob.stop();
}

function getSummary() {
  return 'Hi!\n\n' +
         'This is the HMSRV summary for today:\n\n' +
         countValues + ' values written to table VALUES\n' +
         countValuesFull + ' values written to table VALUESFULL\n' +
         stats.servedRequests + ' requests handled\n' +
         Math.round(stats.servedRequestSize/1024) + ' kBytes delivered\n' +
         'HMSRV is running in ' + stats.runMode + ' mode\n' +
         'Uptime: ' + utils.getHumanReadableTimeSpan(stats.startTime, new Date()) + '\n' +
         'Starttime ' + utils.getPrettyDate(stats.startTime) + '\n\n' +
         'Cheers, HMSRV\n';
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

    stopCron();
    closeRpc(function() {
      // flushDatabase(function() {
      flushGraphite(function() {
        // closeDatabase(function() {
          exit();
        // });
      });
    });
  }
}

function exit() {
  shutdownCount++;
  if (!rpcEventReceiverConnected && !dbOpened) {
    log.info('HMSRV: shutdown successful, bye!');

    log.info('HMSRV was running for ' +
           utils.getHumanReadableTimeSpan(stats.startTime, new Date()) +
           ' since ' + utils.getPrettyDate(stats.startTime));

    process.exit();
  }
  else if (shutdownCount > 15) {
    log.warn('HMSRV: shutdown failed for 3 times, bye anyway!');
    process.exit();
  }
  else {
    log.info('HMSRV: shutdown still in progress...');
    setTimeout(function() {
      exit();
    }, 1000);
  }
}


function parseArgs() {

  for (var i = 2; i < process.argv.length; i++) {
    if (process.argv[i] == '--production') {
      stats.runMode = 'PRODUCTION';
    }
    else if (process.argv[i] == '--development') {
      stats.runMode = 'DEVELOPMENT';
    }
    else if (process.argv[i] == '--test') {
      stats.runMode = 'TEST';
    }
    else {
      console.log('Error: uknown paramter ' + process.argv[2]);
      process.exit(1);
    }
  }
}

/******************************************************************************
 *
 * MAIN
 *
 */
var startTime = log.time();

parseArgs();

switch (stats.runMode) {
  case 'DEVELOPMENT':
  {
    options = optionsFile.development;
    break;
  }
  case 'TEST':
  {
    options = optionsFile.test;
    break;
  }
  case 'PRODUCTION':
  {
    options = optionsFile.production;
    break;
  }
  default:
  {
    console.error('HMSRV: unknown run mode');
    exit();
  }
}
if (options === undefined) {
  console.error('File options.json doesn\'t contain configuration for runmode "' + stats.runMode + '"');
  process.exit(1);
}

dbFile  = options.sqlite.filename;

log.init(options);
log.info('Starting HMSRV in ' + stats.runMode + ' mode');
log.info('Visit https://' + options.hmsrv.ip + ':' + options.hmsrv.httpsPort.toString());
mail.init(options);

setupServer();

setupFileSystem(function () {
  // setupDatabase(function() {
    setupGraphite(function() {
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
              flushGraphite();
            }, dbFlushInterval * 1000);

            setupCron();

            log.time(startTime, 'HMSRV: *** Startup finished successfully after ');

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
  // });
});

})();
