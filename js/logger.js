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
var logFile;

var logger = {

  initialized: false,
  level: 0,

  logfile: null,
  options: null,

  // time measurement
  id: 0,
  startTime: [],

  type: {
    0: 'verbose: ',
    1: 'debug:   ',
    2: 'info:    ',
    3: 'time:    ',
    4: 'warn:    ',
    5: 'error:   '
  },

  init: function(options) {
    this.options = options;
    this.logfile = this.options.log.file.name;
    logFile = fs.createWriteStream(this.logfile, {
        flags: "a", encoding: "utf8", mode: 0644
    });
    this.initialized = true;
  },
  verbose: function(message) {
    this.log(0, message);
  },
  debug: function(message) {
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

    if (!this.initialized) {
      console.error('Logger is not yet initialized');
    }
    else {
      if (this.options.log.file && level >= this.options.log.file.level) {
        msgFile = utils.getHumanReadableDateTime();
        msgFile += ' ' + this.type[level];
        msgFile += msg;

        if (this.options.log.file.maxLength != -1 &&
            msgFile.length > this.options.log.file.maxLength) {
          msgFile = msgFile.slice(0, this.options.log.file.maxLength - 4) + " ...";
        }
        logFile.write(msgFile + '\n');
      }

      if (this.options.log.console  && level >= this.options.log.console.level) {
        msgConsole = utils.getHumanReadableDateTime();
        msgConsole += ' ' + this.type[level];
        msgConsole += msg;

        if (this.options.log.console.maxLength != -1 &&
            msgConsole.length > this.options.log.console.maxLength) {
          msgConsole = msgConsole.slice(0, this.options.log.console.maxLength - 4) + " ...";
        }
        console.log(msgConsole);
      }
    }
  }
};

module.exports = logger;