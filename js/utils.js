/*
 * utils.js
 *
 * Some helper functions
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

//
// return a local date in the format
//   YYYY-MM-DD HH:MM:SS
//
function fill(n, m) {
  var s = '';
  while (n.length + s.length < m) {
    s+= '0';
  }
  return s+n;
};

//
// return a local date in the format
//   YYYYMMDDHHMMSS
//
exports.getRawDateTime = function() {
  var d = new Date();

  return fill( d.getFullYear()  .toString(), 4) +
         fill((d.getMonth() + 1).toString(), 2) +
         fill( d.getDate()      .toString(), 2) +
         fill( d.getHours()     .toString(), 2) +
         fill( d.getMinutes()   .toString(), 2) +
         fill( d.getSeconds()   .toString(), 2);
};
exports.getHumanReadableTimeSpan = function(time1, time2) {

  var delta = Math.abs(time2 - time1) / 1000;
  var days = Math.floor(delta / 86400);
  delta -= days * 86400;
  var hours = Math.floor(delta / 3600) % 24;
  delta -= hours * 3600;
  var minutes = Math.floor(delta / 60) % 60;
  delta -= minutes * 60;
  seconds = Math.round(delta);
  return days + ' days, ' + hours + ' hours, ' + minutes + ' minutes, ' + seconds + ' seconds';
};
exports.getHumanReadableTime = function(time) {

  var d = new Date(time);
  return fill( d.getHours()  .toString(), 2) + ":" +
         fill( d.getMinutes().toString(), 2) + ":" +
         fill( d.getSeconds().toString(), 2);
};
exports.getHumanReadableDateTime = function(time) {
  var d;
  if (time !== undefined) {
    d = new Date(time);
  }
  else {
    d = new Date();
  }

  return fill( d.getFullYear()  .toString(), 4) + '-' +
         fill((d.getMonth() + 1).toString(), 2) + '-' +
         fill( d.getDate()      .toString(), 2) + ' ' +
         fill( d.getHours()     .toString(), 2) + ':' +
         fill( d.getMinutes()   .toString(), 2) + ':' +
         fill( d.getSeconds()   .toString(), 2);
};

