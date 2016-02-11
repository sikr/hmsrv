/*
 * SCSW - Skeleton of a secure (https) client with websocket
 */
$(function() {


'use strict';

var socket = io.connect(location.origin);

socket.on('update', function (data) {
  console.log(data);
});

var getData = function(name, callback) {
  $.getJSON(location.href + name, {}, function cb(result) {
    if (callback) {
      callback(result);
    }
  });
};

$('#shutdown').click(function result() {
  var answer = confirm('Do you reallý want to shutdown HMSRV?');
  if (answer === true) {
    socket.emit('system', '{"msg": "shutdown"}');
  }
});

$('#test-mail').click(function result() {
  socket.emit('system', '{"msg": "mail"}');
});

$('#graphite-export').click(function result() {
  var answer = confirm('Do you reallý want to export to graphite?');
  if (answer === true) {
    socket.emit('system', '{"msg": "graphite-export"}');
  }
});

function createTable(id, d) {
  var body = $('body');
  var container = $('<div class="container"></div>').appendTo(body);
  var h1 = $('<h1>' + id + ' </h1>').appendTo(container);
  var table = $('<table id="' + id + '" class="display compact"></table>').appendTo(container);
  var thead, tbody;
  var row;
  var cell;
  var r, c;
  var i;

  var keys = [];
  // get all keys
  for (r in d) {
    for (c in d[r]) {
      if (typeof d[r][c] !== 'object') {
        if (keys.indexOf(c) === -1) {
          keys.push(c);
        }
      }
    }
  }

  thead = $('<thead></thead>').appendTo(table);

  row = $('<tr></tr>').appendTo(thead);
  cell = $('<th>Id</th>').appendTo(row);
  for (c in d) {
    // for (r in d[c]) {
    for (i in keys) {
      cell = $('<th>' + keys[i] + '</th>').appendTo(row);
    }
    break;
  }

  tbody = $('<tbody></tbody>').appendTo(table);
  for (r in d) {
    row = $('<tr></tr>').appendTo(tbody);
    cell = $('<td>' + r + '</td>').appendTo(row);
    for (i in keys) {
      if (d[r][keys[i]] !== undefined) {
        cell = $('<td>' + d[r][keys[i]] + '</td>').appendTo(row);
      }
      else {
        cell = $('<td></td>').appendTo(row);
      }
    }
  }

}
function loadData() {
  var tables = ['devices', 'channels', 'datapoints', 'rooms'];

  function get(table) {
    if (table) {
      getData(table, function(d) {
        createTable(table, d);
        $('#' + table).DataTable();
      });
      return get(tables.shift());
    }
  }
  get(tables.shift());
}
loadData();

});