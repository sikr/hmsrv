/*
 * db.js
 *
 * Read and write Homematic CCU data from/to sqlite3 database
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

(function() {

'use strict';

var db;
var fs      = require('fs');
var sqlite3 = require("sqlite3").verbose();
var log     = require('./logger.js');
var utils   = require('./utils');

exports.createDatabase = function() {
  log.info('DB: Create Database');
  if (!fs.existsSync(databaseDir + databaseFile)) {
    if (!fs.existsSync(databaseDir)) {
      fs.mkdirSync(databaseDir);
    }
    db.open(databaseDir + databaseFile);
    db.createTables(databaseDir + databaseFile, databaseTables);
  }
  else {
    db.open(databaseDir + databaseFile);
    db.clear(databaseTables);
    // db.getTables();
  }
  // db.fillTables(databaseTables);
  // db.dumpFiles();
  console.timeEnd('Create Datebase');
};

exports.open = function(file, callback) {
  // db = new TransactionDatabase(
    new sqlite3.Database(file, function (err) {
      if (null !== err) {
        log.error('DB: error opening database file: ' + JSON.stringify(err));
      }
      else {
        if (typeof callback === 'function') {
          callback();
        }
      }
    });
  // );
};

exports.createTables = function(file, tables){
  var stmt;
  db.serialize(function () {
    var table;
    for (table in tables) {
      stmt = db.prepare('CREATE TABLE ' + tables[table].name + ' (' + tables[table].sql + ')');
      stmt.run();
    }
    stmt.finalize();
  });
};



})();