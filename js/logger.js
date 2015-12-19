/*
 * logger.js
 *
 * Log status info to file and/or console
 * 
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

var fs      = require('fs');
var utils   = require('./utils.js');
var options = require('./options.json');

var logger = {

  logfile: __dirname + '/../' + options.log.file.name,
  level: 0,

  // time measurement
  id: 0,
  startTime: [],

  type: {
    0: 'debug:   ',
    1: 'verbose: ',
    2: 'info:    ',
    3: 'time:    ',
    4: 'warn:    ',
    5: 'error:   '
  },

  debug: function(message) {
    this.log(0, message);
  },
  verbose: function(message) {
    this.log(1, message);
  },
  info: function(message) {
    this.log(2, message);
  },
  time: function(id, message) {
    if (id === undefined) {
      this.id++;
      this.startTime[this.id] = new Date();
      return this.id;
    }
    else {
      if (this.startTime[id] !== undefined) {
        var t = new Date();
        var diff = t - this.startTime[id];
        this.log(3, message + ' ' + (diff/1000).toString() + ' s');
        this.startTime[id] = undefined;
      }
      else {
        this.log(5, 'Invalid time id: ' + id);
      }
    }
  },
  warn: function(message) {
    this.log(4, message);
  },
  error: function(message) {
    this.log(5, message);
  },
  log: function(level, message) {
    var msg;
    var msgFile;
    var msgConsole;

    if (typeof message !== 'string') {
      msg = JSON.stringify(message);
    }
    else {
      msg = message.replace(/(\r\n|\n|\r)/gm,"");
    }

    if (options.log.file && level >= options.log.file.level) {
      msgFile = utils.getPrettyDate();
      msgFile += ' ' + this.type[level];
      msgFile += msg;

      if (options.log.file.maxLength != -1 &&
          msgFile.length > options.log.file.maxLength) {
        msgFile = msgFile.slice(0, options.log.file.maxLength - 4) + " ...";
      }
      logFile.write(msgFile + '\n');
    }

    if (options.log.console  && level >= options.log.console.level) {
      msgConsole = utils.getPrettyDate();
      msgConsole += ' ' + this.type[level];
      msgConsole += msg;

      if (options.log.console.maxLength != -1 &&
          msgConsole.length > options.log.console.maxLength) {
        msgConsole = msgConsole.slice(0, options.log.console.maxLength - 4) + " ...";
      }
      console.log(msgConsole);
    }
  }
};

var logFile = fs.createWriteStream(logger.logfile, {
    flags: "a", encoding: "utf8", mode: 0644
});

module.exports = logger;