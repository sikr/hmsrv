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

exports.open = function(file, callback) {
  // db = new TransactionDatabase(
  db = new sqlite3.Database(file, function (err) {
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

exports.close = function(callback) {
  db.close(callback);
};

exports.insertValues = function(table, data, callback) {
  db.serialize(function() {
    var sql = 'INSERT INTO ' + table.name + ' VALUES (?, ?, ?)';
    var stmt = db.prepare(sql);
    var values = [];
    var count = data.length;
    for (var i in data) {
      stmt.run(data[i].timestamp, data[i].id, data[i].value);
    }
    stmt.finalize(function() {
      if (typeof callback === 'function') {
        callback(count);
      }
    });
  });
};

exports.createTables = function(tables, callback){
  var stmt;
  db.serialize(function () {
    var table;
    for (table in tables) {
      stmt = db.prepare('CREATE TABLE ' + tables[table].name + ' (' + tables[table].sql + ')');
      stmt.run();
    }
    stmt.finalize(function(one, two, three) {
      var foo = 0;
      if (typeof callback === 'function') {
        callback();
      }
    });
  });
};



})();