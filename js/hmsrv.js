/*
 * hmsrv.js
 *
 * Receive and send data from Homematic CCU, store data in graphite db and
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
// var assert      = require('assert');
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
var Rpc = require('./hmrpc.js');
var hmrpc = [];
const rpcNoCUxD = 1;

//
// Filesystem
//
var directories = {
  data: __dirname + '/../data',
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

var nFlushInterval = 60; // flush once a minute to graphite
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
    // var id = parseInt(req.query.id, 10);
    // if (!isNaN(id)) {
    //   db.readId(dbTables.values, id, function(err, data) {
    //     if (!err) {
    //       response = data;
    //     }
    //     else {
    //       response = {'msg': 'error reading database'};
    //     }
    //   });
    // }
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
  io = socketio(httpsServer);

  io.on('connection', function (socket) {
    webSockets.push(socket);
    log.info(`HMSRV: websocket: ${socket.handshake.address} successfully connected`);
    socket.on('disconnect', function (/*socket*/) {
      log.info(`HMSRV: websocket: ${this.handshake.address} disconnected`);
    });
    socket.on('system', function (data) {
      var msg = JSON.parse(data).msg;
      if (msg === 'shutdown') {
        shutdown({event: 'usershutdown'});
      }
      // else if (msg === 'mail') {
      //   mail.send('hmsrv test mail\n\n', getSummary(), function() {
      //   });
      // }
      log.debug(data);
    });
    // socket.emit('ping');
  });
} //setupServer()

function pushToWebSockets(method, message) {
  for (var socket in webSockets) {
    webSockets[socket].emit(method, JSON.stringify(message));
  }
} // pushToWebSockets()


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
      // if (typeof callback === "function") {
      //   callback();
      // }
    },
    down: function() {
      log.error('CCU: rega is down.');
    },
    unreachable: function() {
      log.error('CCU: rega is unreachable.');
    }
  });
} // setupRega()

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
} // loadRegaData()

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
      fs.writeFile(fullPath, data, function(err/*, data*/) {
        if (err) {
          log.error('HMSRV: error reading rega data from file: ' + fullPath);
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
} // writeRegaDataToFile()

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
} // loadRegaDataFromFile()

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
} // loadRegaDataFromCCU()

/******************************************************************************
 *
 * RPC
 *
 */
function setupRpc(rpc, callback) {
  for (var i = 0; i < (rpc.length-rpcNoCUxD); i++) {
    hmrpc[i] = new Rpc.HomematicRpc({options: options.ccu.rpc[i], log: log, event: logEvent});
    hmrpc[i].start();
  }
  if (typeof callback === "function") {
    callback();
  }
} // setupRpc()

function stopRpc(callback) {
  for (var i = 0; i < (hmrpc.length); i++) {
    hmrpc[i].stop();
  }
  if (typeof callback === "function") {
    callback();
  }
} // stopRpc()

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
    log.warn('HMSRV: incomplete graphite config');
  }
} // checkGraphiteConfig()

function flushGraphite(callback) {
  if (graphiteCacheValuesFull.length > 0) {
    var graphiteValues = graphiteCacheValuesFull;
    graphiteCacheValuesFull = [];

    graphite.send(graphiteValues, function() {
      log.info('GRAPHITE: ' + graphiteValues.length + ' values flushed');
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
} //flushGraphite()


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
} // setupFileSystem()

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
        log.debug('RPC: converted non numeric (boolean) to integer: ' + address + ', ' + name + ', ' + event[3] + ' -> ' + value);
      }
      else {
        store = false;
        log.debug('RPC: non numeric value: ' + address + ', ' + name + ', ' + event[3]);
      }
    }
    if (store) {
      id = dpIndex['BidCos-RF.' + address + '.' + name];
      if (id === undefined) {
        id = dpIndex['HmIP-RF.' + address + '.' + name];
      }      

      if (id !== undefined) {

        // // hack to solve HM-ES-TX-WM overflow at 838860,7 Wh
        // if (parseInt(id, 10) === 3177) {
        //   value += (3 * 838860.7) + 248945 + 222000;
        // }
        // hack to solve HM-ES-TX-WM overflow at 838860,7 Wh
        if (parseInt(id, 10) === 3177) {
          value += (5 * 838860.7) +
            248945 +
            222000 +
            323006 +
            206939.30 +
            576987 +    // battery replacement
            179520;     // ancient offset from grafana
        }

        status = '';
        if (dpValues[id] === undefined) {
          status = 'new';
          dpValues[id] = {timestamp: timestamp, value: value};
        }
        else if (dpValues[id].value === value) {
          status = 'unchanged';
        }
        else {
          status = 'changed';
          dpValues[id] = {timestamp: timestamp, value: value};
        }
        log.verbose('HMSRV: ' + status + ' - ' + id + ', ' + address + ', ' + name + ', ' + value);
        pushToWebSockets('update', {timestamp: timestamp, status: status, id: id, address: address, name: name, value: value});
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
} // logEvent()

/******************************************************************************
 *
 * Cron
 *
 */
function setupCron() {
  summaryJob = new CronJob({
    cronTime: '0 0 12 * * 0-6',
    onTick:  function () {
      // mail.send('hmsrv summary', getSummary(), function() {
      // });
      countValues = 0;
      countValuesFull = 0;
    },
    start: true
  });
} // setupCron()

function stopCron() {
  summaryJob.stop();
} // stopCron()

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
} // getSummary()

//
// ensure graceful shutdown
//
process.on('SIGTERM', shutdown.bind(null, {event: 'SIGTERM'}));
process.on('SIGINT', shutdown.bind(null, {event: 'SIGINT'}));
process.on("uncaughtException", function(err) {
  try {
    var msg = JSON.stringify(err.stack);
    // if (options.hmsrv.productive === true) {
    //   mail.send('hmsrv uncaughtException', msg, function() {
    //   });
    // }
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

    // stopCron();
    stopRpc(function() {
      flushGraphite(function() {
        exit();
      });
    });
  }
} //shutdown()

function exit() {
  process.exit();
} // exit()


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
} // parseArgs()

function prepareConfig() {
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
      console.error('HMSRV: unknown run mode. Exiting...');
      process.exit();
    }
  }
  if (options === undefined) {
    console.error('File options.json doesn\'t contain configuration for runmode "' + stats.runMode + '". Exiting...');
    process.exit(1);
  }
  if (options.ccu.rpc && options.ccu.rpc.length > 0) {
    for (var i = 0; i < options.ccu.rpc.length; i++) {
      options.ccu.rpc[i].ccuIp = options.ccu.ip;
      options.ccu.rpc[i].localIp = options.hmsrv.ip;
    }
  }
} // prepareConfig()

/******************************************************************************
 *
 * MAIN
 *
 */
var startTime = log.time();

parseArgs();
prepareConfig();


log.init(options);
log.info('Starting HMSRV in ' + stats.runMode + ' mode');
log.info('Visit https://' + options.hmsrv.ip + ':' + options.hmsrv.httpsPort.toString());

// mail.init(options);

setupServer();
setupRega();

setupFileSystem(function () {
  setupGraphite(function() {
    // setupRega(function() {
      loadRegaData(function() {
        setupRpc(options.ccu.rpc, function() {

          var dpCount = 0;
          // build datapoint Index name <> id
          for (var i in datapoints) {
            dpIndex[unescape(datapoints[i].Name)] = i;
            dpCount++;
          }
          for (i in dpIndex) {
            // log.verbose('HMSRV: dpIndex[' + i + '] = ' + dpIndex[i]);
          }
          log.info('HMSRV: dpIndex successfully build, ' + dpCount.toString() + ' entries.');

          setInterval(function() {
            flushGraphite();
          }, nFlushInterval * 1000);

          // setupCron();

          log.time(startTime, 'HMSRV: *** Startup finished successfully after ');
        });
      });
    // });
  });
});

})();
