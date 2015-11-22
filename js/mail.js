(function() {

'use strict';

var mailer  = require('nodemailer');
var smtp    = require('nodemailer-smtp-transport');
var log     = require('./logger.js');
var options = require('./options.json');

var mail = {

  transport: mailer.createTransport(smtp({
    host: options.mail.host,
    port: options.mail.port,
    auth: {
        user: options.mail.user,
        pass: options.mail.password,
        secure: options.mail.secure
    }
  })),
  send: function(subject, message, callback) {
    var mailOptions = {
        from: options.mail.user,
        to: options.mail.recipient,
        subject: subject,
        text: message
    };

    this.transport.sendMail(mailOptions, function(error, info) {
        if (error) {
          log.error(error);
        }
        else {
          log.info('MAIL: sent message to ' + options.mail.recipient + ': ' + info.response);
        }
        if (typeof callback === 'function') {
          callback();
        }
    });
  }

};

module.exports = mail;

})();
