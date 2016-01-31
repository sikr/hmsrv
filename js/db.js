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
var fs                  = require('fs');
var sqlite3             = require("sqlite3").verbose();
var TransactionDatabase = require('sqlite3-transactions').TransactionDatabase;
var log                 = require('./logger.js');
var utils               = require('./utils');

exports.open = function(file, callback) {
  db = new TransactionDatabase(
    new sqlite3.Database(file, function (err) {
      if (null !== err) {
        log.error('DB: error opening database file: ' + JSON.stringify(err));
      }
      else {
        if (typeof callback === 'function') {
          callback();
        }
      }
    })
  );
};

exports.close = function(callback) {
  db.close(callback);
};

exports.initialize = function(tables, callback){
  var table;
  var _tables = [];
  var tableCount = 0;
  var successCount = 0;

  for (table in tables) {
    _tables.push(tables[table]);
    tableCount++;
  }

  function exists(table) {
    if (table) {
      var sql = 'SELECT name FROM sqlite_master WHERE type="table" AND name="' + table.name + '";';
      db.all(sql, function(err, data) {
        if (err) {
          callback({msg: 'DB: error reading from database: ' + sql});
        }
        else {
          if (data && data[0] && data[0].name && data[0].name === table.name) {
            count(table);
          }
          else {
            create(table);
          }
          return exists(_tables.shift());
        }
      });
    }
  }
  function count(table) {
    var sql = 'SELECT count(*) AS count FROM ' + table.name + ';';
    db.all(sql, function(err, data) {
      if (err) {
        callback({msg: 'DB: error reading count(*) from database: ' + sql});
      }
      else {
        if (data && data[0] && data[0].count !== undefined) {
          log.info('DB: table "' + table.name + '"" has ' + data[0].count + ' entries');
          finish();
        }
      }
    });
  }
  function create(table) {
    var sql = 'CREATE TABLE ' + table.name + ' (' + table.sql + ')';
    db.run(sql, function(err, data) {
      if (err) {
        callback({msg: 'DB: error creating table: "' + table.name + '", SQL=' + table.sql});
      }
      else {
        log.info('DB: non-existing table "' + table.name + '"" created');
        finish();
      }
    });
  }
  function finish() {
    successCount++;
    if (successCount === tableCount) {
      if (typeof callback === 'function') {
        callback(null);
      }
    }
  }
  exists(_tables.shift());
};

exports.clearTable = function(table, callback) {
  db.run('DELETE FROM ' + table.name, [], function(err) {
    if (typeof callback === "function") {
      callback(err);
    }
  });
};

exports.readTableCount = function(table, callback) {
  db.all('SELECT count(*) AS count FROM ' + table.name, [], function(err, data) {
    if (typeof callback === "function") {
      callback(err, data);
    }
  });
};

exports.readTables = function(tables, callback) {
  db.serialize(function() {
    var _tables = {};
    function read(table) {
      if (table) {
        db.all('SELECT * FROM ' + table.name, [], function(err, data) {
          if (!err) {
            log.info('DB: successfully read table ' + table.name + ', ' + data.length + ' entries');
            switch (table.name) {
              case 'devices':
                _tables.devices = data;
                break;
              case 'channels':
                _tables.channels = data;
                break;
              case 'datapoints':
                _tables.datapoints = data;
                break;
              case 'rooms':
                _tables.rooms = data;
                break;
              default: 
                log.error('DB: unknown table name "' + table.name + '"');
            }
            return read(tables.shift());
          }
          else {
            log.error('DB: error reading data from table ' + table.name + ': ' + JSON.stringify(err));
          }
        });
      }
      else {
        if (typeof callback === 'function') {
          callback(_tables);
        }
      }
    }
    read(tables.shift());
  });
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

function fillTable(table, callback) {
  db.beginTransaction(function (err, transaction) {
    var i;
    var j;
    var columns = ['Id'];
    var q = ['?'];
    var values = [];
    var stmt;
    var count = 0;

    for (i in table.data) {
      columns = ['Id'];
      q.push('?');
      values = [i];
      for (j in table.data[i]) {
        if (typeof table.data[i][j] !== 'object') {
          columns.push(j);
          values.push('\"' + table.data[i][j] + '\"');
          q.push('?');
        }
      }
      stmt = transaction.prepare('INSERT INTO ' + 
                                 table.name +
                                 '(' +
                                 columns.join(',') +
                                 ') VALUES (' +
                                 values.join(',') + ')');
      stmt.run();
      count++;
    }
    transaction.commit(function (err){
      if (err) {
        if (typeof callback === 'function') {
          callback(-1, err);
        }
      }
      else {
        if (typeof callback === 'function') {
          callback(count);
        }
      }
    });
  });
}

exports.fillTables = function(tables, callback) {
  function fill(table) {
    if (table) {
      fillTable(table, function (cnt, err) {
        if (cnt !== -1 && !err) {
          return fill(tables.shift());
        }
        else {
          log.error('DB: error writing table' + table.name + ' to db: ' + JSON.stringify(err));
        }
      });
    }
    else {
      if (typeof callback === 'function') {
        callback();
      }
    }
  }
  fill(tables.shift());
};

exports.readLatestValues = function(table, callback) {
  var sql = 'SELECT  datetime(timestamp / 1000, "unixepoch", "localtime") AS timestamp,' +
            '        id AS _id,' +
            '        value ' +
            'FROM    vals ' +
            'WHERE   timestamp = (' +
            '            SELECT MAX(timestamp)' +
            '            FROM   vals' +
            '            WHERE  id = _id' +
            '        )';
  db.all(sql, function(err, data) {
    if (err) {
      callback({msg: 'DB: error reading from table "' + table.name + '": ' + sql});
    }
    else {
      callback(null, data);
    }
  });
};

exports.readId = function(table, id, callback) {
  var sql = 'SELECT  datetime(timestamp / 1000, "unixepoch", "localtime") AS timestamp,' +
            '        value ' +
            'FROM    vals ' +
            'WHERE   id = ' + id;
  db.all(sql, function(err, data) {
    if (err) {
      callback({msg: 'DB: error reading from table "' + table.name + '": ' + sql});
    }
    else {
      callback(null, data);
    }
  });
};

// exports.readId = function(table, id, callback) {
//   var sql = 'SELECT * FROM ' + table.name + ' WHERE id=' + _id.toString();
//   db.all(sql, function(err, data) {
//     if (err) {
//       callback({msg: 'DB: error reading from table "' + table.name + '": ' + sql});
//     }
//     else {
//       callback(null, data);
//     }
//   });
// };


})();