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
var fsp = require ('fs/promises');

if (!fs.existsSync(__dirname + '/options.json')) {
  console.error('File js/options.json is missing - copy js/options.dist.json to js/options.json and adapt to your ip adresses');
  process.exit(1);
}

var log         = require('./logger.js');
// var mail        = require('./mail.js');
var utils       = require('./utils');
var optionsFile = require('./options.json');
var persistence = require('../data/persistence.json');
var lowbat      = require('../data/lowbat.json');
var offset      = require('../data/offset.json');
var options     = null;
// var CronJob     = require('cron').CronJob;
// var summaryJob  = null;
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
  hostname: os.hostname(),
  graphite: {
    flushing: {
      fail: 0,       // no of failed flush attempts
      success: 0     // no of successful flush attempts
    },
    connection: {
      error: 0,      // no of connection errors
      success: 0,    // no of successful connect attempts
      close: 0       // no of connection close events
    }
  }
};

//
// REGA
//
var Rega        = require('./rega.js');
var regaData    = ['channels', 'datapoints', 'devices', 'rooms'];
var regaHss;
// var regaUp      = false;

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
var dpIndex    = {}; // address > id, e. g. "BidCos-RF.NEQ0123228:1.TEMPERATURE" > "3991"
var dpValues   = []; // latest datapoint values to identify changes

var nFlushInterval = 60; // flush once a minute to graphite
// var countValues = 0;
// var countValuesFull = 0;

var Graphite = require('./graphite.js');
var graphite;
var graphiteCacheValuesFull = [];

var stopping = false;

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
      var cmd = JSON.parse(data).cmd;
      if (cmd.call === 'shutdown') {
        shutdown({event: 'usershutdown'});
      }
      // else if (msg === 'mail') {
      //   mail.send('hmsrv test mail\n\n', getSummary(), function() {
      //   });
      // }
      else if (cmd.call === 'handleLowBat') {
        handleLowBat(cmd.datapoint, cmd.value)
      }
      log.debug(data);
    });
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
function setupRega() {
  regaHss = new Rega({
    ccuIp: options.ccu.ip,
    ready: function() {
      log.info('CCU: rega is ready.');
      regaUp = true;
    },
    down: function() {
      log.error('CCU: rega is down.');
    },
    unreachable: function() {
      log.error('CCU: rega is unreachable.');
    }
  });
} // setupRega()

async function loadRegaData() {
  try {
    await loadRegaDataFromFile();
  }
  catch (err) {
    try {
      await loadRegaDataFromCCU(0);
      await writeRegaDataToFile();
    }
    catch (err) {
      log.error("Failed to load ReGa Data from CCU.");
    }
  }
} // loadRegaData()

async function writeRegaDataToFile() {
  var _regaData = [];
  var i;

  for (i in regaData) {
    _regaData.push(regaData[i]);
  }

  async function write(fileName) {
    if (fileName) {
      var mode = (stats.runMode !== 'PRODUCTION')? '.' + stats.runMode.toLowerCase() : '';
      var fullPath = __dirname + '/../data/' + fileName + mode + '.json';
      var data;
      switch (fileName) {
        case 'channels':
          data = JSON.stringify(channels, null, 2);
          break;
        case 'datapoints' :
          data = JSON.stringify(datapoints, null, 2);
          break;
        case 'devices' :
          data = JSON.stringify(devices, null, 2);
          break;
        case 'rooms' :
          data = JSON.stringify(rooms, null, 2);
          break;
        default:
          log.error('HMSRV: error writing rega data to file, unknown file: ' + fullPath);
          break;
      }
      if (data) {
        try {
          await fsp.writeFile(fullPath, data);
        }
        catch(err) {
          log.error('HMSRV: error reading rega data from file: ' + fullPath);
        }
        write(_regaData.shift());
      }
    }
  }
  write(_regaData.shift());
} // writeRegaDataToFile()

function loadRegaDataFromFile() {
  return new Promise((resolve, reject) => {
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
            reject(`HMSRV: file doesn't exist: ${fullPath}`);
          }
          else {
            if (stats.isFile()) {
              fs.readFile(fullPath, function(err, data) {
                if (err) {
                  reject(`HMSRV: error reading rega data from file: ${fullPath}`);
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
              reject(`HMSRV: cannot read from file ${fullPath}`);
            }
          }
        });
      }
      else {
        resolve();
      }
    }
    read(_regaData.shift());
  })
} // loadRegaDataFromFile()

function loadRegaDataFromCCU(index) {
  return new Promise((resolve, reject) => {
    if (index === 0) {
      regaHss.checkTime(function() {
      });
    }

    regaHss.runScriptFile(regaData[index], function(res, err) {
      if (err) {
        reject(`HMSRV: error running script ${regaData[index]}`);
      }
      else {
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

        index++;
        if (index < regaData.length) {
          resolve(loadRegaDataFromCCU(index));
        }
        else {
          resolve();
        }
      }
    });
  });
} // loadRegaDataFromCCU()

/******************************************************************************
 *
 * RPC
 *
 */
async function setupRpc() {
  var instances = [];
  for (var i = 0; i < (options.ccu.rpc.length-rpcNoCUxD); i++) {
    hmrpc[i] = new Rpc.HomematicRpc({options: options.ccu.rpc[i], instanceId: options.hmsrv.instanceId.value, runMode: stats.runMode.toLowerCase(), log: log, event: logEvent});
    instances.push(hmrpc[i]);
  }
  for (i in instances) {
    try {
      await instances[i].start();
    }
    catch(err) {
      log.error(`Failed to start RPC instance ${i}. ${err}`)
    }
  }
} // setupRpc()

async function stopRpc() {
  for (var i in hmrpc) {
    try {
      await hmrpc[i].stop();
    }
    catch(err) {
      log.error(`Failed to shutdown RPC instance 0. ${err}`);
    }
  }
} // stopRpc()

/******************************************************************************
 *
 * Graphite
 *
 */
async function setupGraphite() {
  if (checkGraphiteConfig()) {
    var _options = {
      ip: options.graphite.ip,
      port: options.graphite.port,
      prefix: options.graphite.prefix
    };
    graphite = new Graphite(_options);

    await graphite.connect();

    graphite.on("close", () => {
      log.info("GRAPHITE: connection closed.");
      stats.graphite.connection.close++;
    });

    graphite.on("connect", () => {
      log.info("GRAPHITE: successfully connected.");
      stats.graphite.connection.success++;
    });

    graphite.on("error", (err) => {
      log.error("GRAPHITE: " + err);
      stats.graphite.connection.error++;
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

async function flushGraphite() {
  if (graphiteCacheValuesFull.length > 0) {
    var graphiteValues = graphiteCacheValuesFull;
    graphiteCacheValuesFull = [];

    try {
      await graphite.send(graphiteValues);
      log.debug(`GRAPHITE: ${graphiteValues.length} values flushed`);
      stats.graphite.flushing.success++;
    }
    catch(err) {
      log.error(`GRAPHITE: flush failed: ${err}`);

      // new metrics may have emerged while flushing
      if (graphiteCacheValuesFull.length > 0) {
        // in this case merge old and new metrics
        var allValues = [...graphiteCacheValuesFull, ...graphiteValues];
        graphiteValues = allValues;
      }
      else {
        // nothing new since
        graphiteCacheValuesFull = graphiteValues;
      }
      stats.graphite.flushing.fail++;
    };
  }
  else {
    log.debug('GRAPHITE: nothing to flush');
  }
}

function stopGraphite() {
  graphite.close();
}


/******************************************************************************
 *
 * Filesystem
 *
 */
async function setupFileSystem() {
  let exists;
  // verify that all directories exist
  for (var i in directories) {
    try {
      exists = await fsp.stat(directories[i]);
      if (!exists) {
        try {
          await fsp.mkdir(directories[i]);
        }
        catch(err) {
          log.error(`Failed to create directory ${diretory[i]} - ${err}`);
        }
      }
    }
    catch (err) {
      log.error(`Failed to verify directory ${directory[i]} - ${err}`);
    }
  }
} // setupFileSystem()

function handleLowBat(id, status) {
  let channel = channels[datapoints[id].Parent];
  let deviceId = channel.Parent;
  let event, date;
  let now = new Date();
  let modified = false;

  datapoints[id].Value = status;
  if (status === true) {
    if (!lowbat[deviceId]) {
      // device not yet listed in lowbat.json
      lowbat[deviceId] = {
        events: []
      };
    }
    event = lowbat[deviceId].events[lowbat[deviceId].events.length-1];
    if (!event || event.replacement !== '') {
      if (event) {
        date = new Date(event.replacement);
      }
      /*
       * Some devices seem to have a lowbat true/false jitter, so only
       * lowbat=false events lasting for more than 1 days are presereved
       */
      if (date && now.valueOf() - date.valueOf() < 86400000) {
        // discard jitter
        event.replacement = '';
        modified = true;
      }
      else {
        // calc battery duration
        if (event && date) {
          event.duration = utils.getHumanReadableTimeSpan(now, date);
        }
        // new lowbat event
        lowbat[deviceId].events.push({
          'replacement': '',
          'duration': ''
        });
        modified = true;
      }
    }
  }
  else {
    if (lowbat[deviceId] && lowbat[deviceId].events) {
      event = lowbat[deviceId].events[lowbat[deviceId].events.length-1];
      if (event && event.replacement === '') {
        // battery replaced
        event.replacement = now.toISOString();
        modified = true;
      }
    }
  }
  if (modified) {
    fs.writeFile('../data/lowbat.json', JSON.stringify(lowbat, null, 2), (err) => {
      if (err) {
        log.error(`HMSRV: error writing lowbat.json - ${err}`);
      }
    });
  }
}

function getOffset(datapoint) {
  var sum = 0;

  try {
    if (offset[datapoint] && offset[datapoint].events) {
      let events = offset[datapoint].events;
      for (var i in events) {
        sum += events[i].value;
      }
    }
  }
  catch(err) {
    log.error(`Error calculating offset for datapoint ${datapoint}`);
  }
  return sum;
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
        log.verbose('RPC: converted non numeric (boolean) to integer: ' + address + ', ' + name + ', ' + event[3] + ' -> ' + value);
      }
      else {
        store = false;
        log.verbose('RPC: non numeric value: ' + address + ', ' + name + ', ' + event[3]);
      }
    }
    if (store) {
      id = dpIndex['BidCos-RF.' + address + '.' + name];
      if (id === undefined) {
        id = dpIndex['HmIP-RF.' + address + '.' + name];
      }      

      if (id !== undefined) {

        // hack to solve HM-ES-TX-WM overflow at 838860,7 Wh
        var datapoint = parseInt(id, 10);
        var unadjustedValue = -1;
        if (datapoint === 3177) {
          unadjustedValue = value;
          var offset = getOffset(datapoint);
          value += offset;
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
        
        // console
        log.verbose('HMSRV: ' + status + ' - ' + id + ', ' + address + ', ' + name + ', ' + value);

        // websocket
        var update = {timestamp: timestamp, time: utils.getHumanReadableTime(timestamp), status: status, id: id, address: address, name: name, value: value};
        if (unadjustedValue !== -1) {
          update.unadjustedValue = unadjustedValue;
        }
        pushToWebSockets('update', update);

        // graphite
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
    if (name === 'LOWBAT') {
      handleLowBat(id, event[3]);
    }
  }
} // logEvent()

/******************************************************************************
 *
 * Cron
 *
 */
// function setupCron() {
//   summaryJob = new CronJob({
//     cronTime: '0 0 12 * * 0-6',
//     onTick:  function () {
//       // mail.send('hmsrv summary', getSummary(), function() {
//       // });
//       countValues = 0;
//       countValuesFull = 0;
//     },
//     start: true
//   });
//   resolve();
// } // setupCron()

// function stopCron() {
//   return new Promise(function(resolve, reject) {
//     summaryJob.stop();
//     resolve();
//   });
// } // stopCron()

// function getSummary() {
//   return 'Hi!\n\n' +
//          'This is the HMSRV summary for today:\n\n' +
//          countValues + ' values written to table VALUES\n' +
//          countValuesFull + ' values written to table VALUESFULL\n' +
//          stats.servedRequests + ' requests handled\n' +
//          Math.round(stats.servedRequestSize/1024) + ' kBytes delivered\n' +
//          'HMSRV is running in ' + stats.runMode + ' mode\n' +
//          'Uptime: ' + utils.getHumanReadableTimeSpan(stats.startTime, new Date()) + '\n' +
//          'Starttime ' + utils.getHumanReadableDateTime(stats.startTime) + '\n\n' +
//          'Cheers, HMSRV\n';
// } // getSummary()

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
    process.exit(1100);
  }
});

async function shutdown(params) {
  if (!stopping) {
    stopping = true;

    log.info('HMSRV: "' + params.event + '", shutting down...');

    var mode = (stats.runMode !== 'PRODUCTION')? '.' + stats.runMode.toLowerCase() : '';
    var data = JSON.stringify(datapoints, null, 2);
    var fullPath = __dirname + '/../data/datapoints' + mode + '.json'
    try {
      await fsp.writeFile(fullPath, data);
      log.info('HMSRV: datapoints successfully written to file');
    }
    catch (err) {
      log.error('HMSRV: error writing datapoints to file: ' + fullPath);
    }

    try {
      // await stopCron()
      await stopRpc();
      await flushGraphite();
      await stopGraphite();
      log.info("Gracefully shutdown HMSRV. Bye.");
      process.exit(0);
    }
    catch(err) {
      log.error(`ERROR: ${err}`);
      process.exit(1001);
    };
  }
} //shutdown()

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
async function main() {

  let dpCount = 0;
  let startTime = log.time();

  parseArgs();
  prepareConfig();

  log.init(options);
  log.info('Starting HMSRV in ' + stats.runMode + ' mode');
  log.info('Visit https://' + options.hmsrv.ip + ':' + options.hmsrv.httpsPort.toString());

  // mail.init(options);

  setupServer();
  setupRega();
  await setupFileSystem();
  await setupGraphite();
  await loadRegaData();
  await setupRpc();

  // build datapoint index
  for (var i in datapoints) {
    dpIndex[unescape(datapoints[i].Name)] = i;
    dpCount++;
  }
  log.info('HMSRV: Data Point Index successfully built, ' + dpCount.toString() + ' entries.');

  setInterval(function() {
    flushGraphite();
  }, nFlushInterval * 1000);

  // await setupCron();

  log.time(startTime, 'HMSRV: *** Startup finished successfully after ');
}

main();
})();
