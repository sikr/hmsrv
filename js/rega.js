/*
 * rega.js
 *
 * Runs scripts on Homematic CCU
 *
 * Parts of this script and the regascripts are taken from hobbyquaker's
 * ccu.io project: https://github.com/hobbyquaker/ccu.io
 *   
 * CC BY-NC 3.0
 *
 * Commercial use disallowed
 *
 *
 */

var fs      = require('fs');
var http    = require('http');
var https   = require('https');
var log     = require('./logger.js');
var xml2js  = require('xml2js');

var x2j = new xml2js.Parser({explicitArray:false});

var rega = function(options) {

  this.options = options;

  if (options.ccuIp && options.ca) {

    var requestOptions = {
      hostname: options.ccuIp,
      path: '/ise/checkrega.cgi',
      method: 'GET'
    };
    // provide certificate authority to verify https cert
    require('https').globalAgent.options.ca = fs.readFileSync(options.ca);

    var request = https.request(requestOptions, function(response) {
      response.on('data', function(data) {
        if (response.statusCode === 200 && data.toString() === 'OK') {
          options.ready();
        }
        else {
          options.down();
        }
      });
      response.on('error', function() {
          options.unreachable();
      });
    });
    request.end()
  }
  else {
    options.error();
  }
};

rega.prototype = {
  options: {},
  pendingRequests: 0,
  checkTime: function (callback) {
    this.runScript('WriteLine(system.Date("%F %X").ToTime().ToInteger());', function (result, err) {
    if (!err) {
      var ccuTime = parseInt(result.stdout, 10);
      var localTime = Math.round(new Date().getTime() / 1000);
      var diff = localTime - ccuTime;
      log.info("REGA CCU time difference local-ccu " + diff.toString() + "s");
    }
    callback(0, err);
    });
  },
  runScriptFile: function (script, callback) {
    var that = this;
    fs.readFile('../regascripts/' + script + '.fn', 'utf8', function (err, data) {
      if (err) {
        log.error("REGA runScriptFile " + err);
        return false;
      }
      that.runScript(data, function (res, err) {
        callback(res, err);
      });
    });
  },
  runScript: function(script, callback) {
    var that = this;
    log.verbose('REGA running script: ' + script);

    var requestOptions = {
      host: this.options.ccuIp,
      port: '8181',
      path: '/foo.exe',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': script.length
      }
    };

    this.pendingRequests += 1;
    var req = http.request(requestOptions, function(res) {
      var data = "";
      res.setEncoding('utf8');
      res.on('data', function (chunk) {
        data += chunk.toString();
      });
      res.on('end', function () {
        that.pendingRequests -= 1;
        var pos = data.lastIndexOf("<xml>");
        var stdout = (data.substring(0, pos));
        var xml = (data.substring(pos));
        x2j.parseString(xml, function (err, result) {
          if (callback) {
            if (result && result.xml) {
              callback({stdout: stdout, xml: result.xml}, null);
            }
            else {
              log.error('REGA invalid response: ' + data);
              callback(null, {msg: 'REGA invalid response: ' + stdout} );
            }
          }
        });
      });
    });
    req.on('error', function(e) {
      log.error('REGA post request error: ' + e.message);
      if (callback) {
        callback(null, {msg: 'REGA post request error: ' + e.message});
      }
    });
    req.write(script);
    req.end();
  }
};

module.exports = rega;